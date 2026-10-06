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

⚠️ **Order matters more than it did on the night.** `78_customer_pass_metadata.sql` adds
`merchant.customer.device`/`os` and `merchant.loyalty_card.pending_tier1`, and the API image
that ships with the register-parity port **reads all three**. Applying the DDL after the image
rolls turns the customer list, the customer detail and every scan into a 500. So:

1. **Apply `78_customer_pass_metadata.sql` to production first**, on its own, and read the carry
   back. Additive and inert — nothing reads the columns until the new image is up.
   ☑ **Executed 2026-10-06 10:26Z.** Measured back: `device`/`os` on **1019 of 1048** customers,
   `pending_tier1 > 0` on **3** cards (7 carried the key; 4 had already counted down to 0 as their
   banked rewards were handed over), ledger row `build-v3-78`.

   ⚠️ **STEP 1b, WHICH IS NOT OPTIONAL: bump `EXPECTED_SCHEMA_VERSION` in
   `apps/umi-api/.env` on the VPS to `build-v3-78` in the same breath.** `/health` compares that
   variable against the newest `runtime.schema_migration` row, so writing 78 while the env still
   said 77 turned the production health endpoint into `503 Unready` — `db: true, redis: true`,
   `schema.compatible: false`. On this run the window was ~2 minutes, it was visible only to
   `/health` (Caddy, the tills and the dashboard read their own databases and never noticed), and
   it closed when the deploy recreated the containers with the corrected env. **A near-miss, not
   a harmless one:** the same mismatch on a monitored or autoscaled target takes the fleet out of
   rotation. The DDL and the env bump are one step.

2. **Roll the API image** from `main` (the parity port). This is safe with the register still
   unflipped, and it fixes a live defect on its own: the dashboard's Settings → Rewards save
   reaches umi-api today, and the old `upsertRewardConfig` retired **every** active reward row —
   at El Gran Ribera, saving that screen silently deleted the café's 9-visit tier. The port also
   makes the ladder's cycle resolve to the upper tier, so 23 of El Gran Ribera's 592 customers
   read a different cycle number on the dashboard than they did from the till's cache. That is a
   visible change on correct data; tell the owner before it lands.
   ☑ **Executed 2026-10-06 10:28Z.** `main` at `3baabca`, image
   `ghcr.io/umiconsulting/umi-api:sha-3baabca214aae68cf440b476744b8090aff54d72`, `/health`
   `{"status":"ok","state":"Healthy"}`, `schema.compatible: true`. Read back through the live API
   with a real café credential: `elgranribera`'s Rewards screen answers `active` 7 → capuccino
   **and `upgrade` 9 → latte o frappe** (it answered `upgrade: null` before), the per-card override
   on `EGR-6659949340` answers `customReward` **and** `baseReward.rewardName: "Capuccino"`,
   `device`/`os` are populated from the new columns, and `?days=7` returns a 7-day window.
   The parity harness is green on **both** cafés — 10 of 10 comparable routes — with the register
   switch still off.
3. **Apply `79_cycle_anchor.sql`, and bump `EXPECTED_SCHEMA_VERSION` to `build-v3-79` with it —
   then roll the image that reads it.** This is the step that makes the register flippable:
   `merchant.loyalty_card` gains the two anchors that let the cycle survive an early cash-out and
   a threshold that moved (`cycle_anchor`, `rewards_earned`), a canje gains `cycle_reset`, and the
   scan gains the `REDEEM_BASE` action the register's customer screen has always called.

   Two things to know before running it:

   - **The carry must be verified, not assumed.** `backfill/verify_cycle_anchor.sh` builds a
     legacy twin, re-applies the file and asserts that the derived numbers reproduce the till's
     — CI cannot, because its gate builds a pristine database where the carry never runs. Run it
     first; it exits non-zero on any mismatch.
   - The carry is computed from `loyalty.cards` (the old cache) and the ACTIVE reward config, and
     the derived numbers reproduce the till for **1053 of 1053** cards. Read them back the same
     way 78's carry was read back.

4. Flip `CASH_API_ORIGIN` — the register. ☑ **Executed 2026-10-06 12:16Z**, and the Wallet switch
   followed it at 12:19Z (see §9). The legacy schemas are now frozen: nothing writes them.
5. Revoke `INSERT`/`UPDATE`/`DELETE` on the old schemas. Read-only, never dropped, in this window.
   ☐ outstanding.
6. Rotate `DATABASE_URL_APP` / `DATABASE_URL_WORKER`. Those role passwords were printed in full
   during the cutover and must be treated as exposed. ☐ outstanding.
7. `umi-cash` → Cloudflare, once the Wallet and register switches make its database unnecessary.
   ☐ outstanding.

## 9 · The flip, and the four bugs that only appeared once it was exercised

Register and Wallet were flipped together on 2026-10-06, before opening, and each step below was
**verified rather than assumed**. What follows is not the plan; it is what happened.

**The flips.** `CASH_API_ORIGIN` set in Vercel (project `umi-cash`) plus a redeploy — `rewrites()`
is evaluated at build time, so setting the variable alone changes nothing. Verified by header:
requests to `cash.umiconsulting.co/api/…` answer `via: 1.1 Caddy` with no `x-matched-path`, meaning
Caddy serves the API rather than the local handler. `WALLET_API_ORIGIN` set 3 minutes later and
verified the same way on a **real pass**: 200, `application/vnd.apple.pkpass`, 89 956 bytes, magic
`PK`. Passes for all four cafés with issued passes render through the API.

**Why they had to go together, in that order.** With the register flipped and the Wallet not, the
till writes the new schemas while the customer's pass is still rendered from the frozen ones — every
scan would leave the pass stale. The window was deliberately 3 minutes, before opening.

**The rehearsal, before any of it.** A real register session against production, on a throwaway card,
driving `VISIT`, `REDEEM_BASE` and a top-up through the flipped origin. Numbers checked against
umi-cash's own rules at every step (anchor 8, cycle 0/9, `cycle_reset` marker, balance). Every row
created was deleted; the ledger is append-only, so the top-up was **compensated** with an
`adjustment` of the same magnitude and a note, and the card was blocked so it cannot appear in a
café's customer list.

Then the four things no test had caught, all found by exercising it:

| what                                     | how it showed                                | what it was                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| the birthday line on every pass          | reported from a phone                        | `renderData` handed the café's configured `birthday_reward_name` to both builders unconditionally; all five cafés have the name set with the feature OFF and zero grants, so **1 007 passes** grew a "REGALO DE CUMPLEANOS" row. Both legacy paths gated it on an active grant.                  |
| "agregar sellos" never reached the phone | reported from a phone, with the log          | `creditSeals` wrote the card row only when the credit crossed a threshold, and never wrote a moment. Apple answers `passesUpdatedSince` by comparing that row, so the phone asked, heard 204, and showed nothing — no stamp, no notification, because a 204 delivers no `changeMessage`.         |
| every Android refresh 404'd              | the API log, on the first write              | the object id was **constructed** (`…card_<uuid>`) instead of read from the pass row (`…card_<cuid>`); 0 of 155 matched. Fixing the URL was not enough — the PATCH **body** still carried the minted id, and Google names the body's id in its error, so one log line carried two different ids. |
| a café-wide resync hung with no error    | it never answered, 8 minutes in, at 0.3% CPU | `req.setTimeout` only arms once the http2 request has a stream, so a connection that never establishes leaves the promise pending forever and the batch — and the refresh — never settles. A push is a signal: there is now a hard deadline on the whole attempt.                                |

**The Android fleet.** 155 Android objects had been stale since the Wallet switch. After the id fix,
`?platform=google` refreshed them per café: **92 of 108** at El Gran Ribera and **41 of 44** at
Kalalacafe. The 19 that remain are rows pointing at objects that were never created — the customer
tapped "add to Wallet" and never finished — and they are now marked `removed` instead of reported as
failures on every refresh.

**One thing learned about this API's own front door.** A café-wide resync answers **502** to the
client and completes anyway: Kalalacafe's own run logged `status 200, ms 14643`, and the proxy in
front had already given up at 10 seconds. The counts in that response are lost, not the work. The
same call now takes `?platform=apple|google`, which is the difference between ~100 object PATCHes
and 449 APNs round trips.
