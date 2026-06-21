-- S4.6: Landing page leads → PostgreSQL
-- Pre-tenant-acquisition prospect records with full attribution tracking.
-- Kept in platform schema, separate from platform.contacts until conversion.

-- ---------------------------------------------------------------------------
-- platform.leads — prospect records before tenant acquisition
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text UNIQUE NOT NULL,
  name              text NOT NULL,
  phone             text,
  company           text,
  role_title        text,
  consent_state     text,                        -- 'granted', 'denied', 'pending'
  lifecycle_status  text NOT NULL DEFAULT 'new',  -- 'new','nurturing','qualified','converted','disqualified'

  -- Diagnostic snapshot
  diagnostic_data   jsonb,                        -- {score, level, areas, recommendations}
  diagnostic_date   timestamptz NOT NULL,

  -- First-contact attribution
  first_contact_channel   text,                  -- 'web','email','referral','social','event'
  first_contact_campaign  text,
  utm_source              text,
  utm_medium              text,
  utm_campaign            text,
  utm_content             text,
  utm_term                text,
  referrer                text,
  landing_path            text,
  submitted_form          text,
  source_app              text NOT NULL DEFAULT 'umi-landing-page',
  first_contact_at        timestamptz NOT NULL DEFAULT now(),

  -- Email sequence state
  sequence_paused          boolean NOT NULL DEFAULT false,
  pause_reason             text,
  emails_sent              text[] NOT NULL DEFAULT '{}',  -- e.g. {'diagnostic_followup_day_0','diagnostic_followup_day_2'}
  last_email_sent_at       timestamptz,

  -- Timestamps
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_platform_leads_email           ON platform.leads (email);
CREATE INDEX IF NOT EXISTS idx_platform_leads_lifecycle       ON platform.leads (lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_platform_leads_created_at      ON platform.leads (created_at);
CREATE INDEX IF NOT EXISTS idx_platform_leads_diagnostic_date ON platform.leads (diagnostic_date);
CREATE INDEX IF NOT EXISTS idx_platform_leads_utm_campaign    ON platform.leads (utm_campaign);

-- ---------------------------------------------------------------------------
-- platform.lead_events — semantic log of lead lifecycle events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.lead_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES platform.leads(id) ON DELETE CASCADE,
  event_type    text NOT NULL,  -- 'diagnostic_completed','email_sent','email_failed',
                                -- 'sequence_paused','sequence_resumed','lead_responded',
                                -- 'meeting_scheduled','converted'
  event_data    jsonb,         -- e.g. {template_name, sequence_day, subject, status}
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_platform_lead_events_lead_id    ON platform.lead_events (lead_id);
CREATE INDEX IF NOT EXISTS idx_platform_lead_events_type       ON platform.lead_events (event_type);
CREATE INDEX IF NOT EXISTS idx_platform_lead_events_created_at ON platform.lead_events (created_at);

-- ---------------------------------------------------------------------------
-- Grants — expose to service_role and authenticated for edge function access
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA platform TO service_role;
GRANT USAGE ON SCHEMA platform TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.leads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.leads TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.lead_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.lead_events TO authenticated;
