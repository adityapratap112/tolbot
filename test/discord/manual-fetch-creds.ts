import { getDiscordCredentialProvider } from "../../src/credentials/discord-credentials.js";

// Needed for loading env vars if not already loaded by runner
import "dotenv/config";

async function main() {
  console.log("=== Fetch Discord Credentials Manual Test ===");

  const userId = process.env.TEST_USER_ID || "291fdea1-f96f-44d1-bc9c-5c2e02c1ee89";
  console.log(`Fetching credentials for User ID: ${userId}`);

  try {
    const provider = getDiscordCredentialProvider();
    const creds = await provider.fetchCredentials(userId);

    if (creds) {
      console.log("✅ Successfully fetched and decrypted credentials!");
      console.log("User ID:", creds.userId);
      console.log("Bot Token:", creds.botToken.substring(0, 10) + "..."); // Masked for safety
      console.log("Session Data:", creds.sessionData);
    } else {
      console.log("⚠️ No credentials found for this user.");
    }
  } catch (error) {
    console.error("❌ Failed to fetch credentials:", error);
  }
}

main();
