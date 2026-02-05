/**
 * Supabase-based auth state provider for Baileys.
 * Replaces useMultiFileAuthState with a Supabase-backed implementation.
 * Compatible with the Baileys AuthenticationState interface.
 */

import type { AuthenticationCreds, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { initAuthCreds, proto, BufferJSON } from "@whiskeysockets/baileys";
import type { SupabaseCredentialProvider, WhatsAppCredentials } from "../credentials/index.js";

/**
 * Baileys-compatible auth state backed by Supabase.
 */
export interface SupabaseAuthState {
  state: {
    creds: AuthenticationCreds;
    keys: {
      get: <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[],
      ) => Promise<{ [id: string]: SignalDataTypeMap[T] }>;
      set: (data: {
        [key in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[key] | null };
      }) => Promise<void>;
    };
  };
  saveCreds: () => Promise<void>;
}

/**
 * Create a Baileys-compatible auth state backed by Supabase credentials.
 *
 * @param userId - The user ID to load credentials for
 * @param provider - The Supabase credential provider
 * @param cachedCreds - Optional cached credentials to use (avoids extra fetch)
 */
export async function useSupabaseAuthState(
  userId: string,
  provider: SupabaseCredentialProvider,
  cachedCreds?: WhatsAppCredentials | null,
): Promise<SupabaseAuthState> {
  // Fetch or use cached credentials
  const whatsappCreds = cachedCreds ?? (await provider.fetchCredentials(userId));

  // Initialize creds - either from Supabase or fresh
  let creds: AuthenticationCreds;
  if (whatsappCreds?.creds && Object.keys(whatsappCreds.creds).length > 0) {
    // Credentials from Supabase have already been revived by reviveBuffers()
    creds = whatsappCreds.creds as AuthenticationCreds;
  } else {
    // Initialize fresh credentials
    creds = initAuthCreds();
  }

  // In-memory key store (initialized from Supabase)
  const keyStore = new Map<string, unknown>();

  // Load existing keys into memory
  if (whatsappCreds?.keys) {
    for (const [keyType, keyMap] of whatsappCreds.keys.entries()) {
      for (const [keyId, keyData] of Object.entries(keyMap)) {
        const storeKey = `${keyType}:${keyId}`;
        keyStore.set(storeKey, keyData);
      }
    }
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          for (const id of ids) {
            const storeKey = `${type}:${id}`;
            const data = keyStore.get(storeKey);
            if (data !== undefined) {
              // Data is already in correct format (revived by reviveBuffers)
              result[id] = data as SignalDataTypeMap[typeof type];
            }
          }
          return result;
        },
        set: async (data) => {
          // Batch updates for Supabase
          const updates: Array<{ keyType: string; keyId: string; data: unknown }> = [];
          const deletes: Array<{ keyType: string; keyIds: string[] }> = [];

          for (const [type, typeData] of Object.entries(data)) {
            if (!typeData) continue;
            const deleteIds: string[] = [];

            for (const [id, value] of Object.entries(typeData)) {
              const storeKey = `${type}:${id}`;

              if (value === null) {
                // Delete key
                keyStore.delete(storeKey);
                deleteIds.push(id);
              } else {
                // Store key (serialize with BufferJSON)
                const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
                keyStore.set(storeKey, serialized);
                updates.push({ keyType: type, keyId: id, data: serialized });
              }
            }

            if (deleteIds.length > 0) {
              deletes.push({ keyType: type, keyIds: deleteIds });
            }
          }

          // Persist to Supabase (fire-and-forget for performance)
          Promise.all([
            ...updates.map((u) => provider.saveKey(userId, u.keyType, u.keyId, u.data)),
            ...deletes.map((d) => provider.deleteKeys(userId, d.keyType, d.keyIds)),
          ]).catch((err) => {
            console.error(`Failed to persist keys for ${userId}:`, err);
          });
        },
      },
    },
    saveCreds: async () => {
      // Serialize creds with BufferJSON for proper Buffer handling
      const serialized = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
      await provider.saveCredentials(userId, serialized);
    },
  };
}
