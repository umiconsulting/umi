\pset format unaligned
\pset tuples_only on

\echo SECTION:missing_embedding_examples
select
  role,
  created_at,
  left(regexp_replace(content, '\s+', ' ', 'g'), 220) as excerpt
from conversaflow.messages
where embedding is null
order by created_at desc
limit 40;

\echo SECTION:user_embedding_model_counts
select
  coalesce(embedding_model, 'NULL') as embedding_model,
  embedding is not null as has_embedding,
  count(*) as hits
from conversaflow.messages
where role = 'user'
group by coalesce(embedding_model, 'NULL'), embedding is not null
order by hits desc;

\echo SECTION:customer_fact_shape
select
  count(*) filter (where facts->'preferences' is not null) as preference_key,
  count(*) filter (where facts->'dislikes' is not null) as dislikes_key,
  count(*) filter (where facts->>'typical_order' is not null) as typical_order_key,
  count(*) filter (where facts->'allergies' is not null) as allergies_key,
  count(*) filter (where facts->>'notes' is not null) as notes_key
from conversaflow.customer_preferences
where facts is not null and facts <> '{}'::jsonb;
