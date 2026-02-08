-- ============================================
-- Telegram Multi-Tenant Tables
-- ============================================
-- This migration creates the necessary tables for multi-tenant Telegram support.
-- Run this in your Supabase SQL Editor.

-- 1. Drop existing telegram_credentials if it exists (to recreate with correct schema)
DROP TABLE IF EXISTS public.telegram_credentials CASCADE;

-- 2. Create unified telegram_credentials table (includes session data)
CREATE TABLE public.telegram_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bot_token TEXT NOT NULL,              -- Encrypted with AES-256-GCM
  bot_username TEXT,                    -- @BotFather username (e.g., "MyAwesomeBot")
  bot_id BIGINT,                        -- Telegram bot user ID (numeric)
  session_data JSONB DEFAULT '{}'::jsonb,  -- Session state (update_offset, preferences, etc.)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 3. Create indexes for performance
CREATE INDEX idx_telegram_credentials_user_id ON public.telegram_credentials(user_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.telegram_credentials ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS policies (users can only access their own data)

CREATE POLICY "Users can view their own Telegram credentials"
  ON public.telegram_credentials
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own Telegram credentials"
  ON public.telegram_credentials
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own Telegram credentials"
  ON public.telegram_credentials
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own Telegram credentials"
  ON public.telegram_credentials
  FOR DELETE
  USING (auth.uid() = user_id);

-- 6. Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create trigger for updated_at
CREATE TRIGGER update_telegram_credentials_updated_at
  BEFORE UPDATE ON public.telegram_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Verification Queries
-- ============================================
-- Run these to verify the migration succeeded:

-- Check telegram_credentials structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'telegram_credentials'
ORDER BY ordinal_position;

-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'telegram_credentials';

-- ============================================
-- Success!
-- ============================================
-- If you see the table structures and RLS enabled, you're ready to proceed!
