# Multi-Tenant WhatsApp Bot

This module enables multi-tenant WhatsApp functionality with **inbound message handling** and **AI-powered auto-replies**.

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────┐
│  WhatsApp User  │────▶│  ConnectionRegistry  │────▶│  Bot Handler│
└─────────────────┘     └──────────────────────┘     └─────────────┘
                                  │                         │
                                  │                         ▼
                                  │                  ┌─────────────┐
                                  │                  │  AI Agent   │
                                  │                  └─────────────┘
                                  │                         │
                                  ▼                         ▼
                        ┌──────────────────────┐     ┌─────────────┐
                        │  Outbound Sender     │◀────│  Response   │
                        └──────────────────────┘     └─────────────┘
```

## Files Overview

### Core Files (Created/Modified)

| File | Purpose |
|------|---------|
| `connection-registry.ts` | Manages per-user WhatsApp connections with message listeners |
| `bot-handler.ts` | Processes inbound messages through AI agent and sends responses |
| `multitenant-inbound.ts` | Starts/stops message listeners for users |
| `multitenant-outbound.ts` | Sends messages with retry logic |
| `gateway-adapter.ts` | Integrates with the gateway API |
| `index.ts` | Exports all public functions and types |

### Supporting Files

| File | Purpose |
|------|---------|
| `supabase-auth-state.ts` | Manages WhatsApp auth state in Supabase |
| `../credentials/supabase-credentials.ts` | Handles encrypted credential storage |

## How It Works

### 1. Inbound Message Flow

1. **User sends WhatsApp message** → Baileys receives it
2. **ConnectionRegistry** triggers `messages.upsert` event
3. **Bot Handler** processes message through AI agent
4. **Response sent back** via multi-tenant outbound

### 2. Outbound Message Flow

1. **API request** with `user_id` and message
2. **ConnectionRegistry** gets/creates user's connection
3. **Message sent** through user's dedicated WhatsApp socket

## Quick Start

### Prerequisites

```bash
# Required environment variables
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
AES_256_KEY=your-32-byte-hex-key
REDIS_URL=redis://localhost:6379
```

### Testing the Bot

**1. Start the listener:**

```bash
npx tsx test-bot-listener.ts
```

**2. Send a WhatsApp message** to the bot's number

**3. Watch the console** for detailed logs:
```
📨 messages.upsert event received
📩 Processing message...
🔔 INBOUND MESSAGE RECEIVED
🤖 Calling AI agent...
📤 Sending response back to WhatsApp...
✅ Message sent!
```

### Programmatic Usage

```typescript
import { startListenerForUser, startAllListeners } from "./whatsapp";

// Start listener for a specific user
await startListenerForUser("user-uuid-here");

// Or start listeners for all users with credentials
await startAllListeners();
```

### Sending Messages via API

```bash
curl -X POST http://localhost:19001/v1/chat/completions \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "user_metadata": {
      "channel": "whatsapp",
      "user_id": "your-user-uuid"
    }
  }'
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Idle Timeout | 30 min | Connection closes after inactivity |
| Retry Attempts | 3 | Max retries for failed sends |
| Retry Delay | 500ms | Wait between retries |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Connection Closed" on send | Normal - retry logic handles this |
| "No message content" | WhatsApp protocol message, ignore |
| JSON parse errors on startup | Non-JSON keys in Supabase, harmless |
| Slow responses | Check AI agent processing time |

## Key Functions

```typescript
// Start listening for a user's messages
startListenerForUser(userId: string): Promise<void>

// Start listeners for all users
startAllListeners(): Promise<void>

// Send a message through user's connection
sendMultiTenantWhatsApp(opts: {
  userId: string;
  to: string;
  text: string;
}): Promise<MultiTenantSendResult>

// Handle an inbound message
handleInboundMessage(msg: InboundWhatsAppMessage): Promise<void>
```

---

*Last updated: 2026-02-05*
