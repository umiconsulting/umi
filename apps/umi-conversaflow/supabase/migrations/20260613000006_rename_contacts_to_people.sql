-- S4.3 prep: Rename platform.contacts → platform.people
-- Clear domain identity anchor. Fixes staff identity duplication.
-- Migration 20260613000006_rename_contacts_to_people.sql
--
-- Dependency audit (2026-06-14):
--   9 FK references across cash, commerce, conversaflow, platform
--   11 indexes containing 'contact'
--   App code: dashboard/server.js, conversaflow edge functions, umi-cash
--
-- Order: drop FKs → rename table → rename FK columns → recreate FKs → rename indexes

BEGIN;

-- ===========================================================================
-- 1. Drop all foreign keys referencing platform.contacts
-- ===========================================================================
ALTER TABLE cash.gift_cards                   DROP CONSTRAINT IF EXISTS gift_cards_recipient_contact_id_fkey;
ALTER TABLE cash.loyalty_accounts             DROP CONSTRAINT IF EXISTS loyalty_accounts_contact_id_fkey;
ALTER TABLE cash.otp_verifications            DROP CONSTRAINT IF EXISTS otp_verifications_contact_id_fkey;
ALTER TABLE commerce.orders                   DROP CONSTRAINT IF EXISTS orders_contact_id_fkey;
ALTER TABLE commerce.payments                 DROP CONSTRAINT IF EXISTS payments_contact_id_fkey;
ALTER TABLE conversaflow.memory_items         DROP CONSTRAINT IF EXISTS memory_items_contact_id_fkey;
ALTER TABLE platform.contact_identities       DROP CONSTRAINT IF EXISTS contact_identities_contact_id_fkey;
ALTER TABLE platform.contact_merge_candidates DROP CONSTRAINT IF EXISTS contact_merge_candidates_left_contact_id_fkey;
ALTER TABLE platform.contact_merge_candidates DROP CONSTRAINT IF EXISTS contact_merge_candidates_right_contact_id_fkey;

-- ===========================================================================
-- 2. Rename the table
-- ===========================================================================
ALTER TABLE platform.contacts RENAME TO people;

-- ===========================================================================
-- 3. Rename FK columns referencing people
-- ===========================================================================
ALTER TABLE cash.gift_cards                   RENAME COLUMN recipient_contact_id TO recipient_person_id;
ALTER TABLE cash.loyalty_accounts             RENAME COLUMN contact_id            TO person_id;
ALTER TABLE cash.otp_verifications            RENAME COLUMN contact_id            TO person_id;
ALTER TABLE commerce.orders                   RENAME COLUMN contact_id            TO person_id;
ALTER TABLE commerce.payments                 RENAME COLUMN contact_id            TO person_id;
ALTER TABLE conversaflow.memory_items         RENAME COLUMN contact_id            TO person_id;
ALTER TABLE platform.contact_identities       RENAME COLUMN contact_id            TO person_id;
ALTER TABLE platform.contact_merge_candidates RENAME COLUMN left_contact_id       TO left_person_id;
ALTER TABLE platform.contact_merge_candidates RENAME COLUMN right_contact_id      TO right_person_id;

-- ===========================================================================
-- 4. Recreate foreign keys
-- ===========================================================================
ALTER TABLE cash.gift_cards
  ADD CONSTRAINT gift_cards_recipient_person_id_fkey
  FOREIGN KEY (recipient_person_id) REFERENCES platform.people(id) ON DELETE SET NULL;

ALTER TABLE cash.loyalty_accounts
  ADD CONSTRAINT loyalty_accounts_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES platform.people(id) ON DELETE CASCADE;

ALTER TABLE cash.otp_verifications
  ADD CONSTRAINT otp_verifications_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES platform.people(id) ON DELETE CASCADE;

ALTER TABLE commerce.orders
  ADD CONSTRAINT orders_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES platform.people(id) ON DELETE SET NULL;

ALTER TABLE commerce.payments
  ADD CONSTRAINT payments_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES platform.people(id) ON DELETE SET NULL;

ALTER TABLE conversaflow.memory_items
  ADD CONSTRAINT memory_items_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES platform.people(id) ON DELETE CASCADE;

ALTER TABLE platform.contact_identities
  ADD CONSTRAINT contact_identities_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES platform.people(id) ON DELETE CASCADE;

ALTER TABLE platform.contact_merge_candidates
  ADD CONSTRAINT contact_merge_candidates_left_person_id_fkey
  FOREIGN KEY (left_person_id) REFERENCES platform.people(id) ON DELETE CASCADE;

ALTER TABLE platform.contact_merge_candidates
  ADD CONSTRAINT contact_merge_candidates_right_person_id_fkey
  FOREIGN KEY (right_person_id) REFERENCES platform.people(id) ON DELETE CASCADE;

-- ===========================================================================
-- 5. Rename indexes on platform.people (was platform.contacts)
-- ===========================================================================
ALTER INDEX IF EXISTS contacts_pkey           RENAME TO people_pkey;
ALTER INDEX IF EXISTS platform_contacts_tenant_name_idx RENAME TO platform_people_tenant_name_idx;

-- ===========================================================================
-- 6. Add person_id to platform.users
-- ===========================================================================
ALTER TABLE platform.users
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES platform.people(id) ON DELETE SET NULL;

-- Backfill: match users to people by email
UPDATE platform.users u
SET person_id = p.id
FROM platform.people p
WHERE lower(u.email) = lower(p.email)
  AND u.person_id IS NULL;

-- ===========================================================================
-- 7. Add person_id to platform.staff_members, drop duplicated identity cols
-- ===========================================================================
ALTER TABLE platform.staff_members
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES platform.people(id) ON DELETE SET NULL;

-- Backfill: match staff_members to people by name+email (best effort)
UPDATE platform.staff_members s
SET person_id = p.id
FROM platform.people p
WHERE lower(s.name) = lower(p.display_name)
  AND lower(s.email) = lower(p.email)
  AND s.person_id IS NULL;

-- Drop duplicated identity columns from staff_members
ALTER TABLE platform.staff_members
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS phone;

COMMIT;
