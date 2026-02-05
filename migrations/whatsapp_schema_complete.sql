-- ============================================
-- WhatsApp Schema - ALTER Migration
-- ============================================
-- Run this to add missing constraints and indexes
-- Tables already exist, so we're just adding constraints

-- ============================================
-- Step 1: Drop existing foreign key constraints (to recreate with CASCADE)
-- ============================================
ALTER TABLE public.whatsapp_credentials
  DROP CONSTRAINT IF EXISTS whatsapp_credentials_user_id_fkey;

ALTER TABLE public.whatsapp_keys
  DROP CONSTRAINT IF EXISTS whatsapp_keys_user_id_fkey;

-- ============================================
-- Step 2: Add foreign keys with ON DELETE CASCADE
-- ============================================
ALTER TABLE public.whatsapp_credentials
  ADD CONSTRAINT whatsapp_credentials_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;

ALTER TABLE public.whatsapp_keys
  ADD CONSTRAINT whatsapp_keys_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;

-- ============================================
-- Step 3: Add unique constraint on whatsapp_keys
-- ============================================
ALTER TABLE public.whatsapp_keys
  DROP CONSTRAINT IF EXISTS whatsapp_keys_unique_key;

ALTER TABLE public.whatsapp_keys
  ADD CONSTRAINT whatsapp_keys_unique_key
  UNIQUE (user_id, key_type, key_id);

-- ============================================
-- Step 4: Add indexes for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_whatsapp_credentials_registered
  ON public.whatsapp_credentials(registered);

CREATE INDEX IF NOT EXISTS idx_whatsapp_keys_user_id
  ON public.whatsapp_keys(user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_keys_user_type
  ON public.whatsapp_keys(user_id, key_type);

-- ============================================
-- Final Schema Overview
-- ============================================
-- users (base table)
--   ├── accounts (1:1)
--   ├── github_oauth_tokens (1:1)
--   ├── google_oauth_tokens (1:1)
--   ├── whatsapp_credentials (1:1) - ON DELETE CASCADE
--   └── whatsapp_keys (1:many)     - ON DELETE CASCADE

