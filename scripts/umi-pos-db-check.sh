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
DB="${UMI_POS_DB_NAME:-umi_pos_check_$$}"

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

cleanup() {
  if [ "${UMI_POS_DB_KEEP:-0}" != "1" ]; then
    psql -q -c "drop database if exists $DB;" >/dev/null 2>&1 || true
  fi
}
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
               set_config('app.current_device','$device',false),
               set_config('app.user_id','$U1',false);" \
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
               set_config('app.current_device','$device',false),
               set_config('app.user_id','$U1',false);" \
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
for f in 00_foundation 10_umi 20_merchant 30_runtime 30_device_pairing 31_pos_sale 32_pos_checkout 33_pos_cash 34_pos_exception 35_pos_pilot_rbac 36_pos_inventory 37_pos_customer_value 38_pos_customer_value_closeout 39_pos_customer_value_final_closeout 40_pos_hardware_runtime 41_pos_hardware_pilot 42_pos_kitchen 43_dashboard_administrative_commands 44_dashboard_operational_wiring 45_pilot_runtime 50_cross_schema_fk 60_triggers 90_rls 99_verify; do
  if ! ddl_output=$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DDL/$f.sql" 2>&1); then
    echo "  DDL FAILED at $f:"
    printf '%s\n' "$ddl_output" | grep -E 'ERROR|LINE' | head -5
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

q -c "create role inventory_api_login inherit; grant api to inventory_api_login;" >/dev/null
q -c "create role customer_value_worker_login inherit; grant worker to customer_value_worker_login;" >/dev/null

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
echo "== 8. Gate 3D exception isolation and immutability =="
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<SQL
update merchant.device set status='active',revoked_at=null where id='$D1';
update runtime.session set is_active=true,revoked_at=null where id='$SE';
update runtime.operator_session
set state='active',ended_at=null,expires_at=now()+interval '8 hours' where id='$OS';
insert into merchant.pos_exception_policy
  (merchant_id,location_id,version,currency,refunds_enabled,voids_enabled,
   refund_window_minutes,void_window_minutes,expires_at,fingerprint)
values
  ('$A','$A1','gate-3d-a','MXN',true,true,1440,60,now()+interval '1 day',repeat('a',64)),
  ('$B','b1000000-0000-4000-8000-000000000001','gate-3d-b','MXN',true,false,1440,0,
   now()+interval '1 day',repeat('b',64));

insert into merchant.product (id,merchant_id,name,price,sku)
values ('d3000000-0000-4000-8000-000000000001','$A','Refund source',1000,'REF-1');
insert into merchant.pos_cart
  (id,merchant_id,location_id,operator_session_id,status,lifecycle_state,version,business_date,
   original_operator_session_id,original_operator_user_id,operator_user_id)
values ('d3000000-0000-4000-8000-000000000002','$A','$A1','$OS','committed','committed',1,
  current_date,'$OS','$U1','$U1');
insert into merchant.pos_cart_line
  (id,merchant_id,cart_id,product_id,identity_key,product_name,quantity,base_price,tax_rate_basis_points)
values ('d3000000-0000-4000-8000-000000000003','$A',
  'd3000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001',
  repeat('c',64),'Refund source',1,1000,0);
insert into merchant.customer_order
  (id,merchant_id,location_id,source,fulfillment_type,status,business_date,external_ref)
values ('d3000000-0000-4000-8000-000000000004','$A','$A1','pos','dine_in','completed',
  current_date,'gate-3d-check');
insert into merchant.pos_payment_attempt
  (id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,query_only,correlation_id)
values ('d3000000-0000-4000-8000-000000000005','$A','$A1',
  'd3000000-0000-4000-8000-000000000002','cash',1000,'MXN','succeeded',false,'gate-3d-pay');
insert into merchant.receipt_snapshot
  (id,merchant_id,location_id,order_id,payment_attempt_id,receipt_number,business_date,currency,
   grand_total,snapshot)
values ('d3000000-0000-4000-8000-000000000006','$A','$A1',
  'd3000000-0000-4000-8000-000000000004','d3000000-0000-4000-8000-000000000005',
  'G3D-1',current_date,'MXN',1000,
  jsonb_build_object('receiptRef','G3D-1','merchantId','$A','locationId','$A1',
    'issuedAt',now(),'businessDate',current_date,'currency','MXN','version',1,
    'subtotal',jsonb_build_object('minorUnits',1000,'currency','MXN'),
    'taxTotal',jsonb_build_object('minorUnits',0,'currency','MXN'),
    'grandTotal',jsonb_build_object('minorUnits',1000,'currency','MXN'),
    'lines',jsonb_build_array(jsonb_build_object(
      'lineRef','d3000000-0000-4000-8000-000000000003','description','Refund source','quantity',1,
      'unitPrice',jsonb_build_object('minorUnits',1000,'currency','MXN'),
      'lineTotal',jsonb_build_object('minorUnits',1000,'currency','MXN'),
      'tax',jsonb_build_object('minorUnits',0,'currency','MXN'),
      'discount',jsonb_build_object('minorUnits',0,'currency','MXN'),
      'tip',jsonb_build_object('minorUnits',0,'currency','MXN')))));
insert into merchant.pos_committed_sale
  (id,merchant_id,location_id,cart_id,order_id,payment_attempt_id,receipt_snapshot_id,totals_fingerprint)
values ('d3000000-0000-4000-8000-000000000007','$A','$A1',
  'd3000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000004',
  'd3000000-0000-4000-8000-000000000005','d3000000-0000-4000-8000-000000000006',repeat('d',64));
insert into merchant.pos_checkout_draft
  (id,merchant_id,location_id,cart_id,operator_session_id,device_id,state,receipt_delivery)
values ('d3000000-0000-4000-8000-000000000008','$A','$A1',
  'd3000000-0000-4000-8000-000000000002','$OS','$D1','completed','{}');
insert into merchant.pos_tender_fact
  (id,merchant_id,location_id,checkout_id,cart_id,position,tender_type,status,
   amount_minor_units,currency,correlation_id,committed_at)
values ('d3000000-0000-4000-8000-000000000009','$A','$A1',
  'd3000000-0000-4000-8000-000000000008','d3000000-0000-4000-8000-000000000002',
  0,'cash','committed',1000,'MXN','gate-3d-tender',now());
update merchant.pos_payment_attempt set tender_id='d3000000-0000-4000-8000-000000000009'
where id='d3000000-0000-4000-8000-000000000005';

insert into merchant.pos_exception_preview
  (id,merchant_id,location_id,sale_id,original_receipt_id,operator_session_id,device_id,
   exception_type,reason_code,selection,line_allocations,tender_allocations,allocation_policy,
   restock_intents,merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,
   total_minor_units,remaining_after_minor_units,currency,approval_required,sale_version,
   exception_version,preview_fingerprint,correlation_id,expires_at)
values ('d3000000-0000-4000-8000-000000000010','$A','$A1',
  'd3000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000006',
  '$OS','$D1','partial_refund','incorrect_item','[]','[]','[]','proportional','[]',
  500,0,0,0,500,500,'MXN',false,1,0,repeat('e',64),'gate-3d-preview',now()+interval '5 minutes');
insert into merchant.pos_sale_exception
  (id,merchant_id,location_id,sale_id,original_receipt_id,preview_id,exception_type,status,
   reason_code,operator_id,operator_session_id,device_id,device_credential_version,
   command_id,idempotency_key,command_fingerprint,preview_fingerprint,
   merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
   currency,business_date,correlation_id)
values ('d3000000-0000-4000-8000-000000000011','$A','$A1',
  'd3000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000006',
  'd3000000-0000-4000-8000-000000000010','partial_refund','committed','incorrect_item',
  '$U1','$OS','$D1',1,'d3000000-0000-4000-8000-000000000012',
  'd3000000-0000-4000-8000-000000000013',repeat('f',64),repeat('e',64),
  500,0,0,0,500,'MXN',current_date,'gate-3d-exception');
insert into merchant.pos_sale_exception_line
  (id,merchant_id,location_id,exception_id,sale_id,sale_line_id,original_quantity,
   compensated_quantity,original_merchandise_minor_units,original_tax_minor_units,
   original_discount_minor_units,original_tip_minor_units,original_total_minor_units,
   merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
   currency,restock_decision)
values ('d3000000-0000-4000-8000-000000000014','$A','$A1','d3000000-0000-4000-8000-000000000011',
  'd3000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000003',
  1,1,1000,0,0,0,1000,500,0,0,0,500,'MXN','restock');
insert into merchant.pos_tender_compensation
  (merchant_id,location_id,exception_id,original_tender_id,tender_type,
   amount_minor_units,currency,reversal_status,correlation_id)
values ('$A','$A1','d3000000-0000-4000-8000-000000000011',
  'd3000000-0000-4000-8000-000000000009','cash',500,'MXN','confirmed_success','tender-refund-1');
insert into merchant.pos_exception_receipt
  (merchant_id,location_id,exception_id,original_receipt_id,receipt_number,snapshot,
   business_date,currency,total_minor_units)
values ('$A','$A1','d3000000-0000-4000-8000-000000000011',
  'd3000000-0000-4000-8000-000000000006','G3D-R-1','{}',current_date,'MXN',500);
insert into merchant.business_command
  (merchant_id,location_id,command_id,idempotency_key,command_type,fingerprint,status,
   response_data,correlation_id,completed_at)
values ('$A','$A1','d3000000-0000-4000-8000-000000000012','gate-3d-original',
  'pos.exception.commit',repeat('f',64),'succeeded','{}','gate-3d-command',now());

insert into merchant.pos_exception_preview
  (id,merchant_id,location_id,sale_id,original_receipt_id,operator_session_id,device_id,
   exception_type,reason_code,selection,line_allocations,tender_allocations,terminal_refund_status,
   allocation_policy,restock_intents,merchandise_minor_units,tax_minor_units,
   discount_minor_units,tip_minor_units,total_minor_units,remaining_after_minor_units,currency,
   approval_required,sale_version,exception_version,preview_fingerprint,correlation_id,expires_at)
values ('d3000000-0000-4000-8000-000000000020','$A','$A1',
  'd3000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000006',
  '$OS','$D1','partial_refund','payment_correction','[]','[]','[]','confirmed_success',
  'proportional','[]',1,0,0,0,1,999,'MXN',false,1,1,repeat('1',64),'terminal-preview',
  now()+interval '5 minutes');
insert into merchant.pos_sale_exception
  (id,merchant_id,location_id,sale_id,original_receipt_id,preview_id,exception_type,status,
   reason_code,operator_id,operator_session_id,device_id,device_credential_version,
   command_id,idempotency_key,command_fingerprint,preview_fingerprint,
   merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
   currency,business_date,correlation_id)
values ('d3000000-0000-4000-8000-000000000021','$A','$A1',
  'd3000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000006',
  'd3000000-0000-4000-8000-000000000020','partial_refund','committed','payment_correction',
  '$U1','$OS','$D1',1,'d3000000-0000-4000-8000-000000000022',
  'd3000000-0000-4000-8000-000000000023',repeat('2',64),repeat('1',64),
  1,0,0,0,1,'MXN',current_date,'gate-3d-exception-2');

insert into merchant.pos_exception_preview
  (id,merchant_id,location_id,sale_id,original_receipt_id,operator_session_id,device_id,
   exception_type,reason_code,selection,line_allocations,tender_allocations,allocation_policy,
   restock_intents,merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,
   total_minor_units,remaining_after_minor_units,currency,approval_required,sale_version,
   exception_version,preview_fingerprint,correlation_id,expires_at)
values ('d3000000-0000-4000-8000-000000000030','$A','$A1',
  'd3000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000006',
  '$OS','$D1','partial_refund','product_defect','[]','[]','[]','proportional','[]',
  1,0,0,0,1,998,'MXN',true,1,2,repeat('3',64),'approval-preview',now()+interval '5 minutes');
insert into runtime.elevation_grant
  (id,session_id,merchant_id,location_id,permission_key,method,approved_by,expires_at,
   consumed_at,command_fingerprint,consumed_by_command_id)
values ('d3000000-0000-4000-8000-000000000031','$SE','$A','$A1','sale.refund.approve',
  'manager_approval','$U1',now()+interval '5 minutes',now(),repeat('4',64),
  'd3000000-0000-4000-8000-000000000032');
insert into merchant.pos_sale_exception
  (id,merchant_id,location_id,sale_id,original_receipt_id,preview_id,exception_type,status,
   reason_code,operator_id,operator_session_id,device_id,device_credential_version,approval_id,
   command_id,idempotency_key,command_fingerprint,preview_fingerprint,
   merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
   currency,business_date,correlation_id)
values ('d3000000-0000-4000-8000-000000000033','$A','$A1',
  'd3000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000006',
  'd3000000-0000-4000-8000-000000000030','partial_refund','committed','product_defect',
  '$U1','$OS','$D1',1,'d3000000-0000-4000-8000-000000000031',
  'd3000000-0000-4000-8000-000000000032','d3000000-0000-4000-8000-000000000034',
  repeat('4',64),repeat('3',64),1,0,0,0,1,'MXN',current_date,'approval-exception');

insert into merchant.physical_register
  (id,merchant_id,location_id,display_name,public_reference,currency,assigned_device_id,status)
values ('d3000000-0000-4000-8000-000000000040','$A','$A1','Refund register',
  'REFUND-REGISTER','MXN','$D1','assigned');
insert into merchant.cash_shift
  (id,merchant_id,location_id,register_id,device_id,device_credential_version,
   opening_operator_id,responsible_operator_id,operator_session_id,currency,business_date,status,
   opening_command_id,opening_float_minor_units,ledger_sequence)
values ('d3000000-0000-4000-8000-000000000041','$A','$A1',
  'd3000000-0000-4000-8000-000000000040','$D1',1,'$U1','$U1','$OS','MXN',current_date,
  'open','d3000000-0000-4000-8000-000000000042',2000,0);
update merchant.physical_register
set current_shift_id='d3000000-0000-4000-8000-000000000041',status='in_use'
where id='d3000000-0000-4000-8000-000000000040';
insert into merchant.cash_ledger_entry
  (id,merchant_id,location_id,register_id,shift_id,sequence,entry_type,amount_minor_units,
   currency,command_id,business_date)
values ('d3000000-0000-4000-8000-000000000043','$A','$A1',
  'd3000000-0000-4000-8000-000000000040','d3000000-0000-4000-8000-000000000041',
  1,'opening_float',2000,'MXN','d3000000-0000-4000-8000-000000000042',current_date);
update merchant.cash_shift set ledger_sequence=1,version=version+1
where id='d3000000-0000-4000-8000-000000000041';
insert into merchant.cash_ledger_entry
  (id,merchant_id,location_id,register_id,shift_id,sequence,entry_type,amount_minor_units,
   currency,command_id,sale_id,sale_exception_id,business_date)
values ('d3000000-0000-4000-8000-000000000044','$A','$A1',
  'd3000000-0000-4000-8000-000000000040','d3000000-0000-4000-8000-000000000041',
  2,'cash_refund',500,'MXN','d3000000-0000-4000-8000-000000000012',
  'd3000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000011',current_date);
update merchant.cash_shift set ledger_sequence=2,version=version+1
where id='d3000000-0000-4000-8000-000000000041';
insert into merchant.pos_cash_compensation
  (merchant_id,location_id,exception_id,original_tender_id,current_shift_id,
   current_register_id,ledger_entry_id,amount_minor_units,currency)
values ('$A','$A1','d3000000-0000-4000-8000-000000000011',
  'd3000000-0000-4000-8000-000000000009','d3000000-0000-4000-8000-000000000041',
  'd3000000-0000-4000-8000-000000000040','d3000000-0000-4000-8000-000000000044',500,'MXN');

insert into merchant.pos_cart
  (id,merchant_id,location_id,operator_session_id,status,lifecycle_state,version,business_date,
   original_operator_session_id,original_operator_user_id,operator_user_id)
values ('d3000000-0000-4000-8000-000000000060','$A','$A1','$OS','committed','committed',1,
  current_date,'$OS','$U1','$U1');
insert into merchant.pos_cart_line
  (id,merchant_id,cart_id,product_id,identity_key,product_name,quantity,base_price,tax_rate_basis_points)
values
  ('d3000000-0000-4000-8000-000000000061','$A','d3000000-0000-4000-8000-000000000060',
   'd3000000-0000-4000-8000-000000000001',repeat('6',64),'Legacy first',1,1000,0),
  ('d3000000-0000-4000-8000-000000000062','$A','d3000000-0000-4000-8000-000000000060',
   'd3000000-0000-4000-8000-000000000001',repeat('7',64),'Legacy last',1,1000,0);
insert into merchant.customer_order
  (id,merchant_id,location_id,source,fulfillment_type,status,business_date,external_ref)
values ('d3000000-0000-4000-8000-000000000063','$A','$A1','pos','dine_in','completed',
  current_date,'gate-3d-legacy');
insert into merchant.pos_payment_attempt
  (id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,query_only,correlation_id)
values ('d3000000-0000-4000-8000-000000000064','$A','$A1',
  'd3000000-0000-4000-8000-000000000060','cash',2000,'MXN','succeeded',false,'legacy-pay');
insert into merchant.receipt_snapshot
  (id,merchant_id,location_id,order_id,payment_attempt_id,receipt_number,business_date,currency,
   grand_total,snapshot)
values ('d3000000-0000-4000-8000-000000000065','$A','$A1',
  'd3000000-0000-4000-8000-000000000063','d3000000-0000-4000-8000-000000000064',
  'G3D-LEGACY',current_date,'MXN',2000,
  jsonb_build_object('receiptRef','G3D-LEGACY','currency','MXN',
    'discountTotal',jsonb_build_object('minorUnits',1,'currency','MXN'),
    'tip',jsonb_build_object('minorUnits',1,'currency','MXN'),
    'lines',jsonb_build_array(
      jsonb_build_object('lineRef','d3000000-0000-4000-8000-000000000061','quantity',1,
        'lineTotal',jsonb_build_object('minorUnits',1000,'currency','MXN'),
        'tax',jsonb_build_object('minorUnits',0,'currency','MXN')),
      jsonb_build_object('lineRef','d3000000-0000-4000-8000-000000000062','quantity',1,
        'lineTotal',jsonb_build_object('minorUnits',1000,'currency','MXN'),
        'tax',jsonb_build_object('minorUnits',0,'currency','MXN')))));
insert into merchant.pos_committed_sale
  (id,merchant_id,location_id,cart_id,order_id,payment_attempt_id,receipt_snapshot_id,totals_fingerprint)
values ('d3000000-0000-4000-8000-000000000066','$A','$A1',
  'd3000000-0000-4000-8000-000000000060','d3000000-0000-4000-8000-000000000063',
  'd3000000-0000-4000-8000-000000000064','d3000000-0000-4000-8000-000000000065',repeat('6',64));
insert into merchant.pos_checkout_draft
  (id,merchant_id,location_id,cart_id,operator_session_id,device_id,state,discount_drafts,
   receipt_delivery,payment_summary)
values ('d3000000-0000-4000-8000-000000000067','$A','$A1',
  'd3000000-0000-4000-8000-000000000060','$OS','$D1','completed',
  '[{"lineId":null}]','{}','{"discounts":{"entries":[{"amount":{"minorUnits":1}}]}}');
insert into merchant.pos_exception_preview
  (id,merchant_id,location_id,sale_id,original_receipt_id,operator_session_id,device_id,
   exception_type,reason_code,selection,line_allocations,tender_allocations,allocation_policy,
   restock_intents,merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,
   total_minor_units,remaining_after_minor_units,currency,approval_required,sale_version,
   exception_version,preview_fingerprint,correlation_id,expires_at)
values ('d3000000-0000-4000-8000-000000000068','$A','$A1',
  'd3000000-0000-4000-8000-000000000066','d3000000-0000-4000-8000-000000000065',
  '$OS','$D1','partial_refund','product_defect','[]','[]','[]','proportional','[]',
  2,0,0,0,2,1998,'MXN',false,1,0,repeat('8',64),'legacy-preview',now()+interval '5 minutes');
insert into merchant.pos_sale_exception
  (id,merchant_id,location_id,sale_id,original_receipt_id,preview_id,exception_type,status,
   reason_code,operator_id,operator_session_id,device_id,device_credential_version,
   command_id,idempotency_key,command_fingerprint,preview_fingerprint,
   merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
   currency,business_date,correlation_id)
values ('d3000000-0000-4000-8000-000000000069','$A','$A1',
  'd3000000-0000-4000-8000-000000000066','d3000000-0000-4000-8000-000000000065',
  'd3000000-0000-4000-8000-000000000068','partial_refund','committed','product_defect',
  '$U1','$OS','$D1',1,'d3000000-0000-4000-8000-000000000070',
  'd3000000-0000-4000-8000-000000000071',repeat('7',64),repeat('8',64),
  2,0,0,0,2,'MXN',current_date,'legacy-exception');
insert into merchant.pos_sale_exception_line
  (id,merchant_id,location_id,exception_id,sale_id,sale_line_id,original_quantity,
   compensated_quantity,original_merchandise_minor_units,original_tax_minor_units,
   original_discount_minor_units,original_tip_minor_units,original_total_minor_units,
   merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
   currency,restock_decision)
values
  ('d3000000-0000-4000-8000-000000000072','$A','$A1','d3000000-0000-4000-8000-000000000069',
   'd3000000-0000-4000-8000-000000000066','d3000000-0000-4000-8000-000000000061',
   1,1,1000,0,0,0,1000,1,0,0,0,1,'MXN','restock'),
  ('d3000000-0000-4000-8000-000000000073','$A','$A1','d3000000-0000-4000-8000-000000000069',
   'd3000000-0000-4000-8000-000000000066','d3000000-0000-4000-8000-000000000062',
   1,1,1000,0,1,1,1000,1,0,0,0,1,'MXN','restock');
SQL
expect "merchant A sees only its exception policy" "1" \
  "$(as_api "$A" "$A1" "$D1" 'select count(*) from merchant.pos_exception_policy;')"
expect "merchant B cannot see merchant A exception policy" "1" \
  "$(as_api "$B" "b1000000-0000-4000-8000-000000000001" "" 'select count(*) from merchant.pos_exception_policy;')"
expect "wrong location cannot read the exception policy" "0" \
  "$(as_api "$A" "$A2" "$D2" 'select count(*) from merchant.pos_exception_policy;')"
expect_error "api cannot change exception policy" \
  "$(as_api_raw "$A" "$A1" "$D1" "update merchant.pos_exception_policy set refunds_enabled=false;")"
expect "all Gate 3D tables force RLS" "8" \
  "$(q -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='merchant' and c.relname in ('pos_exception_policy','pos_exception_preview',
      'pos_sale_exception','pos_sale_exception_line','pos_tender_compensation',
      'pos_cash_compensation','pos_restock_intent','pos_exception_receipt')
      and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity;")"
expect "exception rows and previews require the exact device" "2" \
  "$(q -c "select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='merchant'
      and c.relname in ('pos_exception_preview','pos_sale_exception')
      and p.polname='device_scoping';")"
expect "all committed exception facts have append-only triggers" "6" \
  "$(q -c "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='merchant'
      and c.relname in ('pos_sale_exception','pos_sale_exception_line','pos_tender_compensation',
        'pos_cash_compensation','pos_restock_intent','pos_exception_receipt')
      and not t.tgisinternal and t.tgname like '%_append_only';")"
expect "line and tender over-refund guards are installed" "2" \
  "$(q -c "select count(*) from pg_trigger t where t.tgname in
    ('pos_exception_line_limit','pos_tender_compensation_limit') and not t.tgisinternal;")"
expect "legacy one-unit discount and tip use a final-line remainder" "2" \
  "$(q -c "select count(*) from merchant.pos_sale_exception_line
    where exception_id='d3000000-0000-4000-8000-000000000069';")"
expect_error "committed exception rows are append-only" \
  "$(q -c "update merchant.pos_sale_exception set reason_code='pricing_error'
    where id='d3000000-0000-4000-8000-000000000011';")"
expect_error "terminal success cannot become failure or unknown" \
  "$(q -c "update merchant.pos_exception_preview set terminal_refund_status='outcome_unknown'
    where id='d3000000-0000-4000-8000-000000000020';")"
expect_error "preview authority cannot change after creation" \
  "$(q -c "update merchant.pos_exception_preview set approval_required=true
    where id='d3000000-0000-4000-8000-000000000020';")"
expect_error "an approval-required exception cannot omit approval" \
  "$(q -c "insert into merchant.pos_sale_exception
    (merchant_id,location_id,sale_id,original_receipt_id,preview_id,exception_type,status,
     reason_code,operator_id,operator_session_id,device_id,device_credential_version,
     command_id,idempotency_key,command_fingerprint,preview_fingerprint,
     merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
     currency,business_date,correlation_id)
    select merchant_id,location_id,sale_id,original_receipt_id,id,exception_type,'committed',
      reason_code,'$U1','$OS','$D1',1,'d3000000-0000-4000-8000-000000000050',
      'd3000000-0000-4000-8000-000000000051',repeat('5',64),preview_fingerprint,
      merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
      currency,current_date,'missing-approval'
    from merchant.pos_exception_preview where id='d3000000-0000-4000-8000-000000000030';")"
expect_error "a consumed approval cannot be reused" \
  "$(q -c "insert into merchant.pos_sale_exception
    (merchant_id,location_id,sale_id,original_receipt_id,preview_id,exception_type,status,
     reason_code,operator_id,operator_session_id,device_id,device_credential_version,approval_id,
     command_id,idempotency_key,command_fingerprint,preview_fingerprint,
     merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
     currency,business_date,correlation_id)
    values ('$A','$A1','d3000000-0000-4000-8000-000000000007',
      'd3000000-0000-4000-8000-000000000006','d3000000-0000-4000-8000-000000000020',
      'partial_refund','committed','payment_correction','$U1','$OS','$D1',1,
      'd3000000-0000-4000-8000-000000000031','d3000000-0000-4000-8000-000000000052',
      'd3000000-0000-4000-8000-000000000053',repeat('4',64),repeat('1',64),
      1,0,0,0,1,'MXN',current_date,'reused-approval');")"
expect_error "an approval with a different command fingerprint fails" \
  "$(q -c "insert into merchant.pos_sale_exception
    (merchant_id,location_id,sale_id,original_receipt_id,preview_id,exception_type,status,
     reason_code,operator_id,operator_session_id,device_id,device_credential_version,approval_id,
     command_id,idempotency_key,command_fingerprint,preview_fingerprint,
     merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
     currency,business_date,correlation_id)
    select merchant_id,location_id,sale_id,original_receipt_id,id,exception_type,'committed',
      reason_code,'$U1','$OS','$D1',1,'d3000000-0000-4000-8000-000000000031',
      'd3000000-0000-4000-8000-000000000032','d3000000-0000-4000-8000-000000000054',
      repeat('9',64),preview_fingerprint,merchandise_minor_units,tax_minor_units,
      discount_minor_units,tip_minor_units,total_minor_units,currency,current_date,'wrong-fingerprint'
    from merchant.pos_exception_preview where id='d3000000-0000-4000-8000-000000000030';")"
expect_error "cash compensation must match the current shift ledger fact" \
  "$(q -c "insert into merchant.cash_ledger_entry
    (id,merchant_id,location_id,register_id,shift_id,sequence,entry_type,amount_minor_units,
     currency,command_id,sale_id,sale_exception_id,business_date)
    values ('d3000000-0000-4000-8000-000000000055','$A','$A1',
      'd3000000-0000-4000-8000-000000000040','d3000000-0000-4000-8000-000000000041',
      3,'cash_refund',1,'MXN','d3000000-0000-4000-8000-000000000056',
      'd3000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000021',current_date);
    update merchant.cash_shift set ledger_sequence=3,version=version+1
      where id='d3000000-0000-4000-8000-000000000041';
    insert into merchant.pos_cash_compensation
      (merchant_id,location_id,exception_id,original_tender_id,current_shift_id,
       current_register_id,ledger_entry_id,amount_minor_units,currency)
    values ('$A','$A1','d3000000-0000-4000-8000-000000000021',
      'd3000000-0000-4000-8000-000000000009','d3000000-0000-4000-8000-000000000041',
      'd3000000-0000-4000-8000-000000000040','d3000000-0000-4000-8000-000000000055',2,'MXN');")"
expect_error "the line guard rejects caller-supplied original amounts" \
  "$(q -c "insert into merchant.pos_sale_exception_line
    (merchant_id,location_id,exception_id,sale_id,sale_line_id,original_quantity,
     compensated_quantity,original_merchandise_minor_units,original_tax_minor_units,
     original_discount_minor_units,original_tip_minor_units,original_total_minor_units,
     merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
     currency,restock_decision)
    values ('$A','$A1','d3000000-0000-4000-8000-000000000021',
      'd3000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000003',
      1,1,999,0,0,0,999,1,0,0,0,1,'MXN','restock');")"
expect_error "cumulative line compensation cannot exceed the receipt quantity" \
  "$(q -c "insert into merchant.pos_sale_exception_line
    (merchant_id,location_id,exception_id,sale_id,sale_line_id,original_quantity,
     compensated_quantity,original_merchandise_minor_units,original_tax_minor_units,
     original_discount_minor_units,original_tip_minor_units,original_total_minor_units,
     merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,
     currency,restock_decision)
    values ('$A','$A1','d3000000-0000-4000-8000-000000000021',
      'd3000000-0000-4000-8000-000000000007','d3000000-0000-4000-8000-000000000003',
      1,1,1000,0,0,0,1000,1,0,0,0,1,'MXN','restock');")"
expect_error "cumulative tender compensation cannot exceed the original tender" \
  "$(q -c "insert into merchant.pos_tender_compensation
    (merchant_id,location_id,exception_id,original_tender_id,tender_type,
     amount_minor_units,currency,reversal_status,correlation_id)
    values ('$A','$A1','d3000000-0000-4000-8000-000000000021',
      'd3000000-0000-4000-8000-000000000009','cash',600,'MXN',
      'confirmed_success','tender-refund-2');")"
expect_error "the original committed sale is immutable" \
  "$(q -c "update merchant.pos_committed_sale set totals_fingerprint=repeat('9',64)
    where id='d3000000-0000-4000-8000-000000000007';")"
expect_error "the original receipt is immutable" \
  "$(q -c "update merchant.receipt_snapshot set grand_total=1
    where id='d3000000-0000-4000-8000-000000000006';")"
expect_error "the compensating receipt is immutable" \
  "$(q -c "update merchant.pos_exception_receipt set total_minor_units=1
    where exception_id='d3000000-0000-4000-8000-000000000011';")"
expect_error "a duplicate command identity is rejected" \
  "$(q -c "insert into merchant.business_command
    (merchant_id,location_id,command_id,idempotency_key,command_type,fingerprint,status,
     correlation_id,completed_at)
    values ('$A','$A1','d3000000-0000-4000-8000-000000000012','gate-3d-duplicate',
      'pos.exception.commit',repeat('2',64),'succeeded','duplicate',now());")"
expect "wrong device cannot read an exception preview" "0" \
  "$(as_api "$A" "$A1" "$D2" "select count(*) from merchant.pos_exception_preview
    where id='d3000000-0000-4000-8000-000000000020';")"

echo
echo "== 9. Gate 3D.1 pilot RBAC =="
expect "all pilot business roles exist" "7" \
  "$(q -c "select count(*) from umi.role where key in
    ('owner','admin','manager','supervisor','cashier','staff','viewer') and not is_platform;")"
expect "super_admin remains platform-only" "t" \
  "$(q -c "select is_platform from umi.role where key='super_admin';")"
expect "Cashier receives the exact reviewed grant count" "48" \
  "$(q -c "select count(*) from umi.role_permission rp join umi.role r on r.id=rp.role_id
    where r.key='cashier';")"
expect "Supervisor receives the exact reviewed grant count" "85" \
  "$(q -c "select count(*) from umi.role_permission rp join umi.role r on r.id=rp.role_id
    where r.key='supervisor';")"
expect "Manager receives the exact reviewed grant count" "122" \
  "$(q -c "select count(*) from umi.role_permission rp join umi.role r on r.id=rp.role_id
    where r.key='manager';")"
expect "Viewer receives no mutation permission" "0" \
  "$(q -c "select count(*) from umi.role_permission rp
    join umi.role r on r.id=rp.role_id join umi.permission p on p.id=rp.permission_id
    where r.key='viewer' and p.key in
      ('cart.write','checkout.commit','cash.shift.open','sale.refund.partial');")"
expect "Cashier receives no approval or administration permission" "0" \
  "$(q -c "select count(*) from umi.role_permission rp
    join umi.role r on r.id=rp.role_id join umi.permission p on p.id=rp.permission_id
    where r.key='cashier' and p.key in
      ('merchant.manage','device.enroll','checkout.discount.approve',
       'cash.movement.paid_in.approve','cash.movement.paid_out.approve',
       'cash.movement.safe_drop.approve','cash.shift.close.approve',
       'cash.variance.approve','sale.refund.approve');")"
expect "Supervisor cannot approve sensitive cash, variance, or refund actions" "0" \
  "$(q -c "select count(*) from umi.role_permission rp
    join umi.role r on r.id=rp.role_id join umi.permission p on p.id=rp.permission_id
    where r.key='supervisor' and p.key in
      ('cash.movement.paid_in.approve','cash.movement.paid_out.approve',
       'cash.movement.safe_drop.approve','cash.shift.close.approve',
       'cash.variance.approve','sale.refund.approve');")"
expect "Manager receives command-specific cash approval permissions" "4" \
  "$(q -c "select count(*) from umi.role_permission rp
    join umi.role r on r.id=rp.role_id join umi.permission p on p.id=rp.permission_id
    where r.key='manager' and p.key in
      ('cash.movement.paid_in.approve','cash.movement.paid_out.approve',
       'cash.movement.safe_drop.approve','cash.shift.close.approve');")"
expect "the role grant table contains no duplicate edge" "0" \
  "$(q -c "select count(*) from (
    select role_id,permission_id from umi.role_permission
    group by role_id,permission_id having count(*)>1
  ) duplicate_grant;")"
expect "Staff resolves the complete normal Cashier journey" "0" \
  "$(q -c "with required(key) as (values
      ('catalog.read'),('cart.write'),('sale.lifecycle'),('checkout.commit'),
      ('cash.register.use'),('cash.shift.open'),('cash.movement.paid_in'),
      ('cash.count.submit'),('cash.reconcile'),('cash.shift.close'))
    select count(*) from required
    where key<>all(umi.resolve_staff_permissions('$S1'::uuid));")"
expect "Staff resolves no administration or approval authority" "0" \
  "$(q -c "select count(*) from unnest(umi.resolve_staff_permissions('$S1'::uuid)) key
    where key in ('merchant.manage','device.enroll','cash.variance.approve',
      'cash.movement.paid_out.approve','sale.refund.approve');")"

echo
echo "== 10. Gate 3E inventory authority =="
IL=e3000000-0000-4000-8000-000000000001
II=e3000000-0000-4000-8000-000000000002
II_LAST=e3000000-0000-4000-8000-000000000012
II_OVERRIDE=e3000000-0000-4000-8000-000000000016
PRODUCT_A=e3000000-0000-4000-8000-000000000017
PRODUCT_B=e3000000-0000-4000-8000-000000000018
II_COMPONENT=e3000000-0000-4000-8000-000000000031
C1=e3000000-0000-4000-8000-000000000003
C2=e3000000-0000-4000-8000-000000000004
C3=e3000000-0000-4000-8000-000000000005
q -c "insert into merchant.inventory_location
  (id,merchant_id,location_id,public_reference,display_name,location_type)
  values ('$IL','$A','$A1','STOCK-MAIN','Main stock','business_location');
insert into merchant.inventory_item
  (id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale,
   tracking_policy,negative_stock_policy,reservation_required,low_stock_threshold)
  values ('$II','$A','ITEM-COFFEE','Coffee bag','physical_product','unit',0,
    'reservation_required','block',true,2);
insert into merchant.inventory_item
  (id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale,
   tracking_policy,negative_stock_policy,reservation_required,low_stock_threshold)
  values ('$II_LAST','$A','ITEM-LAST','Last unit','physical_product','unit',0,
    'reservation_required','block',true,1);
insert into merchant.inventory_item
  (id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale,
   tracking_policy,negative_stock_policy,reservation_required,low_stock_threshold)
  values ('$II_OVERRIDE','$A','ITEM-OVERRIDE','Override unit','physical_product','unit',0,
    'reservation_required','manager_override',true,1);
insert into merchant.inventory_item
  (id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale,
   tracking_policy,negative_stock_policy,reservation_required,low_stock_threshold)
  values ('$II_COMPONENT','$A','ITEM-COMPONENT','Recipe component','ingredient','gram',0,
    'reservation_required','block',true,2);
insert into merchant.product(id,merchant_id,name,price,active)
  values ('$PRODUCT_A','$A','Scoped A',100,true),('$PRODUCT_B','$B','Scoped B',100,true);
insert into merchant.inventory_policy
  (merchant_id,location_id,inventory_location_id,version,adjustment_approval_threshold,
   waste_approval_threshold,count_variance_tolerance,fingerprint)
  values ('$A','$A1','$IL','pilot-3e',5,2,1,repeat('a',64));
select merchant.append_stock_ledger('$A','$A1','$IL','$II','opening_balance',10,
  '$C1','$C1',repeat('1',64),'opening_balance','$C1','$U1','$D1',1,current_date,
  'gate-3e-opening',null,null,null,null,'{}'::jsonb);
select merchant.append_stock_ledger('$A','$A1','$IL','$II','reservation_created',3,
  '$C2','$C2',repeat('2',64),'reservation','$C2','$U1','$D1',1,current_date,
  'gate-3e-reserve',null,null,null,null,'{}'::jsonb);
select merchant.append_stock_ledger('$A','$A1','$IL','$II','reservation_released',3,
  '$C3','$C3',repeat('3',64),'reservation','$C2','$U1','$D1',1,current_date,
  'gate-3e-release',null,null,null,null,'{}'::jsonb);
select merchant.append_stock_ledger('$A','$A1','$IL','$II_LAST','opening_balance',1,
  'e3000000-0000-4000-8000-000000000013','e3000000-0000-4000-8000-000000000013',
  repeat('5',64),'opening_balance','e3000000-0000-4000-8000-000000000013','$U1','$D1',1,
  current_date,'gate-3e-last-unit',null,null,null,null,'{}'::jsonb);
select merchant.append_stock_ledger('$A','$A1','$IL','$II_OVERRIDE','opening_balance',1,
  'e3000000-0000-4000-8000-000000000019','e3000000-0000-4000-8000-000000000019',
  repeat('6',64),'opening_balance','e3000000-0000-4000-8000-000000000019','$U1','$D1',1,
  current_date,'gate-3e-override',null,null,null,null,'{}'::jsonb);" >/dev/null
expect "ledger facts reproduce the stock balance" "10|0|10|3" \
  "$(q -c "select on_hand,reserved,available,ledger_sequence from merchant.stock_balance
    where inventory_location_id='$IL' and inventory_item_id='$II';")"
expect "an idempotent replay returns the original ledger fact" "1" \
  "$(q -c "select sequence from merchant.append_stock_ledger(
    '$A','$A1','$IL','$II','opening_balance',10,'$C1','$C1',repeat('1',64),
    'opening_balance','$C1','$U1','$D1',1,current_date,'gate-3e-opening',
    null,null,null,null,'{}'::jsonb);")"
expect "an idempotent replay creates no duplicate stock fact" "3" \
  "$(q -c "select count(*) from merchant.stock_ledger_entry
    where inventory_location_id='$IL' and inventory_item_id='$II';")"
q -c "insert into merchant.inventory_catalog_mapping(
    id,merchant_id,product_id,mapping_type,inventory_item_id,version)
  values('e3000000-0000-4000-8000-000000000021','$A',
    'd3000000-0000-4000-8000-000000000001','direct','$II',1);
insert into merchant.inventory_reservation(
    id,merchant_id,location_id,cart_id,status,cart_version,line_snapshot,expires_at,
    inventory_location_id,command_id,command_fingerprint)
  values('e3000000-0000-4000-8000-000000000022','$A','$A1',
    'd3000000-0000-4000-8000-000000000002','active',1,'[]',now()-interval '1 minute',
    '$IL','e3000000-0000-4000-8000-000000000024',repeat('8',64));
insert into merchant.inventory_reservation_line(
    id,merchant_id,location_id,reservation_id,inventory_location_id,inventory_item_id,
    sale_line_id,required_quantity,quantity_scale,unit,mapping_id,mapping_version,
    availability_sequence)
  values('e3000000-0000-4000-8000-000000000023','$A','$A1',
    'e3000000-0000-4000-8000-000000000022','$IL','$II',
    'd3000000-0000-4000-8000-000000000003',2,0,'unit',
    'e3000000-0000-4000-8000-000000000021',1,3);
select merchant.append_stock_ledger('$A','$A1','$IL','$II','reservation_created',2,
    'e3000000-0000-4000-8000-000000000024','e3000000-0000-4000-8000-000000000024',
    repeat('8',64),'inventory_reservation','e3000000-0000-4000-8000-000000000022',
    '$U1','$D1',1,current_date,'gate-3e-expiry',null,
    'd3000000-0000-4000-8000-000000000003',null,null,'{}'::jsonb);
select merchant.expire_inventory_reservations('$A','$A1');" >/dev/null
expect "expired reservation releases availability exactly once" "expired|0|1" \
  "$(q -c "select r.status,b.reserved,
      (select count(*) from merchant.stock_ledger_entry where
        source_aggregate_id=r.id and entry_type='reservation_expired')
    from merchant.inventory_reservation r join merchant.stock_balance b
      on b.inventory_location_id=r.inventory_location_id and b.inventory_item_id='$II'
    where r.id='e3000000-0000-4000-8000-000000000022';")"
expect "a second expiry sweep creates no duplicate release" "0|1" \
  "$(q -c "select merchant.expire_inventory_reservations('$A','$A1'),
    (select count(*) from merchant.stock_ledger_entry
      where source_aggregate_id='e3000000-0000-4000-8000-000000000022'
        and entry_type='reservation_expired');")"
q -c "insert into merchant.inventory_reservation(
    id,merchant_id,location_id,cart_id,status,cart_version,line_snapshot,expires_at,
    inventory_location_id,command_id,command_fingerprint)
  values('e3000000-0000-4000-8000-000000000025','$A','$A1',
    'd3000000-0000-4000-8000-000000000060','active',1,'[]',now()+interval '10 minutes',
    '$IL','e3000000-0000-4000-8000-000000000027',repeat('9',64));
insert into merchant.inventory_reservation_line(
    id,merchant_id,location_id,reservation_id,inventory_location_id,inventory_item_id,
    sale_line_id,required_quantity,quantity_scale,unit,mapping_id,mapping_version,
    availability_sequence)
  values('e3000000-0000-4000-8000-000000000026','$A','$A1',
    'e3000000-0000-4000-8000-000000000025','$IL','$II',
    'd3000000-0000-4000-8000-000000000061',2,0,'unit',
    'e3000000-0000-4000-8000-000000000021',1,5);
select merchant.append_stock_ledger('$A','$A1','$IL','$II','reservation_created',2,
    'e3000000-0000-4000-8000-000000000027','e3000000-0000-4000-8000-000000000027',
    repeat('9',64),'inventory_reservation','e3000000-0000-4000-8000-000000000025',
    '$U1','$D1',1,current_date,'gate-3e-commit-reservation',null,
    'd3000000-0000-4000-8000-000000000061',null,null,'{}'::jsonb);
select merchant.commit_sale_inventory('e3000000-0000-4000-8000-000000000025',
    'd3000000-0000-4000-8000-000000000066','e3000000-0000-4000-8000-000000000028',
    '$U1','$D1',1,current_date,'gate-3e-sale-commit');" >/dev/null
expect "sale inventory commit consumes a reservation exactly once" "committed|8|0|2|1" \
  "$(q -c "select r.status,b.on_hand,b.reserved,b.committed,
      (select count(*) from merchant.stock_ledger_entry where
        sale_id='d3000000-0000-4000-8000-000000000066' and entry_type='sale_committed')
    from merchant.inventory_reservation r join merchant.stock_balance b
      on b.inventory_location_id=r.inventory_location_id and b.inventory_item_id='$II'
    where r.id='e3000000-0000-4000-8000-000000000025';")"
expect_error "Block policy rejects negative stock" \
  "$(q -c "select merchant.append_stock_ledger('$A','$A1','$IL','$II','adjustment_decrease',11,
    'e3000000-0000-4000-8000-000000000006','e3000000-0000-4000-8000-000000000006',
    repeat('4',64),'adjustment','e3000000-0000-4000-8000-000000000006','$U1','$D1',1,
    current_date,'gate-3e-negative',null,null,null,null,'{}'::jsonb);")"
expect_error "ManagerOverride rejects negative stock without a bound approval" \
  "$(q -c "select merchant.append_stock_ledger('$A','$A1','$IL','$II_OVERRIDE',
    'adjustment_decrease',2,'e3000000-0000-4000-8000-000000000020',
    'e3000000-0000-4000-8000-000000000020',repeat('7',64),'adjustment',
    'e3000000-0000-4000-8000-000000000020','$U1','$D1',1,current_date,
    'gate-3e-negative-override',null,null,null,null,'{}'::jsonb);")"
expect_error "a catalog mapping cannot reference another merchant product" \
  "$(q -c "insert into merchant.inventory_catalog_mapping(
    merchant_id,product_id,mapping_type,inventory_item_id,version)
    values('$A','$PRODUCT_B','direct','$II',1);")"
expect_error "stock ledger update fails" \
  "$(q -c "update merchant.stock_ledger_entry set quantity=9 where command_id='$C1';")"
expect_error "stock ledger delete fails" \
  "$(q -c "delete from merchant.stock_ledger_entry where command_id='$C1';")"
expect_error "api cannot insert a ledger fact directly" \
  "$(as_api_raw "$A" "$A1" "$D1" "insert into merchant.stock_ledger_entry(
    merchant_id,location_id,inventory_location_id,inventory_item_id,sequence,entry_type,
    quantity,quantity_scale,unit,command_id,idempotency_key,command_fingerprint,
    source_aggregate_type,source_aggregate_id,operator_id,device_id,credential_version,
    business_date,correlation_id) values ('$A','$A1','$IL','$II',99,'adjustment_increase',
    1,0,'unit',gen_random_uuid(),gen_random_uuid(),repeat('9',64),'direct_write',gen_random_uuid(),
    '$U1','$D1',1,current_date,'direct-write');")"
expect_error "api cannot update the balance projection directly" \
  "$(as_api_raw "$A" "$A1" "$D1" "update merchant.stock_balance set on_hand=999
    where inventory_location_id='$IL' and inventory_item_id='$II';")"
expect "readonly cannot execute the ledger or projection authority" "f|f" \
  "$(q -c "select
    has_function_privilege('readonly','merchant.append_stock_ledger(uuid,uuid,uuid,uuid,text,bigint,uuid,uuid,text,text,uuid,uuid,uuid,integer,date,text,uuid,uuid,uuid,uuid,jsonb)','execute'),
    has_function_privilege('readonly','merchant.rebuild_stock_balance(uuid,uuid)','execute');")"
expect_error "api cannot append stock without request scope" \
  "$(psql -X -q -t -A -d "$DB" -c "set role api" -c "select merchant.append_stock_ledger(
    '$A','$A1','$IL','$II','adjustment_increase',1,gen_random_uuid(),gen_random_uuid(),
    repeat('8',64),'scope-test',gen_random_uuid(),'$U1','$D1',1,current_date,'scope-test',
    null,null,null,null,'{}'::jsonb);" 2>&1)"
expect_error "api cannot rebuild a projection without request scope" \
  "$(psql -X -q -t -A -d "$DB" -c "set role api" \
    -c "select merchant.rebuild_stock_balance('$IL','$II');" 2>&1)"
expect_error "an inherited API login cannot append stock without request scope" \
  "$(psql -X -q -t -A -d "$DB" -c "set session authorization inventory_api_login" \
    -c "select merchant.append_stock_ledger(
      '$A','$A1','$IL','$II','adjustment_increase',1,gen_random_uuid(),gen_random_uuid(),
      repeat('8',64),'scope-test',gen_random_uuid(),'$U1','$D1',1,current_date,'scope-test',
      null,null,null,null,'{}'::jsonb);" 2>&1)"
expect_error "a scoped function cannot post into another location" \
  "$(as_api_raw "$A" "$A2" "$D2" "select merchant.append_stock_ledger(
    '$A','$A1','$IL','$II','adjustment_increase',1,gen_random_uuid(),gen_random_uuid(),
    repeat('8',64),'scope-test',gen_random_uuid(),'$U1','$D2',1,current_date,'scope-test',
    null,null,null,null,'{}'::jsonb);")"
expect "another location cannot read the stock ledger" "0" \
  "$(as_api "$A" "$A2" "$D2" "select count(*) from merchant.stock_ledger_entry
    where inventory_item_id='$II';")"
expect "the assigned device reads its location stock ledger" "7" \
  "$(as_api "$A" "$A1" "$D1" "select count(*) from merchant.stock_ledger_entry
    where inventory_item_id='$II';")"

q -c "begin;
select merchant.append_stock_ledger('$A','$A1','$IL','$II','reservation_created',2,
  'e3000000-0000-4000-8000-000000000050','e3000000-0000-4000-8000-000000000050',
  repeat('a',64),'inventory_reservation','e3000000-0000-4000-8000-000000000022',
  '$U1','$D1',1,current_date,'gate-3e-expired-refresh',null,
  'd3000000-0000-4000-8000-000000000003',null,null,'{}'::jsonb);
update merchant.inventory_reservation set status='active',expires_at=now()-interval '1 minute'
  where id='e3000000-0000-4000-8000-000000000022';
select merchant.expire_inventory_reservations('$A','$A1');
insert into merchant.inventory_reservation(
  merchant_id,location_id,cart_id,status,cart_version,line_snapshot,expires_at)
values('$A','$A1','d3000000-0000-4000-8000-000000000002','reserved',1,'[]',
  now()+interval '10 minutes')
on conflict(cart_id) do update set
  status=case when merchant.inventory_reservation.status in ('released','expired')
    then 'reserved' else merchant.inventory_reservation.status end,
  line_snapshot=excluded.line_snapshot,expires_at=excluded.expires_at,updated_at=now();
select merchant.append_stock_ledger('$A','$A1','$IL','$II','reservation_created',2,
  'e3000000-0000-4000-8000-000000000051','e3000000-0000-4000-8000-000000000051',
  repeat('a',64),'inventory_reservation','e3000000-0000-4000-8000-000000000022',
  '$U1','$D1',1,current_date,'gate-3e-rollback',null,
  'd3000000-0000-4000-8000-000000000003',null,null,'{}'::jsonb);
select merchant.commit_sale_inventory('e3000000-0000-4000-8000-000000000022',
  'd3000000-0000-4000-8000-000000000007','e3000000-0000-4000-8000-000000000052',
  '$U1','$D1',1,current_date,'gate-3e-rollback');
rollback;" >/dev/null
expect "expired checkout refresh and rollback leave no inventory effect" "expired|0|0|0" \
  "$(q -c "select r.status,
    (select count(*) from merchant.stock_ledger_entry where command_id=
      'e3000000-0000-4000-8000-000000000050'),
    (select count(*) from merchant.stock_ledger_entry where command_id=
      'e3000000-0000-4000-8000-000000000051'),
    (select count(*) from merchant.stock_ledger_entry where command_id=
      'e3000000-0000-4000-8000-000000000052')
   from merchant.inventory_reservation r
   where r.id='e3000000-0000-4000-8000-000000000022';")"

if ! component_output=$(q -c "select merchant.append_stock_ledger('$A','$A1','$IL','$II_COMPONENT','opening_balance',10,
  'e3000000-0000-4000-8000-000000000034','e3000000-0000-4000-8000-000000000034',
  repeat('b',64),'opening_balance','e3000000-0000-4000-8000-000000000034',
  '$U1','$D1',1,current_date,'gate-3e-component-open',null,null,null,null,'{}'::jsonb);
select merchant.append_stock_ledger('$A','$A1','$IL','$II_COMPONENT','reservation_created',5,
  'e3000000-0000-4000-8000-000000000035','e3000000-0000-4000-8000-000000000035',
  repeat('c',64),'inventory_reservation','e3000000-0000-4000-8000-000000000025',
  '$U1','$D1',1,current_date,'gate-3e-component-reserve',null,
  'd3000000-0000-4000-8000-000000000061',null,null,'{}'::jsonb);
select merchant.append_stock_ledger('$A','$A1','$IL','$II_COMPONENT','sale_committed',5,
  'e3000000-0000-4000-8000-000000000036','e3000000-0000-4000-8000-000000000036',
  repeat('d',64),'pos_sale','d3000000-0000-4000-8000-000000000066',
  '$U1','$D1',1,current_date,'gate-3e-component-sale',
  'd3000000-0000-4000-8000-000000000066','d3000000-0000-4000-8000-000000000061',
  null,null,jsonb_build_object('recipeId','e3000000-0000-4000-8000-000000000037'));
insert into merchant.pos_restock_intent(
  id,merchant_id,location_id,exception_line_id,sale_line_id,quantity,decision,inventory_status)
values('e3000000-0000-4000-8000-000000000038','$A','$A1',
  'd3000000-0000-4000-8000-000000000072','d3000000-0000-4000-8000-000000000061',
  1,'unknown_until_inventory_review','review_required');
select merchant.append_stock_ledger('$A','$A1','$IL','$II','refund_restocked',2,
  'e3000000-0000-4000-8000-000000000039','e3000000-0000-4000-8000-000000000039',
  repeat('e',64),'refund_restock','d3000000-0000-4000-8000-000000000069',
  '$U1','$D1',1,current_date,'gate-3e-restock',
  'd3000000-0000-4000-8000-000000000066','d3000000-0000-4000-8000-000000000061',
  'd3000000-0000-4000-8000-000000000069',null,
  jsonb_build_object('restockIntentId','e3000000-0000-4000-8000-000000000038'));
select merchant.append_stock_ledger('$A','$A1','$IL','$II_COMPONENT','inspection_queued',5,
  'e3000000-0000-4000-8000-000000000039','e3000000-0000-4000-8000-000000000039',
  repeat('e',64),'refund_restock','d3000000-0000-4000-8000-000000000069',
  '$U1','$D1',1,current_date,'gate-3e-inspection',
  'd3000000-0000-4000-8000-000000000066','d3000000-0000-4000-8000-000000000061',
  'd3000000-0000-4000-8000-000000000069',null,
  jsonb_build_object('restockIntentId','e3000000-0000-4000-8000-000000000038'));
insert into merchant.inventory_restock_outcome(
  merchant_id,location_id,restock_intent_id,outcome,command_id,command_fingerprint,
  inventory_location_id,resolved_by)
values('$A','$A1','e3000000-0000-4000-8000-000000000038','component_resolved',
  'e3000000-0000-4000-8000-000000000039',repeat('e',64),'$IL','$U1');"); then
  printf '%s\n' "$component_output" >&2
  exit 1
fi
expect "component restock preserves sellable and inspection states" "10|10|5|5|component_resolved" \
  "$(q -c "select direct.on_hand,component.on_hand,component.quarantine,component.available,o.outcome
   from merchant.stock_balance direct
   join merchant.stock_balance component on component.inventory_location_id=direct.inventory_location_id
    and component.inventory_item_id='$II_COMPONENT'
   join merchant.inventory_restock_outcome o on o.restock_intent_id=
    'e3000000-0000-4000-8000-000000000038'
   where direct.inventory_location_id='$IL' and direct.inventory_item_id='$II';")"
expect_error "a restock intent accepts one terminal outcome" \
  "$(q -c "insert into merchant.inventory_restock_outcome(
    merchant_id,location_id,restock_intent_id,outcome,command_id,command_fingerprint,
    inventory_location_id,resolved_by)
   values('$A','$A1','e3000000-0000-4000-8000-000000000038','restocked',
    gen_random_uuid(),repeat('f',64),'$IL','$U1');")"

q -c "insert into merchant.inventory_count(
  id,merchant_id,location_id,inventory_location_id,public_reference,count_scope,status,
  blind,snapshot_ledger_sequence,snapshot_item_sequences,item_scope,operator_id,
  operator_session_id,device_id,command_id,command_fingerprint)
select 'e3000000-0000-4000-8000-000000000040','$A','$A1','$IL','COUNT-3E-1',
  'selected_items','reconciliation_required',true,ledger_sequence,
  jsonb_build_object('$II',ledger_sequence),array['$II'::uuid],'$U1','$OS','$D1',
  'e3000000-0000-4000-8000-000000000041',repeat('1',64)
from merchant.stock_balance where inventory_location_id='$IL' and inventory_item_id='$II';
insert into merchant.inventory_count_line(
  merchant_id,count_id,inventory_item_id,expected_quantity,counted_quantity,quantity_scale,unit,
  reason_code)
select '$A','e3000000-0000-4000-8000-000000000040','$II',on_hand,on_hand+1,0,'unit',
  'found_stock' from merchant.stock_balance
where inventory_location_id='$IL' and inventory_item_id='$II';
select merchant.append_stock_ledger('$A','$A1','$IL','$II','count_correction',1,
  'e3000000-0000-4000-8000-000000000042','e3000000-0000-4000-8000-000000000042',
  repeat('2',64),'inventory_count','e3000000-0000-4000-8000-000000000040',
  '$U1','$D1',1,current_date,'gate-3e-count',null,null,null,
  'e3000000-0000-4000-8000-000000000040',jsonb_build_object('direction','increase'));
insert into merchant.inventory_reconciliation(
  merchant_id,location_id,count_id,count_attempt,snapshot_ledger_sequence,command_id,
  command_fingerprint,operator_id,summary)
select '$A','$A1',id,attempt,snapshot_ledger_sequence,
  'e3000000-0000-4000-8000-000000000042',repeat('2',64),'$U1',
  jsonb_build_object('corrections',1) from merchant.inventory_count
where id='e3000000-0000-4000-8000-000000000040';
update merchant.inventory_count set status='committed',committed_at=clock_timestamp()
  where id='e3000000-0000-4000-8000-000000000040';" >/dev/null
expect "count reconciliation preserves observations and appends correction" "10|11|1|11|1" \
  "$(q -c "select l.expected_quantity,l.counted_quantity,l.signed_variance,b.on_hand,
    (select count(*) from merchant.stock_ledger_entry where count_id=c.id
      and entry_type='count_correction')
   from merchant.inventory_count c join merchant.inventory_count_line l on l.count_id=c.id
   join merchant.stock_balance b on b.inventory_location_id=c.inventory_location_id
    and b.inventory_item_id=l.inventory_item_id
   where c.id='e3000000-0000-4000-8000-000000000040';")"
expect_error "submitted count observations are immutable" \
  "$(q -c "update merchant.inventory_count_line set counted_quantity=12
   where count_id='e3000000-0000-4000-8000-000000000040';")"

CONCURRENT_ONE="/tmp/umi-pos-inventory-one-$$"
CONCURRENT_TWO="/tmp/umi-pos-inventory-two-$$"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -c "select merchant.append_stock_ledger(
  '$A','$A1','$IL','$II_LAST','reservation_created',1,
  'e3000000-0000-4000-8000-000000000014','e3000000-0000-4000-8000-000000000014',
  repeat('6',64),'reservation','e3000000-0000-4000-8000-000000000014','$U1','$D1',1,
  current_date,'gate-3e-concurrent-1',null,null,null,null,'{}'::jsonb);" \
  >"$CONCURRENT_ONE" 2>&1 &
PID_ONE=$!
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -c "select merchant.append_stock_ledger(
  '$A','$A1','$IL','$II_LAST','reservation_created',1,
  'e3000000-0000-4000-8000-000000000015','e3000000-0000-4000-8000-000000000015',
  repeat('7',64),'reservation','e3000000-0000-4000-8000-000000000015','$U1','$D1',1,
  current_date,'gate-3e-concurrent-2',null,null,null,null,'{}'::jsonb);" \
  >"$CONCURRENT_TWO" 2>&1 &
PID_TWO=$!
wait "$PID_ONE" || true
wait "$PID_TWO" || true
CONCURRENT_ERRORS=$(grep -h -c 'NEGATIVE_STOCK_BLOCKED' "$CONCURRENT_ONE" "$CONCURRENT_TWO" | awk '{s+=$1} END {print s}')
rm -f "$CONCURRENT_ONE" "$CONCURRENT_TWO"
expect "two devices cannot reserve the same last unit" "1|1|1" \
  "$(q -c "select reserved,
      (select count(*) from merchant.stock_ledger_entry where inventory_item_id='$II_LAST'
        and entry_type='reservation_created'),$CONCURRENT_ERRORS
    from merchant.stock_balance where inventory_location_id='$IL' and inventory_item_id='$II_LAST';")"

q -c "update merchant.staff set role_id=(select id from umi.role where key='cashier')
  where id='$S1';" >/dev/null
expect "a role change ends the active operator session" "ended" \
  "$(q -c "select state from runtime.operator_session where id='$OS';")"
q -c "update runtime.operator_session set state='active',ended_at=null where id='$OS';
  update merchant.staff set location_id='$A2' where id='$S1';" >/dev/null
expect "a location removal ends the active operator session" "ended" \
  "$(q -c "select state from runtime.operator_session where id='$OS';")"
q -c "update runtime.operator_session set state='active',ended_at=null where id='$OS';
  update merchant.staff set status='disabled' where id='$S1';" >/dev/null
expect "staff suspension ends the active operator session" "ended" \
  "$(q -c "select state from runtime.operator_session where id='$OS';")"
expect "suspended staff resolves no effective permission" "0" \
  "$(q -c "select cardinality(umi.resolve_staff_permissions('$S1'::uuid));")"

echo
echo "== 11. Gate 3F customer, loyalty and stored value =="
CUST=f3000000-0000-4000-8000-000000000001
POINTS=f3000000-0000-4000-8000-000000000002
WALLET=f3000000-0000-4000-8000-000000000003
GIFT=f3000000-0000-4000-8000-000000000004
q -c "insert into merchant.customer(id,merchant_id,name,public_reference,status)
  values('$CUST','$A','Pilot Customer','CUS-PILOT','active');
insert into merchant.loyalty_program(merchant_id,enabled,points_per_money_unit,money_unit_minor_units,
  earn_timing,policy_version,policy_fingerprint)
values('$A',true,1,100,'immediate','pilot-v1',repeat('7',64));
insert into merchant.customer_consent_history(
  merchant_id,customer_id,consent_type,status,source,policy_version,command_id)
values('$A','$CUST','receipt_delivery','granted','pos_operator','pilot-v1',
  'f3000000-0000-4000-8000-000000000010');
insert into merchant.customer_consent_current(
  merchant_id,customer_id,consent_type,history_id,status)
select merchant_id,customer_id,consent_type,id,status from merchant.customer_consent_history
where command_id='f3000000-0000-4000-8000-000000000010';
insert into merchant.loyalty_points_account(
  id,merchant_id,customer_id,program_reference,public_reference,status)
values('$POINTS','$A','$CUST','pilot','LOY-PILOT','active');
insert into merchant.loyalty_card(id,merchant_id,customer_id,public_reference,currency,status)
values('$WALLET','$A','$CUST','WAL-PILOT','MXN','active');
insert into merchant.loyalty_gift_card(
  id,merchant_id,code,status,public_reference,code_hash,masked_code,currency,amount_cents,customer_id)
values('$GIFT','$A','PILOT-CARD-SECRET-0001','active','GFT-PILOT',
  extensions.digest('PILOT-CARD-SECRET-0001','sha256'),'temporary','MXN',1000,'$CUST');" >/dev/null
expect "gift-card secret is stored only as a hash" "64|f|••••-0001" \
  "$(q -c "select length(code),(code='PILOT-CARD-SECRET-0001'),masked_code
    from merchant.loyalty_gift_card where id='$GIFT';")"
expect_error "consent history cannot be updated" \
  "$(q -c "update merchant.customer_consent_history set status='granted'
    where customer_id='$CUST';")"
q -c "select merchant.append_loyalty_points('$A','$CUST','$POINTS','points_earn_committed',
  'credit',100,'pos_sale','f3000000-0000-4000-8000-000000000020',null,null,null,null,
  '$U1','$D1','f3000000-0000-4000-8000-000000000021',
  'f3000000-0000-4000-8000-000000000022',repeat('a',64),current_date);
select merchant.append_loyalty_points('$A','$CUST','$POINTS','points_authorized',
  'hold',40,'reward_authorization','f3000000-0000-4000-8000-000000000023',null,null,null,
  'f3000000-0000-4000-8000-000000000023','$U1','$D1',
  'f3000000-0000-4000-8000-000000000024',
  'f3000000-0000-4000-8000-000000000025',repeat('b',64),current_date);
select merchant.append_loyalty_points('$A','$CUST','$POINTS','points_released',
  'release',40,'reward_authorization','f3000000-0000-4000-8000-000000000023',null,null,null,
  'f3000000-0000-4000-8000-000000000023','$U1','$D1',
  'f3000000-0000-4000-8000-000000000026',
  'f3000000-0000-4000-8000-000000000027',repeat('c',64),current_date);" >/dev/null
expect "points facts rebuild the available and authorized balance" "100|0|3|3" \
  "$(q -c "select available,authorized,ledger_sequence,
    (select count(*) from merchant.loyalty_points_ledger where account_id='$POINTS')
    from merchant.loyalty_points_balance where account_id='$POINTS';")"
expect_error "points ledger update fails" \
  "$(q -c "update merchant.loyalty_points_ledger set points=999 where account_id='$POINTS';")"
expect_error "points ledger delete fails" \
  "$(q -c "delete from merchant.loyalty_points_ledger where account_id='$POINTS';")"
expect_error "api cannot insert a points fact directly" \
  "$(as_api "$A" "$A1" "$D1" "insert into merchant.loyalty_points_ledger default values;")"
expect_error "api cannot insert a wallet fact directly" \
  "$(as_api "$A" "$A1" "$D1" "insert into merchant.loyalty_stored_value_ledger default values;")"
expect_error "api cannot insert a gift-card fact directly" \
  "$(as_api "$A" "$A1" "$D1" "insert into merchant.loyalty_gift_card_ledger default values;")"
expect_error "api cannot read encrypted gift-card delivery columns directly" \
  "$(as_api_raw "$A" "$A1" "$D1" "select ciphertext,nonce,auth_tag,token_hash
    from merchant.gift_card_secret_delivery;")"
expect_error "worker cannot insert a points fact directly" \
  "$(q -c "set role worker; insert into merchant.loyalty_points_ledger default values;")"
expect_error "an inherited API login cannot append points without request scope" \
  "$(psql -X -q -t -A -d "$DB" -c "set session authorization inventory_api_login" \
    -c "select merchant.append_loyalty_points('$A','$CUST','$POINTS',
      'manual_points_adjustment','credit',1,'scope_test',gen_random_uuid(),null,null,null,null,
      '$U1','$D1',gen_random_uuid(),gen_random_uuid(),repeat('a',64),current_date);" 2>&1)"
expect_error "an inherited worker login cannot append points without request scope" \
  "$(psql -X -q -t -A -d "$DB" -c "set session authorization customer_value_worker_login" \
    -c "select merchant.append_loyalty_points('$A','$CUST','$POINTS',
      'manual_points_adjustment','credit',1,'scope_test',gen_random_uuid(),null,null,null,null,
      '$U1','$D1',gen_random_uuid(),gen_random_uuid(),repeat('a',64),current_date);" 2>&1)"
expect_error "a scoped points function cannot post into another merchant" \
  "$(as_api_raw "$A" "$A1" "$D1" "select merchant.append_loyalty_points('$B','$CUST','$POINTS',
    'manual_points_adjustment','credit',1,'scope_test',gen_random_uuid(),null,null,null,null,
    '$U1','$D1',gen_random_uuid(),gen_random_uuid(),repeat('a',64),current_date);")"
expect_error "a scoped points function cannot use another device" \
  "$(as_api_raw "$A" "$A1" "$D2" "select merchant.append_loyalty_points('$A','$CUST','$POINTS',
    'manual_points_adjustment','credit',1,'scope_test',gen_random_uuid(),null,null,null,null,
    '$U1','$D1',gen_random_uuid(),gen_random_uuid(),repeat('a',64),current_date);")"
expect_error "points authorization cannot exceed available points" \
  "$(q -c "select merchant.append_loyalty_points('$A','$CUST','$POINTS','points_authorized',
    'hold',101,'reward_authorization',gen_random_uuid(),null,null,null,gen_random_uuid(),
    '$U1','$D1',gen_random_uuid(),gen_random_uuid(),repeat('d',64),current_date);")"
expect "api appends points only through the scoped function" "101|4" \
  "$(as_api "$A" "$A1" "$D1" "select merchant.append_loyalty_points(
    '$A','$CUST','$POINTS','manual_points_adjustment','credit',1,'authorized_test',
    'f3000000-0000-4000-8000-000000000070',null,null,null,null,'$U1','$D1',
    'f3000000-0000-4000-8000-000000000071','f3000000-0000-4000-8000-000000000072',
    repeat('a',64),current_date);
    select available,(select count(*) from merchant.loyalty_points_ledger where account_id='$POINTS')
    from merchant.loyalty_points_balance where account_id='$POINTS';")"
q -c "insert into merchant.loyalty_stored_value_ledger(
  merchant_id,card_id,delta,amount_minor_units,reason,idempotency_key,entry_type,currency,
  direction,command_id,fingerprint,business_date,source_type,source_id)
values('$A','$WALLET',1000,1000,'loaded','f3000000-0000-4000-8000-000000000030',
  'loaded','MXN','credit','f3000000-0000-4000-8000-000000000030',repeat('e',64),
  current_date,'development_seed','wallet-opening');
insert into merchant.loyalty_gift_card_ledger(
  merchant_id,gift_card_id,delta,amount_minor_units,reason,entry_type,currency,direction,
  command_id,idempotency_key,fingerprint,business_date,source_type,source_id)
values('$A','$GIFT',1000,1000,'issued','issued','MXN','credit',
  'f3000000-0000-4000-8000-000000000031','f3000000-0000-4000-8000-000000000031',
  repeat('f',64),current_date,'development_seed','gift-opening');" >/dev/null
expect "wallet facts rebuild the available balance" "1000|1|1" \
  "$(q -c "select available,ledger_sequence,(select count(*) from merchant.loyalty_stored_value_ledger
    where card_id='$WALLET') from merchant.loyalty_stored_value_balance where card_id='$WALLET';")"
expect "gift-card facts rebuild the available balance" "1000|1|1" \
  "$(q -c "select available,ledger_sequence,(select count(*) from merchant.loyalty_gift_card_ledger
    where gift_card_id='$GIFT') from merchant.loyalty_gift_card_balance where gift_card_id='$GIFT';")"
q -c "insert into merchant.loyalty_stored_value_ledger(
  merchant_id,card_id,delta,amount_minor_units,reason,idempotency_key,entry_type,currency,
  direction,authorization_id,command_id,fingerprint,business_date,source_type,source_id)
values('$A','$WALLET',0,400,'authorized','f3000000-0000-4000-8000-000000000032',
  'authorized','MXN','hold','f3000000-0000-4000-8000-000000000033',
  'f3000000-0000-4000-8000-000000000032',repeat('1',64),current_date,
  'stored_value_authorization','f3000000-0000-4000-8000-000000000033');" >/dev/null
expect "wallet authorization separates available and authorized value" "600|400" \
  "$(q -c "select available,authorized from merchant.loyalty_stored_value_balance where card_id='$WALLET';")"
q -c "insert into merchant.loyalty_stored_value_ledger(
  merchant_id,card_id,delta,amount_minor_units,reason,idempotency_key,entry_type,currency,
  direction,authorization_id,command_id,fingerprint,business_date,source_type,source_id)
values('$A','$WALLET',0,400,'authorization_released',
  'f3000000-0000-4000-8000-000000000034','authorization_released','MXN','release',
  'f3000000-0000-4000-8000-000000000033','f3000000-0000-4000-8000-000000000034',
  repeat('2',64),current_date,'stored_value_authorization',
  'f3000000-0000-4000-8000-000000000033');" >/dev/null
expect "wallet release restores available value once" "1000|0" \
  "$(q -c "select available,authorized from merchant.loyalty_stored_value_balance where card_id='$WALLET';")"
q -c "insert into merchant.pos_cart(
  id,merchant_id,location_id,operator_session_id,customer_id,status,lifecycle_state,version,
  business_date,original_operator_session_id,original_operator_user_id,operator_user_id)
values('f3000000-0000-4000-8000-000000000050','$A','$A1','$OS','$CUST','committed',
  'committed',1,current_date,'$OS','$U1','$U1');
insert into merchant.customer_order(
  id,merchant_id,location_id,customer_id,source,fulfillment_type,status,business_date,external_ref)
values('f3000000-0000-4000-8000-000000000051','$A','$A1','$CUST','pos','dine_in',
  'completed',current_date,'gate-3f-value');
insert into merchant.pos_payment_attempt(
  id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,query_only,correlation_id)
values('f3000000-0000-4000-8000-000000000052','$A','$A1',
  'f3000000-0000-4000-8000-000000000050','stored_value',1000,'MXN','succeeded',false,
  'gate-3f-value');
insert into merchant.receipt_snapshot(
  id,merchant_id,location_id,order_id,payment_attempt_id,receipt_number,business_date,currency,
  grand_total,snapshot)
values('f3000000-0000-4000-8000-000000000053','$A','$A1',
  'f3000000-0000-4000-8000-000000000051','f3000000-0000-4000-8000-000000000052',
  'G3F-1',current_date,'MXN',1000,'{}');
insert into merchant.pos_committed_sale(
  id,merchant_id,location_id,cart_id,order_id,payment_attempt_id,receipt_snapshot_id,totals_fingerprint)
values('f3000000-0000-4000-8000-000000000054','$A','$A1',
  'f3000000-0000-4000-8000-000000000050','f3000000-0000-4000-8000-000000000051',
  'f3000000-0000-4000-8000-000000000052','f3000000-0000-4000-8000-000000000053',repeat('4',64));
insert into merchant.customer_value_authorization(
  id,merchant_id,location_id,account_type,account_id,customer_id,sale_id,checkout_version,
  amount_minor_units,currency,checkout_fingerprint,policy_version,command_id,idempotency_key,
  command_fingerprint,status,expires_at,correlation_id)
values('f3000000-0000-4000-8000-000000000040','$A','$A1','wallet','$WALLET','$CUST',
  'f3000000-0000-4000-8000-000000000050',1,400,'MXN',repeat('4',64),'pilot-v1',
  'f3000000-0000-4000-8000-000000000041','f3000000-0000-4000-8000-000000000041',
  repeat('5',64),'authorized',clock_timestamp()+interval '5 minutes','gate-3f-commit');
insert into merchant.loyalty_earn_preview(
  merchant_id,location_id,cart_id,customer_id,account_id,checkout_version,
  customer_attachment_version,loyalty_program_id,loyalty_policy_version,
  loyalty_policy_fingerprint,checkout_fingerprint,preview_fingerprint,input_fingerprint,
  gross_eligible_minor_units,excluded_minor_units,final_eligible_minor_units,expected_points,
  earn_status,explanation_codes,effective_rules,business_date,expires_at)
select '$A','$A1','f3000000-0000-4000-8000-000000000050','$CUST','$POINTS',1,1,
  merchant_id,'pilot-v1',repeat('7',64),repeat('3',64),repeat('4',64),repeat('2',64),
  1000,0,1000,10,'immediate',array['eligible_sale'],
  jsonb_build_object('pointsPerUnit',1,'moneyUnitMinorUnits',100,'rounding','floor'),
  current_date,clock_timestamp()+interval '5 minutes'
from merchant.loyalty_program where merchant_id='$A';
insert into merchant.loyalty_stored_value_ledger(
  merchant_id,card_id,delta,amount_minor_units,reason,idempotency_key,entry_type,currency,
  direction,authorization_id,command_id,fingerprint,business_date,source_type,source_id)
values('$A','$WALLET',0,400,'authorized','f3000000-0000-4000-8000-000000000042',
  'authorized','MXN','hold','f3000000-0000-4000-8000-000000000040',
  'f3000000-0000-4000-8000-000000000042',repeat('6',64),current_date,
  'stored_value_authorization','f3000000-0000-4000-8000-000000000040');" >/dev/null
expect "sale, historical policy, points and wallet facts commit atomically" "points_earn_committed|10|pilot-v1|1|committed|600|0|1" \
  "$(q -c "create temporary table gate3f_commit_result(result jsonb);
    insert into gate3f_commit_result select merchant.commit_customer_value_closeout(
      '$A','$A1','f3000000-0000-4000-8000-000000000050',
      'f3000000-0000-4000-8000-000000000054','f3000000-0000-4000-8000-000000000051',
      '$CUST','f3000000-0000-4000-8000-000000000043',
      'f3000000-0000-4000-8000-000000000043',repeat('4',64),1,repeat('3',64),
      current_date,'$U1','$D1',
      jsonb_build_object('rewardAuthorizationId',null,'storedValueAuthorizationIds',
        jsonb_build_array('f3000000-0000-4000-8000-000000000040')));
    select result->'earn'->'ledgerEntry'->>'type',result->'earn'->'ledgerEntry'->>'points',
      (select loyalty_policy_version from merchant.loyalty_sale_policy_snapshot
        where sale_id='f3000000-0000-4000-8000-000000000054'),
      jsonb_array_length(result->'storedValue'),
      result->'storedValue'->0->'authorization'->>'status',
      (select available from merchant.loyalty_stored_value_balance where card_id='$WALLET'),
      (select authorized from merchant.loyalty_stored_value_balance where card_id='$WALLET'),
      (select count(*) from merchant.loyalty_stored_value_ledger
        where authorization_id='f3000000-0000-4000-8000-000000000040' and entry_type='redeemed')
    from gate3f_commit_result;")"

if ! gift_checkout_setup=$(q -c "insert into merchant.pos_cart(
  id,merchant_id,location_id,operator_session_id,status,lifecycle_state,version,business_date,
  original_operator_session_id,original_operator_user_id,operator_user_id)
values('f3000000-0000-4000-8000-000000000100','$A','$A1','$OS','committed','committed',1,
  current_date,'$OS','$U1','$U1');
update merchant.product set sale_action='gift_card'
where id='d3000000-0000-4000-8000-000000000001' and merchant_id='$A';
insert into merchant.pos_cart_line(
  id,merchant_id,cart_id,product_id,identity_key,product_name,quantity,base_price,tax_rate_basis_points)
values('f3000000-0000-4000-8000-000000000117','$A',
  'f3000000-0000-4000-8000-000000000100','d3000000-0000-4000-8000-000000000001',
  repeat('7',64),'Gift card',1,100,0);
insert into merchant.customer_order(
  id,merchant_id,location_id,source,fulfillment_type,status,business_date,external_ref)
values('f3000000-0000-4000-8000-000000000101','$A','$A1','pos','dine_in','completed',
  current_date,'gate-3f-anonymous-gift');
insert into merchant.pos_payment_attempt(
  id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,query_only,correlation_id)
values('f3000000-0000-4000-8000-000000000102','$A','$A1',
  'f3000000-0000-4000-8000-000000000100','gift_card',100,'MXN','succeeded',false,'gift-anonymous');
insert into merchant.receipt_snapshot(
  id,merchant_id,location_id,order_id,payment_attempt_id,receipt_number,business_date,currency,
  grand_total,snapshot)
values('f3000000-0000-4000-8000-000000000103','$A','$A1',
  'f3000000-0000-4000-8000-000000000101','f3000000-0000-4000-8000-000000000102',
  'G3F-GIFT',current_date,'MXN',100,'{}');
insert into merchant.pos_committed_sale(
  id,merchant_id,location_id,cart_id,order_id,payment_attempt_id,receipt_snapshot_id,totals_fingerprint)
values('f3000000-0000-4000-8000-000000000104','$A','$A1',
  'f3000000-0000-4000-8000-000000000100','f3000000-0000-4000-8000-000000000101',
  'f3000000-0000-4000-8000-000000000102','f3000000-0000-4000-8000-000000000103',repeat('4',64));
insert into merchant.loyalty_gift_card(
  id,merchant_id,location_id,code,status,public_reference,code_hash,masked_code,currency,
  amount_cents,issuance_command_id,issuance_fingerprint,issuance_policy_version,
  issuer_operator_id,issuer_device_id,issuance_source,pending_funding_cart_id,
  pending_funding_minor_units,pending_funding_assignment_id,pending_funding_line_id,
  pending_funding_fingerprint)
values('f3000000-0000-4000-8000-000000000115','$A','$A1','FUNDED-CARD-SECRET',
  'inactive','GFT-FUNDED',extensions.digest('FUNDED-CARD-SECRET','sha256'),'••••-FUNDED','MXN',100,
  'f3000000-0000-4000-8000-000000000118',repeat('8',64),'pilot-v1','$U1','$D1','sale',
  'f3000000-0000-4000-8000-000000000100',100,
  'f3000000-0000-4000-8000-000000000116','f3000000-0000-4000-8000-000000000117',repeat('9',64));
insert into merchant.customer_value_authorization(
  id,merchant_id,location_id,account_type,account_id,customer_id,sale_id,checkout_version,
  amount_minor_units,currency,checkout_fingerprint,policy_version,command_id,idempotency_key,
  command_fingerprint,status,expires_at,correlation_id,allocation_id,allocation_order,
  remaining_balance_minor_units,optimistic_version)
values('f3000000-0000-4000-8000-000000000105','$A','$A1','gift_card','$GIFT',null,
  'f3000000-0000-4000-8000-000000000100',1,100,'MXN',repeat('4',64),'pilot-v1',
  'f3000000-0000-4000-8000-000000000106','f3000000-0000-4000-8000-000000000106',
  repeat('6',64),'authorized',clock_timestamp()+interval '5 minutes','gift-anonymous',
  'f3000000-0000-4000-8000-000000000110',0,900,1);
select merchant.append_gift_card_fact('$A','$GIFT',jsonb_build_object(
  'delta',0,'amountMinorUnits',100,'reason','authorized','entryType','authorized','currency','MXN',
  'direction','hold','authorizationId','f3000000-0000-4000-8000-000000000105',
  'commandId','f3000000-0000-4000-8000-000000000106','idempotencyKey',
  'f3000000-0000-4000-8000-000000000106','fingerprint',repeat('6',64),'operatorId','$U1',
  'deviceId','$D1','businessDate',current_date,'sourceType','stored_value_authorization',
  'sourceId','f3000000-0000-4000-8000-000000000105'));
insert into merchant.pos_checkout_draft(
  id,merchant_id,location_id,cart_id,operator_session_id,device_id,state,receipt_delivery)
values('f3000000-0000-4000-8000-000000000109','$A','$A1',
  'f3000000-0000-4000-8000-000000000100','$OS','$D1','payment_accepted','{}');
insert into merchant.pos_tender_fact(
  id,merchant_id,location_id,checkout_id,cart_id,position,tender_type,status,
  amount_minor_units,currency,correlation_id)
values('f3000000-0000-4000-8000-000000000110','$A','$A1',
  'f3000000-0000-4000-8000-000000000109','f3000000-0000-4000-8000-000000000100',
  0,'gift_card','confirmed_success',100,'MXN','gift-anonymous');"); then
  printf '%s\n' "$gift_checkout_setup" >&2
  exit 1
fi
expect "gift-card payment and funded activation commit atomically" "committed|900|0|1|1|active|100|1" \
  "$(q -c "do \$\$ begin perform merchant.commit_customer_value_closeout(
        '$A','$A1','f3000000-0000-4000-8000-000000000100',
        'f3000000-0000-4000-8000-000000000104','f3000000-0000-4000-8000-000000000101',
        null,'f3000000-0000-4000-8000-000000000107',
        'f3000000-0000-4000-8000-000000000107',repeat('4',64),1,repeat('4',64),
        current_date,'$U1','$D1',repeat('a',64),jsonb_build_object(
          'storedValueFingerprint',repeat('a',64),'storedValueAuthorizationIds',
          jsonb_build_array('f3000000-0000-4000-8000-000000000105'),'fundedGiftCards',
          jsonb_build_array(jsonb_build_object(
            'assignmentId','f3000000-0000-4000-8000-000000000116',
            'giftCardId','f3000000-0000-4000-8000-000000000115',
            'saleLineId','f3000000-0000-4000-8000-000000000117',
            'purchasedValue',jsonb_build_object('minorUnits',100,'currency','MXN'),
            'policyId','gift-card-sale-funding','policyVersion','pilot-v1',
            'fingerprint',repeat('9',64))))); end \$\$;
    select status,
      (select available from merchant.loyalty_gift_card_balance where gift_card_id='$GIFT'),
      (select authorized from merchant.loyalty_gift_card_balance where gift_card_id='$GIFT'),
      (select count(*) from merchant.loyalty_gift_card_ledger
        where authorization_id='f3000000-0000-4000-8000-000000000105' and entry_type='redeemed'),
      (select count(*) from merchant.customer_value_tender_allocation
        where authorization_id='f3000000-0000-4000-8000-000000000105'),
      (select status from merchant.loyalty_gift_card
        where id='f3000000-0000-4000-8000-000000000115'),
      (select available from merchant.loyalty_gift_card_balance
        where gift_card_id='f3000000-0000-4000-8000-000000000115'),
      (select count(*) from merchant.gift_card_funding_assignment
        where gift_card_id='f3000000-0000-4000-8000-000000000115')
    from merchant.customer_value_authorization
    where id='f3000000-0000-4000-8000-000000000105';")"

VALUE_CONCURRENT_ONE="/tmp/umi-pos-value-one-$$"
VALUE_CONCURRENT_TWO="/tmp/umi-pos-value-two-$$"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -c "insert into merchant.loyalty_stored_value_ledger(
  merchant_id,card_id,delta,amount_minor_units,reason,idempotency_key,entry_type,currency,
  direction,authorization_id,command_id,fingerprint,business_date,source_type,source_id)
values('$A','$WALLET',0,500,'authorized','f3000000-0000-4000-8000-000000000060',
  'authorized','MXN','hold','f3000000-0000-4000-8000-000000000061',
  'f3000000-0000-4000-8000-000000000060',repeat('8',64),current_date,
  'stored_value_authorization','f3000000-0000-4000-8000-000000000061');" \
  >"$VALUE_CONCURRENT_ONE" 2>&1 &
VALUE_PID_ONE=$!
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -c "insert into merchant.loyalty_stored_value_ledger(
  merchant_id,card_id,delta,amount_minor_units,reason,idempotency_key,entry_type,currency,
  direction,authorization_id,command_id,fingerprint,business_date,source_type,source_id)
values('$A','$WALLET',0,500,'authorized','f3000000-0000-4000-8000-000000000062',
  'authorized','MXN','hold','f3000000-0000-4000-8000-000000000063',
  'f3000000-0000-4000-8000-000000000062',repeat('9',64),current_date,
  'stored_value_authorization','f3000000-0000-4000-8000-000000000063');" \
  >"$VALUE_CONCURRENT_TWO" 2>&1 &
VALUE_PID_TWO=$!
wait "$VALUE_PID_ONE" || true
wait "$VALUE_PID_TWO" || true
VALUE_CONCURRENT_ERRORS=$(grep -h -c 'loyalty_stored_value_balance_available_check' \
  "$VALUE_CONCURRENT_ONE" "$VALUE_CONCURRENT_TWO" | awk '{s+=$1} END {print s}')
rm -f "$VALUE_CONCURRENT_ONE" "$VALUE_CONCURRENT_TWO"
expect "two wallet authorizations cannot spend the same remaining value" "100|500|1|1" \
  "$(q -c "select available,authorized,
      (select count(*) from merchant.loyalty_stored_value_ledger where card_id='$WALLET'
        and entry_type='authorized' and amount_minor_units=500),$VALUE_CONCURRENT_ERRORS
    from merchant.loyalty_stored_value_balance where card_id='$WALLET';")"
expect_error "wallet ledger update fails" \
  "$(q -c "update merchant.loyalty_stored_value_ledger set delta=1 where card_id='$WALLET';")"
expect_error "gift-card ledger delete fails" \
  "$(q -c "delete from merchant.loyalty_gift_card_ledger where gift_card_id='$GIFT';")"
expect_error "historical loyalty policy binding is immutable" \
  "$(q -c "update merchant.loyalty_sale_policy_snapshot set loyalty_policy_version='changed'
    where sale_id='f3000000-0000-4000-8000-000000000054';")"
expect_error "a stale earn preview cannot commit" \
  "$(q -c "select merchant.assert_loyalty_earn_preview('$A','$A1',
    'f3000000-0000-4000-8000-000000000050','$CUST',1,repeat('3',64),repeat('0',64));")"
q -c "select merchant.commit_points_adjustment('$A','$CUST','$POINTS','increase',5,
  'customer_service_correction','$U1','$D1','f3000000-0000-4000-8000-000000000080',
  'f3000000-0000-4000-8000-000000000081',repeat('a',64),current_date);" >/dev/null
expect "manual points adjustment appends one immutable fact" "116|1" \
  "$(q -c "select available,(select count(*) from merchant.loyalty_points_ledger
      where command_id='f3000000-0000-4000-8000-000000000080')
    from merchant.loyalty_points_balance where account_id='$POINTS';")"
q -c "insert into merchant.customer_value_authorization(
  id,merchant_id,location_id,account_type,account_id,customer_id,sale_id,checkout_version,
  amount_minor_units,currency,checkout_fingerprint,policy_version,command_id,idempotency_key,
  command_fingerprint,status,expires_at,correlation_id,operator_id,device_id,credential_version)
values('f3000000-0000-4000-8000-000000000090','$A','$A1','wallet','$WALLET','$CUST',
  'f3000000-0000-4000-8000-000000000050',1,50,'MXN',repeat('9',64),'pilot-v1',
  'f3000000-0000-4000-8000-000000000091','f3000000-0000-4000-8000-000000000092',
  repeat('8',64),'authorized',clock_timestamp()-interval '1 second','expiry-test','$U1','$D1',1);
insert into merchant.loyalty_reward(
  id,merchant_id,name,type,value,points_cost,public_reference)
values('f3000000-0000-4000-8000-000000000093','$A','Expiry reward','manual',100,10,'REW-EXPIRY');
insert into merchant.customer_value_authorization(
  id,merchant_id,location_id,account_type,account_id,customer_id,reward_id,sale_id,
  checkout_version,points,benefit_minor_units,checkout_fingerprint,policy_version,reward_version,
  command_id,idempotency_key,command_fingerprint,status,expires_at,correlation_id,
  operator_id,device_id,credential_version)
values('f3000000-0000-4000-8000-000000000094','$A','$A1','loyalty_reward','$POINTS','$CUST',
  'f3000000-0000-4000-8000-000000000093','f3000000-0000-4000-8000-000000000050',1,10,100,
  repeat('9',64),'pilot-v1',1,'f3000000-0000-4000-8000-000000000096',
  'f3000000-0000-4000-8000-000000000097',repeat('7',64),'authorized',
  clock_timestamp()-interval '1 second','reward-expiry','$U1','$D1',1);
insert into merchant.customer_value_authorization(
  id,merchant_id,location_id,account_type,account_id,customer_id,sale_id,checkout_version,
  amount_minor_units,currency,checkout_fingerprint,policy_version,command_id,idempotency_key,
  command_fingerprint,status,expires_at,correlation_id,operator_id,device_id,credential_version)
values('f3000000-0000-4000-8000-000000000095','$A','$A1','gift_card','$GIFT','$CUST',
  'f3000000-0000-4000-8000-000000000050',1,20,'MXN',repeat('9',64),'pilot-v1',
  'f3000000-0000-4000-8000-000000000098','f3000000-0000-4000-8000-000000000099',
  repeat('6',64),'authorized',clock_timestamp()-interval '1 second','gift-expiry','$U1','$D1',1);
select merchant.append_stored_value_fact('$A','$WALLET',jsonb_build_object(
  'delta',0,'amountMinorUnits',50,'reason','authorized','idempotencyKey',
  'f3000000-0000-4000-8000-000000000092','entryType','authorized','currency','MXN',
  'direction','hold','authorizationId','f3000000-0000-4000-8000-000000000090',
  'commandId','f3000000-0000-4000-8000-000000000091','fingerprint',repeat('8',64),
  'operatorId','$U1','deviceId','$D1','businessDate',current_date,
  'sourceType','stored_value_authorization','sourceId','f3000000-0000-4000-8000-000000000090'));
select merchant.append_loyalty_points('$A','$CUST','$POINTS','points_authorized','hold',10,
  'reward_authorization','f3000000-0000-4000-8000-000000000094',null,null,
  'f3000000-0000-4000-8000-000000000093','f3000000-0000-4000-8000-000000000094',
  '$U1','$D1','f3000000-0000-4000-8000-000000000096',
  'f3000000-0000-4000-8000-000000000097',repeat('7',64),current_date);
select merchant.append_gift_card_fact('$A','$GIFT',jsonb_build_object(
  'delta',0,'amountMinorUnits',20,'reason','authorized','entryType','authorized','currency','MXN',
  'direction','hold','authorizationId','f3000000-0000-4000-8000-000000000095',
  'commandId','f3000000-0000-4000-8000-000000000098','idempotencyKey',
  'f3000000-0000-4000-8000-000000000099','fingerprint',repeat('6',64),'operatorId','$U1',
  'deviceId','$D1','businessDate',current_date,'sourceType','authorization_expiry',
  'sourceId','f3000000-0000-4000-8000-000000000095'));" >/dev/null
expect "automatic expiry claims every authorization type" "3" \
  "$(q -c "select merchant.expire_customer_value_authorizations('$A',100);")"
expect "automatic expiry releases points and stored value exactly once" "0|100|500|116|0|900|0|1|1|1" \
  "$(q -c "select merchant.expire_customer_value_authorizations('$A',100),
      (select available from merchant.loyalty_stored_value_balance where card_id='$WALLET'),
      (select authorized from merchant.loyalty_stored_value_balance where card_id='$WALLET'),
      (select available from merchant.loyalty_points_balance where account_id='$POINTS'),
      (select authorized from merchant.loyalty_points_balance where account_id='$POINTS'),
      (select available from merchant.loyalty_gift_card_balance where gift_card_id='$GIFT'),
      (select authorized from merchant.loyalty_gift_card_balance where gift_card_id='$GIFT'),
      (select count(*) from merchant.loyalty_stored_value_ledger
        where authorization_id='f3000000-0000-4000-8000-000000000090'
          and entry_type='authorization_released'),
      (select count(*) from merchant.loyalty_points_ledger
        where authorization_id='f3000000-0000-4000-8000-000000000094'
          and entry_type='points_released'),
      (select count(*) from merchant.loyalty_gift_card_ledger
        where authorization_id='f3000000-0000-4000-8000-000000000095'
          and entry_type='authorization_released');")"
expect "gift-card lookup budget becomes generic lockout" "8|1" \
  "$(q -c "with attempts as (
      select (merchant.consume_gift_card_lookup_budget('$A','$A1',extensions.digest('bucket','sha256'))).*
      from generate_series(1,9))
    select count(*) filter(where allowed),count(*) filter(where not allowed) from attempts;")"
expect "composite customer history includes sale, receipt, points, wallet and gift card facts" "5" \
  "$(q -c "select count(distinct case
      when event_type='sale' then 'sale' when event_type='receipt' then 'receipt'
      when event_type like 'points_%' or event_type='manual_points_adjustment' then 'points'
      when event_type like 'wallet_%' then 'wallet'
      when event_type like 'gift_card_%' then 'gift' end)
    from merchant.customer_history_event where merchant_id='$A' and customer_id='$CUST';")"
q -c "update runtime.operator_session set
  permissions=array['offline.replay','customer.history.read','customer.history.global',
    'customer.history.admin','customer.consent.read'],
  entitlements='[{\"featureKey\":\"pos\",\"enabled\":true}]',
  state='active',ended_at=null,expires_at=clock_timestamp()+interval '5 minutes'
  where id='$OS';" >/dev/null
expect "scoped history function serves the API without direct view access" "1|1" \
  "$(as_api "$A" "$A1" "$D1" "select
    (count(*)>0)::int,
    count(*) filter(where event_type='wallet_loaded' and location_id is null
      and visibility='restricted_administrative')
    from merchant.read_customer_history_event_scoped(
      '$A','$CUST','$OS');")"
expect_error "api cannot read the unscoped customer history view" \
  "$(as_api_raw "$A" "$A1" "$D1" "select * from merchant.customer_history_event limit 1;")"
expect_error "a history cursor cannot cross customers" \
  "$(q -c "select merchant.validate_customer_history_cursor('$A','$CUST','$A',gen_random_uuid());")"
expect "receipt consent does not imply marketing consent" "0" \
  "$(q -c "select count(*) from merchant.customer_consent_current where customer_id='$CUST'
    and consent_type in ('marketing_email','marketing_sms') and status='granted';")"
expect "another merchant cannot read the customer profile" "0" \
  "$(as_api "$B" "" "" "select count(*) from merchant.customer where id='$CUST';")"
expect "another merchant cannot read the points ledger" "0" \
  "$(as_api "$B" "" "" "select count(*) from merchant.loyalty_points_ledger where account_id='$POINTS';")"
expect_error "a customer cannot link to another merchant" \
  "$(q -c "insert into merchant.loyalty_points_account(
    merchant_id,customer_id,program_reference,public_reference,status)
    values('$B','$CUST','pilot','LOY-CROSS','active');")"

echo
echo "== 12. Gate 3G-A hardware runtime =="
q -c "update runtime.operator_session set
  permissions=array[
    'hardware.read','hardware.manage','hardware.assign','hardware.diagnostics',
    'hardware.command.execute',
    'hardware.printer.print','hardware.printer.reprint','hardware.printer.test',
    'hardware.drawer.open','hardware.drawer.test','hardware.scanner.use',
    'hardware.scanner.test','hardware.customer_display.use','hardware.customer_display.test'
  ],entitlements='[{\"featureKey\":\"pos\",\"enabled\":true}]',
  state='active',ended_at=null,expires_at=clock_timestamp()+interval '5 minutes'
  where id='$OS';" >/dev/null
HARDWARE_ID="$(as_api "$A" "$A1" "$D1" "select merchant.register_hardware_device(
  jsonb_build_object('merchantId','$A','locationId','$A1','operatorSessionId','$OS',
    'registerId',null,'assignedPosDeviceId',null,'deviceType','printer',
    'manufacturer','Simulator','model','receipt-v1','publicReference','SIM-PRINTER-1',
    'transport','simulator','capabilities',jsonb_build_array('printer.receipt','printer.test_page')));" )"
expect "hardware registration creates one scoped device" "1" \
  "$(q -c "select count(*) from merchant.hardware_device where id='$HARDWARE_ID'
    and merchant_id='$A' and location_id='$A1' and device_type='printer';")"
NETWORK_PRINTER_ID="$(as_api "$A" "$A1" "$D1" "select merchant.register_hardware_device(
  jsonb_build_object('merchantId','$A','locationId','$A1','operatorSessionId','$OS',
    'registerId',null,'assignedPosDeviceId','$D1','deviceType','printer',
    'manufacturer','Generic','model','thermal-network','publicReference','NET-PRINTER-1',
    'transport','network_tcp','capabilities',jsonb_build_array(
      'printer.receipt','printer.qr','printer.cut','printer.test_page'),
    'connectionConfiguration',jsonb_build_object(
      'networkHost','printer.local','networkPort',9100,'connectTimeoutMs',1000,
      'commandTimeoutMs',3000,'characterEncoding','cp850','receiptWidthColumns',42,
      'drawerPulsePin',0,'drawerPulseOnMs',50,'scannerTerminator','enter',
      'scannerBurstWindowMs',80)));" )"
expect "generic network printer stores bounded safe configuration" "network_tcp|printer.local|9100" \
  "$(q -c "select transport,connection_configuration->>'networkHost',
    connection_configuration->>'networkPort' from merchant.hardware_device
    where id='$NETWORK_PRINTER_ID';")"
expect_error "a network printer rejects an invalid endpoint" \
  "$(as_api_raw "$A" "$A1" "$D1" "select merchant.register_hardware_device(
    jsonb_build_object('merchantId','$A','locationId','$A1','operatorSessionId','$OS',
      'deviceType','printer','manufacturer','Generic','model','invalid',
      'publicReference','NET-PRINTER-BAD','transport','network_tcp',
      'capabilities',jsonb_build_array('printer.receipt'),
      'connectionConfiguration',jsonb_build_object(
        'networkHost','http://unsafe','networkPort',70000,'connectTimeoutMs',1000,
        'commandTimeoutMs',3000,'characterEncoding','cp850','receiptWidthColumns',42,
        'drawerPulsePin',0,'drawerPulseOnMs',50,'scannerTerminator','enter',
        'scannerBurstWindowMs',80)));" )"
expect "pilot policy starts without a permissive stored override" "0" \
  "$(q -c "select count(*) from merchant.hardware_pilot_policy
    where merchant_id='$A' and location_id='$A1';")"
POLICY_VERSION="$(as_api "$A" "$A1" "$D1" "select merchant.update_hardware_pilot_policy(
  jsonb_build_object('merchantId','$A','locationId','$A1','operatorSessionId','$OS',
    'registerId',null,'expectedVersion',1,'policy',jsonb_build_object(
      'autoPrintReceipt',true,'openDrawerOnCashSale',true,
      'openDrawerOnCashRefund',true,'allowNoSale',false,
      'receiptCopiesDefault',1,'hardwareRetryLimit',3,
      'hardwareHealthIntervalSeconds',60,'scannerEnabled',true,
      'customerDisplayEnabled',false)));" )"
expect "pilot policy update is scoped and versioned" "2|3|1" \
  "$POLICY_VERSION|$(as_api "$A" "$A1" "$D1" "select
    (policy->>'hardwareRetryLimit')::int,count(*) over()
    from merchant.hardware_pilot_policy where merchant_id='$A' and location_id='$A1';")"
expect_error "another location cannot update the pilot policy" \
  "$(as_api_raw "$A" "$A2" "$D2" "select merchant.update_hardware_pilot_policy(
    jsonb_build_object('merchantId','$A','locationId','$A2','operatorSessionId','$OS',
      'registerId',null,'expectedVersion',1,'policy',jsonb_build_object(
        'autoPrintReceipt',true,'openDrawerOnCashSale',true,
        'openDrawerOnCashRefund',true,'allowNoSale',false,
        'receiptCopiesDefault',1,'hardwareRetryLimit',2,
        'hardwareHealthIntervalSeconds',30,'scannerEnabled',true,
        'customerDisplayEnabled',false)));" )"
as_api "$A" "$A1" "$D1" "select merchant.assign_hardware_device(jsonb_build_object(
  'merchantId','$A','locationId','$A1','operatorSessionId','$OS','hardwareId','$HARDWARE_ID',
  'registerId',null,'assignedPosDeviceId','$D1','primary',true,'expectedVersion',1));" >/dev/null
expect "hardware assignment binds the enrolled POS device" "1|1" \
  "$(q -c "select (assigned_pos_device_id='$D1')::int,
    (select primary_device::int from merchant.hardware_assignment
      where hardware_id='$HARDWARE_ID' and released_at is null)
    from merchant.hardware_device where id='$HARDWARE_ID';")"
HARDWARE_COMMAND='a9000000-0000-4000-8000-000000000101'
expect_error "an official receipt command requires an authoritative receipt" \
  "$(as_api_raw "$A" "$A1" "$D1" "select merchant.create_hardware_command(jsonb_build_object(
    'merchantId','$A','locationId','$A1','operatorSessionId','$OS','registerId',null,
    'commandId','a9000000-0000-4000-8000-000000000199','idempotencyKey','forged-receipt',
    'hardwareId','$HARDWARE_ID','commandType','print_receipt','sourceAggregateType','receipt',
    'sourceAggregateId','a9000000-0000-4000-8000-000000000198','configurationVersion',2,
    'payloadFingerprint',repeat('f',64),'correlationId','forged-receipt'));")"
as_api "$A" "$A1" "$D1" "select merchant.create_hardware_command(jsonb_build_object(
  'merchantId','$A','locationId','$A1','operatorSessionId','$OS','registerId',null,
  'commandId','$HARDWARE_COMMAND','idempotencyKey','hardware-print-command-1',
  'hardwareId','$HARDWARE_ID','commandType','print_receipt','sourceAggregateType','receipt',
  'sourceAggregateId','d3000000-0000-4000-8000-000000000006','configurationVersion',2,
  'payloadFingerprint',repeat('a',64),'correlationId','hardware-db-check',
  'printJobId','$HARDWARE_COMMAND','safePayload',jsonb_build_object('receiptRef','receipt-safe-1')));" >/dev/null
as_api "$A" "$A1" "$D1" "select merchant.transition_hardware_command(
  '$A','$A1','$OS','$HARDWARE_COMMAND','dispatching',null,'{}');
  select merchant.transition_hardware_command(
  '$A','$A1','$OS','$HARDWARE_COMMAND','succeeded',null,'{\"acknowledged\":true}');" >/dev/null
expect "printer command and persistent queue reach one terminal result" "succeeded|printed|1|1" \
  "$(q -c "select
    (select status from merchant.hardware_command_event where command_id='$HARDWARE_COMMAND'
      order by sequence desc limit 1),
    (select status from merchant.hardware_print_job_event where print_job_id='$HARDWARE_COMMAND'
      order by sequence desc limit 1),
    (select count(*) from merchant.hardware_command where id='$HARDWARE_COMMAND'),
    (select count(*) from merchant.hardware_print_job where id='$HARDWARE_COMMAND');")"
expect "hardware command retry returns the original identity" "$HARDWARE_COMMAND" \
  "$(as_api "$A" "$A1" "$D1" "select merchant.create_hardware_command(jsonb_build_object(
    'merchantId','$A','locationId','$A1','operatorSessionId','$OS','registerId',null,
    'commandId','$HARDWARE_COMMAND','idempotencyKey','hardware-print-command-1',
    'hardwareId','$HARDWARE_ID','commandType','print_receipt','sourceAggregateType','receipt',
    'sourceAggregateId','d3000000-0000-4000-8000-000000000006','configurationVersion',2,
    'payloadFingerprint',repeat('a',64),'correlationId','hardware-db-check'));")"
HARDWARE_RETRY_COMMAND='a9000000-0000-4000-8000-000000000103'
as_api "$A" "$A1" "$D1" "select merchant.create_hardware_command(jsonb_build_object(
  'merchantId','$A','locationId','$A1','operatorSessionId','$OS','registerId',null,
  'commandId','$HARDWARE_RETRY_COMMAND','idempotencyKey','hardware-retry-command-1',
  'hardwareId','$HARDWARE_ID','commandType','print_test_page','sourceAggregateType','diagnostic',
  'sourceAggregateId','persistent-retry-limit','configurationVersion',2,
  'payloadFingerprint',repeat('d',64),'correlationId','hardware-retry-limit',
  'printJobId','$HARDWARE_RETRY_COMMAND','safePayload','{}'::jsonb));
  select merchant.transition_hardware_command(
    '$A','$A1','$OS','$HARDWARE_RETRY_COMMAND','dispatching',null,'{}');
  select merchant.transition_hardware_command(
    '$A','$A1','$OS','$HARDWARE_RETRY_COMMAND','retryable','busy','{}');
  select merchant.transition_hardware_command(
    '$A','$A1','$OS','$HARDWARE_RETRY_COMMAND','dispatching',null,'{}');
  select merchant.transition_hardware_command(
    '$A','$A1','$OS','$HARDWARE_RETRY_COMMAND','retryable','busy','{}');
  select merchant.transition_hardware_command(
    '$A','$A1','$OS','$HARDWARE_RETRY_COMMAND','dispatching',null,'{}');
  select merchant.transition_hardware_command(
    '$A','$A1','$OS','$HARDWARE_RETRY_COMMAND','retryable','busy','{}');" >/dev/null
expect "hardware retry limit remains terminal across runtime restarts" "failed|terminal_hardware_failure|3" \
  "$(q -c "select e.status,e.failure_code,
    (select count(*) from merchant.hardware_command_event d
      where d.command_id='$HARDWARE_RETRY_COMMAND' and d.status='dispatching')
    from merchant.hardware_command_event e where e.command_id='$HARDWARE_RETRY_COMMAND'
    order by e.sequence desc limit 1;")"
expect "No Sale persistence requires an approval fact" "NO" \
  "$(q -c "select is_nullable from information_schema.columns
    where table_schema='merchant' and table_name='no_sale_drawer_event'
      and column_name='approval_id';")"
expect "another location cannot read hardware command events" "0" \
  "$(as_api "$A" "$A2" "$D2" "select count(*) from merchant.hardware_command_event
    where command_id='$HARDWARE_COMMAND';")"
expect_error "another location cannot use assigned hardware" \
  "$(as_api_raw "$A" "$A2" "$D2" "select merchant.create_hardware_command(jsonb_build_object(
    'merchantId','$A','locationId','$A2','operatorSessionId','$OS','registerId',null,
    'commandId','a9000000-0000-4000-8000-000000000102',
    'idempotencyKey','hardware-cross-location-1','hardwareId','$HARDWARE_ID',
    'commandType','print_receipt','sourceAggregateType','receipt',
    'sourceAggregateId','d3000000-0000-4000-8000-000000000006',
    'configurationVersion',2,'payloadFingerprint',repeat('b',64),'correlationId','cross'));")"
DRAWER_ID="$(as_api "$A" "$A1" "$D1" "select merchant.register_hardware_device(
  jsonb_build_object('merchantId','$A','locationId','$A1','operatorSessionId','$OS',
    'registerId','d3000000-0000-4000-8000-000000000040','assignedPosDeviceId','$D1',
    'deviceType','cash_drawer','manufacturer','Simulator','model','drawer-v1',
    'publicReference','SIM-DRAWER-1','transport','simulator',
    'capabilities',jsonb_build_array('drawer.open','drawer.status')));")"
as_api "$A" "$A1" "$D1" "select merchant.assign_hardware_device(jsonb_build_object(
  'merchantId','$A','locationId','$A1','operatorSessionId','$OS','hardwareId','$DRAWER_ID',
  'registerId','d3000000-0000-4000-8000-000000000040','assignedPosDeviceId','$D1',
  'primary',false,'expectedVersion',1));" >/dev/null
expect_error "drawer open rejects an arbitrary source" \
  "$(as_api_raw "$A" "$A1" "$D1" "select merchant.create_hardware_command(jsonb_build_object(
    'merchantId','$A','locationId','$A1','operatorSessionId','$OS',
    'registerId','d3000000-0000-4000-8000-000000000040',
    'commandId','a9000000-0000-4000-8000-000000000110','idempotencyKey','drawer-forged',
    'hardwareId','$DRAWER_ID','commandType','open_drawer','sourceAggregateType','cash_action',
    'sourceAggregateId','a9000000-0000-4000-8000-000000000111','configurationVersion',2,
    'payloadFingerprint',repeat('c',64),'correlationId','drawer-forged',
    'safePayload',jsonb_build_object('drawer',jsonb_build_object(
      'reason','cash_refund','cashReference','a9000000-0000-4000-8000-000000000111'))));")"
DRAWER_COMMAND='a9000000-0000-4000-8000-000000000112'
as_api "$A" "$A1" "$D1" "select merchant.create_hardware_command(jsonb_build_object(
  'merchantId','$A','locationId','$A1','operatorSessionId','$OS',
  'registerId','d3000000-0000-4000-8000-000000000040',
  'commandId','$DRAWER_COMMAND','idempotencyKey','drawer-refund-1',
  'hardwareId','$DRAWER_ID','commandType','open_drawer','sourceAggregateType','cash_action',
  'sourceAggregateId','d3000000-0000-4000-8000-000000000011','configurationVersion',2,
  'payloadFingerprint',repeat('d',64),'correlationId','drawer-refund',
  'safePayload',jsonb_build_object('drawer',jsonb_build_object(
    'reason','cash_refund','cashReference','d3000000-0000-4000-8000-000000000011'))));" >/dev/null
expect "drawer open binds to one committed cash fact" "1" \
  "$(q -c "select count(*) from merchant.hardware_command where id='$DRAWER_COMMAND';")"
expect_error "a committed cash fact cannot emit a second drawer pulse" \
  "$(as_api_raw "$A" "$A1" "$D1" "select merchant.create_hardware_command(jsonb_build_object(
    'merchantId','$A','locationId','$A1','operatorSessionId','$OS',
    'registerId','d3000000-0000-4000-8000-000000000040',
    'commandId','a9000000-0000-4000-8000-000000000113','idempotencyKey','drawer-refund-2',
    'hardwareId','$DRAWER_ID','commandType','open_drawer','sourceAggregateType','cash_action',
    'sourceAggregateId','d3000000-0000-4000-8000-000000000011','configurationVersion',2,
    'payloadFingerprint',repeat('e',64),'correlationId','drawer-refund-duplicate',
    'safePayload',jsonb_build_object('drawer',jsonb_build_object(
      'reason','cash_refund','cashReference','d3000000-0000-4000-8000-000000000011'))));")"
expect_error "api cannot mutate hardware command history" \
  "$(as_api_raw "$A" "$A1" "$D1" "update merchant.hardware_command_event
    set status='failed' where command_id='$HARDWARE_COMMAND';")"
as_api "$A" "$A1" "$D1" "select merchant.assign_hardware_device(jsonb_build_object(
  'merchantId','$A','locationId','$A1','operatorSessionId','$OS',
  'hardwareId','$NETWORK_PRINTER_ID','registerId',null,'assignedPosDeviceId','$D1',
  'primary',true,'expectedVersion',1));" >/dev/null
expect "primary printer change keeps one active primary and the prior assignment" "1|1|0" \
  "$(q -c "select
    count(*) filter(where primary_device),count(*) filter(where not primary_device),
    count(*) filter(where primary_device and hardware_id='$HARDWARE_ID')
    from merchant.hardware_assignment where merchant_id='$A' and location_id='$A1'
      and register_id is null and released_at is null and hardware_id in (
        '$HARDWARE_ID','$NETWORK_PRINTER_ID');")"
expect "all hardware authority tables force RLS" "8" \
  "$(q -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='merchant' and c.relname in (
      'hardware_device','hardware_assignment','hardware_command','hardware_command_event',
      'hardware_print_job','hardware_print_job_event','hardware_diagnostic',
      'hardware_pilot_policy')
      and c.relrowsecurity and c.relforcerowsecurity;")"

echo
echo "== 13. Gate 4A kitchen authority =="
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<SQL
insert into merchant.station(id,merchant_id,location_id,key,name) values
  ('a2000000-0000-4000-8000-000000000091','$A','$A1','gate4a-hot','Gate 4A Hot'),
  ('a2000000-0000-4000-8000-000000000092','$A','$A2','gate4a-other','Gate 4A Other');
insert into merchant.product(id,merchant_id,name,price,requires_preparation)
values('a3000000-0000-4000-8000-000000000091','$A','Gate 4A item',100,true);
insert into merchant.customer_order(id,merchant_id,location_id,source,fulfillment_type,status,business_date,external_ref)
values('a4000000-0000-4000-8000-000000000091','$A','$A1','pos','dine_in','completed',current_date,'gate4a-db-order');
insert into merchant.order_item(id,order_id,product_id,name,quantity,unit_price,display_order)
values('a4100000-0000-4000-8000-000000000091','a4000000-0000-4000-8000-000000000091',
  'a3000000-0000-4000-8000-000000000091','Gate 4A item',1,100,1);
insert into merchant.kitchen_order(id,merchant_id,location_id,source_order_id,public_reference,
  source,fulfillment_type,business_date,status,queued_at)
values('a4200000-0000-4000-8000-000000000091','$A','$A1',
  'a4000000-0000-4000-8000-000000000091','K-DB-1','pos','dine_in',current_date,'queued',clock_timestamp());
insert into merchant.kitchen_order_item(id,merchant_id,location_id,kitchen_order_id,source_order_id,
  source_order_item_id,station_id,status,product_id,product_name,quantity,display_order,route_reason)
values('a4300000-0000-4000-8000-000000000091','$A','$A1',
  'a4200000-0000-4000-8000-000000000091','a4000000-0000-4000-8000-000000000091',
  'a4100000-0000-4000-8000-000000000091','a2000000-0000-4000-8000-000000000091',
  'queued','a3000000-0000-4000-8000-000000000091','Gate 4A item',1,1,'product');
insert into merchant.kitchen_event(event_id,merchant_id,location_id,kitchen_order_id,station_id,
  kind,aggregate_version,status,correlation_id)
values('a4400000-0000-4000-8000-000000000091','$A','$A1',
  'a4200000-0000-4000-8000-000000000091','a2000000-0000-4000-8000-000000000091',
  'order_created',1,'queued','gate4a-db-check');
SQL
expect "assigned location reads its kitchen order" "1" \
  "$(as_api "$A" "$A1" "$D1" "select count(*) from merchant.kitchen_order where id='a4200000-0000-4000-8000-000000000091';")"
expect "another location cannot read kitchen work" "0" \
  "$(as_api "$A" "$A2" "$D2" "select count(*) from merchant.kitchen_order where id='a4200000-0000-4000-8000-000000000091';")"
expect "another merchant cannot read kitchen work" "0" \
  "$(as_api "$B" "" "" "select count(*) from merchant.kitchen_order where id='a4200000-0000-4000-8000-000000000091';")"
expect_error "api cannot insert a kitchen event directly" \
  "$(as_api_raw "$A" "$A1" "$D1" "insert into merchant.kitchen_event(event_id,merchant_id,location_id,kitchen_order_id,kind,aggregate_version,correlation_id) values(gen_random_uuid(),'$A','$A1','a4200000-0000-4000-8000-000000000091','order_updated',2,'forged');")"
expect_error "api cannot read an unscoped KDS view" \
  "$(as_api_raw "$A" "$A1" "$D1" "select count(*) from kds.station_order;")"
expect_error "a kitchen route cannot cross locations" \
  "$(q -c "insert into merchant.kitchen_route(merchant_id,location_id,product_id,station_id) values('$A','$A1','a3000000-0000-4000-8000-000000000091','a2000000-0000-4000-8000-000000000092');")"
expect "all kitchen authority tables force RLS" "6" \
  "$(q -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='merchant' and c.relname in (
      'kitchen_route','kitchen_order','kitchen_order_item','kitchen_command',
      'kitchen_event','kitchen_device_station')
      and c.relrowsecurity and c.relforcerowsecurity;")"

echo
if [ "$fail" -eq 0 ]; then
  echo "umi-pos-db-check: merchant, location, device, append-only, audit-chain and replay-authority checks passed."
else
  echo "umi-pos-db-check: FAILURES above."
fi
exit "$fail"
