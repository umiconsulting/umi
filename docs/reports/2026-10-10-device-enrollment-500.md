# A till cannot re-enroll itself: the approve route answers 500

Date: 10 October 2026, 23:15–23:30 MST. Found while restoring the desktop till after its device
credential was lost.

## What happened

The desktop till stopped on **`Registrar este dispositivo`** instead of its PIN keypad: the app no
longer held a device credential. (Its environment had been pointed at another API base for a
comparison run, `api=http://127.0.0.1:4013`; the credential it had been using belongs to the API on 4001. Whether that launch is what cleared it is not established — what is established is the state
and what followed.)

Re-enrolling the till is the documented path (`docs/development/RUNNING_UMIPOS.md`): the till claims
an eight-character code, the dashboard approves the request. It was driven exactly that way, with
the API's own routes:

| Step                                                                             | Result                                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `POST /api/v1/merchants/{merchantId}/devices/enrollment` (as the platform admin) | `201`, `setupCode: NWSJIHVX`, request `ee217dac-…`                    |
| the code typed into the till, `Continuar`                                        | the request moved to **`awaiting_approval`** — the client half worked |
| `POST …/enrollment-requests/ee217dac-…/approve`                                  | **`500 INTERNAL_ERROR`**                                              |

The API's own log names the cause:

```
500 request_failed POST …/devices/enrollment-requests/ee217dac-…/approve
type=DatabaseError detail=duplicate key value violates unique constraint "device_active_installation_uq"
```

## Why

`merchant.device` carries a partial unique index:

```sql
CREATE UNIQUE INDEX device_active_installation_uq ON merchant.device USING btree (installation_hash)
 WHERE installation_hash IS NOT NULL AND status IN ('active','rotation_required');
```

One active row per installation. The approve path
(`apps/umi-api/src/modules/devices/devices.repository.ts:425`) inserts the new device with
`status = 'active'` and **does not consider the row that is already there** — so a till that
re-enrolls _the same installation_ (lost credential, wiped keyring, reinstall, a terminal replaced
in place) collides with its own active row. The request's installation hash
`3d45f6acc973da1c…` and the active device `c8086a89-…` carry the same one, which is what makes this
reproducible rather than theoretical.

Two things are wrong with the answer, and only one of them is the status code:

1. **It is a database error surfaced as an internal failure.** The API knows the row exists; the
   operator is told nothing they can act on, and the dashboard reports an internal error.
2. **The path that does work is undiscoverable.** Revoking the old row first and retrying the
   approve works — measured:

   ```
   POST …/devices/c8086a89-…/revoke  → 201 {"ok":true}
   POST …/enrollment-requests/ee217dac-…/approve → 201 {"state":"credential_ready"}
   ```

   …and the till then reached its PIN keypad. Nothing in either screen says "revoke the old one
   first": the operator sees `500 Internal server error` and a till that keeps waiting.

The fix belongs in the approve transaction: either supersede the active row for that installation
(revoke it and insert the new one in the same transaction, which is what the revocation is for), or
refuse with a stated conflict — the contract already has `ReplaceDeviceRequest` and the revoke
route for the operator-driven version — instead of letting the unique index decide the status code.

## What was left in place to restore the environment

- The old device row `c8086a89-…` was revoked **through the product's own route**, not by an
  update to the table (`device_revocation_ck` refuses a bare `status = 'revoked'`, which is the
  schema working as intended).
- The new device is `1f884b55-8556-4bf4-8ffe-3267fed18854`, active.
- `merchant.physical_register` `Caja 1` (`assignment_policy = 'device_required'`) was pointed at
  the new device id, because the local café's fixture requires the register to match the enrolled
  device (`LOCAL_VERIFICATION_PLAYBOOK.md` §1).

## Also found, and left open

**`pnpm ux:pos:native` reported the room full while the database says it is empty.** After the
re-enrollment the suite ran 5 of 7 flows green — `pos-sign-in`, `pos-tables-open`,
`money-path-pos-charge`, `tender-keypad-follows-cash`, `tender-split-is-a-decision` — and
`pos-tables-merge-split` refused with _"The plan offers 0 free table(s); a merge needs two"_ while
`merchant.table_state` held **five rows, all `open`**, for that merchant. Either the till is drawing
a stale room or the flow's counting no longer matches the labels the till publishes; that
discrepancy needs one session to pin, and it is the same class as the label drift the flows tool
has been through before.

`pos-restart-recovery` failed separately, with an error banner on the catalog
(`No fue posible completar la acción de venta de forma…`) instead of the PIN screen it waits for.

Neither failure involves the payment path: every money flow passed, and they exercise the
completion screen that changed in this session (`checkout_surface.dart`, the soft-keyboard
dismissal).

## The enrollment approve, confirmed and fixed

Appended 11 October 2026, 03:55 MST. The defect below was reproduced on the iMin while testing the
refund flow, its exact cause was captured in the API's own log, and it is now fixed in this branch.

### The cause, in the API's words

```
500 request_failed POST /api/v1/merchants/10000000-…-101/devices/enrollment-requests/0678344d-…/approve
type=DatabaseError
detail=duplicate key value violates unique constraint "device_active_installation_uq"
```

`decidePairing` approves by INSERTing a new `merchant.device` row for the request's
`installation_hash`. The partial unique index `device_active_installation_uq` allows one ACTIVE row
per installation, and the till re-enrolling is the same installation as its previous row, so the
INSERT collided. Nothing in the path superseded the row it was replacing, and nothing translated
the violation: the dashboard received `INTERNAL_ERROR` marked **`retryable: true`** — advise the
operator to retry, on a request that could never succeed — while the till sat on "Se requiere la
aprobación del administrador" indefinitely.

### The fix

`apps/umi-api/src/modules/devices/devices.repository.ts` retires the installation's previous device
inside the same transaction, before the INSERT: `status = 'replaced'`, `revoked_at` set,
`credential_hash` cleared, `replacement_device_id` pointing at its successor. That is the same row
shape the explicit `replaces_device_id` path already writes, and it is what a re-enrollment means —
the same installation is the same terminal. `replaces_device_id` keeps its own job: retiring a
DIFFERENT device an operator names.

`apps/umi-api/src/modules/devices/re-enrollment-supersede.integration.ts` proves it against a real
database, and it was checked in both directions:

| Run             | Result                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| without the fix | **fails** with `duplicate key value violates unique constraint "device_active_installation_uq"` — the production error, reproduced in a test |
| with the fix    | the previous device reads back `replaced` with its credential cleared, and exactly one active device carries the installation                |

Device module after the change: **30 unit tests** and **13 integration tests** pass, and `tsc
--noEmit` is clean. The new file is listed in `test:integration:realtime` beside the other
pairing test.

### What it cost the till, and how it was restored

The workaround in this report still works and is what brought the till back: revoke the still-active
device through the product route (`POST …/devices/:deviceId/revoke`), then approve. The till polled,
received its credential, and returned to `Ingresa tu PIN de operador`. With the fix, that manual
revoke is no longer part of the journey.

**A warning for the next person who drives this till.** Pointing the enrolled app at a DIFFERENT API
instance and restarting it left the till on "Registrar este dispositivo": its local device trust was
gone and it needed a new setup code. Do not swap the API under an enrolled till to read a log — put
a transparent proxy in front of the API it already uses instead (that is what this session did to
capture the request bodies).
