/**
 * Supabase-based credential provider for multi-tenant Telegram.
 * Fetches and decrypts user Telegram bot credentials from Supabase.
 */

import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Decrypted Telegram credentials structure.
 */
export interface TelegramCredentials {
  userId: string;
  /** Decrypted bot token from @BotFather */
  botToken: string;
  /** Bot username (e.g., "MyAwesomeBot") */
  botUsername?: string;
  /** Telegram bot user ID (numeric) */
  botId?: number;
  /** Session data (update_offset, preferences, etc.) */
  sessionData: Record<string, any>;
  /** Timestamp when credentials were fetched/decrypted */
  fetchedAt: number;
}

/**
 * Raw row from telegram_credentials table.
 */
interface TelegramCredentialRow {
  id: string;
  user_id: string;
  bot_token: string; // Encrypted
  bot_username: string | null;
  bot_id: number | null;
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
 * Supabase-based credential provider for Telegram.
 * Fetches encrypted bot tokens from telegram_credentials table and decrypts them.
 */
export class TelegramCredentialProvider {
  private supabase: SupabaseClient;
  private aesKey: string;

  constructor(options: { supabaseUrl: string; supabaseKey: string; aesKey: string }) {
    this.supabase = createClient(options.supabaseUrl, options.supabaseKey);
    this.aesKey = options.aesKey;
  }

  /**
   * Fetch and decrypt credentials for a specific user.
   */
  async fetchCredentials(userId: string): Promise<TelegramCredentials | null> {
    try {
      const { data, error } = await this.supabase
        .from("telegram_credentials")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // No credentials found
          return null;
        }
        throw new Error(`Failed to fetch Telegram credentials: ${error.message}`);
      }

      if (!data) {
        return null;
      }

      const row = data as TelegramCredentialRow;

      // Decrypt bot token
      const botToken = decryptAES256GCM(row.bot_token, this.aesKey);

      return {
        userId: row.user_id,
        botToken,
        botUsername: row.bot_username ?? undefined,
        botId: row.bot_id ?? undefined,
        sessionData: row.session_data ?? {},
        fetchedAt: Date.now(),
      };
    } catch (error) {
      console.error(
        `[TelegramCredentialProvider] Error fetching credentials for user ${userId}:`,
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
      botUsername?: string;
      botId?: number;
      sessionData?: Record<string, any>;
    },
  ): Promise<void> {
    try {
      // Encrypt bot token
      const encryptedToken = encryptAES256GCM(botToken, this.aesKey);

      const { error } = await this.supabase.from("telegram_credentials").upsert({
        user_id: userId,
        bot_token: encryptedToken,
        bot_username: options?.botUsername ?? null,
        bot_id: options?.botId ?? null,
        session_data: options?.sessionData ?? {},
        updated_at: new Date().toISOString(),
      });

      if (error) {
        throw new Error(`Failed to save Telegram credentials: ${error.message}`);
      }

      console.log(`[TelegramCredentialProvider] Saved credentials for user ${userId}`);
    } catch (error) {
      console.error(
        `[TelegramCredentialProvider] Error saving credentials for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Update session data for a user (e.g., update_offset).
   */
  async updateSessionData(userId: string, sessionData: Record<string, any>): Promise<void> {
    try {
      const { error } = await this.supabase
        .from("telegram_credentials")
        .update({
          session_data: sessionData,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) {
        throw new Error(`Failed to update session data: ${error.message}`);
      }
    } catch (error) {
      console.error(
        `[TelegramCredentialProvider] Error updating session data for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get all user IDs that have Telegram credentials.
   */
  async getAllUserIds(): Promise<string[]> {
    try {
      const { data, error } = await this.supabase.from("telegram_credentials").select("user_id");

      if (error) {
        throw new Error(`Failed to fetch user IDs: ${error.message}`);
      }

      return (data ?? []).map((row) => row.user_id);
    } catch (error) {
      console.error("[TelegramCredentialProvider] Error fetching user IDs:", error);
      throw error;
    }
  }

  /**
   * Delete credentials for a user.
   */
  async deleteCredentials(userId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from("telegram_credentials")
        .delete()
        .eq("user_id", userId);

      if (error) {
        throw new Error(`Failed to delete credentials: ${error.message}`);
      }

      console.log(`[TelegramCredentialProvider] Deleted credentials for user ${userId}`);
    } catch (error) {
      console.error(
        `[TelegramCredentialProvider] Error deleting credentials for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Check if credentials exist for a user.
   */
  async hasCredentials(userId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from("telegram_credentials")
        .select("id")
        .eq("user_id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return false;
        }
        throw error;
      }

      return !!data;
    } catch (error) {
      console.error(
        `[TelegramCredentialProvider] Error checking credentials for user ${userId}:`,
        error,
      );
      return false;
    }
  }
}

/**
 * Singleton instance for convenience.
 */
let telegramCredentialProvider: TelegramCredentialProvider | null = null;

/**
 * Get or create the global TelegramCredentialProvider instance.
 */
export function getTelegramCredentialProvider(): TelegramCredentialProvider {
  if (!telegramCredentialProvider) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const aesKey = process.env.AES_256_KEY;

    if (!supabaseUrl || !supabaseKey || !aesKey) {
      throw new Error(
        "Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, AES_256_KEY",
      );
    }

    telegramCredentialProvider = new TelegramCredentialProvider({
      supabaseUrl,
      supabaseKey,
      aesKey,
    });
  }

  return telegramCredentialProvider;
}
