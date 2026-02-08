/**
 * Test listener for multi-tenant Telegram bot.
 * Starts listening for messages and logs them.
 */

import { startListenerForUser } from "../../src/telegram/multitenant-inbound.js";
import { handleInboundTelegramMessage } from "../../src/telegram/bot-handler.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// User ID with saved credentials
const USER_ID = "291fdea1-f96f-44d1-bc9c-5c2e02c1ee89";

async function startTelegramBotListener() {
  console.log("🤖 Starting Telegram Bot Listener\n");
  console.log("=".repeat(60));
  console.log(`User ID: ${USER_ID}`);
  console.log("=".repeat(60));

  try {
    console.log("\n📡 Starting listener...");

    // Start listening with message handler
    await startListenerForUser(USER_ID, handleInboundTelegramMessage);

    console.log("✅ Listener started successfully!");
    console.log("\n📨 Waiting for messages...");
    console.log("   Send a message to your bot on Telegram to test!");
    console.log("\n   Press Ctrl+C to stop.\n");

    // Keep the process running
    process.on("SIGINT", async () => {
      console.log("\n\n🛑 Stopping listener...");
      const { stopListenerForUser } = await import("../../src/telegram/multitenant-inbound.js");
      await stopListenerForUser(USER_ID);
      console.log("✅ Listener stopped");
      process.exit(0);
    });
  } catch (error) {
    console.error("\n❌ Failed to start listener:", error);
    process.exit(1);
  }
}

// Run the listener
startTelegramBotListener();
