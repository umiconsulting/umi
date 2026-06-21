const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  const convId = '762559f0-5112-4040-9166-3fdd38d177ea';

  // Get the last 10 jobs for this conversation
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('aggregate_id', convId)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('\n=== LAST 10 JOBS FOR CONVERSATION ===');
  if (jobs?.length) {
    jobs.forEach((job, i) => {
      console.log(`${i + 1}. [${job.job_type}]`);
      console.log(`   state: ${job.state}`);
      console.log(`   created: ${job.created_at}`);
      console.log(`   completed: ${job.completed_at}`);
      console.log(`   attempts: ${job.attempt_count}`);
      if (job.error) console.log(`   error: ${job.error}`);
    });
  }

  // Get the latest user message
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', convId)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(1);

  if (messages?.length) {
    const msg = messages[0];
    console.log(`\n=== LATEST USER MESSAGE ===`);
    console.log(`ID: ${msg.id}`);
    console.log(`Content: "${msg.content}"`);
    console.log(`Created: ${msg.created_at}`);

    // Get jobs created AFTER this message
    const { data: newJobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('aggregate_id', convId)
      .gt('created_at', msg.created_at)
      .order('created_at', { ascending: false });

    console.log(`\n=== JOBS CREATED AFTER THIS MESSAGE ===`);
    if (newJobs?.length) {
      newJobs.forEach((job) => {
        console.log(`[${job.job_type}] state=${job.state} created=${job.created_at}`);
      });
    } else {
      console.log('No jobs created after this message');
    }
  }
})();
