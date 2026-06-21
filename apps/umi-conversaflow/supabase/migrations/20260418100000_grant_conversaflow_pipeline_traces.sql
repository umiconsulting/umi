-- Allow service_role (Edge Functions, automation) to read/write pipeline traces in the
-- conversaflow schema. PostgREST and SQL clients using the service key hit this table
-- via Accept-Profile: conversaflow.

GRANT USAGE ON SCHEMA conversaflow TO service_role;
GRANT SELECT, INSERT ON TABLE conversaflow.pipeline_traces TO service_role;
