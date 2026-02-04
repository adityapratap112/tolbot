/**
 * Redis-based context manager for multi-tenant session isolation.
 * Uses Redis LIST for efficient message storage (RPUSH/LRANGE) and HASH for metadata.
 * This is the professional approach - no need to serialize/deserialize entire session.
 */

import { Redis } from "ioredis";
import type { ContextStore, SessionContext, SessionMessage } from "./types.js";

/** Default TTL for session context (24 hours) */
const DEFAULT_CONTEXT_TTL_SECONDS = 86400;

/** Maximum messages to keep in history */
const MAX_MESSAGES = 50;

/** Key prefixes for different data types */
const KEY_PREFIX = "tolbot:session";
const MESSAGES_SUFFIX = ":messages"; // LIST type
const META_SUFFIX = ":meta"; // HASH type

/**
 * Redis-based implementation of the ContextStore interface.
 * Uses LIST for messages (efficient push/pop) and HASH for metadata.
 */
export class RedisContextManager implements ContextStore {
  private redis: Redis;
  private ttlSeconds: number;
  private maxMessages: number;

  constructor(options?: { redisUrl?: string; ttlSeconds?: number; maxMessages?: number }) {
    const redisUrl = options?.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
    this.ttlSeconds = options?.ttlSeconds ?? DEFAULT_CONTEXT_TTL_SECONDS;
    this.maxMessages = options?.maxMessages ?? MAX_MESSAGES;
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }

  /**
   * Connect to Redis (called automatically on first operation if not connected).
   */
  async connect(): Promise<void> {
    if (this.redis.status === "ready") return;
    await this.redis.connect();
  }

  /**
   * Build Redis keys for a session.
   */
  private buildKeys(userId: string, sessionKey: string): { messages: string; meta: string } {
    const safeUserId = userId.replace(/:/g, "_");
    const safeSessionKey = sessionKey.replace(/:/g, "_");
    const base = `${KEY_PREFIX}:${safeUserId}:${safeSessionKey}`;
    return {
      messages: `${base}${MESSAGES_SUFFIX}`,
      meta: `${base}${META_SUFFIX}`,
    };
  }

  /**
   * Build pattern for finding user sessions.
   */
  private buildPattern(userId: string): string {
    const safeUserId = userId.replace(/:/g, "_");
    return `${KEY_PREFIX}:${safeUserId}:*${META_SUFFIX}`;
  }

  /**
   * Push a single message to the session (efficient - no full session read/write).
   */
  async pushMessage(userId: string, sessionKey: string, message: SessionMessage): Promise<void> {
    await this.connect();
    const keys = this.buildKeys(userId, sessionKey);

    // Push message to LIST
    await this.redis.rpush(keys.messages, JSON.stringify(message));

    // Trim to keep only last N messages
    await this.redis.ltrim(keys.messages, -this.maxMessages, -1);

    // Update TTL
    await this.redis.expire(keys.messages, this.ttlSeconds);

    // Update metadata timestamp
    await this.redis.hset(keys.meta, "updatedAt", Date.now().toString());
    await this.redis.expire(keys.meta, this.ttlSeconds);
  }

  /**
   * Get recent messages from session (efficient - only fetches what's needed).
   */
  async getMessages(userId: string, sessionKey: string, limit?: number): Promise<SessionMessage[]> {
    await this.connect();
    const keys = this.buildKeys(userId, sessionKey);
    const count = limit ?? this.maxMessages;

    // Get last N messages from LIST
    const rawMessages = await this.redis.lrange(keys.messages, -count, -1);
    return rawMessages.map((raw) => JSON.parse(raw) as SessionMessage);
  }

  /**
   * Get session context by user ID and session key.
   * Reconstructs SessionContext from HASH metadata + LIST messages.
   */
  async getContext(userId: string, sessionKey?: string): Promise<SessionContext | null> {
    await this.connect();

    if (!sessionKey) {
      // Find most recent session for this user
      const sessions = await this.getUserSessions(userId);
      return sessions.length > 0 ? sessions[0] : null;
    }

    const keys = this.buildKeys(userId, sessionKey);

    // Get metadata from HASH
    const meta = await this.redis.hgetall(keys.meta);
    if (!meta || Object.keys(meta).length === 0) return null;

    // Get messages from LIST
    const messages = await this.getMessages(userId, sessionKey);

    // Reconstruct SessionContext
    return {
      userId,
      sessionId: meta.sessionId ?? "",
      sessionKey,
      channel: meta.channel ?? "api",
      createdAt: parseInt(meta.createdAt ?? "0", 10),
      updatedAt: parseInt(meta.updatedAt ?? "0", 10),
      activeTools: meta.activeTools ? JSON.parse(meta.activeTools) : [],
      recentMessages: messages,
      tokenCounts: meta.tokenCounts
        ? JSON.parse(meta.tokenCounts)
        : { input: 0, output: 0, total: 0 },
      model: meta.model,
      provider: meta.provider,
      metadata: meta.metadata ? JSON.parse(meta.metadata) : undefined,
    };
  }

  /**
   * Set or update session context.
   * Stores metadata in HASH and messages in LIST.
   */
  async setContext(context: SessionContext): Promise<void> {
    await this.connect();
    const keys = this.buildKeys(context.userId, context.sessionKey);

    // Store metadata in HASH (efficient for partial updates)
    const metaFields: Record<string, string> = {
      sessionId: context.sessionId,
      channel: context.channel,
      createdAt: context.createdAt.toString(),
      updatedAt: context.updatedAt.toString(),
      activeTools: JSON.stringify(context.activeTools),
      tokenCounts: JSON.stringify(context.tokenCounts),
    };
    if (context.model) metaFields.model = context.model;
    if (context.provider) metaFields.provider = context.provider;
    if (context.metadata) metaFields.metadata = JSON.stringify(context.metadata);

    await this.redis.hset(keys.meta, metaFields);
    await this.redis.expire(keys.meta, this.ttlSeconds);

    // Clear and repopulate messages LIST (only on full context set)
    if (context.recentMessages.length > 0) {
      await this.redis.del(keys.messages);
      const pipeline = this.redis.pipeline();
      for (const msg of context.recentMessages) {
        pipeline.rpush(keys.messages, JSON.stringify(msg));
      }
      pipeline.ltrim(keys.messages, -this.maxMessages, -1);
      pipeline.expire(keys.messages, this.ttlSeconds);
      await pipeline.exec();
    }
  }

  /**
   * Update only metadata (efficient - no message read/write).
   */
  async updateMetadata(
    userId: string,
    sessionKey: string,
    updates: Partial<
      Pick<SessionContext, "activeTools" | "tokenCounts" | "model" | "provider" | "metadata">
    >,
  ): Promise<void> {
    await this.connect();
    const keys = this.buildKeys(userId, sessionKey);

    const fields: Record<string, string> = { updatedAt: Date.now().toString() };
    if (updates.activeTools) fields.activeTools = JSON.stringify(updates.activeTools);
    if (updates.tokenCounts) fields.tokenCounts = JSON.stringify(updates.tokenCounts);
    if (updates.model) fields.model = updates.model;
    if (updates.provider) fields.provider = updates.provider;
    if (updates.metadata) fields.metadata = JSON.stringify(updates.metadata);

    await this.redis.hset(keys.meta, fields);
    await this.redis.expire(keys.meta, this.ttlSeconds);
  }

  /**
   * Delete session context.
   */
  async deleteContext(userId: string, sessionKey: string): Promise<boolean> {
    await this.connect();
    const keys = this.buildKeys(userId, sessionKey);
    const deleted = await this.redis.del(keys.messages, keys.meta);
    return deleted > 0;
  }

  /**
   * Check if a session exists.
   */
  async hasContext(userId: string, sessionKey?: string): Promise<boolean> {
    await this.connect();

    if (sessionKey) {
      const keys = this.buildKeys(userId, sessionKey);
      const exists = await this.redis.exists(keys.meta);
      return exists > 0;
    }

    // Check if any session exists for this user
    const pattern = this.buildPattern(userId);
    const keys = await this.redis.keys(pattern);
    return keys.length > 0;
  }

  /**
   * Get all sessions for a user.
   */
  async getUserSessions(userId: string): Promise<SessionContext[]> {
    await this.connect();

    const pattern = this.buildPattern(userId);
    const metaKeys = await this.redis.keys(pattern);
    if (metaKeys.length === 0) return [];

    const sessions: SessionContext[] = [];
    for (const metaKey of metaKeys) {
      // Extract sessionKey from meta key
      const match = metaKey.match(new RegExp(`${KEY_PREFIX}:([^:]+):([^:]+)${META_SUFFIX}`));
      if (!match) continue;
      const sessionKey = match[2];

      const context = await this.getContext(userId, sessionKey);
      if (context) sessions.push(context);
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Close the Redis connection.
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }

  /**
   * Check if Redis is connected and healthy.
   */
  async ping(): Promise<boolean> {
    try {
      await this.connect();
      const result = await this.redis.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }
}
