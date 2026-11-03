\set ON_ERROR_STOP on

-- The floor plan is part of the room during an outage too. A seating, a move,
-- a merge or "served" is small, locally decidable work; making it wait for the
-- uplink turns a normal dining-room action into a failed tap.
--
-- One command type carries the operation in `payload.action`; the replayer
-- validates the selected request schema before calling the same table service
-- that serves the live POS route.
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
      'pos.table.command',
      'pos.kds.command'
    )
  );
