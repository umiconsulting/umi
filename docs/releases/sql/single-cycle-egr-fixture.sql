-- Synthetic EGR fixture for a dedicated local or staging database.
-- Apply 00_run.sh first. Apply the reviewed activation migration separately.
-- This file creates no login, contact, scan token, pass, or external consumer.
-- Reruns insert missing rows. They preserve card state and reward deadlines.
\set ON_ERROR_STOP on
BEGIN;
DO $fixture$
DECLARE
  target constant uuid := 'a13905a2-0319-4cc1-cacf-eee47b75e309';
  sample record;
  active_policy boolean;
BEGIN
  IF current_database() !~ '^umi_egr_pilot_fixture_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Use a dedicated database named umi_egr_pilot_fixture_<suffix>';
  END IF;
  IF to_regprocedure('merchant.activate_single_cycle_reward_policy(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Apply canonical 00_run.sh and the base reward migration first';
  END IF;
  IF EXISTS (SELECT 1 FROM merchant.merchant
    WHERE (id=target AND handle IS DISTINCT FROM 'elgranribera')
       OR (handle='elgranribera' AND id<>target)) THEN
    RAISE EXCEPTION 'EGR fixture identity mismatch';
  END IF;
  INSERT INTO merchant.merchant(id,name,handle,timezone)
    VALUES(target,'El Gran Ribera (synthetic fixture)','elgranribera','America/Mazatlan')
    ON CONFLICT(id) DO NOTHING;
  PERFORM 1 FROM merchant.merchant WHERE id=target FOR UPDATE;
  IF EXISTS (SELECT 1 FROM merchant.loyalty_reward_policy WHERE merchant_id=target
    AND NOT ((mode='single_cycle' AND expiry_days=30 AND started_at IS NOT NULL)
      OR (mode='accumulate' AND expiry_days IS NULL AND started_at IS NULL))) THEN
    RAISE EXCEPTION 'EGR fixture requires an absent, pending, or single_cycle 30-day policy';
  END IF;
  SELECT EXISTS(SELECT 1 FROM merchant.loyalty_reward_policy
    WHERE merchant_id=target AND started_at IS NOT NULL) INTO active_policy;

  FOR sample IN SELECT * FROM (VALUES
    ('e6f00000-0000-4000-8000-000000000001'::uuid,'standard',7,'Fixture reward: standard'),
    ('e6f00000-0000-4000-8000-000000000002'::uuid,'upgrade',9,'Fixture reward: upgrade')
  ) AS expected(id,kind,stamps,name) LOOP
    INSERT INTO merchant.loyalty_reward(id,merchant_id,name,type,kind,stamps_required)
      VALUES(sample.id,target,sample.name,'stamps_free_item',sample.kind,sample.stamps)
      ON CONFLICT(id) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM merchant.loyalty_reward WHERE id=sample.id AND merchant_id=target
      AND name=sample.name AND type='stamps_free_item' AND kind=sample.kind
      AND stamps_required=sample.stamps AND active) THEN
      RAISE EXCEPTION 'EGR fixture ladder mismatch for reward %',sample.id;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM merchant.loyalty_reward WHERE merchant_id=target
    AND active AND type='stamps_free_item' AND kind IN ('standard','upgrade')) <> 2 THEN
    RAISE EXCEPTION 'EGR fixture ladder requires exactly one standard and one upgrade reward';
  END IF;

  FOR sample IN SELECT * FROM (VALUES
    ('e6f00000-0000-4000-8000-000000000101'::uuid,'e6f00000-0000-4000-8000-000000000201'::uuid,'e6f00000-0000-4000-8000-000000000301'::uuid,'EMPTY',0,0,0),
    ('e6f00000-0000-4000-8000-000000000102'::uuid,'e6f00000-0000-4000-8000-000000000202'::uuid,'e6f00000-0000-4000-8000-000000000302'::uuid,'PROGRESS',4,0,0),
    ('e6f00000-0000-4000-8000-000000000103'::uuid,'e6f00000-0000-4000-8000-000000000203'::uuid,'e6f00000-0000-4000-8000-000000000303'::uuid,'READY',7,0,0),
    ('e6f00000-0000-4000-8000-000000000104'::uuid,'e6f00000-0000-4000-8000-000000000204'::uuid,'e6f00000-0000-4000-8000-000000000304'::uuid,'LEGACY',18,2,1)
  ) AS expected(customer_id,card_id,visit_id,label,stamps,earned,tier1) LOOP
    -- Missing pre-activation facts require a fresh database after activation.
    IF active_policy AND (
      NOT EXISTS(SELECT 1 FROM merchant.loyalty_card WHERE id=sample.card_id)
      OR (sample.stamps>0 AND NOT EXISTS(SELECT 1 FROM merchant.loyalty_visit WHERE id=sample.visit_id))) THEN
      RAISE EXCEPTION 'EGR fixture sample facts are missing after activation; use a fresh dedicated database';
    END IF;
    INSERT INTO merchant.customer(id,merchant_id,name)
      VALUES(sample.customer_id,target,'Synthetic EGR fixture: '||sample.label)
      ON CONFLICT(id) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM merchant.customer WHERE id=sample.customer_id AND merchant_id=target) THEN
      RAISE EXCEPTION 'EGR fixture customer identity mismatch';
    END IF;
    INSERT INTO merchant.loyalty_card(id,merchant_id,customer_id,card_number,rewards_earned,pending_tier1)
      VALUES(sample.card_id,target,sample.customer_id,'EGR-FIXTURE-'||sample.label,sample.earned,sample.tier1)
      ON CONFLICT(id) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM merchant.loyalty_card WHERE id=sample.card_id AND merchant_id=target
      AND customer_id=sample.customer_id AND card_number='EGR-FIXTURE-'||sample.label) THEN
      RAISE EXCEPTION 'EGR fixture card identity mismatch';
    END IF;
    IF sample.stamps>0 THEN
      INSERT INTO merchant.loyalty_visit(id,merchant_id,card_id,source,stamps,note,idempotency_key,occurred_at)
        VALUES(sample.visit_id,target,sample.card_id,'manual_bulk',sample.stamps,
          'Synthetic fixture credit','egr-fixture-'||lower(sample.label),'2026-10-01T12:00:00Z')
        ON CONFLICT(id) DO NOTHING;
      IF NOT EXISTS(SELECT 1 FROM merchant.loyalty_visit WHERE id=sample.visit_id AND merchant_id=target
        AND card_id=sample.card_id AND stamps=sample.stamps AND source='manual_bulk'
        AND idempotency_key='egr-fixture-'||lower(sample.label)) THEN
        RAISE EXCEPTION 'EGR fixture visit facts mismatch';
      END IF;
    END IF;
  END LOOP;
END
$fixture$;
COMMIT;
