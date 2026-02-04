/**
 * Context module for multi-tenant session management.
 *
 * Provides Redis-based in-session context caching with:
 * - User isolation via namespaced keys
 * - Automatic TTL-based expiration
 * - In-memory fallback for testing
 */

export type {
  ApiConfig,
  ContextStore,
  ExtendedChatCompletionRequest,
  ExtendedChatCompletionResponse,
  ResponseMetadata,
  SessionContext,
  SessionMessage,
  UserMetadata,
} from "./types.js";

export {
  closeContextStore,
  createContextStore,
  getContextStore,
  InMemoryContextStore,
  RedisContextManager,
} from "./store.js";

export type { ContextStoreConfig } from "./store.js";
