# Discord Multi-Tenant Bot - How It Works

This document explains the Discord multi-tenant architecture and how to use it.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Components](#components)
3. [Data Flow](#data-flow)
4. [Getting Started](#getting-started)
5. [Testing](#testing)
6. [API Reference](#api-reference)
7. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

The Discord multi-tenant system allows each user to connect their own Discord bot to OpenClaw. Bot credentials are securely stored in Supabase with AES-256-GCM encryption.

```
┌─────────────────┐
│  Discord API    │
└────────┬────────┘
         │
    ┌────▼─────────────────────────────────────────┐
    │         @buape/carbon Client                 │
    │         (per user instance)                  │
    └────────┬─────────────────────────────────────┘
             │
    ┌────────▼────────────────────────────┐
    │     DiscordRegistry                 │
    │  - Manages client instances         │
    │  - Lazy loading                     │
    │  - Auto-reconnect                   │
    └────────┬────────────────────────────┘
             │
    ┌────────▼────────────────────────────┐
    │  handleInboundDiscordMessage        │
    │  - Routes to agent                  │
    │  - Session management               │
    └────────┬────────────────────────────┘
             │
    ┌────────▼────────────────────────────┐
    │      agentCommand                   │
    │  - OpenClaw AI Agent                │
    │  - Uses .pi config                  │
    └────────┬────────────────────────────┘
             │
    ┌────────▼────────────────────────────┐
    │   Response to Discord               │
    └─────────────────────────────────────┘

┌─────────────────────────────────────────┐
│           Supabase                      │
│  ┌───────────────────────────────────┐  │
│  │  discord_credentials table        │  │
│  │  - user_id (UUID, FK)            │  │
│  │  - bot_token (encrypted)         │  │
│  │  - application_id                │  │
│  │  - public_key                    │  │
│  │  - session_data (JSON)           │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

---

## Components

### 1. DiscordCredentialProvider (`src/credentials/discord-credentials.ts`)

Manages Discord bot credentials in Supabase.

**Key Features:**
- AES-256-GCM encryption for bot tokens
- CRUD operations (save, fetch, delete)
- User isolation via RLS policies
- Session data storage

**Methods:**
```typescript
class DiscordCredentialProvider {
  // Save encrypted credentials
  async saveCredentials(
    userId: string,
    botToken: string,
    options?: {
      applicationId?: string;
      publicKey?: string;
      sessionData?: Record<string, any>;
    }
  ): Promise<void>

  // Fetch and decrypt credentials
  async fetchCredentials(userId: string): Promise<DiscordCredentials | null>

  // Delete credentials
  async deleteCredentials(userId: string): Promise<void>

  // List all users with credentials
  async getAllUserIds(): Promise<string[]>
}
```

### 2. DiscordRegistry (`src/discord/discord-registry.ts`)

Manages per-user Discord bot instances.

**Key Features:**
- On-demand client creation (lazy loading)
- @buape/carbon Client with GatewayPlugin
- WebSocket connection management
- Automatic reconnection
- Graceful shutdown

**Methods:**
```typescript
class DiscordRegistry {
  // Get or create client for user
  async getClient(userId: string): Promise<Client>

  // Start gateway listener
  async startGateway(userId: string): Promise<void>

  // Stop and cleanup client
  async stopClient(userId: string): Promise<void>

  // Check if client exists
  hasClient(userId: string): boolean

  // Get client count
  getClientCount(): number

  // Shutdown all clients
  async shutdown(): Promise<void>
}
```

**Gateway Intents:**
```typescript
GatewayIntents.Guilds |
GatewayIntents.GuildMessages |
GatewayIntents.MessageContent |
GatewayIntents.DirectMessages |
GatewayIntents.GuildMessageReactions |
GatewayIntents.DirectMessageReactions
```

### 3. Discord Bot Handler (`src/discord/bot-handler.ts`)

Routes messages to the OpenClaw agent.

**Key Features:**
- Session key generation: `discord:{userId}:{channelId}`
- Integration with `agentCommand`
- Response delivery via Discord REST API
- Error handling

**Function:**
```typescript
async function handleInboundDiscordMessage(
  msg: InboundDiscordMessage,
  client: Client
): Promise<void>
```

**Message Format:**
```typescript
interface InboundDiscordMessage {
  userId: string;           // OpenClaw user ID
  channelId: string;        // Discord channel ID
  messageId: string;        // Discord message ID
  author: {
    id: string;             // Discord user ID
    username?: string;      // Discord username
  };
  content: string;          // Message text
  timestamp: number;        // Unix timestamp
  guildId?: string;         // Guild ID (if in server)
}
```

---

## Data Flow

### 1. User Saves Credentials

```typescript
// User provides bot token
const provider = getDiscordCredentialProvider();
await provider.saveCredentials(userId, botToken, {
  sessionData: { note: "My Discord bot" }
});

// Stored in Supabase:
// {
//   user_id: "291fdea1-...",
//   bot_token: "encrypted_token_here",
//   application_id: "1382652753154936842",
//   session_data: { note: "My Discord bot" }
// }
```

### 2. Bot Starts

```typescript
// Registry fetches credentials
const registry = getDiscordRegistry();
const client = await registry.getClient(userId);

// Process:
// 1. Fetch credentials from Supabase
// 2. Decrypt bot token
// 3. Fetch application ID from Discord API
// 4. Create @buape/carbon Client
// 5. Initialize GatewayPlugin
// 6. Connect to Discord WebSocket
```

### 3. Message Received

```typescript
// Discord sends message via WebSocket
// -> MessageCreateListener.handle()
// -> handleInboundDiscordMessage()

const inboundMessage = {
  userId: "291fdea1-...",
  channelId: "1382651718642302999",
  messageId: "1382664123456789",
  author: { id: "123", username: "user" },
  content: "Hello bot!",
  timestamp: Date.now()
};

// Process:
// 1. Create session key: "discord:291fdea1-...:1382651718642302999"
// 2. Call agentCommand with message
// 3. Agent processes using .pi config
// 4. Extract response from payloads
// 5. Send response via Discord REST API
```

### 4. Response Sent

```typescript
// Agent returns payloads
const payloads = [
  { text: "Hello! How can I help you?" }
];

// Send to Discord
await client.rest.post(`/channels/${channelId}/messages`, {
  body: {
    content: responseText,
    message_reference: { message_id: originalMessageId }
  }
});
```

---

## Getting Started

### Prerequisites

1. **Supabase Setup**
   - Run migration: `migrations/discord-multitenant-schema.sql`
   - Set environment variables:
     ```bash
     SUPABASE_URL=https://your-project.supabase.co
     SUPABASE_ANON_KEY=your-anon-key
     AES_256_KEY=your-32-byte-hex-key
     ```

2. **Discord Bot Setup**
   - Create bot at [Discord Developer Portal](https://discord.com/developers/applications)
   - Enable intents:
     - ✅ Message Content Intent
     - ✅ Guild Members Intent (optional)
   - Copy bot token

### Step 1: Save Credentials

```bash
npx tsx test/discord/manual-save-creds.ts
```

Enter your bot token when prompted. The script will:
- Encrypt the token with AES-256-GCM
- Store in Supabase `discord_credentials` table
- Associate with your user ID

### Step 2: Verify Credentials

```bash
npx tsx test/discord/manual-fetch-creds.ts
```

This retrieves and decrypts your credentials to verify they were saved correctly.

### Step 3: Start Bot

```bash
npx tsx test/discord/test-discord-bot.ts
```

The bot will:
1. Load credentials from Supabase
2. Create Discord client via registry
3. Connect to Discord gateway
4. Start listening for messages
5. Route messages through OpenClaw agent
6. Send AI-generated responses

---

## Testing

### Manual Testing Scripts

#### `manual-save-creds.ts`

Interactive script to save bot credentials.

**Usage:**
```bash
npx tsx test/discord/manual-save-creds.ts
```

**Environment Variables:**
- `TEST_USER_ID` - User ID (defaults to UUID in script)

**What it does:**
1. Prompts for bot token
2. Encrypts token
3. Saves to Supabase
4. Confirms success

#### `manual-fetch-creds.ts`

Verify stored credentials.

**Usage:**
```bash
npx tsx test/discord/manual-fetch-creds.ts
```

**What it does:**
1. Fetches credentials for user
2. Decrypts bot token
3. Displays masked token
4. Shows session data

#### `test-discord-bot.ts`

Full integration test.

**Usage:**
```bash
npx tsx test/discord/test-discord-bot.ts
```

**What it does:**
1. Loads credentials
2. Creates client via registry
3. Connects to Discord gateway
4. Registers message listener
5. Routes messages to agent
6. Sends responses
7. Graceful shutdown on Ctrl+C

**Expected Output:**
```
🤖 Starting Discord Multi-Tenant Bot Test

Using User ID: 291fdea1-f96f-44d1-bc9c-5c2e02c1ee89
✅ Credentials found
   Bot Token: MTM4MjY1Mjc1MzE1NDkz...

📡 Starting Discord gateway...
✅ Discord client created
   Client count: 1
   Bot User ID: 1382652753154936842

✅ Gateway connected and listening

📝 Test the bot:
   1. Send a DM or mention the bot in a server
   2. Send any message - it will be processed by the AI agent!
   3. The agent will use your .pi configuration

   Press Ctrl+C to stop
```

### Integration Testing

1. **Send DM to bot** - Should receive AI response
2. **Send mention in server** - Should respond with agent reply
3. **Check logs** - Verify message flow through handler
4. **Test shutdown** - Ctrl+C should gracefully disconnect

---

## API Reference

### getDiscordCredentialProvider()

Returns singleton instance of `DiscordCredentialProvider`.

```typescript
import { getDiscordCredentialProvider } from "../src/credentials/discord-credentials.js";

const provider = getDiscordCredentialProvider();
```

### getDiscordRegistry()

Returns singleton instance of `DiscordRegistry`.

```typescript
import { getDiscordRegistry } from "../src/discord/discord-registry.js";

const registry = getDiscordRegistry();
const client = await registry.getClient(userId);
```

### handleInboundDiscordMessage()

Processes message through agent.

```typescript
import { handleInboundDiscordMessage } from "../src/discord/bot-handler.js";

await handleInboundDiscordMessage(message, client);
```

---

## Troubleshooting

### Bot Not Responding

**Check:**
1. ✅ Credentials saved? Run `manual-fetch-creds.ts`
2. ✅ Gateway connected? Check console for "Gateway connected"
3. ✅ Bot has permissions? Check Discord channel permissions
4. ✅ Message Content Intent enabled? Check Discord Developer Portal

### "Failed to fetch application ID"

**Solution:**
- Verify bot token is valid
- Check network connectivity
- Ensure token has correct format: `MTxxxxx.xxxxxx.xxxxxx`

### "No Discord credentials found"

**Solution:**
- Run `manual-save-creds.ts` first
- Verify `TEST_USER_ID` matches saved credentials
- Check Supabase credentials table

### Messages Not Reaching Agent

**Check:**
1. ✅ Bot filtering own messages? Should see "⏭️ Skipping own message"
2. ✅ Agent command working? Check for "🤖 Calling AI agent..."
3. ✅ `.pi` config exists? Agent needs configuration

### Gateway Disconnects

**Check:**
- Network stability
- Discord API status
- Auto-reconnect should handle transient errors

---

## Advanced Usage

### Custom Session Data

Store metadata with credentials:

```typescript
await provider.saveCredentials(userId, botToken, {
  sessionData: {
    botName: "MyBot",
    serverId: "123456789",
    features: ["ai", "moderation"]
  }
});
```

### Multiple Users

Each user gets their own bot instance:

```typescript
const user1Client = await registry.getClient("user-1-id");
const user2Client = await registry.getClient("user-2-id");

// Two separate bots, two separate gateway connections
```

### Graceful Shutdown

```typescript
process.on("SIGINT", async () => {
  await registry.shutdown(); // Stops all clients
  process.exit(0);
});
```

---

## Security Notes

1. **Encryption**: Bot tokens encrypted at rest using AES-256-GCM
2. **RLS Policies**: Users can only access their own credentials
3. **Bot Filtering**: Bots automatically skip their own messages
4. **Token Validation**: Tokens validated via Discord API before use
5. **Environment Variables**: Never commit `.env` files

---

## Related Files

- [discord-credentials.ts](file:///Users/aditya/antigravity/tolbot/src/credentials/discord-credentials.ts) - Credential provider
- [discord-registry.ts](file:///Users/aditya/antigravity/tolbot/src/discord/discord-registry.ts) - Client registry
- [bot-handler.ts](file:///Users/aditya/antigravity/tolbot/src/discord/bot-handler.ts) - Agent integration
- [discord-multitenant-schema.sql](file:///Users/aditya/antigravity/tolbot/migrations/discord-multitenant-schema.sql) - Database schema

---

## Next Steps

1. **Production Deployment** - Add to main OpenClaw gateway
2. **Slash Commands** - Register Discord application commands
3. **Mention Detection** - Parse @mentions in guild messages
4. **Rate Limiting** - Add rate limiting per user
5. **Monitoring** - Add metrics and health checks
6. **Unit Tests** - Comprehensive test coverage

---

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review related files and implementation
3. Test with `manual-*` scripts to isolate issues
4. Verify Supabase and Discord setup
