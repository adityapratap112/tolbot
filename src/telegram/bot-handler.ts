/**
 * Bot handler for multi-tenant Telegram.
 * Processes inbound messages through the AI agent and sends responses.
 */

import type { InboundTelegramMessage } from "./telegram-registry.js";
import { sendMultiTenantTelegram } from "./multitenant-outbound.js";
import { getChildLogger } from "../logging.js";
import { agentCommand } from "../commands/agent.js";
import { createDefaultDeps } from "../cli/deps.js";
import { defaultRuntime } from "../runtime.js";

const logger = getChildLogger({ module: "tg-bot-handler" });

/**
 * Handle an inbound Telegram message by processing it through the AI agent
 * and sending the response back.
 *
 * @param msg - Inbound message from Telegram
 */
export async function handleInboundTelegramMessage(msg: InboundTelegramMessage): Promise<void> {
  console.log("\n🔔 INBOUND TELEGRAM MESSAGE RECEIVED");
  console.log(`   User ID: ${msg.userId}`);
  console.log(`   Chat ID: ${msg.chatId}`);
  console.log(
    `   From: ${msg.from.firstName} ${msg.from.lastName || ""} (@${msg.from.username || "N/A"})`,
  );
  console.log(`   Text: "${msg.text}"`);
  console.log(`   Is Group: ${msg.isGroup}`);

  try {
    logger.info(
      { chatId: msg.chatId, text: msg.text.substring(0, 50) },
      "Processing inbound message",
    );

    // Skip group messages for now (can be enabled later with mention detection)
    if (msg.isGroup) {
      console.log("   ⏭️  Skipping group message");
      logger.debug({ chatId: msg.chatId }, "Skipping group message");
      return;
    }

    console.log("   📝 Creating session for conversation...");

    // Create session key for conversation continuity
    const sessionKey = `telegram:${msg.userId}:${msg.chatId}`;
    const runId = `tg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    console.log("   Session Key:", sessionKey);
    console.log("   Run ID:", runId);
    console.log("\n   🤖 Calling AI agent...");

    // Call agent to process message
    const result = await agentCommand(
      {
        message: msg.text,
        sessionKey,
        runId,
        deliver: false,
        messageChannel: "telegram",
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

    console.log("\n   📤 Sending response back to Telegram...");

    // Send response back through multi-tenant outbound
    const sendResult = await sendMultiTenantTelegram({
      userId: msg.userId,
      chatId: msg.chatId,
      text: responseText,
      replyTo: msg.messageId,
    });

    if (sendResult.ok) {
      console.log("   ✅ Response sent successfully!");
      console.log("   Message ID:", sendResult.messageId);
      logger.info(
        { messageId: sendResult.messageId, chatId: msg.chatId },
        "Response sent successfully",
      );
    } else {
      console.log("   ❌ Failed to send response");
      console.log("   Error:", sendResult.error);
      logger.error({ error: sendResult.error, chatId: msg.chatId }, "Failed to send response");
    }
  } catch (err) {
    console.log("\n   ❌ ERROR in handleInboundTelegramMessage:");
    console.log("   ", err);
    logger.error({ error: String(err), chatId: msg.chatId }, "Error handling inbound message");
  }
}
