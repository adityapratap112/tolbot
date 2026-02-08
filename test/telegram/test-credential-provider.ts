import { getTelegramCredentialProvider } from "../../src/credentials/telegram-credentials.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function testTelegramCredentialProvider() {
  console.log("🧪 Testing TelegramCredentialProvider\n");

  try {
    // Get provider instance
    const provider = getTelegramCredentialProvider();
    console.log("✅ Provider instance created\n");

    // Test user ID (use a real UUID from your Supabase auth.users table for full test)
    const testUserId = "00000000-0000-0000-0000-000000000001";
    const testBotToken = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"; // Fake token for testing

    // Test 1: Check if credentials exist (should be false initially)
    console.log("📋 Test 1: Check if credentials exist...");
    const exists = await provider.hasCredentials(testUserId);
    console.log(`   Result: ${exists ? "✅ Exists" : "❌ Does not exist"}\n`);

    // Test 2: Save credentials
    console.log("📋 Test 2: Save credentials...");
    try {
      await provider.saveCredentials(testUserId, testBotToken, {
        botUsername: "test_bot",
        botId: 123456789,
        sessionData: { update_offset: 0, test: true },
      });
      console.log("   ✅ Credentials saved\n");
    } catch (error: any) {
      if (error.message.includes("violates foreign key constraint")) {
        console.log(
          "   ⚠️  Foreign key constraint (expected - test user doesn't exist in auth.users)",
        );
        console.log(
          "   💡 To fully test, use a real user_id from your Supabase auth.users table\n",
        );
      } else {
        throw error;
      }
    }

    // Test 3: Fetch credentials
    console.log("📋 Test 3: Fetch credentials...");
    const creds = await provider.fetchCredentials(testUserId);
    if (creds) {
      console.log("   ✅ Credentials fetched");
      console.log("   Bot Token (first 20 chars):", creds.botToken.substring(0, 20) + "...");
      console.log("   Bot Username:", creds.botUsername);
      console.log("   Bot ID:", creds.botId);
      console.log("   Session Data:", JSON.stringify(creds.sessionData, null, 2));
    } else {
      console.log("   ❌ No credentials found\n");
    }

    // Test 4: Update session data
    console.log("\n📋 Test 4: Update session data...");
    try {
      await provider.updateSessionData(testUserId, {
        update_offset: 100,
        last_message_id: 42,
      });
      console.log("   ✅ Session data updated\n");
    } catch (error: any) {
      console.log("   ⚠️  Could not update (user may not exist)\n");
    }

    // Test 5: Get all user IDs
    console.log("📋 Test 5: Get all user IDs...");
    const userIds = await provider.getAllUserIds();
    console.log(`   ✅ Found ${userIds.length} users with Telegram credentials`);
    if (userIds.length > 0) {
      console.log("   Sample user IDs:", userIds.slice(0, 3));
    }

    // Test 6: Delete credentials (cleanup)
    console.log("\n📋 Test 6: Delete credentials (cleanup)...");
    try {
      await provider.deleteCredentials(testUserId);
      console.log("   ✅ Credentials deleted\n");
    } catch (error) {
      console.log("   ⚠️  Could not delete (may not exist)\n");
    }

    console.log("=".repeat(60));
    console.log("✅ All tests completed!");
    console.log("=".repeat(60));
    console.log("\n💡 To test with real data:");
    console.log("   1. Get a user_id from your Supabase auth.users table");
    console.log("   2. Get a real bot token from @BotFather");
    console.log("   3. Replace testUserId and testBotToken in this file");
    console.log("   4. Re-run the test\n");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

// Run tests
testTelegramCredentialProvider();
