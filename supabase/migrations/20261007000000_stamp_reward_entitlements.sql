BEGIN;

CREATE TABLE IF NOT EXISTS merchant.loyalty_reward_policy (
  merchant_id uuid PRIMARY KEY REFERENCES merchant.merchant(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'accumulate' CHECK (mode IN ('accumulate','single_cycle')),
  expiry_days integer CHECK (expiry_days BETWEEN 1 AND 365),
  started_at timestamptz,
  CHECK (mode <> 'single_cycle' OR (expiry_days IS NOT NULL AND started_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_reward_merchant_id_uq ON merchant.loyalty_reward(merchant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_redemption_merchant_id_uq ON merchant.loyalty_redemption(merchant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS business_command_merchant_id_uq ON merchant.business_command(merchant_id,id);

CREATE TABLE IF NOT EXISTS merchant.loyalty_reward_entitlement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchant.merchant(id) ON DELETE CASCADE,
  card_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('cycle','legacy')),
  recovery boolean NOT NULL DEFAULT false,
  recovery_tier text CHECK(recovery_tier IN ('base','top')),
  cycle_anchor integer,
  eligible_at timestamptz,
  activated_at timestamptz,
  expires_at timestamptz NOT NULL,
  tier text NOT NULL DEFAULT 'base' CHECK (tier IN ('base','top')),
  base_reward_id uuid,
  base_reward_name text NOT NULL,
  base_reward_description text,
  base_visits_required integer NOT NULL,
  top_reward_id uuid,
  top_reward_name text NOT NULL,
  top_reward_description text,
  top_visits_required integer NOT NULL,
  redeemed_at timestamptz,
  expired_at timestamptz,
  pass_refresh_requested_at timestamptz,
  pass_refreshed_at timestamptz,
  reminder_enqueued_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(merchant_id,id),
  FOREIGN KEY(merchant_id,card_id) REFERENCES merchant.loyalty_card(merchant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(merchant_id,base_reward_id) REFERENCES merchant.loyalty_reward(merchant_id,id),
  FOREIGN KEY(merchant_id,top_reward_id) REFERENCES merchant.loyalty_reward(merchant_id,id),
  CHECK (source <> 'cycle' OR (cycle_anchor IS NOT NULL AND (eligible_at IS NOT NULL OR activated_at IS NOT NULL))),
  CHECK (base_visits_required > 0 AND top_visits_required >= base_visits_required)
);
ALTER TABLE merchant.loyalty_reward_entitlement ADD COLUMN IF NOT EXISTS recovery_tier text CHECK(recovery_tier IN ('base','top'));
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_reward_one_open_cycle_uq
  ON merchant.loyalty_reward_entitlement(merchant_id,card_id)
  WHERE source='cycle' AND NOT recovery AND redeemed_at IS NULL AND expired_at IS NULL;
CREATE INDEX IF NOT EXISTS loyalty_reward_expiry_idx ON merchant.loyalty_reward_entitlement(expires_at)
  WHERE redeemed_at IS NULL AND expired_at IS NULL;
CREATE INDEX IF NOT EXISTS loyalty_reward_card_idx ON merchant.loyalty_reward_entitlement(merchant_id,card_id,expires_at);

CREATE TABLE IF NOT EXISTS merchant.loyalty_reward_redemption_link (
  merchant_id uuid NOT NULL REFERENCES merchant.merchant(id) ON DELETE CASCADE,
  redemption_id uuid NOT NULL,
  entitlement_id uuid NOT NULL,
  command_id uuid,
  external_receipt_number text,
  claimed_tier text CHECK(claimed_tier IN ('base','top')),
  stamps_consumed integer CHECK(stamps_consumed IN (0,7,9)),
  cycle_anchor_before integer CHECK(cycle_anchor_before>=0),
  cycle_anchor_after integer CHECK(cycle_anchor_after>=0),
  lifetime_total_at_claim integer CHECK(lifetime_total_at_claim>=0),
  restored_at timestamptz,
  PRIMARY KEY(merchant_id,redemption_id),
  FOREIGN KEY(merchant_id,redemption_id) REFERENCES merchant.loyalty_redemption(merchant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(merchant_id,entitlement_id) REFERENCES merchant.loyalty_reward_entitlement(merchant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(merchant_id,command_id) REFERENCES merchant.business_command(merchant_id,command_id)
);
ALTER TABLE merchant.loyalty_reward_redemption_link
  ADD COLUMN IF NOT EXISTS claimed_tier text CHECK(claimed_tier IN ('base','top')),
  ADD COLUMN IF NOT EXISTS stamps_consumed integer CHECK(stamps_consumed IN (0,7,9)),
  ADD COLUMN IF NOT EXISTS cycle_anchor_before integer CHECK(cycle_anchor_before>=0),
  ADD COLUMN IF NOT EXISTS cycle_anchor_after integer CHECK(cycle_anchor_after>=0),
  ADD COLUMN IF NOT EXISTS lifetime_total_at_claim integer CHECK(lifetime_total_at_claim>=0);
ALTER TABLE merchant.loyalty_reward_redemption_link DROP CONSTRAINT IF EXISTS loyalty_reward_claim_anchor_shape;
ALTER TABLE merchant.loyalty_reward_redemption_link ADD CONSTRAINT loyalty_reward_claim_anchor_shape CHECK(
  (cycle_anchor_before IS NULL)=(cycle_anchor_after IS NULL)
  AND (cycle_anchor_before IS NULL OR (stamps_consumed IN (7,9)
    AND cycle_anchor_after=cycle_anchor_before+stamps_consumed AND lifetime_total_at_claim>=cycle_anchor_after))
  AND (stamps_consumed IS NULL OR claimed_tier IS NOT NULL));
-- Old links preserve unknown visit consumption. Their unit records the selected tier.
DROP TRIGGER IF EXISTS reward_redemption_link_immutable ON merchant.loyalty_reward_redemption_link;
UPDATE merchant.loyalty_reward_redemption_link l SET claimed_tier=e.tier
  FROM merchant.loyalty_reward_entitlement e
  WHERE e.merchant_id=l.merchant_id AND e.id=l.entitlement_id AND l.claimed_tier IS NULL;
UPDATE merchant.loyalty_reward_entitlement e SET recovery_tier=(
  SELECT l.claimed_tier FROM merchant.loyalty_reward_redemption_link l
  WHERE l.merchant_id=e.merchant_id AND l.entitlement_id=e.id AND l.restored_at IS NOT NULL
  ORDER BY l.restored_at DESC,l.redemption_id LIMIT 1)
  WHERE e.recovery AND e.recovery_tier IS NULL;
ALTER TABLE merchant.loyalty_reward_redemption_link DROP CONSTRAINT IF EXISTS loyalty_reward_redemption_link_merchant_id_command_id_fkey;
ALTER TABLE merchant.loyalty_reward_redemption_link ADD CONSTRAINT loyalty_reward_redemption_link_merchant_id_command_id_fkey FOREIGN KEY(merchant_id,command_id) REFERENCES merchant.business_command(merchant_id,command_id);
ALTER TABLE merchant.loyalty_reward_entitlement DROP CONSTRAINT IF EXISTS loyalty_reward_entitlement_check;
ALTER TABLE merchant.loyalty_reward_entitlement ADD CONSTRAINT loyalty_reward_entitlement_check CHECK(source <> 'cycle' OR (cycle_anchor IS NOT NULL AND (eligible_at IS NOT NULL OR activated_at IS NOT NULL)));
CREATE TABLE IF NOT EXISTS merchant.loyalty_reward_activation_audit (
  merchant_id uuid NOT NULL REFERENCES merchant.merchant(id) ON DELETE CASCADE,
  card_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  previous_anchor integer NOT NULL,
  lifetime_total integer NOT NULL,
  absolute_anchor integer NOT NULL,
  imported_units integer NOT NULL,
  PRIMARY KEY(merchant_id,card_id),
  FOREIGN KEY(merchant_id,card_id) REFERENCES merchant.loyalty_card(merchant_id,id) ON DELETE CASCADE
);
CREATE OR REPLACE FUNCTION merchant.guard_reward_entitlement_facts() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,merchant AS $$
BEGIN
  IF ROW(NEW.merchant_id,NEW.card_id,NEW.source,NEW.cycle_anchor,NEW.eligible_at,NEW.activated_at,NEW.expires_at,
    NEW.base_reward_id,NEW.base_reward_name,NEW.base_reward_description,NEW.base_visits_required,
    NEW.top_reward_id,NEW.top_reward_name,NEW.top_reward_description,NEW.top_visits_required)
    IS DISTINCT FROM ROW(OLD.merchant_id,OLD.card_id,OLD.source,OLD.cycle_anchor,OLD.eligible_at,OLD.activated_at,OLD.expires_at,
    OLD.base_reward_id,OLD.base_reward_name,OLD.base_reward_description,OLD.base_visits_required,
    OLD.top_reward_id,OLD.top_reward_name,OLD.top_reward_description,OLD.top_visits_required) THEN
    RAISE EXCEPTION 'Reward eligibility, deadline and terms are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reward_entitlement_immutable ON merchant.loyalty_reward_entitlement;
CREATE TRIGGER reward_entitlement_immutable BEFORE UPDATE ON merchant.loyalty_reward_entitlement
  FOR EACH ROW EXECUTE FUNCTION merchant.guard_reward_entitlement_facts();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['loyalty_reward_policy','loyalty_reward_entitlement','loyalty_reward_redemption_link','loyalty_reward_activation_audit'] LOOP
    EXECUTE format('ALTER TABLE merchant.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE merchant.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS merchant_isolation ON merchant.%I',t);
    EXECUTE format('CREATE POLICY merchant_isolation ON merchant.%I USING(merchant_id=(SELECT umi.current_merchant())) WITH CHECK(merchant_id=(SELECT umi.current_merchant()))',t);
    EXECUTE format('REVOKE ALL ON merchant.%I FROM PUBLIC,api,worker',t);
    EXECUTE format('GRANT SELECT ON merchant.%I TO api',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON merchant.%I TO worker',t);
  END LOOP;
END $$;
GRANT INSERT,UPDATE ON merchant.loyalty_reward_entitlement,merchant.loyalty_reward_redemption_link TO api;

CREATE OR REPLACE FUNCTION merchant.guard_reward_redemption_link_facts() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,merchant AS $$
BEGIN
  IF ROW(NEW.merchant_id,NEW.redemption_id,NEW.entitlement_id,NEW.command_id,NEW.external_receipt_number,
    NEW.claimed_tier,NEW.stamps_consumed,NEW.cycle_anchor_before,NEW.cycle_anchor_after,NEW.lifetime_total_at_claim)
    IS DISTINCT FROM ROW(OLD.merchant_id,OLD.redemption_id,OLD.entitlement_id,OLD.command_id,OLD.external_receipt_number,
    OLD.claimed_tier,OLD.stamps_consumed,OLD.cycle_anchor_before,OLD.cycle_anchor_after,OLD.lifetime_total_at_claim) THEN
    RAISE EXCEPTION 'Selected reward and consumed visits are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reward_redemption_link_immutable BEFORE UPDATE ON merchant.loyalty_reward_redemption_link
  FOR EACH ROW EXECUTE FUNCTION merchant.guard_reward_redemption_link_facts();

-- Activation is explicit. The migration never enables a merchant.
CREATE OR REPLACE FUNCTION merchant.activate_single_cycle_reward_policy(p_merchant uuid,p_days integer DEFAULT 30)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,merchant AS $$
DECLARE ca record; rd record; std record; up record; ov record; started timestamptz; deadline timestamptz;
  total integer; pos integer; anchor integer; pending integer; threshold integer; unit uuid; i integer;
  base_id uuid; base_name text; base_desc text; top_id uuid; top_name text; top_desc text; base_n integer;
BEGIN
  IF p_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'Invalid expiry days'; END IF;
  PERFORM 1 FROM merchant.merchant WHERE id=p_merchant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Merchant does not exist'; END IF;
  SELECT started_at INTO started FROM merchant.loyalty_reward_policy WHERE merchant_id=p_merchant;
  IF started IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO std FROM merchant.loyalty_reward WHERE merchant_id=p_merchant AND active AND kind='standard' AND type='stamps_free_item' ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO up FROM merchant.loyalty_reward WHERE merchant_id=p_merchant AND active AND kind='upgrade' AND type='stamps_free_item' ORDER BY created_at DESC LIMIT 1;
  base_n:=COALESCE(std.stamps_required,10); threshold:=CASE WHEN up.stamps_required>base_n THEN up.stamps_required ELSE base_n END;
  IF base_n<>7 OR threshold<>9 THEN RAISE EXCEPTION 'Single cycle policy requires the 7/9 reward ladder'; END IF;
  started:=clock_timestamp(); deadline:=started+make_interval(days=>p_days);
  INSERT INTO merchant.loyalty_reward_policy(merchant_id,mode,expiry_days,started_at) VALUES(p_merchant,'single_cycle',p_days,started)
  ON CONFLICT(merchant_id) DO UPDATE SET mode=EXCLUDED.mode,expiry_days=EXCLUDED.expiry_days,started_at=EXCLUDED.started_at;
  FOR ca IN SELECT * FROM merchant.loyalty_card WHERE merchant_id=p_merchant ORDER BY id FOR UPDATE LOOP
    SELECT COALESCE(sum(stamps),0)::int INTO total FROM merchant.loyalty_visit WHERE merchant_id=p_merchant AND card_id=ca.id;
    pos:=GREATEST(0,total-ca.cycle_anchor)%threshold; anchor:=total-pos;
    SELECT GREATEST(0,ca.rewards_earned-count(*))::int INTO pending FROM merchant.loyalty_redemption
      WHERE merchant_id=p_merchant AND card_id=ca.id AND reverted_at IS NULL AND NOT cycle_reset;
    SELECT * INTO ov FROM merchant.loyalty_reward WHERE merchant_id=p_merchant AND id=ca.reward_override_id;
    base_id:=COALESCE(ov.id,std.id);base_name:=COALESCE(ov.name,std.name,'Recompensa de temporada');base_desc:=COALESCE(ov.description,std.description);
    top_id:=up.id;top_name:=up.name;top_desc:=up.description;
    INSERT INTO merchant.loyalty_reward_activation_audit VALUES(p_merchant,ca.id,started,ca.cycle_anchor,total,anchor,pending);
    UPDATE merchant.loyalty_card SET cycle_anchor=anchor WHERE merchant_id=p_merchant AND id=ca.id;
    FOR i IN 1..pending LOOP
      INSERT INTO merchant.loyalty_reward_entitlement(merchant_id,card_id,source,activated_at,expires_at,tier,
        base_reward_id,base_reward_name,base_reward_description,base_visits_required,top_reward_id,top_reward_name,top_reward_description,top_visits_required)
      VALUES(p_merchant,ca.id,'legacy',started,deadline,CASE WHEN i<=ca.pending_tier1 THEN 'base' ELSE 'top' END,
        base_id,base_name,base_desc,base_n,top_id,top_name,top_desc,threshold);
    END LOOP;
    FOR rd IN SELECT r.*,rr.name reward_name FROM merchant.loyalty_redemption r LEFT JOIN merchant.loyalty_reward rr ON rr.merchant_id=r.merchant_id AND rr.id=r.reward_id
      WHERE r.merchant_id=p_merchant AND r.card_id=ca.id AND r.reason='stamps' AND r.reverted_at IS NULL LOOP
      INSERT INTO merchant.loyalty_reward_entitlement(merchant_id,card_id,source,activated_at,expires_at,tier,redeemed_at,
        base_reward_id,base_reward_name,base_reward_description,base_visits_required,top_reward_id,top_reward_name,top_reward_description,top_visits_required)
      VALUES(p_merchant,ca.id,'legacy',started,deadline,CASE WHEN rd.cycle_reset OR rd.reward_id=base_id THEN 'base' ELSE 'top' END,rd.occurred_at,
        rd.reward_id,COALESCE(rd.reward_name,base_name),base_desc,base_n,rd.reward_id,COALESCE(rd.reward_name,top_name),top_desc,threshold) RETURNING id INTO unit;
      INSERT INTO merchant.loyalty_reward_redemption_link(merchant_id,redemption_id,entitlement_id,claimed_tier) VALUES(p_merchant,rd.id,unit,CASE WHEN rd.cycle_reset OR rd.reward_id=base_id THEN 'base' ELSE 'top' END);
    END LOOP;
    IF pos>=base_n THEN
      INSERT INTO merchant.loyalty_reward_entitlement(merchant_id,card_id,source,cycle_anchor,eligible_at,activated_at,expires_at,tier,
        base_reward_id,base_reward_name,base_reward_description,base_visits_required,top_reward_id,top_reward_name,top_reward_description,top_visits_required)
      VALUES(p_merchant,ca.id,'cycle',anchor,NULL,started,deadline,'base',base_id,base_name,base_desc,base_n,top_id,top_name,top_desc,threshold);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION merchant.activate_single_cycle_reward_policy(uuid,integer) FROM PUBLIC,api;
GRANT EXECUTE ON FUNCTION merchant.activate_single_cycle_reward_policy(uuid,integer) TO worker;

-- Reads exclude expired units before a worker can update the card.
CREATE OR REPLACE FUNCTION merchant.loyalty_reward_card_state(p_merchant uuid,p_card uuid)
RETURNS TABLE(visits_this_cycle integer,pending_rewards integer,reward_policy text,reward_expiry_days integer,
 next_reward_expires_at timestamptz,legacy_pending_rewards integer,cycle_reward_available boolean,visit_blocked_reason text,
 available_rewards jsonb,merchant_timezone text,reward_name text,visits_required integer,base_reward_name text,base_visits_required integer)
LANGUAGE sql STABLE SET search_path=pg_catalog,merchant AS $$
 WITH policy AS (SELECT COALESCE(p.mode,'accumulate') mode,p.expiry_days FROM merchant.merchant m LEFT JOIN merchant.loyalty_reward_policy p ON p.merchant_id=m.id WHERE m.id=p_merchant),
 card AS (SELECT c.*,COALESCE((SELECT sum(stamps) FROM merchant.loyalty_visit v WHERE v.merchant_id=p_merchant AND v.card_id=p_card),0)::int total FROM merchant.loyalty_card c WHERE c.merchant_id=p_merchant AND c.id=p_card),
 ladder AS (SELECT COALESCE((SELECT stamps_required FROM merchant.loyalty_reward WHERE merchant_id=p_merchant AND active AND kind='upgrade' AND type='stamps_free_item' ORDER BY created_at DESC LIMIT 1),0) up,
 COALESCE((SELECT stamps_required FROM merchant.loyalty_reward WHERE merchant_id=p_merchant AND active AND kind='standard' AND type='stamps_free_item' ORDER BY created_at DESC LIMIT 1),10) base),
 units AS (SELECT e.*,CASE WHEN (CASE WHEN e.recovery THEN COALESCE(e.recovery_tier,e.tier) ELSE e.tier END)='base' THEN e.base_reward_name ELSE e.top_reward_name END display_name FROM merchant.loyalty_reward_entitlement e WHERE e.merchant_id=p_merchant AND e.card_id=p_card AND e.redeemed_at IS NULL AND e.expired_at IS NULL AND e.expires_at>statement_timestamp()),
 active_cycle AS (SELECT e.* FROM units e,card c WHERE e.source='cycle' AND NOT e.recovery AND e.cycle_anchor=c.cycle_anchor LIMIT 1),
 grouped AS (SELECT display_name,expires_at,count(*)::int qty FROM units GROUP BY display_name,expires_at)
 SELECT CASE WHEN p.mode='single_cycle' THEN CASE WHEN EXISTS(SELECT 1 FROM merchant.loyalty_reward_entitlement e WHERE e.merchant_id=p_merchant AND e.card_id=p_card AND e.source='cycle' AND NOT e.recovery AND e.cycle_anchor=c.cycle_anchor AND e.redeemed_at IS NULL AND e.expires_at<=statement_timestamp()) THEN 0 ELSE GREATEST(0,c.total-c.cycle_anchor) END ELSE (c.total-c.cycle_anchor)%GREATEST(l.base,l.up) END::int,
 CASE WHEN p.mode='single_cycle' THEN (SELECT count(*) FROM units)::int ELSE c.rewards_earned-(SELECT count(*)::int FROM merchant.loyalty_redemption r WHERE r.merchant_id=p_merchant AND r.card_id=p_card AND r.reverted_at IS NULL AND NOT r.cycle_reset) END,
 p.mode,p.expiry_days,(SELECT min(expires_at) FROM units),(SELECT count(*)::int FROM units WHERE source='legacy' OR recovery),EXISTS(SELECT 1 FROM active_cycle),
 CASE WHEN p.mode='single_cycle' AND (EXISTS(SELECT 1 FROM units WHERE source='legacy' OR recovery) OR EXISTS(SELECT 1 FROM active_cycle WHERE tier='top')) THEN 'REDEMPTION_REQUIRED' ELSE NULL END,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('rewardName',display_name,'quantity',qty,'expiresAt',expires_at) ORDER BY expires_at,display_name) FROM grouped),'[]'::jsonb),
 COALESCE((SELECT timezone FROM merchant.merchant WHERE id=p_merchant),'America/Mexico_City'),
 (SELECT top_reward_name FROM active_cycle),COALESCE((SELECT top_visits_required FROM active_cycle),CASE WHEN p.mode='single_cycle' THEN 9 ELSE GREATEST(l.base,l.up) END),(SELECT base_reward_name FROM active_cycle),(SELECT base_visits_required FROM active_cycle)
 FROM policy p,card c,ladder l
$$;
REVOKE ALL ON FUNCTION merchant.loyalty_reward_card_state(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merchant.loyalty_reward_card_state(uuid,uuid) TO api,worker;
COMMIT;
