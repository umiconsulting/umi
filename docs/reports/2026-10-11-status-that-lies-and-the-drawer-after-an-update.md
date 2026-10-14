# Two bugs the owner found, and the third one underneath

Date: 11 October 2026, 19:45–20:10 MST. Both were reported from the café's own hardware and cash:
the printer's status "said connected although it wasn't" and "it never changed after I found the
printer and it printed"; and the drawer that had to be resumed, which the owner traced to the app
having been reinstalled — "imagine the real case where THEY update the app".

## 1 · The status was a claim, not a measurement

`merchant.hardware_device.connection_state` is written by whoever last probed the device — a till,
possibly days ago, possibly at another terminal. Two readers were treating it as the present:

| Where                                                    | What it did                                                                                                          | What it does now                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| The till's hardware centre (`hardware_service.snapshot`) | fell back to the registry's value whenever this till had no measurement — so an unreachable printer read "Conectado" | falls back to **`unknown`**: a device this till has not reached is not connected, it is unknown  |
| The console's hardware card (`devices.jsx`)              | printed `connection_state` with no age, as if it were now                                                            | prints the state only when the probe is ≤ 10 min old; otherwise `Sin verificar · visto hace 3 h` |

The till's own probe is real and was never the problem: a network printer is a TCP connect
(`health()`), a USB one is `DLE EOT 1` with the offline/error bits read back. What was missing was
refusing to _inherit_ a claim. `devices.hardware.spec.jsx` now pins both halves — fresh probe shows
the state, stale or absent probe shows `Sin verificar` and the age.

## 2 · The drawer after an app update — the root cause was in the API

The owner's instinct was right, and the mechanism is exact. The read that decides which shift a till
"has" filtered on **who opened it**:

```sql
WHERE merchant_id=$1 AND location_id=$2
  AND holding_device_id=$3        -- this terminal holds it
  AND status NOT IN ('closed','blocked','recovered')
  AND responsible_operator_id=$4  -- ← this one
```

An app update (or a reinstall, or simply a different person signing in) mints a new operator
session while the drawer stays held by the same terminal. That one predicate then made the shift
**invisible** to the till that owns it, and everything downstream followed:

1. the cash centre saw no shift for the register and offered `Abrir turno de caja`;
2. the server refused to open one, because the register was held (the drawer is already open);
3. the checkout's `CASH_SHIFT_REQUIRED` refusal named the hold, and the till offered
   `Reanudar turno y reintentar` — against a shift its own cash screen could not see;
4. pressing it did nothing, because the resume path is driven by the cash snapshot.

A café that updates the app therefore cannot take cash, with no action in either surface that
works. Fixed in two places:

- **API** (`pos-cash.repository.ts`): the drawer's custody is the **terminal's**. The predicate is
  gone; who opened it still decides what happens next — a different session reads back as
  `operator_mismatch` with `['resume']` among the allowed actions, which is the deliberate resume,
  and a drawer held by another _live_ terminal still stays `held_by_active_till` behind a manager's
  count. The regression spec that pinned the old predicate now pins the new rule, with the reason.
- **Till** (`checkout_controller` / `cash_controller` / `catalog_surface`): the recovery resumes
  **the shift the refusal named** (`resumeShiftById`), instead of asking the cash screen to
  re-derive "the current shift" from a snapshot that may be a load old. A version is never guessed:
  if the server did not name the shift as this terminal's, there is nothing to resume.

## 3 · The third one, found on the way, still open

With the API fixed, the till's cash recovery runs — and stops before it sends the resume. It calls
`GET /cash/commands/:id` for a queue of pending cash commands left by earlier attempts
(`_commandIds` in `cash_controller.dart`, and `_recoverPendingCommand` in `load()`); when the server
answers `succeeded` the client clears the record and **throws**, and the `load()` catch keeps the
mismatch snapshot. On the device this repeated for four different command ids without ever reaching
`POST /cash/shifts/:id/resume`, so the drawer stayed with the old session (`operator_session_id`
unchanged, verified in the database) and the operator kept seeing the same dead button.

That is a client defect of its own: a pending command the server already finished must not abort the
recovery the operator asked for. It needs its own fix and its own test, and it is the last thing
between this branch and a café that can charge after an update.

## Verified

| Check                           | Result                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The status rule, both halves    | `devices.hardware.spec.jsx`, 5 cases (fresh, stale with age, never probed)                                                                                    |
| The API's custody rule          | `pos-cash.repository.regression.spec.ts` updated to pin the new rule                                                                                          |
| Suites                          | API **1803**, dashboard **356**, POS **734**, all green; `tsc`, `flutter analyze` and the lint-warning baseline clean                                         |
| The real app update on the till | profile APK build 3 installed; the app asked for the PIN again (a new session), and the drawer is still held by the terminal — the exact scenario, reproduced |

**What this run did not reach:** the sale itself. The till now _sees_ the drawer, and the recovery
still stops at the pending-command loop of §3, so no cash has been taken since the fix and the
ticket with the jaguar still waits on it.
