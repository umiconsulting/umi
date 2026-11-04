-- Un cobro confirmado pertenece a una cuenta y conserva su identidad hasta el cierre.
-- El saldo usa sólo consumo: amount_minor_units menos tip_minor_units.
CREATE TABLE IF NOT EXISTS merchant.pos_partial_payment (
  merchant_id uuid NOT NULL REFERENCES merchant.merchant(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES merchant.location(id) ON DELETE RESTRICT,
  cart_id uuid NOT NULL REFERENCES merchant.pos_cart(id) ON DELETE RESTRICT,
  tender_id uuid NOT NULL,
  position integer CHECK (position BETWEEN 0 AND 31),
  cart_version integer NOT NULL CHECK (cart_version > 0),
  cart_fingerprint text NOT NULL CHECK (cart_fingerprint ~ '^[a-f0-9]{64}$'),
  base_due_minor_units bigint NOT NULL CHECK (base_due_minor_units > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  tender_type text NOT NULL CHECK (tender_type IN ('cash','manual_terminal','bank_transfer')),
  amount_minor_units bigint NOT NULL CHECK (amount_minor_units > 0),
  tip_minor_units bigint NOT NULL DEFAULT 0 CHECK (tip_minor_units >= 0 AND tip_minor_units < amount_minor_units),
  received_minor_units bigint CHECK (received_minor_units IS NULL OR received_minor_units >= amount_minor_units),
  status text NOT NULL CHECK (status IN ('confirmed_success','outcome_unknown','operator_reported_failure')),
  cash_shift_id uuid REFERENCES merchant.cash_shift(id) ON DELETE RESTRICT,
  cash_ledger_entry_id uuid UNIQUE REFERENCES merchant.cash_ledger_entry(id) ON DELETE RESTRICT,
  business_date date,
  confirmation_reference text CHECK (confirmation_reference IS NULL OR length(confirmation_reference) BETWEEN 1 AND 160),
  operator_session_id uuid NOT NULL REFERENCES runtime.operator_session(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id,cart_id,tender_id),
  UNIQUE (merchant_id,cart_id,position),
  CHECK (tender_type='cash' OR received_minor_units IS NULL),
  CHECK (tender_type<>'cash' OR (status='confirmed_success' AND received_minor_units IS NOT NULL)),
  CHECK ((status='operator_reported_failure') = (position IS NULL))
);

CREATE INDEX IF NOT EXISTS pos_partial_payment_cart_idx
  ON merchant.pos_partial_payment (merchant_id,location_id,cart_id,position);

ALTER TABLE merchant.pos_partial_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.pos_partial_payment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_location_isolation ON merchant.pos_partial_payment;
CREATE POLICY merchant_location_isolation ON merchant.pos_partial_payment
  USING (merchant_id=umi.current_merchant() AND location_id=umi.current_location())
  WITH CHECK (merchant_id=umi.current_merchant() AND location_id=umi.current_location());
GRANT SELECT,INSERT,UPDATE ON merchant.pos_partial_payment TO api,worker;
REVOKE ALL ON merchant.pos_partial_payment FROM public,readonly;
REVOKE DELETE ON merchant.pos_partial_payment FROM api,worker,readonly,public;

CREATE OR REPLACE FUNCTION merchant.tg_pos_partial_payment_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'partial payment deletion is prohibited';
  END IF;
  IF old.status='confirmed_success' THEN
    IF old.tender_type='cash'
       AND old.cash_ledger_entry_id IS NULL
       AND old.business_date IS NULL
       AND new.cash_ledger_entry_id IS NOT NULL
       AND new.business_date IS NOT NULL
       AND (to_jsonb(new)-ARRAY['cash_ledger_entry_id','business_date'])
         =(to_jsonb(old)-ARRAY['cash_ledger_entry_id','business_date']) THEN
      RETURN new;
    END IF;
    RAISE EXCEPTION 'confirmed partial payment is immutable';
  END IF;
  IF old.status='outcome_unknown'
     AND new.status IN ('confirmed_success','operator_reported_failure')
     AND new.confirmation_reference IS NOT NULL
     AND (to_jsonb(new)-ARRAY['status','position','confirmation_reference'])
       =(to_jsonb(old)-ARRAY['status','position','confirmation_reference'])
     AND (new.status='confirmed_success' AND new.position=old.position
       OR new.status='operator_reported_failure' AND new.position IS NULL) THEN
    RETURN new;
  END IF;
  RAISE EXCEPTION 'partial payment state is immutable';
END $$;

DROP TRIGGER IF EXISTS pos_partial_payment_immutable ON merchant.pos_partial_payment;
CREATE TRIGGER pos_partial_payment_immutable
  BEFORE UPDATE OR DELETE ON merchant.pos_partial_payment
  FOR EACH ROW EXECUTE FUNCTION merchant.tg_pos_partial_payment_immutable();

ALTER TABLE merchant.pos_tender_fact
  DROP CONSTRAINT IF EXISTS pos_tender_fact_position_check;
ALTER TABLE merchant.pos_tender_fact
  ADD CONSTRAINT pos_tender_fact_position_check CHECK (position BETWEEN 0 AND 31);

