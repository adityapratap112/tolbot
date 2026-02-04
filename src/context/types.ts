/**
 * Context types for multi-tenant session management.
 * These types support the REST API with extended context for user isolation and tool routing.
 */

/**
 * User metadata passed with each API request for multi-tenant isolation.
 */
export type UserMetadata = {
  /** Unique user identifier (e.g., "tolbot_user_99") */
  user_id: string;
  /** User hash for Supabase validation */
  user_hash: string;
  /** Channel the request originated from (e.g., "whatsapp", "telegram", "api") */
  channel: "whatsapp" | "telegram" | "discord" | "slack" | "api" | (string & {});
};

/**
 * Configuration for the API request.
 */
export type ApiConfig = {
  /** List of tools to enable for this request */
  tools: string[];
  /** Whether web search is enabled */
  websearch_enabled: boolean;
  /** Whether to stream the response */
  stream: boolean;
};

/**
 * Extended chat completion request that mirrors OpenAI schema with additional context.
 */
export type ExtendedChatCompletionRequest = {
  /** Model to use (optional, uses default if not specified) */
  model?: string;
  /** Whether to stream the response */
  stream?: boolean;
  /** Messages array following OpenAI format */
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  /** User identifier (OpenAI compatible) */
  user?: string;
  /** Extended user metadata for multi-tenant isolation */
  user_metadata: UserMetadata;
  /** Extended configuration for tools and features */
  config: ApiConfig;
};

/**
 * A single message in the conversation history.
 * Stored as individual items in Redis LIST for efficient push/pop operations.
 */
export type SessionMessage = {
  /** Message role (user, assistant, system) */
  role: "user" | "assistant" | "system";
  /** Message content */
  content: string;
  /** Timestamp when the message was created */
  timestamp: number;
  /** Token count for this message (if available) */
  tokens?: number;
};

/**
 * Session context stored in Redis for in-session state.
 * Metadata is stored in HASH, messages in LIST for efficiency.
 */
export type SessionContext = {
  /** User ID for this session */
  userId: string;
  /** Session ID (unique per conversation) */
  sessionId: string;
  /** Session key for routing */
  sessionKey: string;
  /** Channel the session originated from */
  channel: string;
  /** Timestamp when the session was created */
  createdAt: number;
  /** Timestamp when the session was last updated */
  updatedAt: number;
  /** Active tools for this session */
  activeTools: string[];
  /** Recent message history (for context window) - stored in Redis LIST */
  recentMessages: SessionMessage[];
  /** Token counts for context management */
  tokenCounts: {
    input: number;
    output: number;
    total: number;
  };
  /** Model being used */
  model?: string;
  /** Provider being used */
  provider?: string;
  /** Custom metadata for the session */
  metadata?: Record<string, unknown>;
};

/**
 * Extended response metadata included in API responses.
 */
export type ResponseMetadata = {
  /** Tools that were used during the request */
  tools_used: string[];
  /** Total context tokens consumed */
  context_tokens: number;
  /** Session ID for continuity */
  session_id: string;
  /** Processing time in milliseconds */
  processing_time_ms: number;
  /** Model used for the response */
  model?: string;
  /** Provider used for the response */
  provider?: string;
};

/**
 * Extended chat completion response that mirrors OpenAI schema with additional metadata.
 */
export type ExtendedChatCompletionResponse = {
  /** Unique response ID */
  id: string;
  /** Object type (always "chat.completion") */
  object: "chat.completion";
  /** Timestamp when the response was created */
  created: number;
  /** Model used */
  model: string;
  /** Response choices */
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }>;
  /** Usage statistics */
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** Extended metadata for tolbot */
  tolbot_metadata: ResponseMetadata;
};

/**
 * Context store interface for abstracting storage backends.
 */
export interface ContextStore {
  /** Get session context by user ID and session key */
  getContext(userId: string, sessionKey?: string): Promise<SessionContext | null>;
  /** Set/update session context */
  setContext(context: SessionContext): Promise<void>;
  /** Delete session context */
  deleteContext(userId: string, sessionKey: string): Promise<boolean>;
  /** Check if a session exists */
  hasContext(userId: string, sessionKey?: string): Promise<boolean>;
  /** Get all sessions for a user */
  getUserSessions(userId: string): Promise<SessionContext[]>;
  /** Close the store connection */
  close(): Promise<void>;

  // Efficient message operations (optional - for Redis LIST optimization)
  /** Push a single message to the session (efficient - no full session read/write) */
  pushMessage?(userId: string, sessionKey: string, message: SessionMessage): Promise<void>;
  /** Get recent messages from session (efficient - only fetches what's needed) */
  getMessages?(userId: string, sessionKey: string, limit?: number): Promise<SessionMessage[]>;
  /** Update only metadata (efficient - no message read/write) */
  updateMetadata?(
    userId: string,
    sessionKey: string,
    updates: Partial<
      Pick<SessionContext, "activeTools" | "tokenCounts" | "model" | "provider" | "metadata">
    >,
  ): Promise<void>;
}
