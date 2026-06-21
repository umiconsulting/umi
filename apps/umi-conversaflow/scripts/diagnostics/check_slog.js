const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  const oneMinuteAgo = new Date(Date.now() - 90 * 1000).toISOString();

  // The slog function logs to edge_function_logs, but we need to find where turn-integrity logs go
  // Let me check all recent logs that mention turn_integrity
  const { data: allLogs } = await supabase
    .from('edge_function_logs')
    .select('*')
    .gte('created_at', oneMinuteAgo)
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('\n=== ALL RECENT LOGS ===');
  if (allLogs?.length) {
    allLogs.forEach((log) => {
      console.log(`[${log.function_name}] ${log.status} @ ${log.created_at}`);
      console.log(`  duration: ${log.duration_ms}ms`);
      if (log.error_message) console.log(`  error: ${log.error_message}`);
    });
  }

  // Check if there's a job_worker log
  const { data: jobWorkerLogs } = await supabase
    .from('edge_function_logs')
    .select('*')
    .eq('function_name', 'job-worker')
    .gte('created_at', oneMinuteAgo)
    .order('created_at', { ascending: false });

  console.log('\n=== JOB-WORKER LOGS ===');
  if (jobWorkerLogs?.length) {
    jobWorkerLogs.forEach((log) => {
      console.log(`Status: ${log.status}, Duration: ${log.duration_ms}ms @ ${log.created_at}`);
    });
  } else {
    console.log('No job-worker logs found');
  }

  // The issue is that job-worker logs go to edge_function_logs but slog calls
  // should go somewhere. Let me check if there's a logs table or check the payload
  // Actually, let me just check the job details more carefully

  const { data: job } = await supabase
    .from('jobs')
    .select('*')
    .eq('job_type', 'turn.integrity')
    .eq('aggregate_id', '762559f0-5112-4040-9166-3fdd38d177ea')
    .order('created_at', { ascending: false })
    .limit(1);

  console.log('\n=== LATEST TURN.INTEGRITY JOB ===');
  if (job?.length) {
    console.log(JSON.stringify(job[0], null, 2));
  }
})();
