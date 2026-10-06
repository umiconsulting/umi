# build-v3 cutover runbook

Status: `EXECUTED 2026-10-06 — the database and the API are live on main. The Wallet switch was
flipped, then reverted the same night and verified in both directions. The register switch is OFF
and BLOCKED on response shape.` See §8 and [`REGISTER_FLIP_PARITY.md`](./REGISTER_FLIP_PARITY.md).
Last updated: 2026-10-06.
Companion docs: [`GATED_CUTOVER_PLAN.md`](./GATED_CUTOVER_PLAN.md) (the roadmap and gates) ·
[`BACKFILL_METHODOLOGY.md`](./BACKFILL_METHODOLOGY.md) (why snapshot-rebuild, not FDW) ·
[`SECURITY_GATE.md`](./SECURITY_GATE.md) (the deployment gate) ·
[`REGISTER_FLIP_PARITY.md`](./REGISTER_FLIP_PARITY.md) (why the register switch has not flipped) ·
`docs/pilot/UMIPOS_SITE_DEVICE_INVENTORY.md` (the café's hardware).

## 0 · What this document is for

The ordered steps of the one-shot flip, written so somebody can run it at the hour it has to
run, and so nothing learned the hard way is re-derived. Every step carries its own check; a
step that has not been checked is not done.

Two halves run in one window: the **code** (main and build-v3 reconciled, deployed) and the
**database** (the new schemas built alongside the old ones, backfilled, then the login flip).
The old schemas are NOT dropped. See §4.

## 1 · Preconditions — none of these is optional

| #   | Precondition                                                                            | How it is known                                                                                         |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| P1  | The reconciliation PR is merged into `build-v3` and its CI is green                     | `reconcile/main-into-build-v3` → PR #185: lint, build-and-test, contract, gate, deploy, tokens all pass |
| P2  | `build-v3` merged into `main`, CI green, image built                                    | the deploy workflow builds on merge to main                                                             |
| P3  | A **fresh** production snapshot, off-provider, with its SHA-256, and a **restore test** | §2                                                                                                      |
| P4  | The rehearsal has run from THAT snapshot and the gate + reconcile are green             | §3                                                                                                      |
| P5  | A written rollback, and the window in which it is still true                            | §6                                                                                                      |
| P6  | Nobody else is merging to `main` or `build-v3`                                          | announce it; the window is short and silent drift is the whole risk                                     |

## 2 · The snapshot (proven 2026-10-06)

PII lives in this artifact. Keep it off the repository, off the provider, and out of chat.

The dump must include the schema set the backfill reads **plus `extensions`**, whose absence
costs 46 tables: anything using `extensions.vector` fails to create, and the failure surfaces
as foreign-key errors on unrelated tables.

```sh
# From the VPS, using the staging Postgres container's pg_dump 17 (the host has none).
docker exec -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -i \
  umi-api-test-postgres-staging-1 \
  pg_dump -Fc --no-owner --no-privileges \
    -n _migration -n comms -n core -n device -n extensions -n grow -n kitchen -n legacy \
    -n loyalty -n observability -n ops -n queue > umi_prod_snapshot_<UTC>.dump
sha256sum umi_prod_snapshot_<UTC>.dump | tee umi_prod_snapshot_<UTC>.dump.sha256
```

Restore test, in a throwaway database: create the `extensions` schema and its extensions
(`vector`, `pg_trgm`, `pgcrypto`, `unaccent`, `uuid-ossp`) **before** `pg_restore`, or the
restore leaves one benign `schema "extensions" already exists` error and nothing else.

```sql
create schema if not exists extensions;
create extension if not exists vector schema extensions;   -- and the other four
```

Then record the facts the reconcile will be measured against:

```sql
select count(*) from loyalty.cards;              -- 1053 on 2026-10-06
select count(*) from loyalty.passes;             -- 1007
select kind, count(*) from loyalty.reward_configs group by 1;   -- override 5, standard 18, upgrade 1
```

## 3 · The rehearsal (proven 2026-10-06)

On the clone, from `docs/migration/build-v3/backfill`:

```sh
BOOTSTRAP_EMAIL=<a real operator> \
  ./00_run_backfill.sh <target_db> <template_db>
```

It runs: core DDL (`00_foundation` … `60_triggers`) → the data phase (`loyalty_v3` first — it
seeds `merchant.merchant`/`customer` — then `identity loyalty commerce comms device growth`) →
`seed_rbac.sql` → the 17 POS DDL files (`30_device_pairing` … `46_platform_bootstrap`) → the
per-card override carry → cross-schema FKs and RLS (`50`, `90`, `47`, `48`, `49`, `51`, `52`,
`53`) → `reconcile_v3.sql`.

Then the gate:

```sh
psql -v ON_ERROR_STOP=1 -d <target_db> -f ../security_gate.sql
```

Green on 2026-10-06: 1053/1053 cards, 1007/1007 passes, 0 stamp drift, 236 bulk-seal events
preserved, `kind` identical to the source, the 9-visit upper tier present, the single card
override linked, 2/2 reverted redemptions carried, gate 48 structural green with the one
acknowledged platform-MFA gap.

## 4 · The production execution (executed 2026-10-06)

> ⚠️ **The runner cannot be pointed at production as written.** `00_run_backfill.sh` starts with
> `drop database if exists $DB; create database $DB template $TEMPLATE`. That is how the
> rehearsal gets an isolated target from a snapshot; on Supabase there is one database and
> nothing to clone. Everything else in the runner is a plain `INSERT … SELECT` **inside one
> database**, which is exactly what production needs.

So the production run is the same file list, applied **in place** against the production
database, in the same order, with the create-database line dropped and `seed_rbac.sql` given the
real bootstrap address. That adaptation is what ran in the window; §8 has the measured result.

What makes it safe to run in place: it is additive. The new schemas are built beside the old
ones, and `umi-cash` keeps reading `core`/`grow`/`loyalty`/`ops` — which is why nobody loses
access to the register on the night.

⚠️ **That same property is the one open liability.** Until `CASH_API_ORIGIN` is set, the register
still writes through its own Prisma handlers into the old schemas, while the dashboard, the
Wallet and every new API route read the new ones. A stamp taken on the till right now is real
money and real stamps that the new world cannot see. The split is tolerable only while the cafés
are closed; it is not a steady state.

## 5 · The flip

1. Deploy the API image built from `main`.
2. Create the login roles and rotate onto them — `apps/umi-api/db/roles/004_buildv3_login_roles.sql`
   creates `api_login` and `worker_login` (INHERIT membership of the `api`/`worker` groups; the
   worker is `BYPASSRLS`). The production worker pool still connects as `postgres` today, so this
   is a real change, not a rename.
3. Point `DATABASE_URL_APP` / `DATABASE_URL_WORKER` at those roles, set `PGSSLROOTCERT` and
   `EXPECTED_SCHEMA_VERSION`, and drop `app.tenant_id` from `runWithMerchant`.
4. **Revoke `INSERT`/`UPDATE`/`DELETE` on the old schemas; do NOT drop them.** Read-only for
   weeks, until the new world has survived a reward redemption, a Wallet push, a WhatsApp order
   and a KDS ticket. `DROP SCHEMA loyalty CASCADE` in the window is the one step that makes
   failure unrecoverable.
5. **Wallet, last and separately.** `cash.umiconsulting.co` forwards seven paths to
   `WALLET_API_ORIGIN`, route by route (`apps/umi-cash/next.config.mjs`). Every issued pass
   carries that host as its `webServiceURL` — signed in, unchangeable. Before setting
   `WALLET_API_ORIGIN`, prove the new API answers the frozen path:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' \
     https://api.umiconsulting.co/api/<handle>/passes/apple
   # 401 = the handle resolved and it reached the access check  ← what you want
   # 404 = the route is not deployed; flipping now freezes every pass
   ```

   On 2026-10-06, **before** the API cutover, production (`main`) answered **404** there; staging
   (build-v3) answered **401**. The order therefore is: API first, verify 401, then flip
   `WALLET_API_ORIGIN`. That order was followed, and then the switch was reverted — the register
   could not follow it the same night, and a Wallet reading the new schemas while the register
   wrote the old ones is worse than neither. See §8. `CASH_API_ORIGIN` (the register) flips on its
   own switch, by design, and is still off.

## 6 · Rollback

| Phase                                    | Rollback                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before the env flip                      | Nothing to roll back: the new schemas are additive and unused. Drop them, or leave them.                                                                                                                                                                                                            |
| After the env flip                       | Point `DATABASE_URL_APP`/`_WORKER` back at the previous roles. The old schemas are intact and were never written to.                                                                                                                                                                                |
| After revoking writes on the old schemas | Re-grant them. This is why the revoke happens before the drop and the drop does not happen in the window.                                                                                                                                                                                           |
| The wallet                               | With `WALLET_API_ORIGIN` unset, `cash.umiconsulting.co` serves the pass from its own Prisma handlers again — a **true** rollback before the cutover, and a **500** after it, because those handlers read schemas that no longer exist. The wallet switch and its rollback close at the same moment. |

## 7 · Traps already paid for

- **`extensions` in the dump.** Without it, 46 tables fail and the errors look like foreign-key
  violations on unrelated tables.
- **`INTERNET` and cleartext on Android.** A release APK without the permission makes no request
  at all; a device log that says `ping` works is not evidence about TCP.
- **The workstation firewall.** `firewalld` allowing only `ssh` gives ICMP through and TCP
  `No route to host` — test from the device, not from the workstation.
- **A missing `UMIPOS_CONTRACT_VERSION`** stops UmiPOS on the recovery card while the API is
  healthy.
- **A green reconcile is not a green migration.** The 2026-09-25 rehearsal moved every row and
  balanced, and the destination had nowhere to put the per-card override, the redemption
  reversal, or the meaning of the upper tier. Counts and money do not check meaning.
- **`main` has no lint workflow.** Any document merged from it arrives unformatted and fails
  `build-v3`'s required Format check.
- **The worker's healthcheck probes the web port.** `apps/umi-api/Dockerfile` ends with
  `HEALTHCHECK … fetch('http://127.0.0.1:3000/health/live')`, and `umi-worker` runs the same
  image with `command: node dist/worker.js` — a Nest application context with no HTTP listener
  at all (`src/worker.ts` says so in its first paragraph). The worker therefore reports
  **unhealthy** from its first minute forever, whether or not it is consuming queues. It does
  not restart (Docker does not act on health) and `deploy.sh` does not pass `--wait`, so nothing
  breaks — but the signal is worthless, and a real worker death looks exactly like this. The
  compose service needs its own probe or its own `disable: true`.
- **A route that exists is not a route that answers.** `register-flip.integration.ts` is the only
  thing connecting `REGISTER_ROUTES` to this app, and it compares paths, not payloads. Four of the
  register's six screens answered a different shape while that test stayed green — including the
  reward ladder, which is to say money. Measure the response before flipping a proxy:
  `scripts/umi-cash-register-parity.mjs`. Full inventory in
  [`REGISTER_FLIP_PARITY.md`](./REGISTER_FLIP_PARITY.md).

## 8 · Execution log — 2026-10-06

Everything below ran against **production**. Times are UTC.

**The snapshot.** `umi_prod_snapshot_20261006T061814Z.dump`, 9 734 906 bytes, sha256
`477ac331c89300ba76a4ff9ece3b3cff3d9e25954aa0ae8d10e5733112dfad4a` — pulled off-provider from
the VPS with the staging Postgres container's `pg_dump` 17, because the host has none. An earlier
dump from the same morning (`…T040136Z`, `d5ac5051…`) had already been restored into the QA
project and is what the rehearsal ran against.

**The backfill.** Applied in place as Supabase `postgres`: core DDL → data phase → `seed_rbac.sql`
→ the 17 POS DDL files → the per-card override carry → `50`, `90`, `47`, `48`, `49`, `51`, `52`,
`53` → `reconcile_v3.sql`. 06:18–06:21Z, **0 SQL errors**, then `01_run_post_backfill.sh`.

**What the production database holds after it**, read back from the running API:

| thing                                   | count |
| --------------------------------------- | ----- |
| `merchant.merchant`                     | 5     |
| `merchant.customer`                     | 1048  |
| `merchant.loyalty_card`                 | 1053  |
| `merchant.loyalty_wallet_pass`          | 1007  |
| of those, Apple passes carrying a token | 852   |

The `reconcile_v3.sql` assertions were green on the same run: the three `kind` shapes (override 5,
standard 18, upgrade 1), one card-level override, two reverted redemptions, 0 stamp drift. The old
schemas are intact and were never written to by the new code.

**The code.** `main` at `cb8c3ed` (PR #189), image
`ghcr.io/umiconsulting/umi-api:sha-cb8c3edc67b67831986be094c8812ee4fbd25449`, rolled with
`docker compose -p umi-api up -d` on the VPS. `/health` answers 200 through Caddy and the boot log
carries `D1 role guard OK (app = RLS-confined api, worker = BYPASSRLS worker)`. `Caddyfile`,
`Dockerfile` and `docker-compose.yml` on the box were compared against the merged tree and match.

**The Wallet switch (flipped, then reverted).** The API shipped with **no** `APPLE_*`/`GOOGLE_*`
values at all, so its pass routes would have answered 503. Thirteen credentials were merged into
`apps/umi-api/.env` and the containers recreated. Then, checked rather than assumed:

- the signer key decrypts under `APPLE_KEY_PASSPHRASE` and the APN key parses as EC;
- a throwaway pass signs through `passkit-generator` (magic `PK`), so the template, the WWDR copy
  and the pass type are all usable;
- `wallet-issuer@umi-wallet-506902.iam.gserviceaccount.com` still exchanges its key for an OAuth
  token and `3388000000023116211.elgranribera_umicash_loyalty_v2` reads back **200** — the issuer
  was never recreated, so the objects already in circulation are still addressable;
- `WALLET_API_ORIGIN=https://api.umiconsulting.co` was set in Vercel (project `umi-cash`) and the
  app **redeployed**, because `next.config.mjs` evaluates `rewrites()` at build time — setting the
  variable alone would have changed nothing;
- the frozen prefix on `cash.umiconsulting.co` now answers with `via: 1.1 Caddy` and no
  `x-matched-path`, and **a real pass was rebuilt end to end**: a `merchant.loyalty_wallet_pass`
  row for El Gran Ribera, called at `…/passes/apple/v1/passes/{passTypeId}/{serial}` with its own
  `Authorization: ApplePass <token>`, returned **200** and an 89 948-byte `.pkpass`.

**Then it was put back.** Flipping the Wallet before the register leaves the pass reading the new
schemas while the till writes the old ones, so a stamp taken on the panel never reaches the
customer's phone. The register switch was found to be blocked (see
[`REGISTER_FLIP_PARITY.md`](./REGISTER_FLIP_PARITY.md)), so `WALLET_API_ORIGIN` was **removed** and
umi-cash redeployed — `rewrites()` is evaluated at build time, so the revert is a redeploy too.
Verified both ways rather than assumed: the frozen prefix answers from umi-cash's own handler
again (`x-matched-path`, no `via:`), and a real pass re-issued through it — **200**, 94 268 bytes,
magic `PK`.

**Still open, in this order.**

1. Flip `CASH_API_ORIGIN` — the register — but not yet: the ported routes answer a different
   shape than the frozen panel reads, on four of its screens. The full inventory, the harness that
   measures it and the exit criteria are in
   [`REGISTER_FLIP_PARITY.md`](./REGISTER_FLIP_PARITY.md). Until it flips, the split in §4 is live
   — and so the Wallet switch has to stay off with it.
2. Revoke `INSERT`/`UPDATE`/`DELETE` on the old schemas. Read-only, never dropped, in this window.
3. Rotate `DATABASE_URL_APP` / `DATABASE_URL_WORKER`. Those role passwords were printed in full
   during the cutover and must be treated as exposed.
4. `umi-cash` → Cloudflare, once the Wallet and register switches make its database unnecessary.
