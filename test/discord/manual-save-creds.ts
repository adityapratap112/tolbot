import { getDiscordCredentialProvider } from "../../src/credentials/discord-credentials.js";
import { createInterface } from "node:readline";

// Needed for loading env vars if not already loaded by runner
import "dotenv/config";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  console.log("=== Save Discord Credentials Manual Test ===");

  const userId = process.env.TEST_USER_ID || "291fdea1-f96f-44d1-bc9c-5c2e02c1ee89";
  console.log(`Using User ID: ${userId}`);

  rl.question("Enter Discord Bot Token: ", async (token) => {
    rl.close();

    if (!token) {
      console.error("Token is required!");
      process.exit(1);
    }

    try {
      const provider = getDiscordCredentialProvider();
      await provider.saveCredentials(userId, token.trim(), {
        sessionData: { note: "Created via manual test script" },
      });
      console.log("✅ Successfully encrypted and saved credentials to Supabase!");
    } catch (error) {
      console.error("❌ Failed to save credentials:", error);
    }
  });
}

main();
