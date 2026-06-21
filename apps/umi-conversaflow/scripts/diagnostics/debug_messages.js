const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: process.env.DB_SCHEMA || process.env.SUPABASE_DB_SCHEMA || 'conversaflow' } });

(async () => {
  const convId = '762559f0-5112-4040-9166-3fdd38d177ea';

  // Get the last 5 messages in order they appear
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n=== LAST 5 MESSAGES (newest first) ===');
  messages?.forEach((msg) => {
    console.log(`[${msg.id}] ${msg.role} @ ${msg.created_at}`);
    console.log(`  content: "${msg.content}"`);
    console.log(`  request_id: ${msg.request_id}`);
    console.log(`  twilio_message_sid: ${msg.twilio_message_sid}`);
  });

  // Specifically check if the "hola" message exists
  const { data: holaMsg } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', convId)
    .eq('content', 'hola')
    .order('created_at', { ascending: false })
    .limit(1);

  console.log('\n=== CHECKING FOR "hola" MESSAGE ===');
  if (holaMsg?.length) {
    console.log(`Found: ${holaMsg[0].id}`);
    console.log(`Role: ${holaMsg[0].role}`);
    console.log(`Created: ${holaMsg[0].created_at}`);
  } else {
    console.log('NOT FOUND');
  }

  // Check the specific message ID from the job payload
  const { data: specificMsg } = await supabase
    .from('messages')
    .select('*')
    .eq('id', 'c225144b-3fc1-425b-8d2b-230ffae3cbb7');

  console.log('\n=== CHECKING SPECIFIC MESSAGE FROM JOB PAYLOAD ===');
  if (specificMsg?.length) {
    const msg = specificMsg[0];
    console.log(`Found: ${msg.id}`);
    console.log(`Conversation: ${msg.conversation_id}`);
    console.log(`Role: ${msg.role}`);
    console.log(`Content: "${msg.content}"`);
    console.log(`Created: ${msg.created_at}`);
  } else {
    console.log('NOT FOUND - THIS IS THE PROBLEM');
  }
})();
