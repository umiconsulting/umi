-- ============================================================================
-- 060 · Drop retired pre-restructure and leftover provider schemas
--
-- Leaves only the six canonical PostgreSQL schemas:
--   umi, merchant, runtime, kds, extensions, public
--
-- Guarded with IF EXISTS so applying on a pristine database (which never had
-- these schemas) is a clean no-op.
-- ============================================================================

drop schema if exists
  _migration,
  comms,
  core,
  device,
  grow,
  kitchen,
  legacy,
  loyalty,
  observability,
  ops,
  queue,
  auth,
  cron,
  graphql,
  graphql_public,
  net,
  realtime,
  storage,
  supabase_migrations,
  vault
cascade;
