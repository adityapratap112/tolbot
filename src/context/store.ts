/**
 * Context store factory and singleton management.
 * Provides a unified interface for context storage backends.
 */

import { RedisContextManager } from "./redis-context.js";
import type { ContextStore, SessionContext, SessionMessage } from "./types.js";

export type { ContextStore, SessionContext, SessionMessage };
export { RedisContextManager };

/** Singleton instance of the context store */
let globalContextStore: ContextStore | null = null;

export type ContextStoreConfig = {
  /** Storage backend type */
  type: "redis" | "memory";
  /** Redis URL (for redis type) */
  redisUrl?: string;
  /** TTL for session context in seconds */
  ttlSeconds?: number;
};

/**
 * Create a context store based on configuration.
 */
export function createContextStore(config: ContextStoreConfig): ContextStore {
  if (config.type === "redis") {
    return new RedisContextManager({
      redisUrl: config.redisUrl,
      ttlSeconds: config.ttlSeconds,
    });
  }
  if (config.type === "memory") {
    return new InMemoryContextStore(config.ttlSeconds);
  }
  throw new Error(`Unknown context store type: ${String(config.type)}`);
}

/**
 * Get or create the global context store singleton.
 */
export function getContextStore(config?: ContextStoreConfig): ContextStore {
  if (!globalContextStore) {
    const defaultConfig: ContextStoreConfig = config ?? {
      type: "redis",
      redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    };
    globalContextStore = createContextStore(defaultConfig);
  }
  return globalContextStore;
}

/**
 * Close and clear the global context store.
 */
export async function closeContextStore(): Promise<void> {
  if (globalContextStore) {
    await globalContextStore.close();
    globalContextStore = null;
  }
}

/**
 * In-memory implementation of ContextStore for testing and fallback.
 */
export class InMemoryContextStore implements ContextStore {
  private store = new Map<string, { context: SessionContext; expiresAt: number }>();
  private ttlMs: number;

  constructor(ttlSeconds = 86400) {
    this.ttlMs = ttlSeconds * 1000;
  }

  private buildKey(userId: string, sessionKey: string): string {
    return `${userId}:${sessionKey}`;
  }

  private cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.store.entries());
    for (const [key, entry] of entries) {
      if (entry.expiresAt < now) {
        this.store.delete(key);
      }
    }
  }

  async getContext(userId: string, sessionKey?: string): Promise<SessionContext | null> {
    this.cleanup();
    if (sessionKey) {
      const key = this.buildKey(userId, sessionKey);
      const entry = this.store.get(key);
      return entry ? entry.context : null;
    }

    // Find most recent session for user
    const sessions: SessionContext[] = [];
    const entries = Array.from(this.store.entries());
    for (const [key, entry] of entries) {
      if (key.startsWith(`${userId}:`)) {
        sessions.push(entry.context);
      }
    }
    if (sessions.length === 0) return null;
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  async setContext(context: SessionContext): Promise<void> {
    const key = this.buildKey(context.userId, context.sessionKey);
    this.store.set(key, {
      context,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  async deleteContext(userId: string, sessionKey: string): Promise<boolean> {
    const key = this.buildKey(userId, sessionKey);
    return this.store.delete(key);
  }

  async hasContext(userId: string, sessionKey?: string): Promise<boolean> {
    this.cleanup();
    if (sessionKey) {
      return this.store.has(this.buildKey(userId, sessionKey));
    }
    const keys = Array.from(this.store.keys());
    for (const key of keys) {
      if (key.startsWith(`${userId}:`)) return true;
    }
    return false;
  }

  async getUserSessions(userId: string): Promise<SessionContext[]> {
    this.cleanup();
    const sessions: SessionContext[] = [];
    const entries = Array.from(this.store.entries());
    for (const [key, entry] of entries) {
      if (key.startsWith(`${userId}:`)) {
        sessions.push(entry.context);
      }
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
