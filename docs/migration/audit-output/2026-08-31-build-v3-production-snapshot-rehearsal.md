# Build-v3 production snapshot rehearsal — 2026-08-31

## Scope

This rehearsal used a new Supabase production dump.

The raw dump stays outside the Git workspace. It contains production PII and credentials.

- Dump: `/home/jc/umi-local-dumps/umi-production-20260901T052800Z.dump`
- SHA-256: `08d993bbe251347ec69155426b4401bd50f8b0ad37ee0adf9b4b825f96c56190`
- Source PostgreSQL: `17.6`
- Dump tool: `pg_dump 17.11`
- Archive entries: `1307`
- Retention: Pending an owner decision. Do not delete the dump.
- Restorer: Codex, under direct user instruction on the local workstation.

## Isolation

The rehearsal used a separate PostgreSQL 17 container.

- Container: `umi-transition-postgres17`
- Port: `127.0.0.1:5234`
- Memory limit: `1 GiB`
- Source database: `umi_prod_snapshot_20260901`
- Target database: `umi_transition_rehearsal_20260901`

The existing `umi_build_v3` database stayed unchanged.

The restore selected the nine source schemas used by the build-v3 backfill:

- `comms`
- `core`
- `device`
- `grow`
- `kitchen`
- `loyalty`
- `observability`
- `ops`
- `queue`

Supabase service schemas were not restored. The transition does not read them.

## Transition result

The canonical runner completed without a SQL error:

```sh
BOOTSTRAP_EMAIL=<existing-production-user> \
  ./00_run_backfill.sh \
  umi_transition_rehearsal_20260901 \
  umi_prod_snapshot_20260901
```

The target reached `build-v3-48`. It has one active `super_admin` grant.

## Reconciliation

| Fact                            | Source | Target |
| ------------------------------- | -----: | -----: |
| Merchants                       |      5 |      5 |
| Customers                       |    853 |    853 |
| Contacts                        |    864 |    864 |
| Loyalty cards                   |    858 |    858 |
| Orders                          |     53 |     53 |
| Order items                     |     76 |     76 |
| Wallet passes with Apple tokens |    696 |    696 |
| Stored value, minor units       | 80,500 | 80,500 |

The reconcile reported these results:

- Money drift: `0`
- Per-order total mismatches: `0`
- Gift-card row mismatches: `0`
- Gift-card ledger mismatches: `0`
- Wallet token mismatches: `0`
- Stamp drift by card: `0`
- Cross-merchant location references: `0`
- Missing merchant handles for issued passes: `0`

## Security gate

`security_gate.sql` passed.

- Green structural checks: `45`
- Acknowledged environment gaps: `3`
- Unmeasured login-role check: `1`
- Behavioral checks: passed

The local container caused the three environment warnings. They cover statement logging and bootstrap MFA.

The login-role verifier check was not measured before the harness roles were installed.

## Integration suite

The first run found stale snapshot constants in `identity-normalization.integration.ts`.

The new source has 864 contacts, eight valid repairs, and two valid nulls. It has no invalid normalization outcome.

The named snapshot constants were updated. The focused test then passed `8/8`.

The full migration suite passed:

```txt
Test Files  4 passed (4)
Tests       24 passed (24)
Smoke       100 routes, 0 unexpected results
```

The smoke used local test secrets. It did not prove continuity for the production QR secret or wallet signer.

## Decision

The current build-v3 transition is lossless for the measured production snapshot.

Do not promote from this rehearsal alone. Production configuration, MFA, secrets, and real hardware still need their gates.
