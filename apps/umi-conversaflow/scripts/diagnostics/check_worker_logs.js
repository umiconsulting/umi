const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  const oneMinuteAgo = new Date(Date.now() - 90 * 1000).toISOString();

  // Get ALL edge function logs from the last 90 seconds
  const { data: allLogs } = await supabase
    .from('edge_function_logs')
    .select('*')
    .gte('created_at', oneMinuteAgo)
    .order('created_at', { ascending: true });

  console.log('\n=== ALL EDGE FUNCTION LOGS (last 90 seconds) ===');
  if (allLogs?.length) {
    allLogs.forEach((log, i) => {
      console.log(`${i + 1}. [${log.function_name}] ${log.status} @ ${log.created_at} (${log.duration_ms}ms)`);
      if (log.error_message) console.log(`   ERROR: ${log.error_message}`);
    });
  } else {
    console.log('No logs found');
  }

  // Check specifically for job-worker
  const { data: workerLogs } = await supabase
    .from('edge_function_logs')
    .select('*')
    .eq('function_name', 'job-worker')
    .gte('created_at', oneMinuteAgo)
    .order('created_at', { ascending: false });

  console.log(`\n=== JOB-WORKER LOGS ===`);
  console.log(`Found ${workerLogs?.length || 0} job-worker logs`);
  if (workerLogs?.length) {
    workerLogs.forEach((log) => {
      console.log(`Status: ${log.status}, Duration: ${log.duration_ms}ms, Request ID: ${log.request_id}`);
      if (log.error_message) console.log(`  ERROR: ${log.error_message}`);
    });
  }

  // Check the turn.integrity job for any RPC calls it made
  // Actually check the conversation_turns directly to see if anything was created
  const { data: turns } = await supabase
    .from('conversation_turns')
    .select('*')
    .eq('conversation_id', '762559f0-5112-4040-9166-3fdd38d177ea')
    .gte('created_at', oneMinuteAgo);

  console.log(`\n=== CONVERSATION_TURNS CREATED (last 90 seconds) ===`);
  if (turns?.length) {
    turns.forEach((turn) => {
      console.log(`Created: ${turn.created_at}`);
      console.log(`  Status: ${turn.status}`);
      console.log(`  Decision: ${turn.integrity_decision}`);
      console.log(`  Reason: ${turn.integrity_reason}`);
    });
  } else {
    console.log('No turns created in this time window');
  }

  // Double-check: list jobs for this conversation
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('aggregate_id', '762559f0-5112-4040-9166-3fdd38d177ea')
    .gte('created_at', oneMinuteAgo)
    .order('created_at', { ascending: false });

  console.log(`\n=== JOBS FOR CONVERSATION (last 90 seconds) ===`);
  if (jobs?.length) {
    jobs.forEach((job) => {
      console.log(`[${job.job_type}] state=${job.state} attempt=${job.attempt_count} created=${job.created_at}`);
    });
  }
})();
