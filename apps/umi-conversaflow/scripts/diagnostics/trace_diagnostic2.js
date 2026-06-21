const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  // Check if messages table has any data
  const { data: count, error: countErr } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true });

  console.log('Messages table row count:', count?.length || 0);
  console.log('Count error:', countErr);

  // Fetch any 5 messages
  const { data: messages, error: msgErr } = await supabase
    .from('messages')
    .select('*')
    .limit(5);

  console.log('\n=== SAMPLE MESSAGES ===');
  if (messages) {
    console.log(`Found ${messages.length} messages:`);
    messages.forEach((msg) => {
      console.log(`- [${msg.id}] role=${msg.role} conv=${msg.conversation_id} created=${msg.created_at}`);
    });
  } else {
    console.log('Error fetching messages:', msgErr);
  }

  // Check conversations
  const { data: convs } = await supabase
    .from('conversations')
    .select('*')
    .limit(5);

  console.log('\n=== SAMPLE CONVERSATIONS ===');
  console.log(`Found ${convs?.length || 0} conversations:`);
  convs?.forEach((conv) => {
    console.log(`- [${conv.id}] customer=${conv.customer_id} status=${conv.status} created=${conv.created_at}`);
  });

  // Check jobs
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')
    .limit(10);

  console.log('\n=== SAMPLE JOBS ===');
  console.log(`Found ${jobs?.length || 0} jobs:`);
  jobs?.forEach((job) => {
    console.log(`- [${job.id}] type=${job.job_type} state=${job.state} aggregate=${job.aggregate_id}`);
  });

  // Check edge function logs
  const { data: logs } = await supabase
    .from('edge_function_logs')
    .select('*')
    .limit(5);

  console.log('\n=== EDGE FUNCTION LOGS ===');
  console.log(`Found ${logs?.length || 0} logs:`);
  logs?.forEach((log) => {
    console.log(`- [${log.id}] func=${log.function_name} status=${log.status} req=${log.request_id}`);
  });

  // Check outbox
  const { data: outbox } = await supabase
    .from('outbox')
    .select('*')
    .limit(5);

  console.log('\n=== OUTBOX ===');
  console.log(`Found ${outbox?.length || 0} rows:`);
  outbox?.forEach((row) => {
    console.log(`- [${row.id}] action=${row.action} target=${row.target} state=${row.state}`);
  });
})();
