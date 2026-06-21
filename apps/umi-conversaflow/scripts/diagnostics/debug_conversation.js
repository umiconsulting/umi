const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  const convId = '762559f0-5112-4040-9166-3fdd38d177ea';

  // Get the conversation state
  const { data: conv } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', convId)
    .single();

  console.log('\n=== CONVERSATION STATE ===');
  console.log(`ID: ${conv?.id}`);
  console.log(`Status: ${conv?.status}`);
  console.log(`Current state: ${conv?.current_state}`);
  console.log(`State version: ${conv?.state_version}`);
  console.log(`Pending clarification: ${JSON.stringify(conv?.pending_clarification)}`);
  console.log(`Summary: ${conv?.summary ? conv.summary.substring(0, 100) + '...' : null}`);
  console.log(`Last message at: ${conv?.last_message_at}`);
})();
