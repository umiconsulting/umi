const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  // Get logs from the last minute
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

  // Check for turn_integrity logs
  const { data: logs } = await supabase
    .from('edge_function_logs')
    .select('*')
    .gte('created_at', oneMinuteAgo)
    .order('created_at', { ascending: false });

  console.log('\n=== RECENT EDGE FUNCTION LOGS ===');
  if (logs?.length) {
    logs.forEach((log) => {
      console.log(`[${log.function_name}] ${log.status} @ ${log.created_at}`);
      if (log.error_message) console.log(`  ERROR: ${log.error_message}`);
    });
  } else {
    console.log('No recent logs');
  }

  // Get the latest user message
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('role', 'user')
    .eq('conversation_id', '762559f0-5112-4040-9166-3fdd38d177ea')
    .order('created_at', { ascending: false })
    .limit(1);

  if (messages?.length) {
    const msg = messages[0];
    console.log(`\n=== LATEST USER MESSAGE ===`);
    console.log(`ID: ${msg.id}`);
    console.log(`Content: "${msg.content}"`);
    console.log(`Created: ${msg.created_at}`);

    // Get jobs for this conversation created after this message
    const { data: jobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('aggregate_id', msg.conversation_id)
      .gte('created_at', msg.created_at)
      .order('created_at', { ascending: false });

    console.log(`\n=== JOBS CREATED FOR THIS MESSAGE ===`);
    if (jobs?.length) {
      jobs.forEach((job) => {
        console.log(`[${job.job_type}] state=${job.state} created=${job.created_at}`);
        if (job.error) console.log(`  ERROR: ${job.error}`);
      });
    } else {
      console.log('No jobs created');
    }

    // Check if an assistant message was created
    const { data: assistantMsg } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', msg.conversation_id)
      .eq('role', 'assistant')
      .gt('created_at', msg.created_at)
      .order('created_at', { ascending: true })
      .limit(1);

    console.log(`\n=== ASSISTANT RESPONSE ===`);
    if (assistantMsg?.length) {
      console.log(`✅ YES - "${assistantMsg[0].content.substring(0, 80)}..."`);
    } else {
      console.log(`❌ NO - Still no response`);
    }
  }
})();
