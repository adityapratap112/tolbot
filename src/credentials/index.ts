/**
 * Credentials module for multi-tenant WhatsApp and Telegram.
 * Re-exports credential providers and cache.
 */

export {
  SupabaseCredentialProvider,
  getSupabaseCredentialProvider,
  type WhatsAppCredentials,
} from "./supabase-credentials.js";

export {
  TelegramCredentialProvider,
  getTelegramCredentialProvider,
  type TelegramCredentials,
} from "./telegram-credentials.js";

export {
  DiscordCredentialProvider,
  getDiscordCredentialProvider,
  type DiscordCredentials,
} from "./discord-credentials.js";

export { CredentialCache, getCredentialCache, setCredentialCache } from "./credential-cache.js";
