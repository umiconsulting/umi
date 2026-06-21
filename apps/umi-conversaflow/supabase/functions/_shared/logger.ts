import { getSupabaseClient } from "./supabase.ts";

// ── Structured log helper (OBS-01) ──────────────────────────────────────────
// All console output is JSON for machine parseability. The Supabase log viewer
// will show the raw JSON; the dashboard's logsApi.ts can parse it as JSON
// and fall back to text for legacy events.

export function slog(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields }),
  );
}

// ── PII utility (SEC-04) ────────────────────────────────────────────────────
// Phone numbers must never appear in raw logs. Use a stable 8-char hex prefix
// of their SHA-256 hash as a loggable, correlatable, non-reversible ID.

export async function hashPhone(phone: string): Promise<string> {
  const data = new TextEncoder().encode(phone);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Log interfaces ───────────────────────────────────────────────────────────

export interface EdgeFunctionLog {
  function_name: string;
  status: "success" | "error";
  duration_ms?: number;
  error_message?: string;
  error_stack?: string;
  metadata?: Record<string, unknown>;
  request_id?: string; // OBS-02
}

export interface AiTurnLog {
  conversation_id?: string;
  customer_id?: string;
  business_id?: string;
  model: string;
  prompt_version?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;
  response_type?: string;
  products_referenced?: unknown[];
  customer_context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  request_id?: string; // OBS-02
}

export interface EmbeddingLog {
  message_id: string;
  model: string;
  success: boolean;
  latency_ms: number;
  error_message?: string;
  request_id?: string;
}

export interface EvalTraceLog {
  conversation_id: string;
  turn_id?: string;
  business_id?: string;
  turn_sequence?: number;
  authoritative_decision?: Record<string, unknown> | null;
  harness_decision?: Record<string, unknown> | null;
  agreement?: boolean | null;
  metadata?: Record<string, unknown> | null;
}

// ── Log writers ──────────────────────────────────────────────────────────────

export async function logEdgeFunction(data: EdgeFunctionLog): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.from("edge_function_logs").insert(data);
}

export async function logAiTurn(data: AiTurnLog): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("ai_turn_logs").insert(data);
  if (error) {
    slog("warn", "ai_turn_log_insert_failed", {
      conversation_id: data.conversation_id ?? null,
      business_id: data.business_id ?? null,
      request_id: data.request_id ?? null,
      response_type: data.response_type ?? null,
      error: error.message,
      code: error.code,
    });
  }
}

export async function logSecurityEvent(
  phone: string,
  eventType: string,
  inputText: string,
  details?: string,
  requestId?: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase
    .from("security_logs")
    .insert({
      // SEC-04: store the raw phone only in the security_logs table which has
      // restricted access. Console logs must use hashPhone() instead.
      phone,
      event_type: eventType,
      input_text: inputText.substring(0, 500),
      details: details ?? null,
      timestamp: new Date().toISOString(),
      request_id: requestId ?? null,
    });
}

// ── Pipeline trace ───────────────────────────────────────────────────────────
// One row per stage event. Gives a single-query view of a message's full
// lifecycle: inbound → integrity → process → dispatch.
//
// trace_id = request_id from whatsapp-handler, propagated through every stage
// (job payload and twilio.reply outbox payload) so delivery failures can be
// traced back to the original inbound webhook instantly.

export interface PipelineTrace {
  trace_id: string;
  conversation_id?: string;
  turn_id?: string;
  business_id?: string;
  stage: "inbound" | "integrity" | "process" | "dispatch";
  event: string;
  detail?: Record<string, unknown>;
  error?: string;
}

export async function logPipelineTrace(data: PipelineTrace): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("pipeline_traces").insert({
    trace_id: data.trace_id,
    conversation_id: data.conversation_id ?? null,
    turn_id: data.turn_id ?? null,
    business_id: data.business_id ?? null,
    stage: data.stage,
    event: data.event,
    detail: data.detail ?? null,
    error: data.error ?? null,
  });
  if (error) {
    slog("warn", "pipeline_trace_insert_failed", {
      trace_id: data.trace_id,
      stage: data.stage,
      event: data.event,
      error: error.message,
    });
  }
}

export async function logEmbedding(data: EmbeddingLog): Promise<void> {
  // OBS-04: Store embedding operation metrics for quality monitoring.
  // Uses edge_function_logs.metadata to avoid a new table migration.
  const supabase = getSupabaseClient();
  await supabase
    .from("edge_function_logs")
    .insert({
      function_name: "embedding",
      status: data.success ? "success" : "error",
      duration_ms: data.latency_ms,
      error_message: data.error_message ?? null,
      metadata: { message_id: data.message_id, model: data.model },
      request_id: data.request_id ?? null,
    });
}

export async function logEvalTrace(data: EvalTraceLog): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("eval_traces").insert({
    conversation_id: data.conversation_id,
    turn_id: data.turn_id ?? null,
    business_id: data.business_id ?? null,
    turn_sequence: data.turn_sequence ?? null,
    authoritative_decision: data.authoritative_decision ?? null,
    harness_decision: data.harness_decision ?? null,
    agreement: data.agreement ?? null,
    metadata: data.metadata ?? null,
  });
  if (error) {
    slog("warn", "eval_trace_insert_failed", {
      conversation_id: data.conversation_id,
      turn_id: data.turn_id ?? null,
      error: error.message,
    });
  }
}
