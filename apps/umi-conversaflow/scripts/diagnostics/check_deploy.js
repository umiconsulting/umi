const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  const twoMinutesAgo = new Date(Date.now() - 120 * 1000).toISOString();

  // Check if there's a pending turn.integrity job
  const { data: pendingJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('job_type', 'turn.integrity')
    .eq('state', 'pending')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n=== PENDING TURN.INTEGRITY JOBS ===');
  if (pendingJobs?.length) {
    console.log(`Found ${pendingJobs.length} pending jobs`);
    pendingJobs.forEach((job) => {
      console.log(`- [${job.id}] created=${job.created_at}`);
    });
  } else {
    console.log('No pending turn.integrity jobs');
  }

  // Check the latest jobs regardless of state
  const { data: allJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('job_type', 'turn.integrity')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n=== LATEST TURN.INTEGRITY JOBS ===');
  if (allJobs?.length) {
    allJobs.forEach((job, i) => {
      console.log(`${i + 1}. state=${job.state} created=${job.created_at}`);
    });
  }

  // Check edge_function_logs for job-worker
  const { data: workerLogs } = await supabase
    .from('edge_function_logs')
    .select('*')
    .eq('function_name', 'job-worker')
    .gte('created_at', twoMinutesAgo)
    .order('created_at', { ascending: false });

  console.log('\n=== JOB-WORKER LOGS (last 2 min) ===');
  if (workerLogs?.length) {
    console.log(`Found ${workerLogs.length} logs`);
    workerLogs.forEach((log) => {
      console.log(`Status: ${log.status} @ ${log.created_at} (${log.duration_ms}ms)`);
    });
  } else {
    console.log('No job-worker logs in last 2 minutes');
  }

  // Check ALL edge function logs
  const { data: allLogs } = await supabase
    .from('edge_function_logs')
    .select('*')
    .gte('created_at', twoMinutesAgo)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('\n=== ALL EDGE FUNCTION LOGS (last 2 min) ===');
  allLogs?.forEach((log) => {
    console.log(`[${log.function_name}] ${log.status} @ ${log.created_at}`);
  });
})();
