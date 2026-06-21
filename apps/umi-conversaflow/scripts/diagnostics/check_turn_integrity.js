const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  // Get the latest turn.integrity job
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('job_type', 'turn.integrity')
    .order('created_at', { ascending: false })
    .limit(1);

  const job = jobs?.[0];
  console.log('\n=== LATEST TURN.INTEGRITY JOB ===');
  console.log(JSON.stringify(job, null, 2));

  if (job?.id) {
    // Check the job attempts
    const { data: attempts } = await supabase
      .from('job_attempts')
      .select('*')
      .eq('job_id', job.id);

    console.log('\n=== JOB ATTEMPTS ===');
    attempts?.forEach((att) => {
      console.log(`Attempt ${att.attempt}: ${att.outcome} (${att.finished_at})`);
      if (att.error) console.log(`ERROR: ${att.error}`);
    });
  }

  // Check the conversation_turns table
  const { data: turns } = await supabase
    .from('conversation_turns')
    .select('*')
    .eq('conversation_id', job?.aggregate_id)
    .order('created_at', { ascending: false });

  console.log('\n=== CONVERSATION_TURNS FOR THIS CONVERSATION ===');
  if (turns?.length) {
    turns.forEach((turn) => {
      console.log(`Turn ${turn.id}:`);
      console.log(`  status: ${turn.status}`);
      console.log(`  integrity_decision: ${turn.integrity_decision}`);
      console.log(`  integrity_reason: ${turn.integrity_reason}`);
      console.log(`  created_at: ${turn.created_at}`);
    });
  } else {
    console.log('No turns created');
  }
})();
