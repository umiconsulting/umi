--
-- PostgreSQL database dump
--

\restrict sVGAs0ciDdtBNbPDQzsg1DS0IIOQ1XIyZT3cA6a4RFGtjRE2zroGSsuTJRZOheF

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

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
-- Name: conversaflow; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA "conversaflow";


ALTER SCHEMA "conversaflow" OWNER TO "postgres";

--
-- Name: pg_cron; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";


--
-- Name: EXTENSION "pg_cron"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "pg_cron" IS 'Job scheduler for PostgreSQL';


--
-- Name: kds; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA "kds";


ALTER SCHEMA "kds" OWNER TO "postgres";

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: pg_net; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";


--
-- Name: EXTENSION "pg_net"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "pg_net" IS 'Async HTTP';


--
-- Name: platform; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA "platform";


ALTER SCHEMA "platform" OWNER TO "postgres";

--
-- Name: umi_cash; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA "umi_cash";


ALTER SCHEMA "umi_cash" OWNER TO "postgres";

--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pg_stat_statements"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "pg_stat_statements" IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pg_trgm"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "pg_trgm" IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pgcrypto"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "pgcrypto" IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";


--
-- Name: EXTENSION "supabase_vault"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "supabase_vault" IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "vector"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "vector" IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: cancel_reason_code; Type: TYPE; Schema: kds; Owner: postgres
--

CREATE TYPE "kds"."cancel_reason_code" AS ENUM (
    'out_of_stock',
    'kitchen_overload',
    'closing_soon',
    'customer_no_show',
    'duplicate_order',
    'other'
);


ALTER TYPE "kds"."cancel_reason_code" OWNER TO "postgres";

--
-- Name: ticket_event_kind; Type: TYPE; Schema: kds; Owner: postgres
--

CREATE TYPE "kds"."ticket_event_kind" AS ENUM (
    'snapshot_reconciled',
    'order_upserted',
    'status_changed',
    'order_removed'
);


ALTER TYPE "kds"."ticket_event_kind" OWNER TO "postgres";

--
-- Name: ticket_status; Type: TYPE; Schema: kds; Owner: postgres
--

CREATE TYPE "kds"."ticket_status" AS ENUM (
    'new',
    'accepted',
    'preparing',
    'ready',
    'completed',
    'cancelled',
    'partial_cancelled'
);


ALTER TYPE "kds"."ticket_status" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: jobs; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inbound_event_id" "uuid",
    "business_id" "uuid" NOT NULL,
    "job_type" "text" NOT NULL,
    "aggregate_type" "text",
    "aggregate_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" smallint DEFAULT 0 NOT NULL,
    "max_attempts" smallint DEFAULT 3 NOT NULL,
    "attempt_count" smallint DEFAULT 0 NOT NULL,
    "next_run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "completed_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "jobs_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'claimed'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'dead'::"text"])))
);


ALTER TABLE "conversaflow"."jobs" OWNER TO "postgres";

--
-- Name: COLUMN "jobs"."inbound_event_id"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."jobs"."inbound_event_id" IS 'The inbound event that triggered this job. NULL for cron-originated or child jobs spawned by another job.';


--
-- Name: COLUMN "jobs"."job_type"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."jobs"."job_type" IS 'Job type identifier matching a processor function. E.g. ''conversation.process'', ''message.embed'', ''order.create''. See ARCHITECTURE_TARGET.md §3 for full catalog.';


--
-- Name: COLUMN "jobs"."aggregate_type"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."jobs"."aggregate_type" IS 'Domain aggregate this job operates on: ''conversation'', ''transaction'', ''business'', ''customer'', ''message''.';


--
-- Name: COLUMN "jobs"."aggregate_id"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."jobs"."aggregate_id" IS 'Primary key of the aggregate (conversation_id, order_id, business_id, etc.). Used to detect concurrent jobs on the same aggregate.';


--
-- Name: COLUMN "jobs"."state"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."jobs"."state" IS 'Job lifecycle state. ''dead'' means all retry attempts exhausted — requires operator review.';


--
-- Name: COLUMN "jobs"."priority"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."jobs"."priority" IS 'Higher value = claimed sooner. 0 = normal priority. Use sparingly to avoid priority inversion.';


--
-- Name: COLUMN "jobs"."locked_by"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."jobs"."locked_by" IS 'Worker instance UUID that claimed this job. Used for stale lock detection — if locked_at is >2 minutes old and state is ''claimed'', the job is reset to ''pending''.';


--
-- Name: claim_next_job("text"); Type: FUNCTION; Schema: conversaflow; Owner: postgres
--

CREATE FUNCTION "conversaflow"."claim_next_job"("p_worker_id" "text") RETURNS SETOF "conversaflow"."jobs"
    LANGUAGE "sql"
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


ALTER FUNCTION "conversaflow"."claim_next_job"("p_worker_id" "text") OWNER TO "postgres";

--
-- Name: outbox; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid",
    "business_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "aggregate_id" "uuid",
    "idempotency_key" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" smallint DEFAULT 0 NOT NULL,
    "max_attempts" smallint DEFAULT 5 NOT NULL,
    "next_run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "delivered_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "outbox_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'delivering'::"text", 'delivered'::"text", 'failed'::"text", 'dead'::"text"])))
);


ALTER TABLE "conversaflow"."outbox" OWNER TO "postgres";

--
-- Name: COLUMN "outbox"."job_id"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."outbox"."job_id" IS 'Optional link to conversaflow.jobs; NULL for RPC-enqueued rows (e.g. KDS status).';


--
-- Name: COLUMN "outbox"."kind"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."outbox"."kind" IS 'Delivery adapter identifier. E.g. ''twilio.reply'', ''slack.new_order'', ''voyage.embed''. See ARCHITECTURE_TARGET.md §4 for full catalog.';


--
-- Name: COLUMN "outbox"."aggregate_id"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."outbox"."aggregate_id" IS 'Domain object this side effect relates to (order_id, conversation_id, etc.). For debugging and dashboard filtering.';


--
-- Name: COLUMN "outbox"."idempotency_key"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."outbox"."idempotency_key" IS 'Globally unique key for deduplication. Pattern: ''{kind}:{domain_id}'' e.g. ''twilio_reply:{message_id}'', ''slack_order:{order_id}''. Prevents duplicate delivery if a job retries and re-inserts the same outbox row.';


--
-- Name: COLUMN "outbox"."state"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."outbox"."state" IS 'Delivery lifecycle: pending → delivering → delivered/failed. ''dead'' means max_attempts exhausted — requires operator review.';


--
-- Name: claim_outbox_batch("text", integer); Type: FUNCTION; Schema: conversaflow; Owner: postgres
--

CREATE FUNCTION "conversaflow"."claim_outbox_batch"("p_worker_id" "text", "p_limit" integer DEFAULT 5) RETURNS SETOF "conversaflow"."outbox"
    LANGUAGE "sql"
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


ALTER FUNCTION "conversaflow"."claim_outbox_batch"("p_worker_id" "text", "p_limit" integer) OWNER TO "postgres";

--
-- Name: reclaim_stale_jobs(); Type: FUNCTION; Schema: conversaflow; Owner: postgres
--

CREATE FUNCTION "conversaflow"."reclaim_stale_jobs"() RETURNS integer
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "conversaflow"."reclaim_stale_jobs"() OWNER TO "postgres";

--
-- Name: reclaim_stale_outbox(); Type: FUNCTION; Schema: conversaflow; Owner: postgres
--

CREATE FUNCTION "conversaflow"."reclaim_stale_outbox"() RETURNS integer
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "conversaflow"."reclaim_stale_outbox"() OWNER TO "postgres";

--
-- Name: search_customer_messages("uuid", "uuid", "uuid", "text", integer, integer, "text"[]); Type: FUNCTION; Schema: conversaflow; Owner: postgres
--

CREATE FUNCTION "conversaflow"."search_customer_messages"("p_customer_id" "uuid", "p_business_id" "uuid", "p_current_conversation_id" "uuid", "p_embedding" "text", "p_limit" integer DEFAULT 5, "p_exclude_recent" integer DEFAULT 8, "p_roles" "text"[] DEFAULT ARRAY['user'::"text"]) RETURNS TABLE("id" "uuid", "conversation_id" "uuid", "role" "text", "content" "text", "created_at" timestamp with time zone, "similarity" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'conversaflow', 'extensions'
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


ALTER FUNCTION "conversaflow"."search_customer_messages"("p_customer_id" "uuid", "p_business_id" "uuid", "p_current_conversation_id" "uuid", "p_embedding" "text", "p_limit" integer, "p_exclude_recent" integer, "p_roles" "text"[]) OWNER TO "postgres";

--
-- Name: FUNCTION "search_customer_messages"("p_customer_id" "uuid", "p_business_id" "uuid", "p_current_conversation_id" "uuid", "p_embedding" "text", "p_limit" integer, "p_exclude_recent" integer, "p_roles" "text"[]); Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON FUNCTION "conversaflow"."search_customer_messages"("p_customer_id" "uuid", "p_business_id" "uuid", "p_current_conversation_id" "uuid", "p_embedding" "text", "p_limit" integer, "p_exclude_recent" integer, "p_roles" "text"[]) IS 'Customer-scoped semantic memory search for conversational recall. Uses Voyage/pgvector message embeddings across all conversations for the same customer and business.';


--
-- Name: search_products_by_embedding("uuid", "extensions"."vector", integer, double precision); Type: FUNCTION; Schema: conversaflow; Owner: postgres
--

CREATE FUNCTION "conversaflow"."search_products_by_embedding"("p_business_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer DEFAULT 5, "p_threshold" double precision DEFAULT 0.65) RETURNS TABLE("id" "uuid", "name" "text", "price" numeric, "description" "text", "category" "text", "variants" "jsonb", "similarity" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'conversaflow', 'extensions'
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


ALTER FUNCTION "conversaflow"."search_products_by_embedding"("p_business_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer, "p_threshold" double precision) OWNER TO "postgres";

--
-- Name: search_products_text("uuid", "text", integer); Type: FUNCTION; Schema: conversaflow; Owner: postgres
--

CREATE FUNCTION "conversaflow"."search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "name" "text", "price" numeric, "description" "text", "category" "text", "variants" "jsonb")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'conversaflow', 'extensions'
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


ALTER FUNCTION "conversaflow"."search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer) OWNER TO "postgres";

--
-- Name: search_similar_messages("uuid", "text", integer, integer); Type: FUNCTION; Schema: conversaflow; Owner: postgres
--

CREATE FUNCTION "conversaflow"."search_similar_messages"("p_conversation_id" "uuid", "p_embedding" "text", "p_limit" integer DEFAULT 5, "p_exclude_recent" integer DEFAULT 8) RETURNS TABLE("id" "uuid", "role" "text", "content" "text", "similarity" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'conversaflow', 'extensions'
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


ALTER FUNCTION "conversaflow"."search_similar_messages"("p_conversation_id" "uuid", "p_embedding" "text", "p_limit" integer, "p_exclude_recent" integer) OWNER TO "postgres";

--
-- Name: wake_job_worker_on_insert(); Type: FUNCTION; Schema: conversaflow; Owner: postgres
--

CREATE FUNCTION "conversaflow"."wake_job_worker_on_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "conversaflow"."wake_job_worker_on_insert"() OWNER TO "postgres";

--
-- Name: assert_transition("kds"."ticket_status", "kds"."ticket_status"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."assert_transition"("p_from" "kds"."ticket_status", "p_to" "kds"."ticket_status") RETURNS "void"
    LANGUAGE "plpgsql" IMMUTABLE
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


ALTER FUNCTION "kds"."assert_transition"("p_from" "kds"."ticket_status", "p_to" "kds"."ticket_status") OWNER TO "postgres";

--
-- Name: backfill_from_conversaflow(); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."backfill_from_conversaflow"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."backfill_from_conversaflow"() OWNER TO "postgres";

--
-- Name: FUNCTION "backfill_from_conversaflow"(); Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON FUNCTION "kds"."backfill_from_conversaflow"() IS 'Idempotent initial KDS population from the conversaflow operational schema. Emits one snapshot_reconciled event per projected order.';


--
-- Name: cancel_reason_label("kds"."cancel_reason_code"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."cancel_reason_label"("p_code" "kds"."cancel_reason_code") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
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


ALTER FUNCTION "kds"."cancel_reason_label"("p_code" "kds"."cancel_reason_code") OWNER TO "postgres";

--
-- Name: tickets; Type: TABLE; Schema: kds; Owner: postgres
--

CREATE TABLE "kds"."tickets" (
    "ticket_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_transaction_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "source_channel" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    "customer_name" "text",
    "customer_phone" "text",
    "pickup_person" "text",
    "status" "kds"."ticket_status" NOT NULL,
    "station_id" "text",
    "station_name" "text",
    "customer_note" "text",
    "total_amount" numeric(12,2),
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "last_event_sequence" bigint,
    "raw_details_hash" "text" NOT NULL,
    "last_projected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cancellation_reason" "text",
    "partial_cancellation_reason" "text",
    "cancellation_reason_code" "kds"."cancel_reason_code",
    "cancellation_reason_note" "text",
    "partial_cancellation_reason_code" "kds"."cancel_reason_code",
    "partial_cancellation_reason_note" "text"
);


ALTER TABLE "kds"."tickets" OWNER TO "postgres";

--
-- Name: TABLE "tickets"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON TABLE "kds"."tickets" IS 'Kitchen-facing read model. One row per operational order projected from conversaflow.transactions plus customer identity and normalized board fields.';


--
-- Name: COLUMN "tickets"."source_transaction_id"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON COLUMN "kds"."tickets"."source_transaction_id" IS 'Operational source-of-truth order row in conversaflow.transactions.';


--
-- Name: COLUMN "tickets"."last_event_sequence"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON COLUMN "kds"."tickets"."last_event_sequence" IS 'Most recent sequence emitted in kds.ticket_events for reconnect reconciliation.';


--
-- Name: COLUMN "tickets"."cancellation_reason"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON COLUMN "kds"."tickets"."cancellation_reason" IS 'Operator or bot-supplied reason for cancellation. NULL when not cancelled or reason not provided.';


--
-- Name: COLUMN "tickets"."partial_cancellation_reason"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON COLUMN "kds"."tickets"."partial_cancellation_reason" IS 'Operator-supplied reason for partial item cancellation while the customer decides whether to accept the remaining order.';


--
-- Name: COLUMN "tickets"."cancellation_reason_code"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON COLUMN "kds"."tickets"."cancellation_reason_code" IS 'Controlled cancellation reason code for ticket-level cancellations.';


--
-- Name: COLUMN "tickets"."cancellation_reason_note"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON COLUMN "kds"."tickets"."cancellation_reason_note" IS 'Optional operator note for full cancellations. Required when code = other.';


--
-- Name: COLUMN "tickets"."partial_cancellation_reason_code"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON COLUMN "kds"."tickets"."partial_cancellation_reason_code" IS 'Controlled cancellation reason code for partial cancellation proposals.';


--
-- Name: COLUMN "tickets"."partial_cancellation_reason_note"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON COLUMN "kds"."tickets"."partial_cancellation_reason_note" IS 'Optional operator note for partial cancellations. Required when code = other.';


--
-- Name: confirm_partial_cancellation("uuid", "text", "text", "text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."confirm_partial_cancellation"("p_ticket_id" "uuid", "p_actor_source" "text" DEFAULT 'whatsapp_bot'::"text", "p_actor_id" "text" DEFAULT NULL::"text", "p_actor_channel" "text" DEFAULT NULL::"text") RETURNS "kds"."tickets"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."confirm_partial_cancellation"("p_ticket_id" "uuid", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "confirm_partial_cancellation"("p_ticket_id" "uuid", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text"); Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON FUNCTION "kds"."confirm_partial_cancellation"("p_ticket_id" "uuid", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text") IS 'Accepts a partially cancelled KDS ticket after the customer confirms the remaining order, clears partial_cancellation_reason, emits a status_changed event, and enqueues the accepted WhatsApp notification.';


--
-- Name: enqueue_whatsapp_partial_cancel_notification("uuid", bigint, integer[], "text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."enqueue_whatsapp_partial_cancel_notification"("p_ticket_id" "uuid", "p_event_sequence" bigint, "p_cancelled_display_orders" integer[], "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."enqueue_whatsapp_partial_cancel_notification"("p_ticket_id" "uuid", "p_event_sequence" bigint, "p_cancelled_display_orders" integer[], "p_reason" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "enqueue_whatsapp_partial_cancel_notification"("p_ticket_id" "uuid", "p_event_sequence" bigint, "p_cancelled_display_orders" integer[], "p_reason" "text"); Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON FUNCTION "kds"."enqueue_whatsapp_partial_cancel_notification"("p_ticket_id" "uuid", "p_event_sequence" bigint, "p_cancelled_display_orders" integer[], "p_reason" "text") IS 'Enqueue a Twilio WhatsApp notification describing partially cancelled items and the updated remaining order. Matches cancelled lines by stable display_order so projection rewrites do not drop the outbox insert.';


--
-- Name: enqueue_whatsapp_status_notification("uuid", "kds"."ticket_status", bigint); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."enqueue_whatsapp_status_notification"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_event_sequence" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."enqueue_whatsapp_status_notification"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_event_sequence" bigint) OWNER TO "postgres";

--
-- Name: FUNCTION "enqueue_whatsapp_status_notification"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_event_sequence" bigint); Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON FUNCTION "kds"."enqueue_whatsapp_status_notification"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_event_sequence" bigint) IS 'Enqueue Twilio WhatsApp status notification. Includes cancellation_reason in cancelled body. Uses customers.phone when ticket.customer_phone is empty.';


--
-- Name: get_board_snapshot("uuid", "text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."get_board_snapshot"("p_business_id" "uuid", "p_station_id" "text" DEFAULT NULL::"text") RETURNS TABLE("ticket_id" "uuid", "source_transaction_id" "uuid", "business_id" "uuid", "source_channel" "text", "status" "kds"."ticket_status", "station_id" "text", "station_name" "text", "customer_name" "text", "customer_phone" "text", "pickup_person" "text", "customer_note" "text", "cancellation_reason" "text", "partial_cancellation_reason" "text", "total_amount" numeric, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "last_event_sequence" bigint, "items" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."get_board_snapshot"("p_business_id" "uuid", "p_station_id" "text") OWNER TO "postgres";

--
-- Name: get_ticket_events("uuid", bigint, integer); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."get_ticket_events"("p_business_id" "uuid", "p_after_sequence" bigint DEFAULT 0, "p_limit" integer DEFAULT 200) RETURNS TABLE("sequence" bigint, "ticket_id" "uuid", "business_id" "uuid", "source_transaction_id" "uuid", "kind" "kds"."ticket_event_kind", "status" "kds"."ticket_status", "occurred_at" timestamp with time zone, "source" "text", "payload" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."get_ticket_events"("p_business_id" "uuid", "p_after_sequence" bigint, "p_limit" integer) OWNER TO "postgres";

--
-- Name: FUNCTION "get_ticket_events"("p_business_id" "uuid", "p_after_sequence" bigint, "p_limit" integer); Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON FUNCTION "kds"."get_ticket_events"("p_business_id" "uuid", "p_after_sequence" bigint, "p_limit" integer) IS 'Ordered incremental event contract for KDS reconnect and realtime catch-up.';


--
-- Name: map_kds_status_to_transaction_status("kds"."ticket_status"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."map_kds_status_to_transaction_status"("target_status" "kds"."ticket_status") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
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


ALTER FUNCTION "kds"."map_kds_status_to_transaction_status"("target_status" "kds"."ticket_status") OWNER TO "postgres";

--
-- Name: FUNCTION "map_kds_status_to_transaction_status"("target_status" "kds"."ticket_status"); Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON FUNCTION "kds"."map_kds_status_to_transaction_status"("target_status" "kds"."ticket_status") IS 'Maps KDS-facing statuses to conversaflow.transactions.status. partial_cancelled remains in_progress operationally.';


--
-- Name: map_transaction_status("text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."map_transaction_status"("op_status" "text") RETURNS "kds"."ticket_status"
    LANGUAGE "sql" IMMUTABLE
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


ALTER FUNCTION "kds"."map_transaction_status"("op_status" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "map_transaction_status"("op_status" "text"); Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON FUNCTION "kds"."map_transaction_status"("op_status" "text") IS 'Maps ConversaFlow operational order states to KDS-facing board states. accepted is reserved for future command flow but not emitted by the current operational model.';


--
-- Name: parse_cancel_reason_code("text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."parse_cancel_reason_code"("p_value" "text") RETURNS "kds"."cancel_reason_code"
    LANGUAGE "plpgsql" IMMUTABLE
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


ALTER FUNCTION "kds"."parse_cancel_reason_code"("p_value" "text") OWNER TO "postgres";

--
-- Name: partial_cancel_items("uuid", "uuid"[], "text", "text", "text", "text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."partial_cancel_items"("p_ticket_id" "uuid", "p_item_ids" "uuid"[], "p_reason" "text", "p_actor_source" "text" DEFAULT 'kds'::"text", "p_actor_id" "text" DEFAULT NULL::"text", "p_actor_channel" "text" DEFAULT NULL::"text") RETURNS "kds"."tickets"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."partial_cancel_items"("p_ticket_id" "uuid", "p_item_ids" "uuid"[], "p_reason" "text", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "partial_cancel_items"("p_ticket_id" "uuid", "p_item_ids" "uuid"[], "p_reason" "text", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text"); Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON FUNCTION "kds"."partial_cancel_items"("p_ticket_id" "uuid", "p_item_ids" "uuid"[], "p_reason" "text", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text") IS 'Marks selected transaction details.items as cancelled, recalculates total_amount, keeps operational status in_progress, moves the KDS ticket to partial_cancelled, emits an order_upserted event, and enqueues a WhatsApp notification using stable display_order lookup for cancelled lines.';


--
-- Name: partial_cancel_items("uuid", "uuid"[], "kds"."cancel_reason_code", "text", "text", "text", "text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."partial_cancel_items"("p_ticket_id" "uuid", "p_item_ids" "uuid"[], "p_reason_code" "kds"."cancel_reason_code", "p_reason_note" "text" DEFAULT NULL::"text", "p_actor_source" "text" DEFAULT 'kds'::"text", "p_actor_id" "text" DEFAULT NULL::"text", "p_actor_channel" "text" DEFAULT NULL::"text") RETURNS "kds"."tickets"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."partial_cancel_items"("p_ticket_id" "uuid", "p_item_ids" "uuid"[], "p_reason_code" "kds"."cancel_reason_code", "p_reason_note" "text", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text") OWNER TO "postgres";

--
-- Name: project_transaction("uuid", "kds"."ticket_event_kind", "text", "text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."project_transaction"("p_transaction_id" "uuid", "p_event_kind" "kds"."ticket_event_kind" DEFAULT 'order_upserted'::"kds"."ticket_event_kind", "p_source" "text" DEFAULT 'projection'::"text", "p_source_event_key" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."project_transaction"("p_transaction_id" "uuid", "p_event_kind" "kds"."ticket_event_kind", "p_source" "text", "p_source_event_key" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "project_transaction"("p_transaction_id" "uuid", "p_event_kind" "kds"."ticket_event_kind", "p_source" "text", "p_source_event_key" "text"); Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON FUNCTION "kds"."project_transaction"("p_transaction_id" "uuid", "p_event_kind" "kds"."ticket_event_kind", "p_source" "text", "p_source_event_key" "text") IS 'Projects one ConversaFlow order into the KDS read model including cancellation_reason and partial_cancellation_reason from details.';


--
-- Name: project_transaction_trigger(); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."project_transaction_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."project_transaction_trigger"() OWNER TO "postgres";

--
-- Name: FUNCTION "project_transaction_trigger"(); Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON FUNCTION "kds"."project_transaction_trigger"() IS 'Projection-maintenance trigger. Always emits order_upserted — never status_changed. status_changed is reserved for explicit operator actions in transition_ticket() and partial_cancel_items().';


--
-- Name: provision_device_token("uuid", "text", "text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."provision_device_token"("p_business_id" "uuid", "p_device_name" "text", "p_station_id" "text" DEFAULT NULL::"text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."provision_device_token"("p_business_id" "uuid", "p_device_name" "text", "p_station_id" "text") OWNER TO "postgres";

--
-- Name: redact_customer_text("text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."redact_customer_text"("p_text" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
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


ALTER FUNCTION "kds"."redact_customer_text"("p_text" "text") OWNER TO "postgres";

--
-- Name: render_customer_cancel_reason("kds"."cancel_reason_code", "text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."render_customer_cancel_reason"("p_code" "kds"."cancel_reason_code", "p_note" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
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


ALTER FUNCTION "kds"."render_customer_cancel_reason"("p_code" "kds"."cancel_reason_code", "p_note" "text") OWNER TO "postgres";

--
-- Name: render_internal_cancel_reason("kds"."cancel_reason_code", "text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."render_internal_cancel_reason"("p_code" "kds"."cancel_reason_code", "p_note" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
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


ALTER FUNCTION "kds"."render_internal_cancel_reason"("p_code" "kds"."cancel_reason_code", "p_note" "text") OWNER TO "postgres";

--
-- Name: transition_ticket("uuid", "kds"."ticket_status", "text", "text", "text", "text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."transition_ticket"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_actor_source" "text" DEFAULT 'kds'::"text", "p_actor_id" "text" DEFAULT NULL::"text", "p_actor_channel" "text" DEFAULT NULL::"text", "p_cancellation_reason" "text" DEFAULT NULL::"text") RETURNS "kds"."tickets"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."transition_ticket"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text", "p_cancellation_reason" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "transition_ticket"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text", "p_cancellation_reason" "text"); Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON FUNCTION "kds"."transition_ticket"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text", "p_cancellation_reason" "text") IS 'KDS state transition with optional cancellation reason. Clears partial_cancellation_reason when a partial cancellation is accepted or fully cancelled.';


--
-- Name: transition_ticket("uuid", "kds"."ticket_status", "text", "text", "text", "kds"."cancel_reason_code", "text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."transition_ticket"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_actor_source" "text" DEFAULT 'kds'::"text", "p_actor_id" "text" DEFAULT NULL::"text", "p_actor_channel" "text" DEFAULT NULL::"text", "p_cancellation_reason_code" "kds"."cancel_reason_code" DEFAULT NULL::"kds"."cancel_reason_code", "p_cancellation_reason_note" "text" DEFAULT NULL::"text") RETURNS "kds"."tickets"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."transition_ticket"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text", "p_cancellation_reason_code" "kds"."cancel_reason_code", "p_cancellation_reason_note" "text") OWNER TO "postgres";

--
-- Name: verify_device_token("text"); Type: FUNCTION; Schema: kds; Owner: postgres
--

CREATE FUNCTION "kds"."verify_device_token"("p_token" "text") RETURNS TABLE("device_id" "uuid", "business_id" "uuid", "station_id" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'kds', 'conversaflow', 'public'
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


ALTER FUNCTION "kds"."verify_device_token"("p_token" "text") OWNER TO "postgres";

--
-- Name: calculate_loyalty_points(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."calculate_loyalty_points"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."calculate_loyalty_points"() OWNER TO "postgres";

--
-- Name: check_tier_upgrade(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."check_tier_upgrade"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."check_tier_upgrade"() OWNER TO "postgres";

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inbound_event_id" "uuid",
    "business_id" "uuid" NOT NULL,
    "job_type" "text" NOT NULL,
    "aggregate_type" "text",
    "aggregate_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" smallint DEFAULT 0 NOT NULL,
    "max_attempts" smallint DEFAULT 3 NOT NULL,
    "attempt_count" smallint DEFAULT 0 NOT NULL,
    "next_run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "completed_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "jobs_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'claimed'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'dead'::"text"])))
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";

--
-- Name: TABLE "jobs"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."jobs" IS 'Durable work queue. Jobs are created by ingress handlers or parent jobs. Claimed via FOR UPDATE SKIP LOCKED by the job-worker. States: pending → claimed → running → completed/failed/dead.';


--
-- Name: COLUMN "jobs"."inbound_event_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."jobs"."inbound_event_id" IS 'The inbound event that triggered this job. NULL for cron-originated or child jobs spawned by another job.';


--
-- Name: COLUMN "jobs"."job_type"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."jobs"."job_type" IS 'Job type identifier matching a processor function. E.g. ''conversation.process'', ''message.embed'', ''order.create''. See ARCHITECTURE_TARGET.md §3 for full catalog.';


--
-- Name: COLUMN "jobs"."aggregate_type"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."jobs"."aggregate_type" IS 'Domain aggregate this job operates on: ''conversation'', ''transaction'', ''business'', ''customer'', ''message''.';


--
-- Name: COLUMN "jobs"."aggregate_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."jobs"."aggregate_id" IS 'Primary key of the aggregate (conversation_id, order_id, business_id, etc.). Used to detect concurrent jobs on the same aggregate.';


--
-- Name: COLUMN "jobs"."state"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."jobs"."state" IS 'Job lifecycle state. ''dead'' means all retry attempts exhausted — requires operator review.';


--
-- Name: COLUMN "jobs"."priority"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."jobs"."priority" IS 'Higher value = claimed sooner. 0 = normal priority. Use sparingly to avoid priority inversion.';


--
-- Name: COLUMN "jobs"."locked_by"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."jobs"."locked_by" IS 'Worker instance UUID that claimed this job. Used for stale lock detection — if locked_at is >2 minutes old and state is ''claimed'', the job is reset to ''pending''.';


--
-- Name: claim_next_job("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."claim_next_job"("p_worker_id" "text") RETURNS SETOF "public"."jobs"
    LANGUAGE "sql"
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


ALTER FUNCTION "public"."claim_next_job"("p_worker_id" "text") OWNER TO "postgres";

--
-- Name: outbox; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid",
    "business_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "aggregate_id" "uuid",
    "idempotency_key" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" smallint DEFAULT 0 NOT NULL,
    "max_attempts" smallint DEFAULT 5 NOT NULL,
    "next_run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "delivered_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "outbox_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'delivering'::"text", 'delivered'::"text", 'failed'::"text", 'dead'::"text"])))
);


ALTER TABLE "public"."outbox" OWNER TO "postgres";

--
-- Name: TABLE "outbox"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."outbox" IS 'Durable side-effect delivery queue. Job processors write outbox rows for external calls (Twilio, Slack, Voyage, etc.). The outbox dispatcher claims and delivers them with retry and idempotency. UNIQUE(idempotency_key) prevents duplicate deliveries on job retry.';


--
-- Name: COLUMN "outbox"."job_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."outbox"."job_id" IS 'The job that produced this side effect. ON DELETE SET NULL — outbox rows survive job cleanup for delivery tracking. NULL for outbox rows not tied to a specific job.';


--
-- Name: COLUMN "outbox"."kind"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."outbox"."kind" IS 'Delivery adapter identifier. E.g. ''twilio.reply'', ''slack.new_order'', ''voyage.embed''. See ARCHITECTURE_TARGET.md §4 for full catalog.';


--
-- Name: COLUMN "outbox"."aggregate_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."outbox"."aggregate_id" IS 'Domain object this side effect relates to (order_id, conversation_id, etc.). For debugging and dashboard filtering.';


--
-- Name: COLUMN "outbox"."idempotency_key"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."outbox"."idempotency_key" IS 'Globally unique key for deduplication. Pattern: ''{kind}:{domain_id}'' e.g. ''twilio_reply:{message_id}'', ''slack_order:{order_id}''. Prevents duplicate delivery if a job retries and re-inserts the same outbox row.';


--
-- Name: COLUMN "outbox"."state"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."outbox"."state" IS 'Delivery lifecycle: pending → delivering → delivered/failed. ''dead'' means max_attempts exhausted — requires operator review.';


--
-- Name: claim_outbox_batch("text", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."claim_outbox_batch"("p_worker_id" "text", "p_limit" integer DEFAULT 5) RETURNS SETOF "public"."outbox"
    LANGUAGE "sql"
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


ALTER FUNCTION "public"."claim_outbox_batch"("p_worker_id" "text", "p_limit" integer) OWNER TO "postgres";

--
-- Name: get_or_create_conversation("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."get_or_create_conversation"("p_business_id" "uuid", "p_customer_id" "uuid") RETURNS TABLE("id" "uuid", "business_id" "uuid", "customer_id" "uuid", "status" "text", "conversation_history" "jsonb", "current_state" "text", "state_data" "jsonb", "created_at" timestamp with time zone, "last_message_at" timestamp with time zone)
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."get_or_create_conversation"("p_business_id" "uuid", "p_customer_id" "uuid") OWNER TO "postgres";

--
-- Name: get_or_create_customer("text", "uuid", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."get_or_create_customer"("p_phone" "text", "p_business_id" "uuid", "p_name" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "phone" "text", "business_id" "uuid", "created_at" timestamp with time zone, "name" "text")
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."get_or_create_customer"("p_phone" "text", "p_business_id" "uuid", "p_name" "text") OWNER TO "postgres";

--
-- Name: increment_customer_metrics(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."increment_customer_metrics"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."increment_customer_metrics"() OWNER TO "postgres";

--
-- Name: notify_wallet_update(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."notify_wallet_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."notify_wallet_update"() OWNER TO "postgres";

--
-- Name: products_invalidate_embedding(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."products_invalidate_embedding"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."products_invalidate_embedding"() OWNER TO "postgres";

--
-- Name: reclaim_stale_jobs(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."reclaim_stale_jobs"() RETURNS integer
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."reclaim_stale_jobs"() OWNER TO "postgres";

--
-- Name: reclaim_stale_outbox(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."reclaim_stale_outbox"() RETURNS integer
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."reclaim_stale_outbox"() OWNER TO "postgres";

--
-- Name: search_products_by_embedding("uuid", "extensions"."vector", integer, double precision); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."search_products_by_embedding"("p_business_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer DEFAULT 5, "p_threshold" double precision DEFAULT 0.65) RETURNS TABLE("id" "uuid", "name" "text", "price" numeric, "description" "text", "category" "text", "variants" "jsonb", "similarity" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."search_products_by_embedding"("p_business_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer, "p_threshold" double precision) OWNER TO "postgres";

--
-- Name: search_products_text("uuid", "text", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "name" "text", "price" numeric, "description" "text", "category" "text", "variants" "jsonb")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer) OWNER TO "postgres";

--
-- Name: search_similar_messages("uuid", "extensions"."vector", integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."search_similar_messages"("p_conversation_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer DEFAULT 5, "p_exclude_recent" integer DEFAULT 8) RETURNS TABLE("id" "uuid", "role" "text", "content" "text", "created_at" timestamp with time zone, "similarity" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."search_similar_messages"("p_conversation_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer, "p_exclude_recent" integer) OWNER TO "postgres";

--
-- Name: update_customer_prefs(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."update_customer_prefs"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."update_customer_prefs"() OWNER TO "postgres";

--
-- Name: update_customer_segment(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."update_customer_segment"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."update_customer_segment"() OWNER TO "postgres";

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

--
-- Name: user_has_business_access("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."user_has_business_access"("target_business_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dashboard_users AS du
    WHERE du.auth_user_id = auth.uid()
      AND du.business_id = target_business_id
  );
$$;


ALTER FUNCTION "public"."user_has_business_access"("target_business_id" "uuid") OWNER TO "postgres";

--
-- Name: user_has_business_access_text("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION "public"."user_has_business_access_text"("target_business_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dashboard_users AS du
    WHERE du.auth_user_id = auth.uid()
      AND du.business_id::text = target_business_id
  );
$$;


ALTER FUNCTION "public"."user_has_business_access_text"("target_business_id" "text") OWNER TO "postgres";

--
-- Name: ai_turn_logs; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."ai_turn_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "conversation_id" "uuid",
    "customer_id" "uuid",
    "business_id" "uuid",
    "model" "text" NOT NULL,
    "prompt_version" "text",
    "prompt_tokens" integer,
    "completion_tokens" integer,
    "total_tokens" integer GENERATED ALWAYS AS ((COALESCE("prompt_tokens", 0) + COALESCE("completion_tokens", 0))) STORED,
    "cost_usd" numeric(10,6),
    "latency_ms" integer,
    "response_type" "text",
    "products_referenced" "jsonb" DEFAULT '[]'::"jsonb",
    "customer_context" "jsonb" DEFAULT '{}'::"jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "request_id" "text",
    CONSTRAINT "ai_turn_logs_response_type_check" CHECK (("response_type" = ANY (ARRAY['greeting'::"text", 'menu'::"text", 'price_query'::"text", 'product_search'::"text", 'order_intent'::"text", 'order_confirm'::"text", 'payment_info'::"text", 'fallback'::"text", 'out_of_scope'::"text", 'error'::"text"])))
);


ALTER TABLE "conversaflow"."ai_turn_logs" OWNER TO "postgres";

--
-- Name: business_config_changes; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."business_config_changes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "text" NOT NULL,
    "slack_user_id" "text" NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "previous_config" "jsonb",
    "new_config" "jsonb"
);


ALTER TABLE "conversaflow"."business_config_changes" OWNER TO "postgres";

--
-- Name: businesses; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."businesses" (
    "id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "business_type" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "open_times" "jsonb" DEFAULT "jsonb_build_object"('timezone', 'America/Mexico_City', 'days', "jsonb_build_object"('0', "jsonb_build_object"('closed', true), '1', "jsonb_build_object"('open', '07:30', 'close', '20:00'), '2', "jsonb_build_object"('open', '07:30', 'close', '20:00'), '3', "jsonb_build_object"('open', '07:30', 'close', '20:00'), '4', "jsonb_build_object"('open', '07:30', 'close', '20:00'), '5', "jsonb_build_object"('open', '07:30', 'close', '20:00'), '6', "jsonb_build_object"('open', '07:30', 'close', '20:00'))) NOT NULL
);


ALTER TABLE "conversaflow"."businesses" OWNER TO "postgres";

--
-- Name: COLUMN "businesses"."open_times"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."businesses"."open_times" IS 'Business operating hours by weekday. Format: {"timezone":"America/Mexico_City","days":{"0":{"closed":true},"1":{"open":"07:30","close":"20:00"}}}. WhatsApp order cutoff is enforced 30 minutes before close.';


--
-- Name: conversation_outcomes; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."conversation_outcomes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "conversation_id" "uuid",
    "customer_id" "uuid",
    "business_id" "uuid",
    "outcome" "text" NOT NULL,
    "turn_count" integer,
    "duration_seconds" integer,
    "total_tokens" integer,
    "total_cost_usd" numeric(10,6),
    "products_discussed" "jsonb" DEFAULT '[]'::"jsonb",
    "notes" "text",
    CONSTRAINT "conversation_outcomes_outcome_check" CHECK (("outcome" = ANY (ARRAY['resolved'::"text", 'sale'::"text", 'abandoned'::"text", 'escalated'::"text", 'error'::"text"])))
);


ALTER TABLE "conversaflow"."conversation_outcomes" OWNER TO "postgres";

--
-- Name: conversation_turns; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."conversation_turns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "source_message_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[] NOT NULL,
    "merged_user_text" "text" NOT NULL,
    "integrity_decision" "text" NOT NULL,
    "integrity_reason" "text" NOT NULL,
    "base_state_version" bigint NOT NULL,
    "first_message_at" timestamp with time zone NOT NULL,
    "last_message_at" timestamp with time zone NOT NULL,
    "hold_until" timestamp with time zone,
    "released_at" timestamp with time zone,
    "processed_at" timestamp with time zone,
    "superseded_at" timestamp with time zone,
    "extracted_intent" "jsonb",
    "reconciled_action" "jsonb",
    "assistant_message_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conversation_turns_integrity_decision_check" CHECK (("integrity_decision" = ANY (ARRAY['hold'::"text", 'merge'::"text", 'clarify'::"text", 'replace'::"text", 'cancel'::"text", 'release'::"text"]))),
    CONSTRAINT "conversation_turns_status_check" CHECK (("status" = ANY (ARRAY['buffering'::"text", 'released'::"text", 'processing'::"text", 'completed'::"text", 'clarification_needed'::"text", 'superseded'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "conversaflow"."conversation_turns" OWNER TO "postgres";

--
-- Name: conversations; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "customer_id" "uuid",
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "conversation_history" "jsonb" DEFAULT '[]'::"jsonb",
    "current_state" "text" DEFAULT 'initial'::"text",
    "state_data" "jsonb" DEFAULT '{}'::"jsonb",
    "last_message_at" timestamp with time zone DEFAULT "now"(),
    "summary" "text",
    "history_migrated" boolean DEFAULT false NOT NULL,
    "draft_cart" "jsonb",
    "state_version" bigint DEFAULT 0 NOT NULL,
    "draft_cart_version" bigint DEFAULT 0 NOT NULL,
    "pending_clarification" "jsonb"
);


ALTER TABLE "conversaflow"."conversations" OWNER TO "postgres";

--
-- Name: COLUMN "conversations"."draft_cart"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."conversations"."draft_cart" IS 'Ephemeral cart for the order being built. Shape: {items: [{product_id, product_name, variant_name, quantity, unit_price}], updated_at}. Cleared on order confirm/cancel.';


--
-- Name: customer_preferences; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."customer_preferences" (
    "customer_id" "uuid" NOT NULL,
    "favorite_services" "uuid"[],
    "usual_modifications" "jsonb" DEFAULT '[]'::"jsonb",
    "total_transactions" integer DEFAULT 0,
    "avg_transaction_value" numeric(10,2),
    "last_transaction_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "facts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "conversaflow"."customer_preferences" OWNER TO "postgres";

--
-- Name: customers; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "phone" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "name" "text"
);


ALTER TABLE "conversaflow"."customers" OWNER TO "postgres";

--
-- Name: daily_summaries; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."daily_summaries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "text" NOT NULL,
    "summary_date" "date" NOT NULL,
    "slack_channel" "text" NOT NULL,
    "slack_message_ts" "text",
    "pinned" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "conversaflow"."daily_summaries" OWNER TO "postgres";

--
-- Name: dashboard_users; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."dashboard_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dashboard_users_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'viewer'::"text"])))
);


ALTER TABLE "conversaflow"."dashboard_users" OWNER TO "postgres";

--
-- Name: edge_function_logs; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."edge_function_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "function_name" "text" NOT NULL,
    "status" "text" NOT NULL,
    "duration_ms" integer,
    "error_message" "text",
    "error_stack" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "request_id" "text",
    CONSTRAINT "edge_function_logs_status_check" CHECK (("status" = ANY (ARRAY['success'::"text", 'error'::"text"])))
);


ALTER TABLE "conversaflow"."edge_function_logs" OWNER TO "postgres";

--
-- Name: eval_traces; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."eval_traces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "turn_id" "uuid",
    "business_id" "uuid",
    "turn_sequence" integer,
    "authoritative_decision" "jsonb",
    "harness_decision" "jsonb",
    "agreement" boolean,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "conversaflow"."eval_traces" OWNER TO "postgres";

--
-- Name: inbound_events; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."inbound_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "source_event_id" "text",
    "event_type" "text" NOT NULL,
    "payload_hash" "text",
    "payload" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'accepted'::"text" NOT NULL,
    "request_id" "uuid" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "error" "text",
    CONSTRAINT "inbound_events_status_check" CHECK (("status" = ANY (ARRAY['accepted'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'duplicate'::"text"])))
);


ALTER TABLE "conversaflow"."inbound_events" OWNER TO "postgres";

--
-- Name: COLUMN "inbound_events"."source"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."inbound_events"."source" IS 'Event origin: ''twilio'', ''slack'', ''admin'', ''cron''.';


--
-- Name: COLUMN "inbound_events"."source_event_id"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."inbound_events"."source_event_id" IS 'Provider-specific unique ID (e.g. Twilio MessageSid, Slack event_id). NULL for cron-originated events.';


--
-- Name: COLUMN "inbound_events"."event_type"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."inbound_events"."event_type" IS 'Semantic event type: ''whatsapp_message'', ''slack_action'', ''slack_event'', ''slack_shortcut''.';


--
-- Name: COLUMN "inbound_events"."payload_hash"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."inbound_events"."payload_hash" IS 'SHA-256 of the raw inbound payload, for deduplication of events without a natural source_event_id.';


--
-- Name: COLUMN "inbound_events"."payload"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."inbound_events"."payload" IS 'Normalized payload (never raw provider format). Sensitive fields (e.g. auth tokens) must be stripped before insert.';


--
-- Name: COLUMN "inbound_events"."status"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."inbound_events"."status" IS 'Event lifecycle: accepted → processing → completed/failed. ''duplicate'' for idempotency rejections.';


--
-- Name: COLUMN "inbound_events"."request_id"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."inbound_events"."request_id" IS 'Correlation ID assigned at ingress, shared across all logs, jobs, and outbox rows for this request.';


--
-- Name: job_attempts; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."job_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "attempt" smallint NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "outcome" "text" DEFAULT 'running'::"text" NOT NULL,
    "error" "text",
    "metadata" "jsonb",
    CONSTRAINT "job_attempts_outcome_check" CHECK (("outcome" = ANY (ARRAY['running'::"text", 'success'::"text", 'error'::"text", 'timeout'::"text"])))
);


ALTER TABLE "conversaflow"."job_attempts" OWNER TO "postgres";

--
-- Name: COLUMN "job_attempts"."attempt"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."job_attempts"."attempt" IS '1-based attempt number. First attempt is 1, first retry is 2, etc.';


--
-- Name: COLUMN "job_attempts"."outcome"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."job_attempts"."outcome" IS 'Attempt result: ''running'' (in progress), ''success'', ''error'' (processor threw), ''timeout'' (exceeded time limit).';


--
-- Name: COLUMN "job_attempts"."metadata"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."job_attempts"."metadata" IS 'Processor-specific execution metadata. E.g. {tokens_used, latency_ms, model, cache_hit} for LLM jobs.';


--
-- Name: messages; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid",
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "intent" "text",
    "entities" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "embedding" "extensions"."vector"(1024),
    "message_index" integer,
    "twilio_message_sid" "text",
    "embedding_model" "text"
);


ALTER TABLE "conversaflow"."messages" OWNER TO "postgres";

--
-- Name: pipeline_traces; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."pipeline_traces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trace_id" "text" NOT NULL,
    "conversation_id" "uuid",
    "turn_id" "uuid",
    "business_id" "text",
    "stage" "text" NOT NULL,
    "event" "text" NOT NULL,
    "detail" "jsonb",
    "error" "text",
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "conversaflow"."pipeline_traces" OWNER TO "postgres";

--
-- Name: products; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "name" "text" NOT NULL,
    "price" numeric(10,2),
    "category" "text",
    "available" boolean DEFAULT true,
    "zettle_uuid" "text",
    "description" "text",
    "variants" "jsonb" DEFAULT '[]'::"jsonb",
    "synced_at" timestamp with time zone,
    "name_embedding" "extensions"."vector"(1024)
);


ALTER TABLE "conversaflow"."products" OWNER TO "postgres";

--
-- Name: security_logs; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."security_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "input_text" "text",
    "details" "text",
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "request_id" "text"
);


ALTER TABLE "conversaflow"."security_logs" OWNER TO "postgres";

--
-- Name: transaction_status_events; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."transaction_status_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "old_status" "text",
    "new_status" "text" NOT NULL,
    "acted_by_slack_user" "text",
    "acted_in_channel" "text",
    "acted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "conversaflow"."transaction_status_events" OWNER TO "postgres";

--
-- Name: COLUMN "transaction_status_events"."acted_by_slack_user"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."transaction_status_events"."acted_by_slack_user" IS 'Slack user_id from the payload.user.id field in the block_actions or view_submission payload.';


--
-- Name: COLUMN "transaction_status_events"."acted_in_channel"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON COLUMN "conversaflow"."transaction_status_events"."acted_in_channel" IS 'Slack channel_id from payload.channel.id. Only available for button actions in channel messages, not from App Home views.';


--
-- Name: transactions; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."transactions" (
    "id" "uuid" NOT NULL,
    "business_id" "uuid",
    "customer_id" "uuid",
    "service_id" "uuid",
    "transaction_type" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "total_amount" numeric(10,2),
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "slack_message_ts" "text"
);


ALTER TABLE "conversaflow"."transactions" OWNER TO "postgres";

--
-- Name: zettle_oauth_tokens; Type: TABLE; Schema: conversaflow; Owner: postgres
--

CREATE TABLE "conversaflow"."zettle_oauth_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "access_token" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "token_type" "text" DEFAULT 'Bearer'::"text",
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "conversaflow"."zettle_oauth_tokens" OWNER TO "postgres";

--
-- Name: device_sessions; Type: TABLE; Schema: kds; Owner: postgres
--

CREATE TABLE "kds"."device_sessions" (
    "device_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "device_name" "text" NOT NULL,
    "station_id" "text",
    "token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "kds"."device_sessions" OWNER TO "postgres";

--
-- Name: TABLE "device_sessions"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON TABLE "kds"."device_sessions" IS 'One row per provisioned KDS device. Tokens are stored as sha256 hex hashes. The kds-command edge function verifies the plaintext token before executing mutations.';


--
-- Name: ticket_events; Type: TABLE; Schema: kds; Owner: postgres
--

CREATE TABLE "kds"."ticket_events" (
    "sequence" bigint NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "source_transaction_id" "uuid" NOT NULL,
    "kind" "kds"."ticket_event_kind" NOT NULL,
    "status" "kds"."ticket_status",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'projection'::"text" NOT NULL,
    "source_event_key" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "kds"."ticket_events" OWNER TO "postgres";

--
-- Name: TABLE "ticket_events"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON TABLE "kds"."ticket_events" IS 'Ordered kitchen event log for snapshot reconciliation and realtime consumers.';


--
-- Name: COLUMN "ticket_events"."source_event_key"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON COLUMN "kds"."ticket_events"."source_event_key" IS 'Idempotency key for projection emissions. Prevents duplicate events during backfill or replay.';


--
-- Name: ticket_events_sequence_seq; Type: SEQUENCE; Schema: kds; Owner: postgres
--

ALTER TABLE "kds"."ticket_events" ALTER COLUMN "sequence" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "kds"."ticket_events_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ticket_items; Type: TABLE; Schema: kds; Owner: postgres
--

CREATE TABLE "kds"."ticket_items" (
    "ticket_item_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "source_transaction_id" "uuid" NOT NULL,
    "display_order" integer NOT NULL,
    "product_id" "uuid",
    "name" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "variant_name" "text",
    "notes" "text",
    "unit_price" numeric(12,2),
    "is_cancelled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "ticket_items_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "kds"."ticket_items" OWNER TO "postgres";

--
-- Name: TABLE "ticket_items"; Type: COMMENT; Schema: kds; Owner: postgres
--

COMMENT ON TABLE "kds"."ticket_items" IS 'Normalized kitchen line items derived from transactions.details.items for display in KDS clients.';


--
-- Name: ai_turn_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."ai_turn_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "conversation_id" "uuid",
    "customer_id" "uuid",
    "business_id" "uuid",
    "model" "text" NOT NULL,
    "prompt_version" "text",
    "prompt_tokens" integer,
    "completion_tokens" integer,
    "total_tokens" integer GENERATED ALWAYS AS ((COALESCE("prompt_tokens", 0) + COALESCE("completion_tokens", 0))) STORED,
    "cost_usd" numeric(10,6),
    "latency_ms" integer,
    "response_type" "text",
    "products_referenced" "jsonb" DEFAULT '[]'::"jsonb",
    "customer_context" "jsonb" DEFAULT '{}'::"jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "request_id" "text",
    CONSTRAINT "ai_turn_logs_response_type_check" CHECK (("response_type" = ANY (ARRAY['greeting'::"text", 'menu'::"text", 'price_query'::"text", 'product_search'::"text", 'order_intent'::"text", 'order_confirm'::"text", 'payment_info'::"text", 'fallback'::"text", 'out_of_scope'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."ai_turn_logs" OWNER TO "postgres";

--
-- Name: business_config_changes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."business_config_changes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "text" NOT NULL,
    "slack_user_id" "text" NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "previous_config" "jsonb",
    "new_config" "jsonb"
);


ALTER TABLE "public"."business_config_changes" OWNER TO "postgres";

--
-- Name: TABLE "business_config_changes"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."business_config_changes" IS 'Audit trail for business config changes made via Slack settings modal.';


--
-- Name: businesses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."businesses" (
    "id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "business_type" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "open_times" "jsonb" DEFAULT "jsonb_build_object"('timezone', 'America/Mexico_City', 'days', "jsonb_build_object"('0', "jsonb_build_object"('closed', true), '1', "jsonb_build_object"('open', '07:30', 'close', '20:00'), '2', "jsonb_build_object"('open', '07:30', 'close', '20:00'), '3', "jsonb_build_object"('open', '07:30', 'close', '20:00'), '4', "jsonb_build_object"('open', '07:30', 'close', '20:00'), '5', "jsonb_build_object"('open', '07:30', 'close', '20:00'), '6', "jsonb_build_object"('open', '07:30', 'close', '20:00'))) NOT NULL
);


ALTER TABLE "public"."businesses" OWNER TO "postgres";

--
-- Name: COLUMN "businesses"."open_times"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."businesses"."open_times" IS 'Business operating hours by weekday. Format: {"timezone":"America/Mexico_City","days":{"0":{"closed":true},"1":{"open":"07:30","close":"20:00"}}}. WhatsApp order cutoff is enforced 30 minutes before close.';


--
-- Name: conversation_outcomes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."conversation_outcomes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "conversation_id" "uuid",
    "customer_id" "uuid",
    "business_id" "uuid",
    "outcome" "text" NOT NULL,
    "turn_count" integer,
    "duration_seconds" integer,
    "total_tokens" integer,
    "total_cost_usd" numeric(10,6),
    "products_discussed" "jsonb" DEFAULT '[]'::"jsonb",
    "notes" "text",
    CONSTRAINT "conversation_outcomes_outcome_check" CHECK (("outcome" = ANY (ARRAY['resolved'::"text", 'sale'::"text", 'abandoned'::"text", 'escalated'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."conversation_outcomes" OWNER TO "postgres";

--
-- Name: conversation_turns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."conversation_turns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "source_message_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[] NOT NULL,
    "merged_user_text" "text" NOT NULL,
    "integrity_decision" "text" NOT NULL,
    "integrity_reason" "text" NOT NULL,
    "base_state_version" bigint NOT NULL,
    "first_message_at" timestamp with time zone NOT NULL,
    "last_message_at" timestamp with time zone NOT NULL,
    "hold_until" timestamp with time zone,
    "released_at" timestamp with time zone,
    "processed_at" timestamp with time zone,
    "superseded_at" timestamp with time zone,
    "extracted_intent" "jsonb",
    "reconciled_action" "jsonb",
    "assistant_message_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conversation_turns_integrity_decision_check" CHECK (("integrity_decision" = ANY (ARRAY['hold'::"text", 'merge'::"text", 'clarify'::"text", 'replace'::"text", 'cancel'::"text", 'release'::"text"]))),
    CONSTRAINT "conversation_turns_status_check" CHECK (("status" = ANY (ARRAY['buffering'::"text", 'released'::"text", 'processing'::"text", 'completed'::"text", 'clarification_needed'::"text", 'superseded'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."conversation_turns" OWNER TO "postgres";

--
-- Name: conversations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "customer_id" "uuid",
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "conversation_history" "jsonb" DEFAULT '[]'::"jsonb",
    "current_state" "text" DEFAULT 'initial'::"text",
    "state_data" "jsonb" DEFAULT '{}'::"jsonb",
    "last_message_at" timestamp with time zone DEFAULT "now"(),
    "summary" "text",
    "history_migrated" boolean DEFAULT false NOT NULL,
    "draft_cart" "jsonb",
    "state_version" bigint DEFAULT 0 NOT NULL,
    "draft_cart_version" bigint DEFAULT 0 NOT NULL,
    "pending_clarification" "jsonb"
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";

--
-- Name: COLUMN "conversations"."draft_cart"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."conversations"."draft_cart" IS 'Ephemeral cart for the order being built. Shape: {items: [{product_id, product_name, variant_name, quantity, unit_price}], updated_at}. Cleared on order confirm/cancel.';


--
-- Name: customer_preferences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."customer_preferences" (
    "customer_id" "uuid" NOT NULL,
    "favorite_services" "uuid"[],
    "usual_modifications" "jsonb" DEFAULT '[]'::"jsonb",
    "total_transactions" integer DEFAULT 0,
    "avg_transaction_value" numeric(10,2),
    "last_transaction_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "facts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."customer_preferences" OWNER TO "postgres";

--
-- Name: customers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "phone" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "name" "text"
);


ALTER TABLE "public"."customers" OWNER TO "postgres";

--
-- Name: daily_summaries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."daily_summaries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "text" NOT NULL,
    "summary_date" "date" NOT NULL,
    "slack_channel" "text" NOT NULL,
    "slack_message_ts" "text",
    "pinned" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."daily_summaries" OWNER TO "postgres";

--
-- Name: dashboard_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."dashboard_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dashboard_users_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."dashboard_users" OWNER TO "postgres";

--
-- Name: edge_function_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."edge_function_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "function_name" "text" NOT NULL,
    "status" "text" NOT NULL,
    "duration_ms" integer,
    "error_message" "text",
    "error_stack" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "request_id" "text",
    CONSTRAINT "edge_function_logs_status_check" CHECK (("status" = ANY (ARRAY['success'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."edge_function_logs" OWNER TO "postgres";

--
-- Name: inbound_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."inbound_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "source_event_id" "text",
    "event_type" "text" NOT NULL,
    "payload_hash" "text",
    "payload" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'accepted'::"text" NOT NULL,
    "request_id" "uuid" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "error" "text",
    CONSTRAINT "inbound_events_status_check" CHECK (("status" = ANY (ARRAY['accepted'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'duplicate'::"text"])))
);


ALTER TABLE "public"."inbound_events" OWNER TO "postgres";

--
-- Name: TABLE "inbound_events"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."inbound_events" IS 'Canonical record of every external event (Twilio webhook, Slack action, cron tick, etc.). UNIQUE(source, source_event_id) provides idempotency — Twilio retries with the same MessageSid are rejected at insert.';


--
-- Name: COLUMN "inbound_events"."source"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."inbound_events"."source" IS 'Event origin: ''twilio'', ''slack'', ''admin'', ''cron''.';


--
-- Name: COLUMN "inbound_events"."source_event_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."inbound_events"."source_event_id" IS 'Provider-specific unique ID (e.g. Twilio MessageSid, Slack event_id). NULL for cron-originated events.';


--
-- Name: COLUMN "inbound_events"."event_type"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."inbound_events"."event_type" IS 'Semantic event type: ''whatsapp_message'', ''slack_action'', ''slack_event'', ''slack_shortcut''.';


--
-- Name: COLUMN "inbound_events"."payload_hash"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."inbound_events"."payload_hash" IS 'SHA-256 of the raw inbound payload, for deduplication of events without a natural source_event_id.';


--
-- Name: COLUMN "inbound_events"."payload"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."inbound_events"."payload" IS 'Normalized payload (never raw provider format). Sensitive fields (e.g. auth tokens) must be stripped before insert.';


--
-- Name: COLUMN "inbound_events"."status"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."inbound_events"."status" IS 'Event lifecycle: accepted → processing → completed/failed. ''duplicate'' for idempotency rejections.';


--
-- Name: COLUMN "inbound_events"."request_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."inbound_events"."request_id" IS 'Correlation ID assigned at ingress, shared across all logs, jobs, and outbox rows for this request.';


--
-- Name: job_attempts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."job_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "attempt" smallint NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "outcome" "text" DEFAULT 'running'::"text" NOT NULL,
    "error" "text",
    "metadata" "jsonb",
    CONSTRAINT "job_attempts_outcome_check" CHECK (("outcome" = ANY (ARRAY['running'::"text", 'success'::"text", 'error'::"text", 'timeout'::"text"])))
);


ALTER TABLE "public"."job_attempts" OWNER TO "postgres";

--
-- Name: TABLE "job_attempts"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."job_attempts" IS 'Per-attempt execution record for jobs. ON DELETE CASCADE from jobs — when a job is removed, its attempt history is cleaned up. UNIQUE(job_id, attempt) prevents duplicate attempt numbers.';


--
-- Name: COLUMN "job_attempts"."attempt"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."job_attempts"."attempt" IS '1-based attempt number. First attempt is 1, first retry is 2, etc.';


--
-- Name: COLUMN "job_attempts"."outcome"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."job_attempts"."outcome" IS 'Attempt result: ''running'' (in progress), ''success'', ''error'' (processor threw), ''timeout'' (exceeded time limit).';


--
-- Name: COLUMN "job_attempts"."metadata"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."job_attempts"."metadata" IS 'Processor-specific execution metadata. E.g. {tokens_used, latency_ms, model, cache_hit} for LLM jobs.';


--
-- Name: messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid",
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "intent" "text",
    "entities" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "embedding" "extensions"."vector"(1024),
    "message_index" integer,
    "twilio_message_sid" "text",
    "embedding_model" "text"
);


ALTER TABLE "public"."messages" OWNER TO "postgres";

--
-- Name: pipeline_traces; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."pipeline_traces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trace_id" "text" NOT NULL,
    "conversation_id" "uuid",
    "turn_id" "uuid",
    "business_id" "text",
    "stage" "text" NOT NULL,
    "event" "text" NOT NULL,
    "detail" "jsonb",
    "error" "text",
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pipeline_traces" OWNER TO "postgres";

--
-- Name: TABLE "pipeline_traces"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."pipeline_traces" IS 'Lifecycle trace for each inbound message through the pipeline stages: inbound → integrity → process → dispatch. One row per stage event. trace_id = request_id from whatsapp-handler, propagated through job payloads and outbox payload so every stage is correlatable.';


--
-- Name: COLUMN "pipeline_traces"."trace_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."pipeline_traces"."trace_id" IS 'Correlation key = request_id assigned at whatsapp-handler ingress. Propagated through turn.integrity payload → turn.process payload → twilio.reply outbox payload → dispatcher.';


--
-- Name: COLUMN "pipeline_traces"."stage"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."pipeline_traces"."stage" IS 'Pipeline stage: inbound | integrity | process | dispatch';


--
-- Name: COLUMN "pipeline_traces"."event"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."pipeline_traces"."event" IS 'Stage event: enqueued | skipped | failed | started | decision | completed | superseded | delivered | dead';


--
-- Name: products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "name" "text" NOT NULL,
    "price" numeric(10,2),
    "category" "text",
    "available" boolean DEFAULT true,
    "zettle_uuid" "text",
    "description" "text",
    "variants" "jsonb" DEFAULT '[]'::"jsonb",
    "synced_at" timestamp with time zone,
    "name_embedding" "extensions"."vector"(1024)
);


ALTER TABLE "public"."products" OWNER TO "postgres";

--
-- Name: security_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."security_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "input_text" "text",
    "details" "text",
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "request_id" "text"
);


ALTER TABLE "public"."security_logs" OWNER TO "postgres";

--
-- Name: transaction_status_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."transaction_status_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "old_status" "text",
    "new_status" "text" NOT NULL,
    "acted_by_slack_user" "text",
    "acted_in_channel" "text",
    "acted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transaction_status_events" OWNER TO "postgres";

--
-- Name: TABLE "transaction_status_events"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."transaction_status_events" IS 'Phase-2 event log for order status transitions. Used to compute accept latency, prep latency, and per-staff performance once the App Home workflow is validated.';


--
-- Name: COLUMN "transaction_status_events"."acted_by_slack_user"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."transaction_status_events"."acted_by_slack_user" IS 'Slack user_id from the payload.user.id field in the block_actions or view_submission payload.';


--
-- Name: COLUMN "transaction_status_events"."acted_in_channel"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."transaction_status_events"."acted_in_channel" IS 'Slack channel_id from payload.channel.id. Only available for button actions in channel messages, not from App Home views.';


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."transactions" (
    "id" "uuid" NOT NULL,
    "business_id" "uuid",
    "customer_id" "uuid",
    "service_id" "uuid",
    "transaction_type" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "total_amount" numeric(10,2),
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "slack_message_ts" "text"
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";

--
-- Name: zettle_oauth_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE "public"."zettle_oauth_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "access_token" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "token_type" "text" DEFAULT 'Bearer'::"text",
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."zettle_oauth_tokens" OWNER TO "postgres";

--
-- Name: TABLE "zettle_oauth_tokens"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."zettle_oauth_tokens" IS 'Stores Zettle OAuth tokens with automatic refresh capability';


--
-- Name: ApplePushToken; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."ApplePushToken" (
    "id" "text" NOT NULL,
    "cardId" "text" NOT NULL,
    "deviceToken" "text" NOT NULL,
    "pushToken" "text" NOT NULL,
    "createdAt" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "umi_cash"."ApplePushToken" OWNER TO "postgres";

--
-- Name: BirthdayReward; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."BirthdayReward" (
    "id" "text" NOT NULL,
    "tenantId" "text" NOT NULL,
    "loyaltyCardId" "text" NOT NULL,
    "year" integer NOT NULL,
    "issuedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "redeemedAt" timestamp(3) without time zone,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL
);


ALTER TABLE "umi_cash"."BirthdayReward" OWNER TO "postgres";

--
-- Name: GiftCard; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."GiftCard" (
    "id" "text" NOT NULL,
    "tenantId" "text" NOT NULL,
    "code" "text" NOT NULL,
    "amountCentavos" integer NOT NULL,
    "createdByStaffId" "text" NOT NULL,
    "senderName" "text",
    "message" "text",
    "recipientEmail" "text",
    "recipientPhone" "text",
    "recipientName" "text",
    "isRedeemed" boolean DEFAULT false NOT NULL,
    "redeemedAt" timestamp with time zone,
    "redeemedCardId" "text",
    "expiresAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "umi_cash"."GiftCard" OWNER TO "postgres";

--
-- Name: Location; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."Location" (
    "id" "text" NOT NULL,
    "tenantId" "text" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "latitude" double precision,
    "longitude" double precision,
    "isActive" boolean DEFAULT true NOT NULL
);


ALTER TABLE "umi_cash"."Location" OWNER TO "postgres";

--
-- Name: LoyaltyCard; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."LoyaltyCard" (
    "id" "text" NOT NULL,
    "tenantId" "text" NOT NULL,
    "userId" "text" NOT NULL,
    "cardNumber" "text" NOT NULL,
    "balanceCentavos" integer DEFAULT 0 NOT NULL,
    "totalVisits" integer DEFAULT 0 NOT NULL,
    "visitsThisCycle" integer DEFAULT 0 NOT NULL,
    "pendingRewards" integer DEFAULT 0 NOT NULL,
    "applePassSerial" "text",
    "applePassAuthToken" "text",
    "googlePassObjectId" "text",
    "qrToken" "text" NOT NULL,
    "qrIssuedAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "umi_cash"."LoyaltyCard" OWNER TO "postgres";

--
-- Name: OtpVerification; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."OtpVerification" (
    "id" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "tenantId" "text" NOT NULL,
    "codeHash" "text" NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "verified" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "umi_cash"."OtpVerification" OWNER TO "postgres";

--
-- Name: RewardConfig; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."RewardConfig" (
    "id" "text" NOT NULL,
    "tenantId" "text" NOT NULL,
    "visitsRequired" integer DEFAULT 10 NOT NULL,
    "rewardName" "text" DEFAULT 'Recompensa de temporada'::"text" NOT NULL,
    "rewardDescription" "text",
    "rewardCostCentavos" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "activatedAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "umi_cash"."RewardConfig" OWNER TO "postgres";

--
-- Name: RewardRedemption; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."RewardRedemption" (
    "id" "text" NOT NULL,
    "cardId" "text" NOT NULL,
    "configId" "text" NOT NULL,
    "staffId" "text" NOT NULL,
    "redeemedAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "note" "text"
);


ALTER TABLE "umi_cash"."RewardRedemption" OWNER TO "postgres";

--
-- Name: Session; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."Session" (
    "id" "text" NOT NULL,
    "userId" "text" NOT NULL,
    "token" "text" NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "umi_cash"."Session" OWNER TO "postgres";

--
-- Name: Tenant; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."Tenant" (
    "id" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "city" "text",
    "cardPrefix" "text" DEFAULT 'LYL'::"text" NOT NULL,
    "primaryColor" "text" DEFAULT '#B5605A'::"text" NOT NULL,
    "secondaryColor" "text",
    "labelColor" "text",
    "logoUrl" "text",
    "stripImageUrl" "text",
    "passStyle" "text" DEFAULT 'default'::"text" NOT NULL,
    "promoMessage" "text",
    "selfRegistration" boolean DEFAULT true NOT NULL,
    "subscriptionStatus" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "suspendedAt" timestamp with time zone,
    "trialEndsAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "topupEnabled" boolean DEFAULT true NOT NULL,
    "promoDays" "text",
    "promoEndsAt" timestamp with time zone,
    "promoStartsAt" timestamp with time zone,
    "timezone" "text" DEFAULT 'America/Mexico_City'::"text" NOT NULL,
    "businessHours" "jsonb",
    "birthdayRewardEnabled" boolean DEFAULT false NOT NULL,
    "birthdayRewardName" "text" DEFAULT 'Regalo de cumpleaños'::"text" NOT NULL
);


ALTER TABLE "umi_cash"."Tenant" OWNER TO "postgres";

--
-- Name: Transaction; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."Transaction" (
    "id" "text" NOT NULL,
    "cardId" "text" NOT NULL,
    "staffId" "text",
    "type" "text" NOT NULL,
    "amountCentavos" integer NOT NULL,
    "description" "text",
    "createdAt" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "umi_cash"."Transaction" OWNER TO "postgres";

--
-- Name: User; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."User" (
    "id" "text" NOT NULL,
    "tenantId" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "name" "text",
    "role" "text" DEFAULT 'CUSTOMER'::"text" NOT NULL,
    "passwordHash" "text",
    "createdAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "birthDate" "date",
    "device" "text",
    "os" "text",
    "phoneVerifiedAt" timestamp with time zone
);


ALTER TABLE "umi_cash"."User" OWNER TO "postgres";

--
-- Name: Visit; Type: TABLE; Schema: umi_cash; Owner: postgres
--

CREATE TABLE "umi_cash"."Visit" (
    "id" "text" NOT NULL,
    "cardId" "text" NOT NULL,
    "staffId" "text" NOT NULL,
    "scannedAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "note" "text"
);


ALTER TABLE "umi_cash"."Visit" OWNER TO "postgres";

--
-- Name: ai_turn_logs ai_turn_logs_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."ai_turn_logs"
    ADD CONSTRAINT "ai_turn_logs_pkey" PRIMARY KEY ("id");


--
-- Name: business_config_changes business_config_changes_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."business_config_changes"
    ADD CONSTRAINT "business_config_changes_pkey" PRIMARY KEY ("id");


--
-- Name: businesses businesses_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."businesses"
    ADD CONSTRAINT "businesses_pkey" PRIMARY KEY ("id");


--
-- Name: conversation_outcomes conversation_outcomes_conversation_id_key; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversation_outcomes"
    ADD CONSTRAINT "conversation_outcomes_conversation_id_key" UNIQUE ("conversation_id");


--
-- Name: conversation_outcomes conversation_outcomes_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversation_outcomes"
    ADD CONSTRAINT "conversation_outcomes_pkey" PRIMARY KEY ("id");


--
-- Name: conversation_turns conversation_turns_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id");


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");


--
-- Name: customer_preferences customer_preferences_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_pkey" PRIMARY KEY ("customer_id");


--
-- Name: customers customers_business_id_phone_key; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."customers"
    ADD CONSTRAINT "customers_business_id_phone_key" UNIQUE ("business_id", "phone");


--
-- Name: customers customers_phone_business_id_key; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."customers"
    ADD CONSTRAINT "customers_phone_business_id_key" UNIQUE ("phone", "business_id");


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");


--
-- Name: daily_summaries daily_summaries_business_id_summary_date_key; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."daily_summaries"
    ADD CONSTRAINT "daily_summaries_business_id_summary_date_key" UNIQUE ("business_id", "summary_date");


--
-- Name: daily_summaries daily_summaries_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."daily_summaries"
    ADD CONSTRAINT "daily_summaries_pkey" PRIMARY KEY ("id");


--
-- Name: dashboard_users dashboard_users_auth_user_id_business_id_key; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."dashboard_users"
    ADD CONSTRAINT "dashboard_users_auth_user_id_business_id_key" UNIQUE ("auth_user_id", "business_id");


--
-- Name: dashboard_users dashboard_users_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."dashboard_users"
    ADD CONSTRAINT "dashboard_users_pkey" PRIMARY KEY ("id");


--
-- Name: edge_function_logs edge_function_logs_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."edge_function_logs"
    ADD CONSTRAINT "edge_function_logs_pkey" PRIMARY KEY ("id");


--
-- Name: eval_traces eval_traces_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."eval_traces"
    ADD CONSTRAINT "eval_traces_pkey" PRIMARY KEY ("id");


--
-- Name: inbound_events inbound_events_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."inbound_events"
    ADD CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("id");


--
-- Name: inbound_events inbound_events_source_source_event_id_key; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."inbound_events"
    ADD CONSTRAINT "inbound_events_source_source_event_id_key" UNIQUE ("source", "source_event_id");


--
-- Name: job_attempts job_attempts_job_id_attempt_key; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."job_attempts"
    ADD CONSTRAINT "job_attempts_job_id_attempt_key" UNIQUE ("job_id", "attempt");


--
-- Name: job_attempts job_attempts_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."job_attempts"
    ADD CONSTRAINT "job_attempts_pkey" PRIMARY KEY ("id");


--
-- Name: jobs jobs_inbound_event_id_job_type_key; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."jobs"
    ADD CONSTRAINT "jobs_inbound_event_id_job_type_key" UNIQUE ("inbound_event_id", "job_type");


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");


--
-- Name: outbox outbox_idempotency_key_key; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."outbox"
    ADD CONSTRAINT "outbox_idempotency_key_key" UNIQUE ("idempotency_key");


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."outbox"
    ADD CONSTRAINT "outbox_pkey" PRIMARY KEY ("id");


--
-- Name: pipeline_traces pipeline_traces_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."pipeline_traces"
    ADD CONSTRAINT "pipeline_traces_pkey" PRIMARY KEY ("id");


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");


--
-- Name: products products_zettle_uuid_key; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."products"
    ADD CONSTRAINT "products_zettle_uuid_key" UNIQUE ("zettle_uuid");


--
-- Name: security_logs security_logs_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."security_logs"
    ADD CONSTRAINT "security_logs_pkey" PRIMARY KEY ("id");


--
-- Name: transaction_status_events transaction_status_events_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."transaction_status_events"
    ADD CONSTRAINT "transaction_status_events_pkey" PRIMARY KEY ("id");


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_business_id_key; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."zettle_oauth_tokens"
    ADD CONSTRAINT "zettle_oauth_tokens_business_id_key" UNIQUE ("business_id");


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_pkey; Type: CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."zettle_oauth_tokens"
    ADD CONSTRAINT "zettle_oauth_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: device_sessions device_sessions_pkey; Type: CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."device_sessions"
    ADD CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("device_id");


--
-- Name: device_sessions device_sessions_token_hash_key; Type: CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."device_sessions"
    ADD CONSTRAINT "device_sessions_token_hash_key" UNIQUE ("token_hash");


--
-- Name: ticket_events ticket_events_pkey; Type: CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."ticket_events"
    ADD CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("sequence");


--
-- Name: ticket_events ticket_events_source_event_key_key; Type: CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."ticket_events"
    ADD CONSTRAINT "ticket_events_source_event_key_key" UNIQUE ("source_event_key");


--
-- Name: ticket_items ticket_items_pkey; Type: CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."ticket_items"
    ADD CONSTRAINT "ticket_items_pkey" PRIMARY KEY ("ticket_item_id");


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."tickets"
    ADD CONSTRAINT "tickets_pkey" PRIMARY KEY ("ticket_id");


--
-- Name: tickets tickets_source_transaction_id_key; Type: CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."tickets"
    ADD CONSTRAINT "tickets_source_transaction_id_key" UNIQUE ("source_transaction_id");


--
-- Name: ticket_items uq_kds_ticket_item_order; Type: CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."ticket_items"
    ADD CONSTRAINT "uq_kds_ticket_item_order" UNIQUE ("ticket_id", "display_order");


--
-- Name: ai_turn_logs ai_turn_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ai_turn_logs"
    ADD CONSTRAINT "ai_turn_logs_pkey" PRIMARY KEY ("id");


--
-- Name: business_config_changes business_config_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."business_config_changes"
    ADD CONSTRAINT "business_config_changes_pkey" PRIMARY KEY ("id");


--
-- Name: businesses businesses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_pkey" PRIMARY KEY ("id");


--
-- Name: conversation_outcomes conversation_outcomes_conversation_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversation_outcomes"
    ADD CONSTRAINT "conversation_outcomes_conversation_id_key" UNIQUE ("conversation_id");


--
-- Name: conversation_outcomes conversation_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversation_outcomes"
    ADD CONSTRAINT "conversation_outcomes_pkey" PRIMARY KEY ("id");


--
-- Name: conversation_turns conversation_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id");


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");


--
-- Name: customer_preferences customer_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_pkey" PRIMARY KEY ("customer_id");


--
-- Name: customers customers_business_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_business_id_phone_key" UNIQUE ("business_id", "phone");


--
-- Name: customers customers_phone_business_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_phone_business_id_unique" UNIQUE ("phone", "business_id");


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");


--
-- Name: daily_summaries daily_summaries_business_id_summary_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_summaries"
    ADD CONSTRAINT "daily_summaries_business_id_summary_date_key" UNIQUE ("business_id", "summary_date");


--
-- Name: daily_summaries daily_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."daily_summaries"
    ADD CONSTRAINT "daily_summaries_pkey" PRIMARY KEY ("id");


--
-- Name: dashboard_users dashboard_users_auth_user_id_business_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dashboard_users"
    ADD CONSTRAINT "dashboard_users_auth_user_id_business_id_key" UNIQUE ("auth_user_id", "business_id");


--
-- Name: dashboard_users dashboard_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dashboard_users"
    ADD CONSTRAINT "dashboard_users_pkey" PRIMARY KEY ("id");


--
-- Name: edge_function_logs edge_function_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."edge_function_logs"
    ADD CONSTRAINT "edge_function_logs_pkey" PRIMARY KEY ("id");


--
-- Name: inbound_events inbound_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."inbound_events"
    ADD CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("id");


--
-- Name: job_attempts job_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."job_attempts"
    ADD CONSTRAINT "job_attempts_pkey" PRIMARY KEY ("id");


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."outbox"
    ADD CONSTRAINT "outbox_pkey" PRIMARY KEY ("id");


--
-- Name: pipeline_traces pipeline_traces_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."pipeline_traces"
    ADD CONSTRAINT "pipeline_traces_pkey" PRIMARY KEY ("id");


--
-- Name: products products_zettle_uuid_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_zettle_uuid_key" UNIQUE ("zettle_uuid");


--
-- Name: security_logs security_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."security_logs"
    ADD CONSTRAINT "security_logs_pkey" PRIMARY KEY ("id");


--
-- Name: products services_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");


--
-- Name: transaction_status_events transaction_status_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."transaction_status_events"
    ADD CONSTRAINT "transaction_status_events_pkey" PRIMARY KEY ("id");


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");


--
-- Name: inbound_events uq_inbound_source_event; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."inbound_events"
    ADD CONSTRAINT "uq_inbound_source_event" UNIQUE ("source", "source_event_id");


--
-- Name: job_attempts uq_job_attempt; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."job_attempts"
    ADD CONSTRAINT "uq_job_attempt" UNIQUE ("job_id", "attempt");


--
-- Name: jobs uq_job_event_type; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "uq_job_event_type" UNIQUE ("inbound_event_id", "job_type");


--
-- Name: outbox uq_outbox_idempotency; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."outbox"
    ADD CONSTRAINT "uq_outbox_idempotency" UNIQUE ("idempotency_key");


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_business_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."zettle_oauth_tokens"
    ADD CONSTRAINT "zettle_oauth_tokens_business_id_key" UNIQUE ("business_id");


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."zettle_oauth_tokens"
    ADD CONSTRAINT "zettle_oauth_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: ApplePushToken ApplePushToken_cardId_deviceToken_key; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."ApplePushToken"
    ADD CONSTRAINT "ApplePushToken_cardId_deviceToken_key" UNIQUE ("cardId", "deviceToken");


--
-- Name: ApplePushToken ApplePushToken_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."ApplePushToken"
    ADD CONSTRAINT "ApplePushToken_pkey" PRIMARY KEY ("id");


--
-- Name: BirthdayReward BirthdayReward_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."BirthdayReward"
    ADD CONSTRAINT "BirthdayReward_pkey" PRIMARY KEY ("id");


--
-- Name: GiftCard GiftCard_code_key; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."GiftCard"
    ADD CONSTRAINT "GiftCard_code_key" UNIQUE ("code");


--
-- Name: GiftCard GiftCard_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."GiftCard"
    ADD CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id");


--
-- Name: Location Location_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Location"
    ADD CONSTRAINT "Location_pkey" PRIMARY KEY ("id");


--
-- Name: LoyaltyCard LoyaltyCard_applePassSerial_key; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_applePassSerial_key" UNIQUE ("applePassSerial");


--
-- Name: LoyaltyCard LoyaltyCard_cardNumber_key; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_cardNumber_key" UNIQUE ("cardNumber");


--
-- Name: LoyaltyCard LoyaltyCard_googlePassObjectId_key; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_googlePassObjectId_key" UNIQUE ("googlePassObjectId");


--
-- Name: LoyaltyCard LoyaltyCard_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_pkey" PRIMARY KEY ("id");


--
-- Name: LoyaltyCard LoyaltyCard_qrToken_key; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_qrToken_key" UNIQUE ("qrToken");


--
-- Name: LoyaltyCard LoyaltyCard_userId_key; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_userId_key" UNIQUE ("userId");


--
-- Name: OtpVerification OtpVerification_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."OtpVerification"
    ADD CONSTRAINT "OtpVerification_pkey" PRIMARY KEY ("id");


--
-- Name: RewardConfig RewardConfig_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."RewardConfig"
    ADD CONSTRAINT "RewardConfig_pkey" PRIMARY KEY ("id");


--
-- Name: RewardRedemption RewardRedemption_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."RewardRedemption"
    ADD CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id");


--
-- Name: Session Session_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY ("id");


--
-- Name: Session Session_token_key; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Session"
    ADD CONSTRAINT "Session_token_key" UNIQUE ("token");


--
-- Name: Tenant Tenant_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Tenant"
    ADD CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id");


--
-- Name: Tenant Tenant_slug_key; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Tenant"
    ADD CONSTRAINT "Tenant_slug_key" UNIQUE ("slug");


--
-- Name: Transaction Transaction_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Transaction"
    ADD CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id");


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");


--
-- Name: Visit Visit_pkey; Type: CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Visit"
    ADD CONSTRAINT "Visit_pkey" PRIMARY KEY ("id");


--
-- Name: ai_turn_logs_business_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "ai_turn_logs_business_id_idx" ON "conversaflow"."ai_turn_logs" USING "btree" ("business_id");


--
-- Name: ai_turn_logs_conversation_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "ai_turn_logs_conversation_id_idx" ON "conversaflow"."ai_turn_logs" USING "btree" ("conversation_id");


--
-- Name: ai_turn_logs_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "ai_turn_logs_created_at_idx" ON "conversaflow"."ai_turn_logs" USING "btree" ("created_at" DESC);


--
-- Name: ai_turn_logs_customer_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "ai_turn_logs_customer_id_idx" ON "conversaflow"."ai_turn_logs" USING "btree" ("customer_id");


--
-- Name: ai_turn_logs_model_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "ai_turn_logs_model_idx" ON "conversaflow"."ai_turn_logs" USING "btree" ("model");


--
-- Name: ai_turn_logs_request_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "ai_turn_logs_request_id_idx" ON "conversaflow"."ai_turn_logs" USING "btree" ("request_id") WHERE ("request_id" IS NOT NULL);


--
-- Name: ai_turn_logs_response_type_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "ai_turn_logs_response_type_idx" ON "conversaflow"."ai_turn_logs" USING "btree" ("response_type");


--
-- Name: business_config_changes_business_id_changed_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "business_config_changes_business_id_changed_at_idx" ON "conversaflow"."business_config_changes" USING "btree" ("business_id", "changed_at" DESC);


--
-- Name: businesses_expr_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE UNIQUE INDEX "businesses_expr_idx" ON "conversaflow"."businesses" USING "btree" ((("config" ->> 'slack_channel_id'::"text"))) WHERE (COALESCE(("config" ->> 'slack_channel_id'::"text"), ''::"text") <> ''::"text");


--
-- Name: INDEX "businesses_expr_idx"; Type: COMMENT; Schema: conversaflow; Owner: postgres
--

COMMENT ON INDEX "conversaflow"."businesses_expr_idx" IS 'Ensures each Slack channel maps to at most one business tenant.';


--
-- Name: conversaflow_outbox_business_created_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "conversaflow_outbox_business_created_idx" ON "conversaflow"."outbox" USING "btree" ("business_id", "created_at" DESC);


--
-- Name: conversaflow_outbox_deliverable_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "conversaflow_outbox_deliverable_idx" ON "conversaflow"."outbox" USING "btree" ("next_run_at") WHERE ("state" = 'pending'::"text");


--
-- Name: conversaflow_outbox_job_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "conversaflow_outbox_job_idx" ON "conversaflow"."outbox" USING "btree" ("job_id") WHERE ("job_id" IS NOT NULL);


--
-- Name: conversation_outcomes_business_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "conversation_outcomes_business_id_idx" ON "conversaflow"."conversation_outcomes" USING "btree" ("business_id");


--
-- Name: conversation_outcomes_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "conversation_outcomes_created_at_idx" ON "conversaflow"."conversation_outcomes" USING "btree" ("created_at" DESC);


--
-- Name: conversation_outcomes_customer_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "conversation_outcomes_customer_id_idx" ON "conversaflow"."conversation_outcomes" USING "btree" ("customer_id");


--
-- Name: conversation_outcomes_outcome_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "conversation_outcomes_outcome_idx" ON "conversaflow"."conversation_outcomes" USING "btree" ("outcome");


--
-- Name: conversation_turns_conversation_id_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "conversation_turns_conversation_id_created_at_idx" ON "conversaflow"."conversation_turns" USING "btree" ("conversation_id", "created_at" DESC);


--
-- Name: conversation_turns_conversation_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE UNIQUE INDEX "conversation_turns_conversation_id_idx" ON "conversaflow"."conversation_turns" USING "btree" ("conversation_id") WHERE ("status" = ANY (ARRAY['buffering'::"text", 'released'::"text", 'processing'::"text", 'clarification_needed'::"text"]));


--
-- Name: conversation_turns_status_hold_until_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "conversation_turns_status_hold_until_idx" ON "conversaflow"."conversation_turns" USING "btree" ("status", "hold_until");


--
-- Name: conversations_customer_id_business_id_status_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "conversations_customer_id_business_id_status_idx" ON "conversaflow"."conversations" USING "btree" ("customer_id", "business_id", "status");


--
-- Name: customer_preferences_last_transaction_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "customer_preferences_last_transaction_at_idx" ON "conversaflow"."customer_preferences" USING "btree" ("last_transaction_at" DESC);


--
-- Name: customers_business_id_phone_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "customers_business_id_phone_idx" ON "conversaflow"."customers" USING "btree" ("business_id", "phone");


--
-- Name: daily_summaries_business_id_summary_date_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "daily_summaries_business_id_summary_date_idx" ON "conversaflow"."daily_summaries" USING "btree" ("business_id", "summary_date" DESC);


--
-- Name: dashboard_users_auth_user_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "dashboard_users_auth_user_id_idx" ON "conversaflow"."dashboard_users" USING "btree" ("auth_user_id");


--
-- Name: edge_function_logs_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "edge_function_logs_created_at_idx" ON "conversaflow"."edge_function_logs" USING "btree" ("created_at" DESC);


--
-- Name: edge_function_logs_function_name_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "edge_function_logs_function_name_idx" ON "conversaflow"."edge_function_logs" USING "btree" ("function_name");


--
-- Name: edge_function_logs_request_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "edge_function_logs_request_id_idx" ON "conversaflow"."edge_function_logs" USING "btree" ("request_id") WHERE ("request_id" IS NOT NULL);


--
-- Name: edge_function_logs_status_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "edge_function_logs_status_idx" ON "conversaflow"."edge_function_logs" USING "btree" ("status");


--
-- Name: eval_traces_agreement_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "eval_traces_agreement_idx" ON "conversaflow"."eval_traces" USING "btree" ("agreement", "created_at" DESC);


--
-- Name: eval_traces_conversation_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "eval_traces_conversation_created_at_idx" ON "conversaflow"."eval_traces" USING "btree" ("conversation_id", "created_at" DESC);


--
-- Name: eval_traces_turn_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "eval_traces_turn_id_idx" ON "conversaflow"."eval_traces" USING "btree" ("turn_id") WHERE ("turn_id" IS NOT NULL);


--
-- Name: inbound_events_business_id_received_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "inbound_events_business_id_received_at_idx" ON "conversaflow"."inbound_events" USING "btree" ("business_id", "received_at" DESC);


--
-- Name: inbound_events_status_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "inbound_events_status_idx" ON "conversaflow"."inbound_events" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['accepted'::"text", 'processing'::"text"]));


--
-- Name: jobs_aggregate_type_aggregate_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "jobs_aggregate_type_aggregate_id_idx" ON "conversaflow"."jobs" USING "btree" ("aggregate_type", "aggregate_id");


--
-- Name: jobs_business_id_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "jobs_business_id_created_at_idx" ON "conversaflow"."jobs" USING "btree" ("business_id", "created_at" DESC);


--
-- Name: jobs_locked_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "jobs_locked_at_idx" ON "conversaflow"."jobs" USING "btree" ("locked_at") WHERE ("state" = 'claimed'::"text");


--
-- Name: jobs_priority_next_run_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "jobs_priority_next_run_at_idx" ON "conversaflow"."jobs" USING "btree" ("priority" DESC, "next_run_at") WHERE ("state" = 'pending'::"text");


--
-- Name: messages_conversation_id_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "messages_conversation_id_created_at_idx" ON "conversaflow"."messages" USING "btree" ("conversation_id", "created_at");


--
-- Name: messages_conversation_id_created_at_idx1; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "messages_conversation_id_created_at_idx1" ON "conversaflow"."messages" USING "btree" ("conversation_id", "created_at");


--
-- Name: messages_embedding_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "messages_embedding_idx" ON "conversaflow"."messages" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');


--
-- Name: messages_twilio_message_sid_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE UNIQUE INDEX "messages_twilio_message_sid_idx" ON "conversaflow"."messages" USING "btree" ("twilio_message_sid") WHERE ("twilio_message_sid" IS NOT NULL);


--
-- Name: outbox_business_id_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "outbox_business_id_created_at_idx" ON "conversaflow"."outbox" USING "btree" ("business_id", "created_at" DESC);


--
-- Name: outbox_job_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "outbox_job_id_idx" ON "conversaflow"."outbox" USING "btree" ("job_id") WHERE ("job_id" IS NOT NULL);


--
-- Name: outbox_next_run_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "outbox_next_run_at_idx" ON "conversaflow"."outbox" USING "btree" ("next_run_at") WHERE ("state" = 'pending'::"text");


--
-- Name: pipeline_traces_conversation_ts_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "pipeline_traces_conversation_ts_idx" ON "conversaflow"."pipeline_traces" USING "btree" ("conversation_id", "ts" DESC) WHERE ("conversation_id" IS NOT NULL);


--
-- Name: pipeline_traces_failures_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "pipeline_traces_failures_idx" ON "conversaflow"."pipeline_traces" USING "btree" ("ts" DESC) WHERE ("event" = ANY (ARRAY['failed'::"text", 'dead'::"text"]));


--
-- Name: pipeline_traces_trace_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "pipeline_traces_trace_id_idx" ON "conversaflow"."pipeline_traces" USING "btree" ("trace_id");


--
-- Name: pipeline_traces_turn_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "pipeline_traces_turn_id_idx" ON "conversaflow"."pipeline_traces" USING "btree" ("turn_id") WHERE ("turn_id" IS NOT NULL);


--
-- Name: products_business_id_available_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "products_business_id_available_idx" ON "conversaflow"."products" USING "btree" ("business_id", "available");


--
-- Name: products_name_embedding_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "products_name_embedding_idx" ON "conversaflow"."products" USING "hnsw" ("name_embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');


--
-- Name: products_name_trgm_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "products_name_trgm_idx" ON "conversaflow"."products" USING "gin" ("lower"("name") "extensions"."gin_trgm_ops");


--
-- Name: products_zettle_uuid_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE UNIQUE INDEX "products_zettle_uuid_idx" ON "conversaflow"."products" USING "btree" ("zettle_uuid") WHERE ("zettle_uuid" IS NOT NULL);


--
-- Name: security_logs_event_type_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "security_logs_event_type_idx" ON "conversaflow"."security_logs" USING "btree" ("event_type");


--
-- Name: security_logs_phone_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "security_logs_phone_idx" ON "conversaflow"."security_logs" USING "btree" ("phone");


--
-- Name: security_logs_request_id_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "security_logs_request_id_idx" ON "conversaflow"."security_logs" USING "btree" ("request_id") WHERE ("request_id" IS NOT NULL);


--
-- Name: security_logs_timestamp_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "security_logs_timestamp_idx" ON "conversaflow"."security_logs" USING "btree" ("timestamp" DESC);


--
-- Name: transaction_status_events_acted_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "transaction_status_events_acted_at_idx" ON "conversaflow"."transaction_status_events" USING "btree" ("acted_at" DESC);


--
-- Name: transaction_status_events_transaction_id_acted_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "transaction_status_events_transaction_id_acted_at_idx" ON "conversaflow"."transaction_status_events" USING "btree" ("transaction_id", "acted_at" DESC);


--
-- Name: transactions_business_id_created_at_idx; Type: INDEX; Schema: conversaflow; Owner: postgres
--

CREATE INDEX "transactions_business_id_created_at_idx" ON "conversaflow"."transactions" USING "btree" ("business_id", "created_at");


--
-- Name: kds_device_sessions_business_active_idx; Type: INDEX; Schema: kds; Owner: postgres
--

CREATE INDEX "kds_device_sessions_business_active_idx" ON "kds"."device_sessions" USING "btree" ("business_id", "is_active");


--
-- Name: kds_ticket_events_business_sequence_idx; Type: INDEX; Schema: kds; Owner: postgres
--

CREATE INDEX "kds_ticket_events_business_sequence_idx" ON "kds"."ticket_events" USING "btree" ("business_id", "sequence");


--
-- Name: kds_ticket_events_ticket_sequence_idx; Type: INDEX; Schema: kds; Owner: postgres
--

CREATE INDEX "kds_ticket_events_ticket_sequence_idx" ON "kds"."ticket_events" USING "btree" ("ticket_id", "sequence" DESC);


--
-- Name: kds_ticket_items_ticket_idx; Type: INDEX; Schema: kds; Owner: postgres
--

CREATE INDEX "kds_ticket_items_ticket_idx" ON "kds"."ticket_items" USING "btree" ("ticket_id", "display_order");


--
-- Name: kds_tickets_business_status_created_idx; Type: INDEX; Schema: kds; Owner: postgres
--

CREATE INDEX "kds_tickets_business_status_created_idx" ON "kds"."tickets" USING "btree" ("business_id", "status", "created_at");


--
-- Name: kds_tickets_business_updated_idx; Type: INDEX; Schema: kds; Owner: postgres
--

CREATE INDEX "kds_tickets_business_updated_idx" ON "kds"."tickets" USING "btree" ("business_id", "updated_at" DESC);


--
-- Name: business_config_changes_business_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "business_config_changes_business_id_idx" ON "public"."business_config_changes" USING "btree" ("business_id", "changed_at" DESC);


--
-- Name: businesses_slack_channel_id_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "businesses_slack_channel_id_unique_idx" ON "public"."businesses" USING "btree" ((("config" ->> 'slack_channel_id'::"text"))) WHERE (COALESCE(("config" ->> 'slack_channel_id'::"text"), ''::"text") <> ''::"text");


--
-- Name: INDEX "businesses_slack_channel_id_unique_idx"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON INDEX "public"."businesses_slack_channel_id_unique_idx" IS 'Ensures each Slack channel maps to at most one business tenant.';


--
-- Name: conversation_turns_conversation_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "conversation_turns_conversation_created_idx" ON "public"."conversation_turns" USING "btree" ("conversation_id", "created_at" DESC);


--
-- Name: conversation_turns_one_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "conversation_turns_one_active_idx" ON "public"."conversation_turns" USING "btree" ("conversation_id") WHERE ("status" = ANY (ARRAY['buffering'::"text", 'released'::"text", 'processing'::"text", 'clarification_needed'::"text"]));


--
-- Name: conversation_turns_status_hold_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "conversation_turns_status_hold_idx" ON "public"."conversation_turns" USING "btree" ("status", "hold_until");


--
-- Name: daily_summaries_business_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "daily_summaries_business_date_idx" ON "public"."daily_summaries" USING "btree" ("business_id", "summary_date" DESC);


--
-- Name: idx_ai_turn_logs_request_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_ai_turn_logs_request_id" ON "public"."ai_turn_logs" USING "btree" ("request_id") WHERE ("request_id" IS NOT NULL);


--
-- Name: idx_atl_business_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_atl_business_id" ON "public"."ai_turn_logs" USING "btree" ("business_id");


--
-- Name: idx_atl_conversation_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_atl_conversation_id" ON "public"."ai_turn_logs" USING "btree" ("conversation_id");


--
-- Name: idx_atl_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_atl_created_at" ON "public"."ai_turn_logs" USING "btree" ("created_at" DESC);


--
-- Name: idx_atl_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_atl_customer_id" ON "public"."ai_turn_logs" USING "btree" ("customer_id");


--
-- Name: idx_atl_model; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_atl_model" ON "public"."ai_turn_logs" USING "btree" ("model");


--
-- Name: idx_atl_response_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_atl_response_type" ON "public"."ai_turn_logs" USING "btree" ("response_type");


--
-- Name: idx_co_business_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_co_business_id" ON "public"."conversation_outcomes" USING "btree" ("business_id");


--
-- Name: idx_co_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_co_created_at" ON "public"."conversation_outcomes" USING "btree" ("created_at" DESC);


--
-- Name: idx_co_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_co_customer_id" ON "public"."conversation_outcomes" USING "btree" ("customer_id");


--
-- Name: idx_co_outcome; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_co_outcome" ON "public"."conversation_outcomes" USING "btree" ("outcome");


--
-- Name: idx_conversations_customer_business; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_conversations_customer_business" ON "public"."conversations" USING "btree" ("customer_id", "business_id", "status");


--
-- Name: idx_customers_phone; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_customers_phone" ON "public"."customers" USING "btree" ("business_id", "phone");


--
-- Name: idx_dashboard_users_auth; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_dashboard_users_auth" ON "public"."dashboard_users" USING "btree" ("auth_user_id");


--
-- Name: idx_edge_function_logs_request_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_edge_function_logs_request_id" ON "public"."edge_function_logs" USING "btree" ("request_id") WHERE ("request_id" IS NOT NULL);


--
-- Name: idx_efl_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_efl_created_at" ON "public"."edge_function_logs" USING "btree" ("created_at" DESC);


--
-- Name: idx_efl_function_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_efl_function_name" ON "public"."edge_function_logs" USING "btree" ("function_name");


--
-- Name: idx_efl_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_efl_status" ON "public"."edge_function_logs" USING "btree" ("status");


--
-- Name: idx_messages_conv_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_messages_conv_created" ON "public"."messages" USING "btree" ("conversation_id", "created_at");


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_messages_conversation" ON "public"."messages" USING "btree" ("conversation_id", "created_at");


--
-- Name: idx_messages_embedding_hnsw; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_messages_embedding_hnsw" ON "public"."messages" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');


--
-- Name: idx_messages_twilio_sid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_messages_twilio_sid" ON "public"."messages" USING "btree" ("twilio_message_sid") WHERE ("twilio_message_sid" IS NOT NULL);


--
-- Name: idx_preferences_last_transaction; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_preferences_last_transaction" ON "public"."customer_preferences" USING "btree" ("last_transaction_at" DESC);


--
-- Name: idx_products_zettle_uuid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "idx_products_zettle_uuid" ON "public"."products" USING "btree" ("zettle_uuid") WHERE ("zettle_uuid" IS NOT NULL);


--
-- Name: idx_security_logs_event_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_security_logs_event_type" ON "public"."security_logs" USING "btree" ("event_type");


--
-- Name: idx_security_logs_phone; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_security_logs_phone" ON "public"."security_logs" USING "btree" ("phone");


--
-- Name: idx_security_logs_request_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_security_logs_request_id" ON "public"."security_logs" USING "btree" ("request_id") WHERE ("request_id" IS NOT NULL);


--
-- Name: idx_security_logs_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_security_logs_timestamp" ON "public"."security_logs" USING "btree" ("timestamp" DESC);


--
-- Name: idx_services_available; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_services_available" ON "public"."products" USING "btree" ("business_id", "available");


--
-- Name: idx_transactions_business; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_transactions_business" ON "public"."transactions" USING "btree" ("business_id", "created_at");


--
-- Name: inbound_events_business_received_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "inbound_events_business_received_idx" ON "public"."inbound_events" USING "btree" ("business_id", "received_at" DESC);


--
-- Name: inbound_events_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "inbound_events_status_idx" ON "public"."inbound_events" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['accepted'::"text", 'processing'::"text"]));


--
-- Name: jobs_aggregate_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "jobs_aggregate_idx" ON "public"."jobs" USING "btree" ("aggregate_type", "aggregate_id");


--
-- Name: jobs_business_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "jobs_business_created_idx" ON "public"."jobs" USING "btree" ("business_id", "created_at" DESC);


--
-- Name: jobs_claimable_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "jobs_claimable_idx" ON "public"."jobs" USING "btree" ("priority" DESC, "next_run_at") WHERE ("state" = 'pending'::"text");


--
-- Name: jobs_locked_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "jobs_locked_idx" ON "public"."jobs" USING "btree" ("locked_at") WHERE ("state" = 'claimed'::"text");


--
-- Name: outbox_business_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "outbox_business_created_idx" ON "public"."outbox" USING "btree" ("business_id", "created_at" DESC);


--
-- Name: outbox_deliverable_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "outbox_deliverable_idx" ON "public"."outbox" USING "btree" ("next_run_at") WHERE ("state" = 'pending'::"text");


--
-- Name: outbox_job_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "outbox_job_idx" ON "public"."outbox" USING "btree" ("job_id") WHERE ("job_id" IS NOT NULL);


--
-- Name: pipeline_traces_conversation_ts_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "pipeline_traces_conversation_ts_idx" ON "public"."pipeline_traces" USING "btree" ("conversation_id", "ts" DESC) WHERE ("conversation_id" IS NOT NULL);


--
-- Name: pipeline_traces_failures_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "pipeline_traces_failures_idx" ON "public"."pipeline_traces" USING "btree" ("ts" DESC) WHERE ("event" = ANY (ARRAY['failed'::"text", 'dead'::"text"]));


--
-- Name: pipeline_traces_trace_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "pipeline_traces_trace_id_idx" ON "public"."pipeline_traces" USING "btree" ("trace_id");


--
-- Name: pipeline_traces_turn_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "pipeline_traces_turn_id_idx" ON "public"."pipeline_traces" USING "btree" ("turn_id") WHERE ("turn_id" IS NOT NULL);


--
-- Name: products_name_embedding_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "products_name_embedding_idx" ON "public"."products" USING "hnsw" ("name_embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');


--
-- Name: transaction_status_events_acted_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "transaction_status_events_acted_at_idx" ON "public"."transaction_status_events" USING "btree" ("acted_at" DESC);


--
-- Name: transaction_status_events_txn_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "transaction_status_events_txn_idx" ON "public"."transaction_status_events" USING "btree" ("transaction_id", "acted_at" DESC);


--
-- Name: BirthdayReward_expiresAt_status_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "BirthdayReward_expiresAt_status_idx" ON "umi_cash"."BirthdayReward" USING "btree" ("expiresAt", "status");


--
-- Name: BirthdayReward_loyaltyCardId_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "BirthdayReward_loyaltyCardId_idx" ON "umi_cash"."BirthdayReward" USING "btree" ("loyaltyCardId");


--
-- Name: BirthdayReward_loyaltyCardId_tenantId_year_key; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE UNIQUE INDEX "BirthdayReward_loyaltyCardId_tenantId_year_key" ON "umi_cash"."BirthdayReward" USING "btree" ("loyaltyCardId", "tenantId", "year");


--
-- Name: BirthdayReward_tenantId_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "BirthdayReward_tenantId_idx" ON "umi_cash"."BirthdayReward" USING "btree" ("tenantId");


--
-- Name: GiftCard_code_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "GiftCard_code_idx" ON "umi_cash"."GiftCard" USING "btree" ("code");


--
-- Name: GiftCard_tenantId_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "GiftCard_tenantId_idx" ON "umi_cash"."GiftCard" USING "btree" ("tenantId");


--
-- Name: GiftCard_tenantId_isRedeemed_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "GiftCard_tenantId_isRedeemed_idx" ON "umi_cash"."GiftCard" USING "btree" ("tenantId", "isRedeemed");


--
-- Name: Location_tenantId_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "Location_tenantId_idx" ON "umi_cash"."Location" USING "btree" ("tenantId");


--
-- Name: LoyaltyCard_tenantId_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "LoyaltyCard_tenantId_idx" ON "umi_cash"."LoyaltyCard" USING "btree" ("tenantId");


--
-- Name: RewardConfig_tenantId_isActive_activatedAt_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "RewardConfig_tenantId_isActive_activatedAt_idx" ON "umi_cash"."RewardConfig" USING "btree" ("tenantId", "isActive", "activatedAt");


--
-- Name: RewardRedemption_cardId_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "RewardRedemption_cardId_idx" ON "umi_cash"."RewardRedemption" USING "btree" ("cardId");


--
-- Name: Session_token_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "Session_token_idx" ON "umi_cash"."Session" USING "btree" ("token");


--
-- Name: Transaction_cardId_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "Transaction_cardId_idx" ON "umi_cash"."Transaction" USING "btree" ("cardId");


--
-- Name: Transaction_cardId_type_createdAt_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "Transaction_cardId_type_createdAt_idx" ON "umi_cash"."Transaction" USING "btree" ("cardId", "type", "createdAt");


--
-- Name: Transaction_createdAt_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "Transaction_createdAt_idx" ON "umi_cash"."Transaction" USING "btree" ("createdAt");


--
-- Name: Transaction_staffId_type_createdAt_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "Transaction_staffId_type_createdAt_idx" ON "umi_cash"."Transaction" USING "btree" ("staffId", "type", "createdAt");


--
-- Name: User_tenantId_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "User_tenantId_idx" ON "umi_cash"."User" USING "btree" ("tenantId");


--
-- Name: User_tenantId_role_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "User_tenantId_role_idx" ON "umi_cash"."User" USING "btree" ("tenantId", "role");


--
-- Name: Visit_cardId_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "Visit_cardId_idx" ON "umi_cash"."Visit" USING "btree" ("cardId");


--
-- Name: Visit_cardId_scannedAt_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "Visit_cardId_scannedAt_idx" ON "umi_cash"."Visit" USING "btree" ("cardId", "scannedAt");


--
-- Name: Visit_scannedAt_idx; Type: INDEX; Schema: umi_cash; Owner: postgres
--

CREATE INDEX "Visit_scannedAt_idx" ON "umi_cash"."Visit" USING "btree" ("scannedAt");


--
-- Name: transactions trg_kds_project_transaction; Type: TRIGGER; Schema: conversaflow; Owner: postgres
--

CREATE TRIGGER "trg_kds_project_transaction" AFTER INSERT OR UPDATE OF "status", "details", "total_amount" ON "conversaflow"."transactions" FOR EACH ROW EXECUTE FUNCTION "kds"."project_transaction_trigger"();


--
-- Name: jobs trg_wake_job_worker; Type: TRIGGER; Schema: conversaflow; Owner: postgres
--

CREATE TRIGGER "trg_wake_job_worker" AFTER INSERT ON "conversaflow"."jobs" FOR EACH ROW WHEN ((("new"."state" = 'pending'::"text") AND ("new"."priority" >= 100))) EXECUTE FUNCTION "conversaflow"."wake_job_worker_on_insert"();


--
-- Name: transactions on_transaction_completed; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "on_transaction_completed" AFTER INSERT ON "public"."transactions" FOR EACH ROW WHEN (("new"."status" = 'completed'::"text")) EXECUTE FUNCTION "public"."update_customer_prefs"();


--
-- Name: products products_embedding_invalidate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "products_embedding_invalidate" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."products_invalidate_embedding"();


--
-- Name: zettle_oauth_tokens update_zettle_oauth_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER "update_zettle_oauth_tokens_updated_at" BEFORE UPDATE ON "public"."zettle_oauth_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: ai_turn_logs ai_turn_logs_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."ai_turn_logs"
    ADD CONSTRAINT "ai_turn_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: ai_turn_logs ai_turn_logs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."ai_turn_logs"
    ADD CONSTRAINT "ai_turn_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversaflow"."conversations"("id");


--
-- Name: ai_turn_logs ai_turn_logs_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."ai_turn_logs"
    ADD CONSTRAINT "ai_turn_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "conversaflow"."customers"("id");


--
-- Name: conversation_outcomes conversation_outcomes_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversation_outcomes"
    ADD CONSTRAINT "conversation_outcomes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: conversation_outcomes conversation_outcomes_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversation_outcomes"
    ADD CONSTRAINT "conversation_outcomes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversaflow"."conversations"("id");


--
-- Name: conversation_outcomes conversation_outcomes_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversation_outcomes"
    ADD CONSTRAINT "conversation_outcomes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "conversaflow"."customers"("id");


--
-- Name: conversation_turns conversation_turns_assistant_message_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_assistant_message_id_fkey" FOREIGN KEY ("assistant_message_id") REFERENCES "conversaflow"."messages"("id");


--
-- Name: conversation_turns conversation_turns_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: conversation_turns conversation_turns_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversaflow"."conversations"("id");


--
-- Name: conversation_turns conversation_turns_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "conversaflow"."customers"("id");


--
-- Name: conversations conversations_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversations"
    ADD CONSTRAINT "conversations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: conversations conversations_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."conversations"
    ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "conversaflow"."customers"("id");


--
-- Name: customer_preferences customer_preferences_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "conversaflow"."customers"("id");


--
-- Name: customers customers_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."customers"
    ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: dashboard_users dashboard_users_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."dashboard_users"
    ADD CONSTRAINT "dashboard_users_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: inbound_events inbound_events_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."inbound_events"
    ADD CONSTRAINT "inbound_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: job_attempts job_attempts_job_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."job_attempts"
    ADD CONSTRAINT "job_attempts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "conversaflow"."jobs"("id") ON DELETE CASCADE;


--
-- Name: jobs jobs_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."jobs"
    ADD CONSTRAINT "jobs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: jobs jobs_inbound_event_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."jobs"
    ADD CONSTRAINT "jobs_inbound_event_id_fkey" FOREIGN KEY ("inbound_event_id") REFERENCES "conversaflow"."inbound_events"("id");


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversaflow"."conversations"("id");


--
-- Name: outbox outbox_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."outbox"
    ADD CONSTRAINT "outbox_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: outbox outbox_job_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."outbox"
    ADD CONSTRAINT "outbox_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "conversaflow"."jobs"("id");


--
-- Name: products services_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."products"
    ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: transaction_status_events transaction_status_events_transaction_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."transaction_status_events"
    ADD CONSTRAINT "transaction_status_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "conversaflow"."transactions"("id") ON DELETE CASCADE;


--
-- Name: transactions transactions_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."transactions"
    ADD CONSTRAINT "transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: transactions transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."transactions"
    ADD CONSTRAINT "transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "conversaflow"."customers"("id");


--
-- Name: transactions transactions_service_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."transactions"
    ADD CONSTRAINT "transactions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "conversaflow"."products"("id");


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_business_id_fkey; Type: FK CONSTRAINT; Schema: conversaflow; Owner: postgres
--

ALTER TABLE ONLY "conversaflow"."zettle_oauth_tokens"
    ADD CONSTRAINT "zettle_oauth_tokens_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id");


--
-- Name: device_sessions device_sessions_business_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."device_sessions"
    ADD CONSTRAINT "device_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id") ON DELETE CASCADE;


--
-- Name: ticket_events ticket_events_business_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."ticket_events"
    ADD CONSTRAINT "ticket_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id") ON DELETE CASCADE;


--
-- Name: ticket_events ticket_events_source_transaction_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."ticket_events"
    ADD CONSTRAINT "ticket_events_source_transaction_id_fkey" FOREIGN KEY ("source_transaction_id") REFERENCES "conversaflow"."transactions"("id") ON DELETE CASCADE;


--
-- Name: ticket_events ticket_events_ticket_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."ticket_events"
    ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "kds"."tickets"("ticket_id") ON DELETE CASCADE;


--
-- Name: ticket_items ticket_items_source_transaction_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."ticket_items"
    ADD CONSTRAINT "ticket_items_source_transaction_id_fkey" FOREIGN KEY ("source_transaction_id") REFERENCES "conversaflow"."transactions"("id") ON DELETE CASCADE;


--
-- Name: ticket_items ticket_items_ticket_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."ticket_items"
    ADD CONSTRAINT "ticket_items_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "kds"."tickets"("ticket_id") ON DELETE CASCADE;


--
-- Name: tickets tickets_business_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."tickets"
    ADD CONSTRAINT "tickets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "conversaflow"."businesses"("id") ON DELETE CASCADE;


--
-- Name: tickets tickets_customer_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."tickets"
    ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "conversaflow"."customers"("id") ON DELETE SET NULL;


--
-- Name: tickets tickets_source_transaction_id_fkey; Type: FK CONSTRAINT; Schema: kds; Owner: postgres
--

ALTER TABLE ONLY "kds"."tickets"
    ADD CONSTRAINT "tickets_source_transaction_id_fkey" FOREIGN KEY ("source_transaction_id") REFERENCES "conversaflow"."transactions"("id") ON DELETE CASCADE;


--
-- Name: ai_turn_logs ai_turn_logs_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ai_turn_logs"
    ADD CONSTRAINT "ai_turn_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE SET NULL;


--
-- Name: ai_turn_logs ai_turn_logs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ai_turn_logs"
    ADD CONSTRAINT "ai_turn_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL;


--
-- Name: ai_turn_logs ai_turn_logs_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ai_turn_logs"
    ADD CONSTRAINT "ai_turn_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: conversation_outcomes conversation_outcomes_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversation_outcomes"
    ADD CONSTRAINT "conversation_outcomes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE SET NULL;


--
-- Name: conversation_outcomes conversation_outcomes_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversation_outcomes"
    ADD CONSTRAINT "conversation_outcomes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL;


--
-- Name: conversation_outcomes conversation_outcomes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversation_outcomes"
    ADD CONSTRAINT "conversation_outcomes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;


--
-- Name: conversation_turns conversation_turns_assistant_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_assistant_message_id_fkey" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."messages"("id") ON DELETE SET NULL;


--
-- Name: conversation_turns conversation_turns_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;


--
-- Name: conversation_turns conversation_turns_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;


--
-- Name: conversation_turns conversation_turns_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;


--
-- Name: conversations conversations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");


--
-- Name: conversations conversations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");


--
-- Name: customer_preferences customer_preferences_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;


--
-- Name: customers customers_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");


--
-- Name: dashboard_users dashboard_users_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dashboard_users"
    ADD CONSTRAINT "dashboard_users_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: dashboard_users dashboard_users_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dashboard_users"
    ADD CONSTRAINT "dashboard_users_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");


--
-- Name: inbound_events inbound_events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."inbound_events"
    ADD CONSTRAINT "inbound_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");


--
-- Name: job_attempts job_attempts_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."job_attempts"
    ADD CONSTRAINT "job_attempts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;


--
-- Name: jobs jobs_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");


--
-- Name: jobs jobs_inbound_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_inbound_event_id_fkey" FOREIGN KEY ("inbound_event_id") REFERENCES "public"."inbound_events"("id");


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id");


--
-- Name: outbox outbox_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."outbox"
    ADD CONSTRAINT "outbox_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");


--
-- Name: outbox outbox_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."outbox"
    ADD CONSTRAINT "outbox_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE SET NULL;


--
-- Name: products services_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");


--
-- Name: transaction_status_events transaction_status_events_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."transaction_status_events"
    ADD CONSTRAINT "transaction_status_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE CASCADE;


--
-- Name: transactions transactions_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");


--
-- Name: transactions transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");


--
-- Name: transactions transactions_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."products"("id");


--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."zettle_oauth_tokens"
    ADD CONSTRAINT "zettle_oauth_tokens_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");


--
-- Name: ApplePushToken ApplePushToken_cardId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."ApplePushToken"
    ADD CONSTRAINT "ApplePushToken_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "umi_cash"."LoyaltyCard"("id") ON DELETE CASCADE;


--
-- Name: BirthdayReward BirthdayReward_loyaltyCardId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."BirthdayReward"
    ADD CONSTRAINT "BirthdayReward_loyaltyCardId_fkey" FOREIGN KEY ("loyaltyCardId") REFERENCES "umi_cash"."LoyaltyCard"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BirthdayReward BirthdayReward_tenantId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."BirthdayReward"
    ADD CONSTRAINT "BirthdayReward_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "umi_cash"."Tenant"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: GiftCard GiftCard_createdByStaffId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."GiftCard"
    ADD CONSTRAINT "GiftCard_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "umi_cash"."User"("id");


--
-- Name: GiftCard GiftCard_redeemedCardId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."GiftCard"
    ADD CONSTRAINT "GiftCard_redeemedCardId_fkey" FOREIGN KEY ("redeemedCardId") REFERENCES "umi_cash"."LoyaltyCard"("id");


--
-- Name: GiftCard GiftCard_tenantId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."GiftCard"
    ADD CONSTRAINT "GiftCard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "umi_cash"."Tenant"("id") ON DELETE CASCADE;


--
-- Name: Location Location_tenantId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Location"
    ADD CONSTRAINT "Location_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "umi_cash"."Tenant"("id") ON DELETE CASCADE;


--
-- Name: LoyaltyCard LoyaltyCard_tenantId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "umi_cash"."Tenant"("id");


--
-- Name: LoyaltyCard LoyaltyCard_userId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."LoyaltyCard"
    ADD CONSTRAINT "LoyaltyCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "umi_cash"."User"("id") ON DELETE CASCADE;


--
-- Name: RewardConfig RewardConfig_tenantId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."RewardConfig"
    ADD CONSTRAINT "RewardConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "umi_cash"."Tenant"("id");


--
-- Name: RewardRedemption RewardRedemption_cardId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."RewardRedemption"
    ADD CONSTRAINT "RewardRedemption_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "umi_cash"."LoyaltyCard"("id");


--
-- Name: RewardRedemption RewardRedemption_configId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."RewardRedemption"
    ADD CONSTRAINT "RewardRedemption_configId_fkey" FOREIGN KEY ("configId") REFERENCES "umi_cash"."RewardConfig"("id");


--
-- Name: RewardRedemption RewardRedemption_staffId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."RewardRedemption"
    ADD CONSTRAINT "RewardRedemption_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "umi_cash"."User"("id");


--
-- Name: Session Session_userId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Session"
    ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "umi_cash"."User"("id") ON DELETE CASCADE;


--
-- Name: Transaction Transaction_cardId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Transaction"
    ADD CONSTRAINT "Transaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "umi_cash"."LoyaltyCard"("id");


--
-- Name: Transaction Transaction_staffId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Transaction"
    ADD CONSTRAINT "Transaction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "umi_cash"."User"("id");


--
-- Name: User User_tenantId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."User"
    ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "umi_cash"."Tenant"("id");


--
-- Name: Visit Visit_cardId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Visit"
    ADD CONSTRAINT "Visit_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "umi_cash"."LoyaltyCard"("id");


--
-- Name: Visit Visit_staffId_fkey; Type: FK CONSTRAINT; Schema: umi_cash; Owner: postgres
--

ALTER TABLE ONLY "umi_cash"."Visit"
    ADD CONSTRAINT "Visit_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "umi_cash"."User"("id");


--
-- Name: ai_turn_logs; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."ai_turn_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_turn_logs ai_turn_logs_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "ai_turn_logs_member_select" ON "conversaflow"."ai_turn_logs" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: business_config_changes; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."business_config_changes" ENABLE ROW LEVEL SECURITY;

--
-- Name: business_config_changes business_config_changes_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "business_config_changes_member_select" ON "conversaflow"."business_config_changes" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access_text"("business_id"));


--
-- Name: businesses; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."businesses" ENABLE ROW LEVEL SECURITY;

--
-- Name: businesses businesses_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "businesses_member_select" ON "conversaflow"."businesses" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("id"));


--
-- Name: conversation_outcomes; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."conversation_outcomes" ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_outcomes conversation_outcomes_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "conversation_outcomes_member_select" ON "conversaflow"."conversation_outcomes" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: conversation_turns; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."conversation_turns" ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_turns conversation_turns_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "conversation_turns_member_select" ON "conversaflow"."conversation_turns" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: conversations; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."conversations" ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations conversations_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "conversations_member_select" ON "conversaflow"."conversations" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: customer_preferences; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."customer_preferences" ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_preferences customer_preferences_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "customer_preferences_member_select" ON "conversaflow"."customer_preferences" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "conversaflow"."customers" "c"
  WHERE (("c"."id" = "customer_preferences"."customer_id") AND "public"."user_has_business_access"("c"."business_id")))));


--
-- Name: customers; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."customers" ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "customers_member_select" ON "conversaflow"."customers" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: daily_summaries; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."daily_summaries" ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_summaries daily_summaries_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "daily_summaries_member_select" ON "conversaflow"."daily_summaries" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access_text"("business_id"));


--
-- Name: dashboard_users; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."dashboard_users" ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_users dashboard_users_self_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "dashboard_users_self_select" ON "conversaflow"."dashboard_users" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "auth_user_id"));


--
-- Name: edge_function_logs; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."edge_function_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: edge_function_logs edge_function_logs_no_direct_access; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "edge_function_logs_no_direct_access" ON "conversaflow"."edge_function_logs" FOR SELECT TO "authenticated" USING (false);


--
-- Name: inbound_events; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."inbound_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: inbound_events inbound_events_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "inbound_events_member_select" ON "conversaflow"."inbound_events" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: job_attempts; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."job_attempts" ENABLE ROW LEVEL SECURITY;

--
-- Name: job_attempts job_attempts_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "job_attempts_member_select" ON "conversaflow"."job_attempts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "conversaflow"."jobs" "j"
  WHERE (("j"."id" = "job_attempts"."job_id") AND "public"."user_has_business_access"("j"."business_id")))));


--
-- Name: jobs; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."jobs" ENABLE ROW LEVEL SECURITY;

--
-- Name: jobs jobs_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "jobs_member_select" ON "conversaflow"."jobs" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: messages; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."messages" ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "messages_member_select" ON "conversaflow"."messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "conversaflow"."conversations" "c"
  WHERE (("c"."id" = "messages"."conversation_id") AND "public"."user_has_business_access"("c"."business_id")))));


--
-- Name: outbox; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."outbox" ENABLE ROW LEVEL SECURITY;

--
-- Name: outbox outbox_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "outbox_member_select" ON "conversaflow"."outbox" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: products; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."products" ENABLE ROW LEVEL SECURITY;

--
-- Name: products products_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "products_member_select" ON "conversaflow"."products" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: security_logs; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."security_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: security_logs security_logs_no_direct_access; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "security_logs_no_direct_access" ON "conversaflow"."security_logs" FOR SELECT TO "authenticated" USING (false);


--
-- Name: transaction_status_events; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."transaction_status_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_status_events transaction_status_events_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "transaction_status_events_member_select" ON "conversaflow"."transaction_status_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "conversaflow"."transactions" "t"
  WHERE (("t"."id" = "transaction_status_events"."transaction_id") AND "public"."user_has_business_access"("t"."business_id")))));


--
-- Name: transactions; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."transactions" ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions transactions_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "transactions_member_select" ON "conversaflow"."transactions" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: zettle_oauth_tokens; Type: ROW SECURITY; Schema: conversaflow; Owner: postgres
--

ALTER TABLE "conversaflow"."zettle_oauth_tokens" ENABLE ROW LEVEL SECURITY;

--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_member_select; Type: POLICY; Schema: conversaflow; Owner: postgres
--

CREATE POLICY "zettle_oauth_tokens_member_select" ON "conversaflow"."zettle_oauth_tokens" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: ticket_events kds_ticket_events_member_select; Type: POLICY; Schema: kds; Owner: postgres
--

CREATE POLICY "kds_ticket_events_member_select" ON "kds"."ticket_events" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: ticket_items kds_ticket_items_member_select; Type: POLICY; Schema: kds; Owner: postgres
--

CREATE POLICY "kds_ticket_items_member_select" ON "kds"."ticket_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "kds"."tickets" "t"
  WHERE (("t"."ticket_id" = "ticket_items"."ticket_id") AND "public"."user_has_business_access"("t"."business_id")))));


--
-- Name: tickets kds_tickets_member_select; Type: POLICY; Schema: kds; Owner: postgres
--

CREATE POLICY "kds_tickets_member_select" ON "kds"."tickets" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: ticket_events; Type: ROW SECURITY; Schema: kds; Owner: postgres
--

ALTER TABLE "kds"."ticket_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: ticket_items; Type: ROW SECURITY; Schema: kds; Owner: postgres
--

ALTER TABLE "kds"."ticket_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: tickets; Type: ROW SECURITY; Schema: kds; Owner: postgres
--

ALTER TABLE "kds"."tickets" ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_turn_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."ai_turn_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_turn_logs ai_turn_logs_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "ai_turn_logs_member_select" ON "public"."ai_turn_logs" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: business_config_changes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."business_config_changes" ENABLE ROW LEVEL SECURITY;

--
-- Name: business_config_changes business_config_changes_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "business_config_changes_member_select" ON "public"."business_config_changes" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access_text"("business_id"));


--
-- Name: businesses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."businesses" ENABLE ROW LEVEL SECURITY;

--
-- Name: businesses businesses_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "businesses_member_select" ON "public"."businesses" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("id"));


--
-- Name: conversation_outcomes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."conversation_outcomes" ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_outcomes conversation_outcomes_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "conversation_outcomes_member_select" ON "public"."conversation_outcomes" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: conversation_turns; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."conversation_turns" ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_turns conversation_turns_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "conversation_turns_member_select" ON "public"."conversation_turns" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations conversations_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "conversations_member_select" ON "public"."conversations" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: customer_preferences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."customer_preferences" ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_preferences customer_preferences_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "customer_preferences_member_select" ON "public"."customer_preferences" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_preferences"."customer_id") AND "public"."user_has_business_access"("c"."business_id")))));


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "customers_member_select" ON "public"."customers" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: daily_summaries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."daily_summaries" ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_summaries daily_summaries_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "daily_summaries_member_select" ON "public"."daily_summaries" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access_text"("business_id"));


--
-- Name: dashboard_users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dashboard_users" ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_users dashboard_users_self_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dashboard_users_self_select" ON "public"."dashboard_users" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "auth_user_id"));


--
-- Name: edge_function_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."edge_function_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: edge_function_logs edge_function_logs_no_direct_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "edge_function_logs_no_direct_access" ON "public"."edge_function_logs" FOR SELECT TO "authenticated" USING (false);


--
-- Name: inbound_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."inbound_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: inbound_events inbound_events_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "inbound_events_member_select" ON "public"."inbound_events" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: job_attempts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."job_attempts" ENABLE ROW LEVEL SECURITY;

--
-- Name: job_attempts job_attempts_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "job_attempts_member_select" ON "public"."job_attempts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."jobs" "j"
  WHERE (("j"."id" = "job_attempts"."job_id") AND "public"."user_has_business_access"("j"."business_id")))));


--
-- Name: jobs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."jobs" ENABLE ROW LEVEL SECURITY;

--
-- Name: jobs jobs_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "jobs_member_select" ON "public"."jobs" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "messages_member_select" ON "public"."messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."conversations" "c"
  WHERE (("c"."id" = "messages"."conversation_id") AND "public"."user_has_business_access"("c"."business_id")))));


--
-- Name: outbox; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."outbox" ENABLE ROW LEVEL SECURITY;

--
-- Name: outbox outbox_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "outbox_member_select" ON "public"."outbox" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;

--
-- Name: products products_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "products_member_select" ON "public"."products" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: security_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."security_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: security_logs security_logs_no_direct_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "security_logs_no_direct_access" ON "public"."security_logs" FOR SELECT TO "authenticated" USING (false);


--
-- Name: transaction_status_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."transaction_status_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_status_events transaction_status_events_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "transaction_status_events_member_select" ON "public"."transaction_status_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."transactions" "t"
  WHERE (("t"."id" = "transaction_status_events"."transaction_id") AND "public"."user_has_business_access"("t"."business_id")))));


--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions transactions_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "transactions_member_select" ON "public"."transactions" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: zettle_oauth_tokens; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."zettle_oauth_tokens" ENABLE ROW LEVEL SECURITY;

--
-- Name: zettle_oauth_tokens zettle_oauth_tokens_member_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "zettle_oauth_tokens_member_select" ON "public"."zettle_oauth_tokens" FOR SELECT TO "authenticated" USING ("public"."user_has_business_access"("business_id"));


--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: postgres
--

CREATE PUBLICATION "supabase_realtime" WITH (publish = 'insert, update, delete, truncate');


ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";

--
-- Name: supabase_realtime_messages_publication; Type: PUBLICATION; Schema: -; Owner: supabase_admin
--

CREATE PUBLICATION "supabase_realtime_messages_publication" WITH (publish = 'insert, update, delete, truncate');


ALTER PUBLICATION "supabase_realtime_messages_publication" OWNER TO "supabase_admin";

--
-- Name: supabase_realtime_messages_publication messages; Type: PUBLICATION TABLE; Schema: realtime; Owner: supabase_admin
--

ALTER PUBLICATION "supabase_realtime_messages_publication" ADD TABLE ONLY "realtime"."messages";


--
-- Name: SCHEMA "conversaflow"; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA "conversaflow" TO "anon";
GRANT USAGE ON SCHEMA "conversaflow" TO "authenticated";
GRANT USAGE ON SCHEMA "conversaflow" TO "service_role";


--
-- Name: SCHEMA "cron"; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA "cron" TO "postgres" WITH GRANT OPTION;


--
-- Name: SCHEMA "kds"; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA "kds" TO "authenticated";
GRANT USAGE ON SCHEMA "kds" TO "service_role";
GRANT USAGE ON SCHEMA "kds" TO "anon";


--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: SCHEMA "net"; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA "net" TO "supabase_functions_admin";
GRANT USAGE ON SCHEMA "net" TO "postgres";
GRANT USAGE ON SCHEMA "net" TO "anon";
GRANT USAGE ON SCHEMA "net" TO "authenticated";
GRANT USAGE ON SCHEMA "net" TO "service_role";


--
-- Name: FUNCTION "gtrgm_in"("cstring"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gtrgm_in"("cstring") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gtrgm_out"("extensions"."gtrgm"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gtrgm_out"("extensions"."gtrgm") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_in"("cstring", "oid", integer); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_in"("cstring", "oid", integer) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_out"("extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_out"("extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_recv"("internal", "oid", integer); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_recv"("internal", "oid", integer) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_send"("extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_send"("extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_typmod_in"("cstring"[]); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_typmod_in"("cstring"[]) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_in"("cstring", "oid", integer); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_in"("cstring", "oid", integer) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_out"("extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_out"("extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_recv"("internal", "oid", integer); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_recv"("internal", "oid", integer) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_send"("extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_send"("extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_typmod_in"("cstring"[]); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_typmod_in"("cstring"[]) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_in"("cstring", "oid", integer); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_in"("cstring", "oid", integer) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_out"("extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_out"("extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_recv"("internal", "oid", integer); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_recv"("internal", "oid", integer) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_send"("extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_send"("extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_typmod_in"("cstring"[]); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_typmod_in"("cstring"[]) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_halfvec"(real[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_halfvec"(real[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_sparsevec"(real[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_sparsevec"(real[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_vector"(real[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_vector"(real[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_halfvec"(double precision[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_halfvec"(double precision[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_sparsevec"(double precision[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_sparsevec"(double precision[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_vector"(double precision[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_vector"(double precision[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_halfvec"(integer[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_halfvec"(integer[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_sparsevec"(integer[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_sparsevec"(integer[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_vector"(integer[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_vector"(integer[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_halfvec"(numeric[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_halfvec"(numeric[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_sparsevec"(numeric[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_sparsevec"(numeric[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "array_to_vector"(numeric[], integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."array_to_vector"(numeric[], integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_to_float4"("extensions"."halfvec", integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_to_float4"("extensions"."halfvec", integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec"("extensions"."halfvec", integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec"("extensions"."halfvec", integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_to_sparsevec"("extensions"."halfvec", integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_to_sparsevec"("extensions"."halfvec", integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_to_vector"("extensions"."halfvec", integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_to_vector"("extensions"."halfvec", integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_to_halfvec"("extensions"."sparsevec", integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_to_halfvec"("extensions"."sparsevec", integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec"("extensions"."sparsevec", integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec"("extensions"."sparsevec", integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_to_vector"("extensions"."sparsevec", integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_to_vector"("extensions"."sparsevec", integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_to_float4"("extensions"."vector", integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_to_float4"("extensions"."vector", integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_to_halfvec"("extensions"."vector", integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_to_halfvec"("extensions"."vector", integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_to_sparsevec"("extensions"."vector", integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_to_sparsevec"("extensions"."vector", integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector"("extensions"."vector", integer, boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector"("extensions"."vector", integer, boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: TABLE "jobs"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."jobs" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."jobs" TO "anon";
GRANT ALL ON TABLE "conversaflow"."jobs" TO "service_role";


--
-- Name: TABLE "outbox"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."outbox" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."outbox" TO "anon";
GRANT ALL ON TABLE "conversaflow"."outbox" TO "service_role";


--
-- Name: FUNCTION "search_customer_messages"("p_customer_id" "uuid", "p_business_id" "uuid", "p_current_conversation_id" "uuid", "p_embedding" "text", "p_limit" integer, "p_exclude_recent" integer, "p_roles" "text"[]); Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT ALL ON FUNCTION "conversaflow"."search_customer_messages"("p_customer_id" "uuid", "p_business_id" "uuid", "p_current_conversation_id" "uuid", "p_embedding" "text", "p_limit" integer, "p_exclude_recent" integer, "p_roles" "text"[]) TO "service_role";


--
-- Name: FUNCTION "alter_job"("job_id" bigint, "schedule" "text", "command" "text", "database" "text", "username" "text", "active" boolean); Type: ACL; Schema: cron; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "cron"."alter_job"("job_id" bigint, "schedule" "text", "command" "text", "database" "text", "username" "text", "active" boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "job_cache_invalidate"(); Type: ACL; Schema: cron; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "cron"."job_cache_invalidate"() TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "schedule"("schedule" "text", "command" "text"); Type: ACL; Schema: cron; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "cron"."schedule"("schedule" "text", "command" "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "schedule"("job_name" "text", "schedule" "text", "command" "text"); Type: ACL; Schema: cron; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "cron"."schedule"("job_name" "text", "schedule" "text", "command" "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "schedule_in_database"("job_name" "text", "schedule" "text", "command" "text", "database" "text", "username" "text", "active" boolean); Type: ACL; Schema: cron; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "cron"."schedule_in_database"("job_name" "text", "schedule" "text", "command" "text", "database" "text", "username" "text", "active" boolean) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "unschedule"("job_id" bigint); Type: ACL; Schema: cron; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "cron"."unschedule"("job_id" bigint) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "unschedule"("job_name" "text"); Type: ACL; Schema: cron; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "cron"."unschedule"("job_name" "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "armor"("bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."armor"("bytea") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."armor"("bytea") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."armor"("bytea") TO "dashboard_user";


--
-- Name: FUNCTION "armor"("bytea", "text"[], "text"[]); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."armor"("bytea", "text"[], "text"[]) FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."armor"("bytea", "text"[], "text"[]) TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."armor"("bytea", "text"[], "text"[]) TO "dashboard_user";


--
-- Name: FUNCTION "binary_quantize"("extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."binary_quantize"("extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "binary_quantize"("extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."binary_quantize"("extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "cosine_distance"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."cosine_distance"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "cosine_distance"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."cosine_distance"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "cosine_distance"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."cosine_distance"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "crypt"("text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."crypt"("text", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."crypt"("text", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."crypt"("text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "dearmor"("text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."dearmor"("text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."dearmor"("text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."dearmor"("text") TO "dashboard_user";


--
-- Name: FUNCTION "decrypt"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."decrypt"("bytea", "bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."decrypt"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."decrypt"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "decrypt_iv"("bytea", "bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."decrypt_iv"("bytea", "bytea", "bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."decrypt_iv"("bytea", "bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."decrypt_iv"("bytea", "bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "digest"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."digest"("bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."digest"("bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."digest"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "digest"("text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."digest"("text", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."digest"("text", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."digest"("text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "encrypt"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."encrypt"("bytea", "bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."encrypt"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."encrypt"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "encrypt_iv"("bytea", "bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."encrypt_iv"("bytea", "bytea", "bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."encrypt_iv"("bytea", "bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."encrypt_iv"("bytea", "bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "gen_random_bytes"(integer); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."gen_random_bytes"(integer) FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."gen_random_bytes"(integer) TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."gen_random_bytes"(integer) TO "dashboard_user";


--
-- Name: FUNCTION "gen_random_uuid"(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."gen_random_uuid"() FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."gen_random_uuid"() TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."gen_random_uuid"() TO "dashboard_user";


--
-- Name: FUNCTION "gen_salt"("text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."gen_salt"("text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."gen_salt"("text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."gen_salt"("text") TO "dashboard_user";


--
-- Name: FUNCTION "gen_salt"("text", integer); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."gen_salt"("text", integer) FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."gen_salt"("text", integer) TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."gen_salt"("text", integer) TO "dashboard_user";


--
-- Name: FUNCTION "gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gin_extract_value_trgm"("text", "internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gin_extract_value_trgm"("text", "internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gtrgm_compress"("internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gtrgm_compress"("internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gtrgm_consistent"("internal", "text", smallint, "oid", "internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gtrgm_decompress"("internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gtrgm_decompress"("internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gtrgm_distance"("internal", "text", smallint, "oid", "internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gtrgm_options"("internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gtrgm_options"("internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gtrgm_penalty"("internal", "internal", "internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gtrgm_picksplit"("internal", "internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gtrgm_picksplit"("internal", "internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gtrgm_same"("extensions"."gtrgm", "extensions"."gtrgm", "internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gtrgm_same"("extensions"."gtrgm", "extensions"."gtrgm", "internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "gtrgm_union"("internal", "internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."gtrgm_union"("internal", "internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_accum"(double precision[], "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_accum"(double precision[], "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_add"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_add"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_avg"(double precision[]); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_avg"(double precision[]) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_cmp"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_cmp"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_combine"(double precision[], double precision[]); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_combine"(double precision[], double precision[]) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_concat"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_concat"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_eq"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_eq"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_ge"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_ge"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_gt"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_gt"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_l2_squared_distance"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_l2_squared_distance"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_le"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_le"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_lt"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_lt"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_mul"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_mul"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_ne"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_ne"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_negative_inner_product"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_negative_inner_product"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_spherical_distance"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_spherical_distance"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "halfvec_sub"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."halfvec_sub"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "hamming_distance"(bit, bit); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."hamming_distance"(bit, bit) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "hmac"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."hmac"("bytea", "bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."hmac"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."hmac"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "hmac"("text", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."hmac"("text", "text", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."hmac"("text", "text", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."hmac"("text", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "hnsw_bit_support"("internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."hnsw_bit_support"("internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "hnsw_halfvec_support"("internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."hnsw_halfvec_support"("internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "hnsw_sparsevec_support"("internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."hnsw_sparsevec_support"("internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "hnswhandler"("internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."hnswhandler"("internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "inner_product"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."inner_product"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "inner_product"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."inner_product"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "inner_product"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."inner_product"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "ivfflat_bit_support"("internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."ivfflat_bit_support"("internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "ivfflat_halfvec_support"("internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."ivfflat_halfvec_support"("internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "ivfflathandler"("internal"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."ivfflathandler"("internal") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "jaccard_distance"(bit, bit); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."jaccard_distance"(bit, bit) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "l1_distance"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."l1_distance"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "l1_distance"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."l1_distance"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "l1_distance"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."l1_distance"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "l2_distance"("extensions"."halfvec", "extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."l2_distance"("extensions"."halfvec", "extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "l2_distance"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."l2_distance"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "l2_distance"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."l2_distance"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "l2_norm"("extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."l2_norm"("extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "l2_norm"("extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."l2_norm"("extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "l2_normalize"("extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."l2_normalize"("extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "l2_normalize"("extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."l2_normalize"("extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "l2_normalize"("extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."l2_normalize"("extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone) FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone) TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone) TO "dashboard_user";


--
-- Name: FUNCTION "pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone) FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone) TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone) TO "dashboard_user";


--
-- Name: FUNCTION "pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean) FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean) TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean) TO "dashboard_user";


--
-- Name: FUNCTION "pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_key_id"("bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_key_id"("bytea") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_key_id"("bytea") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_key_id"("bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt"("bytea", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt"("bytea", "bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt_bytea"("bytea", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt_bytea"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt"("text", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt"("text", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt_bytea"("bytea", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt_bytea"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt"("bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt_bytea"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt_bytea"("bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt"("text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt"("text", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt_bytea"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt_bytea"("bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text", "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "set_limit"(real); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."set_limit"(real) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "show_limit"(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."show_limit"() TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "show_trgm"("text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."show_trgm"("text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "similarity"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."similarity"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "similarity_dist"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."similarity_dist"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "similarity_op"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."similarity_op"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_cmp"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_cmp"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_eq"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_eq"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_ge"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_ge"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_gt"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_gt"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_l2_squared_distance"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_l2_squared_distance"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_le"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_le"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_lt"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_lt"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_ne"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_ne"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sparsevec_negative_inner_product"("extensions"."sparsevec", "extensions"."sparsevec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sparsevec_negative_inner_product"("extensions"."sparsevec", "extensions"."sparsevec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "strict_word_similarity"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."strict_word_similarity"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "strict_word_similarity_commutator_op"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."strict_word_similarity_commutator_op"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "strict_word_similarity_dist_commutator_op"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "strict_word_similarity_dist_op"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."strict_word_similarity_dist_op"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "strict_word_similarity_op"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."strict_word_similarity_op"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "subvector"("extensions"."halfvec", integer, integer); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."subvector"("extensions"."halfvec", integer, integer) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "subvector"("extensions"."vector", integer, integer); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."subvector"("extensions"."vector", integer, integer) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "uuid_generate_v1"(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v1"() FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1"() TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v1mc"(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v1mc"() FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1mc"() TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1mc"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v3"("namespace" "uuid", "name" "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v3"("namespace" "uuid", "name" "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."uuid_generate_v3"("namespace" "uuid", "name" "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."uuid_generate_v3"("namespace" "uuid", "name" "text") TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v4"(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v4"() FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."uuid_generate_v4"() TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."uuid_generate_v4"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v5"("namespace" "uuid", "name" "text"); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v5"("namespace" "uuid", "name" "text") FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."uuid_generate_v5"("namespace" "uuid", "name" "text") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."uuid_generate_v5"("namespace" "uuid", "name" "text") TO "dashboard_user";


--
-- Name: FUNCTION "uuid_nil"(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."uuid_nil"() FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."uuid_nil"() TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."uuid_nil"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_dns"(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."uuid_ns_dns"() FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."uuid_ns_dns"() TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."uuid_ns_dns"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_oid"(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."uuid_ns_oid"() FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."uuid_ns_oid"() TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."uuid_ns_oid"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_url"(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."uuid_ns_url"() FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."uuid_ns_url"() TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."uuid_ns_url"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_x500"(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION "extensions"."uuid_ns_x500"() FROM "postgres";
GRANT ALL ON FUNCTION "extensions"."uuid_ns_x500"() TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "extensions"."uuid_ns_x500"() TO "dashboard_user";


--
-- Name: FUNCTION "vector_accum"(double precision[], "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_accum"(double precision[], "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_add"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_add"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_avg"(double precision[]); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_avg"(double precision[]) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_cmp"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_cmp"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_combine"(double precision[], double precision[]); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_combine"(double precision[], double precision[]) TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_concat"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_concat"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_dims"("extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_dims"("extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_dims"("extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_dims"("extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_eq"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_eq"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_ge"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_ge"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_gt"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_gt"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_l2_squared_distance"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_l2_squared_distance"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_le"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_le"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_lt"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_lt"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_mul"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_mul"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_ne"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_ne"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_negative_inner_product"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_negative_inner_product"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_norm"("extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_norm"("extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_spherical_distance"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_spherical_distance"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "vector_sub"("extensions"."vector", "extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."vector_sub"("extensions"."vector", "extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "word_similarity"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."word_similarity"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "word_similarity_commutator_op"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."word_similarity_commutator_op"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "word_similarity_dist_commutator_op"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."word_similarity_dist_commutator_op"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "word_similarity_dist_op"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."word_similarity_dist_op"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "word_similarity_op"("text", "text"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."word_similarity_op"("text", "text") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "backfill_from_conversaflow"(); Type: ACL; Schema: kds; Owner: postgres
--

GRANT ALL ON FUNCTION "kds"."backfill_from_conversaflow"() TO "service_role";


--
-- Name: TABLE "tickets"; Type: ACL; Schema: kds; Owner: postgres
--

GRANT SELECT ON TABLE "kds"."tickets" TO "authenticated";
GRANT ALL ON TABLE "kds"."tickets" TO "service_role";


--
-- Name: FUNCTION "confirm_partial_cancellation"("p_ticket_id" "uuid", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text"); Type: ACL; Schema: kds; Owner: postgres
--

GRANT ALL ON FUNCTION "kds"."confirm_partial_cancellation"("p_ticket_id" "uuid", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text") TO "anon";


--
-- Name: FUNCTION "enqueue_whatsapp_status_notification"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_event_sequence" bigint); Type: ACL; Schema: kds; Owner: postgres
--

GRANT ALL ON FUNCTION "kds"."enqueue_whatsapp_status_notification"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_event_sequence" bigint) TO "service_role";


--
-- Name: FUNCTION "get_board_snapshot"("p_business_id" "uuid", "p_station_id" "text"); Type: ACL; Schema: kds; Owner: postgres
--

GRANT ALL ON FUNCTION "kds"."get_board_snapshot"("p_business_id" "uuid", "p_station_id" "text") TO "anon";
GRANT ALL ON FUNCTION "kds"."get_board_snapshot"("p_business_id" "uuid", "p_station_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "kds"."get_board_snapshot"("p_business_id" "uuid", "p_station_id" "text") TO "service_role";


--
-- Name: FUNCTION "get_ticket_events"("p_business_id" "uuid", "p_after_sequence" bigint, "p_limit" integer); Type: ACL; Schema: kds; Owner: postgres
--

GRANT ALL ON FUNCTION "kds"."get_ticket_events"("p_business_id" "uuid", "p_after_sequence" bigint, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "kds"."get_ticket_events"("p_business_id" "uuid", "p_after_sequence" bigint, "p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "kds"."get_ticket_events"("p_business_id" "uuid", "p_after_sequence" bigint, "p_limit" integer) TO "anon";


--
-- Name: FUNCTION "map_kds_status_to_transaction_status"("target_status" "kds"."ticket_status"); Type: ACL; Schema: kds; Owner: postgres
--

GRANT ALL ON FUNCTION "kds"."map_kds_status_to_transaction_status"("target_status" "kds"."ticket_status") TO "authenticated";
GRANT ALL ON FUNCTION "kds"."map_kds_status_to_transaction_status"("target_status" "kds"."ticket_status") TO "service_role";


--
-- Name: FUNCTION "map_transaction_status"("op_status" "text"); Type: ACL; Schema: kds; Owner: postgres
--

GRANT ALL ON FUNCTION "kds"."map_transaction_status"("op_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "kds"."map_transaction_status"("op_status" "text") TO "service_role";


--
-- Name: FUNCTION "project_transaction"("p_transaction_id" "uuid", "p_event_kind" "kds"."ticket_event_kind", "p_source" "text", "p_source_event_key" "text"); Type: ACL; Schema: kds; Owner: postgres
--

GRANT ALL ON FUNCTION "kds"."project_transaction"("p_transaction_id" "uuid", "p_event_kind" "kds"."ticket_event_kind", "p_source" "text", "p_source_event_key" "text") TO "service_role";


--
-- Name: FUNCTION "provision_device_token"("p_business_id" "uuid", "p_device_name" "text", "p_station_id" "text"); Type: ACL; Schema: kds; Owner: postgres
--

REVOKE ALL ON FUNCTION "kds"."provision_device_token"("p_business_id" "uuid", "p_device_name" "text", "p_station_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "kds"."provision_device_token"("p_business_id" "uuid", "p_device_name" "text", "p_station_id" "text") TO "service_role";


--
-- Name: FUNCTION "transition_ticket"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text", "p_cancellation_reason_code" "kds"."cancel_reason_code", "p_cancellation_reason_note" "text"); Type: ACL; Schema: kds; Owner: postgres
--

GRANT ALL ON FUNCTION "kds"."transition_ticket"("p_ticket_id" "uuid", "p_target_status" "kds"."ticket_status", "p_actor_source" "text", "p_actor_id" "text", "p_actor_channel" "text", "p_cancellation_reason_code" "kds"."cancel_reason_code", "p_cancellation_reason_note" "text") TO "service_role";


--
-- Name: FUNCTION "verify_device_token"("p_token" "text"); Type: ACL; Schema: kds; Owner: postgres
--

REVOKE ALL ON FUNCTION "kds"."verify_device_token"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "kds"."verify_device_token"("p_token" "text") TO "service_role";


--
-- Name: FUNCTION "calculate_loyalty_points"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."calculate_loyalty_points"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_loyalty_points"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_loyalty_points"() TO "service_role";


--
-- Name: FUNCTION "check_tier_upgrade"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."check_tier_upgrade"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_tier_upgrade"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_tier_upgrade"() TO "service_role";


--
-- Name: TABLE "jobs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."jobs" TO "anon";
GRANT ALL ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";


--
-- Name: FUNCTION "claim_next_job"("p_worker_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."claim_next_job"("p_worker_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_next_job"("p_worker_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_next_job"("p_worker_id" "text") TO "service_role";


--
-- Name: TABLE "outbox"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."outbox" TO "anon";
GRANT ALL ON TABLE "public"."outbox" TO "authenticated";
GRANT ALL ON TABLE "public"."outbox" TO "service_role";


--
-- Name: FUNCTION "claim_outbox_batch"("p_worker_id" "text", "p_limit" integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."claim_outbox_batch"("p_worker_id" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_outbox_batch"("p_worker_id" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_outbox_batch"("p_worker_id" "text", "p_limit" integer) TO "service_role";


--
-- Name: FUNCTION "get_or_create_conversation"("p_business_id" "uuid", "p_customer_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("p_business_id" "uuid", "p_customer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("p_business_id" "uuid", "p_customer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("p_business_id" "uuid", "p_customer_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "get_or_create_customer"("p_phone" "text", "p_business_id" "uuid", "p_name" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."get_or_create_customer"("p_phone" "text", "p_business_id" "uuid", "p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_create_customer"("p_phone" "text", "p_business_id" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_customer"("p_phone" "text", "p_business_id" "uuid", "p_name" "text") TO "service_role";


--
-- Name: FUNCTION "increment_customer_metrics"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."increment_customer_metrics"() TO "anon";
GRANT ALL ON FUNCTION "public"."increment_customer_metrics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_customer_metrics"() TO "service_role";


--
-- Name: FUNCTION "notify_wallet_update"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."notify_wallet_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_wallet_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_wallet_update"() TO "service_role";


--
-- Name: FUNCTION "products_invalidate_embedding"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."products_invalidate_embedding"() TO "anon";
GRANT ALL ON FUNCTION "public"."products_invalidate_embedding"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."products_invalidate_embedding"() TO "service_role";


--
-- Name: FUNCTION "reclaim_stale_jobs"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."reclaim_stale_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."reclaim_stale_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reclaim_stale_jobs"() TO "service_role";


--
-- Name: FUNCTION "reclaim_stale_outbox"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."reclaim_stale_outbox"() TO "anon";
GRANT ALL ON FUNCTION "public"."reclaim_stale_outbox"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reclaim_stale_outbox"() TO "service_role";


--
-- Name: FUNCTION "search_products_by_embedding"("p_business_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer, "p_threshold" double precision); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."search_products_by_embedding"("p_business_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer, "p_threshold" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."search_products_by_embedding"("p_business_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer, "p_threshold" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_products_by_embedding"("p_business_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer, "p_threshold" double precision) TO "service_role";


--
-- Name: FUNCTION "search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer) TO "service_role";


--
-- Name: FUNCTION "search_similar_messages"("p_conversation_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer, "p_exclude_recent" integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."search_similar_messages"("p_conversation_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer, "p_exclude_recent" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_similar_messages"("p_conversation_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer, "p_exclude_recent" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_similar_messages"("p_conversation_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer, "p_exclude_recent" integer) TO "service_role";


--
-- Name: FUNCTION "update_customer_prefs"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_customer_prefs"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_prefs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_prefs"() TO "service_role";


--
-- Name: FUNCTION "update_customer_segment"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_customer_segment"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_segment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_segment"() TO "service_role";


--
-- Name: FUNCTION "update_updated_at_column"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


--
-- Name: FUNCTION "user_has_business_access"("target_business_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."user_has_business_access"("target_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_has_business_access"("target_business_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_business_access"("target_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_business_access"("target_business_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "user_has_business_access_text"("target_business_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."user_has_business_access_text"("target_business_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_has_business_access_text"("target_business_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_business_access_text"("target_business_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_business_access_text"("target_business_id" "text") TO "service_role";


--
-- Name: FUNCTION "_crypto_aead_det_decrypt"("message" "bytea", "additional" "bytea", "key_id" bigint, "context" "bytea", "nonce" "bytea"); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "vault"."_crypto_aead_det_decrypt"("message" "bytea", "additional" "bytea", "key_id" bigint, "context" "bytea", "nonce" "bytea") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "vault"."_crypto_aead_det_decrypt"("message" "bytea", "additional" "bytea", "key_id" bigint, "context" "bytea", "nonce" "bytea") TO "service_role";


--
-- Name: FUNCTION "create_secret"("new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid"); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "vault"."create_secret"("new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "vault"."create_secret"("new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "update_secret"("secret_id" "uuid", "new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid"); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "vault"."update_secret"("secret_id" "uuid", "new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "postgres" WITH GRANT OPTION;
GRANT ALL ON FUNCTION "vault"."update_secret"("secret_id" "uuid", "new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "avg"("extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."avg"("extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "avg"("extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."avg"("extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sum"("extensions"."halfvec"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sum"("extensions"."halfvec") TO "postgres" WITH GRANT OPTION;


--
-- Name: FUNCTION "sum"("extensions"."vector"); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION "extensions"."sum"("extensions"."vector") TO "postgres" WITH GRANT OPTION;


--
-- Name: TABLE "ai_turn_logs"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."ai_turn_logs" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."ai_turn_logs" TO "anon";
GRANT ALL ON TABLE "conversaflow"."ai_turn_logs" TO "service_role";


--
-- Name: TABLE "business_config_changes"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."business_config_changes" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."business_config_changes" TO "anon";
GRANT ALL ON TABLE "conversaflow"."business_config_changes" TO "service_role";


--
-- Name: TABLE "businesses"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."businesses" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."businesses" TO "anon";
GRANT ALL ON TABLE "conversaflow"."businesses" TO "service_role";


--
-- Name: TABLE "conversation_outcomes"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."conversation_outcomes" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."conversation_outcomes" TO "anon";
GRANT ALL ON TABLE "conversaflow"."conversation_outcomes" TO "service_role";


--
-- Name: TABLE "conversation_turns"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."conversation_turns" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."conversation_turns" TO "anon";
GRANT ALL ON TABLE "conversaflow"."conversation_turns" TO "service_role";


--
-- Name: TABLE "conversations"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."conversations" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."conversations" TO "anon";
GRANT ALL ON TABLE "conversaflow"."conversations" TO "service_role";


--
-- Name: TABLE "customer_preferences"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."customer_preferences" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."customer_preferences" TO "anon";
GRANT ALL ON TABLE "conversaflow"."customer_preferences" TO "service_role";


--
-- Name: TABLE "customers"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."customers" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."customers" TO "anon";
GRANT ALL ON TABLE "conversaflow"."customers" TO "service_role";


--
-- Name: TABLE "daily_summaries"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."daily_summaries" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."daily_summaries" TO "anon";
GRANT ALL ON TABLE "conversaflow"."daily_summaries" TO "service_role";


--
-- Name: TABLE "dashboard_users"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."dashboard_users" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."dashboard_users" TO "anon";
GRANT ALL ON TABLE "conversaflow"."dashboard_users" TO "service_role";


--
-- Name: TABLE "edge_function_logs"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."edge_function_logs" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."edge_function_logs" TO "anon";
GRANT ALL ON TABLE "conversaflow"."edge_function_logs" TO "service_role";


--
-- Name: TABLE "eval_traces"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE "conversaflow"."eval_traces" TO "service_role";


--
-- Name: TABLE "inbound_events"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."inbound_events" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."inbound_events" TO "anon";
GRANT ALL ON TABLE "conversaflow"."inbound_events" TO "service_role";


--
-- Name: TABLE "job_attempts"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."job_attempts" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."job_attempts" TO "anon";
GRANT ALL ON TABLE "conversaflow"."job_attempts" TO "service_role";


--
-- Name: TABLE "messages"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."messages" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."messages" TO "anon";
GRANT ALL ON TABLE "conversaflow"."messages" TO "service_role";


--
-- Name: TABLE "pipeline_traces"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE "conversaflow"."pipeline_traces" TO "service_role";


--
-- Name: TABLE "products"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."products" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."products" TO "anon";
GRANT ALL ON TABLE "conversaflow"."products" TO "service_role";


--
-- Name: TABLE "security_logs"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."security_logs" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."security_logs" TO "anon";
GRANT ALL ON TABLE "conversaflow"."security_logs" TO "service_role";


--
-- Name: TABLE "transaction_status_events"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."transaction_status_events" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."transaction_status_events" TO "anon";
GRANT ALL ON TABLE "conversaflow"."transaction_status_events" TO "service_role";


--
-- Name: TABLE "transactions"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."transactions" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."transactions" TO "anon";
GRANT ALL ON TABLE "conversaflow"."transactions" TO "service_role";


--
-- Name: TABLE "zettle_oauth_tokens"; Type: ACL; Schema: conversaflow; Owner: postgres
--

GRANT SELECT ON TABLE "conversaflow"."zettle_oauth_tokens" TO "authenticated";
GRANT SELECT ON TABLE "conversaflow"."zettle_oauth_tokens" TO "anon";
GRANT ALL ON TABLE "conversaflow"."zettle_oauth_tokens" TO "service_role";


--
-- Name: TABLE "job"; Type: ACL; Schema: cron; Owner: supabase_admin
--

GRANT SELECT ON TABLE "cron"."job" TO "postgres" WITH GRANT OPTION;


--
-- Name: TABLE "job_run_details"; Type: ACL; Schema: cron; Owner: supabase_admin
--

GRANT ALL ON TABLE "cron"."job_run_details" TO "postgres" WITH GRANT OPTION;


--
-- Name: TABLE "pg_stat_statements"; Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON TABLE "extensions"."pg_stat_statements" FROM "postgres";
GRANT ALL ON TABLE "extensions"."pg_stat_statements" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "extensions"."pg_stat_statements" TO "dashboard_user";


--
-- Name: TABLE "pg_stat_statements_info"; Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON TABLE "extensions"."pg_stat_statements_info" FROM "postgres";
GRANT ALL ON TABLE "extensions"."pg_stat_statements_info" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "extensions"."pg_stat_statements_info" TO "dashboard_user";


--
-- Name: TABLE "ticket_events"; Type: ACL; Schema: kds; Owner: postgres
--

GRANT SELECT ON TABLE "kds"."ticket_events" TO "authenticated";
GRANT ALL ON TABLE "kds"."ticket_events" TO "service_role";


--
-- Name: TABLE "ticket_items"; Type: ACL; Schema: kds; Owner: postgres
--

GRANT SELECT ON TABLE "kds"."ticket_items" TO "authenticated";
GRANT ALL ON TABLE "kds"."ticket_items" TO "service_role";


--
-- Name: TABLE "ai_turn_logs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."ai_turn_logs" TO "anon";
GRANT ALL ON TABLE "public"."ai_turn_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_turn_logs" TO "service_role";


--
-- Name: TABLE "business_config_changes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."business_config_changes" TO "anon";
GRANT ALL ON TABLE "public"."business_config_changes" TO "authenticated";
GRANT ALL ON TABLE "public"."business_config_changes" TO "service_role";


--
-- Name: TABLE "businesses"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."businesses" TO "anon";
GRANT ALL ON TABLE "public"."businesses" TO "authenticated";
GRANT ALL ON TABLE "public"."businesses" TO "service_role";


--
-- Name: TABLE "conversation_outcomes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."conversation_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."conversation_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_outcomes" TO "service_role";


--
-- Name: TABLE "conversation_turns"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."conversation_turns" TO "anon";
GRANT ALL ON TABLE "public"."conversation_turns" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_turns" TO "service_role";


--
-- Name: TABLE "conversations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";


--
-- Name: TABLE "customer_preferences"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."customer_preferences" TO "anon";
GRANT ALL ON TABLE "public"."customer_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_preferences" TO "service_role";


--
-- Name: TABLE "customers"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";


--
-- Name: TABLE "daily_summaries"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."daily_summaries" TO "anon";
GRANT ALL ON TABLE "public"."daily_summaries" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_summaries" TO "service_role";


--
-- Name: TABLE "dashboard_users"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dashboard_users" TO "anon";
GRANT ALL ON TABLE "public"."dashboard_users" TO "authenticated";
GRANT ALL ON TABLE "public"."dashboard_users" TO "service_role";


--
-- Name: TABLE "edge_function_logs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."edge_function_logs" TO "anon";
GRANT ALL ON TABLE "public"."edge_function_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."edge_function_logs" TO "service_role";


--
-- Name: TABLE "inbound_events"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."inbound_events" TO "anon";
GRANT ALL ON TABLE "public"."inbound_events" TO "authenticated";
GRANT ALL ON TABLE "public"."inbound_events" TO "service_role";


--
-- Name: TABLE "job_attempts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."job_attempts" TO "anon";
GRANT ALL ON TABLE "public"."job_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."job_attempts" TO "service_role";


--
-- Name: TABLE "messages"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";


--
-- Name: TABLE "pipeline_traces"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."pipeline_traces" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_traces" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_traces" TO "service_role";


--
-- Name: TABLE "products"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";


--
-- Name: TABLE "security_logs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."security_logs" TO "anon";
GRANT ALL ON TABLE "public"."security_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."security_logs" TO "service_role";


--
-- Name: TABLE "transaction_status_events"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."transaction_status_events" TO "anon";
GRANT ALL ON TABLE "public"."transaction_status_events" TO "authenticated";
GRANT ALL ON TABLE "public"."transaction_status_events" TO "service_role";


--
-- Name: TABLE "transactions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";


--
-- Name: TABLE "zettle_oauth_tokens"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."zettle_oauth_tokens" TO "anon";
GRANT ALL ON TABLE "public"."zettle_oauth_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."zettle_oauth_tokens" TO "service_role";


--
-- Name: TABLE "secrets"; Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE "vault"."secrets" TO "postgres" WITH GRANT OPTION;
GRANT SELECT,DELETE ON TABLE "vault"."secrets" TO "service_role";


--
-- Name: TABLE "decrypted_secrets"; Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE "vault"."decrypted_secrets" TO "postgres" WITH GRANT OPTION;
GRANT SELECT,DELETE ON TABLE "vault"."decrypted_secrets" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER "issue_graphql_placeholder" ON "sql_drop"
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION "extensions"."set_graphql_placeholder"();


ALTER EVENT TRIGGER "issue_graphql_placeholder" OWNER TO "supabase_admin";

--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER "issue_pg_cron_access" ON "ddl_command_end"
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION "extensions"."grant_pg_cron_access"();


ALTER EVENT TRIGGER "issue_pg_cron_access" OWNER TO "supabase_admin";

--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER "issue_pg_graphql_access" ON "ddl_command_end"
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION "extensions"."grant_pg_graphql_access"();


ALTER EVENT TRIGGER "issue_pg_graphql_access" OWNER TO "supabase_admin";

--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER "issue_pg_net_access" ON "ddl_command_end"
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION "extensions"."grant_pg_net_access"();


ALTER EVENT TRIGGER "issue_pg_net_access" OWNER TO "supabase_admin";

--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER "pgrst_ddl_watch" ON "ddl_command_end"
   EXECUTE FUNCTION "extensions"."pgrst_ddl_watch"();


ALTER EVENT TRIGGER "pgrst_ddl_watch" OWNER TO "supabase_admin";

--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER "pgrst_drop_watch" ON "sql_drop"
   EXECUTE FUNCTION "extensions"."pgrst_drop_watch"();


ALTER EVENT TRIGGER "pgrst_drop_watch" OWNER TO "supabase_admin";

--
-- PostgreSQL database dump complete
--

\unrestrict sVGAs0ciDdtBNbPDQzsg1DS0IIOQ1XIyZT3cA6a4RFGtjRE2zroGSsuTJRZOheF

