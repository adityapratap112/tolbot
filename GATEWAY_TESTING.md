# Gateway Testing Guide

## Starting the Gateway Server

The gateway server needs to be running before testing. Use one of these commands:

### Development Mode (Recommended for Testing)
```bash
npm run gateway:dev
```

This starts the gateway in development mode with:
- Auto-reload on file changes
- Skips channel initialization (`OPENCLAW_SKIP_CHANNELS=1`)
- Runs on port 3000 (default)

### Production Mode
```bash
npm run gateway:watch
```

## Running Integration Tests

Once the gateway is running in a separate terminal:

```bash
npx tsx test-gateway-integration.ts
```

This will test:
1. ✅ Legacy path (without `user_metadata`)
2. ✅ Multi-tenant path (with `user_metadata`)
3. ✅ WhatsApp message sending via gateway

## Quick Test Commands

### 1. Start Gateway (Terminal 1)
```bash
npm run gateway:dev
```

### 2. Run Integration Test (Terminal 2)
```bash
npx tsx test-gateway-integration.ts
```

### 3. Direct Multi-Tenant Test (No Gateway Required)
```bash
npx tsx test-multitenant-whatsapp.ts
```

## Expected Output

When gateway is running successfully, you should see:
```
🚀 Gateway Integration Tests
============================================================
Gateway URL: http://localhost:3000/v1/chat/completions
Test User ID: 291fdea1-f96f-44d1-bc9c-5c2e02c1ee89
Test Phone: +917007402477

⏳ Checking if gateway is running...
✅ Gateway is responding
```

## Troubleshooting

**Error: `ECONNREFUSED`**
- Gateway is not running
- Solution: Start gateway with `npm run gateway:dev`

**Error: `Missing script: "serve"`**
- Wrong command used
- Solution: Use `npm run gateway:dev` instead

**Error: Authentication failed**
- Check `TOKEN` in `.env` file
- Update `GATEWAY_TOKEN` in test script if needed
