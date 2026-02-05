/**
 * Test script for multi-tenant WhatsApp inbound message handling with detailed logging.
 */

import "dotenv/config";
import { startListenerForUser } from "./src/whatsapp/multitenant-inbound.js";

const TEST_USER_ID = "291fdea1-f96f-44d1-bc9c-5c2e02c1ee89";

async function main() {
    console.log("\n🤖 Starting Multi-Tenant WhatsApp Bot Listener (DEBUG MODE)");
    console.log("============================================================\n");

    console.log(`📡 Starting listener for user: ${TEST_USER_ID}`);
    console.log("   The bot will now respond to incoming WhatsApp messages");
    console.log("   🔍 DEBUG LOGGING ENABLED - All events will be logged\n");

    try {
        await startListenerForUser(TEST_USER_ID);

        console.log("\n✅ Listener started successfully!");
        console.log("\n📱 Send a WhatsApp message to the bot number to test");
        console.log("   Watch the console for detailed logs of message processing\n");
        console.log("Press Ctrl+C to stop the listener\n");
        console.log("============================================================");
        console.log("WAITING FOR MESSAGES...");
        console.log("============================================================\n");

        // Keep the process running
        await new Promise(() => { });
    } catch (err) {
        console.error("\n❌ Failed to start listener:");
        console.error(err);
        process.exit(1);
    }
}

main();
