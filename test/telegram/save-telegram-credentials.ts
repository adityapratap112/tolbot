/**
 * Save Telegram bot credentials to Supabase.
 * This script allows you to register a bot token and see it being encrypted and stored.
 */

import { Bot } from "grammy";
import { getTelegramCredentialProvider } from "../../src/credentials/telegram-credentials.js";
import dotenv from "dotenv";
import readline from "readline";

// Load environment variables
dotenv.config();

// User ID to use for this test
const USER_ID = "291fdea1-f96f-44d1-bc9c-5c2e02c1ee89";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function saveTelegramCredentials() {
  console.log("🤖 Telegram Bot Credential Setup\n");
  console.log("=".repeat(60));
  console.log(`User ID: ${USER_ID}`);
  console.log("=".repeat(60));

  try {
    // Step 1: Get bot token from user
    console.log("\n📝 Step 1: Enter your bot token");
    console.log("   (Get one from @BotFather on Telegram)");
    const botToken = await question("\n   Bot Token: ");

    if (!botToken || botToken.trim().length === 0) {
      console.error("\n❌ Bot token is required!");
      rl.close();
      process.exit(1);
    }

    // Step 2: Validate token by fetching bot info
    console.log("\n🔍 Step 2: Validating bot token...");
    let botInfo;
    try {
      const bot = new Bot(botToken.trim());
      botInfo = await bot.api.getMe();
      console.log("   ✅ Token is valid!");
      console.log(`   Bot Username: @${botInfo.username}`);
      console.log(`   Bot Name: ${botInfo.first_name}`);
      console.log(`   Bot ID: ${botInfo.id}`);
    } catch (error: any) {
      console.error("\n❌ Invalid bot token!");
      console.error(`   Error: ${error.message}`);
      rl.close();
      process.exit(1);
    }

    // Step 3: Save to Supabase
    console.log("\n💾 Step 3: Saving credentials to Supabase...");
    const credProvider = getTelegramCredentialProvider();

    await credProvider.saveCredentials(USER_ID, botToken.trim(), {
      botUsername: botInfo.username,
      botId: botInfo.id,
      sessionData: {
        update_offset: 0,
        registered_at: new Date().toISOString(),
      },
    });

    console.log("   ✅ Credentials saved successfully!");
    console.log("\n   The bot token has been:");
    console.log("   • Encrypted using AES-256-GCM");
    console.log("   • Stored in Supabase telegram_credentials table");
    console.log("   • Associated with your user ID");

    // Step 4: Verify by fetching
    console.log("\n🔍 Step 4: Verifying saved credentials...");
    const fetchedCreds = await credProvider.fetchCredentials(USER_ID);

    if (fetchedCreds) {
      console.log("   ✅ Credentials fetched and decrypted successfully!");
      console.log("\n   Fetched data:");
      console.log(`   • User ID: ${fetchedCreds.userId}`);
      console.log(`   • Bot Username: @${fetchedCreds.botUsername}`);
      console.log(`   • Bot ID: ${fetchedCreds.botId}`);
      console.log(`   • Bot Token (first 20 chars): ${fetchedCreds.botToken.substring(0, 20)}...`);
      console.log(`   • Session Data:`, JSON.stringify(fetchedCreds.sessionData, null, 2));
    } else {
      console.error("   ❌ Failed to fetch credentials!");
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("✅ SETUP COMPLETE!");
    console.log("=".repeat(60));
    console.log("\n📊 What happened:");
    console.log("   1. ✅ Bot token validated with Telegram API");
    console.log("   2. ✅ Token encrypted with AES-256-GCM");
    console.log("   3. ✅ Saved to Supabase (telegram_credentials table)");
    console.log("   4. ✅ Verified by fetching and decrypting");

    console.log("\n🎉 Your bot is now registered!");
    console.log("\n📝 Next steps:");
    console.log("   1. Run the multi-tenant test:");
    console.log("      npx tsx test/telegram/test-multitenant-telegram.ts");
    console.log("\n   2. Start the bot listener:");
    console.log("      (Create a listener script or integrate with your app)");
    console.log("\n   3. Send a message to your bot on Telegram");
    console.log("      and watch it appear in the logs!\n");

    rl.close();
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    if (error.message.includes("violates foreign key constraint")) {
      console.error("\n💡 The user_id doesn't exist in auth.users table.");
      console.error("   You need to create a user in Supabase first, or use an existing user_id.");
    }
    rl.close();
    process.exit(1);
  }
}

// Run the script
console.log("\n");
saveTelegramCredentials();
