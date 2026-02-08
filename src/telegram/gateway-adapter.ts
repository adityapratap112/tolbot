/**
 * Gateway adapter for multi-tenant Telegram routing.
 * Routes messages through per-user bot instances when userId is provided,
 * otherwise falls back to legacy single-bot approach.
 */

import { sendMultiTenantTelegram } from "./multitenant-outbound.js";

/**
 * Options for sendTelegramGateway.
 */
export interface GatewayTelegramOptions {
  /** User ID for multi-tenant routing (from user_metadata) */
  userId?: string;
  /** Parse mode for message formatting */
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  /** Message ID to reply to */
  replyTo?: number;
  /** Disable web page preview */
  disableWebPagePreview?: boolean;
  /** Disable notification */
  disableNotification?: boolean;
  /** Legacy account ID (ignored when userId is set) */
  accountId?: string;
}

/**
 * Gateway result matching legacy Telegram send return type.
 */
export interface GatewayTelegramResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

/**
 * Send a Telegram message through the appropriate channel.
 *
 * - If `userId` is provided: Uses multi-tenant bot (per-user Bot instance)
 * - Otherwise: Falls back to legacy single-bot approach
 *
 * @param chatId - Chat ID or username
 * @param text - Message text
 * @param options - Routing and message options
 */
export async function sendTelegramGateway(
  chatId: number | string,
  text: string,
  options: GatewayTelegramOptions = {},
): Promise<GatewayTelegramResult> {
  const { userId, parseMode, replyTo, disableWebPagePreview, disableNotification, accountId } =
    options;

  // Multi-tenant path: route through per-user bot
  if (userId) {
    const result = await sendMultiTenantTelegram({
      userId,
      chatId,
      text,
      parseMode,
      replyTo,
      disableWebPagePreview,
      disableNotification,
    });

    return result;
  }

  // Legacy path: use static bot instance
  // This would use the existing createTelegramBot() approach
  console.warn(
    "[gateway-adapter] Legacy Telegram path not implemented - userId required for multi-tenant",
  );

  return {
    ok: false,
    error: "Multi-tenant userId required. Legacy single-bot mode not supported in gateway.",
  };
}

/**
 * Create a sendTelegram function bound to a specific user.
 * This is used to inject into deps for agentCommand.
 */
export function createUserBoundSendTelegram(userId: string) {
  return async (
    chatId: number | string,
    text: string,
    options: Omit<GatewayTelegramOptions, "userId"> = {},
  ): Promise<GatewayTelegramResult> => {
    return sendTelegramGateway(chatId, text, { ...options, userId });
  };
}
