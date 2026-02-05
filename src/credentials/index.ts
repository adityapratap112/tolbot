/**
 * Credentials module for multi-tenant WhatsApp.
 * Re-exports credential provider and cache.
 */

export {
  SupabaseCredentialProvider,
  getSupabaseCredentialProvider,
  type WhatsAppCredentials,
} from "./supabase-credentials.js";

export { CredentialCache, getCredentialCache, setCredentialCache } from "./credential-cache.js";
