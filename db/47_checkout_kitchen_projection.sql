begin;

-- The checkout transaction creates the kitchen projection with the RLS-bound API role.
-- KDS state changes continue through the KDS repository and the worker role.
grant insert on
  merchant.kitchen_order_item,
  merchant.kitchen_event
to api;
grant insert,update on merchant.kitchen_order to api;

insert into runtime.schema_migration(version,status)
values('build-v3-47','applied') on conflict(version) do nothing;

commit;
