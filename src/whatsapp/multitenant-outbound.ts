/**
 * Multi-tenant WhatsApp outbound module.
 * Sends messages through user-specific WhatsApp connections.
 */

import { getConnectionRegistry } from "./connection-registry.js";
import { getChildLogger } from "../logging.js";

export interface MultiTenantSendOptions {
  /** User ID for credential lookup */
  userId: string;
  /** Target phone number or group JID */
  to: string;
  /** Message text content */
  text: string;
  /** Optional media URL to send */
  mediaUrl?: string;
  /** Whether to play as GIF */
  gifPlayback?: boolean;
}

export interface MultiTenantSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  channel: "whatsapp";
}

/**
 * Send a WhatsApp message through a user's dedicated connection.
 *
 * This is the main entry point for multi-tenant message sending.
 * It:
 * 1. Gets or creates a WASocket connection for the user
 * 2. Waits for connection to be ready
 * 3. Sends the message through that connection
 * 4. Returns the result
 */
export async function sendMultiTenantWhatsApp(
  opts: MultiTenantSendOptions,
): Promise<MultiTenantSendResult> {
  const logger = getChildLogger({ module: "wa-multitenant", userId: opts.userId });

  // Try up to 3 times with reconnection
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`   📤 Send attempt ${attempt}/3...`);

      // Get connection from registry (creates if needed)
      const registry = getConnectionRegistry();
      const socket = await registry.getConnection(opts.userId);

      // Normalize target JID
      const jid = normalizeJid(opts.to);

      let messageId: string | undefined;

      if (opts.mediaUrl) {
        // Send media message
        messageId = await sendMediaMessage(socket, jid, opts.text, opts.mediaUrl, opts.gifPlayback);
      } else {
        // Send text message
        console.log(`   📨 Sending message to ${jid}...`);
        const textResult = await socket.sendMessage(jid, { text: opts.text });
        messageId = textResult?.key?.id ?? undefined;
      }

      console.log(`   ✅ Message sent! ID: ${messageId}`);
      logger.info({ to: jid, messageId }, "Message sent via multi-tenant connection");

      return {
        ok: true,
        messageId,
        channel: "whatsapp",
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.log(`   ⚠️  Attempt ${attempt} failed: ${errorMessage}`);

      // If this isn't the last attempt and it's a connection error, wait and retry
      if (attempt < 3 && (errorMessage.includes("Connection") || errorMessage.includes("closed"))) {
        console.log(`   🔄 Waiting 500ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, 500));

        continue;
      }

      // Last attempt or non-connection error
      logger.error({ error: errorMessage, to: opts.to }, "Failed to send multi-tenant message");

      return {
        ok: false,
        error: errorMessage,
        channel: "whatsapp",
      };
    }
  }

  // Should never reach here, but TypeScript needs it
  return {
    ok: false,
    error: "All retry attempts failed",
    channel: "whatsapp",
  };
}

/**
 * Wait for a WhatsApp socket to be ready for sending messages.
 */
async function waitForConnectionReady(
  socket: any, // Using any to avoid TypeScript issues with internal properties
  timeoutMs: number = 10000,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Check if connection is open
    if (socket.ws?.readyState === 1) {
      // WebSocket.OPEN = 1
      return;
    }

    // Wait a bit before checking again
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Connection not ready after ${timeoutMs}ms`);
}

/**
 * Normalize a phone number or group JID for WhatsApp.
 */
function normalizeJid(target: string): string {
  const trimmed = target.trim();

  // Already a JID
  if (trimmed.includes("@")) {
    return trimmed;
  }

  // Phone number - normalize and convert to JID
  const digits = trimmed.replace(/\D/g, "");

  // Remove leading zeros
  const normalized = digits.replace(/^0+/, "");

  return `${normalized}@s.whatsapp.net`;
}

/**
 * Send a media message via WhatsApp.
 */
async function sendMediaMessage(
  socket: ReturnType<typeof import("@whiskeysockets/baileys").makeWASocket>,
  jid: string,
  caption: string,
  mediaUrl: string,
  gifPlayback?: boolean,
): Promise<string | undefined> {
  // Determine media type from URL
  const lowerUrl = mediaUrl.toLowerCase();
  const isImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(lowerUrl);
  const isVideo = /\.(mp4|mov|avi|webm)(\?|$)/i.test(lowerUrl);
  const isAudio = /\.(mp3|ogg|m4a|wav)(\?|$)/i.test(lowerUrl);
  const isDocument = !isImage && !isVideo && !isAudio;

  let result;

  if (isImage) {
    result = await socket.sendMessage(jid, {
      image: { url: mediaUrl },
      caption,
      gifPlayback: gifPlayback ?? false,
    });
  } else if (isVideo) {
    result = await socket.sendMessage(jid, {
      video: { url: mediaUrl },
      caption,
      gifPlayback: gifPlayback ?? false,
    });
  } else if (isAudio) {
    result = await socket.sendMessage(jid, {
      audio: { url: mediaUrl },
      mimetype: "audio/mpeg",
    });
  } else {
    // Default to document
    const filename = mediaUrl.split("/").pop()?.split("?")[0] ?? "file";
    result = await socket.sendMessage(jid, {
      document: { url: mediaUrl },
      mimetype: "application/octet-stream",
      fileName: filename,
      caption,
    });
  }

  return result?.key?.id ?? undefined;
}

/**
 * Check if a user has an active WhatsApp connection.
 */
export function hasActiveConnection(userId: string): boolean {
  return getConnectionRegistry().hasConnection(userId);
}

/**
 * Get the number of active connections (for monitoring).
 */
export function getActiveConnectionCount(): number {
  return getConnectionRegistry().getConnectionCount();
}
