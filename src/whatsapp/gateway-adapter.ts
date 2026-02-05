/**
 * Gateway adapter for multi-tenant WhatsApp routing.
 * Routes messages through per-user connections when userId is provided,
 * otherwise falls back to legacy sendMessageWhatsApp.
 */

import { sendMultiTenantWhatsApp } from "./multitenant-outbound.js";

/**
 * Options for sendWhatsAppGateway.
 */
export interface GatewayWhatsAppOptions {
  /** User ID for multi-tenant routing (from user_metadata) */
  userId?: string;
  /** Media URL for image/video/document messages */
  mediaUrl?: string;
  /** Legacy account ID (ignored when userId is set) */
  accountId?: string;
  /** Enable GIF playback for video */
  gifPlayback?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Gateway result matching legacy sendMessageWhatsApp return type.
 */
export interface GatewayWhatsAppResult {
  messageId?: string;
  toJid?: string;
}

/**
 * Send a WhatsApp message through the appropriate channel.
 *
 * - If `userId` is provided: Uses multi-tenant connection (per-user WASocket)
 * - Otherwise: Falls back to legacy sendMessageWhatsApp
 *
 * @param to - Phone number or group JID
 * @param text - Message text
 * @param options - Routing and message options
 */
export async function sendWhatsAppGateway(
  to: string,
  text: string,
  options: GatewayWhatsAppOptions = {},
): Promise<GatewayWhatsAppResult> {
  const { userId, mediaUrl, accountId, gifPlayback, verbose } = options;

  // Multi-tenant path: route through per-user connection
  if (userId) {
    const result = await sendMultiTenantWhatsApp({
      userId,
      to,
      text,
      mediaUrl,
    });

    if (result.ok) {
      return {
        messageId: result.messageId,
        toJid: to,
      };
    }

    // Log error but return gracefully
    console.error(`[gateway-adapter] Multi-tenant send failed for user ${userId}:`, result.error);
    return {
      messageId: undefined,
      toJid: to,
    };
  }

  // Legacy path: use static connection
  const { sendMessageWhatsApp } = await import("../web/outbound.js");
  return sendMessageWhatsApp(to, text, {
    verbose: verbose ?? false,
    mediaUrl,
    accountId,
    gifPlayback,
  });
}

/**
 * Create a sendWhatsApp function bound to a specific user.
 * This is used to inject into deps for agentCommand.
 */
export function createUserBoundSendWhatsApp(userId: string) {
  return async (
    to: string,
    text: string,
    options: Omit<GatewayWhatsAppOptions, "userId"> = {},
  ): Promise<GatewayWhatsAppResult> => {
    return sendWhatsAppGateway(to, text, { ...options, userId });
  };
}
