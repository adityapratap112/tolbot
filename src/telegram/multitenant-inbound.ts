/**
 * Multi-tenant inbound message handling for Telegram.
 * Starts and manages message listeners for individual users.
 */

import { getTelegramRegistry, type TelegramMessageListener } from "./telegram-registry.js";
import { getTelegramCredentialProvider } from "../credentials/index.js";
import { getChildLogger } from "../logging.js";

/**
 * Start listening for messages for a specific user.
 * Creates a bot instance and begins long-polling.
 */
export async function startListenerForUser(
  userId: string,
  onMessage?: TelegramMessageListener,
): Promise<void> {
  const logger = getChildLogger({ module: "tg-inbound", userId });
  logger.info("Starting Telegram listener for user");

  try {
    const registry = getTelegramRegistry();

    // Get or create bot (this also starts polling)
    await registry.getBot(userId, onMessage);

    logger.info("Telegram listener started successfully");
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to start Telegram listener");
    throw error;
  }
}

/**
 * Stop listening for messages for a specific user.
 */
export async function stopListenerForUser(userId: string): Promise<void> {
  const logger = getChildLogger({ module: "tg-inbound", userId });
  logger.info("Stopping Telegram listener for user");

  try {
    const registry = getTelegramRegistry();
    await registry.stopBot(userId);

    logger.info("Telegram listener stopped successfully");
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to stop Telegram listener");
    throw error;
  }
}

/**
 * Start listeners for all users with Telegram credentials.
 * Useful for server startup to resume all active bots.
 */
export async function startAllListeners(onMessage?: TelegramMessageListener): Promise<void> {
  const logger = getChildLogger({ module: "tg-inbound" });
  logger.info("Starting Telegram listeners for all users");

  try {
    const credentialProvider = getTelegramCredentialProvider();
    const userIds = await credentialProvider.getAllUserIds();

    logger.info({ userCount: userIds.length }, "Found users with Telegram credentials");

    const startPromises = userIds.map((userId) =>
      startListenerForUser(userId, onMessage).catch((error) => {
        logger.error({ userId, error: String(error) }, "Failed to start listener for user");
      }),
    );

    await Promise.all(startPromises);

    logger.info({ userCount: userIds.length }, "All Telegram listeners started");
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to start all Telegram listeners");
    throw error;
  }
}

/**
 * Stop all active listeners.
 * Useful for graceful shutdown.
 */
export async function stopAllListeners(): Promise<void> {
  const logger = getChildLogger({ module: "tg-inbound" });
  logger.info("Stopping all Telegram listeners");

  try {
    const registry = getTelegramRegistry();
    await registry.shutdown();

    logger.info("All Telegram listeners stopped");
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to stop all Telegram listeners");
    throw error;
  }
}
