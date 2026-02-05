/**
 * Bot handler for processing inbound WhatsApp messages with AI agent.
 */

import { agentCommand } from "../commands/agent.js";
import { createDefaultDeps } from "../cli/deps.js";
import { defaultRuntime } from "../runtime.js";
import { sendMultiTenantWhatsApp } from "./multitenant-outbound.js";
import type { InboundWhatsAppMessage } from "./connection-registry.js";
import { getChildLogger } from "../logging.js";

const logger = getChildLogger({ module: "wa-bot-handler" });

/**
 * Handle an inbound WhatsApp message by processing it through the AI agent
 * and sending the response back.
 */
export async function handleInboundMessage(msg: InboundWhatsAppMessage): Promise<void> {
  console.log("\n🔔 INBOUND MESSAGE RECEIVED");
  console.log("   From:", msg.from);
  console.log("   Body:", msg.body);
  console.log("   Is Group:", msg.isGroup);
  console.log("   User ID:", msg.userId);
  console.log("   Timestamp:", new Date(msg.timestamp || Date.now()).toISOString());

  try {
    logger.info({ from: msg.from, body: msg.body.substring(0, 50) }, "Processing inbound message");

    // Skip group messages for now (can be enabled later with mention detection)
    if (msg.isGroup) {
      console.log("   ⏭️  Skipping group message");
      logger.debug({ from: msg.from }, "Skipping group message");
      return;
    }

    console.log("   📝 Creating session for conversation...");

    // Create session key for conversation continuity
    const sessionKey = `whatsapp:${msg.userId}:${msg.from}`;
    const runId = `wa_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    console.log("   Session Key:", sessionKey);
    console.log("   Run ID:", runId);
    console.log("\n   🤖 Calling AI agent...");

    // Call agent to process message
    const result = await agentCommand(
      {
        message: msg.body,
        sessionKey,
        runId,
        deliver: false,
        messageChannel: "whatsapp",
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

    console.log("\n   📤 Sending response back to WhatsApp...");

    // Send response back via multi-tenant outbound
    const sendResult = await sendMultiTenantWhatsApp({
      userId: msg.userId,
      to: msg.from,
      text: responseText,
    });

    if (sendResult.ok) {
      console.log("   ✅ Response sent successfully!");
      console.log("   Message ID:", sendResult.messageId);
      logger.info({ messageId: sendResult.messageId, to: msg.from }, "Response sent successfully");
    } else {
      console.log("   ❌ Failed to send response");
      console.log("   Error:", sendResult.error);
      logger.error({ error: sendResult.error, to: msg.from }, "Failed to send response");
    }
  } catch (err) {
    console.log("\n   ❌ ERROR in handleInboundMessage:");
    console.log("   ", err);
    logger.error({ error: String(err), from: msg.from }, "Error handling inbound message");
  }
}
