/**
 * Bot handler for multi-tenant Discord.
 * Processes inbound messages through the AI agent and sends responses.
 */

import { agentCommand } from "../commands/agent.js";
import { createDefaultDeps } from "../cli/deps.js";
import { defaultRuntime } from "../runtime.js";
import { getChildLogger } from "../logging.js";
import type { Client } from "@buape/carbon";

const logger = getChildLogger({ module: "discord-bot-handler" });

/**
 * Inbound message from Discord.
 */
export interface InboundDiscordMessage {
  userId: string;
  channelId: string;
  messageId: string;
  author: {
    id: string;
    username?: string;
  };
  content: string;
  timestamp: number;
  guildId?: string;
}

/**
 * Handle an inbound Discord message by processing it through the AI agent
 * and sending the response back.
 *
 * @param msg - Inbound message from Discord
 * @param client - Discord client for sending responses
 */
export async function handleInboundDiscordMessage(
  msg: InboundDiscordMessage,
  client: Client,
): Promise<void> {
  console.log("\n🔔 INBOUND DISCORD MESSAGE RECEIVED");
  console.log(`   User ID: ${msg.userId}`);
  console.log(`   Channel ID: ${msg.channelId}`);
  console.log(`   Author: ${msg.author.username || msg.author.id}`);
  console.log(`   Content: "${msg.content}"`);

  try {
    logger.info(
      { channelId: msg.channelId, content: msg.content.substring(0, 50) },
      "Processing inbound message",
    );

    console.log("   📝 Creating session for conversation...");

    // Create session key for conversation continuity
    const sessionKey = `discord:${msg.userId}:${msg.channelId}`;
    const runId = `dc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    console.log("   Session Key:", sessionKey);
    console.log("   Run ID:", runId);
    console.log("\n   🤖 Calling AI agent...");

    // Call agent to process message
    const result = await agentCommand(
      {
        message: msg.content,
        sessionKey,
        runId,
        deliver: false,
        messageChannel: "discord",
        bestEffortDeliver: false,
      },
      defaultRuntime,
      createDefaultDeps(),
    );

    console.log("   ✅ Agent responded");
    console.log("   Result type:", typeof result);
    console.log("   Result keys:", result ? Object.keys(result) : "null");

    // Extract response text from agent result
    const payloads = (result as { payloads?: Array<{ text?: string }> } | null)?.payloads;
    console.log("   Payloads:", payloads ? `${payloads.length} items` : "none");

    const responseText =
      Array.isArray(payloads) && payloads.length > 0
        ? payloads
            .map((p) => p.text)
            .filter(Boolean)
            .join("\n\n")
        : "I received your message but couldn't generate a response.";

    console.log("   Response text length:", responseText.length);
    console.log("   Response preview:", responseText.substring(0, 100));

    if (!responseText) {
      console.log("   ⚠️  No response text generated");
      logger.warn({ sessionKey }, "Agent returned no response");
      return;
    }

    console.log("\n   📤 Sending response back to Discord...");

    // Send response back through Discord client
    const response = await client.rest.post(`/channels/${msg.channelId}/messages`, {
      body: {
        content: responseText,
        message_reference: {
          message_id: msg.messageId,
        },
      },
    });

    console.log("   ✅ Response sent successfully!");
    console.log("   Message ID:", (response as any)?.id);
    logger.info(
      { messageId: (response as any)?.id, channelId: msg.channelId },
      "Response sent successfully",
    );
  } catch (err) {
    console.log("\n   ❌ ERROR in handleInboundDiscordMessage:");
    console.log("   ", err);
    logger.error(
      { error: String(err), channelId: msg.channelId },
      "Error handling inbound message",
    );
  }
}
