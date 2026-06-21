// ── Domain types shared across all pages ────────────────────────────────────

export interface Customer {
  id: string
  phone: string
  name: string | null
  business_id: string
  created_at: string
  updated_at: string | null
}

export interface Conversation {
  id: string
  customer_id: string
  business_id: string
  status: string
  current_state: string | null
  summary: string | null
  conversation_history?: unknown[] | null
  created_at: string
  last_message_at: string | null
  // joined
  customers?: Pick<Customer, 'id' | 'name' | 'phone'> | null
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | string
  content: string
  embedding: unknown | null
  embedding_model: string | null
  twilio_message_sid: string | null
  created_at: string
}

export interface AiTurnLog {
  id: string
  conversation_id: string
  customer_id: string | null
  request_id: string | null
  response_type: string | null
  total_tokens: number | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  cost_usd: number | null
  latency_ms: number | null
  products_referenced: unknown[] | null
  retrieval_score: number | null
  tier2_used: boolean | null
  tier3_used: boolean | null
  created_at: string
}

export interface SecurityLog {
  id: string
  conversation_id: string | null
  customer_id: string | null
  request_id: string | null
  event_type: string
  failure_category: string | null
  affected_scope: string | null
  details: Record<string, unknown> | null
  created_at: string
}

export interface EdgeFunctionLog {
  id: string
  function_name: string
  status: 'ok' | 'error' | string
  duration_ms: number | null
  error_message: string | null
  request_id: string | null
  created_at: string
}

export interface CustomerFacts {
  preferences?: string[]
  dislikes?: string[]
  typical_order?: string | null
  allergies?: string[]
  notes?: string | null
}

export interface CustomerPreferences {
  customer_id: string
  facts: CustomerFacts | null
  total_transactions: number | null
  avg_transaction_value: number | null
  updated_at: string | null
}

export interface ConversationOutcome {
  id: string
  conversation_id: string
  customer_id: string | null
  outcome: string
  turn_count: number | null
  total_cost_usd: number | null
  duration_seconds: number | null
  products_ordered: unknown[] | null
  created_at: string
}
