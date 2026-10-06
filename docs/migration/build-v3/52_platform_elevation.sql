-- 52 · Step-up authentication for a platform operator acting inside a merchant.
--
-- PRE-CUTOVER PLACEMENT. It arrived as a file in `migrations/` while the DDL was
-- still open. `00_run.sh` applies the numbered files only, and CI runs
-- `test:integration:schema` against that pristine build BEFORE any migration, so
-- the backend read a relation no pristine database carried. See 49 for the rule.
--
--
-- A super_admin or developer reaches every merchant through a platform grant
-- rather than through employment, so `merchant_access.membership_id` is null for
-- them. That is the correct model for support work, but it means the strongest
-- identity on the platform can act inside a café having proved nothing beyond a
-- session cookie minted earlier.
--
-- PCI DSS v4.0 8.4.2 exempts cashier accounts on a point-of-sale terminal from
-- multi-factor authentication precisely because they see one card at a time. A
-- platform operator is the opposite of that, so the obligation lands here rather
-- than at the counter: strong authentication at the door to a merchant, and an
-- ordinary PIN once inside. It is also the only place it can be done without
-- slowing down a queue.
--
-- A grant is deliberately short lived and per merchant. Assuming café A must not
-- silently carry authority into café B.

create table if not exists runtime.platform_elevation (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references umi.user(id) on delete cascade,
  merchant_id  uuid not null references merchant.merchant(id) on delete cascade,
  granted_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  constraint platform_elevation_window_ck check (expires_at > granted_at)
);

-- The read on the hot path: "does this operator hold a live grant for this café".
create index if not exists platform_elevation_active_idx
  on runtime.platform_elevation (user_id, merchant_id, expires_at)
  where revoked_at is null;
