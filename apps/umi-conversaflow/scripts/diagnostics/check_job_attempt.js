const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  const jobId = '7a1619da-4e23-434f-ba43-9c3f91aa1cf9';

  // Get job attempt details
  const { data: attempt } = await supabase
    .from('job_attempts')
    .select('*')
    .eq('job_id', jobId);

  console.log('\n=== JOB ATTEMPT DETAILS ===');
  if (attempt?.length) {
    console.log(JSON.stringify(attempt[0], null, 2));
  } else {
    console.log('No attempts found');
  }

  // Check if there are conversation_turns for this conversation after the job ran
  const { data: turns } = await supabase
    .from('conversation_turns')
    .select('*')
    .eq('conversation_id', '762559f0-5112-4040-9166-3fdd38d177ea')
    .gte('created_at', '2026-04-01T20:40:36Z');

  console.log('\n=== TURNS CREATED AFTER JOB TIME ===');
  if (turns?.length) {
    console.log(`Found ${turns.length} turns:`);
    turns.forEach((t) => {
      console.log(`  - ${t.id}: status=${t.status} decision=${t.integrity_decision} created=${t.created_at}`);
    });
  } else {
    console.log('No turns created after the job ran');
  }

  // Check any recent turns at all
  const { data: allTurns } = await supabase
    .from('conversation_turns')
    .select('*')
    .eq('conversation_id', '762559f0-5112-4040-9166-3fdd38d177ea')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n=== MOST RECENT TURNS ===');
  if (allTurns?.length) {
    allTurns.forEach((t, i) => {
      console.log(`${i + 1}. ${t.integrity_decision} @ ${t.created_at}`);
    });
  } else {
    console.log('No turns exist for this conversation');
  }

  // Check if maybe the issue is that turn.integrity is scheduled (buffering) rather than released
  const { data: pendingJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('aggregate_id', '762559f0-5112-4040-9166-3fdd38d177ea')
    .eq('job_type', 'turn.integrity')
    .eq('state', 'buffering');

  console.log('\n=== BUFFERING TURN.INTEGRITY JOBS ===');
  if (pendingJobs?.length) {
    console.log(`Found ${pendingJobs.length} buffering jobs`);
    pendingJobs.forEach((j) => {
      console.log(`  - ${j.id}: next_run_at=${j.next_run_at}`);
    });
  } else {
    console.log('No buffering turn.integrity jobs');
  }
})();
