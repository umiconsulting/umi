--
-- PostgreSQL database dump
--

\restrict KUc1AiVGFBhlKK9jdyeLPLlZ0G3liUe8wLyNojaMxyvt9xlC0zmH81oUtg7vpIR

-- Dumped from database version 18.3 (Homebrew)
-- Dumped by pg_dump version 18.3 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: cash; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA cash;


--
-- Name: commerce; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA commerce;


--
-- Name: conversaflow; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA conversaflow;


--
-- Name: kds; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA kds;


--
-- Name: legacy; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA legacy;


--
-- Name: observability; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA observability;


--
-- Name: platform; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA platform;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: can_access_tenant(uuid); Type: FUNCTION; Schema: platform; Owner: -
--

CREATE FUNCTION platform.can_access_tenant(target_tenant_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'platform', 'pg_temp'
    AS $$
  select exists (
    select 1
    from platform.tenant_memberships tm
    where tm.tenant_id = target_tenant_id
      and tm.user_id = platform.current_user_id()
      and tm.status = 'active'
  )
$$;


--
-- Name: current_user_id(); Type: FUNCTION; Schema: platform; Owner: -
--

CREATE FUNCTION platform.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: gift_cards; Type: TABLE; Schema: cash; Owner: -
--

CREATE TABLE cash.gift_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    amount_cents integer NOT NULL,
    created_by_staff_member_id uuid,
    sender_name text,
    message text,
    recipient_contact_id uuid,
    recipient_email text,
    recipient_phone text,
    recipient_name text,
    redeemed_at timestamp with time zone,
    redeemed_loyalty_card_id uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gift_cards_amount_cents_check CHECK ((amount_cents > 0))
);


--
-- Name: loyalty_accounts; Type: TABLE; Schema: cash; Owner: -
--

CREATE TABLE cash.loyalty_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    program_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loyalty_accounts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: loyalty_cards; Type: TABLE; Schema: cash; Owner: -
--

CREATE TABLE cash.loyalty_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    loyalty_account_id uuid NOT NULL,
    card_number text NOT NULL,
    balance_cents integer DEFAULT 0 NOT NULL,
    total_visits integer DEFAULT 0 NOT NULL,
    visits_this_cycle integer DEFAULT 0 NOT NULL,
    pending_rewards integer DEFAULT 0 NOT NULL,
    qr_token text,
    qr_issued_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loyalty_cards_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: otp_verifications; Type: TABLE; Schema: cash; Owner: -
--

CREATE TABLE cash.otp_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    identity_type text NOT NULL,
    identity_value text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT otp_verifications_identity_type_check CHECK ((identity_type = ANY (ARRAY['phone'::text, 'email'::text])))
);


--
-- Name: pass_devices; Type: TABLE; Schema: cash; Owner: -
--

CREATE TABLE cash.pass_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    pass_id uuid NOT NULL,
    device_token text NOT NULL,
    push_token text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: passes; Type: TABLE; Schema: cash; Owner: -
--

CREATE TABLE cash.passes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    loyalty_card_id uuid NOT NULL,
    provider text NOT NULL,
    provider_object_id text,
    serial_number text,
    auth_token text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT passes_provider_check CHECK ((provider = ANY (ARRAY['apple'::text, 'google'::text]))),
    CONSTRAINT passes_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: reward_configs; Type: TABLE; Schema: cash; Owner: -
--

CREATE TABLE cash.reward_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    program_id uuid,
    visits_required integer DEFAULT 10 NOT NULL,
    reward_name text NOT NULL,
    reward_description text,
    reward_cost_cents integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    activated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reward_configs_visits_required_check CHECK ((visits_required > 0))
);


--
-- Name: reward_redemptions; Type: TABLE; Schema: cash; Owner: -
--

CREATE TABLE cash.reward_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    loyalty_card_id uuid NOT NULL,
    reward_config_id uuid NOT NULL,
    staff_member_id uuid,
    note text,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wallet_programs; Type: TABLE; Schema: cash; Owner: -
--

CREATE TABLE cash.wallet_programs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    name text NOT NULL,
    card_prefix text,
    topup_enabled boolean DEFAULT true NOT NULL,
    pass_style text DEFAULT 'default'::text NOT NULL,
    branding jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallet_programs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: wallet_transactions; Type: TABLE; Schema: cash; Owner: -
--

CREATE TABLE cash.wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    loyalty_card_id uuid NOT NULL,
    staff_member_id uuid,
    type text NOT NULL,
    amount_cents integer NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallet_transactions_type_check CHECK ((type = ANY (ARRAY['topup'::text, 'purchase'::text, 'adjustment'::text, 'gift_card_redeem'::text])))
);


--
-- Name: business_hours; Type: TABLE; Schema: commerce; Owner: -
--

CREATE TABLE commerce.business_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    timezone text NOT NULL,
    weekly_hours jsonb DEFAULT '{}'::jsonb NOT NULL,
    effective_from date,
    effective_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_events; Type: TABLE; Schema: commerce; Owner: -
--

CREATE TABLE commerce.order_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    event_type text NOT NULL,
    previous_status text,
    next_status text,
    actor_user_id uuid,
    actor_staff_member_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_items; Type: TABLE; Schema: commerce; Owner: -
--

CREATE TABLE commerce.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    product_ref text,
    name text NOT NULL,
    quantity integer NOT NULL,
    unit_price_cents integer DEFAULT 0 NOT NULL,
    total_cents integer DEFAULT 0 NOT NULL,
    variant_name text,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: orders; Type: TABLE; Schema: commerce; Owner: -
--

CREATE TABLE commerce.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    contact_id uuid,
    order_number text,
    source_product text NOT NULL,
    source_ref text,
    status text DEFAULT 'draft'::text NOT NULL,
    channel text,
    currency text DEFAULT 'MXN'::text NOT NULL,
    subtotal_cents integer DEFAULT 0 NOT NULL,
    tax_cents integer DEFAULT 0 NOT NULL,
    discount_cents integer DEFAULT 0 NOT NULL,
    total_cents integer DEFAULT 0 NOT NULL,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    placed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orders_source_product_check CHECK ((source_product = ANY (ARRAY['cash'::text, 'conversaflow'::text, 'kds'::text, 'dashboard'::text, 'external'::text]))),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'accepted'::text, 'in_progress'::text, 'ready'::text, 'completed'::text, 'cancelled'::text, 'refunded'::text])))
);


--
-- Name: payments; Type: TABLE; Schema: commerce; Owner: -
--

CREATE TABLE commerce.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid,
    contact_id uuid,
    provider text,
    provider_payment_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'MXN'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'authorized'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'cancelled'::text])))
);


--
-- Name: refunds; Type: TABLE; Schema: commerce; Owner: -
--

CREATE TABLE commerce.refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    provider_refund_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    amount_cents integer NOT NULL,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refunds_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT refunds_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: service_windows; Type: TABLE; Schema: commerce; Owner: -
--

CREATE TABLE commerce.service_windows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    service_key text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    capacity integer,
    status text DEFAULT 'open'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_windows_check CHECK ((ends_at > starts_at)),
    CONSTRAINT service_windows_status_check CHECK ((status = ANY (ARRAY['open'::text, 'limited'::text, 'closed'::text, 'archived'::text])))
);


--
-- Name: channel_accounts; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.channel_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    channel_id uuid NOT NULL,
    provider text NOT NULL,
    provider_account_id text NOT NULL,
    address text,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channel_accounts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: channels; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channels_key_check CHECK ((key = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'slack'::text, 'web'::text, 'voice'::text]))),
    CONSTRAINT channels_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: conversation_outcomes; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.conversation_outcomes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    order_id uuid,
    outcome_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation_turns; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.conversation_turns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    request_id uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_turns_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'superseded'::text])))
);


--
-- Name: conversations; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    contact_id uuid,
    channel_account_id uuid,
    provider_thread_id text,
    status text DEFAULT 'open'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'pending'::text, 'closed'::text, 'archived'::text])))
);


--
-- Name: job_attempts; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.job_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    job_id uuid NOT NULL,
    attempt smallint NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    outcome text DEFAULT 'running'::text NOT NULL,
    error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT job_attempts_outcome_check CHECK ((outcome = ANY (ARRAY['running'::text, 'success'::text, 'error'::text, 'timeout'::text])))
);


--
-- Name: memory_items; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.memory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    conversation_id uuid,
    memory_type text NOT NULL,
    content text NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    embedding_model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    contact_id uuid,
    provider_message_id text,
    role text NOT NULL,
    body text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    received_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text, 'tool'::text, 'operator'::text])))
);


--
-- Name: outbox; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    job_id uuid,
    conversation_id uuid,
    order_id uuid,
    kind text NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    attempts smallint DEFAULT 0 NOT NULL,
    max_attempts smallint DEFAULT 5 NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outbox_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'delivering'::text, 'delivered'::text, 'failed'::text, 'dead'::text])))
);


--
-- Name: tool_calls; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.tool_calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    conversation_id uuid,
    turn_id uuid,
    tool_name text NOT NULL,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    output jsonb,
    status text DEFAULT 'started'::text NOT NULL,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT tool_calls_status_check CHECK ((status = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text])))
);


--
-- Name: workflow_jobs; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.workflow_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    conversation_id uuid,
    order_id uuid,
    job_type text NOT NULL,
    aggregate_type text,
    aggregate_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    priority smallint DEFAULT 0 NOT NULL,
    max_attempts smallint DEFAULT 3 NOT NULL,
    attempt_count smallint DEFAULT 0 NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    completed_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_jobs_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'claimed'::text, 'running'::text, 'completed'::text, 'failed'::text, 'dead'::text])))
);


--
-- Name: device_events; Type: TABLE; Schema: kds; Owner: -
--

CREATE TABLE kds.device_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    device_session_id uuid,
    station_id uuid,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: device_sessions; Type: TABLE; Schema: kds; Owner: -
--

CREATE TABLE kds.device_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    station_id uuid,
    device_name text NOT NULL,
    token_hash text,
    is_active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: stations; Type: TABLE; Schema: kds; Owner: -
--

CREATE TABLE kds.stations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    station_key text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: ticket_events; Type: TABLE; Schema: kds; Owner: -
--

CREATE TABLE kds.ticket_events (
    sequence bigint NOT NULL,
    tenant_id uuid NOT NULL,
    ticket_id uuid NOT NULL,
    order_id uuid NOT NULL,
    kind text NOT NULL,
    status text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'projection'::text NOT NULL,
    source_event_key text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT ticket_events_kind_check CHECK ((kind = ANY (ARRAY['snapshot_reconciled'::text, 'order_upserted'::text, 'status_changed'::text, 'order_removed'::text, 'device_action'::text])))
);


--
-- Name: ticket_events_sequence_seq; Type: SEQUENCE; Schema: kds; Owner: -
--

ALTER TABLE kds.ticket_events ALTER COLUMN sequence ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME kds.ticket_events_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ticket_items; Type: TABLE; Schema: kds; Owner: -
--

CREATE TABLE kds.ticket_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    ticket_id uuid NOT NULL,
    order_item_id uuid,
    display_order integer NOT NULL,
    name text NOT NULL,
    quantity integer NOT NULL,
    variant_name text,
    notes text,
    unit_price_cents integer,
    is_cancelled boolean DEFAULT false NOT NULL,
    CONSTRAINT ticket_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: tickets; Type: TABLE; Schema: kds; Owner: -
--

CREATE TABLE kds.tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    order_id uuid NOT NULL,
    contact_id uuid,
    source_channel text DEFAULT 'conversaflow'::text NOT NULL,
    customer_name text,
    customer_phone text,
    pickup_person text,
    status text NOT NULL,
    station_id uuid,
    customer_note text,
    cancellation_reason text,
    partial_cancellation_reason text,
    total_cents integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    last_event_sequence bigint,
    last_projected_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tickets_status_check CHECK ((status = ANY (ARRAY['new'::text, 'accepted'::text, 'preparing'::text, 'ready'::text, 'completed'::text, 'cancelled'::text, 'partial_cancelled'::text])))
);


--
-- Name: contact_mappings; Type: TABLE; Schema: legacy; Owner: -
--

CREATE TABLE legacy.contact_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_batch_id uuid,
    source_product text NOT NULL,
    source_schema text,
    source_table text NOT NULL,
    source_id text NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    mapping_confidence text DEFAULT 'source_asserted'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contact_mappings_mapping_confidence_check CHECK ((mapping_confidence = ANY (ARRAY['source_asserted'::text, 'exact'::text, 'candidate'::text, 'manual'::text])))
);


--
-- Name: import_batches; Type: TABLE; Schema: legacy; Owner: -
--

CREATE TABLE legacy.import_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_name text NOT NULL,
    source_started_at timestamp with time zone,
    source_finished_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT import_batches_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'abandoned'::text])))
);


--
-- Name: kds_ticket_mappings; Type: TABLE; Schema: legacy; Owner: -
--

CREATE TABLE legacy.kds_ticket_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_batch_id uuid,
    source_schema text DEFAULT 'kds'::text NOT NULL,
    source_table text DEFAULT 'tickets'::text NOT NULL,
    source_ticket_id text NOT NULL,
    source_transaction_id text,
    tenant_id uuid NOT NULL,
    ticket_id uuid NOT NULL,
    order_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: location_mappings; Type: TABLE; Schema: legacy; Owner: -
--

CREATE TABLE legacy.location_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_batch_id uuid,
    source_product text NOT NULL,
    source_schema text,
    source_table text NOT NULL,
    source_id text NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_mappings; Type: TABLE; Schema: legacy; Owner: -
--

CREATE TABLE legacy.order_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_batch_id uuid,
    source_product text NOT NULL,
    source_schema text,
    source_table text NOT NULL,
    source_id text NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: public_compat_imports; Type: TABLE; Schema: legacy; Owner: -
--

CREATE TABLE legacy.public_compat_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_batch_id uuid,
    source_schema text DEFAULT 'public'::text NOT NULL,
    source_table text NOT NULL,
    source_id text NOT NULL,
    target_schema text,
    target_table text,
    target_id text,
    action text NOT NULL,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT public_compat_imports_action_check CHECK ((action = ANY (ARRAY['ignored_duplicate'::text, 'imported_public_only'::text, 'archived_only'::text, 'manual_review'::text])))
);


--
-- Name: replay_queue; Type: TABLE; Schema: legacy; Owner: -
--

CREATE TABLE legacy.replay_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_product text NOT NULL,
    source_schema text,
    source_table text NOT NULL,
    source_id text NOT NULL,
    tenant_id uuid,
    replay_kind text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'staged'::text NOT NULL,
    approved_by_user_id uuid,
    approved_at timestamp with time zone,
    enqueued_at timestamp with time zone,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT replay_queue_status_check CHECK ((status = ANY (ARRAY['staged'::text, 'approved'::text, 'enqueued'::text, 'skipped'::text, 'failed'::text])))
);


--
-- Name: staff_mappings; Type: TABLE; Schema: legacy; Owner: -
--

CREATE TABLE legacy.staff_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_batch_id uuid,
    source_product text NOT NULL,
    source_schema text,
    source_table text NOT NULL,
    source_id text NOT NULL,
    tenant_id uuid NOT NULL,
    staff_member_id uuid NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_mappings; Type: TABLE; Schema: legacy; Owner: -
--

CREATE TABLE legacy.tenant_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_batch_id uuid,
    source_product text NOT NULL,
    source_schema text,
    source_table text NOT NULL,
    source_id text NOT NULL,
    source_slug text,
    tenant_id uuid NOT NULL,
    mapping_confidence text DEFAULT 'manual'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_mappings_mapping_confidence_check CHECK ((mapping_confidence = ANY (ARRAY['manual'::text, 'exact'::text, 'candidate'::text, 'unresolved'::text])))
);


--
-- Name: user_mappings; Type: TABLE; Schema: legacy; Owner: -
--

CREATE TABLE legacy.user_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_batch_id uuid,
    source_product text NOT NULL,
    source_schema text,
    source_table text NOT NULL,
    source_id text NOT NULL,
    tenant_id uuid,
    user_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: observability; Owner: -
--

CREATE TABLE observability.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    actor_user_id uuid,
    actor_staff_member_id uuid,
    action text NOT NULL,
    subject_schema text,
    subject_table text,
    subject_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: data_quality_findings; Type: TABLE; Schema: observability; Owner: -
--

CREATE TABLE observability.data_quality_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    product_key text,
    severity text NOT NULL,
    finding_key text NOT NULL,
    subject_schema text,
    subject_table text,
    subject_id text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT data_quality_findings_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'critical'::text]))),
    CONSTRAINT data_quality_findings_status_check CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'resolved'::text, 'archived'::text])))
);


--
-- Name: integration_checks; Type: TABLE; Schema: observability; Owner: -
--

CREATE TABLE observability.integration_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    product_key text,
    integration_key text NOT NULL,
    status text NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT integration_checks_status_check CHECK ((status = ANY (ARRAY['pass'::text, 'warn'::text, 'fail'::text, 'unknown'::text])))
);


--
-- Name: pipeline_traces; Type: TABLE; Schema: observability; Owner: -
--

CREATE TABLE observability.pipeline_traces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    product_key text,
    trace_id text NOT NULL,
    conversation_id uuid,
    order_id uuid,
    stage text NOT NULL,
    event text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: runtime_logs; Type: TABLE; Schema: observability; Owner: -
--

CREATE TABLE observability.runtime_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    product_key text,
    source text NOT NULL,
    level text NOT NULL,
    message text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    request_id text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_logs_level_check CHECK ((level = ANY (ARRAY['debug'::text, 'info'::text, 'warn'::text, 'error'::text])))
);


--
-- Name: contact_identities; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.contact_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    identity_type text NOT NULL,
    identity_value text NOT NULL,
    normalized_value text,
    provider text,
    verification_status text DEFAULT 'unverified'::text NOT NULL,
    verified_at timestamp with time zone,
    confidence text DEFAULT 'source_asserted'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contact_identities_confidence_check CHECK ((confidence = ANY (ARRAY['source_asserted'::text, 'otp_verified'::text, 'staff_verified'::text, 'candidate'::text]))),
    CONSTRAINT contact_identities_identity_type_check CHECK ((identity_type = ANY (ARRAY['phone'::text, 'email'::text, 'whatsapp'::text, 'wallet_pass'::text, 'external'::text]))),
    CONSTRAINT contact_identities_verification_status_check CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'failed'::text, 'expired'::text])))
);


--
-- Name: contact_merge_candidates; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.contact_merge_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    left_contact_id uuid NOT NULL,
    right_contact_id uuid NOT NULL,
    match_type text NOT NULL,
    confidence text DEFAULT 'candidate'::text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT contact_merge_candidates_check CHECK ((left_contact_id <> right_contact_id)),
    CONSTRAINT contact_merge_candidates_confidence_check CHECK ((confidence = ANY (ARRAY['candidate'::text, 'high'::text, 'rejected'::text, 'merged'::text]))),
    CONSTRAINT contact_merge_candidates_match_type_check CHECK ((match_type = ANY (ARRAY['exact_normalized_phone'::text, 'exact_normalized_email'::text, 'last10_phone'::text, 'manual_review'::text])))
);


--
-- Name: contacts; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    display_name text,
    phone text,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: external_refs; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.external_refs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    location_id uuid,
    product_key text NOT NULL,
    external_schema text,
    external_table text,
    external_id text NOT NULL,
    external_slug text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT external_refs_product_key_check CHECK ((product_key = ANY (ARRAY['cash'::text, 'conversaflow'::text, 'kds'::text, 'dashboard'::text, 'observability'::text, 'legacy'::text])))
);


--
-- Name: locations; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    timezone text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT locations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: membership_roles; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.membership_roles (
    membership_id uuid NOT NULL,
    role_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: permissions; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_instances; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.product_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    product_key text NOT NULL,
    status text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled_at timestamp with time zone,
    disabled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_instances_product_key_check CHECK ((product_key = ANY (ARRAY['cash'::text, 'conversaflow'::text, 'kds'::text, 'dashboard'::text, 'observability'::text]))),
    CONSTRAINT product_instances_status_check CHECK ((status = ANY (ARRAY['active'::text, 'trialing'::text, 'disabled'::text, 'missing'::text, 'archived'::text])))
);


--
-- Name: role_permissions; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: staff_members; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.staff_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    user_id uuid,
    name text NOT NULL,
    email text,
    phone text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'invited'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: tenant_memberships; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.tenant_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_memberships_status_check CHECK ((status = ANY (ARRAY['active'::text, 'invited'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: tenants; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    timezone text DEFAULT 'America/Mazatlan'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenants_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: tenant_product_capabilities; Type: VIEW; Schema: platform; Owner: -
--

CREATE VIEW platform.tenant_product_capabilities WITH (security_invoker='true') AS
 SELECT t.id AS tenant_id,
    t.slug,
    t.name,
    jsonb_object_agg(pi.product_key, jsonb_build_object('status', pi.status, 'location_id', pi.location_id, 'config', pi.config) ORDER BY pi.product_key) AS products
   FROM (platform.tenants t
     JOIN platform.product_instances pi ON ((pi.tenant_id = t.id)))
  GROUP BY t.id, t.slug, t.name;


--
-- Name: users; Type: TABLE; Schema: platform; Owner: -
--

CREATE TABLE platform.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_subject text,
    email text,
    phone text,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gift_cards gift_cards_code_key; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.gift_cards
    ADD CONSTRAINT gift_cards_code_key UNIQUE (code);


--
-- Name: gift_cards gift_cards_pkey; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.gift_cards
    ADD CONSTRAINT gift_cards_pkey PRIMARY KEY (id);


--
-- Name: loyalty_accounts loyalty_accounts_pkey; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_pkey PRIMARY KEY (id);


--
-- Name: loyalty_accounts loyalty_accounts_tenant_id_contact_id_key; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_tenant_id_contact_id_key UNIQUE (tenant_id, contact_id);


--
-- Name: loyalty_cards loyalty_cards_card_number_key; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.loyalty_cards
    ADD CONSTRAINT loyalty_cards_card_number_key UNIQUE (card_number);


--
-- Name: loyalty_cards loyalty_cards_pkey; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.loyalty_cards
    ADD CONSTRAINT loyalty_cards_pkey PRIMARY KEY (id);


--
-- Name: loyalty_cards loyalty_cards_qr_token_key; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.loyalty_cards
    ADD CONSTRAINT loyalty_cards_qr_token_key UNIQUE (qr_token);


--
-- Name: otp_verifications otp_verifications_pkey; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.otp_verifications
    ADD CONSTRAINT otp_verifications_pkey PRIMARY KEY (id);


--
-- Name: pass_devices pass_devices_pass_id_device_token_key; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.pass_devices
    ADD CONSTRAINT pass_devices_pass_id_device_token_key UNIQUE (pass_id, device_token);


--
-- Name: pass_devices pass_devices_pkey; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.pass_devices
    ADD CONSTRAINT pass_devices_pkey PRIMARY KEY (id);


--
-- Name: passes passes_pkey; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.passes
    ADD CONSTRAINT passes_pkey PRIMARY KEY (id);


--
-- Name: passes passes_provider_provider_object_id_key; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.passes
    ADD CONSTRAINT passes_provider_provider_object_id_key UNIQUE (provider, provider_object_id);


--
-- Name: reward_configs reward_configs_pkey; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.reward_configs
    ADD CONSTRAINT reward_configs_pkey PRIMARY KEY (id);


--
-- Name: reward_redemptions reward_redemptions_pkey; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.reward_redemptions
    ADD CONSTRAINT reward_redemptions_pkey PRIMARY KEY (id);


--
-- Name: wallet_programs wallet_programs_pkey; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.wallet_programs
    ADD CONSTRAINT wallet_programs_pkey PRIMARY KEY (id);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: business_hours business_hours_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.business_hours
    ADD CONSTRAINT business_hours_pkey PRIMARY KEY (id);


--
-- Name: order_events order_events_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_events
    ADD CONSTRAINT order_events_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: service_windows service_windows_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.service_windows
    ADD CONSTRAINT service_windows_pkey PRIMARY KEY (id);


--
-- Name: channel_accounts channel_accounts_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.channel_accounts
    ADD CONSTRAINT channel_accounts_pkey PRIMARY KEY (id);


--
-- Name: channel_accounts channel_accounts_provider_provider_account_id_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.channel_accounts
    ADD CONSTRAINT channel_accounts_provider_provider_account_id_key UNIQUE (provider, provider_account_id);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: channels channels_tenant_id_key_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.channels
    ADD CONSTRAINT channels_tenant_id_key_key UNIQUE (tenant_id, key);


--
-- Name: conversation_outcomes conversation_outcomes_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_pkey PRIMARY KEY (id);


--
-- Name: conversation_turns conversation_turns_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_turns
    ADD CONSTRAINT conversation_turns_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: job_attempts job_attempts_job_id_attempt_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.job_attempts
    ADD CONSTRAINT job_attempts_job_id_attempt_key UNIQUE (job_id, attempt);


--
-- Name: job_attempts job_attempts_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.job_attempts
    ADD CONSTRAINT job_attempts_pkey PRIMARY KEY (id);


--
-- Name: memory_items memory_items_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.memory_items
    ADD CONSTRAINT memory_items_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: outbox outbox_idempotency_key_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.outbox
    ADD CONSTRAINT outbox_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (id);


--
-- Name: tool_calls tool_calls_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.tool_calls
    ADD CONSTRAINT tool_calls_pkey PRIMARY KEY (id);


--
-- Name: workflow_jobs workflow_jobs_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.workflow_jobs
    ADD CONSTRAINT workflow_jobs_pkey PRIMARY KEY (id);


--
-- Name: device_events device_events_pkey; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.device_events
    ADD CONSTRAINT device_events_pkey PRIMARY KEY (id);


--
-- Name: device_sessions device_sessions_pkey; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.device_sessions
    ADD CONSTRAINT device_sessions_pkey PRIMARY KEY (id);


--
-- Name: stations stations_pkey; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.stations
    ADD CONSTRAINT stations_pkey PRIMARY KEY (id);


--
-- Name: stations stations_tenant_id_location_id_station_key_key; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.stations
    ADD CONSTRAINT stations_tenant_id_location_id_station_key_key UNIQUE (tenant_id, location_id, station_key);


--
-- Name: ticket_events ticket_events_pkey; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_events
    ADD CONSTRAINT ticket_events_pkey PRIMARY KEY (sequence);


--
-- Name: ticket_events ticket_events_source_event_key_key; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_events
    ADD CONSTRAINT ticket_events_source_event_key_key UNIQUE (source_event_key);


--
-- Name: ticket_items ticket_items_pkey; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_items
    ADD CONSTRAINT ticket_items_pkey PRIMARY KEY (id);


--
-- Name: ticket_items ticket_items_ticket_id_display_order_key; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_items
    ADD CONSTRAINT ticket_items_ticket_id_display_order_key UNIQUE (ticket_id, display_order);


--
-- Name: tickets tickets_order_id_key; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_order_id_key UNIQUE (order_id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: contact_mappings contact_mappings_pkey; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.contact_mappings
    ADD CONSTRAINT contact_mappings_pkey PRIMARY KEY (id);


--
-- Name: contact_mappings contact_mappings_source_product_source_schema_source_table__key; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.contact_mappings
    ADD CONSTRAINT contact_mappings_source_product_source_schema_source_table__key UNIQUE (source_product, source_schema, source_table, source_id);


--
-- Name: import_batches import_batches_pkey; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);


--
-- Name: kds_ticket_mappings kds_ticket_mappings_pkey; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.kds_ticket_mappings
    ADD CONSTRAINT kds_ticket_mappings_pkey PRIMARY KEY (id);


--
-- Name: kds_ticket_mappings kds_ticket_mappings_source_schema_source_table_source_ticke_key; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.kds_ticket_mappings
    ADD CONSTRAINT kds_ticket_mappings_source_schema_source_table_source_ticke_key UNIQUE (source_schema, source_table, source_ticket_id);


--
-- Name: location_mappings location_mappings_pkey; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.location_mappings
    ADD CONSTRAINT location_mappings_pkey PRIMARY KEY (id);


--
-- Name: location_mappings location_mappings_source_product_source_schema_source_table_key; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.location_mappings
    ADD CONSTRAINT location_mappings_source_product_source_schema_source_table_key UNIQUE (source_product, source_schema, source_table, source_id);


--
-- Name: order_mappings order_mappings_pkey; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.order_mappings
    ADD CONSTRAINT order_mappings_pkey PRIMARY KEY (id);


--
-- Name: order_mappings order_mappings_source_product_source_schema_source_table_so_key; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.order_mappings
    ADD CONSTRAINT order_mappings_source_product_source_schema_source_table_so_key UNIQUE (source_product, source_schema, source_table, source_id);


--
-- Name: public_compat_imports public_compat_imports_pkey; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.public_compat_imports
    ADD CONSTRAINT public_compat_imports_pkey PRIMARY KEY (id);


--
-- Name: public_compat_imports public_compat_imports_source_schema_source_table_source_id__key; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.public_compat_imports
    ADD CONSTRAINT public_compat_imports_source_schema_source_table_source_id__key UNIQUE (source_schema, source_table, source_id, action);


--
-- Name: replay_queue replay_queue_pkey; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.replay_queue
    ADD CONSTRAINT replay_queue_pkey PRIMARY KEY (id);


--
-- Name: replay_queue replay_queue_source_product_source_schema_source_table_sour_key; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.replay_queue
    ADD CONSTRAINT replay_queue_source_product_source_schema_source_table_sour_key UNIQUE (source_product, source_schema, source_table, source_id, replay_kind);


--
-- Name: staff_mappings staff_mappings_pkey; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.staff_mappings
    ADD CONSTRAINT staff_mappings_pkey PRIMARY KEY (id);


--
-- Name: staff_mappings staff_mappings_source_product_source_schema_source_table_so_key; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.staff_mappings
    ADD CONSTRAINT staff_mappings_source_product_source_schema_source_table_so_key UNIQUE (source_product, source_schema, source_table, source_id);


--
-- Name: tenant_mappings tenant_mappings_pkey; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.tenant_mappings
    ADD CONSTRAINT tenant_mappings_pkey PRIMARY KEY (id);


--
-- Name: tenant_mappings tenant_mappings_source_product_source_schema_source_table_s_key; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.tenant_mappings
    ADD CONSTRAINT tenant_mappings_source_product_source_schema_source_table_s_key UNIQUE (source_product, source_schema, source_table, source_id);


--
-- Name: user_mappings user_mappings_pkey; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.user_mappings
    ADD CONSTRAINT user_mappings_pkey PRIMARY KEY (id);


--
-- Name: user_mappings user_mappings_source_product_source_schema_source_table_sou_key; Type: CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.user_mappings
    ADD CONSTRAINT user_mappings_source_product_source_schema_source_table_sou_key UNIQUE (source_product, source_schema, source_table, source_id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: data_quality_findings data_quality_findings_pkey; Type: CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.data_quality_findings
    ADD CONSTRAINT data_quality_findings_pkey PRIMARY KEY (id);


--
-- Name: integration_checks integration_checks_pkey; Type: CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.integration_checks
    ADD CONSTRAINT integration_checks_pkey PRIMARY KEY (id);


--
-- Name: pipeline_traces pipeline_traces_pkey; Type: CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.pipeline_traces
    ADD CONSTRAINT pipeline_traces_pkey PRIMARY KEY (id);


--
-- Name: runtime_logs runtime_logs_pkey; Type: CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.runtime_logs
    ADD CONSTRAINT runtime_logs_pkey PRIMARY KEY (id);


--
-- Name: contact_identities contact_identities_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.contact_identities
    ADD CONSTRAINT contact_identities_pkey PRIMARY KEY (id);


--
-- Name: contact_merge_candidates contact_merge_candidates_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.contact_merge_candidates
    ADD CONSTRAINT contact_merge_candidates_pkey PRIMARY KEY (id);


--
-- Name: contact_merge_candidates contact_merge_candidates_tenant_id_left_contact_id_right_co_key; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.contact_merge_candidates
    ADD CONSTRAINT contact_merge_candidates_tenant_id_left_contact_id_right_co_key UNIQUE (tenant_id, left_contact_id, right_contact_id, match_type);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: external_refs external_refs_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.external_refs
    ADD CONSTRAINT external_refs_pkey PRIMARY KEY (id);


--
-- Name: external_refs external_refs_product_key_external_schema_external_table_ex_key; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.external_refs
    ADD CONSTRAINT external_refs_product_key_external_schema_external_table_ex_key UNIQUE (product_key, external_schema, external_table, external_id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: locations locations_tenant_id_slug_key; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.locations
    ADD CONSTRAINT locations_tenant_id_slug_key UNIQUE (tenant_id, slug);


--
-- Name: membership_roles membership_roles_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.membership_roles
    ADD CONSTRAINT membership_roles_pkey PRIMARY KEY (membership_id, role_id);


--
-- Name: permissions permissions_key_key; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.permissions
    ADD CONSTRAINT permissions_key_key UNIQUE (key);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: product_instances product_instances_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.product_instances
    ADD CONSTRAINT product_instances_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: staff_members staff_members_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.staff_members
    ADD CONSTRAINT staff_members_pkey PRIMARY KEY (id);


--
-- Name: tenant_memberships tenant_memberships_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.tenant_memberships
    ADD CONSTRAINT tenant_memberships_pkey PRIMARY KEY (id);


--
-- Name: tenant_memberships tenant_memberships_tenant_id_user_id_key; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.tenant_memberships
    ADD CONSTRAINT tenant_memberships_tenant_id_user_id_key UNIQUE (tenant_id, user_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: users users_auth_subject_key; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.users
    ADD CONSTRAINT users_auth_subject_key UNIQUE (auth_subject);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: cash_gift_cards_tenant_redeemed_idx; Type: INDEX; Schema: cash; Owner: -
--

CREATE INDEX cash_gift_cards_tenant_redeemed_idx ON cash.gift_cards USING btree (tenant_id, redeemed_at);


--
-- Name: cash_loyalty_accounts_tenant_status_idx; Type: INDEX; Schema: cash; Owner: -
--

CREATE INDEX cash_loyalty_accounts_tenant_status_idx ON cash.loyalty_accounts USING btree (tenant_id, status);


--
-- Name: cash_loyalty_cards_tenant_idx; Type: INDEX; Schema: cash; Owner: -
--

CREATE INDEX cash_loyalty_cards_tenant_idx ON cash.loyalty_cards USING btree (tenant_id);


--
-- Name: cash_otp_verifications_identity_idx; Type: INDEX; Schema: cash; Owner: -
--

CREATE INDEX cash_otp_verifications_identity_idx ON cash.otp_verifications USING btree (tenant_id, identity_type, identity_value, created_at DESC);


--
-- Name: cash_passes_tenant_provider_idx; Type: INDEX; Schema: cash; Owner: -
--

CREATE INDEX cash_passes_tenant_provider_idx ON cash.passes USING btree (tenant_id, provider);


--
-- Name: cash_reward_configs_tenant_active_idx; Type: INDEX; Schema: cash; Owner: -
--

CREATE INDEX cash_reward_configs_tenant_active_idx ON cash.reward_configs USING btree (tenant_id, is_active, activated_at DESC);


--
-- Name: cash_reward_redemptions_card_idx; Type: INDEX; Schema: cash; Owner: -
--

CREATE INDEX cash_reward_redemptions_card_idx ON cash.reward_redemptions USING btree (loyalty_card_id, redeemed_at DESC);


--
-- Name: cash_wallet_programs_tenant_status_idx; Type: INDEX; Schema: cash; Owner: -
--

CREATE INDEX cash_wallet_programs_tenant_status_idx ON cash.wallet_programs USING btree (tenant_id, status);


--
-- Name: cash_wallet_transactions_card_idx; Type: INDEX; Schema: cash; Owner: -
--

CREATE INDEX cash_wallet_transactions_card_idx ON cash.wallet_transactions USING btree (loyalty_card_id, created_at DESC);


--
-- Name: commerce_business_hours_tenant_location_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX commerce_business_hours_tenant_location_idx ON commerce.business_hours USING btree (tenant_id, location_id);


--
-- Name: commerce_order_events_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX commerce_order_events_order_idx ON commerce.order_events USING btree (order_id, occurred_at DESC);


--
-- Name: commerce_order_items_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX commerce_order_items_order_idx ON commerce.order_items USING btree (order_id, id);


--
-- Name: commerce_orders_location_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX commerce_orders_location_status_idx ON commerce.orders USING btree (location_id, status, created_at DESC) WHERE (location_id IS NOT NULL);


--
-- Name: commerce_orders_tenant_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX commerce_orders_tenant_status_idx ON commerce.orders USING btree (tenant_id, status, created_at DESC);


--
-- Name: commerce_payments_tenant_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX commerce_payments_tenant_status_idx ON commerce.payments USING btree (tenant_id, status, created_at DESC);


--
-- Name: commerce_refunds_payment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX commerce_refunds_payment_idx ON commerce.refunds USING btree (payment_id, created_at DESC);


--
-- Name: commerce_service_windows_tenant_time_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX commerce_service_windows_tenant_time_idx ON commerce.service_windows USING btree (tenant_id, starts_at, ends_at);


--
-- Name: conversaflow_channel_accounts_tenant_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversaflow_channel_accounts_tenant_idx ON conversaflow.channel_accounts USING btree (tenant_id, channel_id);


--
-- Name: conversaflow_conversations_tenant_status_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversaflow_conversations_tenant_status_idx ON conversaflow.conversations USING btree (tenant_id, status, updated_at DESC);


--
-- Name: conversaflow_memory_items_contact_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversaflow_memory_items_contact_idx ON conversaflow.memory_items USING btree (tenant_id, contact_id, updated_at DESC);


--
-- Name: conversaflow_messages_conversation_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversaflow_messages_conversation_idx ON conversaflow.messages USING btree (conversation_id, created_at);


--
-- Name: conversaflow_outbox_deliverable_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversaflow_outbox_deliverable_idx ON conversaflow.outbox USING btree (next_run_at) WHERE (state = 'pending'::text);


--
-- Name: conversaflow_tool_calls_turn_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversaflow_tool_calls_turn_idx ON conversaflow.tool_calls USING btree (turn_id, started_at);


--
-- Name: conversaflow_turns_conversation_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversaflow_turns_conversation_idx ON conversaflow.conversation_turns USING btree (conversation_id, created_at DESC);


--
-- Name: conversaflow_workflow_jobs_claimable_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversaflow_workflow_jobs_claimable_idx ON conversaflow.workflow_jobs USING btree (priority DESC, next_run_at) WHERE (state = 'pending'::text);


--
-- Name: kds_device_events_tenant_time_idx; Type: INDEX; Schema: kds; Owner: -
--

CREATE INDEX kds_device_events_tenant_time_idx ON kds.device_events USING btree (tenant_id, occurred_at DESC);


--
-- Name: kds_device_sessions_tenant_active_idx; Type: INDEX; Schema: kds; Owner: -
--

CREATE INDEX kds_device_sessions_tenant_active_idx ON kds.device_sessions USING btree (tenant_id, is_active, last_seen_at DESC);


--
-- Name: kds_ticket_events_tenant_sequence_idx; Type: INDEX; Schema: kds; Owner: -
--

CREATE INDEX kds_ticket_events_tenant_sequence_idx ON kds.ticket_events USING btree (tenant_id, sequence);


--
-- Name: kds_ticket_items_ticket_idx; Type: INDEX; Schema: kds; Owner: -
--

CREATE INDEX kds_ticket_items_ticket_idx ON kds.ticket_items USING btree (ticket_id, display_order);


--
-- Name: kds_tickets_tenant_status_created_idx; Type: INDEX; Schema: kds; Owner: -
--

CREATE INDEX kds_tickets_tenant_status_created_idx ON kds.tickets USING btree (tenant_id, status, created_at);


--
-- Name: legacy_contact_mappings_contact_idx; Type: INDEX; Schema: legacy; Owner: -
--

CREATE INDEX legacy_contact_mappings_contact_idx ON legacy.contact_mappings USING btree (tenant_id, contact_id);


--
-- Name: legacy_kds_ticket_mappings_ticket_idx; Type: INDEX; Schema: legacy; Owner: -
--

CREATE INDEX legacy_kds_ticket_mappings_ticket_idx ON legacy.kds_ticket_mappings USING btree (tenant_id, ticket_id);


--
-- Name: legacy_location_mappings_location_idx; Type: INDEX; Schema: legacy; Owner: -
--

CREATE INDEX legacy_location_mappings_location_idx ON legacy.location_mappings USING btree (tenant_id, location_id);


--
-- Name: legacy_order_mappings_order_idx; Type: INDEX; Schema: legacy; Owner: -
--

CREATE INDEX legacy_order_mappings_order_idx ON legacy.order_mappings USING btree (tenant_id, order_id);


--
-- Name: legacy_public_compat_imports_table_idx; Type: INDEX; Schema: legacy; Owner: -
--

CREATE INDEX legacy_public_compat_imports_table_idx ON legacy.public_compat_imports USING btree (source_table, action);


--
-- Name: legacy_replay_queue_status_idx; Type: INDEX; Schema: legacy; Owner: -
--

CREATE INDEX legacy_replay_queue_status_idx ON legacy.replay_queue USING btree (status, created_at);


--
-- Name: legacy_staff_mappings_staff_idx; Type: INDEX; Schema: legacy; Owner: -
--

CREATE INDEX legacy_staff_mappings_staff_idx ON legacy.staff_mappings USING btree (tenant_id, staff_member_id);


--
-- Name: legacy_tenant_mappings_tenant_idx; Type: INDEX; Schema: legacy; Owner: -
--

CREATE INDEX legacy_tenant_mappings_tenant_idx ON legacy.tenant_mappings USING btree (tenant_id, source_product);


--
-- Name: legacy_user_mappings_user_idx; Type: INDEX; Schema: legacy; Owner: -
--

CREATE INDEX legacy_user_mappings_user_idx ON legacy.user_mappings USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: observability_audit_events_tenant_time_idx; Type: INDEX; Schema: observability; Owner: -
--

CREATE INDEX observability_audit_events_tenant_time_idx ON observability.audit_events USING btree (tenant_id, occurred_at DESC);


--
-- Name: observability_integration_checks_key_time_idx; Type: INDEX; Schema: observability; Owner: -
--

CREATE INDEX observability_integration_checks_key_time_idx ON observability.integration_checks USING btree (integration_key, checked_at DESC);


--
-- Name: observability_pipeline_traces_tenant_time_idx; Type: INDEX; Schema: observability; Owner: -
--

CREATE INDEX observability_pipeline_traces_tenant_time_idx ON observability.pipeline_traces USING btree (tenant_id, occurred_at DESC);


--
-- Name: observability_pipeline_traces_trace_idx; Type: INDEX; Schema: observability; Owner: -
--

CREATE INDEX observability_pipeline_traces_trace_idx ON observability.pipeline_traces USING btree (trace_id, occurred_at);


--
-- Name: observability_quality_findings_tenant_status_idx; Type: INDEX; Schema: observability; Owner: -
--

CREATE INDEX observability_quality_findings_tenant_status_idx ON observability.data_quality_findings USING btree (tenant_id, status, severity, created_at DESC);


--
-- Name: observability_runtime_logs_source_time_idx; Type: INDEX; Schema: observability; Owner: -
--

CREATE INDEX observability_runtime_logs_source_time_idx ON observability.runtime_logs USING btree (source, occurred_at DESC);


--
-- Name: platform_contact_identities_contact_idx; Type: INDEX; Schema: platform; Owner: -
--

CREATE INDEX platform_contact_identities_contact_idx ON platform.contact_identities USING btree (contact_id);


--
-- Name: platform_contact_identities_lookup_idx; Type: INDEX; Schema: platform; Owner: -
--

CREATE INDEX platform_contact_identities_lookup_idx ON platform.contact_identities USING btree (tenant_id, identity_type, normalized_value) WHERE (normalized_value IS NOT NULL);


--
-- Name: platform_contact_identities_verified_uidx; Type: INDEX; Schema: platform; Owner: -
--

CREATE UNIQUE INDEX platform_contact_identities_verified_uidx ON platform.contact_identities USING btree (tenant_id, identity_type, normalized_value) WHERE ((normalized_value IS NOT NULL) AND (verification_status = 'verified'::text));


--
-- Name: platform_contact_merge_candidates_tenant_confidence_idx; Type: INDEX; Schema: platform; Owner: -
--

CREATE INDEX platform_contact_merge_candidates_tenant_confidence_idx ON platform.contact_merge_candidates USING btree (tenant_id, confidence, created_at DESC);


--
-- Name: platform_contacts_tenant_name_idx; Type: INDEX; Schema: platform; Owner: -
--

CREATE INDEX platform_contacts_tenant_name_idx ON platform.contacts USING btree (tenant_id, display_name);


--
-- Name: platform_external_refs_tenant_idx; Type: INDEX; Schema: platform; Owner: -
--

CREATE INDEX platform_external_refs_tenant_idx ON platform.external_refs USING btree (tenant_id, product_key);


--
-- Name: platform_roles_global_key_uidx; Type: INDEX; Schema: platform; Owner: -
--

CREATE UNIQUE INDEX platform_roles_global_key_uidx ON platform.roles USING btree (key) WHERE (tenant_id IS NULL);


--
-- Name: platform_roles_tenant_key_uidx; Type: INDEX; Schema: platform; Owner: -
--

CREATE UNIQUE INDEX platform_roles_tenant_key_uidx ON platform.roles USING btree (tenant_id, key) WHERE (tenant_id IS NOT NULL);


--
-- Name: platform_staff_members_tenant_email_uidx; Type: INDEX; Schema: platform; Owner: -
--

CREATE UNIQUE INDEX platform_staff_members_tenant_email_uidx ON platform.staff_members USING btree (tenant_id, email) WHERE (email IS NOT NULL);


--
-- Name: platform_staff_members_tenant_phone_uidx; Type: INDEX; Schema: platform; Owner: -
--

CREATE UNIQUE INDEX platform_staff_members_tenant_phone_uidx ON platform.staff_members USING btree (tenant_id, phone) WHERE (phone IS NOT NULL);


--
-- Name: platform_staff_members_tenant_status_idx; Type: INDEX; Schema: platform; Owner: -
--

CREATE INDEX platform_staff_members_tenant_status_idx ON platform.staff_members USING btree (tenant_id, status, name);


--
-- Name: product_instances_tenant_location_product_key; Type: INDEX; Schema: platform; Owner: -
--

CREATE UNIQUE INDEX product_instances_tenant_location_product_key ON platform.product_instances USING btree (tenant_id, location_id, product_key) WHERE (location_id IS NOT NULL);


--
-- Name: product_instances_tenant_product_global_key; Type: INDEX; Schema: platform; Owner: -
--

CREATE UNIQUE INDEX product_instances_tenant_product_global_key ON platform.product_instances USING btree (tenant_id, product_key) WHERE (location_id IS NULL);


--
-- Name: gift_cards gift_cards_created_by_staff_member_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.gift_cards
    ADD CONSTRAINT gift_cards_created_by_staff_member_id_fkey FOREIGN KEY (created_by_staff_member_id) REFERENCES platform.staff_members(id);


--
-- Name: gift_cards gift_cards_recipient_contact_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.gift_cards
    ADD CONSTRAINT gift_cards_recipient_contact_id_fkey FOREIGN KEY (recipient_contact_id) REFERENCES platform.contacts(id);


--
-- Name: gift_cards gift_cards_redeemed_loyalty_card_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.gift_cards
    ADD CONSTRAINT gift_cards_redeemed_loyalty_card_id_fkey FOREIGN KEY (redeemed_loyalty_card_id) REFERENCES cash.loyalty_cards(id);


--
-- Name: gift_cards gift_cards_tenant_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.gift_cards
    ADD CONSTRAINT gift_cards_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: loyalty_accounts loyalty_accounts_contact_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES platform.contacts(id);


--
-- Name: loyalty_accounts loyalty_accounts_program_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_program_id_fkey FOREIGN KEY (program_id) REFERENCES cash.wallet_programs(id);


--
-- Name: loyalty_accounts loyalty_accounts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: loyalty_cards loyalty_cards_loyalty_account_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.loyalty_cards
    ADD CONSTRAINT loyalty_cards_loyalty_account_id_fkey FOREIGN KEY (loyalty_account_id) REFERENCES cash.loyalty_accounts(id) ON DELETE CASCADE;


--
-- Name: loyalty_cards loyalty_cards_tenant_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.loyalty_cards
    ADD CONSTRAINT loyalty_cards_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: otp_verifications otp_verifications_contact_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.otp_verifications
    ADD CONSTRAINT otp_verifications_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES platform.contacts(id);


--
-- Name: otp_verifications otp_verifications_tenant_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.otp_verifications
    ADD CONSTRAINT otp_verifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: pass_devices pass_devices_pass_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.pass_devices
    ADD CONSTRAINT pass_devices_pass_id_fkey FOREIGN KEY (pass_id) REFERENCES cash.passes(id) ON DELETE CASCADE;


--
-- Name: pass_devices pass_devices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.pass_devices
    ADD CONSTRAINT pass_devices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: passes passes_loyalty_card_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.passes
    ADD CONSTRAINT passes_loyalty_card_id_fkey FOREIGN KEY (loyalty_card_id) REFERENCES cash.loyalty_cards(id) ON DELETE CASCADE;


--
-- Name: passes passes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.passes
    ADD CONSTRAINT passes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: reward_configs reward_configs_program_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.reward_configs
    ADD CONSTRAINT reward_configs_program_id_fkey FOREIGN KEY (program_id) REFERENCES cash.wallet_programs(id);


--
-- Name: reward_configs reward_configs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.reward_configs
    ADD CONSTRAINT reward_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: reward_redemptions reward_redemptions_loyalty_card_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.reward_redemptions
    ADD CONSTRAINT reward_redemptions_loyalty_card_id_fkey FOREIGN KEY (loyalty_card_id) REFERENCES cash.loyalty_cards(id);


--
-- Name: reward_redemptions reward_redemptions_reward_config_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.reward_redemptions
    ADD CONSTRAINT reward_redemptions_reward_config_id_fkey FOREIGN KEY (reward_config_id) REFERENCES cash.reward_configs(id);


--
-- Name: reward_redemptions reward_redemptions_staff_member_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.reward_redemptions
    ADD CONSTRAINT reward_redemptions_staff_member_id_fkey FOREIGN KEY (staff_member_id) REFERENCES platform.staff_members(id);


--
-- Name: reward_redemptions reward_redemptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.reward_redemptions
    ADD CONSTRAINT reward_redemptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: wallet_programs wallet_programs_location_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.wallet_programs
    ADD CONSTRAINT wallet_programs_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id);


--
-- Name: wallet_programs wallet_programs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.wallet_programs
    ADD CONSTRAINT wallet_programs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: wallet_transactions wallet_transactions_loyalty_card_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.wallet_transactions
    ADD CONSTRAINT wallet_transactions_loyalty_card_id_fkey FOREIGN KEY (loyalty_card_id) REFERENCES cash.loyalty_cards(id);


--
-- Name: wallet_transactions wallet_transactions_staff_member_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.wallet_transactions
    ADD CONSTRAINT wallet_transactions_staff_member_id_fkey FOREIGN KEY (staff_member_id) REFERENCES platform.staff_members(id);


--
-- Name: wallet_transactions wallet_transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: cash; Owner: -
--

ALTER TABLE ONLY cash.wallet_transactions
    ADD CONSTRAINT wallet_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: business_hours business_hours_location_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.business_hours
    ADD CONSTRAINT business_hours_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id);


--
-- Name: business_hours business_hours_tenant_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.business_hours
    ADD CONSTRAINT business_hours_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: order_events order_events_actor_staff_member_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_events
    ADD CONSTRAINT order_events_actor_staff_member_id_fkey FOREIGN KEY (actor_staff_member_id) REFERENCES platform.staff_members(id);


--
-- Name: order_events order_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_events
    ADD CONSTRAINT order_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES platform.users(id);


--
-- Name: order_events order_events_order_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_events
    ADD CONSTRAINT order_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES commerce.orders(id) ON DELETE CASCADE;


--
-- Name: order_events order_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_events
    ADD CONSTRAINT order_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES commerce.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_items
    ADD CONSTRAINT order_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: orders orders_contact_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES platform.contacts(id);


--
-- Name: orders orders_location_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id);


--
-- Name: orders orders_tenant_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: payments payments_contact_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES platform.contacts(id);


--
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES commerce.orders(id) ON DELETE SET NULL;


--
-- Name: payments payments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: refunds refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.refunds
    ADD CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES commerce.payments(id) ON DELETE CASCADE;


--
-- Name: refunds refunds_tenant_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.refunds
    ADD CONSTRAINT refunds_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: service_windows service_windows_location_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.service_windows
    ADD CONSTRAINT service_windows_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id);


--
-- Name: service_windows service_windows_tenant_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.service_windows
    ADD CONSTRAINT service_windows_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: channel_accounts channel_accounts_channel_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.channel_accounts
    ADD CONSTRAINT channel_accounts_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES conversaflow.channels(id);


--
-- Name: channel_accounts channel_accounts_location_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.channel_accounts
    ADD CONSTRAINT channel_accounts_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id);


--
-- Name: channel_accounts channel_accounts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.channel_accounts
    ADD CONSTRAINT channel_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: channels channels_tenant_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.channels
    ADD CONSTRAINT channels_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: conversation_outcomes conversation_outcomes_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversaflow.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_outcomes conversation_outcomes_order_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_order_id_fkey FOREIGN KEY (order_id) REFERENCES commerce.orders(id);


--
-- Name: conversation_outcomes conversation_outcomes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: conversation_turns conversation_turns_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_turns
    ADD CONSTRAINT conversation_turns_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversaflow.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_turns conversation_turns_tenant_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_turns
    ADD CONSTRAINT conversation_turns_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: conversations conversations_channel_account_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversations
    ADD CONSTRAINT conversations_channel_account_id_fkey FOREIGN KEY (channel_account_id) REFERENCES conversaflow.channel_accounts(id);


--
-- Name: conversations conversations_contact_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversations
    ADD CONSTRAINT conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES platform.contacts(id);


--
-- Name: conversations conversations_location_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversations
    ADD CONSTRAINT conversations_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id);


--
-- Name: conversations conversations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversations
    ADD CONSTRAINT conversations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: job_attempts job_attempts_job_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.job_attempts
    ADD CONSTRAINT job_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES conversaflow.workflow_jobs(id) ON DELETE CASCADE;


--
-- Name: job_attempts job_attempts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.job_attempts
    ADD CONSTRAINT job_attempts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: memory_items memory_items_contact_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.memory_items
    ADD CONSTRAINT memory_items_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES platform.contacts(id);


--
-- Name: memory_items memory_items_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.memory_items
    ADD CONSTRAINT memory_items_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversaflow.conversations(id);


--
-- Name: memory_items memory_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.memory_items
    ADD CONSTRAINT memory_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: messages messages_contact_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.messages
    ADD CONSTRAINT messages_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES platform.contacts(id);


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversaflow.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_tenant_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.messages
    ADD CONSTRAINT messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: outbox outbox_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.outbox
    ADD CONSTRAINT outbox_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversaflow.conversations(id);


--
-- Name: outbox outbox_job_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.outbox
    ADD CONSTRAINT outbox_job_id_fkey FOREIGN KEY (job_id) REFERENCES conversaflow.workflow_jobs(id) ON DELETE SET NULL;


--
-- Name: outbox outbox_order_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.outbox
    ADD CONSTRAINT outbox_order_id_fkey FOREIGN KEY (order_id) REFERENCES commerce.orders(id);


--
-- Name: outbox outbox_tenant_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.outbox
    ADD CONSTRAINT outbox_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: tool_calls tool_calls_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.tool_calls
    ADD CONSTRAINT tool_calls_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversaflow.conversations(id);


--
-- Name: tool_calls tool_calls_tenant_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.tool_calls
    ADD CONSTRAINT tool_calls_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: tool_calls tool_calls_turn_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.tool_calls
    ADD CONSTRAINT tool_calls_turn_id_fkey FOREIGN KEY (turn_id) REFERENCES conversaflow.conversation_turns(id);


--
-- Name: workflow_jobs workflow_jobs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.workflow_jobs
    ADD CONSTRAINT workflow_jobs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversaflow.conversations(id);


--
-- Name: workflow_jobs workflow_jobs_order_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.workflow_jobs
    ADD CONSTRAINT workflow_jobs_order_id_fkey FOREIGN KEY (order_id) REFERENCES commerce.orders(id);


--
-- Name: workflow_jobs workflow_jobs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.workflow_jobs
    ADD CONSTRAINT workflow_jobs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: device_events device_events_device_session_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.device_events
    ADD CONSTRAINT device_events_device_session_id_fkey FOREIGN KEY (device_session_id) REFERENCES kds.device_sessions(id) ON DELETE SET NULL;


--
-- Name: device_events device_events_station_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.device_events
    ADD CONSTRAINT device_events_station_id_fkey FOREIGN KEY (station_id) REFERENCES kds.stations(id);


--
-- Name: device_events device_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.device_events
    ADD CONSTRAINT device_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: device_sessions device_sessions_location_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.device_sessions
    ADD CONSTRAINT device_sessions_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id);


--
-- Name: device_sessions device_sessions_station_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.device_sessions
    ADD CONSTRAINT device_sessions_station_id_fkey FOREIGN KEY (station_id) REFERENCES kds.stations(id);


--
-- Name: device_sessions device_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.device_sessions
    ADD CONSTRAINT device_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: stations stations_location_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.stations
    ADD CONSTRAINT stations_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id);


--
-- Name: stations stations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.stations
    ADD CONSTRAINT stations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: ticket_events ticket_events_order_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_events
    ADD CONSTRAINT ticket_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES commerce.orders(id) ON DELETE CASCADE;


--
-- Name: ticket_events ticket_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_events
    ADD CONSTRAINT ticket_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: ticket_events ticket_events_ticket_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_events
    ADD CONSTRAINT ticket_events_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES kds.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_items ticket_items_order_item_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_items
    ADD CONSTRAINT ticket_items_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES commerce.order_items(id) ON DELETE SET NULL;


--
-- Name: ticket_items ticket_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_items
    ADD CONSTRAINT ticket_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: ticket_items ticket_items_ticket_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_items
    ADD CONSTRAINT ticket_items_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES kds.tickets(id) ON DELETE CASCADE;


--
-- Name: tickets tickets_contact_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES platform.contacts(id);


--
-- Name: tickets tickets_location_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id);


--
-- Name: tickets tickets_order_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_order_id_fkey FOREIGN KEY (order_id) REFERENCES commerce.orders(id) ON DELETE CASCADE;


--
-- Name: tickets tickets_station_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_station_id_fkey FOREIGN KEY (station_id) REFERENCES kds.stations(id);


--
-- Name: tickets tickets_tenant_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: contact_mappings contact_mappings_contact_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.contact_mappings
    ADD CONSTRAINT contact_mappings_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES platform.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_mappings contact_mappings_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.contact_mappings
    ADD CONSTRAINT contact_mappings_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES legacy.import_batches(id) ON DELETE SET NULL;


--
-- Name: contact_mappings contact_mappings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.contact_mappings
    ADD CONSTRAINT contact_mappings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: kds_ticket_mappings kds_ticket_mappings_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.kds_ticket_mappings
    ADD CONSTRAINT kds_ticket_mappings_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES legacy.import_batches(id) ON DELETE SET NULL;


--
-- Name: kds_ticket_mappings kds_ticket_mappings_order_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.kds_ticket_mappings
    ADD CONSTRAINT kds_ticket_mappings_order_id_fkey FOREIGN KEY (order_id) REFERENCES commerce.orders(id) ON DELETE SET NULL;


--
-- Name: kds_ticket_mappings kds_ticket_mappings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.kds_ticket_mappings
    ADD CONSTRAINT kds_ticket_mappings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: kds_ticket_mappings kds_ticket_mappings_ticket_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.kds_ticket_mappings
    ADD CONSTRAINT kds_ticket_mappings_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES kds.tickets(id) ON DELETE CASCADE;


--
-- Name: location_mappings location_mappings_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.location_mappings
    ADD CONSTRAINT location_mappings_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES legacy.import_batches(id) ON DELETE SET NULL;


--
-- Name: location_mappings location_mappings_location_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.location_mappings
    ADD CONSTRAINT location_mappings_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id) ON DELETE CASCADE;


--
-- Name: location_mappings location_mappings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.location_mappings
    ADD CONSTRAINT location_mappings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: order_mappings order_mappings_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.order_mappings
    ADD CONSTRAINT order_mappings_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES legacy.import_batches(id) ON DELETE SET NULL;


--
-- Name: order_mappings order_mappings_order_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.order_mappings
    ADD CONSTRAINT order_mappings_order_id_fkey FOREIGN KEY (order_id) REFERENCES commerce.orders(id) ON DELETE CASCADE;


--
-- Name: order_mappings order_mappings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.order_mappings
    ADD CONSTRAINT order_mappings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: public_compat_imports public_compat_imports_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.public_compat_imports
    ADD CONSTRAINT public_compat_imports_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES legacy.import_batches(id) ON DELETE SET NULL;


--
-- Name: replay_queue replay_queue_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.replay_queue
    ADD CONSTRAINT replay_queue_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES platform.users(id) ON DELETE SET NULL;


--
-- Name: replay_queue replay_queue_tenant_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.replay_queue
    ADD CONSTRAINT replay_queue_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: staff_mappings staff_mappings_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.staff_mappings
    ADD CONSTRAINT staff_mappings_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES legacy.import_batches(id) ON DELETE SET NULL;


--
-- Name: staff_mappings staff_mappings_staff_member_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.staff_mappings
    ADD CONSTRAINT staff_mappings_staff_member_id_fkey FOREIGN KEY (staff_member_id) REFERENCES platform.staff_members(id) ON DELETE CASCADE;


--
-- Name: staff_mappings staff_mappings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.staff_mappings
    ADD CONSTRAINT staff_mappings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_mappings tenant_mappings_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.tenant_mappings
    ADD CONSTRAINT tenant_mappings_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES legacy.import_batches(id) ON DELETE SET NULL;


--
-- Name: tenant_mappings tenant_mappings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.tenant_mappings
    ADD CONSTRAINT tenant_mappings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: user_mappings user_mappings_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.user_mappings
    ADD CONSTRAINT user_mappings_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES legacy.import_batches(id) ON DELETE SET NULL;


--
-- Name: user_mappings user_mappings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.user_mappings
    ADD CONSTRAINT user_mappings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: user_mappings user_mappings_user_id_fkey; Type: FK CONSTRAINT; Schema: legacy; Owner: -
--

ALTER TABLE ONLY legacy.user_mappings
    ADD CONSTRAINT user_mappings_user_id_fkey FOREIGN KEY (user_id) REFERENCES platform.users(id) ON DELETE CASCADE;


--
-- Name: audit_events audit_events_actor_staff_member_id_fkey; Type: FK CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.audit_events
    ADD CONSTRAINT audit_events_actor_staff_member_id_fkey FOREIGN KEY (actor_staff_member_id) REFERENCES platform.staff_members(id);


--
-- Name: audit_events audit_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.audit_events
    ADD CONSTRAINT audit_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES platform.users(id);


--
-- Name: audit_events audit_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.audit_events
    ADD CONSTRAINT audit_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: data_quality_findings data_quality_findings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.data_quality_findings
    ADD CONSTRAINT data_quality_findings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: integration_checks integration_checks_tenant_id_fkey; Type: FK CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.integration_checks
    ADD CONSTRAINT integration_checks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: pipeline_traces pipeline_traces_tenant_id_fkey; Type: FK CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.pipeline_traces
    ADD CONSTRAINT pipeline_traces_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: runtime_logs runtime_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: observability; Owner: -
--

ALTER TABLE ONLY observability.runtime_logs
    ADD CONSTRAINT runtime_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id);


--
-- Name: contact_identities contact_identities_contact_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.contact_identities
    ADD CONSTRAINT contact_identities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES platform.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_identities contact_identities_tenant_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.contact_identities
    ADD CONSTRAINT contact_identities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: contact_merge_candidates contact_merge_candidates_left_contact_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.contact_merge_candidates
    ADD CONSTRAINT contact_merge_candidates_left_contact_id_fkey FOREIGN KEY (left_contact_id) REFERENCES platform.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_merge_candidates contact_merge_candidates_right_contact_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.contact_merge_candidates
    ADD CONSTRAINT contact_merge_candidates_right_contact_id_fkey FOREIGN KEY (right_contact_id) REFERENCES platform.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_merge_candidates contact_merge_candidates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.contact_merge_candidates
    ADD CONSTRAINT contact_merge_candidates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.contacts
    ADD CONSTRAINT contacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: external_refs external_refs_location_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.external_refs
    ADD CONSTRAINT external_refs_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id) ON DELETE CASCADE;


--
-- Name: external_refs external_refs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.external_refs
    ADD CONSTRAINT external_refs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: locations locations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.locations
    ADD CONSTRAINT locations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: membership_roles membership_roles_membership_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.membership_roles
    ADD CONSTRAINT membership_roles_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES platform.tenant_memberships(id) ON DELETE CASCADE;


--
-- Name: membership_roles membership_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.membership_roles
    ADD CONSTRAINT membership_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES platform.roles(id) ON DELETE CASCADE;


--
-- Name: product_instances product_instances_location_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.product_instances
    ADD CONSTRAINT product_instances_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id) ON DELETE CASCADE;


--
-- Name: product_instances product_instances_tenant_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.product_instances
    ADD CONSTRAINT product_instances_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES platform.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES platform.roles(id) ON DELETE CASCADE;


--
-- Name: roles roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.roles
    ADD CONSTRAINT roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: staff_members staff_members_location_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.staff_members
    ADD CONSTRAINT staff_members_location_id_fkey FOREIGN KEY (location_id) REFERENCES platform.locations(id) ON DELETE SET NULL;


--
-- Name: staff_members staff_members_tenant_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.staff_members
    ADD CONSTRAINT staff_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: staff_members staff_members_user_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.staff_members
    ADD CONSTRAINT staff_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES platform.users(id) ON DELETE SET NULL;


--
-- Name: tenant_memberships tenant_memberships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.tenant_memberships
    ADD CONSTRAINT tenant_memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_memberships tenant_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: platform; Owner: -
--

ALTER TABLE ONLY platform.tenant_memberships
    ADD CONSTRAINT tenant_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES platform.users(id) ON DELETE CASCADE;


--
-- Name: contact_identities; Type: ROW SECURITY; Schema: platform; Owner: -
--

ALTER TABLE platform.contact_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_merge_candidates; Type: ROW SECURITY; Schema: platform; Owner: -
--

ALTER TABLE platform.contact_merge_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: platform; Owner: -
--

ALTER TABLE platform.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: external_refs; Type: ROW SECURITY; Schema: platform; Owner: -
--

ALTER TABLE platform.external_refs ENABLE ROW LEVEL SECURITY;

--
-- Name: locations; Type: ROW SECURITY; Schema: platform; Owner: -
--

ALTER TABLE platform.locations ENABLE ROW LEVEL SECURITY;

--
-- Name: product_instances; Type: ROW SECURITY; Schema: platform; Owner: -
--

ALTER TABLE platform.product_instances ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_members; Type: ROW SECURITY; Schema: platform; Owner: -
--

ALTER TABLE platform.staff_members ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_identities tenant_member_select_contact_identities; Type: POLICY; Schema: platform; Owner: -
--

CREATE POLICY tenant_member_select_contact_identities ON platform.contact_identities FOR SELECT USING (platform.can_access_tenant(tenant_id));


--
-- Name: contact_merge_candidates tenant_member_select_contact_merge_candidates; Type: POLICY; Schema: platform; Owner: -
--

CREATE POLICY tenant_member_select_contact_merge_candidates ON platform.contact_merge_candidates FOR SELECT USING (platform.can_access_tenant(tenant_id));


--
-- Name: contacts tenant_member_select_contacts; Type: POLICY; Schema: platform; Owner: -
--

CREATE POLICY tenant_member_select_contacts ON platform.contacts FOR SELECT USING (platform.can_access_tenant(tenant_id));


--
-- Name: external_refs tenant_member_select_external_refs; Type: POLICY; Schema: platform; Owner: -
--

CREATE POLICY tenant_member_select_external_refs ON platform.external_refs FOR SELECT USING (((tenant_id IS NULL) OR platform.can_access_tenant(tenant_id)));


--
-- Name: locations tenant_member_select_locations; Type: POLICY; Schema: platform; Owner: -
--

CREATE POLICY tenant_member_select_locations ON platform.locations FOR SELECT USING (platform.can_access_tenant(tenant_id));


--
-- Name: tenant_memberships tenant_member_select_memberships; Type: POLICY; Schema: platform; Owner: -
--

CREATE POLICY tenant_member_select_memberships ON platform.tenant_memberships FOR SELECT USING (platform.can_access_tenant(tenant_id));


--
-- Name: product_instances tenant_member_select_products; Type: POLICY; Schema: platform; Owner: -
--

CREATE POLICY tenant_member_select_products ON platform.product_instances FOR SELECT USING (platform.can_access_tenant(tenant_id));


--
-- Name: staff_members tenant_member_select_staff; Type: POLICY; Schema: platform; Owner: -
--

CREATE POLICY tenant_member_select_staff ON platform.staff_members FOR SELECT USING (platform.can_access_tenant(tenant_id));


--
-- Name: tenants tenant_member_select_tenants; Type: POLICY; Schema: platform; Owner: -
--

CREATE POLICY tenant_member_select_tenants ON platform.tenants FOR SELECT USING (platform.can_access_tenant(id));


--
-- Name: tenant_memberships; Type: ROW SECURITY; Schema: platform; Owner: -
--

ALTER TABLE platform.tenant_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: tenants; Type: ROW SECURITY; Schema: platform; Owner: -
--

ALTER TABLE platform.tenants ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict KUc1AiVGFBhlKK9jdyeLPLlZ0G3liUe8wLyNojaMxyvt9xlC0zmH81oUtg7vpIR

