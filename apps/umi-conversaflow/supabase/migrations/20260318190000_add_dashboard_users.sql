-- Dashboard users: maps Supabase Auth users to businesses with roles
CREATE TABLE dashboard_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id),
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'admin', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(auth_user_id, business_id)
);

CREATE INDEX idx_dashboard_users_auth ON dashboard_users(auth_user_id);
