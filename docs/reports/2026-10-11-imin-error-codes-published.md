# The refusals the client could not be told about

Date: 11 October 2026, 13:20–13:32 MST. Device: iMin D3-504, Estación build from this tree, API from
this tree on `:4013`, demo merchant.

Found while checking yesterday's count fix on the till: the API refused with a named code, and the
operator read a sentence about something else. The reason was one line of the error filter.

## What the filter does

`AllExceptionsFilter` publishes only the codes in the contract's `API_ERROR_CODES`, and re-labels
anything else from the HTTP status:

```
409 → CONFLICT      400 → VALIDATION_FAILED      429 → RATE_LIMITED      otherwise → INTERNAL_ERROR
```

That allow-list is deliberate — a client should not be handed whatever a module invented — but
**nothing checked that the modules stay inside it**, and the API has been throwing codes outside it
since the inventory work landed. The operator-visible effect, measured today:

| The API said                                                   | The till said                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| `409 code=CONFLICT detail=code=INVENTORY_COUNT_ALREADY_ACTIVE` | `La información cambió. Revisa los datos e intenta de nuevo.` |

The truth was `Ya hay un conteo abierto en este almacén` — an operator who had done nothing wrong was
told their data was stale.

## How big it is

An exact scan of `apps/umi-api/src` (specs and integration files excluded) finds **135 distinct codes
the API throws, of which 129 were not published**. Every one of them was reaching the client as its
HTTP status. The till has written messages for several of them (`TERMINAL_BUSY`,
`STORED_VALUE_INSUFFICIENT_BALANCE`, `REFUND_NOT_ELIGIBLE`, `TENDER_OVERALLOCATION`…), and those
messages were unreachable.

## What was fixed now

1. **Six code were published** in `packages/contract/src/platform.ts` — the inventory refusals whose
   flows exist on the till today, plus `PERMISSION_REVOKED`:
   `INVENTORY_COUNT_ALREADY_ACTIVE`, `INVENTORY_VERSION_CHANGED`,
   `INVENTORY_VARIANCE_REASON_REQUIRED`, `INVENTORY_CURSOR_INVALID`,
   `DUPLICATE_RESTOCK_COMPONENT`, `PERMISSION_REVOKED`. The contract was regenerated
   (`generated/contract.json`, `contract.sha256`, the TS binding); the Dart binding carries no error
   codes, so the till only needed its own messages.
2. **The till says what the server said** for each of them (`operator_error_message.dart`), and
   `gate8a_operator_experience_test.dart` pins the five new sentences.
3. **A ratchet keeps the rest from growing in silence**:
   `src/shared/http/error-code-publication.spec.ts` scans the API for `code: '…'` literals and
   compares them with the published union, against a frozen list in
   `unpublished-error-codes.json` (130 codes). A new code either gets published or joins the list on
   purpose; a code that becomes published must leave the list. Checked both ways: taking
   `INVENTORY_COUNT_ALREADY_ACTIVE` out of the union and rebuilding the contract makes the spec fail
   and name it.

**On the rebuild**, the same tap reads
`Ya hay un conteo abierto en este almacén. No se puede iniciar otro hasta que se cierre.`

## A correction kept in the open

My first scan said 129 unpublished codes; the exact set comparison in the new spec found one more
(`INVENTORY_COUNT_SCOPE`, hidden because my ad-hoc check used a substring match against a union that
contains `INVENTORY_COUNT_SCOPE_MISMATCH`). The spec's number is the one to trust: **130**.

## Still open

The other ~130 codes. This is a decision rather than a repair: publish the union wholesale, or keep
trimming it module by module. Until then the ratchet holds the line, and every flow that gains a
message gains a published code.

API suite **1790**, POS **701**, `tsc --noEmit` and `flutter analyze` clean.
