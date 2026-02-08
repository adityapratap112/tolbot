/**
 * Telegram Registry for multi-tenant Telegram bots.
 * Manages dedicated grammY Bot instances per user with on-demand loading and idle timeout.
 */

import { Bot, type Context } from "grammy";
import { run, type RunnerHandle } from "@grammyjs/runner";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { Redis } from "ioredis";
import { getChildLogger } from "../logging.js";
import { getTelegramCredentialProvider, type TelegramCredentials } from "../credentials/index.js";

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const REDIS_REGISTRY_PREFIX = "tg:registry:";

/**
 * Inbound message from Telegram.
 */
export interface InboundTelegramMessage {
  userId: string;
  chatId: number;
  from: {
    id: number;
    firstName: string;
    lastName?: string;
    username?: string;
  };
  text: string;
  timestamp: number;
  messageId: number;
  isGroup: boolean;
  threadId?: number;
}

/**
 * Message listener callback.
 */
export type TelegramMessageListener = (msg: InboundTelegramMessage) => Promise<void>;

/**
 * Bot entry in the registry.
 */
interface BotEntry {
  userId: string;
  bot: Bot;
  runner: RunnerHandle;
  credentials: TelegramCredentials;
  createdAt: number;
  lastActivityAt: number;
  idleTimer: NodeJS.Timeout;
  status: "starting" | "running" | "stopped";
  messageListener?: TelegramMessageListener;
}

/**
 * Telegram Registry for managing per-user bot instances.
 *
 * Features:
 * - On-demand loading: Bots created only when needed
 * - Idle timeout: Bots stopped after inactivity period
 * - Redis sync: Track which server handles which user (for horizontal scaling)
 * - grammY runner: Managed long-polling with graceful shutdown
 */
export class TelegramRegistry {
  private bots = new Map<string, BotEntry>();
  private redis: Redis | null = null;
  private serverId: string;
  private idleTimeoutMs: number;

  constructor(options?: {
    redis?: Redis;
    redisUrl?: string;
    serverId?: string;
    idleTimeoutMs?: number;
  }) {
    this.serverId =
      options?.serverId ?? `server-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

    // Optional Redis for distributed coordination
    if (options?.redis) {
      this.redis = options.redis;
    } else if (options?.redisUrl || process.env.REDIS_URL) {
      let redisUrl = options?.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
      // Normalize JDBC-style Redis URLs
      if (redisUrl.startsWith("jdbc:redis:")) {
        redisUrl = redisUrl.replace("jdbc:redis:", "redis:");
      }
      this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
    }
  }

  /**
   * Get or create a Telegram bot for a user.
   * This is the main entry point for sending messages.
   *
   * @param userId - User ID
   * @param onMessage - Optional message listener callback
   */
  async getBot(userId: string, onMessage?: TelegramMessageListener): Promise<Bot> {
    // Check if we already have an active bot
    const existing = this.bots.get(userId);
    if (existing && existing.status !== "stopped") {
      this.touchBot(userId);

      // Attach message listener if provided and not already attached
      if (onMessage && !existing.messageListener) {
        existing.messageListener = onMessage;
      }

      return existing.bot;
    }

    // Create new bot
    return this.createBot(userId, onMessage);
  }

  /**
   * Start polling for a user's bot.
   * This begins listening for incoming messages.
   */
  async startPolling(userId: string, onMessage?: TelegramMessageListener): Promise<void> {
    const entry = this.bots.get(userId);
    if (!entry) {
      // Create bot if it doesn't exist
      await this.createBot(userId, onMessage);
      return;
    }

    if (entry.status === "running") {
      console.log(`[TelegramRegistry] Bot already running for user ${userId}`);
      return;
    }

    // Start the runner
    entry.status = "running";
    console.log(`[TelegramRegistry] Started polling for user ${userId}`);
  }

  /**
   * Stop and cleanup a bot for a user.
   */
  async stopBot(userId: string): Promise<void> {
    const entry = this.bots.get(userId);
    if (!entry) {
      return;
    }

    const logger = getChildLogger({ module: "tg-registry", userId });
    logger.info("Stopping Telegram bot");

    // Clear idle timer
    clearTimeout(entry.idleTimer);

    // Stop runner
    if (entry.runner) {
      try {
        await entry.runner.stop();
      } catch (error) {
        logger.error({ error: String(error) }, "Error stopping runner");
      }
    }

    // Update status
    entry.status = "stopped";

    // Remove from registry
    this.bots.delete(userId);

    // Unregister from Redis
    await this.unregisterFromRedis(userId);

    logger.info("Telegram bot stopped and removed from registry");
  }

  /**
   * Check if a user has an active bot on this server.
   */
  hasBot(userId: string): boolean {
    const entry = this.bots.get(userId);
    return entry?.status === "running";
  }

  /**
   * Get bot count for monitoring.
   */
  getBotCount(): number {
    return this.bots.size;
  }

  /**
   * Graceful shutdown of all bots.
   */
  async shutdown(): Promise<void> {
    console.log(`[TelegramRegistry] Shutting down ${this.bots.size} bots...`);

    const shutdownPromises = Array.from(this.bots.keys()).map((userId) => this.stopBot(userId));
    await Promise.all(shutdownPromises);

    if (this.redis) {
      await this.redis.quit();
    }

    console.log("[TelegramRegistry] Shutdown complete");
  }

  /**
   * Create a new Telegram bot for a user.
   */
  private async createBot(userId: string, onMessage?: TelegramMessageListener): Promise<Bot> {
    const logger = getChildLogger({ module: "tg-registry", userId });
    logger.info("Creating Telegram bot for user");

    // Fetch credentials
    const credentialProvider = getTelegramCredentialProvider();
    const credentials = await credentialProvider.fetchCredentials(userId);

    if (!credentials) {
      throw new Error(`No Telegram credentials found for user: ${userId}`);
    }

    // Create grammY bot
    const bot = new Bot(credentials.botToken);

    // Apply API throttler
    bot.api.config.use(apiThrottler());

    // Set up message handler if provided
    if (onMessage) {
      bot.on("message:text", async (ctx) => {
        try {
          const message: InboundTelegramMessage = {
            userId,
            chatId: ctx.chat.id,
            from: {
              id: ctx.from.id,
              firstName: ctx.from.first_name,
              lastName: ctx.from.last_name,
              username: ctx.from.username,
            },
            text: ctx.message.text,
            timestamp: ctx.message.date * 1000,
            messageId: ctx.message.message_id,
            isGroup: ctx.chat.type === "group" || ctx.chat.type === "supergroup",
            threadId: ctx.message.message_thread_id,
          };

          await onMessage(message);

          // Touch bot to reset idle timer
          this.touchBot(userId);
        } catch (error) {
          logger.error({ error: String(error) }, "Failed to process inbound message");
        }
      });
    }

    // Start runner for long-polling
    const runner = run(bot);

    // Create entry
    const entry: BotEntry = {
      userId,
      bot,
      runner,
      credentials,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      idleTimer: this.startIdleTimer(userId),
      status: "running",
      messageListener: onMessage,
    };

    this.bots.set(userId, entry);

    // Register in Redis for distributed coordination
    await this.registerInRedis(userId);

    logger.info("Telegram bot created and started");

    return bot;
  }

  /**
   * Touch a bot to reset its idle timer.
   */
  private touchBot(userId: string): void {
    const entry = this.bots.get(userId);
    if (!entry) {
      return;
    }

    entry.lastActivityAt = Date.now();

    // Reset idle timer
    clearTimeout(entry.idleTimer);
    entry.idleTimer = this.startIdleTimer(userId);
  }

  /**
   * Start idle timer for a bot.
   */
  private startIdleTimer(userId: string): NodeJS.Timeout {
    return setTimeout(() => {
      const logger = getChildLogger({ module: "tg-registry", userId });
      logger.info({ idleTimeoutMs: this.idleTimeoutMs }, "Bot idle timeout reached");
      this.stopBot(userId).catch((err) => {
        logger.error({ error: String(err) }, "Error stopping idle bot");
      });
    }, this.idleTimeoutMs);
  }

  /**
   * Register bot in Redis for distributed coordination.
   */
  private async registerInRedis(userId: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      const key = `${REDIS_REGISTRY_PREFIX}${userId}`;
      await this.redis.setex(key, Math.ceil(this.idleTimeoutMs / 1000), this.serverId);
    } catch (error) {
      const logger = getChildLogger({ module: "tg-registry", userId });
      logger.warn({ error: String(error) }, "Failed to register in Redis");
    }
  }

  /**
   * Unregister bot from Redis.
   */
  private async unregisterFromRedis(userId: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      const key = `${REDIS_REGISTRY_PREFIX}${userId}`;
      await this.redis.del(key);
    } catch (error) {
      const logger = getChildLogger({ module: "tg-registry", userId });
      logger.warn({ error: String(error) }, "Failed to unregister from Redis");
    }
  }
}

/**
 * Singleton instance for convenience.
 */
let telegramRegistry: TelegramRegistry | null = null;

/**
 * Get or create the global TelegramRegistry instance.
 */
export function getTelegramRegistry(options?: {
  redis?: Redis;
  redisUrl?: string;
  serverId?: string;
  idleTimeoutMs?: number;
}): TelegramRegistry {
  if (!telegramRegistry) {
    telegramRegistry = new TelegramRegistry(options);
  }
  return telegramRegistry;
}
