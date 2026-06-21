\pset format unaligned
\pset tuples_only on

drop table if exists audit_messages_export;
create temporary table audit_messages_export as
select
  m.id,
  m.conversation_id,
  m.role,
  m.created_at,
  m.embedding is not null as has_embedding,
  coalesce(m.embedding_model, '') as embedding_model,
  left(regexp_replace(m.content, '\s+', ' ', 'g'), 500) as content_excerpt
from conversaflow.messages m
order by m.created_at desc;

\copy audit_messages_export to 'reports/mini-harness-message-audit/messages.tsv' with (format csv, delimiter E'\t', header true);

drop table if exists audit_ai_tool_chains_export;
create temporary table audit_ai_tool_chains_export as
select
  l.created_at,
  l.conversation_id,
  l.response_type,
  l.prompt_version,
  coalesce(l.metadata->>'processor_version', l.metadata->'metrics'->>'processor_version', '') as processor_version,
  coalesce(l.metadata->>'stop_reason', '') as stop_reason,
  coalesce(
    (
      select string_agg(coalesce(item->>'name', item->>'tool'), ' -> ')
      from jsonb_array_elements(
        case
          when jsonb_typeof(l.metadata->'tool_chain') = 'array' then l.metadata->'tool_chain'
          else '[]'::jsonb
        end
      ) item
    ),
    ''
  ) as tools,
  left(regexp_replace(coalesce(user_msg.content, ''), '\s+', ' ', 'g'), 500) as preceding_user_message
from conversaflow.ai_turn_logs l
left join lateral (
  select content
  from conversaflow.messages m
  where m.conversation_id = l.conversation_id
    and m.role = 'user'
    and m.created_at <= l.created_at
  order by m.created_at desc
  limit 1
) user_msg on true
order by l.created_at desc;

\copy audit_ai_tool_chains_export to 'reports/mini-harness-message-audit/ai_tool_chains.tsv' with (format csv, delimiter E'\t', header true);

\echo SECTION:user_message_pattern_counts
with user_messages as (
  select
    lower(
      translate(
        content,
        'áéíóúÁÉÍÓÚñÑ',
        'aeiouAEIOUnN'
      )
    ) as text
  from conversaflow.messages
  where role = 'user'
)
select pattern, count(*) as hits
from (
  select 'greeting' as pattern from user_messages where text ~ '\m(hola|buenas|buenos dias|buenas tardes|hey|que rollo|q rollo)\M'
  union all
  select 'menu_browse' from user_messages where text ~ '\m(menu|que tienes|opciones|recomienda|recomendacion|variantes|manejan|hay|tienes)\M'
  union all
  select 'vague_food_or_mood' from user_messages where text ~ '\m(algo|antojo|dulce|frio|caliente|comer|bebida|postre|rico|ligero|pesado|monchoso)\M'
  union all
  select 'add_or_order' from user_messages where text ~ '\m(quiero|dame|agrega|agregame|pon|ponme|ordena|pedido|orden|llevo|me das|me puedes dar)\M'
  union all
  select 'variant_detail' from user_messages where text ~ '\m(grande|gde|chico|chica|ch|caliente|frio|rocas|hielo|avena|coco|almendra|deslactosada|soya|leche)\M'
  union all
  select 'confirmation' from user_messages where text ~ '\m(si|sii|simon|confirmo|confirmar|ok|va|sale|listo|perfecto|jalo)\M'
  union all
  select 'negative_or_revision' from user_messages where text ~ '\m(no|mejor|quita|cambia|cambialo|elimina|borra|sin|corrijo|equivoque|olvida|nuevo)\M'
  union all
  select 'cancel_order' from user_messages where text ~ '\m(cancelar|cancela|cancelo|cancelen)\M'
  union all
  select 'hours_or_location' from user_messages where text ~ '\m(horario|abren|cierran|abierto|ubicacion|direccion|donde)\M'
  union all
  select 'payment' from user_messages where text ~ '\m(pago|pagar|tarjeta|efectivo|transferencia|terminal)\M'
  union all
  select 'repeat_order' from user_messages where text ~ '\m(lo mismo|siempre|ultima|repetir|otra vez|igual)\M'
  union all
  select 'preference_or_allergy' from user_messages where text ~ '\m(gusta|prefiero|recuerda|acuerdate|intolerante|alergia|alergico|sin lactosa|lactosa)\M'
  union all
  select 'complaint_or_issue' from user_messages where text ~ '\m(mal|problema|tardo|tardo|equivocado|frio|falto|queja|molesto|contestes|contestas)\M'
) patterns
group by pattern
order by hits desc;

\echo SECTION:export_counts
select
  (select count(*) from audit_messages_export) as exported_messages,
  (select count(*) from audit_ai_tool_chains_export) as exported_ai_turn_logs;
