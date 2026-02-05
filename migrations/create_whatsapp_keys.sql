-- Migration: Create WhatsApp Keys Table
-- This table stores WhatsApp Baileys encryption keys per user
-- Keys are stored separately from credentials for better organization

CREATE TABLE public.whatsapp_keys (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  
  -- Key identification
  key_type character varying NOT NULL,         -- Type: 'pre-key', 'session', 'sender-key', 'app-state-sync-key', etc.
  key_id character varying NOT NULL,           -- Unique identifier for this key
  
  -- Key data
  key_data jsonb NOT NULL,                     -- The actual key data (encrypted)
  
  -- Timestamps
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone,
  
  -- Constraints
  CONSTRAINT whatsapp_keys_pkey PRIMARY KEY (id),
  CONSTRAINT whatsapp_keys_user_id_fkey FOREIGN KEY (user_id) 
    REFERENCES public.users(user_id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_keys_unique_key UNIQUE (user_id, key_type, key_id)
);

-- Indexes for faster lookups
CREATE INDEX idx_whatsapp_keys_user_id ON public.whatsapp_keys(user_id);
CREATE INDEX idx_whatsapp_keys_type ON public.whatsapp_keys(key_type);
CREATE INDEX idx_whatsapp_keys_user_type ON public.whatsapp_keys(user_id, key_type);

-- Comments for documentation
COMMENT ON TABLE public.whatsapp_keys IS 'Stores WhatsApp Baileys encryption keys per user';
COMMENT ON COLUMN public.whatsapp_keys.key_type IS 'Key type: pre-key, session, sender-key, sender-key-memory, app-state-sync-key, app-state-sync-version';
COMMENT ON COLUMN public.whatsapp_keys.key_id IS 'Unique identifier for this key within its type';
COMMENT ON COLUMN public.whatsapp_keys.key_data IS 'The actual key data stored as JSONB';

