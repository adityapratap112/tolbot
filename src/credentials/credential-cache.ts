/**
 * Redis-based credential cache for multi-tenant WhatsApp.
 * Caches decrypted credentials to avoid repeated Supabase queries.
 */

import { Redis } from "ioredis";
import type { WhatsAppCredentials, SupabaseCredentialProvider } from "./supabase-credentials.js";
import { reviveBuffers } from "./supabase-credentials.js";

const CACHE_PREFIX = "wa:creds:";
const DEFAULT_TTL_SECONDS = 15 * 60; // 15 minutes

/**
 * Serializable version of credentials for Redis storage.
 */
interface SerializedCredentials {
  userId: string;
  creds: Record<string, unknown>;
  keys: Array<[string, Record<string, unknown>]>;
  fetchedAt: number;
}

/**
 * Redis-backed credential cache.
 * Provides efficient caching with TTL for WhatsApp credentials.
 */
export class CredentialCache {
  private redis: Redis;
  private ttlSeconds: number;

  constructor(options?: { redis?: Redis; redisUrl?: string; ttlSeconds?: number }) {
    if (options?.redis) {
      this.redis = options.redis;
    } else {
      let redisUrl = options?.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
      // Normalize JDBC-style Redis URLs
      if (redisUrl.startsWith("jdbc:redis:")) {
        redisUrl = redisUrl.replace("jdbc:redis:", "redis:");
      }
      this.redis = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
      });
    }
    this.ttlSeconds = options?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  /**
   * Build Redis key for a user's credentials.
   */
  private buildKey(userId: string): string {
    return `${CACHE_PREFIX}${userId}`;
  }

  /**
   * Serialize credentials for Redis storage.
   * Converts Map to array of entries for JSON compatibility.
   */
  private serialize(creds: WhatsAppCredentials): string {
    const serialized: SerializedCredentials = {
      userId: creds.userId,
      creds: creds.creds,
      keys: Array.from(creds.keys.entries()),
      fetchedAt: creds.fetchedAt,
    };
    return JSON.stringify(serialized);
  }

  /**
   * Deserialize credentials from Redis.
   * Converts array entries back to Map.
   */
  private deserialize(data: string): WhatsAppCredentials {
    const parsed: SerializedCredentials = JSON.parse(data);
    return {
      userId: parsed.userId,
      creds: reviveBuffers(parsed.creds),
      keys: new Map(parsed.keys.map(([k, v]) => [k, reviveBuffers(v)])),
      fetchedAt: parsed.fetchedAt,
    };
  }

  /**
   * Get cached credentials for a user.
   * Returns null if not cached or expired.
   */
  async get(userId: string): Promise<WhatsAppCredentials | null> {
    const key = this.buildKey(userId);
    const data = await this.redis.get(key);
    if (!data) return null;

    try {
      return this.deserialize(data);
    } catch (err) {
      console.error(`Failed to deserialize cached credentials for ${userId}:`, err);
      await this.redis.del(key);
      return null;
    }
  }

  /**
   * Cache credentials for a user.
   */
  async set(creds: WhatsAppCredentials): Promise<void> {
    const key = this.buildKey(creds.userId);
    const data = this.serialize(creds);
    await this.redis.setex(key, this.ttlSeconds, data);
  }

  /**
   * Get cached credentials or fetch from provider.
   * This is the main entry point for credential access.
   */
  async getOrFetch(
    userId: string,
    provider: SupabaseCredentialProvider,
  ): Promise<WhatsAppCredentials | null> {
    // Check cache first
    const cached = await this.get(userId);
    if (cached) {
      return cached;
    }

    // Fetch from Supabase
    const fresh = await provider.fetchCredentials(userId);
    if (!fresh) {
      return null;
    }

    // Cache for future requests
    await this.set(fresh);
    return fresh;
  }

  /**
   * Invalidate cached credentials for a user.
   * Call this when credentials are updated or user re-authenticates.
   */
  async invalidate(userId: string): Promise<void> {
    const key = this.buildKey(userId);
    await this.redis.del(key);
  }

  /**
   * Refresh cached credentials from Supabase.
   * Forces a fetch even if cached.
   */
  async refresh(
    userId: string,
    provider: SupabaseCredentialProvider,
  ): Promise<WhatsAppCredentials | null> {
    await this.invalidate(userId);
    return this.getOrFetch(userId, provider);
  }

  /**
   * Close the Redis connection.
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}

// Singleton instance
let cacheInstance: CredentialCache | null = null;

/**
 * Get or create the singleton CredentialCache.
 */
export function getCredentialCache(): CredentialCache {
  if (!cacheInstance) {
    cacheInstance = new CredentialCache();
  }
  return cacheInstance;
}

/**
 * Set a custom CredentialCache instance (for testing).
 */
export function setCredentialCache(cache: CredentialCache): void {
  cacheInstance = cache;
}
