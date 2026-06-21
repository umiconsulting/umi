\pset format unaligned
\pset tuples_only on

\echo SECTION:message_counts
select
  count(*) as total_messages,
  count(*) filter (where role = 'user') as user_messages,
  count(*) filter (where role = 'assistant') as assistant_messages,
  count(*) filter (where embedding is not null) as embedded_messages,
  count(*) filter (where embedding is null) as missing_embeddings,
  min(created_at) as first_message_at,
  max(created_at) as last_message_at
from conversaflow.messages;

\echo SECTION:embedding_coverage_by_role
select
  role,
  count(*) as total,
  count(*) filter (where embedding is not null) as embedded,
  count(*) filter (where embedding is null) as missing,
  round(
    100.0 * count(*) filter (where embedding is not null) / nullif(count(*), 0),
    2
  ) as embedded_pct,
  string_agg(distinct coalesce(embedding_model, 'NULL'), ', ' order by coalesce(embedding_model, 'NULL')) as models
from conversaflow.messages
group by role
order by total desc;

\echo SECTION:embedding_dimensions
select
  role,
  embedding_model,
  vector_dims(embedding) as dims,
  count(*) as total
from conversaflow.messages
where embedding is not null
group by role, embedding_model, vector_dims(embedding)
order by total desc;

\echo SECTION:customer_fact_coverage
select
  count(*) as preference_rows,
  count(*) filter (where facts is not null and facts <> '{}'::jsonb) as rows_with_facts,
  count(*) filter (where jsonb_array_length(coalesce(facts->'preferences', '[]'::jsonb)) > 0) as rows_with_preferences,
  count(*) filter (where jsonb_array_length(coalesce(facts->'dislikes', '[]'::jsonb)) > 0) as rows_with_dislikes,
  count(*) filter (where coalesce(facts->>'typical_order', '') <> '') as rows_with_typical_order,
  count(*) filter (where jsonb_array_length(coalesce(facts->'allergies', '[]'::jsonb)) > 0) as rows_with_allergies
from conversaflow.customer_preferences;

\echo SECTION:conversation_distribution
select
  count(*) as conversations,
  percentile_cont(0.5) within group (order by message_count) as p50_messages,
  percentile_cont(0.75) within group (order by message_count) as p75_messages,
  percentile_cont(0.9) within group (order by message_count) as p90_messages,
  max(message_count) as max_messages
from (
  select conversation_id, count(*) as message_count
  from conversaflow.messages
  group by conversation_id
) counts;

\echo SECTION:user_message_pattern_counts
with user_messages as (
  select lower(unaccent(content)) as text
  from conversaflow.messages
  where role = 'user'
)
select pattern, count(*) as hits
from (
  select 'greeting' as pattern from user_messages where text ~ '\m(hola|buenas|buenos dias|buenas tardes|hey)\M'
  union all
  select 'menu_browse' from user_messages where text ~ '\m(menu|menú|que tienes|qué tienes|opciones|recomienda|recomendacion|recomendación)\M'
  union all
  select 'vague_food_or_mood' from user_messages where text ~ '\m(algo|antojo|dulce|frio|frío|caliente|comer|bebida|postre|rico|ligero|pesado)\M'
  union all
  select 'add_or_order' from user_messages where text ~ '\m(quiero|dame|agrega|pon|ordena|pedido|orden|llevo|me das|me puedes dar)\M'
  union all
  select 'variant_detail' from user_messages where text ~ '\m(grande|gde|chico|chica|ch|caliente|frio|fría|rocas|hielo|avena|coco|almendra|deslactosada|soya|leche)\M'
  union all
  select 'confirmation' from user_messages where text ~ '\m(si|sí|simon|confirmo|confirmar|ok|va|sale|listo|perfecto|jalo)\M'
  union all
  select 'negative_or_revision' from user_messages where text ~ '\m(no|mejor|quita|cambia|cámbialo|elimina|borra|sin|corrijo|equivoque|equivoqué)\M'
  union all
  select 'cancel_order' from user_messages where text ~ '\m(cancelar|cancela|cancelo|cancelen)\M'
  union all
  select 'hours_or_location' from user_messages where text ~ '\m(horario|abren|cierran|abierto|ubicacion|ubicación|direccion|dirección|donde|dónde)\M'
  union all
  select 'payment' from user_messages where text ~ '\m(pago|pagar|tarjeta|efectivo|transferencia|terminal)\M'
  union all
  select 'repeat_order' from user_messages where text ~ '\m(lo mismo|siempre|ultima|última|repetir|otra vez|igual)\M'
  union all
  select 'preference_or_allergy' from user_messages where text ~ '\m(gusta|prefiero|recuerda|acuerdate|acuérdate|intolerante|alergia|alergico|alérgico|sin lactosa|lactosa)\M'
  union all
  select 'complaint_or_issue' from user_messages where text ~ '\m(mal|problema|tardo|tardó|equivocado|frio|frío|falto|faltó|queja)\M'
) patterns
group by pattern
order by hits desc;

\echo SECTION:pipeline_trace_top_events
select
  stage,
  event,
  coalesce(error, '') as error,
  count(*) as hits,
  max(ts) as last_seen
from conversaflow.pipeline_traces
where ts >= now() - interval '45 days'
group by stage, event, coalesce(error, '')
order by hits desc, last_seen desc
limit 40;

\echo SECTION:pipeline_trace_issue_details
select
  stage,
  event,
  coalesce(detail->>'reason', detail->>'error', detail->>'job_type', '') as detail_key,
  coalesce(error, '') as error,
  count(*) as hits,
  max(ts) as last_seen
from conversaflow.pipeline_traces
where ts >= now() - interval '45 days'
  and (
    error is not null
    or event in ('failed', 'superseded', 'skipped')
    or detail ? 'error'
    or detail ? 'reason'
  )
group by stage, event, coalesce(detail->>'reason', detail->>'error', detail->>'job_type', ''), coalesce(error, '')
order by hits desc, last_seen desc
limit 60;

\echo SECTION:job_failures
select
  job_type,
  state,
  coalesce(error, '') as error,
  count(*) as hits,
  max(created_at) as last_seen
from conversaflow.jobs
where created_at >= now() - interval '45 days'
  and (state <> 'completed' or error is not null)
group by job_type, state, coalesce(error, '')
order by hits desc, last_seen desc
limit 60;

\echo SECTION:outbox_failures
select
  kind,
  state,
  coalesce(error, '') as error,
  count(*) as hits,
  max(created_at) as last_seen
from conversaflow.outbox
where created_at >= now() - interval '45 days'
  and (state <> 'delivered' or error is not null)
group by kind, state, coalesce(error, '')
order by hits desc, last_seen desc
limit 60;

\echo SECTION:ai_tool_chains_recent
with logs as (
  select
    id,
    created_at,
    conversation_id,
    response_type,
    prompt_version,
    metadata,
    coalesce(metadata->>'processor_version', metadata->'metrics'->>'processor_version', '') as processor_version,
    coalesce(metadata->>'stop_reason', '') as stop_reason,
    metadata->'tool_chain' as tool_chain
  from conversaflow.ai_turn_logs
  where created_at >= now() - interval '45 days'
)
select
  logs.created_at,
  logs.response_type,
  logs.prompt_version,
  logs.processor_version,
  logs.stop_reason,
  coalesce(
    (
      select string_agg(coalesce(item->>'name', item->>'tool'), ' -> ')
      from jsonb_array_elements(
        case
          when jsonb_typeof(logs.tool_chain) = 'array' then logs.tool_chain
          when jsonb_typeof(logs.tool_chain) = 'object' and (logs.tool_chain ? 'excerpt') then '[]'::jsonb
          else '[]'::jsonb
        end
      ) item
    ),
    ''
  ) as tools,
  left(regexp_replace(coalesce(user_msg.content, ''), '\s+', ' ', 'g'), 180) as preceding_user_message
from logs
left join lateral (
  select content
  from conversaflow.messages m
  where m.conversation_id = logs.conversation_id
    and m.role = 'user'
    and m.created_at <= logs.created_at
  order by m.created_at desc
  limit 1
) user_msg on true
order by logs.created_at desc
limit 200;

\echo SECTION:user_message_examples_by_pattern
with user_messages as (
  select
    id,
    conversation_id,
    created_at,
    lower(unaccent(content)) as text,
    left(regexp_replace(content, '\s+', ' ', 'g'), 220) as excerpt
  from conversaflow.messages
  where role = 'user'
),
classified as (
  select 'menu_browse' as pattern, created_at, excerpt from user_messages where text ~ '\m(menu|menú|que tienes|qué tienes|opciones|recomienda|recomendacion|recomendación)\M'
  union all select 'vague_food_or_mood', created_at, excerpt from user_messages where text ~ '\m(algo|antojo|dulce|frio|frío|caliente|comer|bebida|postre|rico|ligero|pesado)\M'
  union all select 'add_or_order', created_at, excerpt from user_messages where text ~ '\m(quiero|dame|agrega|pon|ordena|pedido|orden|llevo|me das|me puedes dar)\M'
  union all select 'variant_detail', created_at, excerpt from user_messages where text ~ '\m(grande|gde|chico|chica|ch|caliente|frio|fría|rocas|hielo|avena|coco|almendra|deslactosada|soya|leche)\M'
  union all select 'negative_or_revision', created_at, excerpt from user_messages where text ~ '\m(no|mejor|quita|cambia|cámbialo|elimina|borra|sin|corrijo|equivoque|equivoqué)\M'
  union all select 'cancel_order', created_at, excerpt from user_messages where text ~ '\m(cancelar|cancela|cancelo|cancelen)\M'
  union all select 'hours_or_location', created_at, excerpt from user_messages where text ~ '\m(horario|abren|cierran|abierto|ubicacion|ubicación|direccion|dirección|donde|dónde)\M'
  union all select 'payment', created_at, excerpt from user_messages where text ~ '\m(pago|pagar|tarjeta|efectivo|transferencia|terminal)\M'
  union all select 'repeat_order', created_at, excerpt from user_messages where text ~ '\m(lo mismo|siempre|ultima|última|repetir|otra vez|igual)\M'
  union all select 'preference_or_allergy', created_at, excerpt from user_messages where text ~ '\m(gusta|prefiero|recuerda|acuerdate|acuérdate|intolerante|alergia|alergico|alérgico|sin lactosa|lactosa)\M'
  union all select 'complaint_or_issue', created_at, excerpt from user_messages where text ~ '\m(mal|problema|tardo|tardó|equivocado|frio|frío|falto|faltó|queja)\M'
)
select pattern, excerpt
from (
  select
    pattern,
    excerpt,
    row_number() over (partition by pattern order by created_at desc) as rn
  from classified
) ranked
where rn <= 8
order by pattern, rn;

\echo SECTION:customer_fact_examples
select
  customer_id,
  left(facts::text, 500) as facts_excerpt
from conversaflow.customer_preferences
where facts is not null
  and facts <> '{}'::jsonb
order by updated_at desc
limit 30;
