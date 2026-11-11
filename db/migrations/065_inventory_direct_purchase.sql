ALTER TABLE merchant.purchase_order
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'order';
ALTER TABLE merchant.purchase_order ALTER COLUMN supplier_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid='merchant.purchase_order'::regclass
        AND conname='purchase_order_origin_supplier_ck') THEN
    ALTER TABLE merchant.purchase_order
      ADD CONSTRAINT purchase_order_origin_supplier_ck
      CHECK (origin IN ('order','direct_purchase') AND
        (supplier_id IS NOT NULL OR origin='direct_purchase'));
  END IF;
END;
$$;
