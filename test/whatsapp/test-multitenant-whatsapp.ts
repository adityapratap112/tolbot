/**
 * Test script for multi-tenant WhatsApp implementation.
 * Tests credential fetching, caching, and connection management.
 */

import dotenv from "dotenv";
import {
  getSupabaseCredentialProvider,
  getCredentialCache,
  setCredentialCache,
  CredentialCache,
} from "../../src/credentials/index.js";
import {
  getConnectionRegistry,
  setConnectionRegistry,
  ConnectionRegistry,
  sendMultiTenantWhatsApp,
} from "../../src/whatsapp/index.js";

// Load environment variables
dotenv.config();

const TEST_USER_ID = process.env.TEST_USER_ID || "291fdea1-f96f-44d1-bc9c-5c2e02c1ee89";
const TEST_PHONE = process.env.TEST_PHONE || "+917007402477"; // Phone to send test message to

async function testCredentialFetching() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: Credential Fetching from Supabase");
  console.log("=".repeat(60));

  const provider = getSupabaseCredentialProvider();

  try {
    console.log(`\n📡 Fetching credentials for user: ${TEST_USER_ID}`);
    const creds = await provider.fetchCredentials(TEST_USER_ID);

    if (!creds) {
      console.error("❌ No credentials found for user");
      return false;
    }

    console.log("✅ Credentials fetched successfully");
    console.log(`   User ID: ${creds.userId}`);
    console.log(`   Fetched at: ${new Date(creds.fetchedAt).toISOString()}`);
    console.log(`   Creds fields: ${Object.keys(creds.creds).length}`);
    console.log(`   Signal keys: ${creds.keys.size} types`);

    return true;
  } catch (err) {
    console.error("❌ Error fetching credentials:", err);
    return false;
  }
}

async function testCredentialCaching() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: Credential Caching with Redis");
  console.log("=".repeat(60));

  const cache = getCredentialCache();
  const provider = getSupabaseCredentialProvider();

  try {
    // Clear cache first
    console.log("\n🗑️  Invalidating cache for user");
    await cache.invalidate(TEST_USER_ID);

    // First fetch (cache miss)
    console.log("\n📡 First fetch (should hit Supabase)");
    const start1 = Date.now();
    const creds1 = await cache.getOrFetch(TEST_USER_ID, provider);
    const time1 = Date.now() - start1;
    console.log(`   ⏱️  Time: ${time1}ms`);

    // Second fetch (cache hit)
    console.log("\n📡 Second fetch (should hit cache)");
    const start2 = Date.now();
    const creds2 = await cache.getOrFetch(TEST_USER_ID, provider);
    const time2 = Date.now() - start2;
    console.log(`   ⏱️  Time: ${time2}ms`);

    if (time2 < time1 || time2 < 50) {
      console.log(`\n✅ Cache working! Second fetch was ${time1 - time2}ms faster`);
      return true;
    } else {
      console.log("\n⚠️  Cache may not be working");
      return false;
    }
  } catch (err) {
    console.error("❌ Error testing cache:", err);
    return false;
  }
}

async function testConnectionRegistry() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: Connection Registry");
  console.log("=".repeat(60));

  const registry = getConnectionRegistry();

  try {
    console.log(`\n📡 Creating connection for user: ${TEST_USER_ID}`);
    const socket = await registry.getConnection(TEST_USER_ID);

    console.log("✅ Connection object obtained");
    console.log(`   Connection count: ${registry.getConnectionCount()}`);

    // Wait for connection to establish
    console.log("\n⏳ Waiting for connection to establish (max 30s)...");

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 30000);

      socket.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        console.log(`   📡 Connection update: ${connection}`);

        if (lastDisconnect) {
          const reason = (lastDisconnect.error as any)?.output?.statusCode;
          const message = lastDisconnect.error?.message;
          console.log(`   🔸 Disconnect Status Code: ${reason}`);
          console.log(`   🔸 Disconnect Message: ${message}`);
        }

        if (connection === "open") {
          clearTimeout(timeout);
          console.log("✅ Connection established!");
          resolve();
        }

        if (connection === "close") {
          const reason = (lastDisconnect?.error as any)?.output?.statusCode;
          // Reasons like 408 (timeout) or 503 (service unavailable) might be retried by Baileys
          if (reason !== 408 && reason !== 503) {
            clearTimeout(timeout);
            reject(new Error(`Connection closed with status: ${reason}`));
          } else {
            console.log("   📡 Temporary disconnect, waiting for retry...");
          }
        }
      });
    });

    console.log(`   Has connection check: ${registry.hasConnection(TEST_USER_ID)}`);
    return true;
  } catch (err) {
    console.error("❌ Error testing connection:", err);
    return false;
  }
}

async function testMessageSending() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 4: Message Sending");
  console.log("=".repeat(60));

  try {
    console.log(`\n📤 Sending test message to: ${TEST_PHONE}`);

    const result = await sendMultiTenantWhatsApp({
      userId: TEST_USER_ID,
      to: TEST_PHONE,
      text: "🤖 Test message from multi-tenant WhatsApp bot created by daddy PRATAP!",
    });

    if (result.ok) {
      console.log("✅ Message sent successfully!");
      console.log(`   Message ID: ${result.messageId}`);
      return true;
    } else {
      console.error("❌ Failed to send message:", result.error);
      return false;
    }
  } catch (err) {
    console.error("❌ Error sending message:", err);
    return false;
  }
}

async function runTests() {
  console.log("\n🚀 Starting Multi-Tenant WhatsApp Tests");
  console.log("=".repeat(60));

  const results = {
    fetching: false,
    caching: false,
    connection: false,
    message: false,
  };

  results.fetching = await testCredentialFetching();
  if (results.fetching) results.caching = await testCredentialCaching();
  if (results.fetching) results.connection = await testConnectionRegistry();
  if (results.connection) results.message = await testMessageSending();

  console.log("\n" + "=".repeat(60));
  console.log("FINAL SUMMARY");
  console.log("=".repeat(60));
  console.log(`1. Credential Fetching: ${results.fetching ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`2. Credential Caching:  ${results.caching ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`3. Connection Registry: ${results.connection ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`4. Message Sending:     ${results.message ? "✅ PASS" : "❌ FAIL"}`);

  // Cleanup
  console.log("\n🧹 Cleaning up...");
  try {
    const registry = getConnectionRegistry();
    await registry.shutdown();
    const cache = getCredentialCache();
    await cache.close();
  } catch (err) {
    console.log("   (Cleanup had some issues, likely due to closed connections)");
  }

  process.exit(Object.values(results).every((r) => r) ? 0 : 1);
}

runTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
