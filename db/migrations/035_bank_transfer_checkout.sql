-- La sucursal publica instrucciones de transferencia y habilita su cobro manual.
-- El pago conserva un tipo propio. El operador confirma el abono antes del cierre.
ALTER TABLE merchant.pos_checkout_policy
  ADD COLUMN IF NOT EXISTS bank_transfer_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_transfer_holder_name text,
  ADD COLUMN IF NOT EXISTS bank_transfer_bank_name text,
  ADD COLUMN IF NOT EXISTS bank_transfer_clabe text,
  ADD COLUMN IF NOT EXISTS bank_transfer_account_number text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'merchant.pos_checkout_policy'::regclass
      AND conname = 'pos_checkout_policy_bank_transfer_details_check'
  ) THEN
    ALTER TABLE merchant.pos_checkout_policy
      ADD CONSTRAINT pos_checkout_policy_bank_transfer_details_check CHECK (
        (bank_transfer_holder_name IS NULL OR length(bank_transfer_holder_name) BETWEEN 1 AND 120)
        AND (bank_transfer_bank_name IS NULL OR length(bank_transfer_bank_name) BETWEEN 1 AND 120)
        AND (bank_transfer_clabe IS NULL OR bank_transfer_clabe ~ '^[0-9]{18}$')
        AND (bank_transfer_account_number IS NULL OR bank_transfer_account_number ~ '^[0-9]{1,24}$')
        AND (
          NOT bank_transfer_enabled
          OR (
            bank_transfer_holder_name IS NOT NULL
            AND bank_transfer_bank_name IS NOT NULL
            AND (bank_transfer_clabe IS NOT NULL OR bank_transfer_account_number IS NOT NULL)
          )
        )
      );
  END IF;
END $$;

GRANT UPDATE (
  bank_transfer_enabled, bank_transfer_holder_name, bank_transfer_bank_name,
  bank_transfer_clabe, bank_transfer_account_number
) ON merchant.pos_checkout_policy TO api;

ALTER TABLE merchant.pos_tender_fact
  DROP CONSTRAINT IF EXISTS pos_tender_fact_tender_type_check;
ALTER TABLE merchant.pos_tender_fact
  ADD CONSTRAINT pos_tender_fact_tender_type_check
  CHECK (tender_type IN ('cash','manual_terminal','bank_transfer','wallet','gift_card'));

ALTER TABLE merchant.pos_payment_attempt
  DROP CONSTRAINT IF EXISTS pos_payment_attempt_method_check;
ALTER TABLE merchant.pos_payment_attempt
  ADD CONSTRAINT pos_payment_attempt_method_check
  CHECK (method IN ('cash','external_terminal','bank_transfer','stored_value','gift_card'));

ALTER TABLE merchant.payment
  DROP CONSTRAINT IF EXISTS payment_method_check;
ALTER TABLE merchant.payment
  ADD CONSTRAINT payment_method_check
  CHECK (method IN ('cash','card','bank_transfer','stored_value','gift_card'));

ALTER TABLE merchant.pos_tender_compensation
  DROP CONSTRAINT IF EXISTS pos_tender_compensation_tender_type_check;
ALTER TABLE merchant.pos_tender_compensation
  ADD CONSTRAINT pos_tender_compensation_tender_type_check
  CHECK (tender_type IN ('cash','manual_terminal','bank_transfer','wallet','gift_card'));
