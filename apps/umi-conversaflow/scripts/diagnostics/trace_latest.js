const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  // Get the latest user message
  const { data: latestMsg } = await supabase
    .from('messages')
    .select('*')
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(1);

  const msg = latestMsg?.[0];
  if (!msg) {
    console.log('No messages found');
    process.exit(1);
  }

  console.log('\n=== LATEST USER MESSAGE ===');
  console.log(`ID: ${msg.id}`);
  console.log(`Conversation: ${msg.conversation_id}`);
  console.log(`Content: ${msg.content}`);
  console.log(`Created: ${msg.created_at}`);
  console.log(`Request ID: ${msg.request_id}`);

  const convId = msg.conversation_id;

  // Get all messages in this conversation
  const { data: allMsgs } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true });

  console.log(`\n=== CONVERSATION MESSAGES (${allMsgs?.length || 0} total) ===`);
  allMsgs?.forEach((m, i) => {
    console.log(`${i + 1}. [${m.role}] ${m.created_at}: ${m.content.substring(0, 60)}`);
  });

  // Check if there's an assistant response AFTER this message
  const { data: assistantAfter } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', convId)
    .eq('role', 'assistant')
    .gt('created_at', msg.created_at)
    .order('created_at', { ascending: true });

  console.log(`\n=== ASSISTANT RESPONSE AFTER USER MESSAGE ===`);
  if (assistantAfter?.length) {
    const resp = assistantAfter[0];
    console.log(`✅ YES - Created ${resp.created_at}: ${resp.content.substring(0, 100)}`);
  } else {
    console.log(`❌ NO - No assistant response!`);
  }

  // Get all jobs for this conversation
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('aggregate_id', convId)
    .order('created_at', { ascending: false });

  console.log(`\n=== JOBS FOR THIS CONVERSATION ===`);
  jobs?.forEach((job) => {
    console.log(`- [${job.job_type}] state=${job.state} created=${job.created_at}`);
    if (job.error) console.log(`  ERROR: ${job.error}`);
  });

  // Check for turn.integrity jobs specifically
  const { data: integrityJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('aggregate_id', convId)
    .eq('job_type', 'turn.integrity')
    .order('created_at', { ascending: false });

  console.log(`\n=== TURN.INTEGRITY JOBS ===`);
  if (integrityJobs?.length) {
    integrityJobs.forEach((job) => {
      console.log(`- [${job.id}] state=${job.state}`);
      if (job.error) console.log(`  ERROR: ${job.error}`);
    });
  } else {
    console.log('No turn.integrity jobs found');
  }

  // Check for turn.process jobs
  const { data: processJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('aggregate_id', convId)
    .eq('job_type', 'turn.process')
    .order('created_at', { ascending: false });

  console.log(`\n=== TURN.PROCESS JOBS ===`);
  if (processJobs?.length) {
    processJobs.forEach((job) => {
      console.log(`- [${job.id}] state=${job.state}`);
      if (job.error) console.log(`  ERROR: ${job.error}`);
    });
  } else {
    console.log('No turn.process jobs found');
  }

  // Check outbox for this conversation
  const { data: outbox } = await supabase
    .from('outbox')
    .select('*')
    .eq('aggregate_id', convId)
    .order('created_at', { ascending: false });

  console.log(`\n=== OUTBOX DELIVERIES ===`);
  outbox?.forEach((row) => {
    console.log(`- [${row.action}→${row.target}] state=${row.state} created=${row.created_at}`);
    if (row.error_message) console.log(`  ERROR: ${row.error_message}`);
  });

  // Check edge function logs
  if (msg.request_id) {
    const { data: edgeLogs } = await supabase
      .from('edge_function_logs')
      .select('*')
      .eq('request_id', msg.request_id);

    console.log(`\n=== EDGE FUNCTION LOGS (request_id=${msg.request_id}) ===`);
    if (edgeLogs?.length) {
      edgeLogs.forEach((log) => {
        console.log(`- [${log.function_name}] ${log.status} (${log.duration_ms}ms)`);
        if (log.error_message) console.log(`  ERROR: ${log.error_message}`);
      });
    } else {
      console.log('No edge function logs found for this request_id');
    }
  } else {
    console.log('\nNo request_id in message, cannot check edge function logs');
  }

  // Check turns table to see if a turn was created
  const { data: turns } = await supabase
    .from('conversation_turns')
    .select('*')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false });

  console.log(`\n=== CONVERSATION TURNS ===`);
  if (turns?.length) {
    turns.forEach((turn) => {
      console.log(`- [${turn.id}] status=${turn.status} created=${turn.created_at}`);
      if (turn.integrity_decision) console.log(`  decision=${turn.integrity_decision}`);
    });
  } else {
    console.log('No turns found');
  }
})();
