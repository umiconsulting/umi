


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "_migration";


ALTER SCHEMA "_migration" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "comms";


ALTER SCHEMA "comms" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "core";


ALTER SCHEMA "core" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE SCHEMA IF NOT EXISTS "device";


ALTER SCHEMA "device" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "grow";


ALTER SCHEMA "grow" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "kitchen";


ALTER SCHEMA "kitchen" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "legacy";


ALTER SCHEMA "legacy" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "loyalty";


ALTER SCHEMA "loyalty" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE SCHEMA IF NOT EXISTS "observability";


ALTER SCHEMA "observability" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "ops";


ALTER SCHEMA "ops" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "queue";


ALTER SCHEMA "queue" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "core"."block_append_only_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception
    'append-only violation: % on %.% is forbidden (financial ledger is insert-only)',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
  return null;
end;
$$;


ALTER FUNCTION "core"."block_append_only_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."can_access_tenant"("target_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'core', 'pg_temp'
    AS $$
  select target_tenant_id is not null and exists (
    select 1
    from core.tenant_memberships tm
    where tm.tenant_id = target_tenant_id
      and tm.user_id   = core.current_user_id()
      and tm.status    = 'active'
  )
$$;


ALTER FUNCTION "core"."can_access_tenant"("target_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."current_person_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  select nullif(current_setting('app.person_id', true), '')::uuid
$$;


ALTER FUNCTION "core"."current_person_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."current_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;


ALTER FUNCTION "core"."current_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."current_user_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;


ALTER FUNCTION "core"."current_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."f_location_search_text"("p_name" "text", "p_aliases" "text"[]) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    AS $$
begin
  return lower(core.f_unaccent(
    coalesce(p_name, '') || ' ' || coalesce(array_to_string(p_aliases, ' '), '')
  ));
end;
$$;


ALTER FUNCTION "core"."f_location_search_text"("p_name" "text", "p_aliases" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."f_unaccent"("text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE STRICT PARALLEL SAFE
    AS $_$
begin
  return extensions.unaccent('extensions.unaccent'::regdictionary, $1);
end;
$_$;


ALTER FUNCTION "core"."f_unaccent"("text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."normalize_phone"("p_phone" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  with digits as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d
  )
  select case
    when d = '' then null
    when length(d) = 10                       then '+52' || d
    when length(d) = 11 and left(d, 1) = '1'  then '+52' || right(d, 10)
    when length(d) = 12 and left(d, 2) = '52' then '+52' || right(d, 10)
    when length(d) = 13 and left(d, 3) = '521' then '+52' || right(d, 10)
    when left(d, 1) = '0' and length(d) > 10  then '+52' || right(d, 10)
    -- already-international non-MX (E.164 length 11..15) -> keep as +<digits>
    when length(d) between 11 and 15          then '+' || d
    else null
  end
  from digits;
$$;


ALTER FUNCTION "core"."normalize_phone"("p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."resolve_contact"("p_tenant_id" "uuid", "p_kind" "text", "p_raw_value" "text", "p_display_name" "text" DEFAULT NULL::"text", "p_source_system" "text" DEFAULT NULL::"text", "p_external_id" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'core', 'pg_temp'
    AS $$
declare
  v_norm     text;
  v_display  text;
  v_key      text;
  v_person   uuid;
begin
  if p_tenant_id is null then
    raise exception 'resolve_contact requires a tenant_id';
  end if;

  if p_kind in ('phone', 'whatsapp') then
    v_norm    := core.normalize_phone(p_raw_value);
    v_display := coalesce(p_raw_value, '');
  elsif p_kind = 'email' then
    v_norm    := nullif(lower(btrim(p_raw_value)), '');
    v_display := coalesce(p_raw_value, '');
  else
    raise exception 'resolve_contact: unsupported kind %', p_kind;
  end if;

  -- Ladder key: never bare-null on an unparseable value.
  v_key := coalesce(
    v_norm,
    case
      when p_kind in ('phone','whatsapp')
        then 'last10:' || right(regexp_replace(coalesce(p_raw_value,''), '[^0-9]', '', 'g'), 10)
      else null
    end,
    'src:' || coalesce(p_source_system,'unknown') || ':' || coalesce(p_external_id, gen_random_uuid()::text)
  );

  -- 1. Existing contact_method in this tenant for the normalized value?
  if v_norm is not null then
    select cm.person_id into v_person
    from core.contact_methods cm
    where cm.tenant_id = p_tenant_id
      and cm.kind = p_kind
      and cm.normalized_value = v_norm
    limit 1;
  end if;

  -- 2. Otherwise create the person + the contact_method.
  if v_person is null then
    v_person := gen_random_uuid();
    insert into core.people (id, tenant_id, display_name)
    values (v_person, p_tenant_id, nullif(p_display_name, ''))
    on conflict do nothing;

    insert into core.contact_methods
      (tenant_id, person_id, kind, normalized_value, display_value, is_primary)
    values
      (p_tenant_id, v_person, p_kind, coalesce(v_norm, v_key), v_display, true)
    on conflict (tenant_id, kind, normalized_value) do nothing;

    -- If a concurrent insert won the unique race, re-read the winner.
    if v_norm is not null then
      select cm.person_id into v_person
      from core.contact_methods cm
      where cm.tenant_id = p_tenant_id
        and cm.kind = p_kind
        and cm.normalized_value = v_norm
      limit 1;
    end if;
  end if;

  return v_person;
end;
$$;


ALTER FUNCTION "core"."resolve_contact"("p_tenant_id" "uuid", "p_kind" "text", "p_raw_value" "text", "p_display_name" "text", "p_source_system" "text", "p_external_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."rls_tenant_check"("row_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select row_tenant_id is not null
     and row_tenant_id = core.current_tenant_id()
     and core.can_access_tenant(core.current_tenant_id())
$$;


ALTER FUNCTION "core"."rls_tenant_check"("row_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "legacy"."stable_uuid"("p_seed" "text") RETURNS "uuid"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select (
    substr(md5(p_seed), 1, 8)  || '-' ||
    substr(md5(p_seed), 9, 4)  || '-' ||
    substr(md5(p_seed), 13, 4) || '-' ||
    substr(md5(p_seed), 17, 4) || '-' ||
    substr(md5(p_seed), 21, 12)
  )::uuid;
$$;


ALTER FUNCTION "legacy"."stable_uuid"("p_seed" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ops"."block_order_event_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception
    'ops.order_events is append-only: % is forbidden (lifecycle journal is insert-only)',
    tg_op
    using errcode = 'restrict_violation';
  return null;
end;
$$;


ALTER FUNCTION "ops"."block_order_event_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_loyalty_points"() RETURNS "trigger"
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


CREATE OR REPLACE FUNCTION "public"."check_tier_upgrade"() RETURNS "trigger"
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


CREATE OR REPLACE FUNCTION "public"."get_or_create_conversation"("p_business_id" "uuid", "p_customer_id" "uuid") RETURNS TABLE("id" "uuid", "business_id" "uuid", "customer_id" "uuid", "status" "text", "conversation_history" "jsonb", "current_state" "text", "state_data" "jsonb", "created_at" timestamp with time zone, "last_message_at" timestamp with time zone)
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


CREATE OR REPLACE FUNCTION "public"."get_or_create_customer"("p_phone" "text", "p_business_id" "uuid", "p_name" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "phone" "text", "business_id" "uuid", "created_at" timestamp with time zone, "name" "text")
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


CREATE OR REPLACE FUNCTION "public"."increment_customer_metrics"() RETURNS "trigger"
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


CREATE OR REPLACE FUNCTION "public"."notify_wallet_update"() RETURNS "trigger"
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


CREATE OR REPLACE FUNCTION "public"."products_invalidate_embedding"() RETURNS "trigger"
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


CREATE OR REPLACE FUNCTION "public"."reclaim_stale_jobs"() RETURNS integer
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


CREATE OR REPLACE FUNCTION "public"."reclaim_stale_outbox"() RETURNS integer
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


CREATE OR REPLACE FUNCTION "public"."search_products_by_embedding"("p_business_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer DEFAULT 5, "p_threshold" double precision DEFAULT 0.65) RETURNS TABLE("id" "uuid", "name" "text", "price" numeric, "description" "text", "category" "text", "variants" "jsonb", "similarity" double precision)
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


CREATE OR REPLACE FUNCTION "public"."search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "name" "text", "price" numeric, "description" "text", "category" "text", "variants" "jsonb")
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


CREATE OR REPLACE FUNCTION "public"."search_similar_messages"("p_conversation_id" "uuid", "p_embedding" "extensions"."vector", "p_limit" integer DEFAULT 5, "p_exclude_recent" integer DEFAULT 8) RETURNS TABLE("id" "uuid", "role" "text", "content" "text", "created_at" timestamp with time zone, "similarity" double precision)
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


CREATE OR REPLACE FUNCTION "public"."update_customer_prefs"() RETURNS "trigger"
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


CREATE OR REPLACE FUNCTION "public"."update_customer_segment"() RETURNS "trigger"
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


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_has_business_access"("target_business_id" "uuid") RETURNS boolean
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


CREATE OR REPLACE FUNCTION "public"."user_has_business_access_text"("target_business_id" "text") RETURNS boolean
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

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "_migration"."account_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."account_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."card_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."card_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."conversation_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."conversation_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."job_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."job_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."lead_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."lead_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."message_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."message_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."order_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."order_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."otp_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."otp_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."person_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."person_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."phase_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phase" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "_migration"."phase_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."session_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."session_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."subscription_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."subscription_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."tenant_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."tenant_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "_migration"."user_map" (
    "old_id" "text" NOT NULL,
    "new_id" "uuid" NOT NULL,
    "source_system" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "_migration"."user_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "comms"."conversation_turns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "person_id" "uuid",
    "status" "text" NOT NULL,
    "source_message_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[] NOT NULL,
    "assistant_message_id" "uuid",
    "merged_user_text" "text",
    "integrity_decision" "text",
    "integrity_reason" "text",
    "base_state_version" bigint,
    "extracted_intent" "jsonb",
    "reconciled_action" "jsonb",
    "first_message_at" timestamp with time zone,
    "last_message_at" timestamp with time zone,
    "hold_until" timestamp with time zone,
    "released_at" timestamp with time zone,
    "processed_at" timestamp with time zone,
    "superseded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

ALTER TABLE ONLY "comms"."conversation_turns" FORCE ROW LEVEL SECURITY;


ALTER TABLE "comms"."conversation_turns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "comms"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "person_id" "uuid",
    "order_id" "uuid",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "current_state" "text" DEFAULT 'initial'::"text" NOT NULL,
    "conversation_history" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "state_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "draft_cart" "jsonb",
    "pending_clarification" "jsonb",
    "summary" "text",
    "history_migrated" boolean DEFAULT false NOT NULL,
    "state_version" bigint DEFAULT 0 NOT NULL,
    "draft_cart_version" bigint DEFAULT 0 NOT NULL,
    "last_message_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "selected_location_id" "uuid"
);

ALTER TABLE ONLY "comms"."conversations" FORCE ROW LEVEL SECURITY;


ALTER TABLE "comms"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "comms"."customer_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "person_id" "uuid" NOT NULL,
    "favorite_service_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[] NOT NULL,
    "usual_modifications" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "total_transactions" integer DEFAULT 0 NOT NULL,
    "avg_transaction_value_cents" integer,
    "last_transaction_at" timestamp with time zone,
    "facts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "comms"."customer_preferences" FORCE ROW LEVEL SECURITY;


ALTER TABLE "comms"."customer_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "comms"."daily_summaries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "summary_date" "date" NOT NULL,
    "slack_channel" "text" NOT NULL,
    "slack_message_ts" "text",
    "pinned" boolean DEFAULT false NOT NULL,
    "body" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "comms"."daily_summaries" FORCE ROW LEVEL SECURITY;


ALTER TABLE "comms"."daily_summaries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "comms"."knowledge_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "chunk_index" integer DEFAULT 0 NOT NULL,
    "content" "text" NOT NULL,
    "embedding" "extensions"."vector"(1024),
    "embedding_model" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "comms"."knowledge_chunks" FORCE ROW LEVEL SECURITY;


ALTER TABLE "comms"."knowledge_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "comms"."knowledge_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "title" "text" NOT NULL,
    "doc_type" "text" DEFAULT 'note'::"text" NOT NULL,
    "source_uri" "text",
    "body" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "knowledge_documents_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['faq'::"text", 'policy'::"text", 'menu'::"text", 'note'::"text", 'other'::"text"]))),
    CONSTRAINT "knowledge_documents_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "comms"."knowledge_documents" FORCE ROW LEVEL SECURITY;


ALTER TABLE "comms"."knowledge_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "comms"."memory_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "person_id" "uuid",
    "conversation_id" "uuid",
    "memory_type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "attributes" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "embedding" "extensions"."vector"(1024),
    "embedding_model" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

ALTER TABLE ONLY "comms"."memory_items" FORCE ROW LEVEL SECURITY;


ALTER TABLE "comms"."memory_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "comms"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text",
    "intent" "text",
    "entities" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "message_index" integer,
    "twilio_message_sid" "text",
    "embedding" "extensions"."vector"(1024),
    "embedding_model" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

ALTER TABLE ONLY "comms"."messages" FORCE ROW LEVEL SECURITY;


ALTER TABLE "comms"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "comms"."tool_calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "conversation_id" "uuid",
    "turn_id" "uuid",
    "tool_name" "text" NOT NULL,
    "input" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "output" "jsonb",
    "status" "text" DEFAULT 'started'::"text" NOT NULL,
    "error" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

ALTER TABLE ONLY "comms"."tool_calls" FORCE ROW LEVEL SECURITY;


ALTER TABLE "comms"."tool_calls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."contact_merge_candidates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "left_person_id" "uuid" NOT NULL,
    "right_person_id" "uuid" NOT NULL,
    "person_id_least" "uuid" GENERATED ALWAYS AS (LEAST("left_person_id", "right_person_id")) STORED,
    "person_id_greatest" "uuid" GENERATED ALWAYS AS (GREATEST("left_person_id", "right_person_id")) STORED,
    "match_type" "text" NOT NULL,
    "confidence" "text" DEFAULT 'candidate'::"text" NOT NULL,
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "contact_merge_candidates_check" CHECK (("left_person_id" <> "right_person_id")),
    CONSTRAINT "contact_merge_candidates_confidence_check" CHECK (("confidence" = ANY (ARRAY['candidate'::"text", 'high'::"text", 'rejected'::"text", 'merged'::"text"]))),
    CONSTRAINT "contact_merge_candidates_match_type_check" CHECK (("match_type" = ANY (ARRAY['exact_normalized_phone'::"text", 'exact_normalized_email'::"text", 'last10_phone'::"text", 'manual_review'::"text"])))
);

ALTER TABLE ONLY "core"."contact_merge_candidates" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."contact_merge_candidates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."contact_methods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "person_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "normalized_value" "text" NOT NULL,
    "display_value" "text",
    "is_primary" boolean DEFAULT false NOT NULL,
    "verified_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contact_methods_kind_check" CHECK (("kind" = ANY (ARRAY['phone'::"text", 'whatsapp'::"text", 'email'::"text", 'wallet_pass'::"text", 'external'::"text"])))
);

ALTER TABLE ONLY "core"."contact_methods" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."contact_methods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."external_refs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "location_id" "uuid",
    "product_key" "text" NOT NULL,
    "external_schema" "text",
    "external_table" "text",
    "external_id" "text" NOT NULL,
    "external_slug" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "external_refs_product_key_check" CHECK (("product_key" = ANY (ARRAY['cash'::"text", 'conversaflow'::"text", 'kds'::"text", 'dashboard'::"text", 'observability'::"text", 'landing'::"text", 'legacy'::"text"])))
);

ALTER TABLE ONLY "core"."external_refs" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."external_refs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."integration_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "access_token" "text" NOT NULL,
    "refresh_token" "text",
    "token_type" "text" DEFAULT 'Bearer'::"text",
    "expires_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "core"."integration_tokens" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."integration_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "slug" "text",
    "name" "text" NOT NULL,
    "address" "text",
    "lat" double precision,
    "lng" double precision,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "descriptor" "text",
    "search_text" "text" GENERATED ALWAYS AS ("core"."f_location_search_text"("name", "aliases")) STORED,
    CONSTRAINT "locations_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "core"."locations" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."membership_roles" (
    "membership_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "core"."membership_roles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."membership_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."password_reset_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "core"."password_reset_tokens" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."password_reset_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."people" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "display_name" "text",
    "birth_date" "date",
    "normalized_phone" "text",
    "normalized_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "core"."people" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."people" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "core"."permissions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."product_instances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "product_key" "text" NOT NULL,
    "status" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "enabled_at" timestamp with time zone,
    "disabled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_instances_product_key_check" CHECK (("product_key" = ANY (ARRAY['cash'::"text", 'conversaflow'::"text", 'kds'::"text", 'dashboard'::"text", 'observability'::"text", 'landing'::"text"]))),
    CONSTRAINT "product_instances_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'disabled'::"text", 'missing'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "core"."product_instances" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."product_instances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."role_permissions" (
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "core"."role_permissions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "core"."roles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "person_id" "uuid",
    "user_id" "uuid",
    "tenant_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "core_sessions_one_owner_chk" CHECK ((("person_id" IS NOT NULL) <> ("user_id" IS NOT NULL)))
);

ALTER TABLE ONLY "core"."sessions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."staff_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "staff_members_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'invited'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "core"."staff_members" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."staff_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."tenant_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tenant_memberships_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'invited'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "core"."tenant_memberships" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."tenant_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "timezone" "text" DEFAULT 'America/Mexico_City'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tenants_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "core"."tenants" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."tenants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_subject" "text",
    "email" "text",
    "phone" "text",
    "display_name" "text",
    "person_id" "uuid",
    "password_salt" "text",
    "password_hash" "text",
    "password_algorithm" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "users_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'invited'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "core"."users" FORCE ROW LEVEL SECURITY;


ALTER TABLE "core"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "device"."devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "station_id" "uuid",
    "name" "text" NOT NULL,
    "device_type" "text" DEFAULT 'kds'::"text" NOT NULL,
    "device_subtype" "text",
    "manufacturer" "text",
    "model" "text",
    "connection_type" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "devices_device_type_check" CHECK (("device_type" = ANY (ARRAY['kds'::"text", 'kiosk'::"text", 'printer'::"text", 'scanner'::"text", 'terminal'::"text", 'sensor'::"text", 'clock'::"text", 'signage'::"text"]))),
    CONSTRAINT "devices_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "device"."devices" FORCE ROW LEVEL SECURITY;


ALTER TABLE "device"."devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "device"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "station_id" "uuid",
    "event_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "device"."events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "device"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "device"."pairing_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "station_id" "uuid",
    "device_name" "text" NOT NULL,
    "requested_name" "text",
    "pin_hash" "text" NOT NULL,
    "pin_salt" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 5 NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "used_at" timestamp with time zone,
    "denied_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "device_pairing_requests_attempts_chk" CHECK ((("attempt_count" >= 0) AND ("max_attempts" > 0))),
    CONSTRAINT "pairing_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'denied'::"text", 'expired'::"text", 'used'::"text"])))
);

ALTER TABLE ONLY "device"."pairing_requests" FORCE ROW LEVEL SECURITY;


ALTER TABLE "device"."pairing_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "device"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "device_id" "uuid",
    "station_id" "uuid",
    "device_name" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_used_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "device"."sessions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "device"."sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "grow"."feature_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "key" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "description" "text",
    "rollout" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "grow"."feature_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "grow"."lead_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "event_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "grow"."lead_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "grow"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "company" "text",
    "role_title" "text",
    "consent_state" "text",
    "lifecycle_status" "text" DEFAULT 'new'::"text" NOT NULL,
    "diagnostic_data" "jsonb",
    "diagnostic_date" timestamp with time zone NOT NULL,
    "first_contact_channel" "text",
    "first_contact_campaign" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "utm_term" "text",
    "referrer" "text",
    "landing_path" "text",
    "submitted_form" "text",
    "source_app" "text" DEFAULT 'umi-landing-page'::"text" NOT NULL,
    "first_contact_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sequence_paused" boolean DEFAULT false NOT NULL,
    "pause_reason" "text",
    "emails_sent" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "last_email_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "grow"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "grow"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT 'standard'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "trial_ends_at" timestamp with time zone,
    "suspended_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'disabled'::"text", 'missing'::"text", 'archived'::"text"])))
);


ALTER TABLE "grow"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "kitchen"."station_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "station_id" "uuid" NOT NULL,
    "group_id" "uuid",
    "product_ref" "uuid",
    "product_key" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "kitchen"."station_assignments" FORCE ROW LEVEL SECURITY;


ALTER TABLE "kitchen"."station_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "kitchen"."station_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "group_key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "kitchen"."station_groups" FORCE ROW LEVEL SECURITY;


ALTER TABLE "kitchen"."station_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "kitchen"."stations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "station_key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stations_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "kitchen"."stations" FORCE ROW LEVEL SECURITY;


ALTER TABLE "kitchen"."stations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "person_id" "uuid" NOT NULL,
    "program_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "accounts_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "loyalty"."accounts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."automation_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "program_id" "uuid",
    "trigger_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "automation_rules_trigger_type_check" CHECK (("trigger_type" = ANY (ARRAY['birthday'::"text", 'win_back'::"text", 'streak'::"text", 'goal_proximity'::"text", 'lifecycle'::"text", 'manual'::"text"])))
);

ALTER TABLE ONLY "loyalty"."automation_rules" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."automation_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."balances" (
    "tenant_id" "uuid" NOT NULL,
    "loyalty_card_id" "uuid" NOT NULL,
    "balance" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "loyalty"."balances" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."birthday_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "loyalty_card_id" "uuid" NOT NULL,
    "year" integer NOT NULL,
    "issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "redeemed_at" timestamp with time zone,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "birthday_rewards_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'redeemed'::"text", 'expired'::"text"])))
);

ALTER TABLE ONLY "loyalty"."birthday_rewards" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."birthday_rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "card_number" "text" NOT NULL,
    "balance_cents" integer DEFAULT 0 NOT NULL,
    "total_visits" integer DEFAULT 0 NOT NULL,
    "visits_this_cycle" integer DEFAULT 0 NOT NULL,
    "pending_rewards" integer DEFAULT 0 NOT NULL,
    "qr_token" "text",
    "qr_issued_at" timestamp with time zone,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cards_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "loyalty"."cards" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."gift_card_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "gift_card_id" "uuid" NOT NULL,
    "delta" integer NOT NULL,
    "reason" "text" NOT NULL,
    "source_type" "text",
    "source_id" "text",
    "idempotency_key" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gift_card_ledger_reason_check" CHECK (("reason" = ANY (ARRAY['migration_initial_load'::"text", 'load'::"text", 'redeem'::"text", 'adjustment'::"text", 'expire'::"text"])))
);

ALTER TABLE ONLY "loyalty"."gift_card_ledger" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."gift_card_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."gift_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "balance_cents" integer DEFAULT 0 NOT NULL,
    "created_by_staff_member_id" "uuid",
    "sender_name" "text",
    "message" "text",
    "recipient_name" "text",
    "recipient_email" "text",
    "recipient_phone" "text",
    "redeemed_at" timestamp with time zone,
    "redeemed_loyalty_card_id" "uuid",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gift_cards_amount_cents_check" CHECK (("amount_cents" > 0))
);

ALTER TABLE ONLY "loyalty"."gift_cards" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."gift_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."lifecycle_sends" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "card_id" "uuid" NOT NULL,
    "journey" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "body" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

ALTER TABLE ONLY "loyalty"."lifecycle_sends" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."lifecycle_sends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."otp_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "person_id" "uuid",
    "identity_type" "text" DEFAULT 'phone'::"text" NOT NULL,
    "identity_value" "text" NOT NULL,
    "code_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "verified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "otp_verifications_identity_type_check" CHECK (("identity_type" = ANY (ARRAY['phone'::"text", 'email'::"text"])))
);

ALTER TABLE ONLY "loyalty"."otp_verifications" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."otp_verifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."pass_devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "pass_id" "uuid" NOT NULL,
    "device_token" "text" NOT NULL,
    "push_token" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "loyalty"."pass_devices" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."pass_devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."passes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "loyalty_card_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_object_id" "text",
    "serial_number" "text",
    "auth_token" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "passes_provider_check" CHECK (("provider" = ANY (ARRAY['apple'::"text", 'google'::"text"]))),
    CONSTRAINT "passes_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "loyalty"."passes" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."passes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."points_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "loyalty_card_id" "uuid" NOT NULL,
    "delta" integer NOT NULL,
    "reason" "text" NOT NULL,
    "source_type" "text",
    "source_id" "text",
    "idempotency_key" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "points_ledger_reason_check" CHECK (("reason" = ANY (ARRAY['migration_initial_balance'::"text", 'earn'::"text", 'redeem'::"text", 'topup'::"text", 'purchase'::"text", 'adjustment'::"text", 'gift_card_redeem'::"text"])))
);

ALTER TABLE ONLY "loyalty"."points_ledger" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."points_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."programs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" DEFAULT 'Loyalty'::"text" NOT NULL,
    "card_prefix" "text",
    "topup_enabled" boolean DEFAULT true NOT NULL,
    "self_registration" boolean DEFAULT false NOT NULL,
    "pass_style" "text" DEFAULT 'default'::"text" NOT NULL,
    "birthday_reward_enabled" boolean DEFAULT false NOT NULL,
    "birthday_reward_name" "text",
    "branding" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "programs_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "loyalty"."programs" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."reward_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "program_id" "uuid",
    "visits_required" integer DEFAULT 10 NOT NULL,
    "reward_name" "text" NOT NULL,
    "reward_description" "text",
    "reward_cost_cents" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "activated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reward_configs_visits_required_check" CHECK (("visits_required" > 0))
);

ALTER TABLE ONLY "loyalty"."reward_configs" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."reward_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."reward_redemptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "loyalty_card_id" "uuid" NOT NULL,
    "reward_config_id" "uuid" NOT NULL,
    "staff_member_id" "uuid",
    "note" "text",
    "redeemed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "loyalty"."reward_redemptions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."reward_redemptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."visit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "loyalty_card_id" "uuid" NOT NULL,
    "staff_member_id" "uuid",
    "note" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "loyalty"."visit_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."visit_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "loyalty"."wallet_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "loyalty_card_id" "uuid" NOT NULL,
    "staff_member_id" "uuid",
    "type" "text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "wallet_transactions_type_check" CHECK (("type" = ANY (ARRAY['topup'::"text", 'purchase'::"text", 'adjustment'::"text", 'gift_card_redeem'::"text"])))
);

ALTER TABLE ONLY "loyalty"."wallet_transactions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."wallet_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "observability"."ai_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "person_id" "uuid",
    "conversation_id" "uuid",
    "model" "text" NOT NULL,
    "prompt_version" "text",
    "prompt_tokens" integer,
    "completion_tokens" integer,
    "total_tokens" integer,
    "cost_usd" numeric(10,6),
    "latency_ms" integer,
    "response_type" "text",
    "products_referenced" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "customer_context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "request_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "observability"."ai_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "observability"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "actor_slack_id" "text",
    "previous_config" "jsonb",
    "new_config" "jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "observability"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "observability"."conversation_outcomes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "person_id" "uuid",
    "conversation_id" "uuid",
    "outcome" "text" NOT NULL,
    "turn_count" integer,
    "duration_seconds" integer,
    "total_tokens" integer,
    "total_cost_usd" numeric(10,6),
    "products_discussed" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "observability"."conversation_outcomes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "observability"."data_quality_findings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "check_name" "text" NOT NULL,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "subject_schema" "text",
    "subject_table" "text",
    "subject_id" "text",
    "expected" "jsonb",
    "observed" "jsonb",
    "detail" "text",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "data_quality_findings_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'error'::"text", 'critical'::"text"])))
);


ALTER TABLE "observability"."data_quality_findings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "observability"."edge_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "function_name" "text" NOT NULL,
    "status" "text" NOT NULL,
    "duration_ms" integer,
    "error_message" "text",
    "error_stack" "text",
    "request_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "observability"."edge_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "observability"."evaluation_traces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "conversation_id" "uuid",
    "turn_id" "uuid",
    "turn_sequence" integer,
    "authoritative_decision" "jsonb",
    "harness_decision" "jsonb",
    "agreement" boolean,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "observability"."evaluation_traces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "observability"."pipeline_spans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trace_id" "text" NOT NULL,
    "tenant_id" "uuid",
    "conversation_id" "uuid",
    "turn_id" "uuid",
    "stage" "text" NOT NULL,
    "event" "text" NOT NULL,
    "detail" "jsonb",
    "error" "text",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "observability"."pipeline_spans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "observability"."security_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "phone" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "input_text" "text",
    "details" "text",
    "request_id" "text",
    "event_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "observability"."security_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."business_hours" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "day_of_week" smallint NOT NULL,
    "opens_at" time without time zone,
    "closes_at" time without time zone,
    "is_closed" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "business_hours_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);

ALTER TABLE ONLY "ops"."business_hours" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."business_hours" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."businesses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "business_type" "text",
    "city" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "open_times" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "branding" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "ops"."businesses" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."businesses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."channel_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "channel_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_account_id" "text" NOT NULL,
    "address" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "channel_accounts_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "ops"."channel_accounts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."channel_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."channels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "channels_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "ops"."channels" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."order_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "event_kind" "text",
    "old_status" "text",
    "new_status" "text",
    "kitchen_sequence" bigint,
    "source" "text",
    "idempotency_key" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "ops"."order_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."order_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "display_order" integer DEFAULT 0 NOT NULL,
    "name" "text" NOT NULL,
    "variant_name" "text",
    "quantity" integer DEFAULT 1 NOT NULL,
    "unit_price_cents" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "kitchen_status" "text",
    "is_cancelled" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "order_items_kitchen_status_check" CHECK ((("kitchen_status" IS NULL) OR ("kitchen_status" = ANY (ARRAY['new'::"text", 'accepted'::"text", 'preparing'::"text", 'ready'::"text", 'completed'::"text", 'cancelled'::"text", 'partial_cancelled'::"text"])))),
    CONSTRAINT "order_items_quantity_check" CHECK (("quantity" >= 0)),
    CONSTRAINT "order_items_unit_price_cents_check" CHECK (("unit_price_cents" >= 0))
);

ALTER TABLE ONLY "ops"."order_items" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "person_id" "uuid",
    "channel_id" "uuid",
    "source" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    "channel" "text",
    "order_type" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "total_cents" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "kitchen_status" "text",
    "pickup_person" "text",
    "station_id" "text",
    "station_name" "text",
    "cancellation_reason" "text",
    "cancellation_reason_code" "text",
    "cancellation_reason_note" "text",
    "partial_cancellation_reason" "text",
    "partial_cancellation_reason_code" "text",
    "partial_cancellation_reason_note" "text",
    "source_transaction_id" "text",
    "slack_message_ts" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "placed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "orders_kitchen_status_check" CHECK ((("kitchen_status" IS NULL) OR ("kitchen_status" = ANY (ARRAY['new'::"text", 'accepted'::"text", 'preparing'::"text", 'ready'::"text", 'completed'::"text", 'cancelled'::"text", 'partial_cancelled'::"text"])))),
    CONSTRAINT "orders_source_check" CHECK (("source" = ANY (ARRAY['whatsapp'::"text", 'pos'::"text", 'kiosk'::"text", 'dashboard'::"text", 'sms'::"text", 'web'::"text"]))),
    CONSTRAINT "orders_total_cents_check" CHECK (("total_cents" >= 0))
);

ALTER TABLE ONLY "ops"."orders" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "provider" "text",
    "provider_ref" "text",
    "method" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "amount_cents" integer DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'MXN'::"text" NOT NULL,
    "captured_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payments_amount_cents_check" CHECK (("amount_cents" >= 0)),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'authorized'::"text", 'captured'::"text", 'failed'::"text", 'voided'::"text", 'refunded'::"text"])))
);

ALTER TABLE ONLY "ops"."payments" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."product_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "ops"."product_categories" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."product_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."product_modifier_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "min_select" integer DEFAULT 0 NOT NULL,
    "max_select" integer,
    "is_required" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "ops"."product_modifier_groups" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."product_modifier_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."product_modifiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "modifier_group_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "price_delta_cents" integer DEFAULT 0 NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "ops"."product_modifiers" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."product_modifiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "price_cents" integer DEFAULT 0 NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "variants" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "name_embedding" "extensions"."vector"(1024),
    "embedding_model" "text",
    "synced_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "products_price_cents_check" CHECK (("price_cents" >= 0))
);

ALTER TABLE ONLY "ops"."products" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."refunds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "provider_ref" "text",
    "reason" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "amount_cents" integer DEFAULT 0 NOT NULL,
    "processed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "refunds_amount_cents_check" CHECK (("amount_cents" >= 0)),
    CONSTRAINT "refunds_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processed'::"text", 'failed'::"text", 'voided'::"text"])))
);

ALTER TABLE ONLY "ops"."refunds" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."refunds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ops"."service_windows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "label" "text",
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "is_closed" boolean DEFAULT false NOT NULL,
    "opens_at" time without time zone,
    "closes_at" time without time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "service_windows_check" CHECK (("ends_at" >= "starts_at"))
);

ALTER TABLE ONLY "ops"."service_windows" FORCE ROW LEVEL SECURITY;


ALTER TABLE "ops"."service_windows" OWNER TO "postgres";


CREATE OR REPLACE VIEW "ops"."v_kds_tickets" AS
SELECT
    NULL::"uuid" AS "ticket_id",
    NULL::"uuid" AS "tenant_id",
    NULL::"text" AS "source_transaction_id",
    NULL::"text" AS "source_channel",
    NULL::"uuid" AS "customer_person_id",
    NULL::"text" AS "status",
    NULL::"text" AS "station_id",
    NULL::"text" AS "station_name",
    NULL::"text" AS "pickup_person",
    NULL::"text" AS "customer_note",
    NULL::"text" AS "cancellation_reason",
    NULL::"text" AS "partial_cancellation_reason",
    NULL::integer AS "total_cents",
    NULL::timestamp with time zone AS "created_at",
    NULL::timestamp with time zone AS "updated_at",
    NULL::"jsonb" AS "items";


ALTER VIEW "ops"."v_kds_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "queue"."dead_letters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "source_schema" "text",
    "source_table" "text",
    "source_id" "uuid",
    "event_type" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error" "text",
    "attempts" smallint DEFAULT 0 NOT NULL,
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "queue"."dead_letters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "queue"."idempotency_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "scope" "text" NOT NULL,
    "key" "text" NOT NULL,
    "result" "jsonb",
    "locked_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "queue"."idempotency_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "queue"."inbound_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_event_id" "text",
    "event_type" "text" NOT NULL,
    "payload_hash" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'accepted'::"text" NOT NULL,
    "request_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "error" "text",
    CONSTRAINT "inbound_events_status_check" CHECK (("status" = ANY (ARRAY['accepted'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'duplicate'::"text"])))
);


ALTER TABLE "queue"."inbound_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "queue"."job_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "job_id" "uuid" NOT NULL,
    "attempt" smallint NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "outcome" "text" DEFAULT 'running'::"text" NOT NULL,
    "error" "text",
    "metadata" "jsonb",
    CONSTRAINT "job_attempts_outcome_check" CHECK (("outcome" = ANY (ARRAY['running'::"text", 'success'::"text", 'error'::"text", 'timeout'::"text"])))
);


ALTER TABLE "queue"."job_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "queue"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "job_class" "text" DEFAULT 'standard'::"text" NOT NULL,
    "inbound_event_id" "uuid",
    "conversation_id" "uuid",
    "order_id" "uuid",
    "job_type" "text" NOT NULL,
    "aggregate_type" "text",
    "aggregate_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" smallint DEFAULT 0 NOT NULL,
    "max_attempts" smallint DEFAULT 3 NOT NULL,
    "attempt_count" smallint DEFAULT 0 NOT NULL,
    "run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "completed_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "jobs_job_class_check" CHECK (("job_class" = ANY (ARRAY['standard'::"text", 'workflow'::"text"]))),
    CONSTRAINT "jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'claimed'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'dead'::"text"])))
);


ALTER TABLE "queue"."jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "queue"."outbox_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "job_id" "uuid",
    "event_type" "text" NOT NULL,
    "aggregate_id" "uuid",
    "idempotency_key" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" smallint DEFAULT 0 NOT NULL,
    "max_attempts" smallint DEFAULT 5 NOT NULL,
    "run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "outbox_events_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'delivering'::"text", 'delivered'::"text", 'failed'::"text", 'dead'::"text"])))
);


ALTER TABLE "queue"."outbox_events" OWNER TO "postgres";


ALTER TABLE ONLY "_migration"."account_map"
    ADD CONSTRAINT "account_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."card_map"
    ADD CONSTRAINT "card_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."conversation_map"
    ADD CONSTRAINT "conversation_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."job_map"
    ADD CONSTRAINT "job_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."lead_map"
    ADD CONSTRAINT "lead_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."message_map"
    ADD CONSTRAINT "message_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."order_map"
    ADD CONSTRAINT "order_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."otp_map"
    ADD CONSTRAINT "otp_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."person_map"
    ADD CONSTRAINT "person_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."phase_runs"
    ADD CONSTRAINT "phase_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "_migration"."session_map"
    ADD CONSTRAINT "session_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."subscription_map"
    ADD CONSTRAINT "subscription_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."tenant_map"
    ADD CONSTRAINT "tenant_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "_migration"."user_map"
    ADD CONSTRAINT "user_map_pkey" PRIMARY KEY ("source_system", "old_id");



ALTER TABLE ONLY "comms"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "comms"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "comms"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "comms"."conversations"
    ADD CONSTRAINT "conversations_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "comms"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "comms"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "comms"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_tenant_id_person_id_key" UNIQUE ("tenant_id", "person_id");



ALTER TABLE ONLY "comms"."daily_summaries"
    ADD CONSTRAINT "daily_summaries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "comms"."daily_summaries"
    ADD CONSTRAINT "daily_summaries_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "comms"."daily_summaries"
    ADD CONSTRAINT "daily_summaries_tenant_id_summary_date_key" UNIQUE ("tenant_id", "summary_date");



ALTER TABLE ONLY "comms"."knowledge_chunks"
    ADD CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "comms"."knowledge_chunks"
    ADD CONSTRAINT "knowledge_chunks_tenant_id_document_id_chunk_index_key" UNIQUE ("tenant_id", "document_id", "chunk_index");



ALTER TABLE ONLY "comms"."knowledge_chunks"
    ADD CONSTRAINT "knowledge_chunks_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "comms"."knowledge_documents"
    ADD CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "comms"."knowledge_documents"
    ADD CONSTRAINT "knowledge_documents_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "comms"."memory_items"
    ADD CONSTRAINT "memory_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "comms"."memory_items"
    ADD CONSTRAINT "memory_items_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "comms"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "comms"."messages"
    ADD CONSTRAINT "messages_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "comms"."tool_calls"
    ADD CONSTRAINT "tool_calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "comms"."tool_calls"
    ADD CONSTRAINT "tool_calls_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "core"."contact_merge_candidates"
    ADD CONSTRAINT "contact_merge_candidates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."contact_merge_candidates"
    ADD CONSTRAINT "contact_merge_candidates_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "core"."contact_methods"
    ADD CONSTRAINT "contact_methods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."contact_methods"
    ADD CONSTRAINT "contact_methods_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "core"."contact_methods"
    ADD CONSTRAINT "contact_methods_tenant_id_kind_normalized_value_key" UNIQUE ("tenant_id", "kind", "normalized_value");



ALTER TABLE ONLY "core"."external_refs"
    ADD CONSTRAINT "external_refs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."external_refs"
    ADD CONSTRAINT "external_refs_product_key_external_schema_external_table_ex_key" UNIQUE ("product_key", "external_schema", "external_table", "external_id");



ALTER TABLE ONLY "core"."integration_tokens"
    ADD CONSTRAINT "integration_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."integration_tokens"
    ADD CONSTRAINT "integration_tokens_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "core"."integration_tokens"
    ADD CONSTRAINT "integration_tokens_tenant_id_provider_key" UNIQUE ("tenant_id", "provider");



ALTER TABLE ONLY "core"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."locations"
    ADD CONSTRAINT "locations_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "core"."membership_roles"
    ADD CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membership_id", "role_id");



ALTER TABLE ONLY "core"."password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."people"
    ADD CONSTRAINT "people_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."people"
    ADD CONSTRAINT "people_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "core"."permissions"
    ADD CONSTRAINT "permissions_key_key" UNIQUE ("key");



ALTER TABLE ONLY "core"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."product_instances"
    ADD CONSTRAINT "product_instances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."product_instances"
    ADD CONSTRAINT "product_instances_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "core"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id");



ALTER TABLE ONLY "core"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."sessions"
    ADD CONSTRAINT "sessions_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "core"."sessions"
    ADD CONSTRAINT "sessions_token_key" UNIQUE ("token");



ALTER TABLE ONLY "core"."staff_members"
    ADD CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."staff_members"
    ADD CONSTRAINT "staff_members_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "core"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_tenant_id_user_id_key" UNIQUE ("tenant_id", "user_id");



ALTER TABLE ONLY "core"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "core"."users"
    ADD CONSTRAINT "users_auth_subject_key" UNIQUE ("auth_subject");



ALTER TABLE ONLY "core"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "device"."devices"
    ADD CONSTRAINT "devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "device"."devices"
    ADD CONSTRAINT "devices_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "device"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "device"."events"
    ADD CONSTRAINT "events_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "device"."pairing_requests"
    ADD CONSTRAINT "pairing_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "device"."pairing_requests"
    ADD CONSTRAINT "pairing_requests_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "device"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "device"."sessions"
    ADD CONSTRAINT "sessions_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "device"."sessions"
    ADD CONSTRAINT "sessions_tenant_id_token_hash_key" UNIQUE ("tenant_id", "token_hash");



ALTER TABLE ONLY "grow"."feature_flags"
    ADD CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "grow"."lead_events"
    ADD CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "grow"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "grow"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "grow"."subscriptions"
    ADD CONSTRAINT "subscriptions_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "grow"."subscriptions"
    ADD CONSTRAINT "subscriptions_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "kitchen"."station_assignments"
    ADD CONSTRAINT "station_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "kitchen"."station_assignments"
    ADD CONSTRAINT "station_assignments_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "kitchen"."station_groups"
    ADD CONSTRAINT "station_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "kitchen"."station_groups"
    ADD CONSTRAINT "station_groups_tenant_id_group_key_key" UNIQUE ("tenant_id", "group_key");



ALTER TABLE ONLY "kitchen"."station_groups"
    ADD CONSTRAINT "station_groups_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "kitchen"."stations"
    ADD CONSTRAINT "stations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "kitchen"."stations"
    ADD CONSTRAINT "stations_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."accounts"
    ADD CONSTRAINT "accounts_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."accounts"
    ADD CONSTRAINT "accounts_tenant_id_person_id_program_id_key" UNIQUE ("tenant_id", "person_id", "program_id");



ALTER TABLE ONLY "loyalty"."automation_rules"
    ADD CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."automation_rules"
    ADD CONSTRAINT "automation_rules_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."balances"
    ADD CONSTRAINT "balances_pkey" PRIMARY KEY ("loyalty_card_id");



ALTER TABLE ONLY "loyalty"."balances"
    ADD CONSTRAINT "balances_tenant_id_loyalty_card_id_key" UNIQUE ("tenant_id", "loyalty_card_id");



ALTER TABLE ONLY "loyalty"."birthday_rewards"
    ADD CONSTRAINT "birthday_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."birthday_rewards"
    ADD CONSTRAINT "birthday_rewards_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."birthday_rewards"
    ADD CONSTRAINT "birthday_rewards_tenant_id_loyalty_card_id_year_key" UNIQUE ("tenant_id", "loyalty_card_id", "year");



ALTER TABLE ONLY "loyalty"."cards"
    ADD CONSTRAINT "cards_card_number_key" UNIQUE ("card_number");



ALTER TABLE ONLY "loyalty"."cards"
    ADD CONSTRAINT "cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."cards"
    ADD CONSTRAINT "cards_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."gift_card_ledger"
    ADD CONSTRAINT "gift_card_ledger_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "loyalty"."gift_card_ledger"
    ADD CONSTRAINT "gift_card_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."gift_card_ledger"
    ADD CONSTRAINT "gift_card_ledger_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."gift_cards"
    ADD CONSTRAINT "gift_cards_code_key" UNIQUE ("code");



ALTER TABLE ONLY "loyalty"."gift_cards"
    ADD CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."gift_cards"
    ADD CONSTRAINT "gift_cards_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."lifecycle_sends"
    ADD CONSTRAINT "lifecycle_sends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."lifecycle_sends"
    ADD CONSTRAINT "lifecycle_sends_tenant_id_card_id_journey_key" UNIQUE ("tenant_id", "card_id", "journey");



ALTER TABLE ONLY "loyalty"."lifecycle_sends"
    ADD CONSTRAINT "lifecycle_sends_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."otp_verifications"
    ADD CONSTRAINT "otp_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."otp_verifications"
    ADD CONSTRAINT "otp_verifications_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."pass_devices"
    ADD CONSTRAINT "pass_devices_pass_id_device_token_key" UNIQUE ("pass_id", "device_token");



ALTER TABLE ONLY "loyalty"."pass_devices"
    ADD CONSTRAINT "pass_devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."pass_devices"
    ADD CONSTRAINT "pass_devices_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."passes"
    ADD CONSTRAINT "passes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."passes"
    ADD CONSTRAINT "passes_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."passes"
    ADD CONSTRAINT "passes_tenant_id_loyalty_card_id_provider_key" UNIQUE ("tenant_id", "loyalty_card_id", "provider");



ALTER TABLE ONLY "loyalty"."points_ledger"
    ADD CONSTRAINT "points_ledger_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "loyalty"."points_ledger"
    ADD CONSTRAINT "points_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."points_ledger"
    ADD CONSTRAINT "points_ledger_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."programs"
    ADD CONSTRAINT "programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."programs"
    ADD CONSTRAINT "programs_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."reward_configs"
    ADD CONSTRAINT "reward_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."reward_configs"
    ADD CONSTRAINT "reward_configs_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."reward_redemptions"
    ADD CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."reward_redemptions"
    ADD CONSTRAINT "reward_redemptions_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."visit_events"
    ADD CONSTRAINT "visit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."visit_events"
    ADD CONSTRAINT "visit_events_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "loyalty"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "loyalty"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "observability"."ai_runs"
    ADD CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "observability"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "observability"."conversation_outcomes"
    ADD CONSTRAINT "conversation_outcomes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "observability"."data_quality_findings"
    ADD CONSTRAINT "data_quality_findings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "observability"."edge_logs"
    ADD CONSTRAINT "edge_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "observability"."evaluation_traces"
    ADD CONSTRAINT "evaluation_traces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "observability"."pipeline_spans"
    ADD CONSTRAINT "pipeline_spans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "observability"."security_events"
    ADD CONSTRAINT "security_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."business_hours"
    ADD CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."business_hours"
    ADD CONSTRAINT "business_hours_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."businesses"
    ADD CONSTRAINT "businesses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."businesses"
    ADD CONSTRAINT "businesses_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."businesses"
    ADD CONSTRAINT "businesses_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "ops"."channel_accounts"
    ADD CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."channel_accounts"
    ADD CONSTRAINT "channel_accounts_provider_provider_account_id_key" UNIQUE ("provider", "provider_account_id");



ALTER TABLE ONLY "ops"."channel_accounts"
    ADD CONSTRAINT "channel_accounts_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."channels"
    ADD CONSTRAINT "channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."channels"
    ADD CONSTRAINT "channels_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."channels"
    ADD CONSTRAINT "channels_tenant_id_key_key" UNIQUE ("tenant_id", "key");



ALTER TABLE ONLY "ops"."order_events"
    ADD CONSTRAINT "order_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."order_events"
    ADD CONSTRAINT "order_events_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."order_items"
    ADD CONSTRAINT "order_items_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."orders"
    ADD CONSTRAINT "orders_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."payments"
    ADD CONSTRAINT "payments_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."product_categories"
    ADD CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."product_categories"
    ADD CONSTRAINT "product_categories_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."product_categories"
    ADD CONSTRAINT "product_categories_tenant_id_key_key" UNIQUE ("tenant_id", "key");



ALTER TABLE ONLY "ops"."product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."product_modifiers"
    ADD CONSTRAINT "product_modifiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."product_modifiers"
    ADD CONSTRAINT "product_modifiers_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."products"
    ADD CONSTRAINT "products_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."refunds"
    ADD CONSTRAINT "refunds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."refunds"
    ADD CONSTRAINT "refunds_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "ops"."service_windows"
    ADD CONSTRAINT "service_windows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."service_windows"
    ADD CONSTRAINT "service_windows_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "queue"."dead_letters"
    ADD CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "queue"."dead_letters"
    ADD CONSTRAINT "dead_letters_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "queue"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "queue"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "queue"."inbound_events"
    ADD CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "queue"."inbound_events"
    ADD CONSTRAINT "inbound_events_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "queue"."job_attempts"
    ADD CONSTRAINT "job_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "queue"."job_attempts"
    ADD CONSTRAINT "job_attempts_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "queue"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "queue"."jobs"
    ADD CONSTRAINT "jobs_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "queue"."outbox_events"
    ADD CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "queue"."outbox_events"
    ADD CONSTRAINT "outbox_events_tenant_id_id_key" UNIQUE ("tenant_id", "id");



ALTER TABLE ONLY "queue"."idempotency_keys"
    ADD CONSTRAINT "queue_idempotency_keys_scope_key_uq" UNIQUE ("tenant_id", "scope", "key");



ALTER TABLE ONLY "queue"."inbound_events"
    ADD CONSTRAINT "queue_inbound_events_provider_event_uq" UNIQUE ("provider", "provider_event_id");



ALTER TABLE ONLY "queue"."job_attempts"
    ADD CONSTRAINT "queue_job_attempts_job_attempt_uq" UNIQUE ("job_id", "attempt");



ALTER TABLE ONLY "queue"."jobs"
    ADD CONSTRAINT "queue_jobs_inbound_event_job_type_uq" UNIQUE ("inbound_event_id", "job_type");



ALTER TABLE ONLY "queue"."outbox_events"
    ADD CONSTRAINT "queue_outbox_events_idempotency_uq" UNIQUE ("idempotency_key");



CREATE INDEX "migration_account_map_new_id_idx" ON "_migration"."account_map" USING "btree" ("new_id");



CREATE INDEX "migration_card_map_new_id_idx" ON "_migration"."card_map" USING "btree" ("new_id");



CREATE INDEX "migration_conversation_map_new_id_idx" ON "_migration"."conversation_map" USING "btree" ("new_id");



CREATE INDEX "migration_job_map_new_id_idx" ON "_migration"."job_map" USING "btree" ("new_id");



CREATE INDEX "migration_lead_map_new_id_idx" ON "_migration"."lead_map" USING "btree" ("new_id");



CREATE INDEX "migration_message_map_new_id_idx" ON "_migration"."message_map" USING "btree" ("new_id");



CREATE INDEX "migration_order_map_new_id_idx" ON "_migration"."order_map" USING "btree" ("new_id");



CREATE INDEX "migration_otp_map_new_id_idx" ON "_migration"."otp_map" USING "btree" ("new_id");



CREATE INDEX "migration_person_map_new_id_idx" ON "_migration"."person_map" USING "btree" ("new_id");



CREATE INDEX "migration_phase_runs_phase_idx" ON "_migration"."phase_runs" USING "btree" ("phase", "started_at" DESC);



CREATE INDEX "migration_session_map_new_id_idx" ON "_migration"."session_map" USING "btree" ("new_id");



CREATE INDEX "migration_subscription_map_new_id_idx" ON "_migration"."subscription_map" USING "btree" ("new_id");



CREATE INDEX "migration_tenant_map_new_id_idx" ON "_migration"."tenant_map" USING "btree" ("new_id");



CREATE INDEX "migration_user_map_new_id_idx" ON "_migration"."user_map" USING "btree" ("new_id");



CREATE INDEX "comms_conversation_turns_conv_created_idx" ON "comms"."conversation_turns" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "comms_conversation_turns_source_msgs_gin" ON "comms"."conversation_turns" USING "gin" ("source_message_ids");



CREATE INDEX "comms_conversation_turns_status_hold_idx" ON "comms"."conversation_turns" USING "btree" ("status", "hold_until");



CREATE INDEX "comms_conversations_tenant_lastmsg_idx" ON "comms"."conversations" USING "btree" ("tenant_id", "last_message_at" DESC);



CREATE INDEX "comms_conversations_tenant_person_status_idx" ON "comms"."conversations" USING "btree" ("tenant_id", "person_id", "status");



CREATE INDEX "comms_customer_preferences_last_txn_idx" ON "comms"."customer_preferences" USING "btree" ("tenant_id", "last_transaction_at" DESC);



CREATE INDEX "comms_daily_summaries_tenant_date_idx" ON "comms"."daily_summaries" USING "btree" ("tenant_id", "summary_date" DESC);



CREATE INDEX "comms_knowledge_chunks_document_idx" ON "comms"."knowledge_chunks" USING "btree" ("tenant_id", "document_id", "chunk_index");



CREATE INDEX "comms_knowledge_chunks_embedding_idx" ON "comms"."knowledge_chunks" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "comms_knowledge_documents_tenant_type_idx" ON "comms"."knowledge_documents" USING "btree" ("tenant_id", "doc_type", "status");



CREATE INDEX "comms_memory_items_contact_idx" ON "comms"."memory_items" USING "btree" ("tenant_id", "person_id", "updated_at" DESC);



CREATE INDEX "comms_memory_items_embedding_idx" ON "comms"."memory_items" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "comms_memory_items_type_idx" ON "comms"."memory_items" USING "btree" ("tenant_id", "memory_type");



CREATE INDEX "comms_messages_conversation_created_idx" ON "comms"."messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "comms_messages_embedding_idx" ON "comms"."messages" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "comms_messages_tenant_conversation_idx" ON "comms"."messages" USING "btree" ("tenant_id", "conversation_id", "created_at");



CREATE UNIQUE INDEX "comms_messages_twilio_sid_uidx" ON "comms"."messages" USING "btree" ("twilio_message_sid") WHERE ("twilio_message_sid" IS NOT NULL);



CREATE INDEX "comms_tool_calls_tenant_conv_idx" ON "comms"."tool_calls" USING "btree" ("tenant_id", "conversation_id", "started_at");



CREATE INDEX "comms_tool_calls_turn_idx" ON "comms"."tool_calls" USING "btree" ("turn_id", "started_at");



CREATE UNIQUE INDEX "core_contact_merge_candidates_pair_uidx" ON "core"."contact_merge_candidates" USING "btree" ("tenant_id", "person_id_least", "person_id_greatest", "match_type");



CREATE INDEX "core_contact_merge_candidates_tenant_conf_idx" ON "core"."contact_merge_candidates" USING "btree" ("tenant_id", "confidence", "created_at" DESC);



CREATE INDEX "core_contact_methods_lookup_idx" ON "core"."contact_methods" USING "btree" ("tenant_id", "kind", "normalized_value");



CREATE INDEX "core_contact_methods_person_idx" ON "core"."contact_methods" USING "btree" ("tenant_id", "person_id");



CREATE UNIQUE INDEX "core_contact_methods_primary_uidx" ON "core"."contact_methods" USING "btree" ("tenant_id", "person_id", "kind") WHERE "is_primary";



CREATE UNIQUE INDEX "core_contact_methods_verified_uidx" ON "core"."contact_methods" USING "btree" ("tenant_id", "kind", "normalized_value") WHERE ("verified_at" IS NOT NULL);



CREATE INDEX "core_external_refs_tenant_idx" ON "core"."external_refs" USING "btree" ("tenant_id", "product_key");



CREATE INDEX "core_locations_tenant_idx" ON "core"."locations" USING "btree" ("tenant_id", "status");



CREATE UNIQUE INDEX "core_locations_tenant_slug_uidx" ON "core"."locations" USING "btree" ("tenant_id", "slug") WHERE ("slug" IS NOT NULL);



CREATE INDEX "core_password_reset_tokens_user_idx" ON "core"."password_reset_tokens" USING "btree" ("user_id");



CREATE INDEX "core_people_tenant_birth_idx" ON "core"."people" USING "btree" ("tenant_id", "birth_date") WHERE ("birth_date" IS NOT NULL);



CREATE INDEX "core_people_tenant_name_idx" ON "core"."people" USING "btree" ("tenant_id", "display_name");



CREATE INDEX "core_people_tenant_phone_idx" ON "core"."people" USING "btree" ("tenant_id", "normalized_phone") WHERE ("normalized_phone" IS NOT NULL);



CREATE UNIQUE INDEX "core_product_instances_tenant_location_product_uidx" ON "core"."product_instances" USING "btree" ("tenant_id", "location_id", "product_key") WHERE ("location_id" IS NOT NULL);



CREATE UNIQUE INDEX "core_product_instances_tenant_product_uidx" ON "core"."product_instances" USING "btree" ("tenant_id", "product_key") WHERE ("location_id" IS NULL);



CREATE UNIQUE INDEX "core_roles_global_key_uidx" ON "core"."roles" USING "btree" ("key") WHERE ("tenant_id" IS NULL);



CREATE UNIQUE INDEX "core_roles_tenant_key_uidx" ON "core"."roles" USING "btree" ("tenant_id", "key") WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "core_sessions_expires_idx" ON "core"."sessions" USING "btree" ("expires_at");



CREATE INDEX "core_sessions_person_idx" ON "core"."sessions" USING "btree" ("person_id") WHERE ("person_id" IS NOT NULL);



CREATE INDEX "core_sessions_user_idx" ON "core"."sessions" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);



CREATE UNIQUE INDEX "core_staff_members_tenant_email_uidx" ON "core"."staff_members" USING "btree" ("tenant_id", "lower"("email")) WHERE ("email" IS NOT NULL);



CREATE INDEX "core_staff_members_tenant_status_idx" ON "core"."staff_members" USING "btree" ("tenant_id", "status", "name");



CREATE INDEX "core_tenant_memberships_user_idx" ON "core"."tenant_memberships" USING "btree" ("user_id");



CREATE UNIQUE INDEX "core_users_email_uidx" ON "core"."users" USING "btree" ("lower"("email")) WHERE ("email" IS NOT NULL);



CREATE INDEX "locations_search_text_trgm" ON "core"."locations" USING "gin" ("search_text" "extensions"."gin_trgm_ops");



CREATE INDEX "password_reset_tokens_expires_at_idx" ON "core"."password_reset_tokens" USING "btree" ("expires_at");



CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "core"."password_reset_tokens" USING "btree" ("token_hash");



CREATE INDEX "device_devices_station_idx" ON "device"."devices" USING "btree" ("tenant_id", "station_id") WHERE ("station_id" IS NOT NULL);



CREATE INDEX "device_devices_tenant_status_idx" ON "device"."devices" USING "btree" ("tenant_id", "status");



CREATE INDEX "device_events_session_idx" ON "device"."events" USING "btree" ("tenant_id", "session_id") WHERE ("session_id" IS NOT NULL);



CREATE INDEX "device_events_tenant_time_idx" ON "device"."events" USING "btree" ("tenant_id", "occurred_at" DESC);



CREATE INDEX "device_pairing_requests_pending_idx" ON "device"."pairing_requests" USING "btree" ("status", "expires_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "device_pairing_requests_tenant_status_idx" ON "device"."pairing_requests" USING "btree" ("tenant_id", "location_id", "status", "expires_at" DESC);



CREATE INDEX "device_sessions_device_idx" ON "device"."sessions" USING "btree" ("tenant_id", "device_id") WHERE ("device_id" IS NOT NULL);



CREATE INDEX "device_sessions_tenant_active_idx" ON "device"."sessions" USING "btree" ("tenant_id", "is_active");



CREATE INDEX "grow_feature_flags_enabled_idx" ON "grow"."feature_flags" USING "btree" ("key", "enabled");



CREATE UNIQUE INDEX "grow_feature_flags_global_key_uidx" ON "grow"."feature_flags" USING "btree" ("key") WHERE ("tenant_id" IS NULL);



CREATE UNIQUE INDEX "grow_feature_flags_tenant_key_uidx" ON "grow"."feature_flags" USING "btree" ("tenant_id", "key") WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "grow_lead_events_created_at_idx" ON "grow"."lead_events" USING "btree" ("created_at" DESC);



CREATE INDEX "grow_lead_events_lead_id_idx" ON "grow"."lead_events" USING "btree" ("lead_id", "created_at" DESC);



CREATE INDEX "grow_lead_events_type_idx" ON "grow"."lead_events" USING "btree" ("event_type");



CREATE INDEX "grow_leads_created_at_idx" ON "grow"."leads" USING "btree" ("created_at" DESC);



CREATE INDEX "grow_leads_diagnostic_date_idx" ON "grow"."leads" USING "btree" ("diagnostic_date" DESC);



CREATE UNIQUE INDEX "grow_leads_email_active_uidx" ON "grow"."leads" USING "btree" ("email") WHERE ("lifecycle_status" = ANY (ARRAY['new'::"text", 'nurturing'::"text", 'qualified'::"text"]));



CREATE INDEX "grow_leads_email_idx" ON "grow"."leads" USING "btree" ("email");



CREATE INDEX "grow_leads_lifecycle_idx" ON "grow"."leads" USING "btree" ("lifecycle_status");



CREATE INDEX "grow_leads_utm_campaign_idx" ON "grow"."leads" USING "btree" ("utm_campaign") WHERE ("utm_campaign" IS NOT NULL);



CREATE INDEX "grow_subscriptions_status_idx" ON "grow"."subscriptions" USING "btree" ("status");



CREATE INDEX "grow_subscriptions_trial_ends_idx" ON "grow"."subscriptions" USING "btree" ("trial_ends_at") WHERE ("trial_ends_at" IS NOT NULL);



CREATE INDEX "kitchen_station_assignments_group_idx" ON "kitchen"."station_assignments" USING "btree" ("tenant_id", "group_id") WHERE ("group_id" IS NOT NULL);



CREATE UNIQUE INDEX "kitchen_station_assignments_product_key_uidx" ON "kitchen"."station_assignments" USING "btree" ("tenant_id", "station_id", "product_key") WHERE ("product_key" IS NOT NULL);



CREATE UNIQUE INDEX "kitchen_station_assignments_product_ref_uidx" ON "kitchen"."station_assignments" USING "btree" ("tenant_id", "station_id", "product_ref") WHERE ("product_ref" IS NOT NULL);



CREATE INDEX "kitchen_station_assignments_station_idx" ON "kitchen"."station_assignments" USING "btree" ("tenant_id", "station_id", "sort_order");



CREATE INDEX "kitchen_station_groups_tenant_idx" ON "kitchen"."station_groups" USING "btree" ("tenant_id", "sort_order");



CREATE UNIQUE INDEX "kitchen_stations_tenant_key_uidx" ON "kitchen"."stations" USING "btree" ("tenant_id", "station_key") WHERE ("location_id" IS NULL);



CREATE UNIQUE INDEX "kitchen_stations_tenant_location_key_uidx" ON "kitchen"."stations" USING "btree" ("tenant_id", "location_id", "station_key") WHERE ("location_id" IS NOT NULL);



CREATE INDEX "kitchen_stations_tenant_status_idx" ON "kitchen"."stations" USING "btree" ("tenant_id", "status", "sort_order");



CREATE INDEX "loyalty_accounts_tenant_person_idx" ON "loyalty"."accounts" USING "btree" ("tenant_id", "person_id");



CREATE INDEX "loyalty_accounts_tenant_status_idx" ON "loyalty"."accounts" USING "btree" ("tenant_id", "status");



CREATE INDEX "loyalty_automation_rules_tenant_active_idx" ON "loyalty"."automation_rules" USING "btree" ("tenant_id", "trigger_type", "is_active");



CREATE INDEX "loyalty_balances_tenant_idx" ON "loyalty"."balances" USING "btree" ("tenant_id");



CREATE INDEX "loyalty_birthday_rewards_active_idx" ON "loyalty"."birthday_rewards" USING "btree" ("tenant_id", "status", "expires_at") WHERE ("status" = 'active'::"text");



CREATE INDEX "loyalty_birthday_rewards_card_idx" ON "loyalty"."birthday_rewards" USING "btree" ("tenant_id", "loyalty_card_id", "year" DESC);



CREATE INDEX "loyalty_cards_account_idx" ON "loyalty"."cards" USING "btree" ("tenant_id", "account_id");



CREATE UNIQUE INDEX "loyalty_cards_qr_token_uidx" ON "loyalty"."cards" USING "btree" ("qr_token") WHERE ("qr_token" IS NOT NULL);



CREATE INDEX "loyalty_cards_tenant_idx" ON "loyalty"."cards" USING "btree" ("tenant_id", "status");



CREATE INDEX "loyalty_gift_card_ledger_card_idx" ON "loyalty"."gift_card_ledger" USING "btree" ("tenant_id", "gift_card_id", "created_at" DESC);



CREATE INDEX "loyalty_gift_cards_recipient_email_idx" ON "loyalty"."gift_cards" USING "btree" ("tenant_id", "lower"("recipient_email")) WHERE ("recipient_email" IS NOT NULL);



CREATE INDEX "loyalty_gift_cards_recipient_phone_idx" ON "loyalty"."gift_cards" USING "btree" ("tenant_id", "recipient_phone") WHERE ("recipient_phone" IS NOT NULL);



CREATE INDEX "loyalty_gift_cards_tenant_redeemed_idx" ON "loyalty"."gift_cards" USING "btree" ("tenant_id", "redeemed_at");



CREATE INDEX "loyalty_lifecycle_sends_card_idx" ON "loyalty"."lifecycle_sends" USING "btree" ("tenant_id", "card_id", "sent_at" DESC);



CREATE INDEX "loyalty_otp_verifications_expires_idx" ON "loyalty"."otp_verifications" USING "btree" ("expires_at");



CREATE INDEX "loyalty_otp_verifications_identity_idx" ON "loyalty"."otp_verifications" USING "btree" ("tenant_id", "identity_type", "identity_value", "created_at" DESC);



CREATE INDEX "loyalty_pass_devices_pass_idx" ON "loyalty"."pass_devices" USING "btree" ("tenant_id", "pass_id");



CREATE UNIQUE INDEX "loyalty_passes_apple_serial_uidx" ON "loyalty"."passes" USING "btree" ("serial_number") WHERE ("serial_number" IS NOT NULL);



CREATE INDEX "loyalty_passes_card_idx" ON "loyalty"."passes" USING "btree" ("tenant_id", "loyalty_card_id");



CREATE UNIQUE INDEX "loyalty_passes_google_object_uidx" ON "loyalty"."passes" USING "btree" ("provider_object_id") WHERE ("provider_object_id" IS NOT NULL);



CREATE INDEX "loyalty_passes_tenant_provider_idx" ON "loyalty"."passes" USING "btree" ("tenant_id", "provider");



CREATE INDEX "loyalty_points_ledger_card_idx" ON "loyalty"."points_ledger" USING "btree" ("tenant_id", "loyalty_card_id", "created_at" DESC);



CREATE INDEX "loyalty_points_ledger_reason_idx" ON "loyalty"."points_ledger" USING "btree" ("reason");



CREATE INDEX "loyalty_points_ledger_source_idx" ON "loyalty"."points_ledger" USING "btree" ("source_type", "source_id") WHERE ("source_type" IS NOT NULL);



CREATE INDEX "loyalty_programs_tenant_status_idx" ON "loyalty"."programs" USING "btree" ("tenant_id", "status");



CREATE INDEX "loyalty_reward_configs_tenant_active_idx" ON "loyalty"."reward_configs" USING "btree" ("tenant_id", "is_active", "activated_at" DESC);



CREATE INDEX "loyalty_reward_redemptions_card_idx" ON "loyalty"."reward_redemptions" USING "btree" ("tenant_id", "loyalty_card_id", "redeemed_at" DESC);



CREATE INDEX "loyalty_reward_redemptions_config_idx" ON "loyalty"."reward_redemptions" USING "btree" ("tenant_id", "reward_config_id");



CREATE INDEX "loyalty_visit_events_card_idx" ON "loyalty"."visit_events" USING "btree" ("tenant_id", "loyalty_card_id", "occurred_at" DESC);



CREATE INDEX "loyalty_visit_events_staff_idx" ON "loyalty"."visit_events" USING "btree" ("tenant_id", "staff_member_id") WHERE ("staff_member_id" IS NOT NULL);



CREATE INDEX "loyalty_wallet_transactions_card_idx" ON "loyalty"."wallet_transactions" USING "btree" ("tenant_id", "loyalty_card_id", "created_at" DESC);



CREATE INDEX "loyalty_wallet_transactions_staff_idx" ON "loyalty"."wallet_transactions" USING "btree" ("tenant_id", "staff_member_id") WHERE ("staff_member_id" IS NOT NULL);



CREATE INDEX "observability_ai_runs_conversation_idx" ON "observability"."ai_runs" USING "btree" ("conversation_id") WHERE ("conversation_id" IS NOT NULL);



CREATE INDEX "observability_ai_runs_model_time_idx" ON "observability"."ai_runs" USING "btree" ("model", "created_at" DESC);



CREATE INDEX "observability_ai_runs_request_idx" ON "observability"."ai_runs" USING "btree" ("request_id") WHERE ("request_id" IS NOT NULL);



CREATE INDEX "observability_ai_runs_tenant_time_idx" ON "observability"."ai_runs" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "observability_audit_log_actor_time_idx" ON "observability"."audit_log" USING "btree" ("actor_slack_id", "changed_at" DESC) WHERE ("actor_slack_id" IS NOT NULL);



CREATE INDEX "observability_audit_log_tenant_time_idx" ON "observability"."audit_log" USING "btree" ("tenant_id", "changed_at" DESC);



CREATE INDEX "observability_conversation_outcomes_conversation_idx" ON "observability"."conversation_outcomes" USING "btree" ("conversation_id") WHERE ("conversation_id" IS NOT NULL);



CREATE INDEX "observability_conversation_outcomes_outcome_idx" ON "observability"."conversation_outcomes" USING "btree" ("outcome", "created_at" DESC);



CREATE INDEX "observability_conversation_outcomes_tenant_time_idx" ON "observability"."conversation_outcomes" USING "btree" ("tenant_id", "created_at" DESC) WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "observability_data_quality_findings_check_idx" ON "observability"."data_quality_findings" USING "btree" ("check_name", "created_at" DESC);



CREATE INDEX "observability_data_quality_findings_open_idx" ON "observability"."data_quality_findings" USING "btree" ("severity", "created_at" DESC) WHERE ("resolved_at" IS NULL);



CREATE INDEX "observability_data_quality_findings_tenant_idx" ON "observability"."data_quality_findings" USING "btree" ("tenant_id", "created_at" DESC) WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "observability_edge_logs_fn_time_idx" ON "observability"."edge_logs" USING "btree" ("function_name", "created_at" DESC);



CREATE INDEX "observability_edge_logs_request_idx" ON "observability"."edge_logs" USING "btree" ("request_id") WHERE ("request_id" IS NOT NULL);



CREATE INDEX "observability_edge_logs_status_time_idx" ON "observability"."edge_logs" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "observability_evaluation_traces_agreement_idx" ON "observability"."evaluation_traces" USING "btree" ("agreement", "created_at" DESC) WHERE ("agreement" IS NOT NULL);



CREATE INDEX "observability_evaluation_traces_conversation_idx" ON "observability"."evaluation_traces" USING "btree" ("conversation_id") WHERE ("conversation_id" IS NOT NULL);



CREATE INDEX "observability_evaluation_traces_tenant_time_idx" ON "observability"."evaluation_traces" USING "btree" ("tenant_id", "created_at" DESC) WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "observability_pipeline_spans_conversation_idx" ON "observability"."pipeline_spans" USING "btree" ("conversation_id") WHERE ("conversation_id" IS NOT NULL);



CREATE INDEX "observability_pipeline_spans_stage_idx" ON "observability"."pipeline_spans" USING "btree" ("stage", "occurred_at" DESC);



CREATE INDEX "observability_pipeline_spans_tenant_time_idx" ON "observability"."pipeline_spans" USING "btree" ("tenant_id", "occurred_at" DESC) WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "observability_pipeline_spans_trace_idx" ON "observability"."pipeline_spans" USING "btree" ("trace_id", "occurred_at");



CREATE INDEX "observability_security_events_phone_idx" ON "observability"."security_events" USING "btree" ("phone");



CREATE INDEX "observability_security_events_tenant_time_idx" ON "observability"."security_events" USING "btree" ("tenant_id", "event_at" DESC) WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "observability_security_events_type_time_idx" ON "observability"."security_events" USING "btree" ("event_type", "event_at" DESC);



CREATE INDEX "ops_business_hours_tenant_idx" ON "ops"."business_hours" USING "btree" ("tenant_id", "location_id", "day_of_week");



CREATE UNIQUE INDEX "ops_business_hours_tenant_loc_dow_uniq" ON "ops"."business_hours" USING "btree" ("tenant_id", COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "day_of_week");



CREATE INDEX "ops_businesses_tenant_idx" ON "ops"."businesses" USING "btree" ("tenant_id");



CREATE INDEX "ops_channel_accounts_tenant_channel_idx" ON "ops"."channel_accounts" USING "btree" ("tenant_id", "channel_id");



CREATE INDEX "ops_channels_tenant_idx" ON "ops"."channels" USING "btree" ("tenant_id", "status");



CREATE UNIQUE INDEX "ops_order_events_idem_uidx" ON "ops"."order_events" USING "btree" ("tenant_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "ops_order_events_kitchen_seq_idx" ON "ops"."order_events" USING "btree" ("tenant_id", "kitchen_sequence") WHERE ("kitchen_sequence" IS NOT NULL);



CREATE INDEX "ops_order_events_order_idx" ON "ops"."order_events" USING "btree" ("tenant_id", "order_id", "occurred_at" DESC);



CREATE INDEX "ops_order_items_order_idx" ON "ops"."order_items" USING "btree" ("tenant_id", "order_id", "display_order");



CREATE INDEX "ops_order_items_tenant_kitchen_status_idx" ON "ops"."order_items" USING "btree" ("tenant_id", "kitchen_status") WHERE ("kitchen_status" IS NOT NULL);



CREATE INDEX "ops_orders_person_idx" ON "ops"."orders" USING "btree" ("tenant_id", "person_id") WHERE ("person_id" IS NOT NULL);



CREATE UNIQUE INDEX "ops_orders_source_transaction_uidx" ON "ops"."orders" USING "btree" ("tenant_id", "source_transaction_id") WHERE ("source_transaction_id" IS NOT NULL);



CREATE INDEX "ops_orders_tenant_created_idx" ON "ops"."orders" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "ops_orders_tenant_kitchen_status_idx" ON "ops"."orders" USING "btree" ("tenant_id", "kitchen_status", "created_at") WHERE ("kitchen_status" IS NOT NULL);



CREATE INDEX "ops_orders_tenant_status_idx" ON "ops"."orders" USING "btree" ("tenant_id", "status");



CREATE INDEX "ops_payments_tenant_order_idx" ON "ops"."payments" USING "btree" ("tenant_id", "order_id");



CREATE INDEX "ops_payments_tenant_status_idx" ON "ops"."payments" USING "btree" ("tenant_id", "status", "created_at" DESC);



CREATE INDEX "ops_product_categories_tenant_idx" ON "ops"."product_categories" USING "btree" ("tenant_id", "sort_order");



CREATE INDEX "ops_product_modifier_groups_tenant_product_idx" ON "ops"."product_modifier_groups" USING "btree" ("tenant_id", "product_id");



CREATE INDEX "ops_product_modifiers_tenant_group_idx" ON "ops"."product_modifiers" USING "btree" ("tenant_id", "modifier_group_id", "sort_order");



CREATE INDEX "ops_products_name_embedding_idx" ON "ops"."products" USING "hnsw" ("name_embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "ops_products_name_trgm_idx" ON "ops"."products" USING "gin" ("lower"("name") "extensions"."gin_trgm_ops");



CREATE INDEX "ops_products_tenant_available_idx" ON "ops"."products" USING "btree" ("tenant_id", "is_available");



CREATE INDEX "ops_products_tenant_category_idx" ON "ops"."products" USING "btree" ("tenant_id", "category_id") WHERE ("category_id" IS NOT NULL);



CREATE INDEX "ops_refunds_tenant_payment_idx" ON "ops"."refunds" USING "btree" ("tenant_id", "payment_id");



CREATE INDEX "ops_service_windows_tenant_range_idx" ON "ops"."service_windows" USING "btree" ("tenant_id", "starts_at", "ends_at");



CREATE INDEX "queue_dead_letters_source_idx" ON "queue"."dead_letters" USING "btree" ("source_schema", "source_table", "source_id") WHERE ("source_id" IS NOT NULL);



CREATE INDEX "queue_dead_letters_tenant_unresolved_idx" ON "queue"."dead_letters" USING "btree" ("tenant_id", "created_at" DESC) WHERE ("resolved_at" IS NULL);



CREATE INDEX "queue_idempotency_keys_expires_idx" ON "queue"."idempotency_keys" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);



CREATE INDEX "queue_inbound_events_inflight_idx" ON "queue"."inbound_events" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['accepted'::"text", 'processing'::"text"]));



CREATE INDEX "queue_inbound_events_tenant_received_idx" ON "queue"."inbound_events" USING "btree" ("tenant_id", "received_at" DESC);



CREATE INDEX "queue_job_attempts_job_idx" ON "queue"."job_attempts" USING "btree" ("job_id", "attempt");



CREATE INDEX "queue_job_attempts_tenant_idx" ON "queue"."job_attempts" USING "btree" ("tenant_id", "started_at" DESC);



CREATE INDEX "queue_jobs_aggregate_idx" ON "queue"."jobs" USING "btree" ("aggregate_type", "aggregate_id");



CREATE INDEX "queue_jobs_claimable_idx" ON "queue"."jobs" USING "btree" ("priority" DESC, "run_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "queue_jobs_claimed_locked_idx" ON "queue"."jobs" USING "btree" ("locked_at") WHERE ("status" = 'claimed'::"text");



CREATE INDEX "queue_jobs_conversation_idx" ON "queue"."jobs" USING "btree" ("conversation_id") WHERE ("conversation_id" IS NOT NULL);



CREATE INDEX "queue_jobs_order_idx" ON "queue"."jobs" USING "btree" ("order_id") WHERE ("order_id" IS NOT NULL);



CREATE INDEX "queue_jobs_tenant_created_idx" ON "queue"."jobs" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "queue_outbox_events_deliverable_idx" ON "queue"."outbox_events" USING "btree" ("run_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "queue_outbox_events_job_idx" ON "queue"."outbox_events" USING "btree" ("job_id") WHERE ("job_id" IS NOT NULL);



CREATE INDEX "queue_outbox_events_tenant_created_idx" ON "queue"."outbox_events" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "queue_outbox_events_type_idx" ON "queue"."outbox_events" USING "btree" ("event_type", "created_at" DESC);



CREATE OR REPLACE VIEW "ops"."v_kds_tickets" AS
 SELECT "o"."id" AS "ticket_id",
    "o"."tenant_id",
    "o"."source_transaction_id",
    "o"."channel" AS "source_channel",
    "o"."person_id" AS "customer_person_id",
    "o"."kitchen_status" AS "status",
    "o"."station_id",
    "o"."station_name",
    "o"."pickup_person",
    "o"."notes" AS "customer_note",
    "o"."cancellation_reason",
    "o"."partial_cancellation_reason",
    "o"."total_cents",
    "o"."created_at",
    "o"."updated_at",
    COALESCE("jsonb_agg"("jsonb_build_object"('ticket_item_id', "oi"."id", 'product_id', "oi"."product_id", 'display_order', "oi"."display_order", 'name', "oi"."name", 'variant_name', "oi"."variant_name", 'quantity', "oi"."quantity", 'unit_price_cents', "oi"."unit_price_cents", 'notes', "oi"."notes", 'kitchen_status', "oi"."kitchen_status", 'is_cancelled', "oi"."is_cancelled") ORDER BY "oi"."display_order") FILTER (WHERE ("oi"."id" IS NOT NULL)), '[]'::"jsonb") AS "items"
   FROM ("ops"."orders" "o"
     LEFT JOIN "ops"."order_items" "oi" ON ((("oi"."tenant_id" = "o"."tenant_id") AND ("oi"."order_id" = "o"."id"))))
  WHERE ("o"."kitchen_status" IS NOT NULL)
  GROUP BY "o"."id";



CREATE OR REPLACE TRIGGER "gift_card_ledger_append_only" BEFORE DELETE OR UPDATE ON "loyalty"."gift_card_ledger" FOR EACH ROW EXECUTE FUNCTION "core"."block_append_only_mutation"();



CREATE OR REPLACE TRIGGER "points_ledger_append_only" BEFORE DELETE OR UPDATE ON "loyalty"."points_ledger" FOR EACH ROW EXECUTE FUNCTION "core"."block_append_only_mutation"();



CREATE OR REPLACE TRIGGER "wallet_transactions_append_only" BEFORE DELETE OR UPDATE ON "loyalty"."wallet_transactions" FOR EACH ROW EXECUTE FUNCTION "core"."block_append_only_mutation"();



CREATE OR REPLACE TRIGGER "audit_log_immutable" BEFORE DELETE OR UPDATE ON "observability"."audit_log" FOR EACH ROW EXECUTE FUNCTION "core"."block_append_only_mutation"();



CREATE OR REPLACE TRIGGER "ops_order_events_immutable" BEFORE DELETE OR UPDATE ON "ops"."order_events" FOR EACH ROW EXECUTE FUNCTION "ops"."block_order_event_mutation"();



ALTER TABLE ONLY "comms"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_tenant_id_assistant_message_id_fkey" FOREIGN KEY ("tenant_id", "assistant_message_id") REFERENCES "comms"."messages"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "comms"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "comms"."conversations"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "core"."people"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "comms"."conversations"
    ADD CONSTRAINT "conversations_selected_location_fk" FOREIGN KEY ("tenant_id", "selected_location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "comms"."conversations"
    ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."conversations"
    ADD CONSTRAINT "conversations_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "core"."people"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "comms"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."customer_preferences"
    ADD CONSTRAINT "customer_preferences_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "core"."people"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."daily_summaries"
    ADD CONSTRAINT "daily_summaries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."knowledge_chunks"
    ADD CONSTRAINT "knowledge_chunks_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "comms"."knowledge_documents"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."knowledge_chunks"
    ADD CONSTRAINT "knowledge_chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."knowledge_documents"
    ADD CONSTRAINT "knowledge_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."knowledge_documents"
    ADD CONSTRAINT "knowledge_documents_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "comms"."memory_items"
    ADD CONSTRAINT "memory_items_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "comms"."conversations"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "comms"."memory_items"
    ADD CONSTRAINT "memory_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."memory_items"
    ADD CONSTRAINT "memory_items_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "core"."people"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."messages"
    ADD CONSTRAINT "messages_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "comms"."conversations"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."messages"
    ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."tool_calls"
    ADD CONSTRAINT "tool_calls_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "comms"."conversations"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."tool_calls"
    ADD CONSTRAINT "tool_calls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "comms"."tool_calls"
    ADD CONSTRAINT "tool_calls_tenant_id_turn_id_fkey" FOREIGN KEY ("tenant_id", "turn_id") REFERENCES "comms"."conversation_turns"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."contact_merge_candidates"
    ADD CONSTRAINT "contact_merge_candidates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."contact_merge_candidates"
    ADD CONSTRAINT "contact_merge_candidates_tenant_id_left_person_id_fkey" FOREIGN KEY ("tenant_id", "left_person_id") REFERENCES "core"."people"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."contact_merge_candidates"
    ADD CONSTRAINT "contact_merge_candidates_tenant_id_right_person_id_fkey" FOREIGN KEY ("tenant_id", "right_person_id") REFERENCES "core"."people"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."contact_methods"
    ADD CONSTRAINT "contact_methods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."contact_methods"
    ADD CONSTRAINT "contact_methods_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "core"."people"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."external_refs"
    ADD CONSTRAINT "external_refs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."integration_tokens"
    ADD CONSTRAINT "integration_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."locations"
    ADD CONSTRAINT "locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."membership_roles"
    ADD CONSTRAINT "membership_roles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "core"."tenant_memberships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."membership_roles"
    ADD CONSTRAINT "membership_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "core"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."people"
    ADD CONSTRAINT "people_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."product_instances"
    ADD CONSTRAINT "product_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."product_instances"
    ADD CONSTRAINT "product_instances_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "core"."permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "core"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."roles"
    ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."sessions"
    ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."sessions"
    ADD CONSTRAINT "sessions_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "core"."people"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."sessions"
    ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."staff_members"
    ADD CONSTRAINT "staff_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."staff_members"
    ADD CONSTRAINT "staff_members_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "core"."staff_members"
    ADD CONSTRAINT "staff_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "core"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "device"."devices"
    ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "device"."devices"
    ADD CONSTRAINT "devices_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "device"."events"
    ADD CONSTRAINT "events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "device"."events"
    ADD CONSTRAINT "events_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "device"."sessions"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "device"."pairing_requests"
    ADD CONSTRAINT "pairing_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "core"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "device"."pairing_requests"
    ADD CONSTRAINT "pairing_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "device"."pairing_requests"
    ADD CONSTRAINT "pairing_requests_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "device"."sessions"
    ADD CONSTRAINT "sessions_tenant_id_device_id_fkey" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "device"."devices"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "device"."sessions"
    ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "grow"."feature_flags"
    ADD CONSTRAINT "feature_flags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "grow"."lead_events"
    ADD CONSTRAINT "lead_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "grow"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "grow"."subscriptions"
    ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "kitchen"."station_assignments"
    ADD CONSTRAINT "station_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "kitchen"."station_assignments"
    ADD CONSTRAINT "station_assignments_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "kitchen"."station_groups"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "kitchen"."station_assignments"
    ADD CONSTRAINT "station_assignments_tenant_id_station_id_fkey" FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen"."stations"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "kitchen"."station_groups"
    ADD CONSTRAINT "station_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "kitchen"."station_groups"
    ADD CONSTRAINT "station_groups_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "kitchen"."stations"
    ADD CONSTRAINT "stations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "kitchen"."stations"
    ADD CONSTRAINT "stations_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "loyalty"."accounts"
    ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."accounts"
    ADD CONSTRAINT "accounts_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "core"."people"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."accounts"
    ADD CONSTRAINT "accounts_tenant_id_program_id_fkey" FOREIGN KEY ("tenant_id", "program_id") REFERENCES "loyalty"."programs"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."automation_rules"
    ADD CONSTRAINT "automation_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."automation_rules"
    ADD CONSTRAINT "automation_rules_tenant_id_program_id_fkey" FOREIGN KEY ("tenant_id", "program_id") REFERENCES "loyalty"."programs"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "loyalty"."balances"
    ADD CONSTRAINT "balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."balances"
    ADD CONSTRAINT "balances_tenant_id_loyalty_card_id_fkey" FOREIGN KEY ("tenant_id", "loyalty_card_id") REFERENCES "loyalty"."cards"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."birthday_rewards"
    ADD CONSTRAINT "birthday_rewards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."birthday_rewards"
    ADD CONSTRAINT "birthday_rewards_tenant_id_loyalty_card_id_fkey" FOREIGN KEY ("tenant_id", "loyalty_card_id") REFERENCES "loyalty"."cards"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."cards"
    ADD CONSTRAINT "cards_tenant_id_account_id_fkey" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "loyalty"."accounts"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."cards"
    ADD CONSTRAINT "cards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."gift_card_ledger"
    ADD CONSTRAINT "gift_card_ledger_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."gift_card_ledger"
    ADD CONSTRAINT "gift_card_ledger_tenant_id_gift_card_id_fkey" FOREIGN KEY ("tenant_id", "gift_card_id") REFERENCES "loyalty"."gift_cards"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."gift_cards"
    ADD CONSTRAINT "gift_cards_tenant_id_created_by_staff_member_id_fkey" FOREIGN KEY ("tenant_id", "created_by_staff_member_id") REFERENCES "core"."staff_members"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "loyalty"."gift_cards"
    ADD CONSTRAINT "gift_cards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."gift_cards"
    ADD CONSTRAINT "gift_cards_tenant_id_redeemed_loyalty_card_id_fkey" FOREIGN KEY ("tenant_id", "redeemed_loyalty_card_id") REFERENCES "loyalty"."cards"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "loyalty"."lifecycle_sends"
    ADD CONSTRAINT "lifecycle_sends_tenant_id_card_id_fkey" FOREIGN KEY ("tenant_id", "card_id") REFERENCES "loyalty"."cards"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."lifecycle_sends"
    ADD CONSTRAINT "lifecycle_sends_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."otp_verifications"
    ADD CONSTRAINT "otp_verifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."otp_verifications"
    ADD CONSTRAINT "otp_verifications_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "core"."people"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "loyalty"."pass_devices"
    ADD CONSTRAINT "pass_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."pass_devices"
    ADD CONSTRAINT "pass_devices_tenant_id_pass_id_fkey" FOREIGN KEY ("tenant_id", "pass_id") REFERENCES "loyalty"."passes"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."passes"
    ADD CONSTRAINT "passes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."passes"
    ADD CONSTRAINT "passes_tenant_id_loyalty_card_id_fkey" FOREIGN KEY ("tenant_id", "loyalty_card_id") REFERENCES "loyalty"."cards"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."points_ledger"
    ADD CONSTRAINT "points_ledger_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."points_ledger"
    ADD CONSTRAINT "points_ledger_tenant_id_loyalty_card_id_fkey" FOREIGN KEY ("tenant_id", "loyalty_card_id") REFERENCES "loyalty"."cards"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."programs"
    ADD CONSTRAINT "programs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."reward_configs"
    ADD CONSTRAINT "reward_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."reward_configs"
    ADD CONSTRAINT "reward_configs_tenant_id_program_id_fkey" FOREIGN KEY ("tenant_id", "program_id") REFERENCES "loyalty"."programs"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "loyalty"."reward_redemptions"
    ADD CONSTRAINT "reward_redemptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."reward_redemptions"
    ADD CONSTRAINT "reward_redemptions_tenant_id_loyalty_card_id_fkey" FOREIGN KEY ("tenant_id", "loyalty_card_id") REFERENCES "loyalty"."cards"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."reward_redemptions"
    ADD CONSTRAINT "reward_redemptions_tenant_id_reward_config_id_fkey" FOREIGN KEY ("tenant_id", "reward_config_id") REFERENCES "loyalty"."reward_configs"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."reward_redemptions"
    ADD CONSTRAINT "reward_redemptions_tenant_id_staff_member_id_fkey" FOREIGN KEY ("tenant_id", "staff_member_id") REFERENCES "core"."staff_members"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "loyalty"."visit_events"
    ADD CONSTRAINT "visit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."visit_events"
    ADD CONSTRAINT "visit_events_tenant_id_loyalty_card_id_fkey" FOREIGN KEY ("tenant_id", "loyalty_card_id") REFERENCES "loyalty"."cards"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."visit_events"
    ADD CONSTRAINT "visit_events_tenant_id_staff_member_id_fkey" FOREIGN KEY ("tenant_id", "staff_member_id") REFERENCES "core"."staff_members"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "loyalty"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_tenant_id_loyalty_card_id_fkey" FOREIGN KEY ("tenant_id", "loyalty_card_id") REFERENCES "loyalty"."cards"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "loyalty"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_tenant_id_staff_member_id_fkey" FOREIGN KEY ("tenant_id", "staff_member_id") REFERENCES "core"."staff_members"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "ops"."business_hours"
    ADD CONSTRAINT "business_hours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."business_hours"
    ADD CONSTRAINT "business_hours_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."businesses"
    ADD CONSTRAINT "businesses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."channel_accounts"
    ADD CONSTRAINT "channel_accounts_tenant_id_channel_id_fkey" FOREIGN KEY ("tenant_id", "channel_id") REFERENCES "ops"."channels"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."channel_accounts"
    ADD CONSTRAINT "channel_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."channel_accounts"
    ADD CONSTRAINT "channel_accounts_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "ops"."channels"
    ADD CONSTRAINT "channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."order_events"
    ADD CONSTRAINT "order_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."order_events"
    ADD CONSTRAINT "order_events_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "ops"."orders"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."order_items"
    ADD CONSTRAINT "order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."order_items"
    ADD CONSTRAINT "order_items_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "ops"."orders"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."order_items"
    ADD CONSTRAINT "order_items_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "ops"."products"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "ops"."orders"
    ADD CONSTRAINT "orders_tenant_id_channel_id_fkey" FOREIGN KEY ("tenant_id", "channel_id") REFERENCES "ops"."channels"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "ops"."orders"
    ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."orders"
    ADD CONSTRAINT "orders_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "ops"."orders"
    ADD CONSTRAINT "orders_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "core"."people"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "ops"."payments"
    ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."payments"
    ADD CONSTRAINT "payments_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "ops"."orders"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "ops"."product_categories"
    ADD CONSTRAINT "product_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "ops"."products"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."product_modifiers"
    ADD CONSTRAINT "product_modifiers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."product_modifiers"
    ADD CONSTRAINT "product_modifiers_tenant_id_modifier_group_id_fkey" FOREIGN KEY ("tenant_id", "modifier_group_id") REFERENCES "ops"."product_modifier_groups"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."products"
    ADD CONSTRAINT "products_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "ops"."product_categories"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "ops"."products"
    ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."refunds"
    ADD CONSTRAINT "refunds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."refunds"
    ADD CONSTRAINT "refunds_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "ops"."orders"("tenant_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "ops"."refunds"
    ADD CONSTRAINT "refunds_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "ops"."payments"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."service_windows"
    ADD CONSTRAINT "service_windows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ops"."service_windows"
    ADD CONSTRAINT "service_windows_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "core"."locations"("tenant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "queue"."dead_letters"
    ADD CONSTRAINT "dead_letters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "queue"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "queue"."inbound_events"
    ADD CONSTRAINT "inbound_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "queue"."job_attempts"
    ADD CONSTRAINT "job_attempts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "queue"."jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "queue"."job_attempts"
    ADD CONSTRAINT "job_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "queue"."jobs"
    ADD CONSTRAINT "jobs_inbound_event_id_fkey" FOREIGN KEY ("inbound_event_id") REFERENCES "queue"."inbound_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "queue"."jobs"
    ADD CONSTRAINT "jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "queue"."outbox_events"
    ADD CONSTRAINT "outbox_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "queue"."jobs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "queue"."outbox_events"
    ADD CONSTRAINT "outbox_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE "comms"."conversation_turns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "comms"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "comms"."customer_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "comms"."daily_summaries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "comms"."knowledge_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "comms"."knowledge_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "comms"."memory_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "comms"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_isolation" ON "comms"."conversation_turns" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "comms"."conversations" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "comms"."customer_preferences" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "comms"."daily_summaries" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "comms"."knowledge_chunks" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "comms"."knowledge_documents" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "comms"."memory_items" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "comms"."messages" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "comms"."tool_calls" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



ALTER TABLE "comms"."tool_calls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."contact_merge_candidates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."contact_methods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."external_refs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "global_catalog_read" ON "core"."membership_roles" USING (true) WITH CHECK (false);



CREATE POLICY "global_catalog_read" ON "core"."permissions" USING (true) WITH CHECK (false);



CREATE POLICY "global_catalog_read" ON "core"."role_permissions" USING (true) WITH CHECK (false);



ALTER TABLE "core"."integration_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."membership_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."password_reset_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."people" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."product_instances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "self_access" ON "core"."password_reset_tokens" USING (("user_id" = "core"."current_user_id"())) WITH CHECK (("user_id" = "core"."current_user_id"()));



CREATE POLICY "self_access" ON "core"."sessions" USING (((("person_id" IS NOT NULL) AND ("person_id" = "core"."current_person_id"())) OR (("user_id" IS NOT NULL) AND ("user_id" = "core"."current_user_id"())))) WITH CHECK (((("person_id" IS NOT NULL) AND ("person_id" = "core"."current_person_id"())) OR (("user_id" IS NOT NULL) AND ("user_id" = "core"."current_user_id"()))));



CREATE POLICY "self_access" ON "core"."users" USING (("id" = "core"."current_user_id"())) WITH CHECK (("id" = "core"."current_user_id"()));



ALTER TABLE "core"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."staff_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_isolation" ON "core"."contact_merge_candidates" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "core"."contact_methods" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "core"."external_refs" USING (("core"."rls_tenant_check"("tenant_id") OR ("tenant_id" IS NULL))) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "core"."integration_tokens" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "core"."locations" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "core"."people" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "core"."product_instances" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "core"."roles" USING (("core"."rls_tenant_check"("tenant_id") OR ("tenant_id" IS NULL))) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "core"."staff_members" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "core"."tenant_memberships" USING ((("user_id" = "core"."current_user_id"()) OR "core"."rls_tenant_check"("tenant_id"))) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "core"."tenants" USING ((("id" = "core"."current_tenant_id"()) AND "core"."can_access_tenant"("id"))) WITH CHECK ((("id" = "core"."current_tenant_id"()) AND "core"."can_access_tenant"("id")));



ALTER TABLE "core"."tenant_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."tenants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "device"."devices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "device"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "device"."pairing_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "device"."sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_isolation" ON "device"."devices" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "device"."events" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "device"."pairing_requests" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "device"."sessions" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



ALTER TABLE "kitchen"."station_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "kitchen"."station_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "kitchen"."stations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_isolation" ON "kitchen"."station_assignments" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "kitchen"."station_groups" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "kitchen"."stations" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



ALTER TABLE "loyalty"."accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."automation_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."balances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."birthday_rewards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."gift_card_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."gift_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."lifecycle_sends" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."otp_verifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."pass_devices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."passes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."points_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."programs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."reward_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."reward_redemptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_isolation" ON "loyalty"."accounts" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."automation_rules" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."balances" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."birthday_rewards" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."cards" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."gift_card_ledger" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."gift_cards" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."lifecycle_sends" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."otp_verifications" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."pass_devices" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."passes" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."points_ledger" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."programs" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."reward_configs" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."reward_redemptions" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."visit_events" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "loyalty"."wallet_transactions" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



ALTER TABLE "loyalty"."visit_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "loyalty"."wallet_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."business_hours" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."businesses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."channel_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."channels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."order_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."product_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."product_modifier_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."product_modifiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."refunds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."service_windows" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_isolation" ON "ops"."business_hours" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."businesses" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."channel_accounts" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."channels" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."order_events" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."order_items" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."orders" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."payments" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."product_categories" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."product_modifier_groups" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."product_modifiers" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."products" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."refunds" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));



CREATE POLICY "tenant_isolation" ON "ops"."service_windows" USING ("core"."rls_tenant_check"("tenant_id")) WITH CHECK ("core"."rls_tenant_check"("tenant_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "comms" TO "umi_worker";
GRANT USAGE ON SCHEMA "comms" TO "umi_app";
GRANT USAGE ON SCHEMA "comms" TO "umi_readonly";



GRANT USAGE ON SCHEMA "core" TO "umi_worker";
GRANT USAGE ON SCHEMA "core" TO "umi_app";
GRANT USAGE ON SCHEMA "core" TO "umi_readonly";






GRANT USAGE ON SCHEMA "loyalty" TO "umi_worker";
GRANT USAGE ON SCHEMA "loyalty" TO "umi_app";
GRANT USAGE ON SCHEMA "loyalty" TO "umi_readonly";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






GRANT USAGE ON SCHEMA "observability" TO "umi_worker";
GRANT USAGE ON SCHEMA "observability" TO "umi_app";
GRANT USAGE ON SCHEMA "observability" TO "umi_readonly";



GRANT USAGE ON SCHEMA "ops" TO "umi_worker";
GRANT USAGE ON SCHEMA "ops" TO "umi_app";
GRANT USAGE ON SCHEMA "ops" TO "umi_readonly";



GRANT USAGE ON SCHEMA "queue" TO "umi_worker";



























































































































GRANT ALL ON FUNCTION "core"."block_append_only_mutation"() TO "umi_app";
GRANT ALL ON FUNCTION "core"."block_append_only_mutation"() TO "umi_worker";
GRANT ALL ON FUNCTION "core"."block_append_only_mutation"() TO "umi_readonly";



GRANT ALL ON FUNCTION "core"."can_access_tenant"("target_tenant_id" "uuid") TO "umi_app";
GRANT ALL ON FUNCTION "core"."can_access_tenant"("target_tenant_id" "uuid") TO "umi_worker";
GRANT ALL ON FUNCTION "core"."can_access_tenant"("target_tenant_id" "uuid") TO "umi_readonly";



GRANT ALL ON FUNCTION "core"."current_person_id"() TO "umi_app";
GRANT ALL ON FUNCTION "core"."current_person_id"() TO "umi_worker";
GRANT ALL ON FUNCTION "core"."current_person_id"() TO "umi_readonly";



GRANT ALL ON FUNCTION "core"."current_tenant_id"() TO "umi_app";
GRANT ALL ON FUNCTION "core"."current_tenant_id"() TO "umi_worker";
GRANT ALL ON FUNCTION "core"."current_tenant_id"() TO "umi_readonly";



GRANT ALL ON FUNCTION "core"."current_user_id"() TO "umi_app";
GRANT ALL ON FUNCTION "core"."current_user_id"() TO "umi_worker";
GRANT ALL ON FUNCTION "core"."current_user_id"() TO "umi_readonly";



GRANT ALL ON FUNCTION "core"."normalize_phone"("p_phone" "text") TO "umi_app";
GRANT ALL ON FUNCTION "core"."normalize_phone"("p_phone" "text") TO "umi_worker";
GRANT ALL ON FUNCTION "core"."normalize_phone"("p_phone" "text") TO "umi_readonly";



GRANT ALL ON FUNCTION "core"."resolve_contact"("p_tenant_id" "uuid", "p_kind" "text", "p_raw_value" "text", "p_display_name" "text", "p_source_system" "text", "p_external_id" "text") TO "umi_app";
GRANT ALL ON FUNCTION "core"."resolve_contact"("p_tenant_id" "uuid", "p_kind" "text", "p_raw_value" "text", "p_display_name" "text", "p_source_system" "text", "p_external_id" "text") TO "umi_worker";
GRANT ALL ON FUNCTION "core"."resolve_contact"("p_tenant_id" "uuid", "p_kind" "text", "p_raw_value" "text", "p_display_name" "text", "p_source_system" "text", "p_external_id" "text") TO "umi_readonly";



GRANT ALL ON FUNCTION "core"."rls_tenant_check"("row_tenant_id" "uuid") TO "umi_app";
GRANT ALL ON FUNCTION "core"."rls_tenant_check"("row_tenant_id" "uuid") TO "umi_worker";
GRANT ALL ON FUNCTION "core"."rls_tenant_check"("row_tenant_id" "uuid") TO "umi_readonly";


















































































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "ops"."block_order_event_mutation"() TO "umi_app";
GRANT ALL ON FUNCTION "ops"."block_order_event_mutation"() TO "umi_worker";
GRANT ALL ON FUNCTION "ops"."block_order_event_mutation"() TO "umi_readonly";



GRANT ALL ON FUNCTION "public"."calculate_loyalty_points"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_loyalty_points"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_loyalty_points"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_tier_upgrade"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_tier_upgrade"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_tier_upgrade"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("p_business_id" "uuid", "p_customer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("p_business_id" "uuid", "p_customer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("p_business_id" "uuid", "p_customer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_or_create_customer"("p_phone" "text", "p_business_id" "uuid", "p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_create_customer"("p_phone" "text", "p_business_id" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_customer"("p_phone" "text", "p_business_id" "uuid", "p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_customer_metrics"() TO "anon";
GRANT ALL ON FUNCTION "public"."increment_customer_metrics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_customer_metrics"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_wallet_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_wallet_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_wallet_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."products_invalidate_embedding"() TO "anon";
GRANT ALL ON FUNCTION "public"."products_invalidate_embedding"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."products_invalidate_embedding"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reclaim_stale_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."reclaim_stale_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reclaim_stale_jobs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reclaim_stale_outbox"() TO "anon";
GRANT ALL ON FUNCTION "public"."reclaim_stale_outbox"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reclaim_stale_outbox"() TO "service_role";






GRANT ALL ON FUNCTION "public"."search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_products_text"("p_business_id" "uuid", "p_query" "text", "p_limit" integer) TO "service_role";






GRANT ALL ON FUNCTION "public"."update_customer_prefs"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_prefs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_prefs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_segment"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_segment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_segment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_has_business_access"("target_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_has_business_access"("target_business_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_business_access"("target_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_business_access"("target_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_has_business_access_text"("target_business_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_has_business_access_text"("target_business_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_business_access_text"("target_business_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_business_access_text"("target_business_id" "text") TO "service_role";
























GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."conversation_turns" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."conversation_turns" TO "umi_worker";
GRANT SELECT ON TABLE "comms"."conversation_turns" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."conversations" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."conversations" TO "umi_worker";
GRANT SELECT ON TABLE "comms"."conversations" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."customer_preferences" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."customer_preferences" TO "umi_worker";
GRANT SELECT ON TABLE "comms"."customer_preferences" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."daily_summaries" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."daily_summaries" TO "umi_worker";
GRANT SELECT ON TABLE "comms"."daily_summaries" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."knowledge_chunks" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."knowledge_chunks" TO "umi_worker";
GRANT SELECT ON TABLE "comms"."knowledge_chunks" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."knowledge_documents" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."knowledge_documents" TO "umi_worker";
GRANT SELECT ON TABLE "comms"."knowledge_documents" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."memory_items" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."memory_items" TO "umi_worker";
GRANT SELECT ON TABLE "comms"."memory_items" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."messages" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."messages" TO "umi_worker";
GRANT SELECT ON TABLE "comms"."messages" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."tool_calls" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "comms"."tool_calls" TO "umi_worker";
GRANT SELECT ON TABLE "comms"."tool_calls" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."contact_merge_candidates" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."contact_merge_candidates" TO "umi_worker";
GRANT SELECT ON TABLE "core"."contact_merge_candidates" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."contact_methods" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."contact_methods" TO "umi_worker";
GRANT SELECT ON TABLE "core"."contact_methods" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."external_refs" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."external_refs" TO "umi_worker";
GRANT SELECT ON TABLE "core"."external_refs" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."integration_tokens" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."integration_tokens" TO "umi_worker";
GRANT SELECT ON TABLE "core"."integration_tokens" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."locations" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."locations" TO "umi_worker";
GRANT SELECT ON TABLE "core"."locations" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."membership_roles" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."membership_roles" TO "umi_worker";
GRANT SELECT ON TABLE "core"."membership_roles" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."password_reset_tokens" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."password_reset_tokens" TO "umi_worker";
GRANT SELECT ON TABLE "core"."password_reset_tokens" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."people" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."people" TO "umi_worker";
GRANT SELECT ON TABLE "core"."people" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."permissions" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."permissions" TO "umi_worker";
GRANT SELECT ON TABLE "core"."permissions" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."product_instances" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."product_instances" TO "umi_worker";
GRANT SELECT ON TABLE "core"."product_instances" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."role_permissions" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."role_permissions" TO "umi_worker";
GRANT SELECT ON TABLE "core"."role_permissions" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."roles" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."roles" TO "umi_worker";
GRANT SELECT ON TABLE "core"."roles" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."sessions" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."sessions" TO "umi_worker";
GRANT SELECT ON TABLE "core"."sessions" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."staff_members" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."staff_members" TO "umi_worker";
GRANT SELECT ON TABLE "core"."staff_members" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."tenant_memberships" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."tenant_memberships" TO "umi_worker";
GRANT SELECT ON TABLE "core"."tenant_memberships" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."tenants" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."tenants" TO "umi_worker";
GRANT SELECT ON TABLE "core"."tenants" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."users" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."users" TO "umi_worker";
GRANT SELECT ON TABLE "core"."users" TO "umi_readonly";















GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."accounts" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."accounts" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."accounts" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."automation_rules" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."automation_rules" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."automation_rules" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."balances" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."balances" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."balances" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."birthday_rewards" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."birthday_rewards" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."birthday_rewards" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."cards" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."cards" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."cards" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."gift_card_ledger" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."gift_card_ledger" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."gift_card_ledger" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."gift_cards" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."gift_cards" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."gift_cards" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."lifecycle_sends" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."lifecycle_sends" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."lifecycle_sends" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."otp_verifications" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."otp_verifications" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."otp_verifications" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."pass_devices" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."pass_devices" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."pass_devices" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."passes" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."passes" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."passes" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."points_ledger" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."points_ledger" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."points_ledger" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."programs" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."programs" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."programs" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."reward_configs" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."reward_configs" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."reward_configs" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."reward_redemptions" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."reward_redemptions" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."reward_redemptions" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."visit_events" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."visit_events" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."visit_events" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."wallet_transactions" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "loyalty"."wallet_transactions" TO "umi_worker";
GRANT SELECT ON TABLE "loyalty"."wallet_transactions" TO "umi_readonly";



GRANT SELECT ON TABLE "observability"."ai_runs" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "observability"."ai_runs" TO "umi_worker";
GRANT SELECT ON TABLE "observability"."ai_runs" TO "umi_readonly";



GRANT SELECT ON TABLE "observability"."audit_log" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "observability"."audit_log" TO "umi_worker";
GRANT SELECT ON TABLE "observability"."audit_log" TO "umi_readonly";



GRANT SELECT ON TABLE "observability"."conversation_outcomes" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "observability"."conversation_outcomes" TO "umi_worker";
GRANT SELECT ON TABLE "observability"."conversation_outcomes" TO "umi_readonly";



GRANT SELECT ON TABLE "observability"."data_quality_findings" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "observability"."data_quality_findings" TO "umi_worker";
GRANT SELECT ON TABLE "observability"."data_quality_findings" TO "umi_readonly";



GRANT SELECT ON TABLE "observability"."edge_logs" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "observability"."edge_logs" TO "umi_worker";
GRANT SELECT ON TABLE "observability"."edge_logs" TO "umi_readonly";



GRANT SELECT ON TABLE "observability"."evaluation_traces" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "observability"."evaluation_traces" TO "umi_worker";
GRANT SELECT ON TABLE "observability"."evaluation_traces" TO "umi_readonly";



GRANT SELECT ON TABLE "observability"."pipeline_spans" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "observability"."pipeline_spans" TO "umi_worker";
GRANT SELECT ON TABLE "observability"."pipeline_spans" TO "umi_readonly";



GRANT SELECT ON TABLE "observability"."security_events" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "observability"."security_events" TO "umi_worker";
GRANT SELECT ON TABLE "observability"."security_events" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."business_hours" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."business_hours" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."business_hours" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."businesses" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."businesses" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."businesses" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."channel_accounts" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."channel_accounts" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."channel_accounts" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."channels" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."channels" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."channels" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."order_events" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."order_events" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."order_events" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."order_items" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."order_items" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."order_items" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."orders" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."orders" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."orders" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."payments" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."payments" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."payments" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."product_categories" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."product_categories" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."product_categories" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."product_modifier_groups" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."product_modifier_groups" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."product_modifier_groups" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."product_modifiers" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."product_modifiers" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."product_modifiers" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."products" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."products" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."products" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."refunds" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."refunds" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."refunds" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."service_windows" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."service_windows" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."service_windows" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."v_kds_tickets" TO "umi_app";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ops"."v_kds_tickets" TO "umi_worker";
GRANT SELECT ON TABLE "ops"."v_kds_tickets" TO "umi_readonly";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "queue"."dead_letters" TO "umi_worker";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "queue"."idempotency_keys" TO "umi_worker";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "queue"."inbound_events" TO "umi_worker";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "queue"."job_attempts" TO "umi_worker";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "queue"."jobs" TO "umi_worker";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "queue"."outbox_events" TO "umi_worker";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "comms" GRANT SELECT,USAGE ON SEQUENCES TO "umi_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "comms" GRANT SELECT,USAGE ON SEQUENCES TO "umi_worker";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "comms" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "umi_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "comms" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "umi_worker";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "core" GRANT SELECT,USAGE ON SEQUENCES TO "umi_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "core" GRANT SELECT,USAGE ON SEQUENCES TO "umi_worker";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "core" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "umi_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "core" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "umi_worker";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "loyalty" GRANT SELECT,USAGE ON SEQUENCES TO "umi_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "loyalty" GRANT SELECT,USAGE ON SEQUENCES TO "umi_worker";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "loyalty" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "umi_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "loyalty" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "umi_worker";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "observability" GRANT SELECT,USAGE ON SEQUENCES TO "umi_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "observability" GRANT SELECT,USAGE ON SEQUENCES TO "umi_worker";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "observability" GRANT SELECT ON TABLES TO "umi_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "observability" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "umi_worker";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "ops" GRANT SELECT,USAGE ON SEQUENCES TO "umi_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "ops" GRANT SELECT,USAGE ON SEQUENCES TO "umi_worker";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "ops" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "umi_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "ops" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "umi_worker";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "queue" GRANT SELECT,USAGE ON SEQUENCES TO "umi_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "queue" GRANT SELECT,USAGE ON SEQUENCES TO "umi_worker";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "queue" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "umi_worker";




























