GRANT USAGE ON SCHEMA platform, commerce, cash, observability TO service_role, authenticated, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA platform TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA commerce TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA commerce TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cash TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA cash TO authenticated;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA observability TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON conversaflow.workflow_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversaflow.job_attempts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversaflow.memory_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversaflow.tool_calls TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversaflow.channels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversaflow.channel_accounts TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON kds.stations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON kds.device_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON kds.device_pairing_requests TO service_role;

GRANT SELECT ON conversaflow.workflow_jobs TO authenticated;
GRANT SELECT ON conversaflow.memory_items TO authenticated;
GRANT SELECT ON conversaflow.channels TO authenticated;
GRANT SELECT ON conversaflow.channel_accounts TO authenticated;
GRANT SELECT ON kds.stations TO authenticated;
GRANT SELECT ON kds.device_pairing_requests TO authenticated;
