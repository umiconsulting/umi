-- ============================================================================
-- 014 · The café's own logo, uploaded and served by us
--
-- WHY. `merchant.merchant.logo_url` has existed since the cutover and **nothing
-- writes it**: the only logos in the system are files hand-placed in umi-cash's
-- `public/` (`/logos/{handle}-*.png`, the fallback the wallet preview and the
-- Apple/Google pass builders reach for), and a café created after the cutover
-- has none — the contract says so out loud (`schemas.ts`, MerchantMembership:
-- "a café created after cutover has none"). The owner asked for the place's
-- icon on the ticket, with the dashboard able to upload it, and that needs
-- somewhere for the bytes to live that we serve ourselves: this environment has
-- no object storage, and a receipt logo is tens of kilobytes, not megabytes.
--
-- WHAT. One row per merchant, holding the image the API serves at
-- `/api/v1/merchants/:id/branding/logo`. `logo_url` keeps its meaning and stays
-- the one field every reader already uses — the wallet pass builders, the POS
-- register shape (`register-shapes.json`: `logoUrl:string`) — because the upload
-- sets it to that URL. Nothing that reads a logo today has to learn a new field.
--
-- Note for whoever wires the readers: the Apple pass builder resolves a relative
-- `logo_url` against umi-cash's origin (`loadAsset(url, origin)`), so the value
-- this migration's API writes must be an ABSOLUTE url, or the pass would fetch
-- the api's path from the wrong host.
-- ============================================================================

create table if not exists merchant.merchant_branding_logo (
  -- The merchant IS the key: one logo per café, and a second upload replaces the
  -- first rather than accumulating.
  merchant_id uuid primary key
    references merchant.merchant(id) on delete cascade,
  -- What the API may serve it as. Two types a thermal printer and a wallet pass
  -- both accept; anything else is refused before it is stored.
  content_type text not null check (content_type in ('image/png', 'image/jpeg')),
  -- The bytes themselves. 256 KiB is generous for a logo and small enough that
  -- one row cannot hurt the database.
  bytes bytea not null check (octet_length(bytes) between 1 and 262144),
  -- The identity the `ETag` and the wallet builders key on.
  sha256 bytea not null check (octet_length(sha256) = 32),
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  uploaded_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references umi.user(id) on delete set null
);

comment on table merchant.merchant_branding_logo is
  'The café''s own logo, uploaded from the dashboard. The API serves it at the merchant''s branding URL, which is what merchant.logo_url points at.';

-- The ten tables that missed 60_triggers' sweep taught this: a table created
-- after that file needs its own `updated_at` trigger, or the column stops being
-- true the moment the row is written a second time.
drop trigger if exists touch_updated_at on merchant.merchant_branding_logo;
create trigger touch_updated_at before update on merchant.merchant_branding_logo
  for each row execute function public.tg_touch_updated_at();

alter table merchant.merchant_branding_logo enable row level security;
alter table merchant.merchant_branding_logo force row level security;
drop policy if exists merchant_isolation on merchant.merchant_branding_logo;
create policy merchant_isolation on merchant.merchant_branding_logo
  using (merchant_id = (select umi.current_merchant()))
  with check (merchant_id = (select umi.current_merchant()));

-- The request path owns this row: it uploads, replaces and removes it.
revoke all on merchant.merchant_branding_logo from public, readonly;
grant select, insert, update, delete on merchant.merchant_branding_logo to api;
