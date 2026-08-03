#!/usr/bin/env bash
# ============================================================================
# umi-pos-db-check — prove the POS half of build-v3 isolates and cannot be edited.
#
# Applies the whole build-v3 DDL to a DISPOSABLE database, then asserts the
# properties that a POS makes load-bearing and that a passing schema build does
# not by itself demonstrate:
#
#   1. merchant isolation          one café cannot see another's rows
#   2. location narrowing          NULL location = every location (the dashboard read)
#   3. device scoping FAILS      no proven device -> zero rows, never "all rows"
#      CLOSED
#   4. append-only               the request path cannot edit or delete history
#   5. audit hash chain          every event links to its predecessor
#   6. replay authority          a revoked device, a rotated credential, an ended
#                                shift or a missing permission each stop an
#                                offline command AT THE DATABASE
#
# Checks 3 and 6 are the reason this script exists. On the source location those
# policies were inert: the API never set app.current_device and the POS
# repositories ran on the BYPASSRLS pool, so nothing ever evaluated them. A
# policy nobody executes is a comment.
#
#   usage: scripts/umi-pos-db-check.sh
#          PGHOST/PGPORT/PGUSER as usual; needs CREATEDB.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DDL="$ROOT/docs/migration/build-v3"
DB="umi_pos_check_$$"

if ! command -v psql >/dev/null 2>&1; then
  command -v docker >/dev/null 2>&1 || {
    echo "PostgreSQL client or Docker is required for the POS database check." >&2
    exit 1
  }
  CONTAINER="umi-pos-db-check-$RANDOM"
  docker_cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
  trap docker_cleanup EXIT
  docker run --rm -d --name "$CONTAINER" \
    -e POSTGRES_PASSWORD=postgres \
    -v "$ROOT:$ROOT" -w "$ROOT" \
    pgvector/pgvector:pg16 >/dev/null
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null
  docker exec -e PGHOST=/var/run/postgresql -e PGUSER=postgres "$CONTAINER" \
    bash "$ROOT/scripts/umi-pos-db-check.sh"
  exit $?
fi

fail=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }

cleanup() { psql -q -c "drop database if exists $DB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

q() { psql -X -q -t -A -d "$DB" "$@" 2>&1; }

# Run SQL as the RLS-confined `api` role with a given (merchant, location, device)
# request context, exactly as pg.service.ts sets it per transaction.
as_api() {
  local merchant="$1" location="$2" device="$3" sql="$4"
  psql -X -q -t -A -d "$DB" \
    -c "set role api;" \
    -c "select set_config('app.current_merchant','$merchant',false),
               set_config('app.current_location','$location',false),
               set_config('app.current_device','$device',false);" \
    -c "$sql" 2>&1 | tail -1
}

# Same, but returns the FULL output. An error message is several lines and psql puts
# CONTEXT last, so `tail -1` hides the ERROR line the assertion is looking for.
as_api_raw() {
  local merchant="$1" location="$2" device="$3" sql="$4"
  psql -X -q -t -A -d "$DB" \
    -c "set role api;" \
    -c "select set_config('app.current_merchant','$merchant',false),
               set_config('app.current_location','$location',false),
               set_config('app.current_device','$device',false);" \
    -c "$sql" 2>&1
}

expect() {  # expect <label> <expected> <actual>
  if [ "$2" = "$3" ]; then pass "$1"; else bad "$1 (expected '$2', got '$3')"; fi
}
expect_error() {  # expect_error <label> <output>
  case "$2" in *ERROR*) pass "$1";; *) bad "$1 (no error raised; got '$2')";; esac
}

echo "== building a disposable build-v3 in $DB =="
psql -q -c "create database $DB;" >/dev/null
for f in 00_foundation 10_umi 20_merchant 30_runtime 30_device_pairing 31_pos_sale 32_pos_checkout 33_pos_cash 50_cross_schema_fk 60_triggers 90_rls 99_verify; do
  if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DDL/$f.sql" >/dev/null 2>&1; then
    echo "  DDL FAILED at $f:"
    psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DDL/$f.sql" 2>&1 | grep -E 'ERROR|LINE' | head -5
    exit 1
  fi
done
echo "  applied"

A=a0000000-0000-4000-8000-000000000001   # café A
B=b0000000-0000-4000-8000-000000000001   # café B
A1=a1000000-0000-4000-8000-000000000001  # A · Centro
A2=a1000000-0000-4000-8000-000000000002  # A · Norte
D1=ad000000-0000-4000-8000-000000000001  # A · Centro · till
D2=ad000000-0000-4000-8000-000000000002  # A · Norte  · till
U1=a5000000-0000-4000-8000-000000000001
S1=a6000000-0000-4000-8000-000000000001
SE=a7000000-0000-4000-8000-000000000001  # durable session
OS=a8000000-0000-4000-8000-000000000001  # operator session

psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<SQL
insert into merchant.merchant (id,name) values ('$A','Cafe A'),('$B','Cafe B');
insert into merchant.location (id,merchant_id,name) values
  ('$A1','$A','A-Centro'), ('$A2','$A','A-Norte'),
  ('b1000000-0000-4000-8000-000000000001','$B','B-Centro');
insert into merchant.device (id,merchant_id,location_id,name,kind,status,credential_version) values
  ('$D1','$A','$A1','Till 1','pos_terminal','active',1),
  ('$D2','$A','$A2','Till 2','pos_terminal','active',1);
insert into umi.user (id,email,full_name,status) values ('$U1','till\@cafe-a.test','Cashier','active');
insert into umi.role (key,name,is_platform) values ('staff','Staff',false)
  on conflict (key) do nothing;
insert into merchant.staff (id,merchant_id,location_id,user_id,role_id,name)
  values ('$S1','$A','$A1','$U1',(select id from umi.role where key='staff'),'Cashier');
insert into runtime.session (id,merchant_id,principal_type,principal_id,token_hash)
  values ('$SE','$A','device','$D1','hash-1');
insert into runtime.operator_session
  (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,state,permissions,expires_at)
  values ('$OS','$SE','$U1','$S1','$D1','$A','$A1','active','{offline.replay}', now() + interval '8 hours');
insert into merchant.device_replay_cursor (merchant_id,location_id,device_id,credential_version) values
  ('$A','$A1','$D1',1), ('$A','$A2','$D2',1);
SQL
echo "  seeded 2 cafés / 3 locations / 2 devices / 1 operator session"

echo
echo "== 1. merchant isolation =="
expect "café A sees its own devices"            "2" "$(as_api "$A" "" "" 'select count(*) from merchant.device;')"
expect "café B sees none of café A's devices"   "0" "$(as_api "$B" "" "" 'select count(*) from merchant.device;')"
expect "no merchant context sees nothing"       "0" "$(as_api ""   "" "" 'select count(*) from merchant.device;')"

echo
echo "== 2. location narrowing (NULL = every location) =="
# Tested on business_command, which is location-scoped but NOT device-scoped. Testing it
# on a replay table would measure device scoping instead: with a device set, the
# device policy correctly narrows to that one device whatever the location is.
as_api "$A" "" "" "insert into merchant.business_command
  (merchant_id,location_id,command_id,idempotency_key,command_type,fingerprint,status,correlation_id,completed_at)
  values ('$A','$A1',gen_random_uuid(),'k-1','pos.checkout',repeat('a',64),'succeeded','x',now()),
         ('$A','$A2',gen_random_uuid(),'k-2','pos.checkout',repeat('b',64),'succeeded','y',now());" >/dev/null
expect "no location set: sees both locations"      "2" "$(as_api "$A" ""   "" 'select count(*) from merchant.business_command;')"
expect "location A1 set: sees only A1"            "1" "$(as_api "$A" "$A1" "" 'select count(*) from merchant.business_command;')"
expect "location A2 set: sees only A2"            "1" "$(as_api "$A" "$A2" "" 'select count(*) from merchant.business_command;')"

echo
echo "== 3. device scoping FAILS CLOSED =="
expect "no device context: zero replay rows"    "0" "$(as_api "$A" "$A1" ""    'select count(*) from merchant.device_replay_cursor;')"
expect "wrong device: zero replay rows"         "0" "$(as_api "$A" "$A1" "$D2" 'select count(*) from merchant.device_replay_cursor;')"
expect "wrong location: zero replay rows"         "0" "$(as_api "$A" "$A2" "$D1" 'select count(*) from merchant.device_replay_cursor;')"
expect "café B holding A's device: zero rows"   "0" "$(as_api "$B" "$A1" "$D1" 'select count(*) from merchant.device_replay_cursor;')"

echo
echo "== 4. append-only history =="
as_api "$A" "" "" "insert into merchant.audit_event (merchant_id,event_type,entity_type,outcome,correlation_id)
  values ('$A','sale.committed','order','success','c-1'),('$A','sale.refunded','order','success','c-2');" >/dev/null
expect_error "api cannot UPDATE an audit event" "$(as_api_raw "$A" "" "" "update merchant.audit_event set outcome='denied';")"
expect_error "api cannot DELETE an audit event" "$(as_api_raw "$A" "" "" 'delete from merchant.audit_event;')"

echo
echo "== 5. audit hash chain =="
expect "every event links to its predecessor" "PASS" \
  "$(as_api "$A" "" "" "with o as (select previous_hash, lag(event_hash) over (order by occurred_at,id) exp
      from merchant.audit_event where merchant_id='$A')
    select case when count(*) filter (where previous_hash is distinct from exp)=0 then 'PASS' else 'FAIL' end from o;")"
expect "the first event of a merchant is genesis" "1" \
  "$(as_api "$A" "" "" "select count(*) from merchant.audit_event where previous_hash is null;")"

echo
echo "== 6. offline replay authority (defence in depth, at the database) =="
cmd() {  # cmd <command_id> <device> <credential_version> <operator_session> <location>
  as_api_raw "$A" "$A1" "$2" "insert into merchant.offline_replay_command
    (merchant_id,location_id,device_id,credential_version,device_sequence,command_id,
     operator_session_id,idempotency_key,command_type,fingerprint,contract_version,
     schema_version,client_created_at,result)
    values ('$A','$5','$2',$3,$6,'$1','$4',gen_random_uuid(),'operational.ack',
      repeat('a',64),'2.0.0',1, now(), '{}'::jsonb);"
}
OK=$(cmd "c0000000-0000-4000-8000-000000000001" "$D1" 1 "$OS" "$A1" 1)
case "$OK" in *ERROR*) bad "a valid command is accepted ($OK)";; *) pass "a valid command is accepted";; esac

expect_error "rotated credential is refused" \
  "$(cmd "c0000000-0000-4000-8000-000000000002" "$D1" 2 "$OS" "$A1" 2)"
expect_error "wrong location is refused" \
  "$(cmd "c0000000-0000-4000-8000-000000000003" "$D1" 1 "$OS" "$A2" 3)"

psql -X -q -d "$DB" -c "update runtime.operator_session set permissions='{}' where id='$OS';" >/dev/null
expect_error "operator without offline.replay is refused" \
  "$(cmd "c0000000-0000-4000-8000-000000000004" "$D1" 1 "$OS" "$A1" 4)"
psql -X -q -d "$DB" -c "update runtime.operator_session set permissions='{offline.replay}' where id='$OS';" >/dev/null

psql -X -q -d "$DB" -c "update merchant.device set status='revoked', revoked_at=now() where id='$D1';" >/dev/null
expect_error "revoked device is refused" \
  "$(cmd "c0000000-0000-4000-8000-000000000005" "$D1" 1 "$OS" "$A1" 5)"

echo
echo "== 7. revoking a device ends its sessions in the same statement =="
expect "durable session is no longer active" "f" \
  "$(q -c "select is_active from runtime.session where id='$SE';")"
expect "operator session is ended"         "ended" \
  "$(q -c "select state from runtime.operator_session where id='$OS';")"

echo
if [ "$fail" -eq 0 ]; then
  echo "umi-pos-db-check: merchant, location, device, append-only, audit-chain and replay-authority checks passed."
else
  echo "umi-pos-db-check: FAILURES above."
fi
exit "$fail"
