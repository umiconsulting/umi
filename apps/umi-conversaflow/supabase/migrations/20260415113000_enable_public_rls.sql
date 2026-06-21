CREATE OR REPLACE FUNCTION public.user_has_business_access(target_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dashboard_users AS du
    WHERE du.auth_user_id = auth.uid()
      AND du.business_id = target_business_id
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_business_access_text(target_business_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dashboard_users AS du
    WHERE du.auth_user_id = auth.uid()
      AND du.business_id::text = target_business_id
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_business_access(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_business_access_text(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_business_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_business_access_text(TEXT) TO authenticated;

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_config_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edge_function_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_turn_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zettle_oauth_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dashboard_users_self_select" ON public.dashboard_users;
CREATE POLICY "dashboard_users_self_select"
ON public.dashboard_users
FOR SELECT
TO authenticated
USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "businesses_member_select" ON public.businesses;
CREATE POLICY "businesses_member_select"
ON public.businesses
FOR SELECT
TO authenticated
USING (public.user_has_business_access(id));

DROP POLICY IF EXISTS "customers_member_select" ON public.customers;
CREATE POLICY "customers_member_select"
ON public.customers
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "conversations_member_select" ON public.conversations;
CREATE POLICY "conversations_member_select"
ON public.conversations
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "messages_member_select" ON public.messages;
CREATE POLICY "messages_member_select"
ON public.messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.conversations AS c
    WHERE c.id = messages.conversation_id
      AND public.user_has_business_access(c.business_id)
  )
);

DROP POLICY IF EXISTS "products_member_select" ON public.products;
CREATE POLICY "products_member_select"
ON public.products
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "transactions_member_select" ON public.transactions;
CREATE POLICY "transactions_member_select"
ON public.transactions
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "customer_preferences_member_select" ON public.customer_preferences;
CREATE POLICY "customer_preferences_member_select"
ON public.customer_preferences
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.customers AS c
    WHERE c.id = customer_preferences.customer_id
      AND public.user_has_business_access(c.business_id)
  )
);

DROP POLICY IF EXISTS "business_config_changes_member_select" ON public.business_config_changes;
CREATE POLICY "business_config_changes_member_select"
ON public.business_config_changes
FOR SELECT
TO authenticated
USING (public.user_has_business_access_text(business_id));

DROP POLICY IF EXISTS "security_logs_no_direct_access" ON public.security_logs;
CREATE POLICY "security_logs_no_direct_access"
ON public.security_logs
FOR SELECT
TO authenticated
USING (FALSE);

DROP POLICY IF EXISTS "ai_turn_logs_member_select" ON public.ai_turn_logs;
CREATE POLICY "ai_turn_logs_member_select"
ON public.ai_turn_logs
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "daily_summaries_member_select" ON public.daily_summaries;
CREATE POLICY "daily_summaries_member_select"
ON public.daily_summaries
FOR SELECT
TO authenticated
USING (public.user_has_business_access_text(business_id));

DROP POLICY IF EXISTS "conversation_outcomes_member_select" ON public.conversation_outcomes;
CREATE POLICY "conversation_outcomes_member_select"
ON public.conversation_outcomes
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "inbound_events_member_select" ON public.inbound_events;
CREATE POLICY "inbound_events_member_select"
ON public.inbound_events
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "jobs_member_select" ON public.jobs;
CREATE POLICY "jobs_member_select"
ON public.jobs
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "job_attempts_member_select" ON public.job_attempts;
CREATE POLICY "job_attempts_member_select"
ON public.job_attempts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.jobs AS j
    WHERE j.id = job_attempts.job_id
      AND public.user_has_business_access(j.business_id)
  )
);

DROP POLICY IF EXISTS "outbox_member_select" ON public.outbox;
CREATE POLICY "outbox_member_select"
ON public.outbox
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "conversation_turns_member_select" ON public.conversation_turns;
CREATE POLICY "conversation_turns_member_select"
ON public.conversation_turns
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));

DROP POLICY IF EXISTS "transaction_status_events_member_select" ON public.transaction_status_events;
CREATE POLICY "transaction_status_events_member_select"
ON public.transaction_status_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.transactions AS t
    WHERE t.id = transaction_status_events.transaction_id
      AND public.user_has_business_access(t.business_id)
  )
);

DROP POLICY IF EXISTS "edge_function_logs_no_direct_access" ON public.edge_function_logs;
CREATE POLICY "edge_function_logs_no_direct_access"
ON public.edge_function_logs
FOR SELECT
TO authenticated
USING (FALSE);

DROP POLICY IF EXISTS "zettle_oauth_tokens_member_select" ON public.zettle_oauth_tokens;
CREATE POLICY "zettle_oauth_tokens_member_select"
ON public.zettle_oauth_tokens
FOR SELECT
TO authenticated
USING (public.user_has_business_access(business_id));
