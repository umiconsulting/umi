# The drawer its own terminal could not take back

> **Environment note (added after the fact).** Every measurement below was taken against a second
> local API on `:4013` and a clone of the demo database, because that is where the till was pointed at
> the time. The setup has since been consolidated onto **one API (`:4001`) and one database
> (`umi_local`)** — see [one API, one database](2026-10-11-one-api-one-database.md) for what that took
> and what it broke. The findings and the fixes below are unchanged; only the addresses moved.

Date: 11 October 2026, 21:40–23:10 MST. Device: iMin D3-504 (`co.umiconsulting.umi_pos.estacion`,
build 6-from-this-tree), API from this tree on `:4013`, ONCA demo merchant, Epson TM-T20IIIL on the
till's USB host port.

The owner's report was one sentence: _"necesitamos que funcione"_ — the till was holding a cash
drawer and could not charge against it. Two defects sat behind that sentence, in different layers,
and neither was visible from the other.

## What the operator saw

```
Cobrar · MXN 80.00
  → El cobro no tiene un turno de caja al cual abonar el efectivo.
    [Reanudar turno y reintentar]
```

The screen named the drawer it wanted (`held_by_this_device`, shift `a45f4711…`, open since 7
October) and offered the one action that would fix it. The action could never succeed.

## Defect 1 — the write asked about the person, the read asked about the terminal

Two reads decide what the Caja screen and the sale surface offer, and both match on the **device**
that holds the drawer:

```sql
-- pos-cash.repository.ts, cashCenter
WHERE merchant_id=$1 AND location_id=$2 AND holding_device_id=$3
  AND status NOT IN ('closed','blocked','recovered')
```

The write that the offered button calls matched on something else:

```sql
-- pos-cash.repository.ts, transition (before)
WHERE id=$1 AND merchant_id=$2 AND location_id=$3
  AND responsible_operator_id=$4      -- ← the ACTING OPERATOR
  AND holding_device_id=$5 AND version=$6 AND status=ANY($8)
```

`responsible_operator_id` is a fact about a **person**; `holding_device_id` is a fact about a
**terminal**. On the demo database they had come apart in the way an app update always produces: the
drawer was opened on 7 October by Caja 1 (`47d77d6e…`, a `umi.user` whose status is still
`invited`), the update minted a new operator session, and the person standing at the till was Admin
ONCA (`30000000…0200`). The read said "this drawer is yours"; the write said "not yours". The
`UPDATE` matched no row, and the empty result was reported as a bare
`throw new Error('INVALID_SHIFT_TRANSITION')` — which nothing maps, so the operator read
**`500 INTERNAL_ERROR`** for a conflict with a recovery action.

Measured on the device before the fix:

```
POST /api/v1/pos/…/cash/shifts/a45f4711…/resume   →  500 INVALID_SHIFT_TRANSITION
POST /api/v1/pos/…/checkout                       →  409 CASH_SHIFT_REQUIRED
                                                     (holdState=held_by_this_device)
```

### The fix

`transition` now reads the row `FOR UPDATE` first and decides from it, the way `reclaimRegister`
already does, so a refusal can name **which** fact refused it:

| Refusal                                | Code                                                        | Status |
| -------------------------------------- | ----------------------------------------------------------- | ------ |
| the shift is not there                 | `RESOURCE_NOT_FOUND`                                        | 404    |
| the caller's version has moved         | `OPTIMISTIC_VERSION_CONFLICT`                               | 409    |
| the drawer is held by another terminal | `INVALID_SHIFT_TRANSITION` (`shift_held_by_another_device`) | 409    |
| the status does not admit the move     | `INVALID_SHIFT_TRANSITION` (`shift_state_not_movable`)      | 409    |

and the resume itself now follows the terminal: **the device that holds the drawer may hand it to the
operator standing at it.** The session moves, and so does `responsible_operator_id` — because every
later write on a drawer (a movement, a count, the close) matches that same column, and re-pinning only
the session would hand the operator a drawer they still could not count or close.

**The hand-over is a link in the chain of custody.** `operator_resume` is a fourth custody event type
(`docs/migration/build-v3/migrations/015_cash_shift_resume_custody.sql`), with the adoption's shape:
a new holder, a new session, and NO counted cash — nobody counted anything, the money never moved,
only the name on it.

### The dead end that was worse than a refusal

`counting`, `reconciliation_required` and `closing` were in the resume's admitted sources, and the
`CASE` kept the status it already had. The API answered **success** for a move that never happened;
four of those no-ops sit in the demo audit table as `cash.shift_open` `success` against a drawer that
never opened. `transitions` in `cash-domain.ts` forbids those edges and the client gates on the status
the server ignored. They are now refused by name.

### Proof

New integration suite `shift-resume.integration.ts`, against a pristine build-v3 database with RLS
forced (5 tests):

1. a drawer opened by another operator, held by this terminal, resumes: session and responsibility
   both move, one `operator_resume` custody row is written with both sides named and no count, **and
   the operator can then record a movement on it** — the operation that was impossible before;
2. a drawer held by another terminal is refused by name and nothing is written;
3. a stale version is refused with both versions in `details`;
4. a drawer under count is refused by name instead of reporting a move that did not happen;
5. every failure is a 4xx with a published code, never `INTERNAL_ERROR`.

…and then on the instrument itself:

```
POST /cash/shifts/a45f4711…/resume   → 201
POST /checkout                       → 201
merchant.cash_shift                  → status=open, version=28, session=0eb22122…, responsible=3000…0200
merchant.cash_shift_custody_event    → operator_resume  5048286c… → 0eb22122…  (no count)
merchant.cash_ledger_entry           → sequence 9  cash_sale  8000  business_date 2026-10-07
```

The screen: **`Pagado — MXN 80.00`**.

## Defect 2 — the register was holding a printer the till could not see

Charging worked, so the next step was paper. `Imprimir recibo` in Ventas raised, in the till's own
log: `Unhandled Exception: Bad state: HARDWARE_RECEIPT_PRINTER_UNAVAILABLE`, and **nothing at all
happened on the screen** — no paper, no message, no recovery.

The Epson was registered, enabled, `connected`, and assigned to that very till. Both readers of the
runtime narrowed by register:

```sql
-- merchant.read_hardware_runtime, and PosHardwareRepository.devices
and (p_register_id is null or d.register_id = p_register_id)
```

A device assigned to the **terminal** — which is what a USB printer plugged into this iMin is, and
what the hardware centre's assign action writes — has `register_id` NULL, so it was invisible to the
one terminal that owned it.

### The fix

Migration `016_hardware_runtime_sees_its_own_till.sql` gives `read_hardware_runtime` the calling POS
device and admits a device whose assignment points at it, in addition to the register's; the
repository's device read gets the same clause. Nothing else widens: same merchant, same location,
same `assert_hardware_scope`, same `archived_at is null`, and a device with no assignment of either
kind still does not appear. The 4-argument signature is dropped rather than shadowed, because a
fifth defaulted parameter would leave both callable and make every 4-argument call ambiguous.

The bare `StateError` that reached nobody is now an `AppException` the print dialog renders, and the
three hardware codes the API can answer with have operator sentences
(`HARDWARE_NOT_FOUND`, `HARDWARE_DISCONNECTED`, `HARDWARE_DISABLED`, plus the local
`HARDWARE_RECEIPT_PRINTER_UNAVAILABLE` / `HARDWARE_RECEIPT_PAYLOAD_UNAVAILABLE`).

Proof: `POST /hardware/commands` 201, `merchant.hardware_print_job` `official_receipt` with
`printing → printed`, and paper.

## What the two defects had in common

Both were a **read and a write answering the same question with different predicates** — the person
against the terminal, the register against the device that owns it — and both were invisible from
either side alone. Neither produced an error anyone could act on: one was a 500 with no code, the
other an unhandled exception in an async gap. The fix in each case was to make the loop's two ends
ask the same question, and to say which fact refused when they still disagree.
