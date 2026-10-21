\set ON_ERROR_STOP on

-- A command group is one durable operator intent. The first intent is opening
-- a table account; its table claim, party size and account creation commit
-- through one server transaction.
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
      'pos.kds.command',
      'pos.command.group'
    )
  );
