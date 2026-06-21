import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: Deno.env.get('DB_SCHEMA') ?? Deno.env.get('SUPABASE_DB_SCHEMA') ?? 'conversaflow' },
})

// Find the latest customer message that didn't get a response
const { data: latestMessages } = await supabase
  .from('messages')
  .select('id, conversation_id, phone_number, role, content, created_at, request_id')
  .eq('role', 'user')
  .order('created_at', { ascending: false })
  .limit(5)

console.log('\n=== LATEST CUSTOMER MESSAGES ===')
console.log(JSON.stringify(latestMessages, null, 2))

if (!latestMessages?.[0]) {
  console.log('No messages found')
  Deno.exit(1)
}

const targetMessage = latestMessages[0]
const { conversation_id, request_id } = targetMessage

console.log(`\n=== ANALYZING MESSAGE ===`)
console.log(`Message ID: ${targetMessage.id}`)
console.log(`Conversation ID: ${conversation_id}`)
console.log(`Request ID: ${request_id}`)
console.log(`Created: ${targetMessage.created_at}`)

// Get all messages in this conversation
const { data: allMessages } = await supabase
  .from('messages')
  .select('id, role, content, created_at')
  .eq('conversation_id', conversation_id)
  .order('created_at', { ascending: true })

console.log(`\n=== CONVERSATION MESSAGES (${allMessages?.length || 0} total) ===`)
allMessages?.forEach((msg: any, i: number) => {
  console.log(`${i + 1}. [${msg.role}] ${msg.created_at}: ${msg.content.substring(0, 50)}...`)
})

// Check for jobs related to this conversation
const { data: jobs } = await supabase
  .from('jobs')
  .select('id, job_type, state, created_at, completed_at, error')
  .eq('aggregate_id', conversation_id)
  .order('created_at', { ascending: false })
  .limit(10)

console.log(`\n=== JOBS FOR CONVERSATION (${jobs?.length || 0} jobs) ===`)
jobs?.forEach((job: any) => {
  console.log(`- [${job.job_type}] state=${job.state} created=${job.created_at} error=${job.error || 'none'}`)
})

// Check edge function logs
const { data: edgeLogs } = await supabase
  .from('edge_function_logs')
  .select('id, function_name, status, duration_ms, error_message, created_at')
  .eq('request_id', request_id)
  .order('created_at', { ascending: false })

console.log(`\n=== EDGE FUNCTION LOGS (request_id=${request_id}) ===`)
if (edgeLogs?.length) {
  edgeLogs.forEach((log: any) => {
    console.log(`- [${log.function_name}] ${log.status} (${log.duration_ms}ms) ${log.error_message || ''}`)
  })
} else {
  console.log('No edge function logs found')
}

// Check AI turn logs
const { data: aiTurns } = await supabase
  .from('ai_turn_logs')
  .select('id, response_type, prompt_tokens, completion_tokens, latency_ms, created_at')
  .eq('request_id', request_id)

console.log(`\n=== AI TURN LOGS (request_id=${request_id}) ===`)
if (aiTurns?.length) {
  aiTurns.forEach((turn: any) => {
    console.log(`- [${turn.response_type}] tokens=${turn.prompt_tokens}+${turn.completion_tokens} latency=${turn.latency_ms}ms`)
  })
} else {
  console.log('No AI turn logs found')
}

// Check outbox for this conversation
const { data: outbox } = await supabase
  .from('outbox')
  .select('id, action, target, payload, state, error_message, created_at')
  .eq('aggregate_id', conversation_id)
  .order('created_at', { ascending: false })
  .limit(10)

console.log(`\n=== OUTBOX DELIVERIES (${outbox?.length || 0} rows) ===`)
outbox?.forEach((row: any) => {
  console.log(`- [${row.action}→${row.target}] state=${row.state} error=${row.error_message || 'none'} created=${row.created_at}`)
})

// Check for any assistant responses
const { data: assistantMessages } = await supabase
  .from('messages')
  .select('id, role, content, created_at')
  .eq('conversation_id', conversation_id)
  .eq('role', 'assistant')
  .order('created_at', { ascending: false })
  .limit(1)

console.log(`\n=== LATEST ASSISTANT RESPONSE ===`)
if (assistantMessages?.length) {
  const latest = assistantMessages[0]
  console.log(`Created: ${latest.created_at}`)
  console.log(`Content: ${latest.content}`)
} else {
  console.log('No assistant response found — THIS IS THE PROBLEM!')
}

console.log('\n=== DIAGNOSIS ===')
if (!assistantMessages?.length) {
  console.log('❌ No assistant message in conversation after the latest user message')
  console.log('\nPossible issues:')
  console.log('1. turn.integrity job failed to process')
  console.log('2. turn.integrity decision was "hold" or "reject"')
  console.log('3. turn.process job enqueued but failed')
  console.log('4. twilio.reply outbox delivery failed')
  console.log('\nCheck jobs list above for failed jobs.')
  console.log('Check outbox list for twilio.reply with state=error.')
}
