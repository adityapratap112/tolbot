/**
 * Multi-tenant inbound message listener management.
 * Starts listening for incoming WhatsApp messages on user connections.
 */

import { getConnectionRegistry } from "./connection-registry.js";
import { handleInboundMessage } from "./bot-handler.js";
import { getSupabaseCredentialProvider } from "../credentials/index.js";
import { getChildLogger } from "../logging.js";

const logger = getChildLogger({ module: "wa-inbound" });

/**
 * Start listening for incoming messages on a user's WhatsApp connection.
 * Messages will be processed by the AI agent and responses sent back.
 */
export async function startListenerForUser(userId: string): Promise<void> {
  logger.info({ userId }, "Starting WhatsApp listener for user");

  const registry = getConnectionRegistry();

  try {
    await registry.getConnection(userId, handleInboundMessage);
    logger.info({ userId }, "Listener started successfully");
  } catch (err) {
    logger.error({ userId, error: String(err) }, "Failed to start listener");
    throw err;
  }
}

/**
 * Start listeners for all users with WhatsApp credentials in Supabase.
 * This should be called on gateway startup.
 */
export async function startAllListeners(): Promise<void> {
  logger.info("Starting WhatsApp listeners for all users");

  const provider = getSupabaseCredentialProvider();

  try {
    // Fetch all users with credentials
    const userIds = await provider.getAllUserIds();

    if (userIds.length === 0) {
      logger.info("No users found with WhatsApp credentials");
      return;
    }

    logger.info({ userCount: userIds.length }, "Found users with credentials");

    // Start listeners for each user
    const results = await Promise.allSettled(userIds.map((userId) => startListenerForUser(userId)));

    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    logger.info({ successful, failed, total: userIds.length }, "Listener startup complete");
  } catch (err) {
    logger.error({ error: String(err) }, "Failed to start all listeners");
    throw err;
  }
}

/**
 * Stop listener for a specific user.
 */
export async function stopListenerForUser(userId: string): Promise<void> {
  logger.info({ userId }, "Stopping WhatsApp listener for user");

  const registry = getConnectionRegistry();

  // Connection will be closed by idle timeout or manual shutdown
  // For now, we just log - actual cleanup happens in ConnectionRegistry
  logger.info({ userId }, "Listener stop requested (will close on idle timeout)");
}
