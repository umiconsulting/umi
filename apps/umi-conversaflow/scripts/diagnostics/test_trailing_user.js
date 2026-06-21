const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  const convId = '762559f0-5112-4040-9166-3fdd38d177ea';

  // Replicate the getTrailingUserRun query exactly
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('\n=== TRAILING USER RUN QUERY RESULT ===');
  console.log(`Error: ${error?.message ?? 'none'}`);
  console.log(`Records returned: ${data?.length ?? 0}`);

  if (data?.length) {
    console.log('\nAll records (newest first):');
    data.forEach((msg, i) => {
      console.log(`${i}. [${msg.role}] "${msg.content}" @ ${msg.created_at}`);
    });

    // Simulate the iteration logic
    console.log('\n=== SIMULATING ITERATION ===');
    const run = [];
    for (const message of data) {
      console.log(`Checking: ${message.role}`);
      if (message.role === 'assistant') {
        console.log('  → BREAK (found assistant)');
        break;
      }
      console.log(`  → ADD TO RUN`);
      run.push(message);
    }

    console.log(`\nRun before reverse: ${run.length} messages`);
    run.reverse();
    console.log(`Run after reverse: ${run.length} messages`);
    run.forEach((msg, i) => {
      console.log(`  ${i}. [${msg.role}] "${msg.content}"`);
    });
  }
})();
