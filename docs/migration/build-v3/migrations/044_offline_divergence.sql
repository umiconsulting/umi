\set ON_ERROR_STOP on

-- A cash sale belongs to the till that took the money.
--
-- An offline replay still checks the device, sequence, cart identity, tender
-- and sale limits. It also records the server's own re-price. The charged total
-- stays on the sale, and the difference stays visible to the shift close.
alter table merchant.pos_committed_sale
  add column if not exists server_repriced_totals jsonb;

alter table merchant.pos_committed_sale
  add column if not exists divergence_minor_units bigint;

create index if not exists pos_committed_sale_shift_divergence
  on merchant.pos_committed_sale (merchant_id, location_id, cash_shift_id)
  where divergence_minor_units is not null;

comment on column merchant.pos_committed_sale.server_repriced_totals is
  'The server price for a trusted offline sale, kept beside the amount charged.';
comment on column merchant.pos_committed_sale.divergence_minor_units is
  'Charged total minus server total. The sale keeps the charged total.';

-- Kitchen commands can now wait in the same ordered journal. The LAN node
-- records them while the cloud is unavailable, and replay drains them in device
-- order.
alter table merchant.offline_replay_command
  drop constraint if exists offline_replay_command_command_type_check;

alter table merchant.offline_replay_command
  add constraint offline_replay_command_command_type_check
  check (
    command_type in (
      'operational.ack',
      'pos.checkout.cash',
      'pos.cart.open',
      'pos.cart.line.add',
      'pos.cart.line.update',
      'pos.cart.line.remove',
      'pos.cart.clear',
      'pos.cart.prepare',
      'pos.cart.fire',
      'pos.cart.fulfillment.set',
      'pos.cart.table.set',
      'pos.kds.command'
    )
  );
