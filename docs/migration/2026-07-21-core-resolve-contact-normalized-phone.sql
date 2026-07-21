-- ============================================================================
-- core.resolve_contact — write the normalized contact onto core.people.
--
-- THE BUG. `core.people.normalized_phone` had no writer in the database. The RPC
-- computed the normalized value, wrote it to `core.contact_methods.normalized_value`,
-- and dropped it: the person insert named only (id, tenant_id, display_name). No
-- trigger closed the gap either — the live schema has zero triggers. So the column
-- was populated exactly once, by the June migration backfill
-- (docs/migration/build/30_backfill_identity.sql), and every person created at
-- runtime since has been NULL. Measured 2026-07-21: 169 of 572 people, all of which
-- DO have a phone in contact_methods (124 KLC, 45 EGR).
--
-- WHY IT MATTERS. Five readers depend on the column, so a NULL is a silent wrong
-- answer, never an error:
--   * apps/umi-cash/src/lib/identity.ts:52       — findPersonByPhone; the register
--                                                  409 fast-path misses, and the
--                                                  customer re-registers
--   * .../admin/customers/route.ts:32            — admin phone search finds nobody
--   * .../admin/customers/[id]/route.ts, messages, export — blank phone
--   * apps/umi-api/.../conversations/identity.repository.ts — reads it as "the
--     canonical E.164 anchor"; turn.service.ts:136 then bails on `!person?.phone`,
--     so a WhatsApp-first customer cannot be answered at all.
--
-- WHY IN THE RPC AND NOT THE APPS. Three call sites reach this function:
-- umi-cash register (customers/route.ts), umi-api cash register
-- (cash-register.repository.ts), and WhatsApp ingress (whatsapp.controller.ts).
-- Only the first was fixed, app-side, in 38ff3ef. Fixing the other two the same way
-- would mean three copies of one invariant. The function is the single door every
-- caller already goes through, so the invariant belongs here — and every future
-- caller gets it without being told.
--
-- Apply to the platform DB (Supabase xbudknbimkgjjgohnjgp). Idempotent — safe to
-- re-run. Run via: supabase db query --linked -f <this file>  (or psql).
--
-- CREATE OR REPLACE, never DROP + CREATE: replacing preserves the ACL. The
-- signature below is byte-identical to the live one, so this replaces the function
-- rather than creating an overload.
--
-- This file is also the function's canonical source. It had none — resolve_contact
-- existed only in the running database and in db/preview/002_schema.sql (a dump of
-- it). The body below is the live text plus one marked change.
-- ============================================================================

CREATE OR REPLACE FUNCTION core.resolve_contact(
  p_tenant_id     uuid,
  p_kind          text,
  p_raw_value     text,
  p_display_name  text DEFAULT NULL::text,
  p_source_system text DEFAULT NULL::text,
  p_external_id   text DEFAULT NULL::text
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'core', 'pg_temp'
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

    -- Deliberately unchanged — the normalized value is NOT set here.
    --
    -- Setting it inline looks natural and is wrong. On a concurrent resolve of the
    -- same new contact, both callers reach this insert and create a person, but only
    -- one wins the contact_methods unique index; the loser's person row survives as
    -- an orphan with no contact_method. Today that orphan is harmless precisely
    -- because its normalized_phone is NULL, which keeps it invisible to
    -- findPersonByPhone (apps/umi-cash/src/lib/identity.ts:52 — a findFirst with no
    -- orderBy, so it would be free to return the orphan over the real customer).
    -- Giving the orphan a phone here would make a rare race newly visible as a
    -- customer with no account and no card.
    --
    -- The heal below runs AFTER the re-read that resolves the race, so it fills the
    -- winner and leaves the orphan NULL — same outcome, no new failure mode.
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

  -- THE CHANGE: heal a person whose cache is empty.
  -- This is the only edit to the function body. It covers every path at once — the
  -- person just created above, a person that already existed with the column NULL
  -- (the 169), and any writer that creates people outside this function. It runs
  -- after the race re-read, so v_person is always the row that owns the contact.
  --
  -- Only v_norm is ever stored, never v_key. The ladder key is a dedup handle
  -- ('last10:6671368634', 'src:umi-cash:<uuid>'), not a phone number, and it must
  -- not reach a column that five call sites read back as an E.164 phone.
  --
  -- Fill-only. The `is null` guard means an already-populated row matches nothing,
  -- so the common path costs one primary-key probe and takes no lock and no write.
  -- It also means this never overwrites, so 'phone' and 'whatsapp' resolving for the
  -- same customer cannot fight over the column (both normalize to the same +52 form
  -- anyway — core.normalize_phone strips WhatsApp's extra leading 1).
  --
  -- updated_at is deliberately NOT touched: this repairs a derived cache, it is not
  -- a profile edit, and the column is read as "when did this customer last change".
  if v_norm is not null and v_person is not null then
    if p_kind in ('phone','whatsapp') then
      update core.people
         set normalized_phone = v_norm
       where id = v_person
         and tenant_id = p_tenant_id
         and normalized_phone is null;
    else
      update core.people
         set normalized_email = v_norm
       where id = v_person
         and tenant_id = p_tenant_id
         and normalized_email is null;
    end if;
  end if;

  return v_person;
end;
$$;

-- Owner must stay postgres, and postgres must keep BYPASSRLS.
--
-- core.people is FORCE ROW LEVEL SECURITY, so the policy applies to the owner too;
-- SECURITY DEFINER alone is not enough. The policy calls core.rls_tenant_check,
-- which requires app.tenant_id to be set AND core.current_user_id() to hold an
-- active membership in that tenant — neither is true for the WhatsApp ingress,
-- which is unauthenticated and sets no GUC. Only BYPASSRLS gets past that.
--
-- Verified: on a local replica of this schema where postgres lacks BYPASSRLS, the
-- pre-existing person insert fails outright with "new row violates row-level
-- security policy for table people". So live postgres necessarily has it already —
-- people are being created there today. The new UPDATE additionally evaluates the
-- policy's USING clause, which BYPASSRLS also covers.
--
-- This is why the one-off backfill cannot run on the app roles: all three
-- (umi_app, umi_worker, umi_readonly) are NOBYPASSRLS in the live database — see
-- db/preview/001_roles.sql, dumped from live, contradicting apps/umi-api/db/README.md.
-- An UPDATE from those roles matches zero rows and raises no error.
ALTER FUNCTION core.resolve_contact(uuid, text, text, text, text, text) OWNER TO postgres;

-- ============================================================================
-- Verification. Run on the PREVIEW database (db/preview/README.md) — it is
-- schema-identical to live and holds synthetic data only. Substitute a tenant id
-- and uncomment.
--
-- Two traps this block exists to avoid. Do NOT check the result by filtering on
-- display_name: resolve_contact sets that column only on INSERT, so when the
-- number already belongs to someone it returns their row with their real name
-- untouched, and a display_name filter comes back empty on a function that
-- worked perfectly. And do NOT probe with a real customer's number — resolving
-- it mutates that customer's row, and a cleanup step aimed at the probe would
-- delete them. The number below is a throwaway, and the delete refuses to touch
-- anyone who has an account.
--
--   do $verify$
--   declare
--     v_tenant uuid := '<tenant_uuid>';
--     v_a uuid; v_b uuid; v_phone text; v_contacts int; v_deleted int;
--   begin
--     -- separate statements, so the second call genuinely sees the first's write
--     v_a := core.resolve_contact(v_tenant,'phone','5550000001','Preflight Check','preflight',null);
--     v_b := core.resolve_contact(v_tenant,'phone','555 000 0001','Preflight Check','preflight',null);
--
--     select normalized_phone into v_phone from core.people where id = v_a;
--     select count(*) into v_contacts from core.contact_methods
--      where tenant_id = v_tenant and normalized_value = '+525550000001';
--
--     assert v_a = v_b,                 'NOT IDEMPOTENT: one number resolved to two people';
--     assert v_phone = '+525550000001', 'normalized_phone not written, got: ' || coalesce(v_phone,'NULL');
--     assert v_contacts = 1,            'expected 1 contact_method, got ' || v_contacts;
--     raise notice 'PASS - person %, normalized_phone %', v_a, v_phone;
--
--     -- clean up only the throwaway: a real customer would have an account
--     delete from core.people p where p.id = v_a
--       and not exists (select 1 from loyalty.accounts a where a.person_id = p.id);
--     get diagnostics v_deleted = row_count;
--     assert v_deleted = 1, 'probe row not removed - it has an account, inspect before deleting';
--   end
--   $verify$;
--
-- To confirm the heal path against real data instead, pick a person who is still
-- NULL and resolve their own number, then re-read that same id:
--
--   select id from core.people where normalized_phone is null limit 1;
-- ============================================================================
