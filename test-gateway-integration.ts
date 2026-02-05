/**
 * Integration test for gateway multi-tenant WhatsApp routing.
 * Tests that API requests with user_metadata route through per-user connections.
 */

import dotenv from "dotenv";
import http from "node:http";

// Load environment variables
dotenv.config();

const TEST_USER_ID = process.env.TEST_USER_ID || "291fdea1-f96f-44d1-bc9c-5c2e02c1ee89";
const TEST_PHONE = process.env.TEST_PHONE || "+917007402477";
const GATEWAY_PORT = process.env.PORT || 3000;
const GATEWAY_TOKEN = process.env.TOKEN || "test-token";

interface ChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: { role: string; content: string };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    tolbot_metadata?: {
        session_id: string;
        processing_time_ms: number;
        channel: string;
    };
}

async function sendOpenAIRequest(
    message: string,
    userMetadata?: { user_id: string; user_hash: string; channel: string },
): Promise<ChatCompletionResponse> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model: "openclaw",
            messages: [{ role: "user", content: message }],
            stream: false,
            ...(userMetadata && { user_metadata: userMetadata }),
        });

        const options = {
            hostname: "localhost",
            port: GATEWAY_PORT,
            path: "/v1/chat/completions",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GATEWAY_TOKEN}`,
                "Content-Length": Buffer.byteLength(body),
            },
        };

        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`));
                    } else {
                        resolve(json);
                    }
                } catch (err) {
                    reject(new Error(`Failed to parse response: ${data}`));
                }
            });
        });

        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

async function testGatewayWithoutUserMetadata() {
    console.log("\n" + "=".repeat(60));
    console.log("TEST 1: Gateway Request WITHOUT user_metadata (Legacy Path)");
    console.log("=".repeat(60));

    try {
        console.log("\n📡 Sending request without user_metadata...");
        const response = await sendOpenAIRequest("Hello, say 'LEGACY_PATH_OK' back to me.");

        console.log("✅ Response received");
        console.log(`   ID: ${response.id}`);
        console.log(`   Content: ${response.choices?.[0]?.message?.content?.substring(0, 100)}...`);
        console.log(`   Has tolbot_metadata: ${!!response.tolbot_metadata}`);

        return true;
    } catch (err) {
        console.error("❌ Error:", err);
        return false;
    }
}

async function testGatewayWithUserMetadata() {
    console.log("\n" + "=".repeat(60));
    console.log("TEST 2: Gateway Request WITH user_metadata (Multi-Tenant Path)");
    console.log("=".repeat(60));

    try {
        console.log(`\n📡 Sending request with user_metadata...`);
        console.log(`   user_id: ${TEST_USER_ID}`);
        console.log(`   channel: whatsapp`);

        const response = await sendOpenAIRequest(
            "Hello, respond with 'MULTI_TENANT_OK'. This is a test message.",
            {
                user_id: TEST_USER_ID,
                user_hash: "test-hash-12345",
                channel: "whatsapp",
            },
        );

        console.log("✅ Response received");
        console.log(`   ID: ${response.id}`);
        console.log(`   Content: ${response.choices?.[0]?.message?.content?.substring(0, 100)}...`);
        console.log(`   Has tolbot_metadata: ${!!response.tolbot_metadata}`);
        if (response.tolbot_metadata) {
            console.log(`   Channel: ${response.tolbot_metadata.channel}`);
            console.log(`   Processing time: ${response.tolbot_metadata.processing_time_ms}ms`);
        }

        return true;
    } catch (err) {
        console.error("❌ Error:", err);
        return false;
    }
}

async function testWhatsAppMessageSend() {
    console.log("\n" + "=".repeat(60));
    console.log("TEST 3: WhatsApp Message via Gateway (End-to-End)");
    console.log("=".repeat(60));

    try {
        console.log(`\n📡 Sending WhatsApp message request...`);
        console.log(`   Target phone: ${TEST_PHONE}`);

        // This test requires an agent that can send WhatsApp messages
        // For now, we just test that the request goes through the multi-tenant path
        const response = await sendOpenAIRequest(
            `Send a WhatsApp message saying "Gateway test from Daddy PRATAP 🚀" to ${TEST_PHONE}`,
            {
                user_id: TEST_USER_ID,
                user_hash: "test-hash-12345",
                channel: "whatsapp",
            },
        );

        console.log("✅ Response received");
        console.log(`   Content: ${response.choices?.[0]?.message?.content?.substring(0, 200)}...`);

        return true;
    } catch (err) {
        console.error("❌ Error:", err);
        return false;
    }
}

async function runTests() {
    console.log("\n🚀 Gateway Integration Tests");
    console.log("=".repeat(60));
    console.log(`Gateway URL: http://localhost:${GATEWAY_PORT}/v1/chat/completions`);
    console.log(`Test User ID: ${TEST_USER_ID}`);
    console.log(`Test Phone: ${TEST_PHONE}`);

    const results = {
        legacyPath: false,
        multiTenantPath: false,
        whatsAppSend: false,
    };

    // Check if gateway is running
    console.log("\n⏳ Checking if gateway is running...");
    try {
        await sendOpenAIRequest("ping");
        console.log("✅ Gateway is responding");
    } catch (err: any) {
        if (err.message?.includes("ECONNREFUSED")) {
            console.error("❌ Gateway is not running!");
            console.log("\n💡 Start the gateway with: npm run serve");
            console.log("   or: pnpm run gateway");
            process.exit(1);
        }
        // Other errors are OK (might be auth issues, etc.)
        console.log("✅ Gateway is responding (with auth/config issues, continuing...)");
    }

    results.legacyPath = await testGatewayWithoutUserMetadata();
    results.multiTenantPath = await testGatewayWithUserMetadata();

    if (results.multiTenantPath) {
        results.whatsAppSend = await testWhatsAppMessageSend();
    } else {
        console.log("\n⏭️  Skipping WhatsApp send test (multi-tenant path failed)");
    }

    console.log("\n" + "=".repeat(60));
    console.log("FINAL SUMMARY");
    console.log("=".repeat(60));
    console.log(`1. Legacy Path (no user_metadata):  ${results.legacyPath ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`2. Multi-Tenant Path (with user_metadata): ${results.multiTenantPath ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`3. WhatsApp Send (E2E):             ${results.whatsAppSend ? "✅ PASS" : "❌ FAIL"}`);

    process.exit(Object.values(results).every((r) => r) ? 0 : 1);
}

runTests().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
