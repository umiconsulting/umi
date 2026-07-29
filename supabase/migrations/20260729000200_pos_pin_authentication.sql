-- UmiPOS personal PIN lookup.
--
-- The keyed lookup hash lets the API identify one staff member without an
-- email address. The existing salted scrypt hash remains the PIN verifier.
-- Existing PINs can migrate after their next successful verification.

alter table tenant.staff
  add column operator_pin_lookup_hash text,
  add constraint staff_operator_pin_lookup_hash_ck
    check (
      operator_pin_lookup_hash is null
      or operator_pin_lookup_hash ~ '^[a-f0-9]{64}$'
    );

create unique index staff_operator_pin_lookup_uq
  on tenant.staff (business_id, operator_pin_lookup_hash)
  where operator_pin_lookup_hash is not null;

comment on column tenant.staff.operator_pin_lookup_hash is
  'HMAC-SHA-256 lookup tag for one tenant-scoped operator PIN. The API secret is not stored here.';
