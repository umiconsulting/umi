\set ON_ERROR_STOP on

-- The replay ledger accepted only an acknowledgement and one cash-sale command.
-- The POS now journals the cart itself, so the database must accept the same
-- finite command vocabulary as the contract.
--
-- This changes only the CHECK constraint. It is guarded, and it runs again
-- without error because the constraint is dropped before it is recreated.

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
      'pos.cart.fulfillment.set'
    )
  );
