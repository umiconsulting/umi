-- 51 · Manager card credential for point-of-sale elevation.
--
-- PRE-CUTOVER PLACEMENT. It arrived as a file in `migrations/` while the DDL was
-- still open. `00_run.sh` applies the numbered files only, and CI runs
-- `test:integration:schema` against that pristine build BEFORE any migration, so
-- the backend read a relation no pristine database carried. See 49 for the rule.
--
--
-- A manager card (magnetic stripe or fob) is an alternative to typing the
-- manager PIN when approving a void, a refund or another elevated action at a
-- till. It is additive: the PIN keeps working exactly as before, and a staff row
-- with no card behaves as it does today.
--
-- Why a card at all. The PIN is memorised and four to eight digits long, and it
-- is typed in front of whoever asked for the approval. A card is a possession
-- factor, is faster at a counter, and cannot be read over a shoulder. The same
-- storage shape as the PIN is used deliberately: a keyed lookup value to find
-- the row, plus a salted hash to verify it, so no reviewer has to reason about
-- two different credential schemes.

-- ---------------------------------------------------------------------------
-- 1 · GUARDED. Every statement states what it expects to find.
-- ---------------------------------------------------------------------------
alter table merchant.staff add column if not exists manager_card_lookup text;
alter table merchant.staff add column if not exists manager_card_salt text;
alter table merchant.staff add column if not exists manager_card_hash text;

-- ---------------------------------------------------------------------------
-- 2 · The lookup is unique inside one merchant, exactly like the operator PIN
--     lookup. A partial index, because most staff carry no card and NULL must
--     not collide with NULL.
-- ---------------------------------------------------------------------------
create unique index if not exists staff_merchant_manager_card_lookup_key
  on merchant.staff (merchant_id, manager_card_lookup)
  where manager_card_lookup is not null;

-- ---------------------------------------------------------------------------
-- 3 · A card is either fully present or fully absent. A half-written credential
--     would find a row and then fail to verify it, which reads as "wrong card"
--     rather than "bad data".
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_manager_card_complete'
  ) then
    alter table merchant.staff add constraint staff_manager_card_complete check (
      (manager_card_lookup is null and manager_card_salt is null and manager_card_hash is null)
      or
      (manager_card_lookup is not null and manager_card_salt is not null
       and manager_card_hash is not null)
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · An elevation approved by card must SAY so. The grant and its audit event
--     are the record of who authorised a void or a refund, and recording a card
--     approval as a typed PIN would make that record untrue.
-- ---------------------------------------------------------------------------
alter table runtime.elevation_grant drop constraint if exists elevation_grant_method_check;
alter table runtime.elevation_grant add constraint elevation_grant_method_check
  check (method in ('manager_approval', 'manager_card', 'operator_pin'));
