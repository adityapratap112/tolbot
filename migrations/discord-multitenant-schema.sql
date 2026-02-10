-- ============================================
-- Discord Multi-Tenant Tables
-- ============================================
-- This migration creates the necessary tables for multi-tenant Discord support.
-- Run this in your Supabase SQL Editor.

-- 1. Drop existing discord_credentials if it exists (to recreate with correct schema)
DROP TABLE IF EXISTS public.discord_credentials CASCADE;

-- 2. Create unified discord_credentials table
CREATE TABLE public.discord_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bot_token TEXT NOT NULL,              -- Encrypted with AES-256-GCM
  application_id TEXT,                  -- Discord Application ID
  public_key TEXT,                      -- Discord Public Key (for interactions)
  session_data JSONB DEFAULT '{}'::jsonb,  -- Session state
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 3. Create indexes for performance
CREATE INDEX idx_discord_credentials_user_id ON public.discord_credentials(user_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.discord_credentials ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS policies (users can only access their own data)

CREATE POLICY "Users can view their own Discord credentials"
  ON public.discord_credentials
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own Discord credentials"
  ON public.discord_credentials
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own Discord credentials"
  ON public.discord_credentials
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own Discord credentials"
  ON public.discord_credentials
  FOR DELETE
  USING (auth.uid() = user_id);

-- 6. Create function to automatically update updated_at timestamp
-- (Reuse existing function if available, else define it)
-- CREATE OR REPLACE FUNCTION update_updated_at_column() ...

-- 7. Create trigger for updated_at
CREATE TRIGGER update_discord_credentials_updated_at
  BEFORE UPDATE ON public.discord_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
