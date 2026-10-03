# Local seeder landscape: research finding

Date: 2026-09-29. Scope: how a local development database receives its data, and which
path yields a Dashboard administrator.

Labels: **documented fact**, **source-backed tradeoff**, **inference**, **UNVERIFIED**.

## Method

- Tool: `docker` 29.8.1, `psql` 17.10 inside the container `umi-bv3-pg`, `node` v24.21.0,
  `zsh`.
- Ladder rung: **rung 3**, the repository and its source. No web page owns a fact about
  this repository, so rungs 1 and 2 do not apply.
- The work was read-only. Every query was a `SELECT`. No seed script ran. No database
  was dropped or created.
- Step 0 answer: six seeding paths already exist in the repository. The task is to
  compare them. A new tool is not necessary.
- Persistence record: a delegated background agent did not receive its task. The first
  attempt and the second attempt both returned an empty task. The work moved inline.

## 1. The question

**documented fact** A local database serves three readers: the API on port 4001, the
Dashboard on port 4000, and the native till. Source: `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md:14`.

**documented fact** The API reads its database from `DATABASE_URL_APP`. In this working
copy that value is `umi_backfill_v3` on 127.0.0.1:4003. Source: `apps/umi-api/.env:15`.

**inference** A local database is therefore correct only when the account that a person
uses can sign into the Dashboard. A database with data but no sign-in account fails the
test that matters.

## 2. Every seeding path

| Path                  | Command                                                                    | Target container               | Target database                     | Destructive  | Idempotent | Dashboard admin                                    |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------ | ----------------------------------- | ------------ | ---------- | -------------------------------------------------- |
| Backfill              | `bash docs/migration/build-v3/backfill/00_run_backfill.sh <db> <template>` | the host `psql` target         | any name, default `umi_backfill_v3` | yes          | yes        | only when `BOOTSTRAP_EMAIL` matches a real account |
| Local compose stack   | `docker compose -f deploy/local/compose.yml up -d`                         | `umi-buildv3-local-postgres-1` | `umi_transition_rehearsal_20260901` | on `down -v` | no         | no, and the seed files are absent                  |
| Contributor reset     | `pnpm db:reset -- --yes`                                                   | found by port                  | the value of `DATABASE_URL_APP`     | yes          | no         | no before this change, yes after                   |
| POS demo seed         | `pnpm umi-pos:demo-seed`                                                   | `umi-gate2f-postgres`          | `umi_gate2f`                        | no           | yes        | no                                                 |
| POS local access seed | `pnpm umi-pos:local-access-seed`                                           | `umi-gate2f-postgres`          | `umi_gate2f`                        | no           | yes        | no                                                 |
| Pilot bootstrap       | `pnpm pilot:bootstrap`                                                     | the pilot compose stack        | the pilot database                  | no           | yes        | it creates an owner, not a platform role           |

Sources: `scripts/local-reset.sh:137`, `deploy/local/compose.yml:42`,
`scripts/umi-pos-demo-seed.sh:5`, `scripts/umi-pos-local-access-seed.sh:4`,
`scripts/umipos-pilot-bootstrap.sh:7`.

## 3. What makes a Dashboard administrator

**documented fact** In build-v3 a café role is employment. It lives on
`merchant.staff.role_id`. Source: `apps/umi-api/src/modules/auth/rbac.sql.ts:19`.

**documented fact** Cross-merchant reach is a **platform grant**. It is a row in
`umi.user_role` joined to a row in `umi.role` with `is_platform` true, and it is live only
while `revoked_at` is null and the grant has not expired. Source:
`apps/umi-api/src/modules/auth/rbac.sql.ts:31`.

**documented fact** The merchant picker lists every active café when the caller holds a
platform grant. Otherwise it lists only cafés where the caller holds an active
`merchant.staff` row. Source: `apps/umi-api/src/modules/merchants/merchants.repository.ts:234`.

**inference** A platform grant alone is not sufficient. The account also needs a
`password_hash`. The sign-in query selects on `password_hash IS NOT NULL`. Source:
`apps/umi-api/src/modules/auth/auth.repository.ts:456`.

**documented fact** The password scheme is `scrypt-sha256-v1`: `scrypt(password, salt, 64)`
in hex, with a 16-byte hex salt. Source:
`apps/umi-api/src/shared/auth/password.service.ts:24`.

## 4. The backfill path

**documented fact** `00_run_backfill.sh` names the first platform administrator through
`BOOTSTRAP_EMAIL`. Source: `docs/migration/build-v3/backfill/00_run_backfill.sh:10`.

**documented fact** The default value is `bootstrap@localhost.invalid`, an address that
matches no account. Source: `docs/migration/build-v3/backfill/00_run_backfill.sh:28`.

**documented fact** `seed_rbac.sql` matches the address against `umi.user` by email, and
inserts the `super_admin` grant. Source:
`docs/migration/build-v3/backfill/seed_rbac.sql:101`.

**documented fact** An address that matches no account grants nothing and raises nothing.
The script warns only when `BOOTSTRAP_EMAIL` was unset, and it reports failure only when an
address was given and matched nothing. Source:
`docs/migration/build-v3/backfill/00_run_backfill.sh:67`.

**source-backed tradeoff** The comment in that script records the cost. On 2026-08-18 a
clone backfilled with no SQL error, and 38 routes then answered 404. Source:
`docs/migration/build-v3/backfill/00_run_backfill.sh:60`.

**documented fact** The owner decision of 2026-07-21 replaced "admin on every café" with one
platform grant. The legacy memberships of `hola@umiconsulting.co` are deliberately not
carried. Source: `docs/migration/build-v3/backfill/backfill_identity.sql:121`.

**inference** A local copy that came from the backfill keeps the legacy memberships in
place. That is why the merchant picker showed one café: the café rows survived, and the
replacement grant did not.

## 5. The two in-repo gaps that block a new machine

### 5.1 The local compose stack cannot restore

**documented fact** `deploy/local/compose.yml` mounts `./seed` read-only and runs
`postgres-init.sh` on the first start. Source: `deploy/local/compose.yml:42`.

**documented fact** `postgres-init.sh` exits 1 when `roles.sql` or the dump is absent.
Source: `deploy/local/postgres-init.sh:9`.

**documented fact** The directory `deploy/local/seed/` holds one file, `.gitignore`. The
dump and the roles file are not present.

**inference** The documented reseed command `docker compose down -v` therefore destroys the
volume and then refuses to build a new database. Source: `deploy/local/compose.yml:16`.

### 5.2 The local reset path creates no sign-in account

**documented fact** `scripts/umi-pos-demo-seed.sh` inserts `umi.user` rows with four columns:
`id`, `email`, `full_name`, `status`. Source: `scripts/umi-pos-demo-seed.sh:223`.

**documented fact** The demo seed and the access seed never write `password_hash`. Two other
scripts do write it: the backfill at
`docs/migration/build-v3/backfill/backfill_identity.sql:67`, and the Gate 5A fixture at
`scripts/umi-pos-gate5a-live-fixture.sql:42`.

**documented fact** The pristine chain inserts no `umi.user` row at all. Command:
`grep -rn "insert into umi.user" docs/migration/build-v3/*.sql` returns nothing.

**inference** A database built by `pnpm db:reset` has no account that can sign into the
Dashboard, whatever its roles are. The backfilled copy differs: the backfill carries the
credentials, and 8 of its 9 accounts hold a hash.

**inference** This narrows the fault. A backfilled database has sign-in accounts and may lack
the platform grant. A rebuilt database lacks both.

**documented fact** The demo seed grants `super_admin` to `platform-admin@umipos.local`.
Source: `scripts/umi-pos-demo-seed.sh:277`.

**documented fact** That account is created with status `suspended`, and the script prints
that it "has no café PIN and remains suspended". Sources:
`scripts/umi-pos-demo-seed.sh:232`, `scripts/umi-pos-demo-seed.sh:742`.

**inference** The only platform grant that a local seed creates belongs to an account that
cannot sign in. The grant is therefore inert.

## 6. Names that disagree

**documented fact** Three container names appear in the repository.

| Source                                                                     | Name                           |
| -------------------------------------------------------------------------- | ------------------------------ |
| `scripts/umi-pos-demo-seed.sh:5`, `scripts/umi-pos-local-access-seed.sh:4` | `umi-gate2f-postgres`          |
| `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md:26`                       | `umi-buildv3-local-postgres-1` |
| the running stack, measured 2026-09-29                                     | `umi-bv3-pg`                   |

**documented fact** The playbook names database `umi_transition_rehearsal_20260901`.
Source: `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md:16`.

**documented fact** `apps/umi-api/.env` points the API at `umi_backfill_v3`. Source:
`apps/umi-api/.env:15`.

**inference** A newcomer reads two different database names and three different container
names. Only `scripts/local-reset.sh:96` resolves the container by port, so the other
scripts need an environment variable that nobody documents.

## 7. Live measurements

Measured on 2026-09-29 against `umi_backfill_v3` in `umi-bv3-pg`.

| Item                        | Value                      |
| --------------------------- | -------------------------- |
| `umi."user"` rows           | 9                          |
| rows with a `password_hash` | 8                          |
| `umi.user_role` rows        | 1 (after the manual grant) |
| `merchant.staff` rows       | 8                          |
| `merchant.merchant` rows    | 5                          |

**documented fact** Before the manual grant, `umi.user_role` held 0 rows and `umi.audit_log`
held 0 rows. `seed_rbac.sql` writes the only `grant` audit event in the repository. Source:
`docs/migration/build-v3/backfill/seed_rbac.sql:112`.

**inference** The empty `umi.audit_log` proves that the seed never ran against this copy.

## 8. Options

| Option                           | What it does                                                                                                                         | Cost                                  | Risk                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------- |
| A. Repair in the seeder (chosen) | A new idempotent script grants the platform role and can create the account and its password. `scripts/local-reset.sh:194` calls it. | small; one script and two documents   | low; the script stops when the address matches no account                              |
| B. Wake the demo account         | Give `platform-admin@umipos.local` a password and set its status to `active`                                                         | small                                 | the demo seed is shared with the POS path, so a change touches two products            |
| C. Rebuild the compose seed      | Put `roles.sql` and the dump back into `deploy/local/seed/`                                                                          | large; the dump is a release artifact | the file is a snapshot. It ages, and a fresh build from the chain is the better source |

**source-backed tradeoff** Option A keeps one source of truth. The grant stays in
`seed_rbac.sql`, and the new script only supplies the address that the seed cannot guess.

**source-backed tradeoff** Option B changes a script that two products share. The POS path
depends on the current status text.

**inference** Option C is the only option that makes `deploy/local/compose.yml` work as its
comment describes. The other two do not touch that fault.

## 9. Scientific research check

This check ran before the recommendation in section 8 was adopted. The skill is
`.agents/skills/scientific-research-check/SKILL.md`.

**Question being decided.** How does a local development database receive a platform
administrator? Three options were open: repair the seeder, wake the demo account, or rebuild
the compose seed.

**Primary sources checked.**

- PostgreSQL 17, `INSERT` reference. It defines `conflict_target` as
  `( { index_column_name | ( index_expression ) } [, ...] )`. Source:
  https://www.postgresql.org/docs/17/sql-insert.html. Ladder rung 1.
- Node.js, `crypto` reference. It defines `crypto.scryptSync(password, salt, keylen[, options])`.
  Source: https://nodejs.org/api/crypto.html. Ladder rung 1.
- The repository: `apps/umi-api/src/shared/auth/password.service.ts:24`,
  `apps/umi-api/src/modules/auth/rbac.sql.ts:31`,
  `docs/migration/build-v3/backfill/seed_rbac.sql:101`. Ladder rung 3.
- No academic source applies. This decision is not performance-sensitive, and it adds no
  service and no boundary.

**Facts established by the sources.**

- **documented fact** A conflict target accepts an index expression. Source: the PostgreSQL
  17 reference above.
- **documented fact** The only unique index on `umi."user"` is `user_email_lower_uq`, on
  `lower(email)`. Measured with `pg_indexes` on 2026-09-29.
- **documented fact** The API hashes a password with `scrypt(password, salt, 64)` and a
  16-byte hex salt. Sources: `apps/umi-api/src/shared/auth/password.service.ts:24`, and the
  Node.js reference above.
- **documented fact** The repository forbids a request path that creates a platform
  administrator. Source: `docs/migration/build-v3/backfill/seed_rbac.sql:29`.

**Relevant tradeoffs.**

- **source-backed tradeoff** An out-of-band path that creates the first administrator is
  normal practice. PostgreSQL, Kubernetes, Vault and GitLab each use one. Each documents a
  retirement step. Source: `docs/migration/build-v3/backfill/seed_rbac.sql:27`.
- **source-backed tradeoff** A committed default password is weak. The repository already
  accepts one for local work: the playbook documents `Umi2026!` for the fixtures. Source:
  `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md:22`.
- **inference** A script that refuses an unmatched address is stronger than a seed that
  ignores one. That silence is the defect that started this research.

**Umi-specific conclusion.** Take Option A. Keep the grant in `seed_rbac.sql`. Add one
idempotent script that supplies the address and proves the result. Do not change the demo
seed, because two products share it. Do not rebuild the compose seed, because a snapshot
ages.

**Criteria that would invalidate this conclusion later.**

1. A supported command appears that creates the first administrator with no script.
2. The platform grant leaves `umi.user_role`.
3. The demo seed becomes the single local source of accounts.
4. `db:reset` gains an administrator step in another place.

## 10. Open items

1. **documented fact** `deploy/local/seed/` is empty, so the compose reseed path cannot work.
2. **documented fact** No seed writes a Dashboard password.
3. **documented fact** The container names and the database names disagree across three files.
4. **documented fact** `docs/migration/build-v3/46_platform_bootstrap.sql:33` gives
   `super_admin` every permission, but no file grants the role. A pristine build has no
   administrator.
5. **UNVERIFIED** This report did not run `scripts/local-reset.sh`. That script drops a
   database. The new step was verified alone, against a disposable copy.
