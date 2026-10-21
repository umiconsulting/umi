\set ON_ERROR_STOP on

-- A replay conflict is updated when the same command is retried or when an
-- operator acknowledges it. The API role has INSERT, SELECT and DELETE on this
-- table, but no UPDATE privilege. Grant only the columns the replay service
-- writes, not the whole table.

grant update (
  last_observed_at,
  classification,
  guidance_code,
  blocks_following,
  resolution_state,
  resolution_acknowledged_at
) on merchant.offline_replay_conflict to api;
