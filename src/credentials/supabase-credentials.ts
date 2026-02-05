/**
 * Supabase-based credential provider for multi-tenant WhatsApp.
 * Fetches and decrypts user WhatsApp credentials from Supabase.
 */

import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Decrypted WhatsApp credentials structure.
 * Contains full Baileys creds.json + session keys.
 */
export interface WhatsAppCredentials {
  userId: string;
  /** Baileys creds structure (signedIdentityKey, signedPreKey, etc.) */
  creds: Record<string, unknown>;
  /** Baileys session keys (app-state-sync, pre-key, sender-key, etc.) */
  keys: Map<string, Record<string, unknown>>;
  /** Timestamp when credentials were fetched/decrypted */
  fetchedAt: number;
}

/**
 * Raw row from whatsapp_keys table.
 */
interface WhatsAppKeyRow {
  id: string;
  user_id: string;
  key_type: string;
  key_id: string;
  key_data: any; // Can be string (encrypted) or object (raw JSON)
  created_at: string;
  updated_at: string | null;
}

/**
 * AES-256-GCM decryption.
 * Format: iv:encryptedText:authTag (hex-encoded, colon-separated)
 */
function decryptAES256GCM(encryptedData: string, keyHex: string): string {
  const keyBuffer = Buffer.from(keyHex, "hex");
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format. Expected: iv:encryptedText:authTag");
  }

  const iv = Buffer.from(parts[0], "hex");
  const encrypted = Buffer.from(parts[1], "hex");
  const authTag = Buffer.from(parts[2], "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString("utf-8");
}

/**
 * Recursively convert JSON Buffer representations back to actual Buffers.
 * Supabase stores Buffers as {data: [1,2,3...], type: "Buffer"}
 */
export function reviveBuffers(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Check if this is a Buffer representation
  if (typeof obj === "object" && obj.type === "Buffer" && Array.isArray(obj.data)) {
    return Buffer.from(obj.data);
  }

  // Recursively process arrays
  if (Array.isArray(obj)) {
    return obj.map(reviveBuffers);
  }

  // Recursively process objects
  if (typeof obj === "object") {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = reviveBuffers(obj[key]);
    }
    return result;
  }

  return obj;
}

/**
 * Supabase-based credential provider.
 * Fetches encrypted credentials from whatsapp_keys table and decrypts them.
 */
export class SupabaseCredentialProvider {
  private supabase: SupabaseClient;
  private aesKey: string;

  constructor(options: { supabaseUrl: string; supabaseKey: string; aesKey: string }) {
    this.supabase = createClient(options.supabaseUrl, options.supabaseKey);
    this.aesKey = options.aesKey;
  }

  /**
   * Get all user IDs that have WhatsApp credentials.
   */
  async getAllUserIds(): Promise<string[]> {
    const { data, error } = await this.supabase
      .from("whatsapp_credentials")
      .select("user_id")
      .limit(100);

    if (error) {
      throw new Error(`Failed to fetch user IDs: ${error.message}`);
    }

    return (data ?? []).map((row) => row.user_id);
  }

  /**
   * Fetch and decrypt WhatsApp credentials for a user.
   * Returns null if user has no credentials stored.
   */
  async fetchCredentials(userId: string): Promise<WhatsAppCredentials | null> {
    // 1. Fetch main credentials from whatsapp_credentials table
    const { data: credsRows, error: credsError } = await this.supabase
      .from("whatsapp_credentials")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (credsError) {
      throw new Error(`Supabase credentials query failed: ${credsError.message}`);
    }

    let creds: Record<string, unknown> = {};
    if (credsRows) {
      // Map columns back to Baileys AuthenticationCreds structure
      // Note: DB uses snake_case, Baileys uses camelCase
      creds = {
        noiseKey: credsRows.noise_key,
        pairingEphemeralKeyPair: credsRows.pairing_ephemeral_key_pair,
        signedIdentityKey: credsRows.signed_identity_key,
        signedPreKey: credsRows.signed_pre_key,
        registrationId: credsRows.registration_id,
        advSecretKey: credsRows.adv_secret_key,
        me: credsRows.me,
        account: credsRows.account,
        platform: credsRows.platform,
        registered: credsRows.registered,
        accountSyncCounter: credsRows.account_sync_counter,
        accountSettings: credsRows.account_settings,
        nextPreKeyId: credsRows.next_pre_key_id,
        firstUnuploadedPreKeyId: credsRows.first_unuploaded_pre_key_id,
        processedHistoryMessages: credsRows.processed_history_messages,
        signalIdentities: credsRows.signal_identities,
        pairingCode: credsRows.pairing_code,
        lastPropHash: credsRows.last_prop_hash,
        routingInfo: credsRows.routing_info,
        additionalData: credsRows.additional_data,
      };

      // Remove null/undefined entries
      Object.keys(creds).forEach(
        (key) => (creds[key] === null || creds[key] === undefined) && delete creds[key],
      );

      // Convert Buffer representations back to actual Buffers
      creds = reviveBuffers(creds);
      // Attempt decryption for any field that might be encrypted
      for (const key of Object.keys(creds)) {
        if (typeof creds[key] === "string" && (creds[key] as string).startsWith("iv:")) {
          try {
            const decrypted = decryptAES256GCM(creds[key] as string, this.aesKey);
            creds[key] = JSON.parse(decrypted);
          } catch (err) {
            console.warn(`Failed to decrypt creds field ${key}:`, err);
          }
        }
      }
    }

    // 2. Fetch keys from whatsapp_keys table
    const { data: keysRows, error: keysError } = await this.supabase
      .from("whatsapp_keys")
      .select("*")
      .eq("user_id", userId);

    if (keysError) {
      throw new Error(`Supabase keys query failed: ${keysError.message}`);
    }

    const keys = new Map<string, Record<string, unknown>>();

    if (keysRows) {
      for (const row of keysRows as WhatsAppKeyRow[]) {
        try {
          let parsed: unknown;
          const rawData = row.key_data;

          if (typeof rawData === "string" && rawData.startsWith("iv:")) {
            // Decrypt encrypted data
            const decrypted = decryptAES256GCM(rawData, this.aesKey);
            parsed = JSON.parse(decrypted);
          } else if (typeof rawData === "string") {
            // Regular JSON string
            parsed = JSON.parse(rawData);
          } else {
            // Already an object (JSON column) - revive Buffers
            parsed = reviveBuffers(rawData);
          }

          if (row.key_type === "creds" && Object.keys(creds).length === 0) {
            // If we didn't find anything in whatsapp_credentials, use this
            creds = parsed as Record<string, unknown>;
          } else {
            const existing = keys.get(row.key_type) ?? {};
            keys.set(row.key_type, { ...existing, [row.key_id]: parsed });
          }
        } catch (err) {
          console.error(`Failed to process key ${row.key_type}:${row.key_id}:`, err);
        }
      }
    }

    // Must have creds to be valid
    if (Object.keys(creds).length === 0) {
      return null;
    }

    return {
      userId,
      creds,
      keys,
      fetchedAt: Date.now(),
    };
  }

  /**
   * Save or update credentials to Supabase (for auth state persistence).
   */
  async saveCredentials(userId: string, creds: Record<string, unknown>): Promise<void> {
    const encrypted = this.encryptData(JSON.stringify(creds));

    const { error } = await this.supabase.from("whatsapp_keys").upsert(
      {
        user_id: userId,
        key_type: "creds",
        key_id: "main",
        key_data: encrypted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,key_type,key_id" },
    );

    if (error) {
      throw new Error(`Failed to save credentials: ${error.message}`);
    }
  }

  /**
   * Save a single key to Supabase.
   */
  async saveKey(userId: string, keyType: string, keyId: string, data: unknown): Promise<void> {
    const encrypted = this.encryptData(JSON.stringify(data));

    const { error } = await this.supabase.from("whatsapp_keys").upsert(
      {
        user_id: userId,
        key_type: keyType,
        key_id: keyId,
        key_data: encrypted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,key_type,key_id" },
    );

    if (error) {
      throw new Error(`Failed to save key ${keyType}:${keyId}: ${error.message}`);
    }
  }

  /**
   * Delete keys from Supabase.
   */
  async deleteKeys(userId: string, keyType: string, keyIds: string[]): Promise<void> {
    const { error } = await this.supabase
      .from("whatsapp_keys")
      .delete()
      .eq("user_id", userId)
      .eq("key_type", keyType)
      .in("key_id", keyIds);

    if (error) {
      throw new Error(`Failed to delete keys: ${error.message}`);
    }
  }

  /**
   * Encrypt data with AES-256-GCM.
   * Returns: iv:encryptedText:authTag (hex-encoded)
   */
  private encryptData(plaintext: string): string {
    const keyBuffer = Buffer.from(this.aesKey, "hex");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);

    let encrypted = cipher.update(plaintext, "utf-8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
  }
}

// Singleton instance
let providerInstance: SupabaseCredentialProvider | null = null;

/**
 * Get or create the singleton SupabaseCredentialProvider.
 * Reads configuration from environment variables.
 */
export function getSupabaseCredentialProvider(): SupabaseCredentialProvider {
  if (!providerInstance) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const aesKey = process.env.AES_256_KEY;

    if (!supabaseUrl || !supabaseKey || !aesKey) {
      throw new Error(
        "Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, AES_256_KEY",
      );
    }

    providerInstance = new SupabaseCredentialProvider({
      supabaseUrl,
      supabaseKey,
      aesKey,
    });
  }

  return providerInstance;
}
