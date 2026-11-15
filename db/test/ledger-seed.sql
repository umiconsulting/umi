-- Synthetic rows for database verification. No client data is required.
insert into merchant.merchant (id, name, handle)
  values ('11111111-1111-1111-1111-111111111111', 'CI Rehearsal', 'ci-rehearsal')
  on conflict (id) do nothing;
insert into merchant.customer (id, merchant_id, name)
  values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'CI')
  on conflict (id) do nothing;
insert into merchant.loyalty_card (id, merchant_id, customer_id)
  values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333')
  on conflict (id) do nothing;
insert into merchant.loyalty_stored_value_ledger (merchant_id, card_id, delta, reason)
  values ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 500, 'topup');
