# Offline replay authority recovery

Date: 2026-10-18

## Result

The queued account recovered after the iMin operator session ended.

The server now records two operator identities on each accepted replay:

- the original operator for attribution;
- the live operator session that authorized the replay.

## Observed failure

The iMin showed two pending sales after the operator signed out and back in.

`Synchronize now` stayed at `0%`. Each server attempt returned:

```text
500 offline replay operator authority invalid
```

The replay service authorized the live session. The database trigger then read
the original session from `operator_session_id`, found it ended, and refused the
insert.

## Change

- Add `replay_operator_session_id` to `merchant.offline_replay_command`.
- Backfill existing rows with their original session.
- Validate replay authority against the live replay session.
- Keep `operator_session_id` as the original attribution.
- Pass the live session from the service to the repository.
- Add migration `047_offline_replay_authority.sql`.

The migration ran twice on the populated staging database. Both runs succeeded.

## Verification

- API test suite: **2,043 passed**, 29 skipped.
- The service test proves the original and live session identities stay distinct.
- The migration test counts 47 forward migrations.
- The staging health check returned `Healthy`.
- The same iMin queue changed from two pending sales to `accepted: 3`,
  `conflicts: 0`, `queue: 0`.
- The iMin returned to `Online` with no unsynced badge.

## Staging image

Image:
`ghcr.io/umiconsulting/umi-api:offline-replay-authority-2.40`

API container:
`umi-api-test-api-1`

The prior staging environment file is retained at
`/home/juan/umi-api-test/.env.bak.offline-replay-authority-20261018`.

## Preserved invariants

- A device must be active and use the current credential version.
- A live operator session must hold `offline.replay`.
- The original operator remains in the command record.
- A replay keeps its command identity and ordered device sequence.
- A second replay remains a duplicate, not a second sale.

## Residual risk

- The Recovery Center still displays `In progress` after the queue reaches
  zero. Closing and reopening the screen shows the correct `Online` state.
- A production cutover must apply migration 047 before the new API image.
- A fresh LAN KDS peer test with no WAN remains open.

