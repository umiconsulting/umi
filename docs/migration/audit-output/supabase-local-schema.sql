--
-- PostgreSQL database dump
--

\restrict 47SlS4acJaaCmhxKFXcspHL7KYT2FvjTo2A3L2j6dtMKGusm5aOepAGnPSV8dn5

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
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: conversaflow; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA conversaflow;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql;


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql_public;


--
-- Name: kds; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA kds;


--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgbouncer;


--
-- Name: platform; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA platform;


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA realtime;


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: supabase_migrations; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA supabase_migrations;


--
-- Name: umi_cash; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA umi_cash;


--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA vault;


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: cancel_reason_code; Type: TYPE; Schema: kds; Owner: -
--

CREATE TYPE kds.cancel_reason_code AS ENUM (
    'out_of_stock',
    'kitchen_overload',
    'closing_soon',
    'customer_no_show',
    'duplicate_order',
    'other'
);


--
-- Name: ticket_event_kind; Type: TYPE; Schema: kds; Owner: -
--

CREATE TYPE kds.ticket_event_kind AS ENUM (
    'snapshot_reconciled',
    'order_upserted',
    'status_changed',
    'order_removed'
);


--
-- Name: ticket_status; Type: TYPE; Schema: kds; Owner: -
--

CREATE TYPE kds.ticket_status AS ENUM (
    'new',
    'accepted',
    'preparing',
    'ready',
    'completed',
    'cancelled',
    'partial_cancelled'
);


--
-- Name: action; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in'
);


--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text
);


--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: jobs; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inbound_event_id uuid,
    business_id uuid NOT NULL,
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
    CONSTRAINT jobs_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'claimed'::text, 'running'::text, 'completed'::text, 'failed'::text, 'dead'::text])))
);


--
-- Name: COLUMN jobs.inbound_event_id; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.jobs.inbound_event_id IS 'The inbound event that triggered this job. NULL for cron-originated or child jobs spawned by another job.';


--
-- Name: COLUMN jobs.job_type; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.jobs.job_type IS 'Job type identifier matching a processor function. E.g. ''conversation.process'', ''message.embed'', ''order.create''. See ARCHITECTURE_TARGET.md §3 for full catalog.';


--
-- Name: COLUMN jobs.aggregate_type; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.jobs.aggregate_type IS 'Domain aggregate this job operates on: ''conversation'', ''transaction'', ''business'', ''customer'', ''message''.';


--
-- Name: COLUMN jobs.aggregate_id; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.jobs.aggregate_id IS 'Primary key of the aggregate (conversation_id, order_id, business_id, etc.). Used to detect concurrent jobs on the same aggregate.';


--
-- Name: COLUMN jobs.state; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.jobs.state IS 'Job lifecycle state. ''dead'' means all retry attempts exhausted — requires operator review.';


--
-- Name: COLUMN jobs.priority; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.jobs.priority IS 'Higher value = claimed sooner. 0 = normal priority. Use sparingly to avoid priority inversion.';


--
-- Name: COLUMN jobs.locked_by; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.jobs.locked_by IS 'Worker instance UUID that claimed this job. Used for stale lock detection — if locked_at is >2 minutes old and state is ''claimed'', the job is reset to ''pending''.';


--
-- Name: claim_next_job(text); Type: FUNCTION; Schema: conversaflow; Owner: -
--

CREATE FUNCTION conversaflow.claim_next_job(p_worker_id text) RETURNS SETOF conversaflow.jobs
    LANGUAGE sql
    AS $$
  UPDATE conversaflow.jobs
  SET    state = 'claimed',
         locked_at = now(),
         locked_by = p_worker_id
  WHERE  id = (
    SELECT j.id
    FROM conversaflow.jobs j
    WHERE j.state = 'pending'
      AND j.next_run_at <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM conversaflow.jobs active
        WHERE active.id <> j.id
          AND active.aggregate_type = j.aggregate_type
          AND active.aggregate_id = j.aggregate_id
          AND active.state IN ('claimed', 'running')
          AND j.aggregate_type = 'conversation'
          AND j.job_type IN ('turn.integrity', 'turn.process')
          AND active.job_type IN ('turn.integrity', 'turn.process')
      )
    ORDER BY j.priority DESC, j.next_run_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;


--
-- Name: outbox; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid,
    business_id uuid NOT NULL,
    kind text NOT NULL,
    aggregate_id uuid,
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
-- Name: COLUMN outbox.job_id; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.outbox.job_id IS 'Optional link to conversaflow.jobs; NULL for RPC-enqueued rows (e.g. KDS status).';


--
-- Name: COLUMN outbox.kind; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.outbox.kind IS 'Delivery adapter identifier. E.g. ''twilio.reply'', ''slack.new_order'', ''voyage.embed''. See ARCHITECTURE_TARGET.md §4 for full catalog.';


--
-- Name: COLUMN outbox.aggregate_id; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.outbox.aggregate_id IS 'Domain object this side effect relates to (order_id, conversation_id, etc.). For debugging and dashboard filtering.';


--
-- Name: COLUMN outbox.idempotency_key; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.outbox.idempotency_key IS 'Globally unique key for deduplication. Pattern: ''{kind}:{domain_id}'' e.g. ''twilio_reply:{message_id}'', ''slack_order:{order_id}''. Prevents duplicate delivery if a job retries and re-inserts the same outbox row.';


--
-- Name: COLUMN outbox.state; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.outbox.state IS 'Delivery lifecycle: pending → delivering → delivered/failed. ''dead'' means max_attempts exhausted — requires operator review.';


--
-- Name: claim_outbox_batch(text, integer); Type: FUNCTION; Schema: conversaflow; Owner: -
--

CREATE FUNCTION conversaflow.claim_outbox_batch(p_worker_id text, p_limit integer DEFAULT 5) RETURNS SETOF conversaflow.outbox
    LANGUAGE sql
    AS $$
  UPDATE conversaflow.outbox
  SET    state = 'delivering',
         attempts = attempts + 1
  WHERE  id IN (
    SELECT id FROM conversaflow.outbox
    WHERE  state = 'pending'
    AND    next_run_at <= now()
    ORDER BY next_run_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;


--
-- Name: reclaim_stale_jobs(); Type: FUNCTION; Schema: conversaflow; Owner: -
--

CREATE FUNCTION conversaflow.reclaim_stale_jobs() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  reclaimed INT;
BEGIN
  UPDATE conversaflow.jobs
  SET    state = 'pending',
         locked_at = NULL,
         locked_by = NULL
  WHERE  state IN ('claimed', 'running')
  AND    locked_at < now() - INTERVAL '2 minutes';

  GET DIAGNOSTICS reclaimed = ROW_COUNT;
  RETURN reclaimed;
END;
$$;


--
-- Name: reclaim_stale_outbox(); Type: FUNCTION; Schema: conversaflow; Owner: -
--

CREATE FUNCTION conversaflow.reclaim_stale_outbox() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  reclaimed INT;
BEGIN
  UPDATE conversaflow.outbox
  SET    state = 'pending'
  WHERE  state = 'delivering'
  AND    next_run_at < now() - INTERVAL '2 minutes';

  GET DIAGNOSTICS reclaimed = ROW_COUNT;
  RETURN reclaimed;
END;
$$;


--
-- Name: search_customer_messages(uuid, uuid, uuid, text, integer, integer, text[]); Type: FUNCTION; Schema: conversaflow; Owner: -
--

CREATE FUNCTION conversaflow.search_customer_messages(p_customer_id uuid, p_business_id uuid, p_current_conversation_id uuid, p_embedding text, p_limit integer DEFAULT 5, p_exclude_recent integer DEFAULT 8, p_roles text[] DEFAULT ARRAY['user'::text]) RETURNS TABLE(id uuid, conversation_id uuid, role text, content text, created_at timestamp with time zone, similarity double precision)
    LANGUAGE sql STABLE
    SET search_path TO 'conversaflow', 'extensions'
    AS $$
  WITH recent_excluded AS (
    SELECT id
    FROM conversaflow.messages
    WHERE conversation_id = p_current_conversation_id
    ORDER BY created_at DESC
    LIMIT p_exclude_recent
  )
  SELECT
    m.id,
    m.conversation_id,
    m.role,
    m.content,
    m.created_at,
    1 - (m.embedding <=> p_embedding::extensions.vector) AS similarity
  FROM conversaflow.messages m
  INNER JOIN conversaflow.conversations c
    ON c.id = m.conversation_id
  WHERE c.customer_id = p_customer_id
    AND c.business_id = p_business_id
    AND m.embedding IS NOT NULL
    AND m.id NOT IN (SELECT id FROM recent_excluded)
    AND (p_roles IS NULL OR m.role = ANY(p_roles))
    AND length(trim(m.content)) >= 8
  ORDER BY m.embedding <=> p_embedding::extensions.vector ASC
  LIMIT p_limit;
$$;


--
-- Name: FUNCTION search_customer_messages(p_customer_id uuid, p_business_id uuid, p_current_conversation_id uuid, p_embedding text, p_limit integer, p_exclude_recent integer, p_roles text[]); Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON FUNCTION conversaflow.search_customer_messages(p_customer_id uuid, p_business_id uuid, p_current_conversation_id uuid, p_embedding text, p_limit integer, p_exclude_recent integer, p_roles text[]) IS 'Customer-scoped semantic memory search for conversational recall. Uses Voyage/pgvector message embeddings across all conversations for the same customer and business.';


--
-- Name: search_products_by_embedding(uuid, extensions.vector, integer, double precision); Type: FUNCTION; Schema: conversaflow; Owner: -
--

CREATE FUNCTION conversaflow.search_products_by_embedding(p_business_id uuid, p_embedding extensions.vector, p_limit integer DEFAULT 5, p_threshold double precision DEFAULT 0.65) RETURNS TABLE(id uuid, name text, price numeric, description text, category text, variants jsonb, similarity double precision)
    LANGUAGE sql STABLE
    SET search_path TO 'conversaflow', 'extensions'
    AS $$
  SELECT
    p.id,
    p.name,
    p.price,
    p.description,
    p.category,
    p.variants,
    1 - (p.name_embedding <=> p_embedding) AS similarity
  FROM conversaflow.products p
  WHERE p.business_id    = p_business_id
    AND p.available      = TRUE
    AND p.name_embedding IS NOT NULL
    AND 1 - (p.name_embedding <=> p_embedding) >= p_threshold
  ORDER BY p.name_embedding <=> p_embedding
  LIMIT p_limit;
$$;


--
-- Name: search_products_text(uuid, text, integer); Type: FUNCTION; Schema: conversaflow; Owner: -
--

CREATE FUNCTION conversaflow.search_products_text(p_business_id uuid, p_query text, p_limit integer DEFAULT 10) RETURNS TABLE(id uuid, name text, price numeric, description text, category text, variants jsonb)
    LANGUAGE sql STABLE
    SET search_path TO 'conversaflow', 'extensions'
    AS $$
  WITH normalized AS (
    SELECT nullif(trim(p_query), '') AS q
  )
  SELECT
    p.id,
    p.name,
    p.price,
    p.description,
    p.category,
    p.variants
  FROM conversaflow.products p
  CROSS JOIN normalized n
  WHERE p.business_id = p_business_id
    AND p.available   = TRUE
    AND n.q IS NOT NULL
    AND (
      p.name                              ILIKE '%' || n.q || '%'
      OR coalesce(p.description, '')      ILIKE '%' || n.q || '%'
      OR coalesce(p.category,    '')      ILIKE '%' || n.q || '%'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(p.variants, '[]'::jsonb)) AS v
        WHERE coalesce(v->>'name', '')    ILIKE '%' || n.q || '%'
      )
      -- Fuzzy tier: word_similarity checks whether the query phrase appears as a
      -- near-match substring inside the product name (threshold 0.4 ≈ 1-char edit).
      OR word_similarity(lower(n.q), lower(p.name)) > 0.4
    )
  ORDER BY
    CASE
      WHEN lower(p.name) = lower(n.q)                        THEN 0
      WHEN lower(p.name) LIKE lower(n.q) || '%'              THEN 1
      WHEN lower(p.name) LIKE '%' || lower(n.q) || '%'       THEN 2
      WHEN word_similarity(lower(n.q), lower(p.name)) > 0.4  THEN 3
      ELSE 4
    END,
    word_similarity(lower(n.q), lower(p.name)) DESC,
    p.name ASC
  LIMIT greatest(coalesce(p_limit, 10), 1);
$$;


--
-- Name: search_similar_messages(uuid, text, integer, integer); Type: FUNCTION; Schema: conversaflow; Owner: -
--

CREATE FUNCTION conversaflow.search_similar_messages(p_conversation_id uuid, p_embedding text, p_limit integer DEFAULT 5, p_exclude_recent integer DEFAULT 8) RETURNS TABLE(id uuid, role text, content text, similarity double precision)
    LANGUAGE sql STABLE
    SET search_path TO 'conversaflow', 'extensions'
    AS $$
  WITH recent_excluded AS (
    SELECT id
    FROM conversaflow.messages
    WHERE conversation_id = p_conversation_id
    ORDER BY created_at DESC
    LIMIT p_exclude_recent
  )
  SELECT
    m.id,
    m.role,
    m.content,
    1 - (m.embedding <=> p_embedding::extensions.vector) AS similarity
  FROM conversaflow.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.embedding IS NOT NULL
    AND m.id NOT IN (SELECT id FROM recent_excluded)
  ORDER BY m.embedding <=> p_embedding::extensions.vector ASC
  LIMIT p_limit;
$$;


--
-- Name: wake_job_worker_on_insert(); Type: FUNCTION; Schema: conversaflow; Owner: -
--

CREATE FUNCTION conversaflow.wake_job_worker_on_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://xbudknbimkgjjgohnjgp.supabase.co/functions/v1/job-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
        LIMIT 1
      ),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  );
  RETURN NEW;
END;
$$;


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    func_is_graphql_resolve bool;
BEGIN
    func_is_graphql_resolve = (
        SELECT n.proname = 'resolve'
        FROM pg_event_trigger_ddl_commands() AS ev
        LEFT JOIN pg_catalog.pg_proc AS n
        ON ev.objid = n.oid
    );

    IF func_is_graphql_resolve
    THEN
        -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
        DROP FUNCTION IF EXISTS graphql_public.graphql;
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language sql
        as $$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $$;

        -- This hook executes when `graphql.resolve` is created. That is not necessarily the last
        -- function in the extension so we need to grant permissions on existing entities AND
        -- update default permissions to any others that are created after `graphql.resolve`
        grant usage on schema graphql to postgres, anon, authenticated, service_role;
        grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
        grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
        grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

        -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
        grant usage on schema graphql_public to postgres with grant option;
        grant usage on schema graphql to postgres with grant option;
    END IF;

END;
$_$;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: graphql(text, text, jsonb, jsonb); Type: FUNCTION; Schema: graphql_public; Owner: -
--

CREATE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;


--
-- Name: assert_transition(kds.ticket_status, kds.ticket_status); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.assert_transition(p_from kds.ticket_status, p_to kds.ticket_status) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF p_from = p_to THEN
    RETURN;
  END IF;

  CASE p_from
    WHEN 'new' THEN
      IF p_to IN ('accepted', 'cancelled') THEN
        RETURN;
      END IF;
    WHEN 'accepted' THEN
      IF p_to IN ('preparing', 'cancelled', 'partial_cancelled') THEN
        RETURN;
      END IF;
    WHEN 'preparing' THEN
      IF p_to IN ('ready', 'cancelled', 'partial_cancelled') THEN
        RETURN;
      END IF;
    WHEN 'partial_cancelled' THEN
      IF p_to IN ('accepted', 'cancelled') THEN
        RETURN;
      END IF;
    WHEN 'ready' THEN
      IF p_to = 'completed' THEN
        RETURN;
      END IF;
    WHEN 'completed', 'cancelled' THEN
      NULL;
  END CASE;

  RAISE EXCEPTION 'Illegal KDS transition: % -> %', p_from, p_to
    USING ERRCODE = '22023';
END;
$$;


--
-- Name: backfill_from_conversaflow(); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.backfill_from_conversaflow() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
DECLARE
  v_row RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT t.id
    FROM conversaflow.transactions AS t
    WHERE t.transaction_type = 'order'
    ORDER BY t.created_at ASC
  LOOP
    PERFORM kds.project_transaction(
      v_row.id,
      'snapshot_reconciled',
      'backfill',
      format('backfill:%s', v_row.id)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;


--
-- Name: FUNCTION backfill_from_conversaflow(); Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON FUNCTION kds.backfill_from_conversaflow() IS 'Idempotent initial KDS population from the conversaflow operational schema. Emits one snapshot_reconciled event per projected order.';


--
-- Name: cancel_reason_label(kds.cancel_reason_code); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.cancel_reason_label(p_code kds.cancel_reason_code) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE p_code
    WHEN 'out_of_stock' THEN 'Sin existencias'
    WHEN 'kitchen_overload' THEN 'Alta demanda en cocina'
    WHEN 'closing_soon' THEN 'Estamos por cerrar'
    WHEN 'customer_no_show' THEN 'No se presentó la persona que recogería'
    WHEN 'duplicate_order' THEN 'Pedido duplicado'
    WHEN 'other' THEN 'Otro'
    ELSE NULL
  END;
$$;


--
-- Name: tickets; Type: TABLE; Schema: kds; Owner: -
--

CREATE TABLE kds.tickets (
    ticket_id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_transaction_id uuid NOT NULL,
    business_id uuid NOT NULL,
    customer_id uuid,
    source_channel text DEFAULT 'whatsapp'::text NOT NULL,
    customer_name text,
    customer_phone text,
    pickup_person text,
    status kds.ticket_status NOT NULL,
    station_id text,
    station_name text,
    customer_note text,
    total_amount numeric(12,2),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    last_event_sequence bigint,
    raw_details_hash text NOT NULL,
    last_projected_at timestamp with time zone DEFAULT now() NOT NULL,
    cancellation_reason text,
    partial_cancellation_reason text,
    cancellation_reason_code kds.cancel_reason_code,
    cancellation_reason_note text,
    partial_cancellation_reason_code kds.cancel_reason_code,
    partial_cancellation_reason_note text
);


--
-- Name: TABLE tickets; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON TABLE kds.tickets IS 'Kitchen-facing read model. One row per operational order projected from conversaflow.transactions plus customer identity and normalized board fields.';


--
-- Name: COLUMN tickets.source_transaction_id; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON COLUMN kds.tickets.source_transaction_id IS 'Operational source-of-truth order row in conversaflow.transactions.';


--
-- Name: COLUMN tickets.last_event_sequence; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON COLUMN kds.tickets.last_event_sequence IS 'Most recent sequence emitted in kds.ticket_events for reconnect reconciliation.';


--
-- Name: COLUMN tickets.cancellation_reason; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON COLUMN kds.tickets.cancellation_reason IS 'Operator or bot-supplied reason for cancellation. NULL when not cancelled or reason not provided.';


--
-- Name: COLUMN tickets.partial_cancellation_reason; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON COLUMN kds.tickets.partial_cancellation_reason IS 'Operator-supplied reason for partial item cancellation while the customer decides whether to accept the remaining order.';


--
-- Name: COLUMN tickets.cancellation_reason_code; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON COLUMN kds.tickets.cancellation_reason_code IS 'Controlled cancellation reason code for ticket-level cancellations.';


--
-- Name: COLUMN tickets.cancellation_reason_note; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON COLUMN kds.tickets.cancellation_reason_note IS 'Optional operator note for full cancellations. Required when code = other.';


--
-- Name: COLUMN tickets.partial_cancellation_reason_code; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON COLUMN kds.tickets.partial_cancellation_reason_code IS 'Controlled cancellation reason code for partial cancellation proposals.';


--
-- Name: COLUMN tickets.partial_cancellation_reason_note; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON COLUMN kds.tickets.partial_cancellation_reason_note IS 'Optional operator note for partial cancellations. Required when code = other.';


--
-- Name: confirm_partial_cancellation(uuid, text, text, text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.confirm_partial_cancellation(p_ticket_id uuid, p_actor_source text DEFAULT 'whatsapp_bot'::text, p_actor_id text DEFAULT NULL::text, p_actor_channel text DEFAULT NULL::text) RETURNS kds.tickets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
DECLARE
  v_ticket kds.tickets%ROWTYPE;
  v_sequence BIGINT;
BEGIN
  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KDS ticket not found: %', p_ticket_id;
  END IF;

  PERFORM kds.assert_transition(v_ticket.status, 'accepted');

  UPDATE conversaflow.transactions
  SET details = COALESCE(details, '{}'::jsonb)
    - 'partial_cancellation_reason'
    - 'partial_cancellation_reason_code'
    - 'partial_cancellation_reason_note'
  WHERE id = v_ticket.source_transaction_id;

  UPDATE kds.tickets
  SET
    status = 'accepted',
    partial_cancellation_reason = NULL,
    partial_cancellation_reason_code = NULL,
    partial_cancellation_reason_note = NULL,
    updated_at = now(),
    last_projected_at = now()
  WHERE ticket_id = p_ticket_id;

  INSERT INTO kds.ticket_events (
    ticket_id,
    business_id,
    source_transaction_id,
    kind,
    status,
    occurred_at,
    source,
    payload
  )
  VALUES (
    v_ticket.ticket_id,
    v_ticket.business_id,
    v_ticket.source_transaction_id,
    'status_changed',
    'accepted',
    now(),
    p_actor_source,
    jsonb_build_object(
      'from_status', v_ticket.status,
      'to_status', 'accepted',
      'actor_id', p_actor_id,
      'actor_channel', p_actor_channel
    )
  )
  RETURNING sequence INTO v_sequence;

  UPDATE kds.tickets
  SET last_event_sequence = v_sequence
  WHERE ticket_id = p_ticket_id;

  PERFORM kds.enqueue_whatsapp_status_notification(
    p_ticket_id,
    'accepted',
    v_sequence
  );

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  RETURN v_ticket;
END;
$$;


--
-- Name: FUNCTION confirm_partial_cancellation(p_ticket_id uuid, p_actor_source text, p_actor_id text, p_actor_channel text); Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON FUNCTION kds.confirm_partial_cancellation(p_ticket_id uuid, p_actor_source text, p_actor_id text, p_actor_channel text) IS 'Accepts a partially cancelled KDS ticket after the customer confirms the remaining order, clears partial_cancellation_reason, emits a status_changed event, and enqueues the accepted WhatsApp notification.';


--
-- Name: enqueue_whatsapp_partial_cancel_notification(uuid, bigint, integer[], text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.enqueue_whatsapp_partial_cancel_notification(p_ticket_id uuid, p_event_sequence bigint, p_cancelled_display_orders integer[], p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $_$
DECLARE
  v_ticket kds.tickets%ROWTYPE;
  v_phone TEXT;
  v_cancelled_lines TEXT;
  v_remaining_lines TEXT;
  v_total_text TEXT;
  v_body TEXT;
  v_idempotency TEXT;
  v_trace_id TEXT;
BEGIN
  IF p_event_sequence IS NULL OR p_event_sequence < 1 THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF lower(trim(coalesce(v_ticket.source_channel, 'whatsapp'))) IS DISTINCT FROM 'whatsapp' THEN
    RETURN;
  END IF;

  v_phone := trim(both ' ' FROM coalesce(v_ticket.customer_phone, ''));
  IF v_phone = '' AND v_ticket.customer_id IS NOT NULL THEN
    SELECT trim(both ' ' FROM coalesce(c.phone, ''))
    INTO v_phone
    FROM conversaflow.customers AS c
    WHERE c.id = v_ticket.customer_id;
  END IF;

  IF coalesce(v_phone, '') = '' THEN
    RETURN;
  END IF;

  v_phone := regexp_replace(v_phone, '\D', '', 'g');
  IF v_phone IS NULL OR v_phone = '' THEN
    RETURN;
  END IF;
  v_phone := '+' || v_phone;

  SELECT string_agg(
    format(
      '• %sx %s%s — %s',
      i.quantity,
      i.name,
      CASE
        WHEN i.variant_name IS NOT NULL AND trim(i.variant_name) <> '' THEN ' (' || trim(i.variant_name) || ')'
        ELSE ''
      END,
      trim(p_reason)
    ),
    E'\n'
    ORDER BY i.display_order
  )
  INTO v_cancelled_lines
  FROM kds.ticket_items AS i
  WHERE i.ticket_id = p_ticket_id
    AND i.display_order = ANY(COALESCE(p_cancelled_display_orders, ARRAY[]::INTEGER[]));

  IF v_cancelled_lines IS NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(
    format(
      '• %sx %s%s',
      i.quantity,
      i.name,
      CASE
        WHEN i.variant_name IS NOT NULL AND trim(i.variant_name) <> '' THEN ' (' || trim(i.variant_name) || ')'
        ELSE ''
      END
    ),
    E'\n'
    ORDER BY i.display_order
  )
  INTO v_remaining_lines
  FROM kds.ticket_items AS i
  WHERE i.ticket_id = p_ticket_id
    AND NOT i.is_cancelled;

  v_total_text := CASE
    WHEN v_ticket.total_amount IS NULL THEN '—'
    ELSE '$' || to_char(v_ticket.total_amount, 'FM999999990.00')
  END;

  v_body :=
    'Se modificó tu pedido:' ||
    E'\n\n❌ Cancelado:\n' || v_cancelled_lines ||
    E'\n\nTu pedido actualizado:\n' || COALESCE(v_remaining_lines, '• Sin artículos restantes') ||
    E'\nTotal: ' || v_total_text ||
    E'\n\n¿Deseas aceptar estos cambios o quieres hacer alguna modificación?';

  v_idempotency := format('twilio_partial_cancel:%s:%s', p_ticket_id, p_event_sequence);
  v_trace_id := format('kds_status:%s:%s', p_ticket_id, p_event_sequence);

  INSERT INTO conversaflow.outbox (
    job_id,
    business_id,
    kind,
    aggregate_id,
    idempotency_key,
    payload,
    state,
    max_attempts,
    next_run_at
  )
  VALUES (
    NULL,
    v_ticket.business_id,
    'twilio.status_notification',
    v_ticket.source_transaction_id,
    v_idempotency,
    jsonb_build_object(
      'to', v_phone,
      'body', v_body,
      'trace_id', v_trace_id,
      'ticket_id', p_ticket_id,
      'event_sequence', p_event_sequence,
      'target_status', 'partial_cancelled',
      'source_transaction_id', v_ticket.source_transaction_id
    ),
    'pending',
    5,
    now()
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$_$;


--
-- Name: FUNCTION enqueue_whatsapp_partial_cancel_notification(p_ticket_id uuid, p_event_sequence bigint, p_cancelled_display_orders integer[], p_reason text); Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON FUNCTION kds.enqueue_whatsapp_partial_cancel_notification(p_ticket_id uuid, p_event_sequence bigint, p_cancelled_display_orders integer[], p_reason text) IS 'Enqueue a Twilio WhatsApp notification describing partially cancelled items and the updated remaining order. Matches cancelled lines by stable display_order so projection rewrites do not drop the outbox insert.';


--
-- Name: enqueue_whatsapp_status_notification(uuid, kds.ticket_status, bigint); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.enqueue_whatsapp_status_notification(p_ticket_id uuid, p_target_status kds.ticket_status, p_event_sequence bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $_$
DECLARE
  v_ticket kds.tickets%ROWTYPE;
  v_phone TEXT;
  v_body TEXT;
  v_idempotency TEXT;
  v_from_status kds.ticket_status;
  v_customer_reason TEXT;
  v_total_text TEXT;
  v_trace_id TEXT;
BEGIN
  IF p_event_sequence IS NULL OR p_event_sequence < 1 THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF lower(trim(coalesce(v_ticket.source_channel, 'whatsapp'))) IS DISTINCT FROM 'whatsapp' THEN
    RETURN;
  END IF;

  SELECT CASE e.payload->>'from_status'
    WHEN 'new' THEN 'new'::kds.ticket_status
    WHEN 'accepted' THEN 'accepted'::kds.ticket_status
    WHEN 'preparing' THEN 'preparing'::kds.ticket_status
    WHEN 'partial_cancelled' THEN 'partial_cancelled'::kds.ticket_status
    WHEN 'ready' THEN 'ready'::kds.ticket_status
    WHEN 'completed' THEN 'completed'::kds.ticket_status
    WHEN 'cancelled' THEN 'cancelled'::kds.ticket_status
    ELSE NULL
  END
  INTO v_from_status
  FROM kds.ticket_events AS e
  WHERE e.sequence = p_event_sequence
    AND e.ticket_id = p_ticket_id;

  v_phone := trim(both ' ' FROM coalesce(v_ticket.customer_phone, ''));
  IF v_phone = '' AND v_ticket.customer_id IS NOT NULL THEN
    SELECT trim(both ' ' FROM coalesce(c.phone, ''))
    INTO v_phone
    FROM conversaflow.customers AS c
    WHERE c.id = v_ticket.customer_id;
  END IF;

  IF coalesce(v_phone, '') = '' THEN
    RETURN;
  END IF;

  v_phone := regexp_replace(v_phone, '\D', '', 'g');
  IF v_phone IS NULL OR v_phone = '' THEN
    RETURN;
  END IF;
  v_phone := '+' || v_phone;

  v_customer_reason := kds.render_customer_cancel_reason(
    COALESCE(v_ticket.cancellation_reason_code, v_ticket.partial_cancellation_reason_code),
    COALESCE(v_ticket.cancellation_reason_note, v_ticket.partial_cancellation_reason_note)
  );

  v_total_text := CASE
    WHEN v_ticket.total_amount IS NULL THEN NULL
    ELSE '$' || to_char(v_ticket.total_amount, 'FM999999990.00')
  END;

  v_body := CASE
    WHEN v_from_status = 'partial_cancelled' AND p_target_status = 'accepted' THEN
      'Confirmamos los cambios en tu pedido.'
      || COALESCE(' Total actualizado: ' || v_total_text || '.', '.')
      || ' Lo estamos preparando.'
    WHEN v_from_status = 'partial_cancelled' AND p_target_status = 'cancelled' THEN
      'Cancelamos por completo tu pedido. Si quieres, podemos empezar uno nuevo.'
      || CASE
        WHEN v_customer_reason IS NOT NULL THEN E'\nMotivo: ' || v_customer_reason
        ELSE ''
      END
    WHEN p_target_status = 'accepted' THEN
      'Tu pedido fue aceptado y está en cola en cocina.'
    WHEN p_target_status = 'preparing' THEN
      'Tu pedido se está preparando.'
    WHEN p_target_status = 'ready' THEN
      'Tu pedido está listo para recoger.'
    WHEN p_target_status = 'completed' THEN
      'Tu pedido fue completado. ¡Gracias!'
    WHEN p_target_status = 'cancelled' THEN
      'Tu pedido fue cancelado.'
      || CASE
        WHEN v_customer_reason IS NOT NULL THEN E'\nMotivo: ' || v_customer_reason
        ELSE ''
      END
    ELSE NULL
  END;

  IF v_body IS NULL THEN
    RETURN;
  END IF;

  v_idempotency := format('twilio_status:%s:%s', p_ticket_id, p_event_sequence);
  v_trace_id := format('kds_status:%s:%s', p_ticket_id, p_event_sequence);

  INSERT INTO conversaflow.outbox (
    job_id,
    business_id,
    kind,
    aggregate_id,
    idempotency_key,
    payload,
    state,
    max_attempts,
    next_run_at
  )
  VALUES (
    NULL,
    v_ticket.business_id,
    'twilio.status_notification',
    v_ticket.source_transaction_id,
    v_idempotency,
    jsonb_build_object(
      'to', v_phone,
      'body', v_body,
      'trace_id', v_trace_id,
      'ticket_id', p_ticket_id,
      'event_sequence', p_event_sequence,
      'target_status', p_target_status,
      'source_transaction_id', v_ticket.source_transaction_id
    ),
    'pending',
    5,
    now()
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$_$;


--
-- Name: FUNCTION enqueue_whatsapp_status_notification(p_ticket_id uuid, p_target_status kds.ticket_status, p_event_sequence bigint); Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON FUNCTION kds.enqueue_whatsapp_status_notification(p_ticket_id uuid, p_target_status kds.ticket_status, p_event_sequence bigint) IS 'Enqueue Twilio WhatsApp status notification. Includes cancellation_reason in cancelled body. Uses customers.phone when ticket.customer_phone is empty.';


--
-- Name: get_board_snapshot(uuid, text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.get_board_snapshot(p_business_id uuid, p_station_id text DEFAULT NULL::text) RETURNS TABLE(ticket_id uuid, source_transaction_id uuid, business_id uuid, source_channel text, status kds.ticket_status, station_id text, station_name text, customer_name text, customer_phone text, pickup_person text, customer_note text, cancellation_reason text, partial_cancellation_reason text, total_amount numeric, created_at timestamp with time zone, updated_at timestamp with time zone, last_event_sequence bigint, items jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
  SELECT
    t.ticket_id,
    t.source_transaction_id,
    t.business_id,
    t.source_channel,
    t.status,
    t.station_id,
    t.station_name,
    t.customer_name,
    t.customer_phone,
    t.pickup_person,
    t.customer_note,
    t.cancellation_reason,
    t.partial_cancellation_reason,
    t.total_amount,
    t.created_at,
    t.updated_at,
    t.last_event_sequence,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'ticket_item_id', i.ticket_item_id,
          'name', i.name,
          'quantity', i.quantity,
          'variant_name', i.variant_name,
          'notes', i.notes,
          'is_cancelled', i.is_cancelled,
          'unit_price', i.unit_price,
          'display_order', i.display_order
        )
        ORDER BY i.display_order ASC
      ) FILTER (WHERE i.ticket_item_id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM kds.tickets AS t
  LEFT JOIN kds.ticket_items AS i
    ON i.ticket_id = t.ticket_id
  WHERE t.business_id = p_business_id
    AND (p_station_id IS NULL OR t.station_id IS NULL OR t.station_id = p_station_id)
  GROUP BY
    t.ticket_id,
    t.source_transaction_id,
    t.business_id,
    t.source_channel,
    t.status,
    t.station_id,
    t.station_name,
    t.customer_name,
    t.customer_phone,
    t.pickup_person,
    t.customer_note,
    t.cancellation_reason,
    t.partial_cancellation_reason,
    t.total_amount,
    t.created_at,
    t.updated_at,
    t.last_event_sequence
  ORDER BY t.created_at ASC;
$$;


--
-- Name: get_ticket_events(uuid, bigint, integer); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.get_ticket_events(p_business_id uuid, p_after_sequence bigint DEFAULT 0, p_limit integer DEFAULT 200) RETURNS TABLE(sequence bigint, ticket_id uuid, business_id uuid, source_transaction_id uuid, kind kds.ticket_event_kind, status kds.ticket_status, occurred_at timestamp with time zone, source text, payload jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
  SELECT
    e.sequence,
    e.ticket_id,
    e.business_id,
    e.source_transaction_id,
    e.kind,
    e.status,
    e.occurred_at,
    e.source,
    e.payload
  FROM kds.ticket_events AS e
  WHERE e.business_id = p_business_id
    AND e.sequence > p_after_sequence
  ORDER BY e.sequence ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 1000);
$$;


--
-- Name: FUNCTION get_ticket_events(p_business_id uuid, p_after_sequence bigint, p_limit integer); Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON FUNCTION kds.get_ticket_events(p_business_id uuid, p_after_sequence bigint, p_limit integer) IS 'Ordered incremental event contract for KDS reconnect and realtime catch-up.';


--
-- Name: map_kds_status_to_transaction_status(kds.ticket_status); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.map_kds_status_to_transaction_status(target_status kds.ticket_status) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE target_status
    WHEN 'new' THEN 'pending'
    WHEN 'accepted' THEN 'in_progress'
    WHEN 'preparing' THEN 'in_progress'
    WHEN 'partial_cancelled' THEN 'in_progress'
    WHEN 'ready' THEN 'ready'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
  END;
$$;


--
-- Name: FUNCTION map_kds_status_to_transaction_status(target_status kds.ticket_status); Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON FUNCTION kds.map_kds_status_to_transaction_status(target_status kds.ticket_status) IS 'Maps KDS-facing statuses to conversaflow.transactions.status. partial_cancelled remains in_progress operationally.';


--
-- Name: map_transaction_status(text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.map_transaction_status(op_status text) RETURNS kds.ticket_status
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE op_status
    WHEN 'pending' THEN 'new'::kds.ticket_status
    WHEN 'in_progress' THEN 'preparing'::kds.ticket_status
    WHEN 'ready' THEN 'ready'::kds.ticket_status
    WHEN 'completed' THEN 'completed'::kds.ticket_status
    WHEN 'cancelled' THEN 'cancelled'::kds.ticket_status
    ELSE 'new'::kds.ticket_status
  END;
$$;


--
-- Name: FUNCTION map_transaction_status(op_status text); Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON FUNCTION kds.map_transaction_status(op_status text) IS 'Maps ConversaFlow operational order states to KDS-facing board states. accepted is reserved for future command flow but not emitted by the current operational model.';


--
-- Name: parse_cancel_reason_code(text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.parse_cancel_reason_code(p_value text) RETURNS kds.cancel_reason_code
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF p_value IS NULL OR trim(p_value) = '' THEN
    RETURN NULL;
  END IF;

  CASE trim(lower(p_value))
    WHEN 'out_of_stock' THEN RETURN 'out_of_stock';
    WHEN 'kitchen_overload' THEN RETURN 'kitchen_overload';
    WHEN 'closing_soon' THEN RETURN 'closing_soon';
    WHEN 'customer_no_show' THEN RETURN 'customer_no_show';
    WHEN 'duplicate_order' THEN RETURN 'duplicate_order';
    WHEN 'other' THEN RETURN 'other';
    ELSE
      RETURN NULL;
  END CASE;
END;
$$;


--
-- Name: partial_cancel_items(uuid, uuid[], text, text, text, text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.partial_cancel_items(p_ticket_id uuid, p_item_ids uuid[], p_reason text, p_actor_source text DEFAULT 'kds'::text, p_actor_id text DEFAULT NULL::text, p_actor_channel text DEFAULT NULL::text) RETURNS kds.tickets
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
  SELECT kds.partial_cancel_items(
    p_ticket_id,
    p_item_ids,
    'other'::kds.cancel_reason_code,
    p_reason,
    p_actor_source,
    p_actor_id,
    p_actor_channel
  );
$$;


--
-- Name: FUNCTION partial_cancel_items(p_ticket_id uuid, p_item_ids uuid[], p_reason text, p_actor_source text, p_actor_id text, p_actor_channel text); Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON FUNCTION kds.partial_cancel_items(p_ticket_id uuid, p_item_ids uuid[], p_reason text, p_actor_source text, p_actor_id text, p_actor_channel text) IS 'Marks selected transaction details.items as cancelled, recalculates total_amount, keeps operational status in_progress, moves the KDS ticket to partial_cancelled, emits an order_upserted event, and enqueues a WhatsApp notification using stable display_order lookup for cancelled lines.';


--
-- Name: partial_cancel_items(uuid, uuid[], kds.cancel_reason_code, text, text, text, text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.partial_cancel_items(p_ticket_id uuid, p_item_ids uuid[], p_reason_code kds.cancel_reason_code, p_reason_note text DEFAULT NULL::text, p_actor_source text DEFAULT 'kds'::text, p_actor_id text DEFAULT NULL::text, p_actor_channel text DEFAULT NULL::text) RETURNS kds.tickets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
DECLARE
  v_ticket kds.tickets%ROWTYPE;
  v_txn_details JSONB;
  v_display_orders INTEGER[];
  v_active_count INTEGER;
  v_sequence BIGINT;
  v_reason_note TEXT;
  v_internal_reason TEXT;
  v_customer_reason TEXT;
BEGIN
  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KDS ticket not found: %', p_ticket_id;
  END IF;

  PERFORM kds.assert_transition(v_ticket.status, 'partial_cancelled');

  IF p_reason_code IS NULL THEN
    RAISE EXCEPTION 'Partial cancellation reason code is required.';
  END IF;

  v_reason_note := NULLIF(trim(COALESCE(p_reason_note, '')), '');
  IF p_reason_code = 'other' AND (v_reason_note IS NULL OR char_length(v_reason_note) < 3) THEN
    RAISE EXCEPTION 'Partial cancellation note must be at least 3 characters when reason_code = other.';
  END IF;

  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one ticket item must be selected for partial cancellation.';
  END IF;

  SELECT array_agg(i.display_order ORDER BY i.display_order)
  INTO v_display_orders
  FROM kds.ticket_items AS i
  WHERE i.ticket_id = p_ticket_id
    AND i.ticket_item_id = ANY(p_item_ids)
    AND NOT i.is_cancelled;

  IF v_display_orders IS NULL OR array_length(v_display_orders, 1) IS NULL THEN
    RAISE EXCEPTION 'No active ticket items matched the provided item ids for ticket %.', p_ticket_id;
  END IF;

  SELECT count(*)
  INTO v_active_count
  FROM kds.ticket_items AS i
  WHERE i.ticket_id = p_ticket_id
    AND NOT i.is_cancelled;

  IF array_length(v_display_orders, 1) >= v_active_count THEN
    RAISE EXCEPTION 'Partial cancellation requires at least one remaining active item.';
  END IF;

  v_internal_reason := kds.render_internal_cancel_reason(p_reason_code, v_reason_note);
  v_customer_reason := kds.render_customer_cancel_reason(p_reason_code, v_reason_note);

  SELECT COALESCE(t.details, '{}'::jsonb)
  INTO v_txn_details
  FROM conversaflow.transactions AS t
  WHERE t.id = v_ticket.source_transaction_id
  FOR UPDATE;

  v_txn_details :=
    (v_txn_details - 'cancellation_reason' - 'cancellation_reason_code' - 'cancellation_reason_note')
    || jsonb_build_object(
      'items',
      (
        SELECT jsonb_agg(
          CASE
            WHEN ordinality::integer = ANY(v_display_orders)
              THEN item || jsonb_build_object('cancelled', TRUE)
            ELSE item
          END
          ORDER BY ordinality
        )
        FROM jsonb_array_elements(COALESCE(v_txn_details->'items', '[]'::jsonb))
          WITH ORDINALITY AS item_list(item, ordinality)
      ),
      'partial_cancellation_reason', v_internal_reason,
      'partial_cancellation_reason_code', p_reason_code::text,
      'partial_cancellation_reason_note', to_jsonb(v_reason_note)
    );

  UPDATE conversaflow.transactions AS t
  SET
    details = v_txn_details,
    total_amount = COALESCE((
      SELECT SUM(
        GREATEST(COALESCE((item->>'quantity')::integer, 1), 1)
        * COALESCE(NULLIF(item->>'unit_price', '')::numeric, 0)
      )
      FROM jsonb_array_elements(COALESCE(v_txn_details->'items', '[]'::jsonb)) AS item
      WHERE NOT COALESCE((item->>'cancelled')::boolean, FALSE)
    ), 0)
  WHERE t.id = v_ticket.source_transaction_id;

  UPDATE kds.tickets
  SET
    status = 'partial_cancelled',
    partial_cancellation_reason = v_internal_reason,
    partial_cancellation_reason_code = p_reason_code,
    partial_cancellation_reason_note = v_reason_note,
    cancellation_reason = NULL,
    cancellation_reason_code = NULL,
    cancellation_reason_note = NULL,
    updated_at = now(),
    last_projected_at = now()
  WHERE ticket_id = p_ticket_id;

  INSERT INTO kds.ticket_events (
    ticket_id,
    business_id,
    source_transaction_id,
    kind,
    status,
    occurred_at,
    source,
    payload
  )
  VALUES (
    v_ticket.ticket_id,
    v_ticket.business_id,
    v_ticket.source_transaction_id,
    'order_upserted',
    'partial_cancelled',
    now(),
    p_actor_source,
    jsonb_build_object(
      'cancelled_item_ids', COALESCE(to_jsonb(p_item_ids), '[]'::jsonb),
      'partial_cancellation_reason', v_internal_reason,
      'partial_cancellation_reason_code', p_reason_code,
      'actor_id', p_actor_id,
      'actor_channel', p_actor_channel
    )
  )
  RETURNING sequence INTO v_sequence;

  UPDATE kds.tickets
  SET last_event_sequence = v_sequence
  WHERE ticket_id = p_ticket_id;

  PERFORM kds.enqueue_whatsapp_partial_cancel_notification(
    p_ticket_id,
    v_sequence,
    v_display_orders,
    COALESCE(v_customer_reason, '[motivo retirado]')
  );

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  RETURN v_ticket;
END;
$$;


--
-- Name: project_transaction(uuid, kds.ticket_event_kind, text, text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.project_transaction(p_transaction_id uuid, p_event_kind kds.ticket_event_kind DEFAULT 'order_upserted'::kds.ticket_event_kind, p_source text DEFAULT 'projection'::text, p_source_event_key text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
DECLARE
  v_txn RECORD;
  v_ticket_id UUID;
  v_sequence BIGINT;
  v_existing_status kds.ticket_status;
  v_projected_status kds.ticket_status;
  v_cancellation_reason_code kds.cancel_reason_code;
  v_cancellation_reason_note TEXT;
  v_partial_reason_code kds.cancel_reason_code;
  v_partial_reason_note TEXT;
BEGIN
  SELECT
    t.id,
    t.business_id,
    t.customer_id,
    t.status,
    t.total_amount,
    t.details,
    t.created_at,
    COALESCE(se.last_acted_at, t.created_at) AS updated_at,
    c.name AS customer_name,
    c.phone AS customer_phone
  INTO v_txn
  FROM conversaflow.transactions AS t
  LEFT JOIN conversaflow.customers AS c
    ON c.id = t.customer_id
  LEFT JOIN (
    SELECT
      transaction_id,
      max(acted_at) AS last_acted_at
    FROM conversaflow.transaction_status_events
    GROUP BY transaction_id
  ) AS se
    ON se.transaction_id = t.id
  WHERE t.id = p_transaction_id
    AND t.transaction_type = 'order';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT t.status
  INTO v_existing_status
  FROM kds.tickets AS t
  WHERE t.source_transaction_id = v_txn.id;

  v_projected_status := kds.map_transaction_status(v_txn.status);
  IF v_txn.status = 'in_progress' AND v_existing_status IN ('accepted', 'preparing', 'partial_cancelled') THEN
    v_projected_status := v_existing_status;
  END IF;

  v_cancellation_reason_code := kds.parse_cancel_reason_code(v_txn.details->>'cancellation_reason_code');
  v_cancellation_reason_note := NULLIF(trim(COALESCE(v_txn.details->>'cancellation_reason_note', '')), '');
  v_partial_reason_code := kds.parse_cancel_reason_code(v_txn.details->>'partial_cancellation_reason_code');
  v_partial_reason_note := NULLIF(trim(COALESCE(v_txn.details->>'partial_cancellation_reason_note', '')), '');

  INSERT INTO kds.tickets (
    source_transaction_id,
    business_id,
    customer_id,
    source_channel,
    customer_name,
    customer_phone,
    pickup_person,
    status,
    station_id,
    station_name,
    customer_note,
    cancellation_reason,
    cancellation_reason_code,
    cancellation_reason_note,
    partial_cancellation_reason,
    partial_cancellation_reason_code,
    partial_cancellation_reason_note,
    total_amount,
    created_at,
    updated_at,
    raw_details_hash,
    last_projected_at
  )
  VALUES (
    v_txn.id,
    v_txn.business_id,
    v_txn.customer_id,
    COALESCE(v_txn.details->>'source_channel', 'whatsapp'),
    v_txn.customer_name,
    v_txn.customer_phone,
    v_txn.details->>'pickup_person',
    v_projected_status,
    v_txn.details->>'station_id',
    v_txn.details->>'station_name',
    v_txn.details->>'customer_note',
    COALESCE(
      NULLIF(trim(COALESCE(v_txn.details->>'cancellation_reason', '')), ''),
      kds.render_internal_cancel_reason(v_cancellation_reason_code, v_cancellation_reason_note)
    ),
    v_cancellation_reason_code,
    v_cancellation_reason_note,
    COALESCE(
      NULLIF(trim(COALESCE(v_txn.details->>'partial_cancellation_reason', '')), ''),
      kds.render_internal_cancel_reason(v_partial_reason_code, v_partial_reason_note)
    ),
    v_partial_reason_code,
    v_partial_reason_note,
    v_txn.total_amount,
    v_txn.created_at,
    v_txn.updated_at,
    md5(COALESCE(v_txn.details::text, '{}')),
    now()
  )
  ON CONFLICT (source_transaction_id) DO UPDATE
  SET
    business_id = EXCLUDED.business_id,
    customer_id = EXCLUDED.customer_id,
    source_channel = EXCLUDED.source_channel,
    customer_name = EXCLUDED.customer_name,
    customer_phone = EXCLUDED.customer_phone,
    pickup_person = EXCLUDED.pickup_person,
    status = EXCLUDED.status,
    station_id = EXCLUDED.station_id,
    station_name = EXCLUDED.station_name,
    customer_note = EXCLUDED.customer_note,
    cancellation_reason = EXCLUDED.cancellation_reason,
    cancellation_reason_code = EXCLUDED.cancellation_reason_code,
    cancellation_reason_note = EXCLUDED.cancellation_reason_note,
    partial_cancellation_reason = EXCLUDED.partial_cancellation_reason,
    partial_cancellation_reason_code = EXCLUDED.partial_cancellation_reason_code,
    partial_cancellation_reason_note = EXCLUDED.partial_cancellation_reason_note,
    total_amount = EXCLUDED.total_amount,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    raw_details_hash = EXCLUDED.raw_details_hash,
    last_projected_at = now()
  RETURNING ticket_id INTO v_ticket_id;

  DELETE FROM kds.ticket_items
  WHERE ticket_id = v_ticket_id;

  INSERT INTO kds.ticket_items (
    ticket_id,
    source_transaction_id,
    display_order,
    product_id,
    name,
    quantity,
    variant_name,
    notes,
    unit_price,
    is_cancelled
  )
  SELECT
    v_ticket_id,
    v_txn.id,
    row_number() OVER ()::integer,
    NULLIF(item->>'product_id', '')::uuid,
    COALESCE(item->>'product_name', item->>'product_id', 'Unnamed item'),
    GREATEST(COALESCE((item->>'quantity')::integer, 1), 1),
    NULLIF(item->>'variant_name', ''),
    NULLIF(item->>'notes', ''),
    NULLIF(item->>'unit_price', '')::numeric,
    COALESCE((item->>'cancelled')::boolean, FALSE)
  FROM jsonb_array_elements(COALESCE(v_txn.details->'items', '[]'::jsonb)) AS item;

  IF p_source_event_key IS NOT NULL THEN
    INSERT INTO kds.ticket_events (
      ticket_id,
      business_id,
      source_transaction_id,
      kind,
      status,
      occurred_at,
      source,
      source_event_key,
      payload
    )
    VALUES (
      v_ticket_id,
      v_txn.business_id,
      v_txn.id,
      p_event_kind,
      v_projected_status,
      v_txn.updated_at,
      p_source,
      p_source_event_key,
      jsonb_build_object(
        'source_transaction_id', v_txn.id,
        'operational_status', v_txn.status
      )
    )
    ON CONFLICT (source_event_key) DO NOTHING
    RETURNING sequence INTO v_sequence;
  ELSE
    INSERT INTO kds.ticket_events (
      ticket_id,
      business_id,
      source_transaction_id,
      kind,
      status,
      occurred_at,
      source,
      payload
    )
    VALUES (
      v_ticket_id,
      v_txn.business_id,
      v_txn.id,
      p_event_kind,
      v_projected_status,
      v_txn.updated_at,
      p_source,
      jsonb_build_object(
        'source_transaction_id', v_txn.id,
        'operational_status', v_txn.status
      )
    )
    RETURNING sequence INTO v_sequence;
  END IF;

  UPDATE kds.tickets
  SET last_event_sequence = COALESCE(v_sequence, last_event_sequence)
  WHERE ticket_id = v_ticket_id;

  RETURN v_ticket_id;
END;
$$;


--
-- Name: FUNCTION project_transaction(p_transaction_id uuid, p_event_kind kds.ticket_event_kind, p_source text, p_source_event_key text); Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON FUNCTION kds.project_transaction(p_transaction_id uuid, p_event_kind kds.ticket_event_kind, p_source text, p_source_event_key text) IS 'Projects one ConversaFlow order into the KDS read model including cancellation_reason and partial_cancellation_reason from details.';


--
-- Name: project_transaction_trigger(); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.project_transaction_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
BEGIN
  IF NEW.transaction_type IS DISTINCT FROM 'order' THEN
    RETURN NEW;
  END IF;

  PERFORM kds.project_transaction(
    NEW.id,
    'order_upserted',
    'trigger',
    NULL
  );

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION project_transaction_trigger(); Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON FUNCTION kds.project_transaction_trigger() IS 'Projection-maintenance trigger. Always emits order_upserted — never status_changed. status_changed is reserved for explicit operator actions in transition_ticket() and partial_cancel_items().';


--
-- Name: provision_device_token(uuid, text, text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.provision_device_token(p_business_id uuid, p_device_name text, p_station_id text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
DECLARE
  v_token TEXT;
  v_hash  TEXT;
BEGIN
  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash  := encode(sha256(v_token::bytea), 'hex');

  INSERT INTO kds.device_sessions (business_id, device_name, station_id, token_hash)
  VALUES (p_business_id, p_device_name, p_station_id, v_hash);

  RETURN v_token;
END;
$$;


--
-- Name: redact_customer_text(text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.redact_customer_text(p_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  v_text TEXT;
BEGIN
  v_text := NULLIF(regexp_replace(COALESCE(p_text, ''), '\s+', ' ', 'g'), '');
  IF v_text IS NULL THEN
    RETURN '[motivo retirado]';
  END IF;

  v_text := trim(v_text);

  IF char_length(v_text) < 3 THEN
    RETURN '[motivo retirado]';
  END IF;

  IF v_text ~* '\m(nigga+|nigger|puta|puto|pendej[oa]s?|chingad[ao]s?)\M' THEN
    RETURN '[motivo retirado]';
  END IF;

  RETURN left(v_text, 80);
END;
$$;


--
-- Name: render_customer_cancel_reason(kds.cancel_reason_code, text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.render_customer_cancel_reason(p_code kds.cancel_reason_code, p_note text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF p_code IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_code = 'other' THEN
    RETURN kds.redact_customer_text(p_note);
  END IF;

  RETURN kds.cancel_reason_label(p_code);
END;
$$;


--
-- Name: render_internal_cancel_reason(kds.cancel_reason_code, text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.render_internal_cancel_reason(p_code kds.cancel_reason_code, p_note text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  v_label TEXT;
  v_note TEXT;
BEGIN
  v_label := kds.cancel_reason_label(p_code);
  v_note := NULLIF(trim(COALESCE(p_note, '')), '');

  IF v_label IS NULL THEN
    RETURN v_note;
  END IF;

  IF v_note IS NULL THEN
    RETURN v_label;
  END IF;

  RETURN v_label || ': ' || left(v_note, 120);
END;
$$;


--
-- Name: transition_ticket(uuid, kds.ticket_status, text, text, text, text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.transition_ticket(p_ticket_id uuid, p_target_status kds.ticket_status, p_actor_source text DEFAULT 'kds'::text, p_actor_id text DEFAULT NULL::text, p_actor_channel text DEFAULT NULL::text, p_cancellation_reason text DEFAULT NULL::text) RETURNS kds.tickets
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
  SELECT kds.transition_ticket(
    p_ticket_id,
    p_target_status,
    p_actor_source,
    p_actor_id,
    p_actor_channel,
    CASE
      WHEN NULLIF(trim(COALESCE(p_cancellation_reason, '')), '') IS NULL THEN NULL
      ELSE 'other'::kds.cancel_reason_code
    END,
    p_cancellation_reason
  );
$$;


--
-- Name: FUNCTION transition_ticket(p_ticket_id uuid, p_target_status kds.ticket_status, p_actor_source text, p_actor_id text, p_actor_channel text, p_cancellation_reason text); Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON FUNCTION kds.transition_ticket(p_ticket_id uuid, p_target_status kds.ticket_status, p_actor_source text, p_actor_id text, p_actor_channel text, p_cancellation_reason text) IS 'KDS state transition with optional cancellation reason. Clears partial_cancellation_reason when a partial cancellation is accepted or fully cancelled.';


--
-- Name: transition_ticket(uuid, kds.ticket_status, text, text, text, kds.cancel_reason_code, text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.transition_ticket(p_ticket_id uuid, p_target_status kds.ticket_status, p_actor_source text DEFAULT 'kds'::text, p_actor_id text DEFAULT NULL::text, p_actor_channel text DEFAULT NULL::text, p_cancellation_reason_code kds.cancel_reason_code DEFAULT NULL::kds.cancel_reason_code, p_cancellation_reason_note text DEFAULT NULL::text) RETURNS kds.tickets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
DECLARE
  v_ticket kds.tickets%ROWTYPE;
  v_operational_target TEXT;
  v_new_sequence BIGINT;
  v_reason_code kds.cancel_reason_code;
  v_reason_note TEXT;
  v_internal_reason TEXT;
BEGIN
  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KDS ticket not found: %', p_ticket_id;
  END IF;

  IF v_ticket.status = p_target_status THEN
    RETURN v_ticket;
  END IF;

  PERFORM kds.assert_transition(v_ticket.status, p_target_status);

  v_reason_code := p_cancellation_reason_code;
  v_reason_note := NULLIF(trim(COALESCE(p_cancellation_reason_note, '')), '');

  IF p_target_status = 'cancelled' AND v_reason_code IS NULL AND v_ticket.status = 'partial_cancelled' THEN
    v_reason_code := v_ticket.partial_cancellation_reason_code;
    v_reason_note := COALESCE(v_reason_note, v_ticket.partial_cancellation_reason_note);
  END IF;

  IF v_reason_code = 'other' AND (v_reason_note IS NULL OR char_length(v_reason_note) < 3) THEN
    RAISE EXCEPTION 'Cancellation note must be at least 3 characters when reason_code = other.';
  END IF;

  v_internal_reason := kds.render_internal_cancel_reason(v_reason_code, v_reason_note);
  v_operational_target := kds.map_kds_status_to_transaction_status(p_target_status);

  IF p_target_status IN ('accepted', 'preparing') THEN
    IF v_operational_target IS DISTINCT FROM 'in_progress' THEN
      RAISE EXCEPTION 'Unexpected operational mapping for target status %', p_target_status;
    END IF;

    IF v_ticket.status = 'new' THEN
      UPDATE conversaflow.transactions
      SET status = 'in_progress'
      WHERE id = v_ticket.source_transaction_id
        AND status IS DISTINCT FROM 'in_progress';

      INSERT INTO conversaflow.transaction_status_events (
        transaction_id,
        old_status,
        new_status,
        acted_by_slack_user,
        acted_in_channel,
        acted_at
      )
      VALUES (
        v_ticket.source_transaction_id,
        'pending',
        'in_progress',
        p_actor_id,
        p_actor_channel,
        now()
      );
    ELSIF v_ticket.status = 'partial_cancelled' AND p_target_status = 'accepted' THEN
      UPDATE conversaflow.transactions
      SET details = COALESCE(details, '{}'::jsonb)
        - 'partial_cancellation_reason'
        - 'partial_cancellation_reason_code'
        - 'partial_cancellation_reason_note'
      WHERE id = v_ticket.source_transaction_id;
    END IF;

    UPDATE kds.tickets
    SET
      status = p_target_status,
      partial_cancellation_reason = CASE
        WHEN v_ticket.status = 'partial_cancelled' AND p_target_status = 'accepted' THEN NULL
        ELSE partial_cancellation_reason
      END,
      partial_cancellation_reason_code = CASE
        WHEN v_ticket.status = 'partial_cancelled' AND p_target_status = 'accepted' THEN NULL
        ELSE partial_cancellation_reason_code
      END,
      partial_cancellation_reason_note = CASE
        WHEN v_ticket.status = 'partial_cancelled' AND p_target_status = 'accepted' THEN NULL
        ELSE partial_cancellation_reason_note
      END,
      updated_at = now(),
      last_projected_at = now()
    WHERE ticket_id = p_ticket_id;

    INSERT INTO kds.ticket_events (
      ticket_id,
      business_id,
      source_transaction_id,
      kind,
      status,
      occurred_at,
      source,
      payload
    )
    VALUES (
      v_ticket.ticket_id,
      v_ticket.business_id,
      v_ticket.source_transaction_id,
      'status_changed',
      p_target_status,
      now(),
      p_actor_source,
      jsonb_build_object(
        'from_status', v_ticket.status,
        'to_status', p_target_status,
        'actor_id', p_actor_id,
        'actor_channel', p_actor_channel
      )
    )
    RETURNING sequence INTO v_new_sequence;

    UPDATE kds.tickets
    SET last_event_sequence = v_new_sequence
    WHERE ticket_id = p_ticket_id;

    PERFORM kds.enqueue_whatsapp_status_notification(
      p_ticket_id,
      p_target_status,
      v_new_sequence
    );
  ELSE
    IF p_target_status = 'cancelled' THEN
      UPDATE conversaflow.transactions
      SET
        status = v_operational_target,
        details = (
          (
            COALESCE(details, '{}'::jsonb)
            - 'partial_cancellation_reason'
            - 'partial_cancellation_reason_code'
            - 'partial_cancellation_reason_note'
          )
          ||
          CASE
            WHEN v_reason_code IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object(
              'cancellation_reason', v_internal_reason,
              'cancellation_reason_code', v_reason_code::text,
              'cancellation_reason_note', to_jsonb(v_reason_note)
            )
          END
        )
      WHERE id = v_ticket.source_transaction_id
        AND status IS DISTINCT FROM v_operational_target;
    ELSE
      UPDATE conversaflow.transactions
      SET status = v_operational_target
      WHERE id = v_ticket.source_transaction_id
        AND status IS DISTINCT FROM v_operational_target;
    END IF;

    INSERT INTO conversaflow.transaction_status_events (
      transaction_id,
      old_status,
      new_status,
      acted_by_slack_user,
      acted_in_channel,
      acted_at
    )
    VALUES (
      v_ticket.source_transaction_id,
      kds.map_kds_status_to_transaction_status(v_ticket.status),
      v_operational_target,
      p_actor_id,
      p_actor_channel,
      now()
    );

    -- Emit an explicit status_changed event so the iOS client can use it for
    -- optimistic updates and enqueue_whatsapp_status_notification has a proper
    -- from_status in the payload. The trigger will also emit order_upserted (from
    -- the conversaflow.transactions UPDATE above) — that order_upserted precedes
    -- this status_changed in sequence, which is fine.
    INSERT INTO kds.ticket_events (
      ticket_id,
      business_id,
      source_transaction_id,
      kind,
      status,
      occurred_at,
      source,
      payload
    )
    VALUES (
      v_ticket.ticket_id,
      v_ticket.business_id,
      v_ticket.source_transaction_id,
      'status_changed',
      p_target_status,
      now(),
      p_actor_source,
      jsonb_build_object(
        'from_status', v_ticket.status,
        'to_status', p_target_status,
        'actor_id', p_actor_id,
        'actor_channel', p_actor_channel
      )
    )
    RETURNING sequence INTO v_new_sequence;

    UPDATE kds.tickets
    SET last_event_sequence = v_new_sequence
    WHERE ticket_id = p_ticket_id;

    PERFORM kds.enqueue_whatsapp_status_notification(
      p_ticket_id,
      p_target_status,
      v_new_sequence
    );
  END IF;

  SELECT *
  INTO v_ticket
  FROM kds.tickets
  WHERE ticket_id = p_ticket_id;

  RETURN v_ticket;
END;
$$;


--
-- Name: verify_device_token(text); Type: FUNCTION; Schema: kds; Owner: -
--

CREATE FUNCTION kds.verify_device_token(p_token text) RETURNS TABLE(device_id uuid, business_id uuid, station_id text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'kds', 'conversaflow', 'public'
    AS $$
DECLARE
  v_hash TEXT;
  v_row  kds.device_sessions%ROWTYPE;
BEGIN
  v_hash := encode(sha256(p_token::bytea), 'hex');

  SELECT *
  INTO v_row
  FROM kds.device_sessions AS ds
  WHERE ds.token_hash = v_hash
    AND ds.is_active = TRUE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE kds.device_sessions
  SET last_used_at = now()
  WHERE kds.device_sessions.device_id = v_row.device_id;

  RETURN QUERY SELECT v_row.device_id, v_row.business_id, v_row.station_id;
END;
$$;


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: -
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $_$;


--
-- Name: calculate_loyalty_points(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_loyalty_points() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    points_per_peso DECIMAL;
    tier_multiplier DECIMAL;
    points_to_award INTEGER;
BEGIN
    IF NEW.payment_status = 'paid' THEN
        SELECT 
            COALESCE((config->'loyalty_config'->>'points_per_peso')::DECIMAL, 1),
            CASE 
                WHEN lp.current_tier = 'gold' THEN 
                    COALESCE((b.config->'loyalty_config'->'tiers'->'gold'->>'multiplier')::DECIMAL, 2.0)
                WHEN lp.current_tier = 'silver' THEN 
                    COALESCE((b.config->'loyalty_config'->'tiers'->'silver'->>'multiplier')::DECIMAL, 1.5)
                ELSE 1.0
            END
        INTO points_per_peso, tier_multiplier
        FROM businesses b
        LEFT JOIN loyalty_points lp ON lp.customer_id = NEW.customer_id AND lp.business_id = NEW.business_id
        WHERE b.id = NEW.business_id;
        
        points_to_award := FLOOR(NEW.total_amount * points_per_peso * tier_multiplier);
        
        INSERT INTO loyalty_points (customer_id, business_id, points_earned, tier_progress)
        VALUES (NEW.customer_id, NEW.business_id, points_to_award, 1)
        ON CONFLICT (customer_id, business_id) 
        DO UPDATE SET 
            points_earned = loyalty_points.points_earned + points_to_award,
            tier_progress = loyalty_points.tier_progress + 1;
        
        INSERT INTO loyalty_transactions (
            customer_id,
            business_id,
            type,
            points,
            reason,
            order_id,
            created_by
        ) VALUES (
            NEW.customer_id,
            NEW.business_id,
            'earned',
            points_to_award,
            'Order purchase',
            NEW.id,
            'system'
        );
        
        NEW.loyalty_points_earned := points_to_award;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: check_tier_upgrade(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_tier_upgrade() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    silver_threshold INTEGER;
    gold_threshold INTEGER;
    new_tier VARCHAR(50);
BEGIN
    SELECT 
        COALESCE((config->'loyalty_config'->'tiers'->'silver'->>'threshold')::INTEGER, 5),
        COALESCE((config->'loyalty_config'->'tiers'->'gold'->>'threshold')::INTEGER, 20)
    INTO silver_threshold, gold_threshold
    FROM businesses
    WHERE id = NEW.business_id;
    
    IF NEW.tier_progress >= gold_threshold THEN
        new_tier := 'gold';
    ELSIF NEW.tier_progress >= silver_threshold THEN
        new_tier := 'silver';
    ELSE
        new_tier := 'bronze';
    END IF;
    
    IF new_tier != OLD.current_tier THEN
        NEW.current_tier := new_tier;
        NEW.last_tier_change := NOW();
        
        INSERT INTO notifications (
            business_id,
            customer_id,
            type,
            channel,
            content,
            status
        ) VALUES (
            NEW.business_id,
            NEW.customer_id,
            'loyalty_tier_upgrade',
            'whatsapp',
            jsonb_build_object(
                'new_tier', new_tier,
                'message', '¡Felicidades! Has alcanzado nivel ' || UPPER(new_tier) || '!',
                'benefits', CASE 
                    WHEN new_tier = 'gold' THEN '2x puntos, bebida mensual gratis, prioridad'
                    WHEN new_tier = 'silver' THEN '1.5x puntos, bebida de cumpleaños'
                    ELSE 'Acumula puntos en cada compra'
                END
            ),
            'pending'
        );
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inbound_event_id uuid,
    business_id uuid NOT NULL,
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
    CONSTRAINT jobs_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'claimed'::text, 'running'::text, 'completed'::text, 'failed'::text, 'dead'::text])))
);


--
-- Name: TABLE jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.jobs IS 'Durable work queue. Jobs are created by ingress handlers or parent jobs. Claimed via FOR UPDATE SKIP LOCKED by the job-worker. States: pending → claimed → running → completed/failed/dead.';


--
-- Name: COLUMN jobs.inbound_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jobs.inbound_event_id IS 'The inbound event that triggered this job. NULL for cron-originated or child jobs spawned by another job.';


--
-- Name: COLUMN jobs.job_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jobs.job_type IS 'Job type identifier matching a processor function. E.g. ''conversation.process'', ''message.embed'', ''order.create''. See ARCHITECTURE_TARGET.md §3 for full catalog.';


--
-- Name: COLUMN jobs.aggregate_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jobs.aggregate_type IS 'Domain aggregate this job operates on: ''conversation'', ''transaction'', ''business'', ''customer'', ''message''.';


--
-- Name: COLUMN jobs.aggregate_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jobs.aggregate_id IS 'Primary key of the aggregate (conversation_id, order_id, business_id, etc.). Used to detect concurrent jobs on the same aggregate.';


--
-- Name: COLUMN jobs.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jobs.state IS 'Job lifecycle state. ''dead'' means all retry attempts exhausted — requires operator review.';


--
-- Name: COLUMN jobs.priority; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jobs.priority IS 'Higher value = claimed sooner. 0 = normal priority. Use sparingly to avoid priority inversion.';


--
-- Name: COLUMN jobs.locked_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jobs.locked_by IS 'Worker instance UUID that claimed this job. Used for stale lock detection — if locked_at is >2 minutes old and state is ''claimed'', the job is reset to ''pending''.';


--
-- Name: claim_next_job(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_next_job(p_worker_id text) RETURNS SETOF public.jobs
    LANGUAGE sql
    AS $$
  UPDATE public.jobs
  SET    state = 'claimed',
         locked_at = now(),
         locked_by = p_worker_id
  WHERE  id = (
    SELECT j.id
    FROM public.jobs j
    WHERE j.state = 'pending'
      AND j.next_run_at <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.jobs active
        WHERE active.id <> j.id
          AND active.aggregate_type = j.aggregate_type
          AND active.aggregate_id = j.aggregate_id
          AND active.state IN ('claimed', 'running')
          AND j.aggregate_type = 'conversation'
      )
    ORDER BY j.priority DESC, j.next_run_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;


--
-- Name: outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid,
    business_id uuid NOT NULL,
    kind text NOT NULL,
    aggregate_id uuid,
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
-- Name: TABLE outbox; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.outbox IS 'Durable side-effect delivery queue. Job processors write outbox rows for external calls (Twilio, Slack, Voyage, etc.). The outbox dispatcher claims and delivers them with retry and idempotency. UNIQUE(idempotency_key) prevents duplicate deliveries on job retry.';


--
-- Name: COLUMN outbox.job_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbox.job_id IS 'The job that produced this side effect. ON DELETE SET NULL — outbox rows survive job cleanup for delivery tracking. NULL for outbox rows not tied to a specific job.';


--
-- Name: COLUMN outbox.kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbox.kind IS 'Delivery adapter identifier. E.g. ''twilio.reply'', ''slack.new_order'', ''voyage.embed''. See ARCHITECTURE_TARGET.md §4 for full catalog.';


--
-- Name: COLUMN outbox.aggregate_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbox.aggregate_id IS 'Domain object this side effect relates to (order_id, conversation_id, etc.). For debugging and dashboard filtering.';


--
-- Name: COLUMN outbox.idempotency_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbox.idempotency_key IS 'Globally unique key for deduplication. Pattern: ''{kind}:{domain_id}'' e.g. ''twilio_reply:{message_id}'', ''slack_order:{order_id}''. Prevents duplicate delivery if a job retries and re-inserts the same outbox row.';


--
-- Name: COLUMN outbox.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbox.state IS 'Delivery lifecycle: pending → delivering → delivered/failed. ''dead'' means max_attempts exhausted — requires operator review.';


--
-- Name: claim_outbox_batch(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_outbox_batch(p_worker_id text, p_limit integer DEFAULT 5) RETURNS SETOF public.outbox
    LANGUAGE sql
    AS $$
  UPDATE public.outbox
  SET    state = 'delivering',
         attempts = attempts + 1
  WHERE  id IN (
    SELECT id FROM public.outbox
    WHERE  state = 'pending'
    AND    next_run_at <= now()
    ORDER BY next_run_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;


--
-- Name: get_or_create_conversation(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_or_create_conversation(p_business_id uuid, p_customer_id uuid) RETURNS TABLE(id uuid, business_id uuid, customer_id uuid, status text, conversation_history jsonb, current_state text, state_data jsonb, created_at timestamp with time zone, last_message_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$begin RETURN QUERY
select
  c.id,
  c.business_id,
  c.customer_id,
  c.status,
  c.conversation_history,
  c.current_state,
  c.state_data,
  c.created_at,
  c.last_message_at
from
  conversations c
where
  c.business_id = p_business_id
  and c.customer_id = p_customer_id
  and c.status = 'active'
order by
  c.last_message_at desc
limit
  1;

IF not FOUND then RETURN QUERY
insert into
  conversations (
    business_id,
    customer_id,
    status,
    current_state,
    conversation_history,
    state_data
  )
values
  (
    p_business_id,
    p_customer_id,
    'active',
    'initial',
    '[]'::jsonb,
    '{}'::jsonb
  )
returning
  conversations.id,
  conversations.business_id,
  conversations.customer_id,
  conversations.status,
  conversations.conversation_history,
  conversations.current_state,
  conversations.state_data,
  conversations.created_at,
  conversations.last_message_at;

end IF;

end;$$;


--
-- Name: get_or_create_customer(text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_or_create_customer(p_phone text, p_business_id uuid, p_name text DEFAULT NULL::text) RETURNS TABLE(id uuid, phone text, business_id uuid, created_at timestamp with time zone, name text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_customer_id UUID;
BEGIN
    SELECT c.id INTO v_customer_id
    FROM customers c
    WHERE c.phone = p_phone AND c.business_id = p_business_id;

    IF v_customer_id IS NULL THEN
        v_customer_id := gen_random_uuid();
        INSERT INTO customers (id, phone, business_id, name, created_at)
        VALUES (v_customer_id, p_phone, p_business_id, p_name, NOW());
    ELSE
        -- Update name if we now have one and the existing record doesn't
        IF p_name IS NOT NULL THEN
            UPDATE customers c
            SET name = p_name
            WHERE c.id = v_customer_id AND c.name IS NULL;
        END IF;
    END IF;

    RETURN QUERY
    SELECT c.id, c.phone, c.business_id, c.created_at, c.name
    FROM customers c
    WHERE c.id = v_customer_id;
END;
$$;


--
-- Name: increment_customer_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_customer_metrics() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF TG_TABLE_NAME = 'conversations' THEN
            UPDATE customers 
            SET total_interactions = total_interactions + 1,
                last_interaction_at = NOW()
            WHERE id = NEW.customer_id;
        ELSIF TG_TABLE_NAME = 'orders' AND NEW.payment_status = 'paid' THEN
            UPDATE customers 
            SET total_orders = total_orders + 1,
                lifetime_value = lifetime_value + NEW.total_amount
            WHERE id = NEW.customer_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: notify_wallet_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_wallet_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.wallet_pass_id IS NOT NULL THEN
        INSERT INTO notifications (
            business_id,
            customer_id,
            type,
            channel,
            content,
            status
        ) VALUES (
            NEW.business_id,
            NEW.customer_id,
            'loyalty_balance_update',
            'apple_wallet',
            jsonb_build_object(
                'points_balance', NEW.points_balance,
                'current_tier', NEW.current_tier,
                'wallet_pass_id', NEW.wallet_pass_id
            ),
            'pending'
        );
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: products_invalidate_embedding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.products_invalidate_embedding() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (NEW.name     IS DISTINCT FROM OLD.name)
  OR (NEW.category IS DISTINCT FROM OLD.category)
  OR (NEW.variants IS DISTINCT FROM OLD.variants)
  THEN
    NEW.name_embedding := NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: reclaim_stale_jobs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reclaim_stale_jobs() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  reclaimed INT;
BEGIN
  UPDATE public.jobs
  SET    state = 'pending',
         locked_at = NULL,
         locked_by = NULL
  WHERE  state = 'claimed'
  AND    locked_at < now() - INTERVAL '2 minutes';

  GET DIAGNOSTICS reclaimed = ROW_COUNT;
  RETURN reclaimed;
END;
$$;


--
-- Name: reclaim_stale_outbox(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reclaim_stale_outbox() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  reclaimed INT;
BEGIN
  UPDATE public.outbox
  SET    state = 'pending'
  WHERE  state = 'delivering'
  AND    next_run_at < now() - INTERVAL '2 minutes';

  GET DIAGNOSTICS reclaimed = ROW_COUNT;
  RETURN reclaimed;
END;
$$;


--
-- Name: search_products_by_embedding(uuid, extensions.vector, integer, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_products_by_embedding(p_business_id uuid, p_embedding extensions.vector, p_limit integer DEFAULT 5, p_threshold double precision DEFAULT 0.65) RETURNS TABLE(id uuid, name text, price numeric, description text, category text, variants jsonb, similarity double precision)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  SELECT
    p.id,
    p.name,
    p.price,
    p.description,
    p.category,
    p.variants,
    1 - (p.name_embedding <=> p_embedding) AS similarity
  FROM public.products p
  WHERE p.business_id    = p_business_id
    AND p.available      = TRUE
    AND p.name_embedding IS NOT NULL
    AND 1 - (p.name_embedding <=> p_embedding) >= p_threshold
  ORDER BY p.name_embedding <=> p_embedding
  LIMIT p_limit;
$$;


--
-- Name: search_products_text(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_products_text(p_business_id uuid, p_query text, p_limit integer DEFAULT 10) RETURNS TABLE(id uuid, name text, price numeric, description text, category text, variants jsonb)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH normalized AS (
    SELECT nullif(trim(p_query), '') AS q
  )
  SELECT
    p.id,
    p.name,
    p.price,
    p.description,
    p.category,
    p.variants
  FROM public.products p
  CROSS JOIN normalized n
  WHERE p.business_id = p_business_id
    AND p.available = TRUE
    AND n.q IS NOT NULL
    AND (
      p.name ILIKE '%' || n.q || '%'
      OR coalesce(p.description, '') ILIKE '%' || n.q || '%'
      OR coalesce(p.category, '') ILIKE '%' || n.q || '%'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(p.variants, '[]'::jsonb)) AS variant
        WHERE coalesce(variant->>'name', '') ILIKE '%' || n.q || '%'
      )
    )
  ORDER BY
    CASE
      WHEN lower(p.name) = lower(n.q) THEN 0
      WHEN lower(p.name) LIKE lower(n.q) || '%' THEN 1
      WHEN lower(p.name) LIKE '%' || lower(n.q) || '%' THEN 2
      ELSE 3
    END,
    p.name ASC
  LIMIT greatest(coalesce(p_limit, 10), 1);
$$;


--
-- Name: search_similar_messages(uuid, extensions.vector, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_similar_messages(p_conversation_id uuid, p_embedding extensions.vector, p_limit integer DEFAULT 5, p_exclude_recent integer DEFAULT 8) RETURNS TABLE(id uuid, role text, content text, created_at timestamp with time zone, similarity double precision)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  SELECT m.id, m.role, m.content, m.created_at,
         1 - (m.embedding <=> p_embedding) AS similarity
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.embedding IS NOT NULL
    AND m.created_at < (
      SELECT created_at FROM public.messages WHERE conversation_id = p_conversation_id
      ORDER BY created_at DESC LIMIT 1 OFFSET p_exclude_recent - 1
    )
  ORDER BY m.embedding <=> p_embedding LIMIT p_limit;
$$;


--
-- Name: update_customer_prefs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_customer_prefs() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO customer_preferences (
    customer_id, 
    total_transactions, 
    avg_transaction_value,
    last_transaction_at
  )
  VALUES (
    NEW.customer_id, 
    1, 
    NEW.total_amount,
    NOW()
  )
  ON CONFLICT (customer_id) DO UPDATE SET
    total_transactions = customer_preferences.total_transactions + 1,
    avg_transaction_value = (
      (customer_preferences.avg_transaction_value * customer_preferences.total_transactions + NEW.total_amount) 
      / (customer_preferences.total_transactions + 1)
    ),
    last_transaction_at = NOW(),
    updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_customer_segment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_customer_segment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    new_segment VARCHAR(50);
    days_since_last_interaction INTEGER;
BEGIN
    days_since_last_interaction := EXTRACT(DAY FROM NOW() - NEW.last_interaction_at);
    
    IF NEW.total_orders = 0 THEN
        new_segment := 'new';
    ELSIF NEW.total_orders >= 20 OR NEW.lifetime_value >= 1000 THEN
        new_segment := 'vip';
    ELSIF days_since_last_interaction > 60 THEN
        new_segment := 'dormant';
    ELSIF days_since_last_interaction > 21 THEN
        new_segment := 'at_risk';
    ELSE
        new_segment := 'regular';
    END IF;
    
    IF new_segment != COALESCE(OLD.customer_segment, 'new') THEN
        NEW.customer_segment := new_segment;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: user_has_business_access(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_has_business_access(target_business_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dashboard_users AS du
    WHERE du.auth_user_id = auth.uid()
      AND du.business_id = target_business_id
  );
$$;


--
-- Name: user_has_business_access_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_has_business_access_text(target_business_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dashboard_users AS du
    WHERE du.auth_user_id = auth.uid()
      AND du.business_id::text = target_business_id
  );
$$;


--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
-- Regclass of the table e.g. public.notes
entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

-- I, U, D, T: insert, update ...
action realtime.action = (
    case wal ->> 'action'
        when 'I' then 'INSERT'
        when 'U' then 'UPDATE'
        when 'D' then 'DELETE'
        else 'ERROR'
    end
);

-- Is row level security enabled for the table
is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

subscriptions realtime.subscription[] = array_agg(subs)
    from
        realtime.subscription subs
    where
        subs.entity = entity_
        -- Filter by action early - only get subscriptions interested in this action
        -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
        and (subs.action_filter = '*' or subs.action_filter = action::text);

-- Subscription vars
roles regrole[] = array_agg(distinct us.claims_role::text)
    from
        unnest(subscriptions) us;

working_role regrole;
claimed_role regrole;
claims jsonb;

subscription_id uuid;
subscription_has_access bool;
visible_to_subscription_ids uuid[] = '{}';

-- structured info for wal's columns
columns realtime.wal_column[];
-- previous identity values for update/delete
old_columns realtime.wal_column[];

error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

-- Primary jsonb output for record
output jsonb;

begin
perform set_config('role', null, true);

columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'columns') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

old_columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'identity') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

for working_role in select * from unnest(roles) loop

    -- Update `is_selectable` for columns and old_columns
    columns =
        array_agg(
            (
                c.name,
                c.type_name,
                c.type_oid,
                c.value,
                c.is_pkey,
                pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
            )::realtime.wal_column
        )
        from
            unnest(columns) c;

    old_columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(old_columns) c;

    if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            -- subscriptions is already filtered by entity
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 400: Bad Request, no primary key']
        )::realtime.wal_rls;

    -- The claims role does not have SELECT permission to the primary key of entity
    elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 401: Unauthorized']
        )::realtime.wal_rls;

    else
        output = jsonb_build_object(
            'schema', wal ->> 'schema',
            'table', wal ->> 'table',
            'type', action,
            'commit_timestamp', to_char(
                ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'columns', (
                select
                    jsonb_agg(
                        jsonb_build_object(
                            'name', pa.attname,
                            'type', pt.typname
                        )
                        order by pa.attnum asc
                    )
                from
                    pg_attribute pa
                    join pg_type pt
                        on pa.atttypid = pt.oid
                where
                    attrelid = entity_
                    and attnum > 0
                    and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
            )
        )
        -- Add "record" key for insert and update
        || case
            when action in ('INSERT', 'UPDATE') then
                jsonb_build_object(
                    'record',
                    (
                        select
                            jsonb_object_agg(
                                -- if unchanged toast, get column name and value from old record
                                coalesce((c).name, (oc).name),
                                case
                                    when (c).name is null then (oc).value
                                    else (c).value
                                end
                            )
                        from
                            unnest(columns) c
                            full outer join unnest(old_columns) oc
                                on (c).name = (oc).name
                        where
                            coalesce((c).is_selectable, (oc).is_selectable)
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                    )
                )
            else '{}'::jsonb
        end
        -- Add "old_record" key for update and delete
        || case
            when action = 'UPDATE' then
                jsonb_build_object(
                        'old_record',
                        (
                            select jsonb_object_agg((c).name, (c).value)
                            from unnest(old_columns) c
                            where
                                (c).is_selectable
                                and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                        )
                    )
            when action = 'DELETE' then
                jsonb_build_object(
                    'old_record',
                    (
                        select jsonb_object_agg((c).name, (c).value)
                        from unnest(old_columns) c
                        where
                            (c).is_selectable
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                    )
                )
            else '{}'::jsonb
        end;

        -- Create the prepared statement
        if is_rls_enabled and action <> 'DELETE' then
            if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                deallocate walrus_rls_stmt;
            end if;
            execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
        end if;

        visible_to_subscription_ids = '{}';

        for subscription_id, claims in (
                select
                    subs.subscription_id,
                    subs.claims
                from
                    unnest(subscriptions) subs
                where
                    subs.entity = entity_
                    and subs.claims_role = working_role
                    and (
                        realtime.is_visible_through_filters(columns, subs.filters)
                        or (
                          action = 'DELETE'
                          and realtime.is_visible_through_filters(old_columns, subs.filters)
                        )
                    )
        ) loop

            if not is_rls_enabled or action = 'DELETE' then
                visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
            else
                -- Check if RLS allows the role to see the record
                perform
                    -- Trim leading and trailing quotes from working_role because set_config
                    -- doesn't recognize the role as valid if they are included
                    set_config('role', trim(both '"' from working_role::text), true),
                    set_config('request.jwt.claims', claims::text, true);

                execute 'execute walrus_rls_stmt' into subscription_has_access;

                if subscription_has_access then
                    visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                end if;
            end if;
        end loop;

        perform set_config('role', null, true);

        return next (
            output,
            is_rls_enabled,
            visible_to_subscription_ids,
            case
                when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                else '{}'
            end
        )::realtime.wal_rls;

    end if;
end loop;

perform set_config('role', null, true);
end;
$$;


--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
      /*
      Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
      */
      declare
          op_symbol text = (
              case
                  when op = 'eq' then '='
                  when op = 'neq' then '!='
                  when op = 'lt' then '<'
                  when op = 'lte' then '<='
                  when op = 'gt' then '>'
                  when op = 'gte' then '>='
                  when op = 'in' then '= any'
                  else 'UNKNOWN OP'
              end
          );
          res boolean;
      begin
          execute format(
              'select %L::'|| type_::text || ' ' || op_symbol
              || ' ( %L::'
              || (
                  case
                      when op = 'in' then type_::text || '[]'
                      else type_::text end
              )
              || ')', val_1, val_2) into res;
          return res;
      end;
      $$;


--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
    /*
    Should the record be visible (true) or filtered out (false) after *filters* are applied
    */
        select
            -- Default to allowed when no filters present
            $2 is null -- no filters. this should not happen because subscriptions has a default
            or array_length($2, 1) is null -- array length of an empty array is null
            or bool_and(
                coalesce(
                    realtime.check_equality_op(
                        op:=f.op,
                        type_:=coalesce(
                            col.type_oid::regtype, -- null when wal2json version <= 2.4
                            col.type_name::regtype
                        ),
                        -- cast jsonb to text
                        val_1:=col.value #>> '{}',
                        val_2:=f.value
                    ),
                    false -- if null, filter does not match
                )
            )
        from
            unnest(filters) f
            join unnest(columns) col
                on f.column_name = col.name;
    $_$;


--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[], slot_changes_count bigint)
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL AND ppt.tablename NOT LIKE '% %'),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures pg_logical_slot_get_changes is called exactly once
  w2j AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         pg_logical_slot_get_changes(
           slot_name, null, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  -- Count raw slot entries before apply_rls/subscription filter
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM w2j
    WHERE w2j.w2j_add_tables <> ''
  ),
  -- Apply RLS and filter as before
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM w2j,
         realtime.apply_rls(
           wal := w2j.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE w2j.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  -- Real rows with slot count attached
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  -- Sentinel row: always returned when no real rows exist so Elixir can
  -- always read slot_changes_count. Identified by wal IS NULL.
  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$$;


--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
      select
        (
          select string_agg('' || ch,'')
          from unnest(string_to_array(nsp.nspname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
        )
        || '.'
        || (
          select string_agg('' || ch,'')
          from unnest(string_to_array(pc.relname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
          )
      from
        pg_class pc
        join pg_namespace nsp
          on pc.relnamespace = nsp.oid
      where
        pc.oid = entity
    $$;


--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    -- Generate a new UUID for the id
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    -- Attempt to insert the message
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      -- Capture and notify the error
      RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    /*
    Validates that the user defined filters for a subscription:
    - refer to valid columns that the claimed role may access
    - values are coercable to the correct column type
    */
    declare
        col_names text[] = coalesce(
                array_agg(c.column_name order by c.ordinal_position),
                '{}'::text[]
            )
            from
                information_schema.columns c
            where
                format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                and pg_catalog.has_column_privilege(
                    (new.claims ->> 'role'),
                    format('%I.%I', c.table_schema, c.table_name)::regclass,
                    c.column_name,
                    'SELECT'
                );
        filter realtime.user_defined_filter;
        col_type regtype;

        in_val jsonb;
    begin
        for filter in select * from unnest(new.filters) loop
            -- Filtered column is valid
            if not filter.column_name = any(col_names) then
                raise exception 'invalid column for filter %', filter.column_name;
            end if;

            -- Type is sanitized and safe for string interpolation
            col_type = (
                select atttypid::regtype
                from pg_catalog.pg_attribute
                where attrelid = new.entity
                      and attname = filter.column_name
            );
            if col_type is null then
                raise exception 'failed to lookup type for column %', filter.column_name;
            end if;

            -- Set maximum number of entries for in filter
            if filter.op = 'in'::realtime.equality_op then
                in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                if coalesce(jsonb_array_length(in_val), 0) > 100 then
                    raise exception 'too many values for `in` filter. Maximum 100';
                end if;
            else
                -- raises an exception if value is not coercable to type
                perform realtime.cast(filter.value, col_type);
            end if;

        end loop;

        -- Apply consistent order to filters so the unique constraint on
        -- (subscription_id, entity, filters) can't be tricked by a different filter order
        new.filters = coalesce(
            array_agg(f order by f.column_name, f.op, f.value),
            '{}'
        ) from unnest(new.filters) f;

        return new;
    end;
    $$;


--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


--
-- Name: allow_any_operation(text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


--
-- Name: allow_only_operation(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: ai_turn_logs; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.ai_turn_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    conversation_id uuid,
    customer_id uuid,
    business_id uuid,
    model text NOT NULL,
    prompt_version text,
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer GENERATED ALWAYS AS ((COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0))) STORED,
    cost_usd numeric(10,6),
    latency_ms integer,
    response_type text,
    products_referenced jsonb DEFAULT '[]'::jsonb,
    customer_context jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    request_id text,
    CONSTRAINT ai_turn_logs_response_type_check CHECK ((response_type = ANY (ARRAY['greeting'::text, 'menu'::text, 'price_query'::text, 'product_search'::text, 'order_intent'::text, 'order_confirm'::text, 'payment_info'::text, 'fallback'::text, 'out_of_scope'::text, 'error'::text])))
);


--
-- Name: business_config_changes; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.business_config_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id text NOT NULL,
    slack_user_id text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    previous_config jsonb,
    new_config jsonb
);


--
-- Name: businesses; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.businesses (
    id uuid NOT NULL,
    name text NOT NULL,
    business_type text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    open_times jsonb DEFAULT jsonb_build_object('timezone', 'America/Mexico_City', 'days', jsonb_build_object('0', jsonb_build_object('closed', true), '1', jsonb_build_object('open', '07:30', 'close', '20:00'), '2', jsonb_build_object('open', '07:30', 'close', '20:00'), '3', jsonb_build_object('open', '07:30', 'close', '20:00'), '4', jsonb_build_object('open', '07:30', 'close', '20:00'), '5', jsonb_build_object('open', '07:30', 'close', '20:00'), '6', jsonb_build_object('open', '07:30', 'close', '20:00'))) NOT NULL
);


--
-- Name: COLUMN businesses.open_times; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.businesses.open_times IS 'Business operating hours by weekday. Format: {"timezone":"America/Mexico_City","days":{"0":{"closed":true},"1":{"open":"07:30","close":"20:00"}}}. WhatsApp order cutoff is enforced 30 minutes before close.';


--
-- Name: conversation_outcomes; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.conversation_outcomes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    conversation_id uuid,
    customer_id uuid,
    business_id uuid,
    outcome text NOT NULL,
    turn_count integer,
    duration_seconds integer,
    total_tokens integer,
    total_cost_usd numeric(10,6),
    products_discussed jsonb DEFAULT '[]'::jsonb,
    notes text,
    CONSTRAINT conversation_outcomes_outcome_check CHECK ((outcome = ANY (ARRAY['resolved'::text, 'sale'::text, 'abandoned'::text, 'escalated'::text, 'error'::text])))
);


--
-- Name: conversation_turns; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.conversation_turns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    business_id uuid NOT NULL,
    status text NOT NULL,
    source_message_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    merged_user_text text NOT NULL,
    integrity_decision text NOT NULL,
    integrity_reason text NOT NULL,
    base_state_version bigint NOT NULL,
    first_message_at timestamp with time zone NOT NULL,
    last_message_at timestamp with time zone NOT NULL,
    hold_until timestamp with time zone,
    released_at timestamp with time zone,
    processed_at timestamp with time zone,
    superseded_at timestamp with time zone,
    extracted_intent jsonb,
    reconciled_action jsonb,
    assistant_message_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_turns_integrity_decision_check CHECK ((integrity_decision = ANY (ARRAY['hold'::text, 'merge'::text, 'clarify'::text, 'replace'::text, 'cancel'::text, 'release'::text]))),
    CONSTRAINT conversation_turns_status_check CHECK ((status = ANY (ARRAY['buffering'::text, 'released'::text, 'processing'::text, 'completed'::text, 'clarification_needed'::text, 'superseded'::text, 'cancelled'::text])))
);


--
-- Name: conversations; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    customer_id uuid,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    conversation_history jsonb DEFAULT '[]'::jsonb,
    current_state text DEFAULT 'initial'::text,
    state_data jsonb DEFAULT '{}'::jsonb,
    last_message_at timestamp with time zone DEFAULT now(),
    summary text,
    history_migrated boolean DEFAULT false NOT NULL,
    draft_cart jsonb,
    state_version bigint DEFAULT 0 NOT NULL,
    draft_cart_version bigint DEFAULT 0 NOT NULL,
    pending_clarification jsonb
);


--
-- Name: COLUMN conversations.draft_cart; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.conversations.draft_cart IS 'Ephemeral cart for the order being built. Shape: {items: [{product_id, product_name, variant_name, quantity, unit_price}], updated_at}. Cleared on order confirm/cancel.';


--
-- Name: customer_preferences; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.customer_preferences (
    customer_id uuid NOT NULL,
    favorite_services uuid[],
    usual_modifications jsonb DEFAULT '[]'::jsonb,
    total_transactions integer DEFAULT 0,
    avg_transaction_value numeric(10,2),
    last_transaction_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    facts jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    phone text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    name text
);


--
-- Name: daily_summaries; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.daily_summaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id text NOT NULL,
    summary_date date NOT NULL,
    slack_channel text NOT NULL,
    slack_message_ts text,
    pinned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_users; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.dashboard_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id uuid NOT NULL,
    business_id uuid NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dashboard_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'viewer'::text])))
);


--
-- Name: edge_function_logs; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.edge_function_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    function_name text NOT NULL,
    status text NOT NULL,
    duration_ms integer,
    error_message text,
    error_stack text,
    metadata jsonb DEFAULT '{}'::jsonb,
    request_id text,
    CONSTRAINT edge_function_logs_status_check CHECK ((status = ANY (ARRAY['success'::text, 'error'::text])))
);


--
-- Name: eval_traces; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.eval_traces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    turn_id uuid,
    business_id uuid,
    turn_sequence integer,
    authoritative_decision jsonb,
    harness_decision jsonb,
    agreement boolean,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inbound_events; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.inbound_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    source text NOT NULL,
    source_event_id text,
    event_type text NOT NULL,
    payload_hash text,
    payload jsonb NOT NULL,
    status text DEFAULT 'accepted'::text NOT NULL,
    request_id uuid NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    error text,
    CONSTRAINT inbound_events_status_check CHECK ((status = ANY (ARRAY['accepted'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'duplicate'::text])))
);


--
-- Name: COLUMN inbound_events.source; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.inbound_events.source IS 'Event origin: ''twilio'', ''slack'', ''admin'', ''cron''.';


--
-- Name: COLUMN inbound_events.source_event_id; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.inbound_events.source_event_id IS 'Provider-specific unique ID (e.g. Twilio MessageSid, Slack event_id). NULL for cron-originated events.';


--
-- Name: COLUMN inbound_events.event_type; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.inbound_events.event_type IS 'Semantic event type: ''whatsapp_message'', ''slack_action'', ''slack_event'', ''slack_shortcut''.';


--
-- Name: COLUMN inbound_events.payload_hash; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.inbound_events.payload_hash IS 'SHA-256 of the raw inbound payload, for deduplication of events without a natural source_event_id.';


--
-- Name: COLUMN inbound_events.payload; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.inbound_events.payload IS 'Normalized payload (never raw provider format). Sensitive fields (e.g. auth tokens) must be stripped before insert.';


--
-- Name: COLUMN inbound_events.status; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.inbound_events.status IS 'Event lifecycle: accepted → processing → completed/failed. ''duplicate'' for idempotency rejections.';


--
-- Name: COLUMN inbound_events.request_id; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.inbound_events.request_id IS 'Correlation ID assigned at ingress, shared across all logs, jobs, and outbox rows for this request.';


--
-- Name: job_attempts; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.job_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    attempt smallint NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    outcome text DEFAULT 'running'::text NOT NULL,
    error text,
    metadata jsonb,
    CONSTRAINT job_attempts_outcome_check CHECK ((outcome = ANY (ARRAY['running'::text, 'success'::text, 'error'::text, 'timeout'::text])))
);


--
-- Name: COLUMN job_attempts.attempt; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.job_attempts.attempt IS '1-based attempt number. First attempt is 1, first retry is 2, etc.';


--
-- Name: COLUMN job_attempts.outcome; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.job_attempts.outcome IS 'Attempt result: ''running'' (in progress), ''success'', ''error'' (processor threw), ''timeout'' (exceeded time limit).';


--
-- Name: COLUMN job_attempts.metadata; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.job_attempts.metadata IS 'Processor-specific execution metadata. E.g. {tokens_used, latency_ms, model, cache_hit} for LLM jobs.';


--
-- Name: messages; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    role text NOT NULL,
    content text NOT NULL,
    intent text,
    entities jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    embedding extensions.vector(1024),
    message_index integer,
    twilio_message_sid text,
    embedding_model text
);


--
-- Name: pipeline_traces; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.pipeline_traces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trace_id text NOT NULL,
    conversation_id uuid,
    turn_id uuid,
    business_id text,
    stage text NOT NULL,
    event text NOT NULL,
    detail jsonb,
    error text,
    ts timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    name text NOT NULL,
    price numeric(10,2),
    category text,
    available boolean DEFAULT true,
    zettle_uuid text,
    description text,
    variants jsonb DEFAULT '[]'::jsonb,
    synced_at timestamp with time zone,
    name_embedding extensions.vector(1024)
);


--
-- Name: security_logs; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.security_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    event_type text NOT NULL,
    input_text text,
    details text,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    request_id text
);


--
-- Name: transaction_status_events; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.transaction_status_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    old_status text,
    new_status text NOT NULL,
    acted_by_slack_user text,
    acted_in_channel text,
    acted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN transaction_status_events.acted_by_slack_user; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.transaction_status_events.acted_by_slack_user IS 'Slack user_id from the payload.user.id field in the block_actions or view_submission payload.';


--
-- Name: COLUMN transaction_status_events.acted_in_channel; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON COLUMN conversaflow.transaction_status_events.acted_in_channel IS 'Slack channel_id from payload.channel.id. Only available for button actions in channel messages, not from App Home views.';


--
-- Name: transactions; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.transactions (
    id uuid NOT NULL,
    business_id uuid,
    customer_id uuid,
    service_id uuid,
    transaction_type text,
    status text DEFAULT 'pending'::text,
    total_amount numeric(10,2),
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    slack_message_ts text
);


--
-- Name: zettle_oauth_tokens; Type: TABLE; Schema: conversaflow; Owner: -
--

CREATE TABLE conversaflow.zettle_oauth_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    token_type text DEFAULT 'Bearer'::text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: device_sessions; Type: TABLE; Schema: kds; Owner: -
--

CREATE TABLE kds.device_sessions (
    device_id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    device_name text NOT NULL,
    station_id text,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: TABLE device_sessions; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON TABLE kds.device_sessions IS 'One row per provisioned KDS device. Tokens are stored as sha256 hex hashes. The kds-command edge function verifies the plaintext token before executing mutations.';


--
-- Name: ticket_events; Type: TABLE; Schema: kds; Owner: -
--

CREATE TABLE kds.ticket_events (
    sequence bigint NOT NULL,
    ticket_id uuid NOT NULL,
    business_id uuid NOT NULL,
    source_transaction_id uuid NOT NULL,
    kind kds.ticket_event_kind NOT NULL,
    status kds.ticket_status,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'projection'::text NOT NULL,
    source_event_key text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: TABLE ticket_events; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON TABLE kds.ticket_events IS 'Ordered kitchen event log for snapshot reconciliation and realtime consumers.';


--
-- Name: COLUMN ticket_events.source_event_key; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON COLUMN kds.ticket_events.source_event_key IS 'Idempotency key for projection emissions. Prevents duplicate events during backfill or replay.';


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
    ticket_item_id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    source_transaction_id uuid NOT NULL,
    display_order integer NOT NULL,
    product_id uuid,
    name text NOT NULL,
    quantity integer NOT NULL,
    variant_name text,
    notes text,
    unit_price numeric(12,2),
    is_cancelled boolean DEFAULT false NOT NULL,
    CONSTRAINT ticket_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: TABLE ticket_items; Type: COMMENT; Schema: kds; Owner: -
--

COMMENT ON TABLE kds.ticket_items IS 'Normalized kitchen line items derived from transactions.details.items for display in KDS clients.';


--
-- Name: ai_turn_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_turn_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    conversation_id uuid,
    customer_id uuid,
    business_id uuid,
    model text NOT NULL,
    prompt_version text,
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer GENERATED ALWAYS AS ((COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0))) STORED,
    cost_usd numeric(10,6),
    latency_ms integer,
    response_type text,
    products_referenced jsonb DEFAULT '[]'::jsonb,
    customer_context jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    request_id text,
    CONSTRAINT ai_turn_logs_response_type_check CHECK ((response_type = ANY (ARRAY['greeting'::text, 'menu'::text, 'price_query'::text, 'product_search'::text, 'order_intent'::text, 'order_confirm'::text, 'payment_info'::text, 'fallback'::text, 'out_of_scope'::text, 'error'::text])))
);


--
-- Name: business_config_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_config_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id text NOT NULL,
    slack_user_id text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    previous_config jsonb,
    new_config jsonb
);


--
-- Name: TABLE business_config_changes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.business_config_changes IS 'Audit trail for business config changes made via Slack settings modal.';


--
-- Name: businesses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.businesses (
    id uuid NOT NULL,
    name text NOT NULL,
    business_type text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    open_times jsonb DEFAULT jsonb_build_object('timezone', 'America/Mexico_City', 'days', jsonb_build_object('0', jsonb_build_object('closed', true), '1', jsonb_build_object('open', '07:30', 'close', '20:00'), '2', jsonb_build_object('open', '07:30', 'close', '20:00'), '3', jsonb_build_object('open', '07:30', 'close', '20:00'), '4', jsonb_build_object('open', '07:30', 'close', '20:00'), '5', jsonb_build_object('open', '07:30', 'close', '20:00'), '6', jsonb_build_object('open', '07:30', 'close', '20:00'))) NOT NULL
);


--
-- Name: COLUMN businesses.open_times; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.businesses.open_times IS 'Business operating hours by weekday. Format: {"timezone":"America/Mexico_City","days":{"0":{"closed":true},"1":{"open":"07:30","close":"20:00"}}}. WhatsApp order cutoff is enforced 30 minutes before close.';


--
-- Name: conversation_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_outcomes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    conversation_id uuid,
    customer_id uuid,
    business_id uuid,
    outcome text NOT NULL,
    turn_count integer,
    duration_seconds integer,
    total_tokens integer,
    total_cost_usd numeric(10,6),
    products_discussed jsonb DEFAULT '[]'::jsonb,
    notes text,
    CONSTRAINT conversation_outcomes_outcome_check CHECK ((outcome = ANY (ARRAY['resolved'::text, 'sale'::text, 'abandoned'::text, 'escalated'::text, 'error'::text])))
);


--
-- Name: conversation_turns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_turns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    business_id uuid NOT NULL,
    status text NOT NULL,
    source_message_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    merged_user_text text NOT NULL,
    integrity_decision text NOT NULL,
    integrity_reason text NOT NULL,
    base_state_version bigint NOT NULL,
    first_message_at timestamp with time zone NOT NULL,
    last_message_at timestamp with time zone NOT NULL,
    hold_until timestamp with time zone,
    released_at timestamp with time zone,
    processed_at timestamp with time zone,
    superseded_at timestamp with time zone,
    extracted_intent jsonb,
    reconciled_action jsonb,
    assistant_message_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_turns_integrity_decision_check CHECK ((integrity_decision = ANY (ARRAY['hold'::text, 'merge'::text, 'clarify'::text, 'replace'::text, 'cancel'::text, 'release'::text]))),
    CONSTRAINT conversation_turns_status_check CHECK ((status = ANY (ARRAY['buffering'::text, 'released'::text, 'processing'::text, 'completed'::text, 'clarification_needed'::text, 'superseded'::text, 'cancelled'::text])))
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    customer_id uuid,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    conversation_history jsonb DEFAULT '[]'::jsonb,
    current_state text DEFAULT 'initial'::text,
    state_data jsonb DEFAULT '{}'::jsonb,
    last_message_at timestamp with time zone DEFAULT now(),
    summary text,
    history_migrated boolean DEFAULT false NOT NULL,
    draft_cart jsonb,
    state_version bigint DEFAULT 0 NOT NULL,
    draft_cart_version bigint DEFAULT 0 NOT NULL,
    pending_clarification jsonb
);


--
-- Name: COLUMN conversations.draft_cart; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.conversations.draft_cart IS 'Ephemeral cart for the order being built. Shape: {items: [{product_id, product_name, variant_name, quantity, unit_price}], updated_at}. Cleared on order confirm/cancel.';


--
-- Name: customer_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_preferences (
    customer_id uuid NOT NULL,
    favorite_services uuid[],
    usual_modifications jsonb DEFAULT '[]'::jsonb,
    total_transactions integer DEFAULT 0,
    avg_transaction_value numeric(10,2),
    last_transaction_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    facts jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    phone text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    name text
);


--
-- Name: daily_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_summaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id text NOT NULL,
    summary_date date NOT NULL,
    slack_channel text NOT NULL,
    slack_message_ts text,
    pinned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id uuid NOT NULL,
    business_id uuid NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dashboard_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'viewer'::text])))
);


--
-- Name: edge_function_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.edge_function_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    function_name text NOT NULL,
    status text NOT NULL,
    duration_ms integer,
    error_message text,
    error_stack text,
    metadata jsonb DEFAULT '{}'::jsonb,
    request_id text,
    CONSTRAINT edge_function_logs_status_check CHECK ((status = ANY (ARRAY['success'::text, 'error'::text])))
);


--
-- Name: inbound_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbound_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    source text NOT NULL,
    source_event_id text,
    event_type text NOT NULL,
    payload_hash text,
    payload jsonb NOT NULL,
    status text DEFAULT 'accepted'::text NOT NULL,
    request_id uuid NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    error text,
    CONSTRAINT inbound_events_status_check CHECK ((status = ANY (ARRAY['accepted'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'duplicate'::text])))
);


--
-- Name: TABLE inbound_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inbound_events IS 'Canonical record of every external event (Twilio webhook, Slack action, cron tick, etc.). UNIQUE(source, source_event_id) provides idempotency — Twilio retries with the same MessageSid are rejected at insert.';


--
-- Name: COLUMN inbound_events.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound_events.source IS 'Event origin: ''twilio'', ''slack'', ''admin'', ''cron''.';


--
-- Name: COLUMN inbound_events.source_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound_events.source_event_id IS 'Provider-specific unique ID (e.g. Twilio MessageSid, Slack event_id). NULL for cron-originated events.';


--
-- Name: COLUMN inbound_events.event_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound_events.event_type IS 'Semantic event type: ''whatsapp_message'', ''slack_action'', ''slack_event'', ''slack_shortcut''.';


--
-- Name: COLUMN inbound_events.payload_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound_events.payload_hash IS 'SHA-256 of the raw inbound payload, for deduplication of events without a natural source_event_id.';


--
-- Name: COLUMN inbound_events.payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound_events.payload IS 'Normalized payload (never raw provider format). Sensitive fields (e.g. auth tokens) must be stripped before insert.';


--
-- Name: COLUMN inbound_events.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound_events.status IS 'Event lifecycle: accepted → processing → completed/failed. ''duplicate'' for idempotency rejections.';


--
-- Name: COLUMN inbound_events.request_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbound_events.request_id IS 'Correlation ID assigned at ingress, shared across all logs, jobs, and outbox rows for this request.';


--
-- Name: job_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    attempt smallint NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    outcome text DEFAULT 'running'::text NOT NULL,
    error text,
    metadata jsonb,
    CONSTRAINT job_attempts_outcome_check CHECK ((outcome = ANY (ARRAY['running'::text, 'success'::text, 'error'::text, 'timeout'::text])))
);


--
-- Name: TABLE job_attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_attempts IS 'Per-attempt execution record for jobs. ON DELETE CASCADE from jobs — when a job is removed, its attempt history is cleaned up. UNIQUE(job_id, attempt) prevents duplicate attempt numbers.';


--
-- Name: COLUMN job_attempts.attempt; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_attempts.attempt IS '1-based attempt number. First attempt is 1, first retry is 2, etc.';


--
-- Name: COLUMN job_attempts.outcome; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_attempts.outcome IS 'Attempt result: ''running'' (in progress), ''success'', ''error'' (processor threw), ''timeout'' (exceeded time limit).';


--
-- Name: COLUMN job_attempts.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_attempts.metadata IS 'Processor-specific execution metadata. E.g. {tokens_used, latency_ms, model, cache_hit} for LLM jobs.';


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    role text NOT NULL,
    content text NOT NULL,
    intent text,
    entities jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    embedding extensions.vector(1024),
    message_index integer,
    twilio_message_sid text,
    embedding_model text
);


--
-- Name: pipeline_traces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_traces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trace_id text NOT NULL,
    conversation_id uuid,
    turn_id uuid,
    business_id text,
    stage text NOT NULL,
    event text NOT NULL,
    detail jsonb,
    error text,
    ts timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE pipeline_traces; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pipeline_traces IS 'Lifecycle trace for each inbound message through the pipeline stages: inbound → integrity → process → dispatch. One row per stage event. trace_id = request_id from whatsapp-handler, propagated through job payloads and outbox payload so every stage is correlatable.';


--
-- Name: COLUMN pipeline_traces.trace_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pipeline_traces.trace_id IS 'Correlation key = request_id assigned at whatsapp-handler ingress. Propagated through turn.integrity payload → turn.process payload → twilio.reply outbox payload → dispatcher.';


--
-- Name: COLUMN pipeline_traces.stage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pipeline_traces.stage IS 'Pipeline stage: inbound | integrity | process | dispatch';


--
-- Name: COLUMN pipeline_traces.event; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pipeline_traces.event IS 'Stage event: enqueued | skipped | failed | started | decision | completed | superseded | delivered | dead';


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    name text NOT NULL,
    price numeric(10,2),
    category text,
    available boolean DEFAULT true,
    zettle_uuid text,
    description text,
    variants jsonb DEFAULT '[]'::jsonb,
    synced_at timestamp with time zone,
    name_embedding extensions.vector(1024)
);


--
-- Name: security_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    event_type text NOT NULL,
    input_text text,
    details text,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    request_id text
);


--
-- Name: transaction_status_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_status_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    old_status text,
    new_status text NOT NULL,
    acted_by_slack_user text,
    acted_in_channel text,
    acted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE transaction_status_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.transaction_status_events IS 'Phase-2 event log for order status transitions. Used to compute accept latency, prep latency, and per-staff performance once the App Home workflow is validated.';


--
-- Name: COLUMN transaction_status_events.acted_by_slack_user; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transaction_status_events.acted_by_slack_user IS 'Slack user_id from the payload.user.id field in the block_actions or view_submission payload.';


--
-- Name: COLUMN transaction_status_events.acted_in_channel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transaction_status_events.acted_in_channel IS 'Slack channel_id from payload.channel.id. Only available for button actions in channel messages, not from App Home views.';


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid NOT NULL,
    business_id uuid,
    customer_id uuid,
    service_id uuid,
    transaction_type text,
    status text DEFAULT 'pending'::text,
    total_amount numeric(10,2),
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    slack_message_ts text
);


--
-- Name: zettle_oauth_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zettle_oauth_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    token_type text DEFAULT 'Bearer'::text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE zettle_oauth_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.zettle_oauth_tokens IS 'Stores Zettle OAuth tokens with automatic refresh capability';


--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
)
PARTITION BY RANGE (inserted_at);


--
-- Name: messages_2026_05_06; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_05_06 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: messages_2026_05_07; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_05_07 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: messages_2026_05_08; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_05_08 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: messages_2026_05_09; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_05_09 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: messages_2026_05_10; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_05_10 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_filter text DEFAULT '*'::text,
    CONSTRAINT subscription_action_filter_check CHECK ((action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: -
--

ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb
);


--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: supabase_migrations; Owner: -
--

CREATE TABLE supabase_migrations.schema_migrations (
    version text NOT NULL,
    statements text[],
    name text,
    created_by text,
    idempotency_key text,
    rollback text[]
);


--
-- Name: ApplePushToken; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."ApplePushToken" (
    id text NOT NULL,
    "cardId" text NOT NULL,
    "deviceToken" text NOT NULL,
    "pushToken" text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: GiftCard; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."GiftCard" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    code text NOT NULL,
    "amountCentavos" integer NOT NULL,
    "createdByStaffId" text NOT NULL,
    "senderName" text,
    message text,
    "recipientEmail" text,
    "recipientPhone" text,
    "recipientName" text,
    "isRedeemed" boolean DEFAULT false NOT NULL,
    "redeemedAt" timestamp with time zone,
    "redeemedCardId" text,
    "expiresAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: Location; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."Location" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    address text,
    latitude double precision,
    longitude double precision,
    "isActive" boolean DEFAULT true NOT NULL
);


--
-- Name: LoyaltyCard; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."LoyaltyCard" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "userId" text NOT NULL,
    "cardNumber" text NOT NULL,
    "balanceCentavos" integer DEFAULT 0 NOT NULL,
    "totalVisits" integer DEFAULT 0 NOT NULL,
    "visitsThisCycle" integer DEFAULT 0 NOT NULL,
    "pendingRewards" integer DEFAULT 0 NOT NULL,
    "applePassSerial" text,
    "applePassAuthToken" text,
    "googlePassObjectId" text,
    "qrToken" text NOT NULL,
    "qrIssuedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: OtpVerification; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."OtpVerification" (
    id text NOT NULL,
    phone text NOT NULL,
    "tenantId" text NOT NULL,
    "codeHash" text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: RewardConfig; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."RewardConfig" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "visitsRequired" integer DEFAULT 10 NOT NULL,
    "rewardName" text DEFAULT 'Recompensa de temporada'::text NOT NULL,
    "rewardDescription" text,
    "rewardCostCentavos" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "activatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: RewardRedemption; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."RewardRedemption" (
    id text NOT NULL,
    "cardId" text NOT NULL,
    "configId" text NOT NULL,
    "staffId" text NOT NULL,
    "redeemedAt" timestamp with time zone DEFAULT now() NOT NULL,
    note text
);


--
-- Name: Session; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."Session" (
    id text NOT NULL,
    "userId" text NOT NULL,
    token text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: Tenant; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."Tenant" (
    id text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    city text,
    "cardPrefix" text DEFAULT 'LYL'::text NOT NULL,
    "primaryColor" text DEFAULT '#B5605A'::text NOT NULL,
    "secondaryColor" text,
    "labelColor" text,
    "logoUrl" text,
    "stripImageUrl" text,
    "passStyle" text DEFAULT 'default'::text NOT NULL,
    "promoMessage" text,
    "selfRegistration" boolean DEFAULT true NOT NULL,
    "subscriptionStatus" text DEFAULT 'ACTIVE'::text NOT NULL,
    "suspendedAt" timestamp with time zone,
    "trialEndsAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "topupEnabled" boolean DEFAULT true NOT NULL,
    "promoDays" text,
    "promoEndsAt" timestamp with time zone,
    "promoStartsAt" timestamp with time zone,
    timezone text DEFAULT 'America/Mexico_City'::text NOT NULL,
    "businessHours" jsonb
);


--
-- Name: Transaction; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."Transaction" (
    id text NOT NULL,
    "cardId" text NOT NULL,
    "staffId" text,
    type text NOT NULL,
    "amountCentavos" integer NOT NULL,
    description text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."User" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    phone text,
    email text,
    name text,
    role text DEFAULT 'CUSTOMER'::text NOT NULL,
    "passwordHash" text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "birthDate" date,
    device text,
    os text,
    "phoneVerifiedAt" timestamp with time zone
);


--
-- Name: Visit; Type: TABLE; Schema: umi_cash; Owner: -
--

CREATE TABLE umi_cash."Visit" (
    id text NOT NULL,
    "cardId" text NOT NULL,
    "staffId" text NOT NULL,
    "scannedAt" timestamp with time zone DEFAULT now() NOT NULL,
    note text
);


--
-- Name: messages_2026_05_06; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_06 FOR VALUES FROM ('2026-05-06 00:00:00') TO ('2026-05-07 00:00:00');


--
-- Name: messages_2026_05_07; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_07 FOR VALUES FROM ('2026-05-07 00:00:00') TO ('2026-05-08 00:00:00');


--
-- Name: messages_2026_05_08; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_08 FOR VALUES FROM ('2026-05-08 00:00:00') TO ('2026-05-09 00:00:00');


--
-- Name: messages_2026_05_09; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_09 FOR VALUES FROM ('2026-05-09 00:00:00') TO ('2026-05-10 00:00:00');


--
-- Name: messages_2026_05_10; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_10 FOR VALUES FROM ('2026-05-10 00:00:00') TO ('2026-05-11 00:00:00');


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: ai_turn_logs ai_turn_logs_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.ai_turn_logs
    ADD CONSTRAINT ai_turn_logs_pkey PRIMARY KEY (id);


--
-- Name: business_config_changes business_config_changes_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.business_config_changes
    ADD CONSTRAINT business_config_changes_pkey PRIMARY KEY (id);


--
-- Name: businesses businesses_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.businesses
    ADD CONSTRAINT businesses_pkey PRIMARY KEY (id);


--
-- Name: conversation_outcomes conversation_outcomes_conversation_id_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_conversation_id_key UNIQUE (conversation_id);


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
-- Name: customer_preferences customer_preferences_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.customer_preferences
    ADD CONSTRAINT customer_preferences_pkey PRIMARY KEY (customer_id);


--
-- Name: customers customers_business_id_phone_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.customers
    ADD CONSTRAINT customers_business_id_phone_key UNIQUE (business_id, phone);


--
-- Name: customers customers_phone_business_id_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.customers
    ADD CONSTRAINT customers_phone_business_id_key UNIQUE (phone, business_id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: daily_summaries daily_summaries_business_id_summary_date_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.daily_summaries
    ADD CONSTRAINT daily_summaries_business_id_summary_date_key UNIQUE (business_id, summary_date);


--
-- Name: daily_summaries daily_summaries_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.daily_summaries
    ADD CONSTRAINT daily_summaries_pkey PRIMARY KEY (id);


--
-- Name: dashboard_users dashboard_users_auth_user_id_business_id_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.dashboard_users
    ADD CONSTRAINT dashboard_users_auth_user_id_business_id_key UNIQUE (auth_user_id, business_id);


--
-- Name: dashboard_users dashboard_users_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.dashboard_users
    ADD CONSTRAINT dashboard_users_pkey PRIMARY KEY (id);


--
-- Name: edge_function_logs edge_function_logs_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.edge_function_logs
    ADD CONSTRAINT edge_function_logs_pkey PRIMARY KEY (id);


--
-- Name: eval_traces eval_traces_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.eval_traces
    ADD CONSTRAINT eval_traces_pkey PRIMARY KEY (id);


--
-- Name: inbound_events inbound_events_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.inbound_events
    ADD CONSTRAINT inbound_events_pkey PRIMARY KEY (id);


--
-- Name: inbound_events inbound_events_source_source_event_id_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.inbound_events
    ADD CONSTRAINT inbound_events_source_source_event_id_key UNIQUE (source, source_event_id);


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
-- Name: jobs jobs_inbound_event_id_job_type_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.jobs
    ADD CONSTRAINT jobs_inbound_event_id_job_type_key UNIQUE (inbound_event_id, job_type);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


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
-- Name: pipeline_traces pipeline_traces_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.pipeline_traces
    ADD CONSTRAINT pipeline_traces_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_zettle_uuid_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.products
    ADD CONSTRAINT products_zettle_uuid_key UNIQUE (zettle_uuid);


--
-- Name: security_logs security_logs_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.security_logs
    ADD CONSTRAINT security_logs_pkey PRIMARY KEY (id);


--
-- Name: transaction_status_events transaction_status_events_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.transaction_status_events
    ADD CONSTRAINT transaction_status_events_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_business_id_key; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.zettle_oauth_tokens
    ADD CONSTRAINT zettle_oauth_tokens_business_id_key UNIQUE (business_id);


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.zettle_oauth_tokens
    ADD CONSTRAINT zettle_oauth_tokens_pkey PRIMARY KEY (id);


--
-- Name: device_sessions device_sessions_pkey; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.device_sessions
    ADD CONSTRAINT device_sessions_pkey PRIMARY KEY (device_id);


--
-- Name: device_sessions device_sessions_token_hash_key; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.device_sessions
    ADD CONSTRAINT device_sessions_token_hash_key UNIQUE (token_hash);


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
    ADD CONSTRAINT ticket_items_pkey PRIMARY KEY (ticket_item_id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (ticket_id);


--
-- Name: tickets tickets_source_transaction_id_key; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_source_transaction_id_key UNIQUE (source_transaction_id);


--
-- Name: ticket_items uq_kds_ticket_item_order; Type: CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_items
    ADD CONSTRAINT uq_kds_ticket_item_order UNIQUE (ticket_id, display_order);


--
-- Name: ai_turn_logs ai_turn_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_turn_logs
    ADD CONSTRAINT ai_turn_logs_pkey PRIMARY KEY (id);


--
-- Name: business_config_changes business_config_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_config_changes
    ADD CONSTRAINT business_config_changes_pkey PRIMARY KEY (id);


--
-- Name: businesses businesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_pkey PRIMARY KEY (id);


--
-- Name: conversation_outcomes conversation_outcomes_conversation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_conversation_id_key UNIQUE (conversation_id);


--
-- Name: conversation_outcomes conversation_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_pkey PRIMARY KEY (id);


--
-- Name: conversation_turns conversation_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turns
    ADD CONSTRAINT conversation_turns_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: customer_preferences customer_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_preferences
    ADD CONSTRAINT customer_preferences_pkey PRIMARY KEY (customer_id);


--
-- Name: customers customers_business_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_business_id_phone_key UNIQUE (business_id, phone);


--
-- Name: customers customers_phone_business_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_phone_business_id_unique UNIQUE (phone, business_id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: daily_summaries daily_summaries_business_id_summary_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_summaries
    ADD CONSTRAINT daily_summaries_business_id_summary_date_key UNIQUE (business_id, summary_date);


--
-- Name: daily_summaries daily_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_summaries
    ADD CONSTRAINT daily_summaries_pkey PRIMARY KEY (id);


--
-- Name: dashboard_users dashboard_users_auth_user_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_auth_user_id_business_id_key UNIQUE (auth_user_id, business_id);


--
-- Name: dashboard_users dashboard_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_pkey PRIMARY KEY (id);


--
-- Name: edge_function_logs edge_function_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edge_function_logs
    ADD CONSTRAINT edge_function_logs_pkey PRIMARY KEY (id);


--
-- Name: inbound_events inbound_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_events
    ADD CONSTRAINT inbound_events_pkey PRIMARY KEY (id);


--
-- Name: job_attempts job_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_attempts
    ADD CONSTRAINT job_attempts_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (id);


--
-- Name: pipeline_traces pipeline_traces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_traces
    ADD CONSTRAINT pipeline_traces_pkey PRIMARY KEY (id);


--
-- Name: products products_zettle_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_zettle_uuid_key UNIQUE (zettle_uuid);


--
-- Name: security_logs security_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_logs
    ADD CONSTRAINT security_logs_pkey PRIMARY KEY (id);


--
-- Name: products services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: transaction_status_events transaction_status_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_status_events
    ADD CONSTRAINT transaction_status_events_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: inbound_events uq_inbound_source_event; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_events
    ADD CONSTRAINT uq_inbound_source_event UNIQUE (source, source_event_id);


--
-- Name: job_attempts uq_job_attempt; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_attempts
    ADD CONSTRAINT uq_job_attempt UNIQUE (job_id, attempt);


--
-- Name: jobs uq_job_event_type; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT uq_job_event_type UNIQUE (inbound_event_id, job_type);


--
-- Name: outbox uq_outbox_idempotency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT uq_outbox_idempotency UNIQUE (idempotency_key);


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zettle_oauth_tokens
    ADD CONSTRAINT zettle_oauth_tokens_business_id_key UNIQUE (business_id);


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zettle_oauth_tokens
    ADD CONSTRAINT zettle_oauth_tokens_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_06 messages_2026_05_06_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_05_06
    ADD CONSTRAINT messages_2026_05_06_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_07 messages_2026_05_07_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_05_07
    ADD CONSTRAINT messages_2026_05_07_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_08 messages_2026_05_08_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_05_08
    ADD CONSTRAINT messages_2026_05_08_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_09 messages_2026_05_09_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_05_09
    ADD CONSTRAINT messages_2026_05_09_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_10 messages_2026_05_10_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_05_10
    ADD CONSTRAINT messages_2026_05_10_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_idempotency_key_key; Type: CONSTRAINT; Schema: supabase_migrations; Owner: -
--

ALTER TABLE ONLY supabase_migrations.schema_migrations
    ADD CONSTRAINT schema_migrations_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: supabase_migrations; Owner: -
--

ALTER TABLE ONLY supabase_migrations.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: ApplePushToken ApplePushToken_cardId_deviceToken_key; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."ApplePushToken"
    ADD CONSTRAINT "ApplePushToken_cardId_deviceToken_key" UNIQUE ("cardId", "deviceToken");


--
-- Name: ApplePushToken ApplePushToken_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."ApplePushToken"
    ADD CONSTRAINT "ApplePushToken_pkey" PRIMARY KEY (id);


--
-- Name: GiftCard GiftCard_code_key; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."GiftCard"
    ADD CONSTRAINT "GiftCard_code_key" UNIQUE (code);


--
-- Name: GiftCard GiftCard_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."GiftCard"
    ADD CONSTRAINT "GiftCard_pkey" PRIMARY KEY (id);


--
-- Name: Location Location_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Location"
    ADD CONSTRAINT "Location_pkey" PRIMARY KEY (id);


--
-- Name: LoyaltyCard LoyaltyCard_applePassSerial_key; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_applePassSerial_key" UNIQUE ("applePassSerial");


--
-- Name: LoyaltyCard LoyaltyCard_cardNumber_key; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_cardNumber_key" UNIQUE ("cardNumber");


--
-- Name: LoyaltyCard LoyaltyCard_googlePassObjectId_key; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_googlePassObjectId_key" UNIQUE ("googlePassObjectId");


--
-- Name: LoyaltyCard LoyaltyCard_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_pkey" PRIMARY KEY (id);


--
-- Name: LoyaltyCard LoyaltyCard_qrToken_key; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_qrToken_key" UNIQUE ("qrToken");


--
-- Name: LoyaltyCard LoyaltyCard_userId_key; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_userId_key" UNIQUE ("userId");


--
-- Name: OtpVerification OtpVerification_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."OtpVerification"
    ADD CONSTRAINT "OtpVerification_pkey" PRIMARY KEY (id);


--
-- Name: RewardConfig RewardConfig_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."RewardConfig"
    ADD CONSTRAINT "RewardConfig_pkey" PRIMARY KEY (id);


--
-- Name: RewardRedemption RewardRedemption_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."RewardRedemption"
    ADD CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY (id);


--
-- Name: Session Session_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id);


--
-- Name: Session Session_token_key; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Session"
    ADD CONSTRAINT "Session_token_key" UNIQUE (token);


--
-- Name: Tenant Tenant_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Tenant"
    ADD CONSTRAINT "Tenant_pkey" PRIMARY KEY (id);


--
-- Name: Tenant Tenant_slug_key; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Tenant"
    ADD CONSTRAINT "Tenant_slug_key" UNIQUE (slug);


--
-- Name: Transaction Transaction_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Transaction"
    ADD CONSTRAINT "Transaction_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: Visit Visit_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Visit"
    ADD CONSTRAINT "Visit_pkey" PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: ai_turn_logs_business_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX ai_turn_logs_business_id_idx ON conversaflow.ai_turn_logs USING btree (business_id);


--
-- Name: ai_turn_logs_conversation_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX ai_turn_logs_conversation_id_idx ON conversaflow.ai_turn_logs USING btree (conversation_id);


--
-- Name: ai_turn_logs_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX ai_turn_logs_created_at_idx ON conversaflow.ai_turn_logs USING btree (created_at DESC);


--
-- Name: ai_turn_logs_customer_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX ai_turn_logs_customer_id_idx ON conversaflow.ai_turn_logs USING btree (customer_id);


--
-- Name: ai_turn_logs_model_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX ai_turn_logs_model_idx ON conversaflow.ai_turn_logs USING btree (model);


--
-- Name: ai_turn_logs_request_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX ai_turn_logs_request_id_idx ON conversaflow.ai_turn_logs USING btree (request_id) WHERE (request_id IS NOT NULL);


--
-- Name: ai_turn_logs_response_type_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX ai_turn_logs_response_type_idx ON conversaflow.ai_turn_logs USING btree (response_type);


--
-- Name: business_config_changes_business_id_changed_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX business_config_changes_business_id_changed_at_idx ON conversaflow.business_config_changes USING btree (business_id, changed_at DESC);


--
-- Name: businesses_expr_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE UNIQUE INDEX businesses_expr_idx ON conversaflow.businesses USING btree (((config ->> 'slack_channel_id'::text))) WHERE (COALESCE((config ->> 'slack_channel_id'::text), ''::text) <> ''::text);


--
-- Name: INDEX businesses_expr_idx; Type: COMMENT; Schema: conversaflow; Owner: -
--

COMMENT ON INDEX conversaflow.businesses_expr_idx IS 'Ensures each Slack channel maps to at most one business tenant.';


--
-- Name: conversaflow_outbox_business_created_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversaflow_outbox_business_created_idx ON conversaflow.outbox USING btree (business_id, created_at DESC);


--
-- Name: conversaflow_outbox_deliverable_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversaflow_outbox_deliverable_idx ON conversaflow.outbox USING btree (next_run_at) WHERE (state = 'pending'::text);


--
-- Name: conversaflow_outbox_job_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversaflow_outbox_job_idx ON conversaflow.outbox USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: conversation_outcomes_business_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversation_outcomes_business_id_idx ON conversaflow.conversation_outcomes USING btree (business_id);


--
-- Name: conversation_outcomes_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversation_outcomes_created_at_idx ON conversaflow.conversation_outcomes USING btree (created_at DESC);


--
-- Name: conversation_outcomes_customer_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversation_outcomes_customer_id_idx ON conversaflow.conversation_outcomes USING btree (customer_id);


--
-- Name: conversation_outcomes_outcome_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversation_outcomes_outcome_idx ON conversaflow.conversation_outcomes USING btree (outcome);


--
-- Name: conversation_turns_conversation_id_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversation_turns_conversation_id_created_at_idx ON conversaflow.conversation_turns USING btree (conversation_id, created_at DESC);


--
-- Name: conversation_turns_conversation_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE UNIQUE INDEX conversation_turns_conversation_id_idx ON conversaflow.conversation_turns USING btree (conversation_id) WHERE (status = ANY (ARRAY['buffering'::text, 'released'::text, 'processing'::text, 'clarification_needed'::text]));


--
-- Name: conversation_turns_status_hold_until_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversation_turns_status_hold_until_idx ON conversaflow.conversation_turns USING btree (status, hold_until);


--
-- Name: conversations_customer_id_business_id_status_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX conversations_customer_id_business_id_status_idx ON conversaflow.conversations USING btree (customer_id, business_id, status);


--
-- Name: customer_preferences_last_transaction_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX customer_preferences_last_transaction_at_idx ON conversaflow.customer_preferences USING btree (last_transaction_at DESC);


--
-- Name: customers_business_id_phone_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX customers_business_id_phone_idx ON conversaflow.customers USING btree (business_id, phone);


--
-- Name: daily_summaries_business_id_summary_date_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX daily_summaries_business_id_summary_date_idx ON conversaflow.daily_summaries USING btree (business_id, summary_date DESC);


--
-- Name: dashboard_users_auth_user_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX dashboard_users_auth_user_id_idx ON conversaflow.dashboard_users USING btree (auth_user_id);


--
-- Name: edge_function_logs_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX edge_function_logs_created_at_idx ON conversaflow.edge_function_logs USING btree (created_at DESC);


--
-- Name: edge_function_logs_function_name_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX edge_function_logs_function_name_idx ON conversaflow.edge_function_logs USING btree (function_name);


--
-- Name: edge_function_logs_request_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX edge_function_logs_request_id_idx ON conversaflow.edge_function_logs USING btree (request_id) WHERE (request_id IS NOT NULL);


--
-- Name: edge_function_logs_status_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX edge_function_logs_status_idx ON conversaflow.edge_function_logs USING btree (status);


--
-- Name: eval_traces_agreement_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX eval_traces_agreement_idx ON conversaflow.eval_traces USING btree (agreement, created_at DESC);


--
-- Name: eval_traces_conversation_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX eval_traces_conversation_created_at_idx ON conversaflow.eval_traces USING btree (conversation_id, created_at DESC);


--
-- Name: eval_traces_turn_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX eval_traces_turn_id_idx ON conversaflow.eval_traces USING btree (turn_id) WHERE (turn_id IS NOT NULL);


--
-- Name: inbound_events_business_id_received_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX inbound_events_business_id_received_at_idx ON conversaflow.inbound_events USING btree (business_id, received_at DESC);


--
-- Name: inbound_events_status_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX inbound_events_status_idx ON conversaflow.inbound_events USING btree (status) WHERE (status = ANY (ARRAY['accepted'::text, 'processing'::text]));


--
-- Name: jobs_aggregate_type_aggregate_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX jobs_aggregate_type_aggregate_id_idx ON conversaflow.jobs USING btree (aggregate_type, aggregate_id);


--
-- Name: jobs_business_id_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX jobs_business_id_created_at_idx ON conversaflow.jobs USING btree (business_id, created_at DESC);


--
-- Name: jobs_locked_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX jobs_locked_at_idx ON conversaflow.jobs USING btree (locked_at) WHERE (state = 'claimed'::text);


--
-- Name: jobs_priority_next_run_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX jobs_priority_next_run_at_idx ON conversaflow.jobs USING btree (priority DESC, next_run_at) WHERE (state = 'pending'::text);


--
-- Name: messages_conversation_id_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX messages_conversation_id_created_at_idx ON conversaflow.messages USING btree (conversation_id, created_at);


--
-- Name: messages_conversation_id_created_at_idx1; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX messages_conversation_id_created_at_idx1 ON conversaflow.messages USING btree (conversation_id, created_at);


--
-- Name: messages_embedding_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX messages_embedding_idx ON conversaflow.messages USING hnsw (embedding extensions.vector_cosine_ops) WITH (m='16', ef_construction='64');


--
-- Name: messages_twilio_message_sid_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE UNIQUE INDEX messages_twilio_message_sid_idx ON conversaflow.messages USING btree (twilio_message_sid) WHERE (twilio_message_sid IS NOT NULL);


--
-- Name: outbox_business_id_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX outbox_business_id_created_at_idx ON conversaflow.outbox USING btree (business_id, created_at DESC);


--
-- Name: outbox_job_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX outbox_job_id_idx ON conversaflow.outbox USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: outbox_next_run_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX outbox_next_run_at_idx ON conversaflow.outbox USING btree (next_run_at) WHERE (state = 'pending'::text);


--
-- Name: pipeline_traces_conversation_ts_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX pipeline_traces_conversation_ts_idx ON conversaflow.pipeline_traces USING btree (conversation_id, ts DESC) WHERE (conversation_id IS NOT NULL);


--
-- Name: pipeline_traces_failures_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX pipeline_traces_failures_idx ON conversaflow.pipeline_traces USING btree (ts DESC) WHERE (event = ANY (ARRAY['failed'::text, 'dead'::text]));


--
-- Name: pipeline_traces_trace_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX pipeline_traces_trace_id_idx ON conversaflow.pipeline_traces USING btree (trace_id);


--
-- Name: pipeline_traces_turn_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX pipeline_traces_turn_id_idx ON conversaflow.pipeline_traces USING btree (turn_id) WHERE (turn_id IS NOT NULL);


--
-- Name: products_business_id_available_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX products_business_id_available_idx ON conversaflow.products USING btree (business_id, available);


--
-- Name: products_name_embedding_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX products_name_embedding_idx ON conversaflow.products USING hnsw (name_embedding extensions.vector_cosine_ops) WITH (m='16', ef_construction='64');


--
-- Name: products_name_trgm_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX products_name_trgm_idx ON conversaflow.products USING gin (lower(name) extensions.gin_trgm_ops);


--
-- Name: products_zettle_uuid_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE UNIQUE INDEX products_zettle_uuid_idx ON conversaflow.products USING btree (zettle_uuid) WHERE (zettle_uuid IS NOT NULL);


--
-- Name: security_logs_event_type_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX security_logs_event_type_idx ON conversaflow.security_logs USING btree (event_type);


--
-- Name: security_logs_phone_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX security_logs_phone_idx ON conversaflow.security_logs USING btree (phone);


--
-- Name: security_logs_request_id_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX security_logs_request_id_idx ON conversaflow.security_logs USING btree (request_id) WHERE (request_id IS NOT NULL);


--
-- Name: security_logs_timestamp_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX security_logs_timestamp_idx ON conversaflow.security_logs USING btree ("timestamp" DESC);


--
-- Name: transaction_status_events_acted_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX transaction_status_events_acted_at_idx ON conversaflow.transaction_status_events USING btree (acted_at DESC);


--
-- Name: transaction_status_events_transaction_id_acted_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX transaction_status_events_transaction_id_acted_at_idx ON conversaflow.transaction_status_events USING btree (transaction_id, acted_at DESC);


--
-- Name: transactions_business_id_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: -
--

CREATE INDEX transactions_business_id_created_at_idx ON conversaflow.transactions USING btree (business_id, created_at);


--
-- Name: kds_device_sessions_business_active_idx; Type: INDEX; Schema: kds; Owner: -
--

CREATE INDEX kds_device_sessions_business_active_idx ON kds.device_sessions USING btree (business_id, is_active);


--
-- Name: kds_ticket_events_business_sequence_idx; Type: INDEX; Schema: kds; Owner: -
--

CREATE INDEX kds_ticket_events_business_sequence_idx ON kds.ticket_events USING btree (business_id, sequence);


--
-- Name: kds_ticket_events_ticket_sequence_idx; Type: INDEX; Schema: kds; Owner: -
--

CREATE INDEX kds_ticket_events_ticket_sequence_idx ON kds.ticket_events USING btree (ticket_id, sequence DESC);


--
-- Name: kds_ticket_items_ticket_idx; Type: INDEX; Schema: kds; Owner: -
--

CREATE INDEX kds_ticket_items_ticket_idx ON kds.ticket_items USING btree (ticket_id, display_order);


--
-- Name: kds_tickets_business_status_created_idx; Type: INDEX; Schema: kds; Owner: -
--

CREATE INDEX kds_tickets_business_status_created_idx ON kds.tickets USING btree (business_id, status, created_at);


--
-- Name: kds_tickets_business_updated_idx; Type: INDEX; Schema: kds; Owner: -
--

CREATE INDEX kds_tickets_business_updated_idx ON kds.tickets USING btree (business_id, updated_at DESC);


--
-- Name: business_config_changes_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_config_changes_business_id_idx ON public.business_config_changes USING btree (business_id, changed_at DESC);


--
-- Name: businesses_slack_channel_id_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX businesses_slack_channel_id_unique_idx ON public.businesses USING btree (((config ->> 'slack_channel_id'::text))) WHERE (COALESCE((config ->> 'slack_channel_id'::text), ''::text) <> ''::text);


--
-- Name: INDEX businesses_slack_channel_id_unique_idx; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.businesses_slack_channel_id_unique_idx IS 'Ensures each Slack channel maps to at most one business tenant.';


--
-- Name: conversation_turns_conversation_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_turns_conversation_created_idx ON public.conversation_turns USING btree (conversation_id, created_at DESC);


--
-- Name: conversation_turns_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX conversation_turns_one_active_idx ON public.conversation_turns USING btree (conversation_id) WHERE (status = ANY (ARRAY['buffering'::text, 'released'::text, 'processing'::text, 'clarification_needed'::text]));


--
-- Name: conversation_turns_status_hold_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_turns_status_hold_idx ON public.conversation_turns USING btree (status, hold_until);


--
-- Name: daily_summaries_business_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_summaries_business_date_idx ON public.daily_summaries USING btree (business_id, summary_date DESC);


--
-- Name: idx_ai_turn_logs_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_turn_logs_request_id ON public.ai_turn_logs USING btree (request_id) WHERE (request_id IS NOT NULL);


--
-- Name: idx_atl_business_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atl_business_id ON public.ai_turn_logs USING btree (business_id);


--
-- Name: idx_atl_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atl_conversation_id ON public.ai_turn_logs USING btree (conversation_id);


--
-- Name: idx_atl_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atl_created_at ON public.ai_turn_logs USING btree (created_at DESC);


--
-- Name: idx_atl_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atl_customer_id ON public.ai_turn_logs USING btree (customer_id);


--
-- Name: idx_atl_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atl_model ON public.ai_turn_logs USING btree (model);


--
-- Name: idx_atl_response_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atl_response_type ON public.ai_turn_logs USING btree (response_type);


--
-- Name: idx_co_business_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_co_business_id ON public.conversation_outcomes USING btree (business_id);


--
-- Name: idx_co_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_co_created_at ON public.conversation_outcomes USING btree (created_at DESC);


--
-- Name: idx_co_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_co_customer_id ON public.conversation_outcomes USING btree (customer_id);


--
-- Name: idx_co_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_co_outcome ON public.conversation_outcomes USING btree (outcome);


--
-- Name: idx_conversations_customer_business; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_customer_business ON public.conversations USING btree (customer_id, business_id, status);


--
-- Name: idx_customers_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_phone ON public.customers USING btree (business_id, phone);


--
-- Name: idx_dashboard_users_auth; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_users_auth ON public.dashboard_users USING btree (auth_user_id);


--
-- Name: idx_edge_function_logs_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_edge_function_logs_request_id ON public.edge_function_logs USING btree (request_id) WHERE (request_id IS NOT NULL);


--
-- Name: idx_efl_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_efl_created_at ON public.edge_function_logs USING btree (created_at DESC);


--
-- Name: idx_efl_function_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_efl_function_name ON public.edge_function_logs USING btree (function_name);


--
-- Name: idx_efl_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_efl_status ON public.edge_function_logs USING btree (status);


--
-- Name: idx_messages_conv_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conv_created ON public.messages USING btree (conversation_id, created_at);


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id, created_at);


--
-- Name: idx_messages_embedding_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_embedding_hnsw ON public.messages USING hnsw (embedding extensions.vector_cosine_ops) WITH (m='16', ef_construction='64');


--
-- Name: idx_messages_twilio_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_messages_twilio_sid ON public.messages USING btree (twilio_message_sid) WHERE (twilio_message_sid IS NOT NULL);


--
-- Name: idx_preferences_last_transaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_preferences_last_transaction ON public.customer_preferences USING btree (last_transaction_at DESC);


--
-- Name: idx_products_zettle_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_products_zettle_uuid ON public.products USING btree (zettle_uuid) WHERE (zettle_uuid IS NOT NULL);


--
-- Name: idx_security_logs_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_logs_event_type ON public.security_logs USING btree (event_type);


--
-- Name: idx_security_logs_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_logs_phone ON public.security_logs USING btree (phone);


--
-- Name: idx_security_logs_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_logs_request_id ON public.security_logs USING btree (request_id) WHERE (request_id IS NOT NULL);


--
-- Name: idx_security_logs_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_logs_timestamp ON public.security_logs USING btree ("timestamp" DESC);


--
-- Name: idx_services_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_available ON public.products USING btree (business_id, available);


--
-- Name: idx_transactions_business; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_business ON public.transactions USING btree (business_id, created_at);


--
-- Name: inbound_events_business_received_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbound_events_business_received_idx ON public.inbound_events USING btree (business_id, received_at DESC);


--
-- Name: inbound_events_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbound_events_status_idx ON public.inbound_events USING btree (status) WHERE (status = ANY (ARRAY['accepted'::text, 'processing'::text]));


--
-- Name: jobs_aggregate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_aggregate_idx ON public.jobs USING btree (aggregate_type, aggregate_id);


--
-- Name: jobs_business_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_business_created_idx ON public.jobs USING btree (business_id, created_at DESC);


--
-- Name: jobs_claimable_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_claimable_idx ON public.jobs USING btree (priority DESC, next_run_at) WHERE (state = 'pending'::text);


--
-- Name: jobs_locked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_locked_idx ON public.jobs USING btree (locked_at) WHERE (state = 'claimed'::text);


--
-- Name: outbox_business_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_business_created_idx ON public.outbox USING btree (business_id, created_at DESC);


--
-- Name: outbox_deliverable_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_deliverable_idx ON public.outbox USING btree (next_run_at) WHERE (state = 'pending'::text);


--
-- Name: outbox_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_job_idx ON public.outbox USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: pipeline_traces_conversation_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_traces_conversation_ts_idx ON public.pipeline_traces USING btree (conversation_id, ts DESC) WHERE (conversation_id IS NOT NULL);


--
-- Name: pipeline_traces_failures_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_traces_failures_idx ON public.pipeline_traces USING btree (ts DESC) WHERE (event = ANY (ARRAY['failed'::text, 'dead'::text]));


--
-- Name: pipeline_traces_trace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_traces_trace_id_idx ON public.pipeline_traces USING btree (trace_id);


--
-- Name: pipeline_traces_turn_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_traces_turn_id_idx ON public.pipeline_traces USING btree (turn_id) WHERE (turn_id IS NOT NULL);


--
-- Name: products_name_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_name_embedding_idx ON public.products USING hnsw (name_embedding extensions.vector_cosine_ops) WITH (m='16', ef_construction='64');


--
-- Name: transaction_status_events_acted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transaction_status_events_acted_at_idx ON public.transaction_status_events USING btree (acted_at DESC);


--
-- Name: transaction_status_events_txn_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transaction_status_events_txn_idx ON public.transaction_status_events USING btree (transaction_id, acted_at DESC);


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: messages_inserted_at_topic_index; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_06_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_05_06_inserted_at_topic_idx ON realtime.messages_2026_05_06 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_07_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_05_07_inserted_at_topic_idx ON realtime.messages_2026_05_07 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_08_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_05_08_inserted_at_topic_idx ON realtime.messages_2026_05_08 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_09_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_05_09_inserted_at_topic_idx ON realtime.messages_2026_05_09 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_10_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_05_10_inserted_at_topic_idx ON realtime.messages_2026_05_10 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: subscription_subscription_id_entity_filters_action_filter_key; Type: INDEX; Schema: realtime; Owner: -
--

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_key ON realtime.subscription USING btree (subscription_id, entity, filters, action_filter);


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: GiftCard_code_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "GiftCard_code_idx" ON umi_cash."GiftCard" USING btree (code);


--
-- Name: GiftCard_tenantId_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "GiftCard_tenantId_idx" ON umi_cash."GiftCard" USING btree ("tenantId");


--
-- Name: GiftCard_tenantId_isRedeemed_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "GiftCard_tenantId_isRedeemed_idx" ON umi_cash."GiftCard" USING btree ("tenantId", "isRedeemed");


--
-- Name: Location_tenantId_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "Location_tenantId_idx" ON umi_cash."Location" USING btree ("tenantId");


--
-- Name: LoyaltyCard_tenantId_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "LoyaltyCard_tenantId_idx" ON umi_cash."LoyaltyCard" USING btree ("tenantId");


--
-- Name: RewardConfig_tenantId_isActive_activatedAt_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "RewardConfig_tenantId_isActive_activatedAt_idx" ON umi_cash."RewardConfig" USING btree ("tenantId", "isActive", "activatedAt");


--
-- Name: RewardRedemption_cardId_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "RewardRedemption_cardId_idx" ON umi_cash."RewardRedemption" USING btree ("cardId");


--
-- Name: Session_token_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "Session_token_idx" ON umi_cash."Session" USING btree (token);


--
-- Name: Transaction_cardId_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "Transaction_cardId_idx" ON umi_cash."Transaction" USING btree ("cardId");


--
-- Name: Transaction_cardId_type_createdAt_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "Transaction_cardId_type_createdAt_idx" ON umi_cash."Transaction" USING btree ("cardId", type, "createdAt");


--
-- Name: Transaction_createdAt_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "Transaction_createdAt_idx" ON umi_cash."Transaction" USING btree ("createdAt");


--
-- Name: Transaction_staffId_type_createdAt_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "Transaction_staffId_type_createdAt_idx" ON umi_cash."Transaction" USING btree ("staffId", type, "createdAt");


--
-- Name: User_tenantId_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "User_tenantId_idx" ON umi_cash."User" USING btree ("tenantId");


--
-- Name: User_tenantId_role_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "User_tenantId_role_idx" ON umi_cash."User" USING btree ("tenantId", role);


--
-- Name: Visit_cardId_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "Visit_cardId_idx" ON umi_cash."Visit" USING btree ("cardId");


--
-- Name: Visit_cardId_scannedAt_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "Visit_cardId_scannedAt_idx" ON umi_cash."Visit" USING btree ("cardId", "scannedAt");


--
-- Name: Visit_scannedAt_idx; Type: INDEX; Schema: umi_cash; Owner: -
--

CREATE INDEX "Visit_scannedAt_idx" ON umi_cash."Visit" USING btree ("scannedAt");


--
-- Name: messages_2026_05_06_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_06_inserted_at_topic_idx;


--
-- Name: messages_2026_05_06_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_06_pkey;


--
-- Name: messages_2026_05_07_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_07_inserted_at_topic_idx;


--
-- Name: messages_2026_05_07_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_07_pkey;


--
-- Name: messages_2026_05_08_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_08_inserted_at_topic_idx;


--
-- Name: messages_2026_05_08_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_08_pkey;


--
-- Name: messages_2026_05_09_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_09_inserted_at_topic_idx;


--
-- Name: messages_2026_05_09_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_09_pkey;


--
-- Name: messages_2026_05_10_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_10_inserted_at_topic_idx;


--
-- Name: messages_2026_05_10_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_10_pkey;


--
-- Name: transactions trg_kds_project_transaction; Type: TRIGGER; Schema: conversaflow; Owner: -
--

CREATE TRIGGER trg_kds_project_transaction AFTER INSERT OR UPDATE OF status, details, total_amount ON conversaflow.transactions FOR EACH ROW EXECUTE FUNCTION kds.project_transaction_trigger();


--
-- Name: jobs trg_wake_job_worker; Type: TRIGGER; Schema: conversaflow; Owner: -
--

CREATE TRIGGER trg_wake_job_worker AFTER INSERT ON conversaflow.jobs FOR EACH ROW WHEN (((new.state = 'pending'::text) AND (new.priority >= 100))) EXECUTE FUNCTION conversaflow.wake_job_worker_on_insert();


--
-- Name: transactions on_transaction_completed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_transaction_completed AFTER INSERT ON public.transactions FOR EACH ROW WHEN ((new.status = 'completed'::text)) EXECUTE FUNCTION public.update_customer_prefs();


--
-- Name: products products_embedding_invalidate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_embedding_invalidate BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.products_invalidate_embedding();


--
-- Name: zettle_oauth_tokens update_zettle_oauth_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_zettle_oauth_tokens_updated_at BEFORE UPDATE ON public.zettle_oauth_tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: -
--

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ai_turn_logs ai_turn_logs_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.ai_turn_logs
    ADD CONSTRAINT ai_turn_logs_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: ai_turn_logs ai_turn_logs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.ai_turn_logs
    ADD CONSTRAINT ai_turn_logs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversaflow.conversations(id);


--
-- Name: ai_turn_logs ai_turn_logs_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.ai_turn_logs
    ADD CONSTRAINT ai_turn_logs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES conversaflow.customers(id);


--
-- Name: conversation_outcomes conversation_outcomes_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: conversation_outcomes conversation_outcomes_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversaflow.conversations(id);


--
-- Name: conversation_outcomes conversation_outcomes_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES conversaflow.customers(id);


--
-- Name: conversation_turns conversation_turns_assistant_message_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_turns
    ADD CONSTRAINT conversation_turns_assistant_message_id_fkey FOREIGN KEY (assistant_message_id) REFERENCES conversaflow.messages(id);


--
-- Name: conversation_turns conversation_turns_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_turns
    ADD CONSTRAINT conversation_turns_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: conversation_turns conversation_turns_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_turns
    ADD CONSTRAINT conversation_turns_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversaflow.conversations(id);


--
-- Name: conversation_turns conversation_turns_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversation_turns
    ADD CONSTRAINT conversation_turns_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES conversaflow.customers(id);


--
-- Name: conversations conversations_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversations
    ADD CONSTRAINT conversations_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: conversations conversations_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.conversations
    ADD CONSTRAINT conversations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES conversaflow.customers(id);


--
-- Name: customer_preferences customer_preferences_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.customer_preferences
    ADD CONSTRAINT customer_preferences_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES conversaflow.customers(id);


--
-- Name: customers customers_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.customers
    ADD CONSTRAINT customers_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: dashboard_users dashboard_users_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.dashboard_users
    ADD CONSTRAINT dashboard_users_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: inbound_events inbound_events_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.inbound_events
    ADD CONSTRAINT inbound_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: job_attempts job_attempts_job_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.job_attempts
    ADD CONSTRAINT job_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES conversaflow.jobs(id) ON DELETE CASCADE;


--
-- Name: jobs jobs_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.jobs
    ADD CONSTRAINT jobs_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: jobs jobs_inbound_event_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.jobs
    ADD CONSTRAINT jobs_inbound_event_id_fkey FOREIGN KEY (inbound_event_id) REFERENCES conversaflow.inbound_events(id);


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversaflow.conversations(id);


--
-- Name: outbox outbox_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.outbox
    ADD CONSTRAINT outbox_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: outbox outbox_job_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.outbox
    ADD CONSTRAINT outbox_job_id_fkey FOREIGN KEY (job_id) REFERENCES conversaflow.jobs(id);


--
-- Name: products services_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.products
    ADD CONSTRAINT services_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: transaction_status_events transaction_status_events_transaction_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.transaction_status_events
    ADD CONSTRAINT transaction_status_events_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES conversaflow.transactions(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.transactions
    ADD CONSTRAINT transactions_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: transactions transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.transactions
    ADD CONSTRAINT transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES conversaflow.customers(id);


--
-- Name: transactions transactions_service_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.transactions
    ADD CONSTRAINT transactions_service_id_fkey FOREIGN KEY (service_id) REFERENCES conversaflow.products(id);


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: -
--

ALTER TABLE ONLY conversaflow.zettle_oauth_tokens
    ADD CONSTRAINT zettle_oauth_tokens_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id);


--
-- Name: device_sessions device_sessions_business_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.device_sessions
    ADD CONSTRAINT device_sessions_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id) ON DELETE CASCADE;


--
-- Name: ticket_events ticket_events_business_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_events
    ADD CONSTRAINT ticket_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id) ON DELETE CASCADE;


--
-- Name: ticket_events ticket_events_source_transaction_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_events
    ADD CONSTRAINT ticket_events_source_transaction_id_fkey FOREIGN KEY (source_transaction_id) REFERENCES conversaflow.transactions(id) ON DELETE CASCADE;


--
-- Name: ticket_events ticket_events_ticket_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_events
    ADD CONSTRAINT ticket_events_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES kds.tickets(ticket_id) ON DELETE CASCADE;


--
-- Name: ticket_items ticket_items_source_transaction_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_items
    ADD CONSTRAINT ticket_items_source_transaction_id_fkey FOREIGN KEY (source_transaction_id) REFERENCES conversaflow.transactions(id) ON DELETE CASCADE;


--
-- Name: ticket_items ticket_items_ticket_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.ticket_items
    ADD CONSTRAINT ticket_items_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES kds.tickets(ticket_id) ON DELETE CASCADE;


--
-- Name: tickets tickets_business_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_business_id_fkey FOREIGN KEY (business_id) REFERENCES conversaflow.businesses(id) ON DELETE CASCADE;


--
-- Name: tickets tickets_customer_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES conversaflow.customers(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_source_transaction_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: -
--

ALTER TABLE ONLY kds.tickets
    ADD CONSTRAINT tickets_source_transaction_id_fkey FOREIGN KEY (source_transaction_id) REFERENCES conversaflow.transactions(id) ON DELETE CASCADE;


--
-- Name: ai_turn_logs ai_turn_logs_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_turn_logs
    ADD CONSTRAINT ai_turn_logs_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE SET NULL;


--
-- Name: ai_turn_logs ai_turn_logs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_turn_logs
    ADD CONSTRAINT ai_turn_logs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: ai_turn_logs ai_turn_logs_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_turn_logs
    ADD CONSTRAINT ai_turn_logs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: conversation_outcomes conversation_outcomes_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE SET NULL;


--
-- Name: conversation_outcomes conversation_outcomes_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: conversation_outcomes conversation_outcomes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: conversation_turns conversation_turns_assistant_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turns
    ADD CONSTRAINT conversation_turns_assistant_message_id_fkey FOREIGN KEY (assistant_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: conversation_turns conversation_turns_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turns
    ADD CONSTRAINT conversation_turns_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: conversation_turns conversation_turns_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turns
    ADD CONSTRAINT conversation_turns_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_turns conversation_turns_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turns
    ADD CONSTRAINT conversation_turns_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: conversations conversations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: customer_preferences customer_preferences_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_preferences
    ADD CONSTRAINT customer_preferences_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customers customers_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: dashboard_users dashboard_users_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: dashboard_users dashboard_users_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: inbound_events inbound_events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_events
    ADD CONSTRAINT inbound_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: job_attempts job_attempts_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_attempts
    ADD CONSTRAINT job_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


--
-- Name: jobs jobs_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: jobs jobs_inbound_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_inbound_event_id_fkey FOREIGN KEY (inbound_event_id) REFERENCES public.inbound_events(id);


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: outbox outbox_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: outbox outbox_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;


--
-- Name: products services_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT services_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: transaction_status_events transaction_status_events_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_status_events
    ADD CONSTRAINT transaction_status_events_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: transactions transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: transactions transactions_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.products(id);


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zettle_oauth_tokens
    ADD CONSTRAINT zettle_oauth_tokens_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: ApplePushToken ApplePushToken_cardId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."ApplePushToken"
    ADD CONSTRAINT "ApplePushToken_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES umi_cash."LoyaltyCard"(id) ON DELETE CASCADE;


--
-- Name: GiftCard GiftCard_createdByStaffId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."GiftCard"
    ADD CONSTRAINT "GiftCard_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES umi_cash."User"(id);


--
-- Name: GiftCard GiftCard_redeemedCardId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."GiftCard"
    ADD CONSTRAINT "GiftCard_redeemedCardId_fkey" FOREIGN KEY ("redeemedCardId") REFERENCES umi_cash."LoyaltyCard"(id);


--
-- Name: GiftCard GiftCard_tenantId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."GiftCard"
    ADD CONSTRAINT "GiftCard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES umi_cash."Tenant"(id) ON DELETE CASCADE;


--
-- Name: Location Location_tenantId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Location"
    ADD CONSTRAINT "Location_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES umi_cash."Tenant"(id) ON DELETE CASCADE;


--
-- Name: LoyaltyCard LoyaltyCard_tenantId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES umi_cash."Tenant"(id);


--
-- Name: LoyaltyCard LoyaltyCard_userId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES umi_cash."User"(id) ON DELETE CASCADE;


--
-- Name: RewardConfig RewardConfig_tenantId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."RewardConfig"
    ADD CONSTRAINT "RewardConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES umi_cash."Tenant"(id);


--
-- Name: RewardRedemption RewardRedemption_cardId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."RewardRedemption"
    ADD CONSTRAINT "RewardRedemption_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES umi_cash."LoyaltyCard"(id);


--
-- Name: RewardRedemption RewardRedemption_configId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."RewardRedemption"
    ADD CONSTRAINT "RewardRedemption_configId_fkey" FOREIGN KEY ("configId") REFERENCES umi_cash."RewardConfig"(id);


--
-- Name: RewardRedemption RewardRedemption_staffId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."RewardRedemption"
    ADD CONSTRAINT "RewardRedemption_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES umi_cash."User"(id);


--
-- Name: Session Session_userId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Session"
    ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES umi_cash."User"(id) ON DELETE CASCADE;


--
-- Name: Transaction Transaction_cardId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Transaction"
    ADD CONSTRAINT "Transaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES umi_cash."LoyaltyCard"(id);


--
-- Name: Transaction Transaction_staffId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Transaction"
    ADD CONSTRAINT "Transaction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES umi_cash."User"(id);


--
-- Name: User User_tenantId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."User"
    ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES umi_cash."Tenant"(id);


--
-- Name: Visit Visit_cardId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Visit"
    ADD CONSTRAINT "Visit_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES umi_cash."LoyaltyCard"(id);


--
-- Name: Visit Visit_staffId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: -
--

ALTER TABLE ONLY umi_cash."Visit"
    ADD CONSTRAINT "Visit_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES umi_cash."User"(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_turn_logs; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.ai_turn_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_turn_logs ai_turn_logs_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY ai_turn_logs_member_select ON conversaflow.ai_turn_logs FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: business_config_changes; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.business_config_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: business_config_changes business_config_changes_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY business_config_changes_member_select ON conversaflow.business_config_changes FOR SELECT TO authenticated USING (public.user_has_business_access_text(business_id));


--
-- Name: businesses; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.businesses ENABLE ROW LEVEL SECURITY;

--
-- Name: businesses businesses_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY businesses_member_select ON conversaflow.businesses FOR SELECT TO authenticated USING (public.user_has_business_access(id));


--
-- Name: conversation_outcomes; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.conversation_outcomes ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_outcomes conversation_outcomes_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY conversation_outcomes_member_select ON conversaflow.conversation_outcomes FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: conversation_turns; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.conversation_turns ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_turns conversation_turns_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY conversation_turns_member_select ON conversaflow.conversation_turns FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: conversations; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations conversations_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY conversations_member_select ON conversaflow.conversations FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: customer_preferences; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.customer_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_preferences customer_preferences_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY customer_preferences_member_select ON conversaflow.customer_preferences FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM conversaflow.customers c
  WHERE ((c.id = customer_preferences.customer_id) AND public.user_has_business_access(c.business_id)))));


--
-- Name: customers; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY customers_member_select ON conversaflow.customers FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: daily_summaries; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.daily_summaries ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_summaries daily_summaries_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY daily_summaries_member_select ON conversaflow.daily_summaries FOR SELECT TO authenticated USING (public.user_has_business_access_text(business_id));


--
-- Name: dashboard_users; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.dashboard_users ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_users dashboard_users_self_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY dashboard_users_self_select ON conversaflow.dashboard_users FOR SELECT TO authenticated USING ((auth.uid() = auth_user_id));


--
-- Name: edge_function_logs; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.edge_function_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: edge_function_logs edge_function_logs_no_direct_access; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY edge_function_logs_no_direct_access ON conversaflow.edge_function_logs FOR SELECT TO authenticated USING (false);


--
-- Name: inbound_events; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.inbound_events ENABLE ROW LEVEL SECURITY;

--
-- Name: inbound_events inbound_events_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY inbound_events_member_select ON conversaflow.inbound_events FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: job_attempts; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.job_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: job_attempts job_attempts_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY job_attempts_member_select ON conversaflow.job_attempts FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM conversaflow.jobs j
  WHERE ((j.id = job_attempts.job_id) AND public.user_has_business_access(j.business_id)))));


--
-- Name: jobs; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: jobs jobs_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY jobs_member_select ON conversaflow.jobs FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: messages; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY messages_member_select ON conversaflow.messages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM conversaflow.conversations c
  WHERE ((c.id = messages.conversation_id) AND public.user_has_business_access(c.business_id)))));


--
-- Name: outbox; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: outbox outbox_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY outbox_member_select ON conversaflow.outbox FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: products; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products products_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY products_member_select ON conversaflow.products FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: security_logs; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.security_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: security_logs security_logs_no_direct_access; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY security_logs_no_direct_access ON conversaflow.security_logs FOR SELECT TO authenticated USING (false);


--
-- Name: transaction_status_events; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.transaction_status_events ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_status_events transaction_status_events_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY transaction_status_events_member_select ON conversaflow.transaction_status_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM conversaflow.transactions t
  WHERE ((t.id = transaction_status_events.transaction_id) AND public.user_has_business_access(t.business_id)))));


--
-- Name: transactions; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions transactions_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY transactions_member_select ON conversaflow.transactions FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: zettle_oauth_tokens; Type: ROW SECURITY; Schema: conversaflow; Owner: -
--

ALTER TABLE conversaflow.zettle_oauth_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_member_select; Type: POLICY; Schema: conversaflow; Owner: -
--

CREATE POLICY zettle_oauth_tokens_member_select ON conversaflow.zettle_oauth_tokens FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: ticket_events kds_ticket_events_member_select; Type: POLICY; Schema: kds; Owner: -
--

CREATE POLICY kds_ticket_events_member_select ON kds.ticket_events FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: ticket_items kds_ticket_items_member_select; Type: POLICY; Schema: kds; Owner: -
--

CREATE POLICY kds_ticket_items_member_select ON kds.ticket_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM kds.tickets t
  WHERE ((t.ticket_id = ticket_items.ticket_id) AND public.user_has_business_access(t.business_id)))));


--
-- Name: tickets kds_tickets_member_select; Type: POLICY; Schema: kds; Owner: -
--

CREATE POLICY kds_tickets_member_select ON kds.tickets FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: ticket_events; Type: ROW SECURITY; Schema: kds; Owner: -
--

ALTER TABLE kds.ticket_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ticket_items; Type: ROW SECURITY; Schema: kds; Owner: -
--

ALTER TABLE kds.ticket_items ENABLE ROW LEVEL SECURITY;

--
-- Name: tickets; Type: ROW SECURITY; Schema: kds; Owner: -
--

ALTER TABLE kds.tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_turn_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_turn_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_turn_logs ai_turn_logs_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_turn_logs_member_select ON public.ai_turn_logs FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: business_config_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_config_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: business_config_changes business_config_changes_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY business_config_changes_member_select ON public.business_config_changes FOR SELECT TO authenticated USING (public.user_has_business_access_text(business_id));


--
-- Name: businesses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

--
-- Name: businesses businesses_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY businesses_member_select ON public.businesses FOR SELECT TO authenticated USING (public.user_has_business_access(id));


--
-- Name: conversation_outcomes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_outcomes ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_outcomes conversation_outcomes_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_outcomes_member_select ON public.conversation_outcomes FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: conversation_turns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_turns ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_turns conversation_turns_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_turns_member_select ON public.conversation_turns FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations conversations_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_member_select ON public.conversations FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: customer_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_preferences customer_preferences_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_preferences_member_select ON public.customer_preferences FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.customers c
  WHERE ((c.id = customer_preferences.customer_id) AND public.user_has_business_access(c.business_id)))));


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_member_select ON public.customers FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: daily_summaries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_summaries daily_summaries_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_summaries_member_select ON public.daily_summaries FOR SELECT TO authenticated USING (public.user_has_business_access_text(business_id));


--
-- Name: dashboard_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_users ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_users dashboard_users_self_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dashboard_users_self_select ON public.dashboard_users FOR SELECT TO authenticated USING ((auth.uid() = auth_user_id));


--
-- Name: edge_function_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.edge_function_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: edge_function_logs edge_function_logs_no_direct_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY edge_function_logs_no_direct_access ON public.edge_function_logs FOR SELECT TO authenticated USING (false);


--
-- Name: inbound_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inbound_events ENABLE ROW LEVEL SECURITY;

--
-- Name: inbound_events inbound_events_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inbound_events_member_select ON public.inbound_events FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: job_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: job_attempts job_attempts_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_attempts_member_select ON public.job_attempts FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = job_attempts.job_id) AND public.user_has_business_access(j.business_id)))));


--
-- Name: jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: jobs jobs_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jobs_member_select ON public.jobs FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_member_select ON public.messages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = messages.conversation_id) AND public.user_has_business_access(c.business_id)))));


--
-- Name: outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: outbox outbox_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outbox_member_select ON public.outbox FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products products_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_member_select ON public.products FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: security_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: security_logs security_logs_no_direct_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY security_logs_no_direct_access ON public.security_logs FOR SELECT TO authenticated USING (false);


--
-- Name: transaction_status_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transaction_status_events ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_status_events transaction_status_events_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transaction_status_events_member_select ON public.transaction_status_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.transactions t
  WHERE ((t.id = transaction_status_events.transaction_id) AND public.user_has_business_access(t.business_id)))));


--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions transactions_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_member_select ON public.transactions FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: zettle_oauth_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zettle_oauth_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY zettle_oauth_tokens_member_select ON public.zettle_oauth_tokens FOR SELECT TO authenticated USING (public.user_has_business_access(business_id));


--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: -
--

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime_messages_publication; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime_messages_publication WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime_messages_publication messages; Type: PUBLICATION TABLE; Schema: realtime; Owner: -
--

ALTER PUBLICATION supabase_realtime_messages_publication ADD TABLE ONLY realtime.messages;


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


--
-- PostgreSQL database dump complete
--

\unrestrict 47SlS4acJaaCmhxKFXcspHL7KYT2FvjTo2A3L2j6dtMKGusm5aOepAGnPSV8dn5

