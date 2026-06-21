const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  // Check security logs for the request_id
  const { data: secLogs } = await supabase
    .from('security_logs')
    .select('*')
    .eq('request_id', '65f490df-2958-4564-881a-2da64192237a');

  console.log('\n=== SECURITY LOGS (request_id) ===');
  if (secLogs?.length) {
    secLogs.forEach((log) => {
      console.log(`[${log.event_type}] ${log.details}`);
    });
  } else {
    console.log('No security logs');
  }

  // Check inbound events for this phone/time
  const { data: inbound } = await supabase
    .from('inbound_events')
    .select('*')
    .gte('created_at', '2026-04-01T20:40:30Z')
    .lte('created_at', '2026-04-01T20:40:40Z')
    .limit(5);

  console.log('\n=== INBOUND EVENTS (time window) ===');
  if (inbound?.length) {
    inbound.forEach((event) => {
      console.log(`[${event.event_type}] source=${event.source} created=${event.created_at}`);
      if (event.payload) console.log(`  payload: ${JSON.stringify(event.payload).substring(0, 100)}`);
    });
  } else {
    console.log('No inbound events in this time window');
  }

  // Check for any job with state=dead
  const { data: deadJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('aggregate_id', '762559f0-5112-4040-9166-3fdd38d177ea')
    .eq('state', 'dead');

  console.log('\n=== DEAD JOBS ===');
  if (deadJobs?.length) {
    deadJobs.forEach((job) => {
      console.log(`[${job.job_type}] error=${job.error}`);
    });
  } else {
    console.log('No dead jobs');
  }

  // Check the latest job for this conversation
  const { data: latestJob } = await supabase
    .from('jobs')
    .select('*')
    .eq('aggregate_id', '762559f0-5112-4040-9166-3fdd38d177ea')
    .order('created_at', { ascending: false })
    .limit(1);

  if (latestJob?.length) {
    const job = latestJob[0];
    console.log('\n=== LATEST JOB FOR CONVERSATION ===');
    console.log(`Type: ${job.job_type}`);
    console.log(`State: ${job.state}`);
    console.log(`Created: ${job.created_at}`);
    console.log(`Completed: ${job.completed_at}`);
    console.log(`Error: ${job.error || 'none'}`);
    console.log(`Payload: ${JSON.stringify(job.payload, null, 2)}`);
  }
})();
