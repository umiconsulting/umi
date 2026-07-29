#!/usr/bin/env bash
set -euo pipefail

container="${UMI_POS_DEV_DB_CONTAINER:-umi-gate2f-postgres}"
database="${UMI_POS_DEV_DB_NAME:-umi_gate2f}"
tenant_id="${UMI_POS_DEV_TENANT_ID:-10000000-0000-4000-8000-000000000101}"
branch_id="${UMI_POS_DEV_BRANCH_ID:-20000000-0000-4000-8000-000000000101}"

if [[ "${UMI_POS_DEV_SEED_CONFIRM:-}" != "disposable" ]]; then
  echo "Set UMI_POS_DEV_SEED_CONFIRM=disposable for the disposable local database." >&2
  exit 1
fi

command -v docker >/dev/null || {
  echo "Docker is required for the UmiPOS demo seed." >&2
  exit 1
}

command -v node >/dev/null || {
  echo "Node.js is required to create local PIN hashes." >&2
  exit 1
}

docker inspect "$container" >/dev/null 2>&1 || {
  echo "The disposable PostgreSQL container does not exist: $container" >&2
  exit 1
}

resolve_jwt_secret() {
  if [[ -n "${UMI_POS_DEV_JWT_SECRET:-}" ]]; then
    printf '%s' "$UMI_POS_DEV_JWT_SECRET"
    return
  fi
  if [[ -n "${JWT_SECRET:-}" ]]; then
    printf '%s' "$JWT_SECRET"
    return
  fi
  if [[ -d /proc ]]; then
    local pid
    pid="$(pgrep -f '/apps/umi-api/dist/main' | head -n 1 || true)"
    if [[ -n "$pid" && -r "/proc/$pid/environ" ]]; then
      tr '\0' '\n' <"/proc/$pid/environ" |
        sed -n 's/^JWT_SECRET=//p' |
        head -n 1
      return
    fi
  fi
}

jwt_secret="$(resolve_jwt_secret)"
if [[ -z "$jwt_secret" ]]; then
  echo "Set UMI_POS_DEV_JWT_SECRET to the JWT_SECRET used by the local UMI API." >&2
  exit 1
fi

pin_material() {
  local pin="$1"
  SEED_JWT_SECRET="$jwt_secret" \
    SEED_TENANT_ID="$tenant_id" \
    SEED_PIN="$pin" \
    node <<'NODE'
const crypto = require('crypto');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(process.env.SEED_PIN, salt, 64).toString('hex');
const lookup = crypto
  .createHmac('sha256', process.env.SEED_JWT_SECRET)
  .update(`umi-pos-pin:${process.env.SEED_TENANT_ID}:${process.env.SEED_PIN}`)
  .digest('hex');
process.stdout.write(`${salt}|${hash}|${lookup}`);
NODE
}

IFS='|' read -r owner_salt owner_hash owner_lookup <<<"$(pin_material 1111)"
IFS='|' read -r admin_salt admin_hash admin_lookup <<<"$(pin_material 2222)"
IFS='|' read -r manager_salt manager_hash manager_lookup <<<"$(pin_material 3333)"
IFS='|' read -r cashier_salt cashier_hash cashier_lookup <<<"$(pin_material 2468)"
IFS='|' read -r viewer_salt viewer_hash viewer_lookup <<<"$(pin_material 5555)"

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" \
  -v tenant_id="$tenant_id" \
  -v branch_id="$branch_id" \
  -v owner_salt="$owner_salt" -v owner_hash="$owner_hash" -v owner_lookup="$owner_lookup" \
  -v admin_salt="$admin_salt" -v admin_hash="$admin_hash" -v admin_lookup="$admin_lookup" \
  -v manager_salt="$manager_salt" -v manager_hash="$manager_hash" -v manager_lookup="$manager_lookup" \
  -v cashier_salt="$cashier_salt" -v cashier_hash="$cashier_hash" -v cashier_lookup="$cashier_lookup" \
  -v viewer_salt="$viewer_salt" -v viewer_hash="$viewer_hash" -v viewer_lookup="$viewer_lookup" <<'SQL'
begin;

insert into umi.permission(key, description)
values
  ('catalog.read', 'Read the operator-safe branch catalog'),
  ('cart.write', 'Prepare a branch-scoped POS cart'),
  ('checkout.commit', 'Commit a branch-scoped online POS sale'),
  ('offline.cash.checkout', 'Create a policy-authorized provisional cash sale'),
  ('offline.replay', 'Replay and reconcile device-authenticated offline commands'),
  ('offline.recovery.review', 'Approve one scoped offline recovery action'),
  ('sale.lifecycle', 'Manage the branch-scoped POS sale lifecycle'),
  ('sale.resume.any', 'Resume a suspended sale from another operator'),
  ('audit.read', 'Read tenant-visible, redacted audit events')
on conflict (key) do update set description=excluded.description;

insert into umi.role(id, key, name, description, is_platform)
values
  ('31000000-0000-4000-8000-000000000200','owner','Owner',
   'Owns the local UmiPOS business.',false),
  ('31000000-0000-4000-8000-000000000202','admin','Administrator',
   'Administers the local UmiPOS business.',false),
  ('31000000-0000-4000-8000-000000000203','manager','Manager',
   'Supervises branch operations and recovery.',false),
  ('31000000-0000-4000-8000-000000000201','cashier','Cashier',
   'Operates catalog, cart, and checkout.',false),
  ('31000000-0000-4000-8000-000000000204','viewer','Viewer',
   'Reads the catalog without cart authority.',false)
on conflict (key) do update
set name=excluded.name,
    description=excluded.description,
    is_platform=excluded.is_platform;

delete from umi.role_permission rp
using umi.role r, umi.permission p
where rp.role_id=r.id
  and rp.permission_id=p.id
  and r.key in ('owner','admin','manager','cashier','viewer')
  and p.key in (
    'catalog.read','cart.write','checkout.commit','offline.cash.checkout',
    'offline.replay','offline.recovery.review','sale.lifecycle','sale.resume.any',
    'audit.read'
  );

with grants(role_key, permission_key) as (
  values
    ('owner','catalog.read'),('owner','cart.write'),('owner','checkout.commit'),
    ('owner','offline.cash.checkout'),('owner','offline.replay'),
    ('owner','offline.recovery.review'),('owner','sale.lifecycle'),
    ('owner','sale.resume.any'),('owner','audit.read'),
    ('admin','catalog.read'),('admin','cart.write'),('admin','checkout.commit'),
    ('admin','offline.cash.checkout'),('admin','offline.replay'),
    ('admin','offline.recovery.review'),('admin','sale.lifecycle'),
    ('admin','sale.resume.any'),('admin','audit.read'),
    ('manager','catalog.read'),('manager','cart.write'),('manager','checkout.commit'),
    ('manager','offline.cash.checkout'),('manager','offline.replay'),
    ('manager','offline.recovery.review'),('manager','sale.lifecycle'),
    ('manager','sale.resume.any'),('manager','audit.read'),
    ('cashier','catalog.read'),('cashier','cart.write'),('cashier','checkout.commit'),
    ('cashier','offline.cash.checkout'),('cashier','offline.replay'),
    ('cashier','sale.lifecycle'),
    ('viewer','catalog.read')
)
insert into umi.role_permission(role_id, permission_id)
select r.id,p.id
from grants g
join umi.role r on r.key=g.role_key
join umi.permission p on p.key=g.permission_key
on conflict do nothing;

insert into umi.user(id,email,full_name,status)
values
  ('30000000-0000-4000-8000-000000000200','owner@umipos.local','Propietaria UmiPOS','active'),
  ('30000000-0000-4000-8000-000000000102','admin@umipos.local','Administradora UmiPOS','active'),
  ('30000000-0000-4000-8000-000000000203','manager@umipos.local','Gerente UmiPOS','active'),
  ('30000000-0000-4000-8000-000000000201','cashier@umipos.local','Cajera UmiPOS','active'),
  ('30000000-0000-4000-8000-000000000204','viewer@umipos.local','Consulta UmiPOS','active')
on conflict (id) do update
set email=excluded.email,
    full_name=excluded.full_name,
    status='active',
    updated_at=now();

delete from umi.user_role
where business_id=:'tenant_id'::uuid
  and user_id in (
    '30000000-0000-4000-8000-000000000200',
    '30000000-0000-4000-8000-000000000102',
    '30000000-0000-4000-8000-000000000203',
    '30000000-0000-4000-8000-000000000201',
    '30000000-0000-4000-8000-000000000204'
  );

with assignments(user_id, role_key) as (
  values
    ('30000000-0000-4000-8000-000000000200'::uuid,'owner'),
    ('30000000-0000-4000-8000-000000000102'::uuid,'admin'),
    ('30000000-0000-4000-8000-000000000203'::uuid,'manager'),
    ('30000000-0000-4000-8000-000000000201'::uuid,'cashier'),
    ('30000000-0000-4000-8000-000000000204'::uuid,'viewer')
)
insert into umi.user_role(user_id,role_id,business_id,branch_id,granted_by)
select a.user_id,r.id,:'tenant_id'::uuid,:'branch_id'::uuid,
       '30000000-0000-4000-8000-000000000102'::uuid
from assignments a
join umi.role r on r.key=a.role_key;

insert into tenant.staff(
  id,business_id,branch_id,user_id,position,status,
  operator_pin_salt,operator_pin_hash,operator_pin_lookup_hash,
  pin_failed_attempts,pin_locked_until
)
values
  ('40000000-0000-4000-8000-000000000200',:'tenant_id',:'branch_id',
   '30000000-0000-4000-8000-000000000200','owner','active',
   :'owner_salt',:'owner_hash',:'owner_lookup',0,null),
  ('40000000-0000-4000-8000-000000000202',:'tenant_id',:'branch_id',
   '30000000-0000-4000-8000-000000000102','admin','active',
   :'admin_salt',:'admin_hash',:'admin_lookup',0,null),
  ('40000000-0000-4000-8000-000000000203',:'tenant_id',:'branch_id',
   '30000000-0000-4000-8000-000000000203','manager','active',
   :'manager_salt',:'manager_hash',:'manager_lookup',0,null),
  ('40000000-0000-4000-8000-000000000201',:'tenant_id',:'branch_id',
   '30000000-0000-4000-8000-000000000201','cashier','active',
   :'cashier_salt',:'cashier_hash',:'cashier_lookup',0,null),
  ('40000000-0000-4000-8000-000000000204',:'tenant_id',:'branch_id',
   '30000000-0000-4000-8000-000000000204','viewer','active',
   :'viewer_salt',:'viewer_hash',:'viewer_lookup',0,null)
on conflict (business_id,user_id) do update
set branch_id=excluded.branch_id,
    position=excluded.position,
    status='active',
    operator_pin_salt=excluded.operator_pin_salt,
    operator_pin_hash=excluded.operator_pin_hash,
    operator_pin_lookup_hash=excluded.operator_pin_lookup_hash,
    pin_failed_attempts=0,
    pin_locked_until=null,
    updated_at=now();

insert into tenant.product_category(id,business_id,name,display_order)
values
  ('51000000-0000-4000-8000-000000000101',:'tenant_id','Café',10),
  ('51000000-0000-4000-8000-000000000102',:'tenant_id','Té y bebidas',20),
  ('51000000-0000-4000-8000-000000000103',:'tenant_id','Alimentos',30),
  ('51000000-0000-4000-8000-000000000104',:'tenant_id','Postres',40)
on conflict (id) do update
set name=excluded.name,
    display_order=excluded.display_order;

insert into tenant.product(
  id,business_id,category_id,name,description,price,active,external_ref,
  sku,barcode,tax_rate_basis_points
)
values
  ('52000000-0000-4000-8000-000000000101',:'tenant_id','51000000-0000-4000-8000-000000000101',
   'Americano','Espresso con agua caliente.',4500,true,'demo-americano','CAF-AME','750100000001',1600),
  ('52000000-0000-4000-8000-000000000102',:'tenant_id','51000000-0000-4000-8000-000000000101',
   'Latte','Espresso con leche vaporizada.',6500,true,'demo-latte','CAF-LAT','750100000002',1600),
  ('52000000-0000-4000-8000-000000000103',:'tenant_id','51000000-0000-4000-8000-000000000101',
   'Cappuccino','Espresso, leche y espuma.',6200,true,'demo-cappuccino','CAF-CAP','750100000003',1600),
  ('52000000-0000-4000-8000-000000000104',:'tenant_id','51000000-0000-4000-8000-000000000101',
   'Cold brew','Café extraído en frío.',7000,true,'demo-cold-brew','CAF-CBR','750100000004',1600),
  ('52000000-0000-4000-8000-000000000105',:'tenant_id','51000000-0000-4000-8000-000000000102',
   'Matcha latte','Matcha con leche vaporizada.',7800,true,'demo-matcha','BEB-MAT','750100000005',1600),
  ('52000000-0000-4000-8000-000000000106',:'tenant_id','51000000-0000-4000-8000-000000000102',
   'Chai latte','Té chai con leche.',7200,true,'demo-chai','BEB-CHA','750100000006',1600),
  ('52000000-0000-4000-8000-000000000107',:'tenant_id','51000000-0000-4000-8000-000000000103',
   'Croissant','Croissant de mantequilla.',4800,true,'demo-croissant','ALI-CRO','750100000007',1600),
  ('52000000-0000-4000-8000-000000000108',:'tenant_id','51000000-0000-4000-8000-000000000103',
   'Sándwich de pavo','Pavo, queso, lechuga y tomate.',11500,true,'demo-sandwich','ALI-SAN','750100000008',1600),
  ('52000000-0000-4000-8000-000000000109',:'tenant_id','51000000-0000-4000-8000-000000000104',
   'Cheesecake','Rebanada de cheesecake clásico.',8500,true,'demo-cheesecake','POS-CHE','750100000009',1600),
  ('52000000-0000-4000-8000-000000000110',:'tenant_id','51000000-0000-4000-8000-000000000104',
   'Galleta de chocolate','Galleta con trozos de chocolate.',3800,true,'demo-cookie','POS-GAL','750100000010',1600),
  ('52000000-0000-4000-8000-000000000111',:'tenant_id','51000000-0000-4000-8000-000000000104',
   'Rollo de canela','Disponible en el siguiente turno.',5900,true,'demo-cinnamon','POS-CAN','750100000011',1600),
  ('52000000-0000-4000-8000-000000000112',:'tenant_id','51000000-0000-4000-8000-000000000102',
   'Bebida de temporada','Producto fuera del surtido actual.',7600,true,'demo-seasonal','BEB-TEM','750100000012',1600)
on conflict (id) do update
set category_id=excluded.category_id,
    name=excluded.name,
    description=excluded.description,
    price=excluded.price,
    active=excluded.active,
    external_ref=excluded.external_ref,
    sku=excluded.sku,
    barcode=excluded.barcode,
    tax_rate_basis_points=excluded.tax_rate_basis_points,
    updated_at=now();

insert into tenant.product_branch_availability(
  product_id,branch_id,available,status,available_from
)
select id,:'branch_id'::uuid,true,'enabled',null
from tenant.product
where id between '52000000-0000-4000-8000-000000000101'::uuid
             and '52000000-0000-4000-8000-000000000110'::uuid
on conflict (product_id,branch_id) do update
set available=true,status='enabled',available_from=null,updated_at=now();

insert into tenant.product_branch_availability(
  product_id,branch_id,available,status,available_from
)
values
  ('52000000-0000-4000-8000-000000000111',:'branch_id',false,
   'future_availability',now()+interval '1 day'),
  ('52000000-0000-4000-8000-000000000112',:'branch_id',false,
   'out_of_assortment',null)
on conflict (product_id,branch_id) do update
set available=excluded.available,
    status=excluded.status,
    available_from=excluded.available_from,
    updated_at=now();

insert into tenant.product_variant(
  id,business_id,product_id,name,attributes,price_delta,active,display_order
)
values
  ('53000000-0000-4000-8000-000000000101',:'tenant_id','52000000-0000-4000-8000-000000000102',
   'Chico',jsonb_build_object('size','chico'),0,true,10),
  ('53000000-0000-4000-8000-000000000102',:'tenant_id','52000000-0000-4000-8000-000000000102',
   'Mediano',jsonb_build_object('size','mediano'),1000,true,20),
  ('53000000-0000-4000-8000-000000000103',:'tenant_id','52000000-0000-4000-8000-000000000102',
   'Grande',jsonb_build_object('size','grande'),1800,true,30),
  ('53000000-0000-4000-8000-000000000104',:'tenant_id','52000000-0000-4000-8000-000000000108',
   'Pan blanco',jsonb_build_object('bread','blanco'),0,true,10),
  ('53000000-0000-4000-8000-000000000105',:'tenant_id','52000000-0000-4000-8000-000000000108',
   'Pan integral',jsonb_build_object('bread','integral'),500,true,20)
on conflict (id) do update
set name=excluded.name,
    attributes=excluded.attributes,
    price_delta=excluded.price_delta,
    active=excluded.active,
    display_order=excluded.display_order,
    updated_at=now();

insert into tenant.product_option_group(id,product_id,name,min_select,max_select)
values
  ('54000000-0000-4000-8000-000000000101','52000000-0000-4000-8000-000000000102',
   'Tipo de leche',1,1),
  ('54000000-0000-4000-8000-000000000102','52000000-0000-4000-8000-000000000102',
   'Jarabes',0,2),
  ('54000000-0000-4000-8000-000000000103','52000000-0000-4000-8000-000000000108',
   'Extras',0,3)
on conflict (id) do update
set name=excluded.name,
    min_select=excluded.min_select,
    max_select=excluded.max_select;

insert into tenant.product_modifier(id,option_group_id,name,price_delta)
values
  ('55000000-0000-4000-8000-000000000101','54000000-0000-4000-8000-000000000101',
   'Leche entera',0),
  ('55000000-0000-4000-8000-000000000102','54000000-0000-4000-8000-000000000101',
   'Leche de avena',1200),
  ('55000000-0000-4000-8000-000000000103','54000000-0000-4000-8000-000000000101',
   'Leche deslactosada',500),
  ('55000000-0000-4000-8000-000000000104','54000000-0000-4000-8000-000000000102',
   'Vainilla',800),
  ('55000000-0000-4000-8000-000000000105','54000000-0000-4000-8000-000000000102',
   'Caramelo',800),
  ('55000000-0000-4000-8000-000000000106','54000000-0000-4000-8000-000000000103',
   'Queso extra',1500),
  ('55000000-0000-4000-8000-000000000107','54000000-0000-4000-8000-000000000103',
   'Aguacate',2200)
on conflict (id) do update
set name=excluded.name,
    price_delta=excluded.price_delta;

insert into tenant.product_media(
  id,business_id,product_id,url,alt_text,width,height,display_order
)
values
  ('56000000-0000-4000-8000-000000000101',:'tenant_id','52000000-0000-4000-8000-000000000101',
   'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80',
   'Taza de café americano',900,700,10),
  ('56000000-0000-4000-8000-000000000102',:'tenant_id','52000000-0000-4000-8000-000000000102',
   'https://images.unsplash.com/photo-1570968915860-54d5c301fa9f?auto=format&fit=crop&w=900&q=80',
   'Taza de café latte',900,700,10),
  ('56000000-0000-4000-8000-000000000107',:'tenant_id','52000000-0000-4000-8000-000000000107',
   'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=900&q=80',
   'Croissant de mantequilla',900,700,10),
  ('56000000-0000-4000-8000-000000000108',:'tenant_id','52000000-0000-4000-8000-000000000108',
   'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80',
   'Sándwich de pavo',900,700,10),
  ('56000000-0000-4000-8000-000000000109',:'tenant_id','52000000-0000-4000-8000-000000000109',
   'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80',
   'Rebanada de cheesecake',900,700,10)
on conflict (id) do update
set url=excluded.url,
    alt_text=excluded.alt_text,
    width=excluded.width,
    height=excluded.height,
    display_order=excluded.display_order;

select 1 / case when count(*)=5 then 1 else 0 end
from tenant.staff
where business_id=:'tenant_id'::uuid
  and operator_pin_lookup_hash in (
    :'owner_lookup',:'admin_lookup',:'manager_lookup',:'cashier_lookup',:'viewer_lookup'
  );

select 1 / case when count(*)=12 then 1 else 0 end
from tenant.product
where business_id=:'tenant_id'::uuid
  and external_ref like 'demo-%';

select 1 / case when count(*)=27 then 1 else 0 end
from umi.role_permission rp
join umi.role r on r.id=rp.role_id
join umi.permission p on p.id=rp.permission_id
where r.key in ('owner','admin','manager','cashier','viewer')
  and p.key in (
    'catalog.read','cart.write','checkout.commit','offline.cash.checkout',
    'offline.replay','offline.recovery.review','audit.read'
  );

commit;

select 'UmiPOS demo seed completed.' as result;
select u.email,r.key as role,s.position
from tenant.staff s
join umi.user u on u.id=s.user_id
join umi.user_role ur on ur.user_id=u.id and ur.business_id=s.business_id
join umi.role r on r.id=ur.role_id
where s.business_id=:'tenant_id'::uuid
  and u.email like '%@umipos.local'
order by r.key;
select count(*) as demo_product_count
from tenant.product
where business_id=:'tenant_id'::uuid
  and external_ref like 'demo-%';
SQL

echo "Use PINs 1111, 2222, 3333, 2468, and 5555 for the local role checks."
