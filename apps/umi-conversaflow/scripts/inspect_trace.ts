const traceId = Deno.args[0];
if (!traceId) throw new Error("Usage: deno run ... scripts/inspect_trace.ts <trace_id>");

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const schema = Deno.env.get("DB_SCHEMA") ??
  Deno.env.get("SUPABASE_DB_SCHEMA") ?? "conversaflow";
if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Accept-Profile": schema,
};

async function rest(path: string) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
  return await res.json();
}

const traces = await rest(
  `pipeline_traces?trace_id=eq.${traceId}&select=trace_id,turn_id,stage,event,error,detail,ts&order=ts.asc`,
);
const turnId = traces[0]?.turn_id;
const turns = turnId
  ? await rest(
    `conversation_turns?id=eq.${turnId}&select=id,merged_user_text,integrity_reason,reconciled_action,extracted_intent,status`,
  )
  : [];
const logs = await rest(
  `ai_turn_logs?request_id=eq.${traceId}&select=request_id,response_type,metadata`,
);

console.log(JSON.stringify({ traces, turns, logs }, null, 2));
