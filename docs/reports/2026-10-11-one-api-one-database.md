# One API, one database

Date: 11 October 2026, 23:30–00:20 MST. Every measurement in the two reports next to this one was
taken against a **second** API on `:4013` and a clone of the demo database
(`umi_pos_estacion_design_20261008`), because that is where the till was pointed. The owner asked for
one local API and one local database, and this is what it took — including two traps that only appear
when an environment is consolidated.

## What the working setup was

| Who                                                  | API                      | Database                           |
| ---------------------------------------------------- | ------------------------ | ---------------------------------- |
| Dashboard (`:4000`, Vite) and the owner's `pnpm dev` | `:4001` (nest `--watch`) | `umi_local`                        |
| The iMin till (`adb reverse`)                        | `:4013` (a harness)      | `umi_pos_estacion_design_20261008` |

Two APIs, two databases, two `JWT_SECRET`s, and two different answers to the same question. The owner's
own API had also stopped reloading: its `nest --watch` supervisor was alive from 8 October, but the
child it had started at **18:46** was still serving while the code underneath it had been rebuilt at
22:42 — so the fixes measured on `:4013` were not running on `:4001` at all.

## What it is now

- **One API**: `:4001`, from this tree's `.env`, restarted and verified (`contractVersion 2.29.0`,
  `state Healthy`).
- **One database**: `umi_local`, which now holds the whole demo estate — ONCA's 63 products and 7
  categories, the two registers, the Epson printer with its assignment, the brand mark and the
  receipt snapshots — restored from the clone that had the richer state.
- **One till**: the app on the iMin is built against `http://127.0.0.1:4001` (build 9) and its only
  `adb reverse` is `tcp:4001`.
- Deleted: the `:4013` harness and its env file, the clone database, my rehearsal database, and the
  sixteen `umi_ci_*` / `umi_mig_*` / rehearsal / probe databases left by earlier sessions (all of them
  script-generated artifacts). **Kept on purpose**: `umi_prod_snapshot_20260925` — the only one that
  holds data nobody can regenerate.

## Trap 1 — a URL in a row is a fact about the environment that wrote it

Every brand mark in the database was stored as an absolute URL:

```
merchant.merchant.logo_url                    = http://127.0.0.1:4013/logos/{merchant}-{sha}.png
merchant.receipt_snapshot.snapshot->merchantLogoUrl   (frozen at commit, 7 rows)
merchant.hardware_print_job.safe_document->printPayload->logoUrl   (6 rows)
```

The till fetches that URL at print time. After consolidation it was asking `:4013` for the picture —
an address that answers nothing from the till's side — and a mark that cannot be fetched simply is not
there, so the paper came out with the café's name and no jaguar while the same receipt drew it on
screen. Measured on the iMin D3-504.

**Fixed**: `logo_url` and every committed receipt snapshot were rewritten to `:4001` (the snapshot
table is append-only, so the rewrite went through `merchant.with_append_only_writable`). The print-job
history was left as it is: it records what was actually sent to a head, and rewriting it would falsify
that record.

**Left open**: the design flaw is not the port, it is storing an absolute URL at all. A relative asset
path (`/logos/{merchant}-{sha}.png`) resolved by the client against the API it is already talking to
would survive every move of the API, and it is the change this report recommends next.

## Trap 2 — a reprint copies a payload that may name an unreachable host

`create_controlled_reprint` builds the copy's document from the ORIGINAL job's `safe_document`. For
content that is exactly right; for the mark it meant a copy of a job written against `:4013` printed
without a logo forever.

**Fixed** (`017_reprint_refreshes_the_mark.sql` + the repository): the API resolves the mark against
`merchant.logo_url` — the café's mark today — before it fingerprints the command, and hands the
resolved document to the function, which now takes the payload instead of assembling it. Resolving it
in SQL was the first attempt and it answered `409 HARDWARE_COMMAND_FAILED`: the fingerprint is computed
in JavaScript over the command the API returns, so a rewrite after that made the stored payload
disagree with its own fingerprint. **A rule that changes a document has to live where the document's
identity is computed.**

The second attempt passed the _print payload_ where the function stores the whole _document_, and the
head refused it as a `terminal_hardware_failure` — the receipt fields were at the root instead of under
`printPayload`, so the renderer's required fields were missing. Both mistakes are recorded here because
both are invisible until paper moves.

## The demo PIN map, recovered

The old harness and the owner's API ran with **different `JWT_SECRET`s**, and a POS PIN's lookup is
`HMAC(JWT_SECRET, umi-pos-pin:{merchant}:{pin})` — so the same four digits signed in as a different
person depending on which API answered. With one API there is one map, and it is now:

| PIN  | Operator                     |
| ---- | ---------------------------- |
| 1111 | Admin ONCA (`admin@onca.mx`) |
| 2222 | Barista Barra                |
| 4321 | Caja 1                       |
| 4444 | Mesero 1                     |
| 5555 | Cocina KDS                   |

`scripts/onca-admin-fixture.sh` wrote the administrator's PIN with the environment's own secret, the
way it was designed to; Cocina KDS moved to 5555 so that one PIN still belongs to one person
(`staff_merchant_id_operator_pin_lookup_key` enforces that, and the fixture cannot run until it holds).

## Verified at the end

- A sale at the till printed its **official receipt with the jaguar** (`official_receipt`, payload
  `logoUrl` on `:4001`, status `printed`).
- `Imprimir recibo` from Ventas printed its **copy with the jaguar and the COPIA legend**
  (`receipt_copy`, `copy: true`, status `printed`).
- 1815 API tests, 743 till tests, `flutter analyze` and `tsc` clean.
