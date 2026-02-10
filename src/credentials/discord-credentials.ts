/**
 * Supabase-based credential provider for multi-tenant Discord.
 * Fetches and decrypts user Discord bot credentials from Supabase.
 */

import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Decrypted Discord credentials structure.
 */
export interface DiscordCredentials {
  userId: string;
  /** Decrypted bot token */
  botToken: string;
  /** Discord Application ID */
  applicationId?: string;
  /** Discord Public Key */
  publicKey?: string;
  /** Session data */
  sessionData: Record<string, any>;
  /** Timestamp when credentials were fetched/decrypted */
  fetchedAt: number;
}

/**
 * Raw row from discord_credentials table.
 */
interface DiscordCredentialRow {
  id: string;
  user_id: string;
  bot_token: string; // Encrypted
  application_id: string | null;
  public_key: string | null;
  session_data: any; // JSONB
  created_at: string;
  updated_at: string | null;
}

/**
 * AES-256-GCM encryption.
 * Returns format: iv:encryptedText:authTag (hex-encoded, colon-separated)
 */
function encryptAES256GCM(plaintext: string, keyHex: string): string {
  const keyBuffer = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(12); // 12 bytes for GCM

  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
  let encrypted = cipher.update(plaintext, "utf-8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
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
 * Supabase-based credential provider for Discord.
 * Fetches encrypted bot tokens from discord_credentials table and decrypts them.
 */
export class DiscordCredentialProvider {
  private supabase: SupabaseClient;
  private aesKey: string;

  constructor(options: { supabaseUrl: string; supabaseKey: string; aesKey: string }) {
    this.supabase = createClient(options.supabaseUrl, options.supabaseKey);
    this.aesKey = options.aesKey;
  }

  /**
   * Fetch and decrypt credentials for a specific user.
   */
  async fetchCredentials(userId: string): Promise<DiscordCredentials | null> {
    try {
      const { data, error } = await this.supabase
        .from("discord_credentials")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // No credentials found
          return null;
        }
        throw new Error(`Failed to fetch Discord credentials: ${error.message}`);
      }

      if (!data) {
        return null;
      }

      const row = data as DiscordCredentialRow;

      // Decrypt bot token
      const botToken = decryptAES256GCM(row.bot_token, this.aesKey);

      return {
        userId: row.user_id,
        botToken,
        applicationId: row.application_id ?? undefined,
        publicKey: row.public_key ?? undefined,
        sessionData: row.session_data ?? {},
        fetchedAt: Date.now(),
      };
    } catch (error) {
      console.error(
        `[DiscordCredentialProvider] Error fetching credentials for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Save encrypted credentials for a user.
   */
  async saveCredentials(
    userId: string,
    botToken: string,
    options?: {
      applicationId?: string;
      publicKey?: string;
      sessionData?: Record<string, any>;
    },
  ): Promise<void> {
    try {
      // Encrypt bot token
      const encryptedToken = encryptAES256GCM(botToken, this.aesKey);

      const { error } = await this.supabase.from("discord_credentials").upsert({
        user_id: userId,
        bot_token: encryptedToken,
        application_id: options?.applicationId ?? null,
        public_key: options?.publicKey ?? null,
        session_data: options?.sessionData ?? {},
        updated_at: new Date().toISOString(),
      });

      if (error) {
        throw new Error(`Failed to save Discord credentials: ${error.message}`);
      }

      console.log(`[DiscordCredentialProvider] Saved credentials for user ${userId}`);
    } catch (error) {
      console.error(
        `[DiscordCredentialProvider] Error saving credentials for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Delete credentials for a user.
   */
  async deleteCredentials(userId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from("discord_credentials")
        .delete()
        .eq("user_id", userId);

      if (error) {
        throw new Error(`Failed to delete credentials: ${error.message}`);
      }

      console.log(`[DiscordCredentialProvider] Deleted credentials for user ${userId}`);
    } catch (error) {
      console.error(
        `[DiscordCredentialProvider] Error deleting credentials for user ${userId}:`,
        error,
      );
      throw error;
    }
  }
}

/**
 * Singleton instance for convenience.
 */
let discordCredentialProvider: DiscordCredentialProvider | null = null;

/**
 * Get or create the global DiscordCredentialProvider instance.
 */
export function getDiscordCredentialProvider(): DiscordCredentialProvider {
  if (!discordCredentialProvider) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const aesKey = process.env.AES_256_KEY;

    if (!supabaseUrl || !supabaseKey || !aesKey) {
      throw new Error(
        "Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, AES_256_KEY",
      );
    }

    discordCredentialProvider = new DiscordCredentialProvider({
      supabaseUrl,
      supabaseKey,
      aesKey,
    });
  }

  return discordCredentialProvider;
}
