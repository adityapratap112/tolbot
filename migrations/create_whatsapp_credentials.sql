-- Migration: Create WhatsApp Credentials Table
-- This table stores WhatsApp Baileys authentication credentials per user

CREATE TABLE public.whatsapp_credentials (
  user_id uuid NOT NULL,
  
  -- Core credentials (from Baileys creds.json)
  noise_key jsonb NOT NULL,                    -- Noise protocol key pair
  pairing_ephemeral_key_pair jsonb,            -- Ephemeral key for pairing
  signed_identity_key jsonb NOT NULL,          -- Signed identity key pair
  signed_pre_key jsonb NOT NULL,               -- Signed pre-key
  registration_id integer NOT NULL,            -- Registration ID
  adv_secret_key character varying NOT NULL,   -- Advertisement secret key
  
  -- Account info
  me jsonb,                                    -- User's WhatsApp info (id, name, lid)
  account jsonb,                               -- Account details
  platform character varying,                  -- Platform (e.g., 'smbi')
  
  -- Session state
  registered boolean NOT NULL DEFAULT false,
  account_sync_counter integer NOT NULL DEFAULT 0,
  account_settings jsonb,
  
  -- Pre-key management
  next_pre_key_id integer NOT NULL DEFAULT 1,
  first_unuploaded_pre_key_id integer NOT NULL DEFAULT 1,
  
  -- History tracking
  processed_history_messages jsonb DEFAULT '[]'::jsonb,
  
  -- Signal identities
  signal_identities jsonb DEFAULT '[]'::jsonb,
  
  -- Additional data
  pairing_code character varying,
  last_prop_hash character varying,
  routing_info jsonb,
  additional_data jsonb,
  
  -- Timestamps
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone,
  last_connected_at timestamp with time zone,
  
  -- Constraints
  CONSTRAINT whatsapp_credentials_pkey PRIMARY KEY (user_id),
  CONSTRAINT whatsapp_credentials_user_id_fkey FOREIGN KEY (user_id) 
    REFERENCES public.users(user_id) ON DELETE CASCADE
);

-- Index for faster lookups
CREATE INDEX idx_whatsapp_credentials_registered ON public.whatsapp_credentials(registered);
CREATE INDEX idx_whatsapp_credentials_last_connected ON public.whatsapp_credentials(last_connected_at);

-- Comments for documentation
COMMENT ON TABLE public.whatsapp_credentials IS 'Stores WhatsApp Baileys authentication credentials per user';
COMMENT ON COLUMN public.whatsapp_credentials.noise_key IS 'Noise protocol key pair (private/public)';
COMMENT ON COLUMN public.whatsapp_credentials.signed_identity_key IS 'Signed identity key pair for E2E encryption';
COMMENT ON COLUMN public.whatsapp_credentials.signed_pre_key IS 'Signed pre-key for session establishment';
COMMENT ON COLUMN public.whatsapp_credentials.registration_id IS 'Unique registration ID for this device';
COMMENT ON COLUMN public.whatsapp_credentials.me IS 'WhatsApp user info (id, name, lid)';
COMMENT ON COLUMN public.whatsapp_credentials.registered IS 'Whether the device is successfully registered with WhatsApp';

