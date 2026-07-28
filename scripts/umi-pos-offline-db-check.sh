#!/usr/bin/env bash
set -euo pipefail

name="umi-gate2f-db-$RANDOM"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null || {
  echo "Docker is required for the disposable offline database check." >&2
  exit 1
}

docker run --rm -d --name "$name" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=umi_gate2f \
  pgvector/pgvector:pg16 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$name" pg_isready -U postgres -d umi_gate2f >/dev/null 2>&1 &&
    break
  sleep 1
done
docker exec "$name" pg_isready -U postgres -d umi_gate2f >/dev/null

for migration in supabase/migrations/*.sql; do
  docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_gate2f \
    <"$migration" >/dev/null
done

docker exec "$name" psql -v ON_ERROR_STOP=1 -U postgres -d umi_gate2f <<'SQL'
do $$
declare missing integer;
begin
  select count(*) into missing
  from (values
    ('pos_offline_policy'),('pos_offline_cash_policy'),('device_replay_cursor'),
    ('offline_replay_command'),('offline_reconciliation'),
    ('offline_replay_conflict'),('offline_provisional_mapping')
  ) expected(name)
  where not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='tenant' and c.relname=expected.name
      and c.relrowsecurity and c.relforcerowsecurity
  );
  if missing <> 0 then raise exception 'Gate 2F RLS/FORCE RLS check failed'; end if;
  if pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid='tenant.offline_replay_command'::regclass
      and conname='offline_replay_command_command_type_check'
  )) not like '%pos.checkout.cash%' then
    raise exception 'Offline cash command constraint missing';
  end if;
  if exists (
    select 1
    from (values
      ('device_replay_cursor'),('offline_replay_command'),
      ('offline_reconciliation'),('offline_replay_conflict'),
      ('offline_provisional_mapping')
    ) expected(name)
    where not exists (
      select 1 from pg_policies p
      where p.schemaname='tenant' and p.tablename=expected.name
        and p.qual like '%current_branch%' and p.qual like '%current_device%'
        and p.qual not like '%current_branch() IS NULL%'
        and p.qual not like '%current_device() IS NULL%'
    )
  ) then
    raise exception 'Fail-closed branch/device RLS predicate missing';
  end if;
end $$;
SQL

echo "Gate 2F disposable migration and RLS metadata validation passed."
