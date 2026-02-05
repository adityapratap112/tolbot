/**
 * Connection Registry for multi-tenant WhatsApp.
 * Manages dedicated WASocket connections per user with on-demand loading and idle timeout.
 */

import { Redis } from "ioredis";
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  type WASocket,
  type SignalKeyStore,
} from "@whiskeysockets/baileys";
import { getChildLogger, toPinoLikeLogger } from "../logging.js";
import { VERSION } from "../version.js";
import {
  getSupabaseCredentialProvider,
  getCredentialCache,
  type WhatsAppCredentials,
} from "../credentials/index.js";
import { useSupabaseAuthState } from "./supabase-auth-state.js";

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const REDIS_REGISTRY_PREFIX = "wa:registry:";

/**
 * Inbound message from WhatsApp.
 */
export interface InboundWhatsAppMessage {
  userId: string;
  from: string;
  body: string;
  timestamp?: number;
  messageId?: string;
  isGroup: boolean;
  senderJid?: string;
  senderE164?: string;
}

/**
 * Message listener callback.
 */
export type MessageListener = (msg: InboundWhatsAppMessage) => Promise<void>;

/**
 * Connection entry in the registry.
 */
interface ConnectionEntry {
  userId: string;
  socket: WASocket;
  createdAt: number;
  lastActivityAt: number;
  idleTimer: NodeJS.Timeout;
  status: "connecting" | "connected" | "disconnected";
  messageListener?: MessageListener;
  hasMessageHandler: boolean;
}

/**
 * Connection Registry for managing per-user WhatsApp connections.
 *
 * Features:
 * - On-demand loading: Connections created only when needed
 * - Idle timeout: Connections closed after inactivity period
 * - Redis sync: Track which server handles which user (for horizontal scaling)
 */
export class ConnectionRegistry {
  private connections = new Map<string, ConnectionEntry>();
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
   * Get or create a WhatsApp connection for a user.
   * This is the main entry point for sending messages.
   *
   * @param userId - User ID
   * @param onMessage - Optional message listener callback
   */
  async getConnection(userId: string, onMessage?: MessageListener): Promise<WASocket> {
    // Check if we already have an active connection
    const existing = this.connections.get(userId);
    if (existing && existing.status !== "disconnected") {
      this.touchConnection(userId);

      // Attach message listener if provided and not already attached
      if (onMessage && !existing.hasMessageHandler) {
        this.attachMessageListener(userId, existing.socket, onMessage);
        existing.messageListener = onMessage;
        existing.hasMessageHandler = true;
      }

      return existing.socket;
    }

    // Create new connection
    return this.createConnection(userId, onMessage);
  }

  /**
   * Check if a user has an active connection on this server.
   */
  hasConnection(userId: string): boolean {
    const entry = this.connections.get(userId);
    return entry?.status === "connected";
  }

  /**
   * Get connection count for monitoring.
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Create a new WhatsApp connection for a user.
   */
  private async createConnection(userId: string, onMessage?: MessageListener): Promise<WASocket> {
    const logger = getChildLogger({ module: "wa-registry", userId });
    logger.info("Creating WhatsApp connection for user");

    // Fetch credentials from cache/Supabase
    const credentialCache = getCredentialCache();
    const credentialProvider = getSupabaseCredentialProvider();
    const creds = await credentialCache.getOrFetch(userId, credentialProvider);

    if (!creds) {
      throw new Error(`No WhatsApp credentials found for user: ${userId}`);
    }

    // Create Baileys-compatible auth state
    const authState = await useSupabaseAuthState(userId, credentialProvider, creds);
    const { version } = await fetchLatestBaileysVersion();

    const pinoLogger = toPinoLikeLogger(getChildLogger({ module: "baileys", userId }), "silent");

    const socket = makeWASocket({
      auth: {
        creds: authState.state.creds,
        keys: makeCacheableSignalKeyStore(authState.state.keys as SignalKeyStore, pinoLogger),
      },
      version,
      logger: pinoLogger,
      printQRInTerminal: false,
      browser: ["openclaw-multitenant", "server", VERSION],
      syncFullHistory: false, // Critical for memory optimization
      markOnlineOnConnect: false,
    });

    // Create entry
    const entry: ConnectionEntry = {
      userId,
      socket,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      idleTimer: this.startIdleTimer(userId),
      status: "connecting",
      messageListener: onMessage,
      hasMessageHandler: false,
    };

    this.connections.set(userId, entry);

    // Register in Redis for distributed coordination
    await this.registerInRedis(userId);

    // Set up event handlers
    this.setupEventHandlers(userId, socket, authState);

    // Attach message listener if provided
    if (onMessage) {
      this.attachMessageListener(userId, socket, onMessage);
      entry.hasMessageHandler = true;
    }

    return socket;
  }

  /**
   * Attach message listener to a connection.
   */
  private attachMessageListener(
    userId: string,
    socket: WASocket,
    onMessage: MessageListener,
  ): void {
    const logger = getChildLogger({ module: "wa-registry", userId });

    console.log(`\n📡 Attaching message listener for user: ${userId}`);

    socket.ev.on("messages.upsert", async (upsert) => {
      console.log(`\n📨 messages.upsert event received for user: ${userId}`);
      console.log(`   Type: ${upsert.type}`);
      console.log(`   Messages: ${upsert.messages?.length || 0}`);

      if (upsert.type !== "notify" && upsert.type !== "append") {
        console.log(`   ⏭️  Skipping (type: ${upsert.type})`);
        return;
      }

      for (const msg of upsert.messages ?? []) {
        try {
          console.log(`\n   📩 Processing message...`);

          // Skip status updates and broadcasts
          const remoteJid = msg.key?.remoteJid;
          console.log(`      Remote JID: ${remoteJid}`);

          if (!remoteJid || remoteJid.endsWith("@status") || remoteJid.endsWith("@broadcast")) {
            console.log(`      ⏭️  Skipping status/broadcast`);
            continue;
          }

          // Skip own messages
          if (msg.key?.fromMe) {
            console.log(`      ⏭️  Skipping own message`);
            continue;
          }

          // Skip history/offline messages
          if (upsert.type === "append") {
            console.log(`      ⏭️  Skipping history message`);
            continue;
          }

          // Extract message data
          const isGroup = remoteJid.includes("@g.us");
          const messageContent = msg.message;

          console.log(`      Is Group: ${isGroup}`);
          console.log(`      Has Content: ${!!messageContent}`);

          if (!messageContent) {
            console.log(`      ⏭️  No message content`);
            continue;
          }

          // Extract text from message
          let body = "";
          if (messageContent.conversation) {
            body = messageContent.conversation;
          } else if (messageContent.extendedTextMessage?.text) {
            body = messageContent.extendedTextMessage.text;
          } else if (messageContent.imageMessage?.caption) {
            body = messageContent.imageMessage.caption;
          } else if (messageContent.videoMessage?.caption) {
            body = messageContent.videoMessage.caption;
          }

          if (!body) {
            console.log(`      ⏭️  No text body`);
            continue;
          }

          console.log(`      Body: "${body}"`);
          console.log(`      ✅ Message extracted, calling handler...`);

          const inboundMessage: InboundWhatsAppMessage = {
            userId,
            from: remoteJid,
            body,
            timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now(),
            messageId: msg.key?.id ?? undefined,
            isGroup,
            senderJid: msg.key?.participant ?? undefined,
            senderE164: msg.key?.participant ?? undefined,
          };

          // Call listener
          await onMessage(inboundMessage);

          // Touch connection to reset idle timer
          this.touchConnection(userId);
        } catch (err) {
          logger.error({ error: String(err) }, "Failed to process inbound message");
        }
      }
    });

    logger.info("Message listener attached");
  }

  /**
   * Set up Baileys event handlers for a connection.
   */
  private setupEventHandlers(
    userId: string,
    socket: WASocket,
    authState: Awaited<ReturnType<typeof useSupabaseAuthState>>,
  ): void {
    const logger = getChildLogger({ module: "wa-registry", userId });

    socket.ev.on("creds.update", async () => {
      try {
        await authState.saveCreds();
        logger.debug("Credentials updated and saved to Supabase");
      } catch (err) {
        logger.error({ error: String(err) }, "Failed to save credentials");
      }
    });

    socket.ev.on("connection.update", (update) => {
      const entry = this.connections.get(userId);
      if (!entry) return;

      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        entry.status = "connected";
        logger.info("WhatsApp connection established");
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        entry.status = "disconnected";
        logger.info({ statusCode }, "WhatsApp connection closed");

        // Handle logged out
        if (statusCode === DisconnectReason.loggedOut) {
          logger.warn("User was logged out - invalidating credentials");
          getCredentialCache()
            .invalidate(userId)
            .catch((err) => logger.error({ error: String(err) }, "Failed to invalidate cache"));
        }

        // Clean up
        this.removeConnection(userId);
      }
    });

    // Handle WebSocket errors
    if (socket.ws && typeof (socket.ws as any).on === "function") {
      socket.ws.on("error", (err: Error) => {
        logger.error({ error: String(err) }, "WebSocket error");
      });
    }
  }

  /**
   * Touch a connection to reset its idle timer.
   */
  private touchConnection(userId: string): void {
    const entry = this.connections.get(userId);
    if (!entry) return;

    entry.lastActivityAt = Date.now();
    clearTimeout(entry.idleTimer);
    entry.idleTimer = this.startIdleTimer(userId);
  }

  /**
   * Start idle timer for a connection.
   */
  private startIdleTimer(userId: string): NodeJS.Timeout {
    return setTimeout(() => {
      this.closeIdleConnection(userId);
    }, this.idleTimeoutMs);
  }

  /**
   * Close an idle connection.
   */
  private async closeIdleConnection(userId: string): Promise<void> {
    const logger = getChildLogger({ module: "wa-registry", userId });
    logger.info("Closing idle WhatsApp connection");
    await this.removeConnection(userId);
  }

  /**
   * Remove a connection from the registry.
   */
  private async removeConnection(userId: string): Promise<void> {
    const entry = this.connections.get(userId);
    if (!entry) return;

    clearTimeout(entry.idleTimer);

    try {
      entry.socket.end(undefined);
    } catch (err) {
      // Ignore close errors
    }

    this.connections.delete(userId);
    await this.unregisterFromRedis(userId);
  }

  /**
   * Register this connection in Redis for distributed coordination.
   */
  private async registerInRedis(userId: string): Promise<void> {
    if (!this.redis) return;

    try {
      const key = `${REDIS_REGISTRY_PREFIX}${userId}`;
      await this.redis.setex(key, Math.ceil(this.idleTimeoutMs / 1000) + 60, this.serverId);
    } catch (err) {
      console.error(`Failed to register in Redis for ${userId}:`, err);
    }
  }

  /**
   * Unregister this connection from Redis.
   */
  private async unregisterFromRedis(userId: string): Promise<void> {
    if (!this.redis) return;

    try {
      const key = `${REDIS_REGISTRY_PREFIX}${userId}`;
      const currentServer = await this.redis.get(key);
      if (currentServer === this.serverId) {
        await this.redis.del(key);
      }
    } catch (err) {
      console.error(`Failed to unregister from Redis for ${userId}:`, err);
    }
  }

  /**
   * Check which server is handling a user (for routing in distributed setups).
   */
  async getServerForUser(userId: string): Promise<string | null> {
    if (!this.redis) return null;

    try {
      const key = `${REDIS_REGISTRY_PREFIX}${userId}`;
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  /**
   * Close all connections and clean up.
   */
  async shutdown(): Promise<void> {
    const userIds = Array.from(this.connections.keys());
    await Promise.all(userIds.map((userId) => this.removeConnection(userId)));

    if (this.redis) {
      await this.redis.quit();
    }
  }
}

// Singleton instance
let registryInstance: ConnectionRegistry | null = null;

/**
 * Get or create the singleton ConnectionRegistry.
 */
export function getConnectionRegistry(): ConnectionRegistry {
  if (!registryInstance) {
    registryInstance = new ConnectionRegistry();
  }
  return registryInstance;
}

/**
 * Set a custom ConnectionRegistry instance (for testing).
 */
export function setConnectionRegistry(registry: ConnectionRegistry): void {
  registryInstance = registry;
}
