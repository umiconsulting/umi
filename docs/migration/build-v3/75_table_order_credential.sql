\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 75_table_order_credential — workstream I, step 2: a guest at a
-- table may ORDER, and the order must land in the till and the kitchen with no
-- manual step.
--
-- THE DECISION THIS FILE IMPLEMENTS, and its boundaries, are recorded in
-- `docs/architecture/2026-09-13-pos-channel-attribution-adr.md` §9
-- (resolved 2026-09-17). In one line: the table channel ships as ORDER INTAKE.
-- The guest orders from the table, the order is written through the ONE order
-- writer (`src/shared/orders/order-writer.ts`) with the channel identity `web`,
-- the till picks it up from the incoming-orders surface it already has, and the
-- kitchen receives it because `writeOrder` itself projects the ticket. Payment
-- stays at the COUNTER until the Conekta gateway lands; a table order that is
-- later settled at the till links to the POS sale exactly as a WhatsApp order
-- does (ADR §8.3, the `walk_in` fallback). Nothing here takes money.
--
-- ---------------------------------------------------------------------------
-- 1 · WHY A CREDENTIAL AND NOT A TABLE ID
--
-- The QR is printed on a physical table and photographed by strangers. If the
-- URL carried `table_id`, any guest could edit it and place an order onto
-- another table's bill — a stranger writing on someone else's check. So the URL
-- carries an opaque token that RESOLVES to (merchant, location, table), and the
-- table id is never in the guest's hands.
--
-- THE TOKEN IS STORED AS A HASH. `token_hash` is sha256 hex of the raw token,
-- exactly the shape `runtime.device_pairing_session.setup_code_hash` and
-- `merchant.device.credential_hash` use, and the raw token is returned ONCE at
-- mint time and never stored. The consequence is stated plainly because it is
-- the whole reason for the extra column: a database read cannot reconstruct a
-- table's QR, so a dump of this table is not a set of working ordering links.
--
-- REVOCATION WITHOUT REPRINTING EVERY TABLE'S CODE (ADR §9's closing line) is
-- what `revoked_at` buys. A lost or abused QR is revoked ON ITS OWN ROW, so one
-- table's code is killed and the other eleven tables keep working. A shared
-- secret rotated in the application cannot do that: it would invalidate every
-- printed code in the room at once.
--
-- ONE LIVE CREDENTIAL PER TABLE, enforced by a partial unique index rather than
-- by the service. Two live tokens for one table means a QR the owner believes is
-- dead still orders — the same failure `pos_payment_attempt_open_terminal_uq`
-- (72_mp_point) refuses for a terminal. Rotation is therefore `revoke`, then
-- `issue`, and the refusal for the second `issue` is typed rather than a bare
-- 23505.
--
-- ---------------------------------------------------------------------------
-- 2 · THE WORD "OPEN" IS A TRAP, AND THIS BUILD DOES NOT FALL INTO IT
--
-- The ADR says the order is "linked to that table's open state". `merchant`
-- `.table_state` (build-v3-67) has a state literally NAMED `open`, and it means
-- the opposite thing: "nobody is on it and it is ready". A table with a party on
-- it is `seated`, `ordered`, `served` or `awaiting_payment`.
--
-- So a reader who tests `state = 'open'` would refuse every seated guest and
-- admit exactly the tables nobody is sitting at — the inverse of the product,
-- and a bug that looks like a state-machine detail. The MODEL is what decides,
-- not the word: 67_table_state's own constraint states the equivalence
-- (`table_state_party_presence`), and `table-map.repository.ts` reads it the
-- same way (`seat()` treats `open` and `dirty` as free; `transition()` refuses
-- with `TABLE_NOT_OCCUPIED` when `seated_at is null`).
--
--   A TABLE IS OPEN FOR TABLE-ORDER INTAKE EXACTLY WHEN `seated_at IS NOT NULL`
--   — i.e. a party is present.
--
-- The intake path asserts that predicate inside its transaction, under a row
-- lock, and refuses with the SAME typed code the serve transition uses
-- (`TABLE_NOT_OCCUPIED`), because it is the same fact. A guest at a table no
-- waiter has opened is told, in Spanish, to ask their waiter to open it.
--
-- ---------------------------------------------------------------------------
-- 3 · `merchant.table_order` — THE ORDER'S LINK, NOT A SECOND COPY OF IT
--
-- The order itself is `merchant.customer_order` (written by the one writer, with
-- `source='web'` and `fulfillment_type='dine_in'`). This table carries the facts
-- that belong to the INTAKE and to nothing else, so the order row keeps its own
-- shape:
--
--   · which credential was scanned, and therefore which table the guest was
--     sitting at when they ordered — the floor plan's `table_id` is a JSON
--     element id with no row to point at (67_table_state records the same
--     reason), so the link is by id and the plan stays the authority;
--   · the guest's own name and phone, as NAMED columns. `guest_name` and
--     `guest_phone` are the shape `merchant.table_reservation` already uses for
--     the same kind of anonymous party. They are deliberately NOT squeezed into
--     `customer_order.notes`: 20_merchant.sql's comment on that column says it is
--     "NOT a revived free-text blob", and the WhatsApp channel's identity is a
--     real `merchant.customer` row rather than a note. A guest typing a phone
--     number into a public form is an UNVERIFIED identity (`customer.merged_into_id`
--     exists because phone is an unverified soft key), so this build does not
--     mint or match a customer from it: the phone is recorded on the intake,
--     where it can be read but cannot silently become a loyalty identity.
--
-- WHY NOT PUT `table_id` ON `customer_order`. That row is shared by every
-- channel, and a nullable table column there would be one channel's foreign
-- concept on everyone's row. This is the ADR's "link, don't merge" shape applied
-- one level down, and it is where a future pay-on-page step attaches: the order's
-- identity does not change when the payment path arrives (ADR §9, "nothing built
-- now is thrown away").
--
-- Idempotent and re-runnable: guarded tables, guarded indexes, guarded policies.
-- ============================================================================

create table if not exists merchant.table_order_credential (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  location_id uuid not null,
  -- The floor-plan element id (the contract's `Id` is a uuid). No foreign key:
  -- the plan is a JSON document, so the map is the authority on existence.
  table_id uuid not null,
  -- sha256 hex of the raw token. Format-checked so a plaintext token pasted into
  -- this column by a future writer fails loudly instead of quietly working: a
  -- 43-character base64url string is not 64 hex characters.
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (merchant_id, location_id)
    references merchant.location(merchant_id, id) on delete restrict,
  -- Revoked means revoked BY SOMEONE. A revocation with no actor is exactly the
  -- shape an incident review cannot reason about, and the pair is one fact.
  constraint table_order_credential_revocation_complete check (
    (revoked_at is null) = (revoked_by_user_id is null)
  )
);

comment on table merchant.table_order_credential is
  'A revocable QR credential for ordering at one table. The guest URL carries the raw token; only its sha256 is stored, so this table cannot reproduce a working QR (build-v3-75).';
comment on column merchant.table_order_credential.table_id is
  'The floor-plan element id. Resolved against the served plan by the intake path, never taken from the request.';
comment on column merchant.table_order_credential.revoked_at is
  'Set when the owner kills this table''s code. Revoking one row leaves every other table''s printed code working — the ADR §9 requirement.';

-- THE lookup: the guest's token resolves a credential in one index probe.
create unique index if not exists table_order_credential_token_uidx
  on merchant.table_order_credential (token_hash);

-- ONE LIVE CREDENTIAL PER TABLE. Two live tokens would mean a QR the owner
-- believes is dead still orders. Partial, so the revoked rows of a table's
-- history do not collide with each other or with the live one.
create unique index if not exists table_order_credential_live_table_uidx
  on merchant.table_order_credential (merchant_id, location_id, table_id)
  where revoked_at is null;

-- The owner's list for a location ("which tables have a live code"), and the
-- relation a later rotation screen walks.
create index if not exists table_order_credential_table_idx
  on merchant.table_order_credential (merchant_id, location_id, table_id);

create table if not exists merchant.table_order (
  -- The order is the aggregate, so its id is this row's key: an order can start
  -- at a table exactly once, and a second link row is a defect rather than data.
  order_id uuid primary key,
  merchant_id uuid not null,
  location_id uuid not null,
  table_id uuid not null,
  credential_id uuid not null
    references merchant.table_order_credential(id) on delete restrict,
  guest_name text,
  guest_phone text,
  created_at timestamptz not null default now(),
  foreign key (merchant_id, location_id)
    references merchant.location(merchant_id, id) on delete restrict,
  -- Composite, so the link cannot point at another merchant's order even if a
  -- future writer forgets the predicate. `customer_order_merchant_id_uk` exists
  -- for exactly this (42_pos_kitchen.sql).
  foreign key (merchant_id, order_id)
    references merchant.customer_order(merchant_id, id) on delete restrict
);

comment on table merchant.table_order is
  'The link between a table-order intake and the order it wrote: which credential was scanned, which table the guest sat at, and the guest''s own name and phone. One row per order, written in the same transaction as the order (build-v3-75).';
comment on column merchant.table_order.guest_phone is
  'As the guest typed it, validated at the edge. Deliberately NOT used to mint or match a merchant.customer: a phone typed into a public form is an unverified identity.';

-- ---------------------------------------------------------------------------
-- 4 · The shared updated_at trigger, attached by hand
--
-- 60_triggers swept the catalog BEFORE these tables existed, and the sweep
-- substitutes `information_schema.columns` where a runtime lookup cannot see
-- the difference. 65_table_reservation, 67_table_state, 69_procurement and
-- 70_tender all record the same reason. Only the credential is mutable —
-- revocation is an UPDATE — so only it gets the trigger; `table_order` is
-- written once and never touched.
-- ---------------------------------------------------------------------------
drop trigger if exists touch_updated_at on merchant.table_order_credential;
create trigger touch_updated_at before update on merchant.table_order_credential
  for each row execute function public.tg_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5 · Grants and RLS
--
-- SCOPE, RLS AND GRANTS COME AFTER 90_rls, NOT BEFORE, for the reason
-- 67_table_state records at length: 90_rls has already swept the catalog, its
-- `alter default privileges` deliberately does not arm the request path, and a
-- table created after the sweep carries the equivalent predicate itself.
--
-- `api` DOES get UPDATE on the credential (revocation) and NO DELETE on either
-- table. A revoked credential is not garbage: it is the record that this table's
-- code existed and when it stopped working, and the `table_order` rows that
-- reference it would have to be deleted with it. `worker` gets the same access
-- because the renewal/cleanup jobs run there.
--
-- Both tables carry `merchant_id` AND `location_id`, so the policy is
-- 67_table_state's narrow one: a location-scoped session cannot read another
-- branch's tables or credentials. The PUBLIC intake path runs with the
-- merchant seeded from the credential's own row (the guard does that) and the
-- location narrowed to the credential's location, so a token for café A's table
-- cannot read or write café B's catalog even if the token is replayed against a
-- different merchant's host.
-- ---------------------------------------------------------------------------
grant select, insert, update on merchant.table_order_credential to api, worker;
grant select on merchant.table_order_credential to readonly;
grant select, insert on merchant.table_order to api, worker;
grant select on merchant.table_order to readonly;

do $$
declare t text;
begin
  foreach t in array array['table_order_credential','table_order'] loop
    execute format('alter table merchant.%I enable row level security', t);
    execute format('alter table merchant.%I force row level security', t);
    execute format('drop policy if exists %I on merchant.%I', t||'_scope', t);
    execute format(
      'create policy %I on merchant.%I using (merchant_id=(select umi.current_merchant()) and ((select umi.current_location()) is null or location_id=(select umi.current_location()))) with check (merchant_id=(select umi.current_merchant()) and ((select umi.current_location()) is null or location_id=(select umi.current_location())))',
      t||'_scope',t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6 · The permission that lets a console print or kill a table's code
--
-- Issuing and revoking are SETUP operations on the console's side of the house
-- (`api/merchants/:merchantId/table-order-credentials`, gated on the `dashboard`
-- product like the floor-plan and table-state screens it sits beside), so the
-- permission carries `product_key='dashboard'` — the entitlement the route itself
-- checks. `product_key`, `group_key`, `status`, `delegable` and `risk_level` are
-- written explicitly because 49_merchant_roles made all five NOT NULL and this file
-- runs after it.
--
-- `medium`, not `low`: this is the permission that decides who may put a working
-- ordering QR on a table, and a revoked code is how an abused one is stopped.
-- Delegable, because a shift manager should be able to print a replacement for a
-- table whose code was damaged.
--
-- The three grants mirror 53_location_switch_grants.sql: the platform roles, the
-- merchant roles that already exist, and the template revision the role templates
-- are snapshotted from. Without the third, a café provisioned after this migration
-- would get the permission on the template and a café provisioned before would not.
-- ---------------------------------------------------------------------------
insert into umi.permission(
  key,description,product_key,group_key,status,delegable,risk_level
) values (
  'table_order.credential.manage',
  'Issue and revoke a table''s public ordering code',
  'dashboard','table_order','active',true,'medium'
)
on conflict(key) do update set
  description=excluded.description,
  product_key=excluded.product_key,
  group_key=excluded.group_key,
  status=excluded.status,
  delegable=excluded.delegable,
  risk_level=excluded.risk_level;

insert into umi.role_permission(role_id,permission_id)
select r.id,p.id
  from umi.role r
  join umi.permission p on p.key='table_order.credential.manage'
 where r.key in ('admin','owner','manager','super_admin')
on conflict do nothing;

insert into merchant.role_permission(merchant_id,role_id,permission_id)
select mr.merchant_id,mr.id,p.id
  from merchant.role mr
  join umi.permission p on p.key='table_order.credential.manage'
 where mr.key in ('admin','owner','manager') and mr.status='active'
on conflict do nothing;

insert into umi.role_template_revision_permission(template_id,version,permission_id)
select rt.id,rtr.version,p.id
  from umi.role_template rt
  join umi.role_template_revision rtr
    on rtr.template_id=rt.id and rtr.version=rt.current_version
  join umi.permission p on p.key='table_order.credential.manage'
 where rt.key in ('admin','owner','manager') and rt.status='active'
on conflict do nothing;

insert into runtime.schema_migration(version,status)
values('build-v3-75','applied') on conflict(version) do nothing;

commit;
