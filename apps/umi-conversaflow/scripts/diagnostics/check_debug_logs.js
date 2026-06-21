const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  // Get all DEBUG security logs from the last 2 minutes
  const twoMinutesAgo = new Date(Date.now() - 120 * 1000).toISOString();

  const { data: debugLogs } = await supabase
    .from('security_logs')
    .select('*')
    .eq('phone', 'DEBUG')
    .gte('created_at', twoMinutesAgo)
    .order('created_at', { ascending: true });

  console.log('\n=== DEBUG LOGS (turn-integrity trace) ===');
  if (debugLogs?.length) {
    debugLogs.forEach((log, i) => {
      console.log(`${i + 1}. [${log.event_type}]`);
      console.log(`   ${log.details}`);
    });
  } else {
    console.log('No debug logs found');
  }
})();
