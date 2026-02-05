import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const AES_256_KEY = process.env.AES_256_KEY;

console.log('🔍 Environment Check:');
console.log(`  SUPABASE_URL: ${SUPABASE_URL ? '✅ Set' : '❌ Missing'}`);
console.log(`  SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`  AES_256_KEY: ${AES_256_KEY ? '✅ Set' : '❌ Missing'}`);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !AES_256_KEY) {
  console.error('\n❌ Missing required environment variables!');
  console.error('Add these to your .env file:');
  console.error('  SUPABASE_URL=https://your-project.supabase.co');
  console.error('  SUPABASE_ANON_KEY=your-anon-key');
  console.error('  AES_256_KEY=your-32-byte-hex-key');
  process.exit(1);
}

// ============================================
// AES-256 Decryption Utility
// ============================================
function decryptAES256(encryptedData: string, key: string): string {
  try {
    // Convert hex key to buffer (should be 32 bytes for AES-256)
    const keyBuffer = Buffer.from(key, 'hex');
    
    // Parse encrypted data (format: iv:encryptedText:authTag)
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format. Expected: iv:encryptedText:authTag');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');

    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf-8');
  } catch (error) {
    console.error('Decryption error:', error);
    throw error;
  }
}

// ============================================
// Main Test Function
// ============================================
async function testSupabaseConnection() {
  try {
    console.log('\n📡 Connecting to Supabase...');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Test 1: Fetch users
    console.log('\n📋 Test 1: Fetching users...');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*')
      .limit(5);

    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
    } else {
      console.log(`✅ Found ${users?.length || 0} users`);
      if (users && users.length > 0) {
        console.log('Sample user:', JSON.stringify(users[0], null, 2));
      }
    }

    // Test 2: Fetch WhatsApp credentials
    console.log('\n📋 Test 2: Fetching WhatsApp credentials...');
    const { data: creds, error: credsError } = await supabase
      .from('whatsapp_credentials')
      .select('*')
      .limit(5);

    if (credsError) {
      console.error('❌ Error fetching credentials:', credsError);
    } else {
      console.log(`✅ Found ${creds?.length || 0} WhatsApp credentials`);
      if (creds && creds.length > 0) {
        console.log('Sample credential (first 500 chars):');
        console.log(JSON.stringify(creds[0], null, 2).substring(0, 500));
      }
    }

    // Test 3: Fetch ALL WhatsApp keys (no limit)
    console.log('\n📋 Test 3: Fetching ALL WhatsApp keys...');
    const { data: keys, error: keysError } = await supabase
      .from('whatsapp_keys')
      .select('*');

    if (keysError) {
      console.error('❌ Error fetching keys:', keysError);
    } else {
      console.log(`✅ Found ${keys?.length || 0} WhatsApp keys total`);

      // Group keys by user_id to see how many users
      const keysByUser: Record<string, typeof keys> = {};
      const keysByType: Record<string, number> = {};

      if (keys) {
        for (const key of keys) {
          // Group by user
          if (!keysByUser[key.user_id]) {
            keysByUser[key.user_id] = [];
          }
          keysByUser[key.user_id].push(key);

          // Count by type
          keysByType[key.key_type] = (keysByType[key.key_type] || 0) + 1;
        }

        console.log('\n📊 Keys breakdown by user_id:');
        for (const [userId, userKeys] of Object.entries(keysByUser)) {
          console.log(`  User ${userId}: ${userKeys.length} keys`);
        }

        console.log('\n📊 Keys breakdown by key_type:');
        for (const [keyType, count] of Object.entries(keysByType)) {
          console.log(`  ${keyType}: ${count} keys`);
        }

        console.log('\n📋 Full whatsapp_keys table content:');
        console.log(JSON.stringify(keys, null, 2));
      }
    }

    console.log('\n✅ All tests completed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testSupabaseConnection();

