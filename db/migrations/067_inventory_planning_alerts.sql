ALTER TABLE merchant.merchant ADD COLUMN inventory_planning_email_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE merchant.inventory_planning_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchant.merchant(id),
  user_id uuid NOT NULL REFERENCES umi."user"(id),
  business_date date NOT NULL,
  state text NOT NULL CHECK (state IN ('sending','sent','unknown')),
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (merchant_id,user_id,business_date)
);
ALTER TABLE merchant.inventory_planning_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.inventory_planning_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON merchant.inventory_planning_delivery USING (merchant_id = nullif(current_setting('app.current_merchant', true),'')::uuid);
GRANT SELECT ON merchant.inventory_planning_delivery TO api;
GRANT SELECT,INSERT,UPDATE ON merchant.inventory_planning_delivery TO worker;
COMMENT ON TABLE merchant.inventory_planning_delivery IS 'Daily owner digest attempts. Unknown outcomes require review; never retry automatically.';
