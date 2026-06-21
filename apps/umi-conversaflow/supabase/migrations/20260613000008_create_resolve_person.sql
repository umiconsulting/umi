-- Migration 20260613000008_create_resolve_person.sql
-- #4: Canonical phone normalizer (IMMUTABLE, usable in indexes)
-- #5: resolve_person() — atomic, lock-first, F-S 3-bucket identity resolution

-- ===========================================================================
-- 1. normalize_phone — canonical E.164 normalizer
-- ===========================================================================
CREATE OR REPLACE FUNCTION platform.normalize_phone(
  p_phone text,
  p_default_region text DEFAULT 'MX'
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  cleaned text;
  e164    text;
  last10  text;
  conf    text;
BEGIN
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN jsonb_build_object('e164', null, 'last10', null, 'confidence', 'unparseable');
  END IF;

  -- Strip whitespace and common separators, keep the leading +
  cleaned := regexp_replace(trim(p_phone), '[()\-\s\.]', '', 'g');

  -- Extract last 10 digits as blocking key
  last10 := substring(cleaned FROM '[0-9]{10}$');

  -- Already E.164: +<country><number>
  IF cleaned ~ '^\+[1-9][0-9]{6,14}$' THEN
    -- MX: strip mobile "1" prefix after +52
    IF cleaned ~ '^\+52[0-9]{11}$' AND substring(cleaned, 4, 1) = '1' THEN
      e164 := '+52' || substring(cleaned, 5);
    ELSE
      e164 := cleaned;
    END IF;
    conf := 'exact';
    RETURN jsonb_build_object('e164', e164, 'last10', last10, 'confidence', conf);
  END IF;

  -- 10-digit local number — infer region
  IF cleaned ~ '^[0-9]{10}$' THEN
    IF p_default_region = 'MX' THEN
      e164 := '+52' || cleaned;
    ELSIF p_default_region IN ('US', 'CA') THEN
      e164 := '+1' || cleaned;
    ELSE
      e164 := '+' || cleaned;
    END IF;
    conf := 'inferred_region';
    RETURN jsonb_build_object('e164', e164, 'last10', last10, 'confidence', conf);
  END IF;

  -- 11-digit MX mobile (52 + 1 + 10 digits, no +)
  IF cleaned ~ '^52[0-9]{11}$' AND substring(cleaned, 3, 1) = '1' THEN
    e164 := '+52' || substring(cleaned, 4);
    conf := 'exact';
    RETURN jsonb_build_object('e164', e164, 'last10', last10, 'confidence', conf);
  END IF;

  -- Fallback: have digits but can't normalize confidently
  IF last10 IS NOT NULL AND length(last10) = 10 THEN
    RETURN jsonb_build_object('e164', null, 'last10', last10, 'confidence', 'last10_candidate');
  END IF;

  RETURN jsonb_build_object('e164', null, 'last10', last10, 'confidence', 'unparseable');
END;
$$;

-- ===========================================================================
-- 2. resolve_person — F-S 3-bucket identity resolution
-- ===========================================================================
CREATE OR REPLACE FUNCTION platform.resolve_person(
  _tenant_id uuid,
  _identity  jsonb,
  _source    text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'platform'
AS $$
DECLARE
  v_phone         text;
  v_email         text;
  v_name          text;
  v_norm          jsonb;
  v_norm_phone    text;
  v_norm_email    text;
  v_last10        text;
  v_confidence    text;
  v_existing_id   uuid;
  v_new_id        uuid;
  v_lock_key      bigint;
BEGIN
  -- Extract identity fields
  v_phone := _identity->>'phone';
  v_email := lower(trim(_identity->>'email'));
  v_name  := _identity->>'name';

  -- Normalize phone
  IF v_phone IS NOT NULL THEN
    v_norm := platform.normalize_phone(v_phone);
    v_norm_phone := v_norm->>'e164';
    v_last10     := v_norm->>'last10';
    v_confidence := v_norm->>'confidence';
  END IF;

  -- Normalize email
  IF v_email IS NOT NULL THEN
    v_norm_email := lower(trim(v_email));
  END IF;

  -- =====================================================================
  -- BUCKET A: LINK — strong phone match (auto-resolve)
  -- =====================================================================
  IF v_norm_phone IS NOT NULL AND v_confidence IN ('exact', 'inferred_region') THEN
    -- Acquire advisory lock to prevent concurrent insert race
    v_lock_key := hashtext(_tenant_id::text || '|' || v_norm_phone);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- Look up by normalized phone in the same tenant
    SELECT p.id INTO v_existing_id
    FROM platform.people p
    WHERE p.tenant_id = _tenant_id
      AND p.normalized_phone = v_norm_phone
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- Enrich existing person with any new data
      UPDATE platform.people
      SET display_name = COALESCE(NULLIF(v_name, ''), display_name),
          normalized_email = COALESCE(v_norm_email, normalized_email),
          email = COALESCE(NULLIF(v_email, ''), email),
          source = CASE
            WHEN NOT (source @> ARRAY[_source]) THEN array_append(source, _source)
            ELSE source
          END,
          updated_at = now()
      WHERE id = v_existing_id;

      -- Upsert contact_identity for the phone
      INSERT INTO platform.contact_identities (person_id, tenant_id, identity_type, normalized_value, identity_value)
      VALUES (v_existing_id, _tenant_id, 'phone', v_norm_phone, v_phone)
      ON CONFLICT DO NOTHING;

      -- Upsert contact_identity for email if provided
      IF v_norm_email IS NOT NULL THEN
        INSERT INTO platform.contact_identities (person_id, tenant_id, identity_type, normalized_value, identity_value)
        VALUES (v_existing_id, _tenant_id, 'email', v_norm_email, v_email)
        ON CONFLICT DO NOTHING;
      END IF;

      RETURN v_existing_id;
    END IF;
  END IF;

  -- =====================================================================
  -- BUCKET B: POSSIBLE-LINK — email or last10 match (review queue)
  -- =====================================================================
  -- Email match in same tenant
  IF v_norm_email IS NOT NULL THEN
    SELECT p.id INTO v_existing_id
    FROM platform.people p
    JOIN platform.contact_identities ci
      ON ci.person_id = p.id
      AND ci.tenant_id = _tenant_id
      AND ci.identity_type = 'email'
      AND ci.normalized_value = v_norm_email
    WHERE p.tenant_id = _tenant_id
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- Insert new person (don't auto-merge by email)
      v_new_id := gen_random_uuid();
      INSERT INTO platform.people (id, tenant_id, display_name, phone, email,
        normalized_phone, normalized_email, normalization_confidence, source)
      VALUES (v_new_id, _tenant_id, v_name, v_phone, v_email,
        v_norm_phone, v_norm_email, v_confidence, ARRAY[_source]);

      -- Insert contact_identities
      INSERT INTO platform.contact_identities (person_id, tenant_id, identity_type, normalized_value, identity_value)
      VALUES (v_new_id, _tenant_id, 'phone', v_norm_phone, v_phone);

      IF v_norm_email IS NOT NULL THEN
        INSERT INTO platform.contact_identities (person_id, tenant_id, identity_type, normalized_value, identity_value)
        VALUES (v_new_id, _tenant_id, 'email', v_norm_email, v_email);
      END IF;

      -- Write merge candidate for review
      INSERT INTO platform.contact_merge_candidates (left_person_id, right_person_id, tenant_id, match_type, confidence, reason)
      VALUES (LEAST(v_existing_id, v_new_id), GREATEST(v_existing_id, v_new_id),
        _tenant_id, 'exact_normalized_email', 'candidate',
        format('Email match: %s', v_norm_email));

      RETURN v_new_id;
    END IF;
  END IF;

  -- last10 match (possible phone collision, different E.164)
  IF v_last10 IS NOT NULL AND v_confidence IN ('last10_candidate', 'inferred_region') THEN
    SELECT p.id INTO v_existing_id
    FROM platform.people p
    WHERE p.tenant_id = _tenant_id
      AND p.normalized_phone IS NOT NULL
      AND substring(p.normalized_phone FROM '[0-9]{10}$') = v_last10
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- Insert new person, write candidate
      v_new_id := gen_random_uuid();
      INSERT INTO platform.people (id, tenant_id, display_name, phone, email, source)
      VALUES (v_new_id, _tenant_id, v_name, v_phone, v_email, ARRAY[_source]);

      INSERT INTO platform.contact_merge_candidates (left_person_id, right_person_id, tenant_id, match_type, confidence, reason)
      VALUES (LEAST(v_existing_id, v_new_id), GREATEST(v_existing_id, v_new_id),
        _tenant_id, 'last10_phone', 'candidate',
        format('Last10 phone match: %s ↔ %s', v_last10, v_norm_phone));

      RETURN v_new_id;
    END IF;
  END IF;

  -- =====================================================================
  -- BUCKET C: NON-LINK — no match, clean insert
  -- =====================================================================
  v_new_id := gen_random_uuid();
  INSERT INTO platform.people (id, tenant_id, display_name, phone, email,
    normalized_phone, normalized_email, normalization_confidence, source)
  VALUES (v_new_id, _tenant_id, v_name, v_phone, v_email,
    v_norm_phone, v_norm_email, v_confidence, ARRAY[_source]);

  -- Insert contact_identities
  IF v_norm_phone IS NOT NULL THEN
    INSERT INTO platform.contact_identities (person_id, tenant_id, identity_type, normalized_value, identity_value)
    VALUES (v_new_id, _tenant_id, 'phone', v_norm_phone, v_phone);
  END IF;

  IF v_norm_email IS NOT NULL THEN
    INSERT INTO platform.contact_identities (person_id, tenant_id, identity_type, normalized_value, identity_value)
    VALUES (v_new_id, _tenant_id, 'email', v_norm_email, v_email);
  END IF;

  RETURN v_new_id;
END;
$$;

-- ===========================================================================
-- 3. Security hardening (#12)
-- ===========================================================================
-- Revoke direct execution from public, grant only to service_role
REVOKE EXECUTE ON FUNCTION platform.resolve_person(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.resolve_person(uuid, jsonb, text) TO service_role;

-- Revoke direct INSERT/UPDATE on platform.people from authenticated
-- Force all person creation through resolve_person
REVOKE INSERT, UPDATE, DELETE ON platform.people FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON platform.contact_identities FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON platform.contact_merge_candidates FROM authenticated;
