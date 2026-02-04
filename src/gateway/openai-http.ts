import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { buildHistoryContextFromEntries, type HistoryEntry } from "../auto-reply/reply/history.js";
import { createDefaultDeps } from "../cli/deps.js";
import { agentCommand } from "../commands/agent.js";
import {
  getContextStore,
  type ApiConfig,
  type SessionContext,
  type UserMetadata,
} from "../context/index.js";
import { emitAgentEvent, onAgentEvent } from "../infra/agent-events.js";
import { defaultRuntime } from "../runtime.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import {
  readJsonBodyOrError,
  sendJson,
  sendMethodNotAllowed,
  sendUnauthorized,
  setSseHeaders,
  writeDone,
} from "./http-common.js";
import { getBearerToken, resolveAgentIdForRequest, resolveSessionKey } from "./http-utils.js";

type OpenAiHttpOptions = {
  auth: ResolvedGatewayAuth;
  maxBodyBytes?: number;
  trustedProxies?: string[];
};

type OpenAiChatMessage = {
  role?: unknown;
  content?: unknown;
  name?: unknown;
};

type OpenAiChatCompletionRequest = {
  model?: unknown;
  stream?: unknown;
  messages?: unknown;
  user?: unknown;
  /** Extended user metadata for multi-tenant isolation */
  user_metadata?: unknown;
  /** Extended configuration for tools and features */
  config?: unknown;
};

/**
 * Parse and validate user_metadata from request.
 */
function parseUserMetadata(val: unknown): UserMetadata | null {
  if (!val || typeof val !== "object") return null;
  const obj = val as Record<string, unknown>;
  const userId = typeof obj.user_id === "string" ? obj.user_id : null;
  const userHash = typeof obj.user_hash === "string" ? obj.user_hash : null;
  const channel = typeof obj.channel === "string" ? obj.channel : "api";
  if (!userId || !userHash) return null;
  return { user_id: userId, user_hash: userHash, channel };
}

/**
 * Parse and validate config from request.
 */
function parseApiConfig(val: unknown): ApiConfig {
  const defaults: ApiConfig = { tools: [], websearch_enabled: false, stream: false };
  if (!val || typeof val !== "object") return defaults;
  const obj = val as Record<string, unknown>;
  return {
    tools: Array.isArray(obj.tools) ? obj.tools.filter((t) => typeof t === "string") : [],
    websearch_enabled: Boolean(obj.websearch_enabled),
    stream: Boolean(obj.stream),
  };
}

function writeSse(res: ServerResponse, data: unknown) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function asMessages(val: unknown): OpenAiChatMessage[] {
  return Array.isArray(val) ? (val as OpenAiChatMessage[]) : [];
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const type = (part as { type?: unknown }).type;
        const text = (part as { text?: unknown }).text;
        const inputText = (part as { input_text?: unknown }).input_text;
        if (type === "text" && typeof text === "string") return text;
        if (type === "input_text" && typeof text === "string") return text;
        if (typeof inputText === "string") return inputText;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function buildAgentPrompt(messagesUnknown: unknown): {
  message: string;
  extraSystemPrompt?: string;
} {
  const messages = asMessages(messagesUnknown);

  const systemParts: string[] = [];
  const conversationEntries: Array<{ role: "user" | "assistant" | "tool"; entry: HistoryEntry }> =
    [];

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const role = typeof msg.role === "string" ? msg.role.trim() : "";
    const content = extractTextContent(msg.content).trim();
    if (!role || !content) continue;
    if (role === "system" || role === "developer") {
      systemParts.push(content);
      continue;
    }

    const normalizedRole = role === "function" ? "tool" : role;
    if (normalizedRole !== "user" && normalizedRole !== "assistant" && normalizedRole !== "tool") {
      continue;
    }

    const name = typeof msg.name === "string" ? msg.name.trim() : "";
    const sender =
      normalizedRole === "assistant"
        ? "Assistant"
        : normalizedRole === "user"
          ? "User"
          : name
            ? `Tool:${name}`
            : "Tool";

    conversationEntries.push({
      role: normalizedRole,
      entry: { sender, body: content },
    });
  }

  let message = "";
  if (conversationEntries.length > 0) {
    let currentIndex = -1;
    for (let i = conversationEntries.length - 1; i >= 0; i -= 1) {
      const entryRole = conversationEntries[i]?.role;
      if (entryRole === "user" || entryRole === "tool") {
        currentIndex = i;
        break;
      }
    }
    if (currentIndex < 0) currentIndex = conversationEntries.length - 1;
    const currentEntry = conversationEntries[currentIndex]?.entry;
    if (currentEntry) {
      const historyEntries = conversationEntries.slice(0, currentIndex).map((entry) => entry.entry);
      if (historyEntries.length === 0) {
        message = currentEntry.body;
      } else {
        const formatEntry = (entry: HistoryEntry) => `${entry.sender}: ${entry.body}`;
        message = buildHistoryContextFromEntries({
          entries: [...historyEntries, currentEntry],
          currentMessage: formatEntry(currentEntry),
          formatEntry,
        });
      }
    }
  }

  return {
    message,
    extraSystemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
  };
}

function resolveOpenAiSessionKey(params: {
  req: IncomingMessage;
  agentId: string;
  user?: string | undefined;
}): string {
  return resolveSessionKey({ ...params, prefix: "openai" });
}

function coerceRequest(val: unknown): OpenAiChatCompletionRequest {
  if (!val || typeof val !== "object") return {};
  return val as OpenAiChatCompletionRequest;
}

export async function handleOpenAiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OpenAiHttpOptions,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/v1/chat/completions") return false;

  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return true;
  }

  const token = getBearerToken(req);
  const authResult = await authorizeGatewayConnect({
    auth: opts.auth,
    connectAuth: { token, password: token },
    req,
    trustedProxies: opts.trustedProxies,
  });
  if (!authResult.ok) {
    sendUnauthorized(res);
    return true;
  }

  const body = await readJsonBodyOrError(req, res, opts.maxBodyBytes ?? 1024 * 1024);
  if (body === undefined) return true;

  const payload = coerceRequest(body);
  const stream = Boolean(payload.stream);
  const model = typeof payload.model === "string" ? payload.model : "openclaw";
  const user = typeof payload.user === "string" ? payload.user : undefined;

  // Parse extended metadata
  const userMetadata = parseUserMetadata(payload.user_metadata);
  const apiConfig = parseApiConfig(payload.config);

  // Determine user ID and session key
  const effectiveUserId = userMetadata?.user_id ?? user ?? "anonymous";
  const agentId = resolveAgentIdForRequest({ req, model });
  const sessionKey = userMetadata
    ? `${userMetadata.channel}:${effectiveUserId}`
    : resolveOpenAiSessionKey({ req, agentId, user });

  const runId = `chatcmpl_${randomUUID()}`;
  const deps = createDefaultDeps();
  const startTime = Date.now();

  // Extract the current user message content (before any flattening)
  const requestMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const lastUserMessage = [...requestMessages].reverse().find((m: any) => m?.role === "user");
  const currentUserContent =
    typeof lastUserMessage?.content === "string" ? lastUserMessage.content : "";

  // Fetch existing session context from Redis if user_metadata is provided
  let sessionContext: SessionContext | null = null;
  let messagesWithHistory = payload.messages;
  const contextStore = userMetadata ? getContextStore() : null;

  if (userMetadata && contextStore) {
    sessionContext = await contextStore.getContext(effectiveUserId, sessionKey);
    const now = Date.now();

    if (!sessionContext) {
      // Create new session context (metadata only - messages stored separately)
      sessionContext = {
        userId: effectiveUserId,
        sessionId: runId,
        sessionKey,
        channel: userMetadata.channel,
        createdAt: now,
        updatedAt: now,
        activeTools: apiConfig.tools,
        recentMessages: [],
        tokenCounts: { input: 0, output: 0, total: 0 },
        model,
        metadata: { user_hash: userMetadata.user_hash },
      };
      // Initialize session metadata in Redis
      await contextStore.setContext(sessionContext);
    } else {
      // Update metadata only (efficient - no message read/write)
      if (contextStore.updateMetadata) {
        await contextStore.updateMetadata(effectiveUserId, sessionKey, {
          activeTools: apiConfig.tools,
          model,
        });
      }

      // Inject conversation history from Redis into the messages array
      // This ensures the LLM sees the full conversation context as STRUCTURED messages
      if (sessionContext.recentMessages.length > 0) {
        const historyMessages = sessionContext.recentMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        // Merge: system messages + history + new user messages
        const systemMessages = requestMessages.filter(
          (m: any) => m?.role === "system" || m?.role === "developer",
        );
        const newUserMessages = requestMessages.filter(
          (m: any) => m?.role === "user" || m?.role === "assistant",
        );

        messagesWithHistory = [...systemMessages, ...historyMessages, ...newUserMessages];
      }
    }

    // Push current user message to Redis LIST (efficient - single RPUSH)
    if (contextStore.pushMessage && currentUserContent) {
      await contextStore.pushMessage(effectiveUserId, sessionKey, {
        role: "user",
        content: currentUserContent,
        timestamp: now,
      });
    }
  }

  // Build prompt with conversation history injected
  const prompt = buildAgentPrompt(messagesWithHistory);
  if (!prompt.message) {
    sendJson(res, 400, {
      error: {
        message: "Missing user message in `messages`.",
        type: "invalid_request_error",
      },
    });
    return true;
  }

  if (!stream) {
    try {
      const result = await agentCommand(
        {
          message: prompt.message,
          extraSystemPrompt: prompt.extraSystemPrompt,
          sessionKey,
          runId,
          deliver: false,
          messageChannel: userMetadata?.channel ?? "webchat",
          bestEffortDeliver: false,
        },
        defaultRuntime,
        deps,
      );

      const payloads = (result as { payloads?: Array<{ text?: string }> } | null)?.payloads;
      const content =
        Array.isArray(payloads) && payloads.length > 0
          ? payloads
              .map((p) => (typeof p.text === "string" ? p.text : ""))
              .filter(Boolean)
              .join("\n\n")
          : "No response from OpenClaw.";

      const processingTimeMs = Date.now() - startTime;

      // Extract token usage from the underlying LLM response
      const resultWithMeta = result as {
        payloads?: Array<{ text?: string }>;
        meta?: { agentMeta?: { usage?: { input?: number; output?: number; total?: number } } };
      } | null;
      const usage = resultWithMeta?.meta?.agentMeta?.usage;
      const promptTokens = usage?.input ?? 0;
      const completionTokens = usage?.output ?? 0;
      const totalTokens = usage?.total ?? promptTokens + completionTokens;

      // Push assistant response to Redis LIST (efficient - single RPUSH)
      if (userMetadata && contextStore?.pushMessage) {
        await contextStore.pushMessage(effectiveUserId, sessionKey, {
          role: "assistant",
          content,
          timestamp: Date.now(),
          tokens: completionTokens,
        });
      }

      // Update token counts in session metadata
      if (userMetadata && contextStore?.updateMetadata) {
        await contextStore.updateMetadata(effectiveUserId, sessionKey, {
          tokenCounts: {
            input: promptTokens,
            output: completionTokens,
            total: totalTokens,
          },
        });
      }

      // Build response with extended metadata
      const response: Record<string, unknown> = {
        id: runId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        },
      };

      // Add tolbot_metadata if user_metadata was provided
      if (userMetadata) {
        response.tolbot_metadata = {
          tools_used: apiConfig.tools,
          context_tokens: totalTokens,
          session_id: sessionContext?.sessionId ?? runId,
          processing_time_ms: processingTimeMs,
          model,
        };
      }

      sendJson(res, 200, response);
    } catch (err) {
      sendJson(res, 500, {
        error: { message: String(err), type: "api_error" },
      });
    }
    return true;
  }

  setSseHeaders(res);

  let wroteRole = false;
  let sawAssistantDelta = false;
  let closed = false;
  let streamedContent = "";

  const unsubscribe = onAgentEvent((evt) => {
    if (evt.runId !== runId) return;
    if (closed) return;

    if (evt.stream === "assistant") {
      const delta = evt.data?.delta;
      const text = evt.data?.text;
      const content = typeof delta === "string" ? delta : typeof text === "string" ? text : "";
      if (!content) return;

      if (!wroteRole) {
        wroteRole = true;
        writeSse(res, {
          id: runId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { role: "assistant" } }],
        });
      }

      sawAssistantDelta = true;
      streamedContent += content;
      writeSse(res, {
        id: runId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            delta: { content },
            finish_reason: null,
          },
        ],
      });
      return;
    }

    if (evt.stream === "lifecycle") {
      const phase = evt.data?.phase;
      if (phase === "end" || phase === "error") {
        closed = true;
        unsubscribe();

        // Send final metadata chunk if user_metadata was provided
        if (userMetadata) {
          const processingTimeMs = Date.now() - startTime;
          writeSse(res, {
            id: runId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            tolbot_metadata: {
              tools_used: apiConfig.tools,
              context_tokens: sessionContext?.tokenCounts.total ?? 0,
              session_id: sessionContext?.sessionId ?? runId,
              processing_time_ms: processingTimeMs,
              model,
            },
          });
        }

        writeDone(res);
        res.end();
      }
    }
  });

  req.on("close", () => {
    closed = true;
    unsubscribe();
  });

  void (async () => {
    try {
      const result = await agentCommand(
        {
          message: prompt.message,
          extraSystemPrompt: prompt.extraSystemPrompt,
          sessionKey,
          runId,
          deliver: false,
          messageChannel: userMetadata?.channel ?? "webchat",
          bestEffortDeliver: false,
        },
        defaultRuntime,
        deps,
      );

      if (closed) return;

      if (!sawAssistantDelta) {
        if (!wroteRole) {
          wroteRole = true;
          writeSse(res, {
            id: runId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: { role: "assistant" } }],
          });
        }

        const payloads = (result as { payloads?: Array<{ text?: string }> } | null)?.payloads;
        const content =
          Array.isArray(payloads) && payloads.length > 0
            ? payloads
                .map((p) => (typeof p.text === "string" ? p.text : ""))
                .filter(Boolean)
                .join("\n\n")
            : "No response from OpenClaw.";

        sawAssistantDelta = true;
        streamedContent = content;
        writeSse(res, {
          id: runId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              delta: { content },
              finish_reason: null,
            },
          ],
        });
      }

      // Extract token usage from the underlying LLM response (streaming)
      const resultWithMeta = result as {
        payloads?: Array<{ text?: string }>;
        meta?: { agentMeta?: { usage?: { input?: number; output?: number; total?: number } } };
      } | null;
      const usage = resultWithMeta?.meta?.agentMeta?.usage;
      const completionTokens = usage?.output ?? 0;

      // Push assistant response to Redis LIST for streaming (efficient - single RPUSH)
      if (userMetadata && streamedContent && contextStore?.pushMessage) {
        await contextStore.pushMessage(effectiveUserId, sessionKey, {
          role: "assistant",
          content: streamedContent,
          timestamp: Date.now(),
          tokens: completionTokens,
        });
      }

      // Update token counts in session metadata (streaming)
      if (userMetadata && usage && contextStore?.updateMetadata) {
        const promptTokens = usage.input ?? 0;
        const totalTokens = usage.total ?? promptTokens + completionTokens;
        await contextStore.updateMetadata(effectiveUserId, sessionKey, {
          tokenCounts: {
            input: promptTokens,
            output: completionTokens,
            total: totalTokens,
          },
        });
      }
    } catch (err) {
      if (closed) return;
      writeSse(res, {
        id: runId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            delta: { content: `Error: ${String(err)}` },
            finish_reason: "stop",
          },
        ],
      });
      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: { phase: "error" },
      });
    } finally {
      if (!closed) {
        closed = true;
        unsubscribe();
        writeDone(res);
        res.end();
      }
    }
  })();

  return true;
}
