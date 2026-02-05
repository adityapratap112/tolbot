import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const USER_ID = process.env.TEST_USER_ID || '291fdea1-f96f-44d1-bc9c-5c2e02c1ee89';

async function verifyCredentials() {
  console.log('🔍 Verifying WhatsApp Credentials in Supabase\n');

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Missing Supabase credentials in .env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    // Fetch credentials
    console.log(`📋 Fetching credentials for user: ${USER_ID}\n`);
    const { data: creds, error: credsError } = await supabase
      .from('whatsapp_credentials')
      .select('*')
      .eq('user_id', USER_ID)
      .single();

    if (credsError) {
      console.error('❌ Error fetching credentials:', credsError);
    } else if (!creds) {
      console.log('⚠️  No credentials found for this user');
    } else {
      console.log('✅ Credentials Found!\n');
      console.log('User ID:', creds.user_id);
      console.log('Registered:', creds.registered);
      console.log('Platform:', creds.platform);
      console.log('Updated At:', creds.updated_at);
      console.log('\nCredential Fields:');
      console.log('  - noise_key:', creds.noise_key ? '✅ Present' : '❌ Missing');
      console.log('  - signed_identity_key:', creds.signed_identity_key ? '✅ Present' : '❌ Missing');
      console.log('  - signed_pre_key:', creds.signed_pre_key ? '✅ Present' : '❌ Missing');
      console.log('  - registration_id:', creds.registration_id ? '✅ Present' : '❌ Missing');
      console.log('  - adv_secret_key:', creds.adv_secret_key ? '✅ Present' : '❌ Missing');
      console.log('  - me:', creds.me ? '✅ Present' : '❌ Missing');
      console.log('  - account:', creds.account ? '✅ Present' : '❌ Missing');
    }

    // Fetch keys
    console.log('\n📋 Fetching keys for user: ' + USER_ID + '\n');
    const { data: keys, error: keysError } = await supabase
      .from('whatsapp_keys')
      .select('*')
      .eq('user_id', USER_ID);

    if (keysError) {
      console.error('❌ Error fetching keys:', keysError);
    } else if (!keys || keys.length === 0) {
      console.log('⚠️  No keys found for this user');
    } else {
      console.log(`✅ Found ${keys.length} keys!\n`);
      
      // Group by key type
      const keysByType: Record<string, number> = {};
      keys.forEach(key => {
        keysByType[key.key_type] = (keysByType[key.key_type] || 0) + 1;
      });

      console.log('Keys by Type:');
      for (const [type, count] of Object.entries(keysByType)) {
        console.log(`  - ${type}: ${count} keys`);
      }

      console.log('\nSample Keys:');
      keys.slice(0, 3).forEach(key => {
        console.log(`  - ${key.key_type}/${key.key_id}`);
      });
    }

    console.log('\n✅ Verification complete!');
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

verifyCredentials();

