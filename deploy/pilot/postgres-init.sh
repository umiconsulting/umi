#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${UMIPOS_DB_APP_PASSWORD:?UMIPOS_DB_APP_PASSWORD is required}"
: "${UMIPOS_DB_WORKER_PASSWORD:?UMIPOS_DB_WORKER_PASSWORD is required}"

bash /workspace/docs/migration/build-v3/00_run.sh "$POSTGRES_DB"

psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set app_password="$UMIPOS_DB_APP_PASSWORD" \
  --set worker_password="$UMIPOS_DB_WORKER_PASSWORD" <<'SQL'
select format('create role %I login inherit password %L', 'umi_api_login', :'app_password')
where not exists (select 1 from pg_roles where rolname = 'umi_api_login') \gexec
select format('create role %I login inherit password %L', 'umi_worker_login', :'worker_password')
where not exists (select 1 from pg_roles where rolname = 'umi_worker_login') \gexec

alter role umi_api_login password :'app_password';
alter role umi_worker_login password :'worker_password';
alter role umi_api_login nobypassrls;
alter role umi_worker_login bypassrls;
grant api to umi_api_login;
grant worker to umi_worker_login;
alter role umi_api_login set log_statement = 'none';
alter role umi_api_login set log_min_duration_statement = -1;
alter role umi_api_login set log_parameter_max_length = 0;
alter role umi_worker_login set log_statement = 'none';
alter role umi_worker_login set log_min_duration_statement = -1;
alter role umi_worker_login set log_parameter_max_length = 0;
SQL

touch /var/lib/postgresql/data/.umipos-init-complete
