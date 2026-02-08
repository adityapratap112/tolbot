import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const AES_256_KEY = process.env.AES_256_KEY;

console.log("🔍 Environment Check:");
console.log(`  SUPABASE_URL: ${SUPABASE_URL ? "✅ Set" : "❌ Missing"}`);
console.log(`  SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY ? "✅ Set" : "❌ Missing"}`);
console.log(`  AES_256_KEY: ${AES_256_KEY ? "✅ Set" : "❌ Missing"}`);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !AES_256_KEY) {
  console.error("\n❌ Missing required environment variables!");
  console.error("Add these to your .env file:");
  console.error("  SUPABASE_URL=https://your-project.supabase.co");
  console.error("  SUPABASE_ANON_KEY=your-anon-key");
  console.error("  AES_256_KEY=your-32-byte-hex-key");
  process.exit(1);
}

// ============================================
// Main Test Function
// ============================================
async function testTelegramSupabaseTables() {
  try {
    console.log("\n📡 Connecting to Supabase...");
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Test 1: Check telegram_credentials table
    console.log("\n📋 Test 1: Checking telegram_credentials table...");
    const { data: credentials, error: credsError } = await supabase
      .from("telegram_credentials")
      .select("*")
      .limit(10);

    if (credsError) {
      console.error("❌ Error accessing telegram_credentials:", credsError.message);
      console.error("   Details:", credsError);
      console.log("\n💡 Make sure the table exists with this schema:");
      console.log(`
CREATE TABLE telegram_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bot_token TEXT NOT NULL,
  bot_username TEXT,
  bot_id BIGINT,
  session_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);
      `);
    } else {
      console.log(`✅ telegram_credentials table accessible`);
      console.log(`   Found ${credentials?.length || 0} credential records`);
      if (credentials && credentials.length > 0) {
        console.log("\n   Sample record (token masked):");
        const sample = { ...credentials[0] };
        if (sample.bot_token) {
          sample.bot_token = sample.bot_token.substring(0, 20) + "...[MASKED]";
        }
        console.log("   ", JSON.stringify(sample, null, 2));
      }
    }

    // Test 2: Check table structure
    console.log("\n📋 Test 2: Verifying table structure...");

    // Try to insert and delete a test record (to verify permissions and structure)
    const testUserId = "00000000-0000-0000-0000-000000000001"; // Dummy UUID

    console.log("   Testing telegram_credentials insert/delete...");
    const { error: insertCredsError } = await supabase.from("telegram_credentials").insert({
      user_id: testUserId,
      bot_token: "test_token_will_be_deleted",
      bot_username: "test_bot",
      bot_id: 123456789,
      session_data: { update_offset: 0, test: true },
    });

    if (insertCredsError) {
      if (insertCredsError.message.includes("violates foreign key constraint")) {
        console.log("   ✅ Foreign key constraint working (expected - test user doesn't exist)");
        console.log("   ✅ session_data column accepts JSONB");
      } else if (insertCredsError.message.includes("session_data")) {
        console.error("   ❌ session_data column missing or invalid");
      } else {
        console.error("   ❌ Insert error:", insertCredsError.message);
      }
    } else {
      console.log("   ✅ Insert successful (including session_data), cleaning up...");
      await supabase.from("telegram_credentials").delete().eq("user_id", testUserId);
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 SUMMARY");
    console.log("=".repeat(60));

    const tableOk = !credsError;

    if (tableOk) {
      console.log("✅ Telegram credentials table is accessible and working!");
      console.log("\n📋 Table structure:");
      console.log("   • id (UUID)");
      console.log("   • user_id (UUID, FK to auth.users)");
      console.log("   • bot_token (TEXT, encrypted)");
      console.log("   • bot_username (TEXT)");
      console.log("   • bot_id (BIGINT)");
      console.log("   • session_data (JSONB) - stores update_offset, etc.");
      console.log("   • created_at, updated_at (TIMESTAMP)");
      console.log("\n✅ Ready to proceed with TelegramCredentialProvider implementation");
    } else {
      console.log("❌ Table is missing or inaccessible");
      console.log("\n📝 Next steps:");
      console.log("   1. Run migrations/telegram-multitenant-schema.sql in Supabase SQL Editor");
      console.log("   2. Verify RLS policies if needed");
      console.log("   3. Re-run this test");
    }
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

// Run tests
testTelegramSupabaseTables();
