\set ON_ERROR_STOP on

-- The resolution action must know which refused step it may discard. Financial
-- commands are never resolved automatically by this path.
alter table merchant.offline_replay_conflict
  add column if not exists command_type text;

update merchant.offline_replay_conflict
set command_type='pos.table.command'
where command_type is null
  and classification='table_unavailable';
