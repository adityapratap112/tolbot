import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const TEST_AUTH_DIR = './test/baileys-session';

// ============================================
// Supabase Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const AES_256_KEY = process.env.AES_256_KEY;
const USER_ID = process.env.TEST_USER_ID || '291fdea1-f96f-44d1-bc9c-5c2e02c1ee89'; // Default to first user

let supabase = null;

// Initialize Supabase client
function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('⚠️  Supabase credentials not found. Credentials will only be saved locally.');
    return null;
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ============================================
// Encryption/Decryption Utilities
// ============================================
function encryptAES256(data, key) {
  try {
    const keyBuffer = Buffer.from(key, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
  } catch (error) {
    console.error('Encryption error:', error);
    throw error;
  }
}

function decryptAES256(encryptedData, key) {
  try {
    const keyBuffer = Buffer.from(key, 'hex');
    const parts = encryptedData.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    throw error;
  }
}

// ============================================
// Supabase Save Functions
// ============================================
async function saveCredentialsToSupabase(creds) {
  if (!supabase) {
    console.log('⚠️  Supabase not initialized, skipping cloud save');
    return;
  }

  try {
    console.log('\n💾 Saving credentials to Supabase...');

    // Prepare credential data
    const credentialData = {
      user_id: USER_ID,
      noise_key: creds.noiseKey,
      pairing_ephemeral_key_pair: creds.pairingEphemeralKeyPair,
      signed_identity_key: creds.signedIdentityKey,
      signed_pre_key: creds.signedPreKey,
      registration_id: creds.registrationId,
      adv_secret_key: creds.advSecretKey,
      me: creds.me,
      account: creds.account,
      platform: creds.platform,
      registered: creds.registered,
      account_sync_counter: creds.accountSyncCounter,
      account_settings: creds.accountSettings,
      next_pre_key_id: creds.nextPreKeyId,
      first_unuploaded_pre_key_id: creds.firstUnuploadedPreKeyId,
      processed_history_messages: creds.processedHistoryMessages,
      signal_identities: creds.signalIdentities,
      pairing_code: creds.pairingCode,
      last_prop_hash: creds.lastPropHash,
      routing_info: creds.routingInfo,
      additional_data: creds.additionalData,
      updated_at: new Date().toISOString(),
    };

    // Upsert credentials
    const { data, error } = await supabase
      .from('whatsapp_credentials')
      .upsert(credentialData, { onConflict: 'user_id' });

    if (error) {
      console.error('❌ Error saving credentials:', error);
      return;
    }

    console.log('✅ Credentials saved to Supabase');
  } catch (error) {
    console.error('❌ Failed to save credentials to Supabase:', error);
  }
}

async function saveKeysToSupabase(keys) {
  if (!supabase) {
    console.log('⚠️  Supabase not initialized, skipping cloud save');
    return;
  }

  try {
    console.log('\n💾 Saving keys to Supabase...');

    const keyRecords = [];

    // Process each key type
    for (const [keyType, keyMap] of Object.entries(keys)) {
      for (const [keyId, keyData] of Object.entries(keyMap)) {
        keyRecords.push({
          user_id: USER_ID,
          key_type: keyType,
          key_id: keyId,
          key_data: keyData,
        });
      }
    }

    if (keyRecords.length === 0) {
      console.log('⚠️  No keys to save');
      return;
    }

    // Upsert keys
    const { data, error } = await supabase
      .from('whatsapp_keys')
      .upsert(keyRecords, { onConflict: 'user_id,key_type,key_id' });

    if (error) {
      console.error('❌ Error saving keys:', error);
      return;
    }

    console.log(`✅ Saved ${keyRecords.length} keys to Supabase`);
  } catch (error) {
    console.error('❌ Failed to save keys to Supabase:', error);
  }
}

// Wrapper to log all operations
function createLoggingAuthState(originalState) {
  console.log('\n=== INITIAL STATE ===');
  console.log('Creds keys:', Object.keys(originalState.state.creds));
  console.log('Creds sample:', JSON.stringify(originalState.state.creds, null, 2).substring(0, 500));

  return {
    state: {
      creds: originalState.state.creds,
      keys: {
        get: async (type, ids) => {
          console.log('\n=== KEYS GET REQUEST ===');
          console.log('Type:', type);
          console.log('IDs:', ids);

          const result = await originalState.state.keys.get(type, ids);

          console.log('Result keys:', Object.keys(result));
          console.log('Result sample:', JSON.stringify(result, null, 2).substring(0, 300));

          return result;
        },
        set: async (data) => {
          console.log('\n=== KEYS SET REQUEST ===');
          console.log('Categories:', Object.keys(data));

          for (const category in data) {
            console.log(`\nCategory: ${category}`);
            console.log(`  IDs:`, Object.keys(data[category]));

            // Show sample of first key
            const firstId = Object.keys(data[category])[0];
            if (firstId) {
              const sample = data[category][firstId];
              console.log(`  Sample (${firstId}):`, JSON.stringify(sample, null, 2).substring(0, 300));
            }
          }

          // Save locally
          await originalState.state.keys.set(data);

          // Save to Supabase
          await saveKeysToSupabase(data);
        }
      }
    },
    saveCreds: async () => {
      console.log('\n=== SAVE CREDS CALLED ===');
      console.log('Creds to save:', JSON.stringify(originalState.state.creds, null, 2).substring(0, 500));

      // Save locally
      await originalState.saveCreds();

      // Save to Supabase
      await saveCredentialsToSupabase(originalState.state.creds);
    }
  };
}

async function testBaileysAuth() {
  console.log('Starting Baileys authentication test with QR CODE...\n');

  // Initialize Supabase
  supabase = initSupabase();
  if (supabase) {
    console.log('✅ Supabase initialized - credentials will be saved to cloud');
    console.log(`   User ID: ${USER_ID}\n`);
  } else {
    console.log('⚠️  Supabase not configured - credentials will only be saved locally\n');
  }

  // Clean up old test directory
  try {
    await fs.rm(TEST_AUTH_DIR, { recursive: true, force: true });
  } catch (e) { }

  await fs.mkdir(TEST_AUTH_DIR, { recursive: true });

  // Create auth state with logging
  const originalAuthState = await useMultiFileAuthState(TEST_AUTH_DIR);
  const authState = createLoggingAuthState(originalAuthState);

  const { version } = await fetchLatestBaileysVersion();

  let connectionAttempts = 0;
  const maxAttempts = 3;

  async function createSocket() {
    connectionAttempts++;
    console.log(`\n📡 Creating socket (attempt ${connectionAttempts}/${maxAttempts})...\n`);

    const sock = makeWASocket({
      auth: authState.state,
      version,
      printQRInTerminal: false, // We'll handle QR display manually
      browser: ['Chrome', 'Chrome', '131.0.0.0'], // More realistic browser config
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });

    return sock;
  }

  let sock = await createSocket();

  sock.ev.on('creds.update', () => {
    console.log('\n=== CREDS UPDATE EVENT ===');
    authState.saveCreds();
  });

  sock.ev.on('connection.update', async (update) => {
    console.log('\n=== CONNECTION UPDATE ===');
    console.log('Update:', JSON.stringify(update, null, 2));

    const { connection, lastDisconnect, qr } = update;

    // Handle QR code display
    if (qr) {
      console.log('\n=== QR CODE RECEIVED ===');
      console.log('Generating QR code for scanning...\n');

      try {
        // Print QR code to terminal
        const qrString = await QRCode.toString(qr, { type: 'terminal', small: true });
        console.log(qrString);
        console.log('\n📱 Scan this QR code with WhatsApp on your phone:');
        console.log('   1. Open WhatsApp on your phone');
        console.log('   2. Tap Menu or Settings');
        console.log('   3. Tap Linked Devices');
        console.log('   4. Tap Link a Device');
        console.log('   5. Point your phone at this screen to scan the QR code\n');
        console.log('⚠️  IMPORTANT: If you see "Couldn\'t link device" on WhatsApp:');
        console.log('   - This is a WhatsApp server-side rejection (not a code issue)');
        console.log('   - WhatsApp may detect this as suspicious activity');
        console.log('   - Try: waiting 5-10 minutes and scanning again');
        console.log('   - Or: use a different phone number\n');
      } catch (err) {
        console.error('Error generating QR code:', err);
      }
    }

    if (connection === 'open') {
      console.log('\n=== CONNECTION OPENED ===');
      console.log('✅ Successfully connected! Checking saved files...\n');

      // List all files created
      const files = await fs.readdir(TEST_AUTH_DIR);
      console.log('📁 Files created:', files.length);
      console.log('Files:', files.join(', '));

      // Show content of each file
      for (const file of files) {
        const filePath = path.join(TEST_AUTH_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(content);

        console.log(`\n${'='.repeat(60)}`);
        console.log(`📄 FILE: ${file}`);
        console.log(`${'='.repeat(60)}`);
        console.log('Size:', content.length, 'bytes');
        console.log('Top-level keys:', Object.keys(parsed));

        // Show detailed structure for each key
        for (const key of Object.keys(parsed)) {
          const value = parsed[key];
          if (value && typeof value === 'object') {
            if (Array.isArray(value)) {
              console.log(`  ${key}: Array[${value.length}]`);
            } else if (value.type === 'Buffer') {
              console.log(`  ${key}: Buffer[${value.data?.length || 0} bytes]`);
            } else {
              console.log(`  ${key}: Object with keys:`, Object.keys(value));
            }
          } else {
            console.log(`  ${key}:`, typeof value, value);
          }
        }

        console.log('\nFull content (first 500 chars):');
        console.log(content.substring(0, 500) + '...\n');
      }

      console.log('\n✅ Authentication data captured successfully!');
      console.log(`📂 All files saved in: ${TEST_AUTH_DIR}\n`);

      // Disconnect and exit
      setTimeout(() => {
        sock.end();
        process.exit(0);
      }, 2000);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isRestartRequired = statusCode === DisconnectReason.restartRequired;

      console.log(`\n❌ Connection closed (status: ${statusCode})`);
      console.log('Is logged out?', isLoggedOut);
      console.log('Restart required?', isRestartRequired);

      // Show what files were created even on failure
      console.log('\n=== Checking files created so far ===');
      try {
        const files = await fs.readdir(TEST_AUTH_DIR);
        console.log('Files:', files);

        for (const file of files) {
          const filePath = path.join(TEST_AUTH_DIR, file);
          const content = await fs.readFile(filePath, 'utf-8');
          console.log(`\n📄 ${file} (${content.length} bytes)`);
          console.log('Keys:', Object.keys(JSON.parse(content)));
        }
      } catch (e) {
        console.log('No files created yet');
      }

      // Handle restart required error - this is expected after successful pairing
      if (isRestartRequired && connectionAttempts < maxAttempts) {
        console.log('\n🔄 Restarting connection after pairing...');
        await new Promise(r => setTimeout(r, 2000)); // Wait before reconnecting
        sock.end();
        sock = await createSocket();
      } else if (isLoggedOut) {
        console.log('\n✅ Logged out successfully');
        process.exit(0);
      } else if (connectionAttempts >= maxAttempts) {
        console.log('\n❌ Max connection attempts reached');
        process.exit(1);
      }
    }
  });
}

testBaileysAuth().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
