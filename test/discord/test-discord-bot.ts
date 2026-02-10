/**
 * Test script to start a Discord bot using credentials from Supabase.
 * This demonstrates the multi-tenant Discord bot working end-to-end.
 */

import { getDiscordRegistry } from "../../src/discord/discord-registry.js";
import { getDiscordCredentialProvider } from "../../src/credentials/discord-credentials.js";
import { MessageCreateListener } from "@buape/carbon";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function main() {
  console.log("🤖 Starting Discord Multi-Tenant Bot Test\n");

  const userId = process.env.TEST_USER_ID || "291fdea1-f96f-44d1-bc9c-5c2e02c1ee89";
  console.log(`Using User ID: ${userId}`);

  try {
    // Verify credentials exist
    const credProvider = getDiscordCredentialProvider();
    const creds = await credProvider.fetchCredentials(userId);

    if (!creds) {
      console.error("❌ No credentials found for this user.");
      console.log("\nRun manual-save-creds.ts first to save credentials.");
      process.exit(1);
    }

    console.log("✅ Credentials found");
    console.log(`   Bot Token: ${creds.botToken.substring(0, 20)}...`);

    // Create Discord registry and get client
    console.log("\n📡 Starting Discord gateway...");
    const registry = getDiscordRegistry();
    const client = await registry.getClient(userId);

    console.log("✅ Discord client created");
    console.log(`   Client count: ${registry.getClientCount()}`);

    // Fetch bot user to get bot ID for filtering own messages
    let botUserId: string | undefined;
    try {
      const botUser = await client.fetchUser("@me");
      botUserId = botUser?.id;
      console.log(`   Bot User ID: ${botUserId}`);
    } catch (error) {
      console.warn("   ⚠️  Could not fetch bot user ID, may not filter own messages correctly");
    }

    // Register a message listener that uses the agent handler
    const { handleInboundDiscordMessage } = await import("../../src/discord/bot-handler.js");

    class AgentMessageListener extends MessageCreateListener {
      async handle(data: any) {
        console.log("\n📨 Message received:");
        console.log(`   Channel: ${data.message?.channelId}`);
        console.log(`   Author: ${data.author?.username || data.author?.id}`);
        console.log(`   Content: ${data.message?.content || "(no content)"}`);

        // Skip messages from the bot itself
        if (botUserId && data.author?.id === botUserId) {
          console.log("   ⏭️  Skipping own message");
          return;
        }

        // Skip messages without content
        if (!data.message?.content) {
          console.log("   ⏭️  Skipping message without content");
          return;
        }

        // Prepare inbound message for agent handler
        const inboundMessage = {
          userId,
          channelId: data.message.channelId,
          messageId: data.message.id,
          author: {
            id: data.author?.id || "unknown",
            username: data.author?.username,
          },
          content: data.message.content,
          timestamp: Date.now(),
          guildId: data.guildId,
        };

        // Process through agent handler
        await handleInboundDiscordMessage(inboundMessage, client);
      }
    }

    // Register listener
    client.listeners.push(new AgentMessageListener());

    console.log("\n✅ Gateway connected and listening");
    console.log("\n📝 Test the bot:");
    console.log("   1. Send a DM or mention the bot in a server");
    console.log("   2. Send any message - it will be processed by the AI agent!");
    console.log("   3. The agent will use your .pi configuration\n");
    console.log("\n   Press Ctrl+C to stop\n");

    // Keep process alive
    process.on("SIGINT", async () => {
      console.log("\n\n🛑 Shutting down...");
      await registry.shutdown();
      console.log("👋 Goodbye!");
      process.exit(0);
    });

    // Wait forever
    await new Promise(() => {});
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();
