ALTER TABLE merchant.merchant
  ADD COLUMN IF NOT EXISTS purchase_days smallint[] NOT NULL DEFAULT '{}'::smallint[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'merchant.merchant'::regclass
        AND conname = 'merchant_purchase_days_ck') THEN
    ALTER TABLE merchant.merchant ADD CONSTRAINT merchant_purchase_days_ck CHECK (
      CASE
        WHEN cardinality(purchase_days) = 0 THEN true
        WHEN array_ndims(purchase_days) = 1 AND array_lower(purchase_days, 1) = 1 THEN
          cardinality(purchase_days) <= 7
          AND purchase_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
          AND array_position(purchase_days, NULL::smallint) IS NULL
          AND cardinality(array_positions(purchase_days, 0::smallint)) <= 1
          AND cardinality(array_positions(purchase_days, 1::smallint)) <= 1
          AND cardinality(array_positions(purchase_days, 2::smallint)) <= 1
          AND cardinality(array_positions(purchase_days, 3::smallint)) <= 1
          AND cardinality(array_positions(purchase_days, 4::smallint)) <= 1
          AND cardinality(array_positions(purchase_days, 5::smallint)) <= 1
          AND cardinality(array_positions(purchase_days, 6::smallint)) <= 1
        ELSE false
      END
    );
  END IF;
END;
$$;

COMMENT ON COLUMN merchant.merchant.purchase_days IS
  'Usual local purchase weekdays: 0 Sunday through 6 Saturday. Empty means not configured.';
