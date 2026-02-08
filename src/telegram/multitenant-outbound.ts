/**
 * Multi-tenant outbound message sending for Telegram.
 * Sends messages through user-specific bot instances.
 */

import { getTelegramRegistry } from "./telegram-registry.js";
import { getChildLogger } from "../logging.js";
import type { Other } from "grammy/out/core/api.js";

/**
 * Options for sending a multi-tenant Telegram message.
 */
export interface MultiTenantTelegramSendOptions {
  userId: string;
  chatId: number | string;
  text: string;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  replyTo?: number;
  disableWebPagePreview?: boolean;
  disableNotification?: boolean;
}

/**
 * Result of sending a multi-tenant Telegram message.
 */
export interface MultiTenantTelegramSendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
  channel: "telegram";
}

/**
 * Send a message through a user's Telegram bot.
 * Automatically gets or creates the bot instance.
 */
export async function sendMultiTenantTelegram(
  options: MultiTenantTelegramSendOptions,
): Promise<MultiTenantTelegramSendResult> {
  const logger = getChildLogger({ module: "tg-outbound", userId: options.userId });

  try {
    // Get user's bot from registry
    const registry = getTelegramRegistry();
    const bot = await registry.getBot(options.userId);

    // Prepare send options
    const sendOptions: Other<"sendMessage", "text" | "chat_id"> = {};

    if (options.parseMode) {
      sendOptions.parse_mode = options.parseMode;
    }

    if (options.replyTo) {
      sendOptions.reply_parameters = { message_id: options.replyTo };
    }

    if (options.disableWebPagePreview) {
      sendOptions.link_preview_options = { is_disabled: true };
    }

    if (options.disableNotification) {
      sendOptions.disable_notification = true;
    }

    // Send message
    const result = await bot.api.sendMessage(options.chatId, options.text, sendOptions);

    logger.info(
      { chatId: options.chatId, messageId: result.message_id },
      "Message sent successfully",
    );

    return {
      ok: true,
      messageId: result.message_id,
      channel: "telegram",
    };
  } catch (error: any) {
    logger.error(
      { chatId: options.chatId, error: String(error) },
      "Failed to send Telegram message",
    );

    return {
      ok: false,
      error: error.message || String(error),
      channel: "telegram",
    };
  }
}

/**
 * Send a message with retry logic.
 * Useful for handling transient errors.
 */
export async function sendMultiTenantTelegramWithRetry(
  options: MultiTenantTelegramSendOptions,
  maxRetries = 3,
  retryDelayMs = 500,
): Promise<MultiTenantTelegramSendResult> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await sendMultiTenantTelegram(options);

    if (result.ok) {
      return result;
    }

    lastError = result.error;

    if (attempt < maxRetries) {
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }

  return {
    ok: false,
    error: `Failed after ${maxRetries} attempts: ${lastError}`,
    channel: "telegram",
  };
}
