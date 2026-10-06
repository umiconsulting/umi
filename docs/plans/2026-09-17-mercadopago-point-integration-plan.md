# Mercado Pago Point for UmiPOS — the implementation plan

_Plan · build-v3 · order + POS-checkout + tender cluster · 2026-09-17_

**Status:** PHASES 1 TO 5 ARE BUILT. Phases 1–2 and the refund command (with its caller) are
proved against a real database; Phase 3 on the native client, up to **a committed card sale
whose tender carries the terminal's own payment id** (§11.3 item 5); a card refund now moves at
the terminal BEFORE the sale records that it moved (§13); Phase 5's first four steps are in —
the OAuth flow and its 180-day renewal sweep, the per-merchant credential resolved per request,
the `/devices` terminal configuration, and the café's store — with the terminal-binding write
proved against a live schema and the renewal proved from the row to the row (§14); and the till now
HEARS its terminal on a device channel of its own instead of asking at the vendor's windows (§15).
The refund caller's guard is now proved against rows, which is how the defect that made every
legitimate card refund unrecordable was found and fixed (§16), and §7's observability — the plan's
own numbered requirements — is built rather than assumed (§17). **PHASE 0 IS MET (2026-09-17)**: the
N950 is paired to the test seller account, the account reports `operating_mode: "PDV"`, and a 5.00
sandbox order was seen on the device's screen and driven to `processed` — "The order shows on the
physical terminal, and the terminal list returns `operating_mode: PDV`", both halves, on the
hardware. **WHAT REMAINS IS THE PRODUCTION ACCOUNT**, not the pairing: a real card charge and Phase
5 step 5's acceptance are the OWNER'S, and so is the fiscal path for a refunded card sale (§8).
§17.4 and §18 name everything still open. It extends workstream G of
[the ultimate platform plan](./2026-09-15-ultimate-platform-plan.md) and turns the
research of 2026-09-16 and 2026-09-17 into build steps. **Read §10 last: it records what
landed on 2026-09-17 and the commands that proved it — and §§11 to 13 for the three passes
that followed: the till's card tender, the refund command, and its caller. Each records its own
decisions and the lines that still need a paired terminal.**

**Decision record:** [the tender path ADR](../architecture/2026-09-16-tender-path-adr.md).

**Evidence:** the ten notes in `docs/research/2026-09-16-mercadopago-point-usb/`, and the
three notes in `docs/research/2026-09-17-mp-point-implementation/`:

- `01-orders-api-spec.md` — the exact API surface, field by field, with the error codes.
- `02-notifications-and-certification.md` — the signature recipe, the retry policy, and the
  certification requirements.
- `03-umi-extension-points.md` — the code map, with `path:line` for every extension point.

## 1. The goal, and the one sentence that shapes the design

**Goal.** A customer pays with a card on a Mercado Pago Point terminal, and the till
records a sale that no person asserted.

**The sentence.** The terminal is not a peripheral. It is a remote actor that answers in
its own time, over a network we do not own. Every design choice below follows from that.

## 2. What already exists

This plan adds a transport, a receiver, a job, and a screen. It does not redesign the
tender path, because the tender path already holds the invariants.

| Piece                                    | Where                                                                                | State                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| The attempt model, with proof provenance | `packages/contract/src/tender.ts`                                                    | Built                                                       |
| The status mapping, property-tested      | `apps/umi-api/src/modules/tender/tender-domain.ts`                                   | Built; the refund gap Phase 4 named is closed (§10)         |
| The provider port and the registry       | `apps/umi-api/src/modules/tender/tender-provider.port.ts`                            | Built                                                       |
| The Point provider                       | `.../providers/mercado-pago-point.provider.ts`                                       | Built                                                       |
| The transport seam                       | `.../point-transport.port.ts`                                                        | Built; `UnconfiguredPointTransport` until credentials exist |
| The live transport                       | `.../providers/mercado-pago-point.transport.ts`                                      | **Built** (§10)                                             |
| The receiver, the job and the nudge      | `apps/umi-api/src/modules/mercado-pago/`, `src/jobs/mercado-pago-point.processor.ts` | **Built** (§10)                                             |
| Migration 72                             | `docs/migration/build-v3/72_mp_point.sql`                                            | **Built** (§10)                                             |
| The module swap point                    | `apps/umi-api/src/modules/tender/tender.module.ts:49`                                | One line                                                    |
| The attempt table and its CHECKs         | `merchant.pos_payment_attempt`                                                       | Built                                                       |
| The credentials                          | `MERCADO_PAGO_POINT_ACCESS_TOKEN`, `..._TERMINAL_ID`                                 | Named, unset                                                |

**The transport seam was one line.** `buildTenderProviders` constructs
`UnconfiguredPointTransport` only when the credentials are absent, and the live transport
when they are present. Nothing else in the tender path changed to accommodate it, which is
what §8G step 6 promised.

## 3. The decisions

### D1. The till never waits for the terminal

`TenderService.capture` calls the provider inside the request
(`tender.service.ts:174`). That is correct, and it stays, because
`POST /v1/orders` answers in about one second. The **customer** is what takes up to forty
seconds, and the answer for that is already in the model: the attempt returns
`outcome.kind = 'unknown'` with `queryAfterSeconds` (documented fact: the order passes
through `at_terminal` before its final status, up to 10 seconds, or 40 for
`action_required`).

So the till does three things, and none of them blocks:

1. Send the capture. It returns one second later with an attempt id and an unknown.
2. Show "waiting at the terminal" and keep the operator free.
3. Learn the outcome from the realtime nudge, or from its own poll at `queryAfter`.

### D2. The webhook is a wake-up, not a delivery gate

The POS already works this way for pairing: the socket announces the change and the client
re-reads over REST (`packages/contract/src/realtime-channels.ts`). The terminal reuses the
rule, and it is not a style choice. The vendor retries every 15 minutes until our endpoint
answers `200`, expects the answer inside **22 seconds**, and never stops. A receiver that
does the work inline turns a slow database into a retry storm.

The receiver therefore does four cheap things and returns:

1. Read the raw body.
2. Verify the `x-signature` HMAC. A bad signature is `401` and nothing else happens.
3. Enqueue one job for the order id.
4. Answer `200`.

### D3. Idempotency keys are derived, never random

**Documented fact.** Mercado Pago stores `X-Idempotency-Key` against the body for 24 hours
and returns the original resource on a repeat. A random key per retry defeats that.

The key is derived from the attempt: `uuidv5(commandIdentity + ':' + operation,
MP_KEY_NAMESPACE)`. A retry of the same command reuses the same key, so the vendor returns
the first order instead of creating a second one.

### D4. One terminal takes one open order, and the database says so

**Documented fact.** A second order answers `409 already_queued_order_for_terminal`:
"The terminal already has an order waiting. It is necessary to finalize or cancel it to
send new orders."

The vendor enforces this, and so do we, one layer earlier: a partial unique index on
`(merchant_id, terminal_id)` where the attempt is open. The checkout then refuses with a
named reason instead of learning it from a `409` after the customer has decided.

### D5. The webhook payload is never the truth

The job re-reads the order with `GET /v1/orders/{order_id}` before it writes. Three
documented facts demand it:

1. The notification body of Point carries no notification id, so it cannot be deduplicated
   on its own.
2. At-least-once delivery with unbounded retries means a duplicate is normal.
3. A duplicate must not undo a resolution. `resolveAttempt` is already monotonic, with one
   deliberate exception: `declined → succeeded`, because a late `processed` must be able
   to correct a premature decline (`tender.repository.ts:259-261`).

### D6. A refund is its own command, with its own attempt

**Documented fact.** A partial refund needs `transactions.payments[].id`, not the order id,
and the vendor says to save both. A refund is allowed inside 90 days, only from
`status = processed`, and a partial refund with a tip answers
`403 partial_refund_forbidden_with_tips`.

So the order id and the payment id are both persisted on the attempt, and the refund is a
second row with the same shape, not a mutation of the sale.

### D7. Credentials become per merchant, and the registry stays

Today the token is one deployment value, read once at boot (`tender.module.ts:19`). That
cannot serve Umi's clients, and the vendor's own quality checklist makes centralized
credentials a **requirement**, not advice.

The registry keeps its shape. What changes is where the transport gets its token: a
resolver that reads the merchant's credential per request. The environment token stays as
the "own account" mode, which is what phases 0 to 2 use.

### D8. The OAuth lifecycle is a job, not a hope

**Documented fact.** An OAuth token lasts 180 days and the vendor states the integration
stops working without the renewal flow. A cafe must not discover this at the counter.

The job refreshes every token with 14 days of margin, records the attempt, and raises an
owner-visible alert after one failure. The refresh token is stored encrypted, and the
column is never returned by an API.

### D9. Provider errors are typed, and one of them is a configuration error

**Documented fact.** The API answers with two different envelopes. Auth errors use
`{"code": "unauthorized"}`. Everything else uses `{"errors": [{"code": "..."}]}`. A parser
that reads only `body.code` loses every 400, 403, 404, 409, 422, 425, and 428.

`403 forbidden_checking_terminal_owner` means the terminal belongs to another account. In a
multi-merchant product that is a setup mistake, not a failed payment, and the screen says
so.

### D10. There is no offline card capture, and the product says so

The card data lives inside the terminal, and the terminal needs the network to load the
order. When either is down, there is no card payment. The right behaviour is a clear
sentence and cash as the fallback. A till that pretends otherwise records a sale it never
collected.

## 4. The phases

Each phase ends with evidence, not with an opinion.

### Phase 0 — Prerequisites and the physical proof

**Observed so far.** The terminal is a Point Smart 2, Newland N950, serial `NCCB05317715`. It
did not enumerate over USB, which the vendor's own policy explains.

**Status, 2026-09-17 — MET, all four steps, with the owner's hands on the device.** The N950 is
PAIRED to the test seller account and the acceptance sentence is true of the hardware:

| Object             | Value                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal id        | `NEWLAND_N950__N950NCCB05317715`                                                                                                                                                                                                                                                                                                                                                                                                  |
| Store              | `87482378`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Point of sale      | `138301467` (`external_pos_id` `umipos001`)                                                                                                                                                                                                                                                                                                                                                                                       |
| Operating mode     | **`PDV`**, read from `GET /terminals/v1/list` AFTER the device restart — the `PATCH` answered `200` and echoed `PDV` while the list still said `STANDALONE`, and the device applied it on restart, which is the vendor's own ordering. The owner confirmed it independently: the terminal's settings gained a "vincular frente de caja" switch that only exists in PDV.                                                           |
| Owner              | the TEST seller (`TESTUSER5545458632263290392`), which **resolves §9-adjacent doubt**: research note 07 concluded a test account "can never own our N950" from an empty list taken before pairing, and the paired list disproves it. Note 07 §7 carries the correction; note 09 §1 was right.                                                                                                                                     |
| The physical proof | Order `ORDTST01M2R40A8KMD63YTJQARG6J2W1` (5.00 MXN, `external_reference phase0-wifi-094309`) reached **`at_terminal`** and the owner saw the **$5 charge with the "Tarjetas" option on the device's screen**. The outcome was driven with the documented test simulation (`POST /v1/orders/{id}/events` → `204`), which resolved it to **`processed / accredited`**, payment `PAY01M2R40A94PQ74W7NFTKA6QHH3`, `paid_amount 5.00`. |

**What the hardware taught us, which no document said.**

1. **A pending device update silently blocks the whole path.** The first order sat in `created`
   for minutes with nothing on the screen; after the terminal updated its software and moved from
   4G to WiFi, the same shape of order reached `at_terminal` in about **15 seconds** (the vendor
   documents up to 10). A terminal that answers `GET /terminals/v1/list` is not therefore a
   terminal that receives orders.
2. **A stuck order blocks the next one.** The vendor answered the second create with
   `409 already_queued_order_on_terminal` while the first still read `created` — so "queued on the
   terminal" is true at the DEVICE before the API's status says `at_terminal`.
3. **`POST /v1/orders/{id}/cancel` needs `X-Idempotency-Key` like every other write** — without it
   the answer is `400 empty_required_header`, which is easy to misread as "this order cannot be
   cancelled". It worked the moment the header was sent, and it is the way to free a terminal whose
   order never appeared.
4. **The test account receives orders but cannot take a real card.** That is the one thing
   production credentials are for (note 09 §1), and it is why the physical proof above ends in a
   simulated `processed` rather than a card tap.

**Steps.**

1. Pair the N950 to the test seller account, from the Mercado Pago app, and select store
   `87482378` and point of sale `138301467`.
2. Set `PDV` through `PATCH /terminals/v1/setup`, restart, and confirm in the terminal
   settings.
3. Read `GET /terminals/v1/list` and record the exact id, `pos_id`, `store_id`, and
   `operating_mode`.
4. Create one sandbox order and watch it arrive on the physical screen.

**Acceptance.** The order shows on the physical terminal, and the terminal list returns
`operating_mode: "PDV"`. **BOTH HALVES HELD ON 2026-09-17** — see the status table above: the
list reads `PDV`, and the owner watched a 5.00 charge appear on the device and then drove it to
`processed` with the documented simulation.

### Phase 1 — The live transport

**Deliverable.** `MercadoPagoPointTransport implements PointTransport`, plus the one-line
swap in `tender.module.ts:49` and the config entries.

**Steps.**

1. `createOrder` posts to `/v1/orders` with `type: "point"`,
   `external_reference = commandIdentity`, the amount as a two-decimal string,
   `expiration_time = PT3H` for a table order, `config.point.terminal_id`, and the derived
   idempotency key.
2. `readOrder` gets `/v1/orders/{order_id}` and maps the documented status vocabulary.
3. Map both error envelopes into `ProviderOutcome`, and never into a decline.
4. Set `expiration_time` explicitly. The default is 15 minutes, which is short for a cafe
   table.

**Acceptance.** With a test credential, a capture creates a real order against the virtual
terminal, returns `unknown`, and a later query returns the resolved state.

### Phase 2 — The receiver, the job, and the nudge

**Deliverable.** `apps/umi-api/src/modules/mercado-pago/` with the controller, the service,
the repository, and the integration test; a BullMQ processor; a realtime nudge; and
migration `docs/migration/build-v3/72_mp_point.sql`.

**Steps.**

1. The route verifies the signature with the documented manifest
   (`id:{lowercased id};request-id:{x-request-id};ts:{ts};`, HMAC-SHA256, hexadecimal,
   constant-time compare). The exact recipe and its three legal forms are in research note
   `02`, section 2.
2. The route enqueues and answers `200` inside the 22-second budget. It never writes the
   attempt.
3. The worker re-reads the order and resolves the attempt through the existing
   `resolveAttempt`.
4. The worker emits a realtime nudge, and the till re-reads over REST, per the existing
   channel doctrine.
5. Migration `72` adds the per-merchant credential table, the terminal id per register,
   the store and point of sale ids, the payment id on the attempt, and the partial unique
   index of D4. Register the file in `00_run.sh` and cover it in `99_verify.sql`.

**Acceptance.** A duplicated notification resolves once. A notification that arrives before
the customer finishes does not resolve the attempt. A tampered body answers `401` and
changes nothing.

### Phase 3 — The till's tender screen

**Deliverable.** The Flutter tender sheet offers the card method only when
`pos.tenderProviders` says the provider is available, and it shows the terminal's own
progress.

**Steps.**

1. Read `pos.tenderProviders` and hide an unavailable method. A button that fails after the
   customer decided is worse than no button.
2. On capture, show "waiting at the terminal", with a cancel action while the order is
   `created`.
3. Follow the attempt by the same command identity the capture used, and stop when the
   commit refuses an unresolved attempt.
4. Keep the manual "external terminal" toggle for a deployment with no credentials. It
   records an operator attestation, and it stays honest about being one.

**Acceptance.** The card method appears only with credentials. The screen never shows a
success the provider did not state.

### Phase 4 — Refunds and settlement

**Deliverable.** The refund command, the fiscal consequence, and the mapper gap below.

**Steps.**

1. Add the refund as a second attempt with the same model.
2. Handle `processed` with `status_detail = partially_refunded`, and the `refunded` status,
   in `classifyTerminalStatus`. Today both fall to the default branch and read as
   `unknown`.
3. Reconcile on `paid_amount`, because the terminal adds a tip and `paid_amount` can exceed
   the requested `amount`.

**Acceptance.** A partial refund moves money and the sale records the refunded amount.

### Phase 5 — Many merchants, the panel, and the certification

**Deliverable.** The OAuth flow, per-merchant credentials, the `/devices` configuration,
and the vendor's acceptance.

**Steps.**

1. The OAuth authorization redirect, the callback, and the code exchange, per research note
   `08`.
2. The 180-day renewal job of D8.
3. The `/devices` screen gains the terminal configuration: list the terminals by API, show
   the operating mode, and switch `PDV` and `STANDALONE`. The vendor lists both as expected
   practices, and the code map puts the narrowest home in the devices feature.
4. Create the store and the point of sale per merchant, with that merchant's token.
5. Run the quality measurement against a real production order. The virtual terminal is
   excluded from that measurement.

**Acceptance.** A second merchant authorizes, and a charge lands in that merchant's
account.

## 5. Speed and connectivity

| Budget                         | Target                                         | How                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture request                | Under 1.5 s p95                                | The API call is one POST. The terminal is never awaited.                                                                                                                                                                                                                                                                  |
| Webhook acknowledgement        | Under 300 ms                                   | Verify, enqueue, answer. No database work on the hot path.                                                                                                                                                                                                                                                                |
| Resolution visible in the till | Under 2 s after the notification               | The nudge makes the till re-read immediately. The till's DEVICE channel landed in §15 — until then the nudge reached only the dashboard room and this number was a mechanism with nowhere to run. **STILL UNMEASURED**: it needs a paired terminal and a production order (Phase 0 and Phase 5 step 5, both the owner's). |
| Fallback                       | The documented 10-second and 40-second windows | `queryAfterSeconds`, already in the model.                                                                                                                                                                                                                                                                                |

**The rules that keep it fast.**

1. Persist the attempt before the provider is called, so a crash leaves a question rather
   than a mystery. This is already built (`tender.service.ts:105`).
2. One writer reaches the provider, through the `provider_capture_at` claim. This is
   already built.
3. The realtime socket carries a nudge and never a payload. One source of truth, no stale
   screen.
4. Back off on the poll. The till asks at `queryAfter`, and the vendor documents no rate
   limit table, so our own ceiling is the only protection.

**The rules that keep it honest when the network fails.**

1. A terminal with no network cannot take a card. Show the reason, offer cash.
2. Our API down means the till retries with the same command identity, and the claim makes
   the second attempt a replay, not a second charge.
3. A terminal busy with another order answers our own named conflict, from the index of D4,
   before the customer touches the card.

## 6. Testing and evidence

Every scenario below runs against the test credentials and the virtual terminal, except the
last one.

| Scenario                                    | Instrument                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| The six simulated statuses                  | `POST /v1/orders/{id}/events`, then read the order                       |
| A duplicated notification                   | Replay the same body twice, and assert one resolution                    |
| A notification before the terminal finishes | Send it while the order is `created`                                     |
| A tampered signature                        | Alter one byte, expect `401`, expect no write                            |
| A terminal that is busy                     | Create a second order for the same terminal, expect our named conflict   |
| A provider timeout                          | Point the transport at a dead address, expect `unknown`, never a decline |
| A late `processed` after a decline          | Simulate `failed`, then `processed`                                      |
| The arithmetic                              | The existing `fast-check` property test, extended with the refund branch |
| A real charge                               | One production order of `5.00` on the physical terminal                  |

## 7. Observability

1. Every provider call logs the correlation id, the attempt id, the order id, the status,
   and the latency. No token, ever. **BUILT (§17).** The line is
   `tender_provider_call provider=… op=… attempt=… correlation=… order=… status=… outcome=… latencyMs=…`,
   emitted by `TenderService.logProviderCall` — the one place all five fields are in hand, and the
   only place a thrown transport can still name the attempt. No token, because nothing is
   interpolated except ids, the vendor's own status word and a number.
2. Every webhook logs its signature verdict and its order id before it enqueues.
3. The attempts that stay unresolved past their `queryAfter` window are a countable metric.
   That number is the health of the integration. **BUILT (§17).** A gauge
   (`tender.attempts_unresolved_past_query_window`) published through `MetricsService` and visible
   in the diagnostics snapshot, set every five minutes by a `system`-queue job; zero logs at `log`,
   anything else at `warn`.
4. An alert fires when a merchant's token is inside 14 days of expiry and the refresh
   failed. **BUILT (§14.2 D36):** the `mpPoint.status` route returns `refreshFailedAt` and
   `refreshAttempts`, and the console's device card renders them beside the account as
   "Conectado, con avisos".

## 8. What the owner must provide

1. The production Access Token of the account that will receive the money, for the real
   charge of Phase 3's acceptance.
2. A pairing session on the terminal, to move it to the receiving account.
3. A decision on the fiscal path for a refunded card sale, which §8G step 4 already names.

## 9. Open questions, carried from the research

1. Does the panel suffice for the third-party model at our scale, or does the commercial
   team require an agreement first?
2. Is the `5.00` minimum a rule of the test account or of production? It is not in the
   documentation.
3. Does the panel store the topic as `order` or `orders`?
4. Is the signature secret one per main account, shared across merchants?
5. Does Point require an Integrator ID, and in which field?

## 10. The first pass, 2026-09-17 — the transport, the receiver, the job, the nudge

Phases 1 and 2 are built, and every claim below is read back from a **fresh build-v3
database** (`dropdb`/`createdb`/`00_run.sh`) or from the running API, not from an opinion.
Phase 0 is not done and cannot be: the test account still holds **zero terminals**
(`GET /terminals/v1/list` → `{"data":{"terminals":[]},"paging":{"total":0}}`), so the two
acceptance lines that need a device are listed at the end of this section as still open.

### 10.1 What landed

| Piece                | File                                                                                        | What it does                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The live transport   | `apps/umi-api/src/modules/tender/providers/mercado-pago-point.transport.ts`                 | `POST /v1/orders` and `GET /v1/orders/{id}`; both error envelopes; derived v5 idempotency key; `PT3H`; token never logged; `terminalId` exposed so the attempt can name its terminal.                          |
| The module swap      | `apps/umi-api/src/modules/tender/tender.module.ts`                                          | Both credentials present → the live transport; otherwise `UnconfiguredPointTransport` with the same "missing X, Y" sentence. One line, as §2 promised.                                                         |
| The signature recipe | `apps/umi-api/src/modules/mercado-pago/point-signature.ts`                                  | Manifest with its three legal shapes, HMAC-SHA256 hex, constant-time compare behind a length check, 15-minute freshness with both documented `ts` units.                                                       |
| The receiver         | `.../mercado-pago/point-webhook.{controller,service}.ts`, `.../mercadopago-point.module.ts` | `POST /api/webhooks/mercado-pago-point`: verify, enqueue, answer. It never writes the attempt and never calls the provider.                                                                                    |
| The job              | `apps/umi-api/src/jobs/mercado-pago-point.processor.ts`                                     | Re-reads the order and resolves the attempt through the same monotonic write an operator's query uses.                                                                                                         |
| The lookup           | `tender.repository.ts` — `findAttemptForNotification`                                       | The one BYPASSRLS reader on the tender path: a notification has no operator, no location and no merchant, so it is found by the order id we stored, with the command identity as the fallback.                 |
| The nudge            | `72_mp_point.sql` trigger + `apps/umi-api/src/modules/realtime/tender-attempt.listener.ts`  | The DATABASE raises `umi_tender_attempt` with ids only; the web process listens and emits `tender.attempt.changed` into the merchant's dashboard room.                                                         |
| The schema           | `docs/migration/build-v3/72_mp_point.sql`                                                   | `pos_payment_attempt.terminal_id`, the D4 partial unique index, `mp_point_credential`, `device_point_terminal`, the notify trigger, RLS and grants; registered in `00_run.sh` and asserted in `99_verify.sql`. |

### 10.2 The four decisions taken while building

**D11. The tender notification gets its OWN queue, because a shared queue is a race.**
The notification was first queued on `integrations`, which the pre-existing
`IntegrationsProcessor` also consumes. BullMQ hands a job to whichever consumer takes it
first, so the processor that knew nothing about tenders won the job and logged
`unknown integrations job: tender.point.notification` — dropping the resolution the till
was waiting for. This was not found by reading the code; it was found by running the whole
chain and watching the job disappear. `QUEUES.tender` now exists with its own reliability
entry, and the receiver enqueues there.

**D12. The worker states the facts the command layer needs, and says which fact is
missing.** A resolution is written through `IntegrityService`, which finds the merchant's
RLS scope in the request context — and a notification arrives with no request at all. The
first integration run failed with `withMerchant() requires a request merchant context`,
which is the honest behaviour of a layer that refuses to guess. `resolveFromNotification`
therefore runs the write inside a context that carries the attempt's merchant and location,
the delivery's correlation id, **`userId: null`** because no person acted, and no device.
The audit row's actor is null for the same reason: naming a cashier for a terminal's own
answer would be a lie the trail keeps.

**D13. A notification is answered from the row only when the row has an answer.** A
duplicate must not undo a resolution, so a `succeeded` or `cancelled` attempt is returned
without another vendor call. `declined` is deliberately NOT in that set: D5's one allowed
rewrite is `declined → succeeded`, and a terminal that reports a refusal and then the
payment that actually went through must be heard. Asking again can only ever correct the
row, never undo it — the repository's guard refuses every other rewrite — and the
acceptance case below proves the duplicate still costs exactly one vendor call.

**D14. A refunded order is a capture, and the attempt names its terminal.** §4 Phase 4
step 2 asked for `refunded` and `partially_refunded` to stop reading as `unknown`; both are
in the vendor's DETAIL vocabulary while `refunded` is also a status, the snapshot did not
carry the detail at all, and the mapper's `default` branch is what a captured sale fell
into. `PointOrderSnapshot` now carries `statusDetail`, and a refunded order reads as the
capture it proves — the giving-back is its own act with its own attempt (D6) and its own
amount, which is Phase 4 step 3's reconciliation and not a rewrite of the sale. Producing
that outcome also gave the D4 index its writer: `PointTransport.terminalId` (and the
provider's `terminalId`) let the attempt record the terminal it holds, so a busy terminal
is refused by the database with the named `TERMINAL_BUSY` conflict **before** the customer
touches the card.

### 10.3 The evidence

**Phase 1.** `pnpm --filter @umi/api exec vitest run src/modules/tender` → **32 passed**
(the transport's 18 and the arithmetic's 14, including the new refund branch).
LIVE ACCEPTANCE NOT REACHED, and the reason is data, not code: the test token is live
(`GET /users/me` → 200, user `3696430142`) and `GET /terminals/v1/list` returns zero
terminals, so there is no device to send an order to. No write call was made against the
vendor.

**Phase 2, unit.** `point-signature.spec.ts` (19) and `point-webhook.controller.spec.ts`
(7) → **26 passed**: the three manifest shapes, the lowercase rule, a short `v1` as a
mismatch rather than a crash, both `ts` units, staleness, a missing secret failing closed,
and 401-with-no-enqueue on a bad signature.

**Phase 2, against the real schema.** `point-notification.integration.ts` → **5 passed**
against a freshly built database, driving the REAL transport at a local stub of the
vendor's two documented endpoints:

1. a capture leaves `unknown` with the vendor's `external_reference`, the derived
   idempotency key and `'90.00'` on the wire; the notification then resolves it to
   `succeeded` with `proof_source = provider`, the vendor's payment id and
   `provider_query_count = 1` — **and a duplicate delivery changes neither the state, nor
   the proof, nor the counter, nor `resolved_at`**;
2. a notification that arrives while the order is still `created`/`at_terminal` leaves the
   attempt `unknown` and `resolved_at` null;
3. a second capture for the same terminal is refused with **`TERMINAL_BUSY`**, and exactly
   one open attempt remains;
4. a `failed` order that is later `processed` is corrected from `declined` to `succeeded`
   (D5's exception), with the payment id recorded;
5. a notification naming an order this deployment never recorded resolves nothing and
   invents no row.

Both suites re-run green on a second pass (30/30 with `tender.integration.ts`), which is
the re-runnability the harness relies on.

**Phase 2, the migration.** A fresh `00_run.sh` on an empty database ends
`build-v3 verify: OK`; the D4 index refuses a second open attempt for the same
`(merchant, terminal)` and accepts one after the first resolves; the shape check refuses a
hand-built terminal id; the trigger emits `umi_tender_attempt` on a resolving write and
stays silent on `pending → unknown`; and `99_verify.sql` fails loudly if the column, the
index, either table or the trigger goes missing.

**Phase 2, the whole chain, in the running system.** API (web) + worker + Redis + Postgres

- the stub vendor, all four processes: a correctly signed notification answered **200 in
  32 ms** (the budget is 22 s), the job landed on the `tender` queue with its envelope, the
  worker logged
  `point notification resolved attempt=597bb5e4-… state=succeeded providerAsked=true resolvedNow=true latencyMs=170`,
  the attempt row moved `pending → succeeded` with `proof_source = provider` and
  `provider_payment_id = PAYPROBE…`, and a `LISTEN umi_tender_attempt` session saw
  `{"merchant_id":…,"attempt_id":…,"command_identity":…,"cart_id":…,"location_id":…,"status":"succeeded"}`
  — ids only, no amount and no provider payload. A tampered `v1` and a wrong `v1` both
  answered **401** with `verdict=mismatch` logged before anything else happened, and neither
  enqueued.

**The gates.** `pnpm --filter @umi/api typecheck` clean; `pnpm --filter @umi/api test` →
**1538 passed, 22 skipped, 0 failed**; eslint clean on every touched module;
`pnpm --filter @umi/contract generate:check` green (the new realtime event is in the
generated artifact and its checksum); `node scripts/check-pr.mjs` green, including the
migration freeze check (nothing already applied was edited).

### 10.4 What is still open

1. **Phase 0 — the owner's.** Pair the N950, set `PDV`, record the exact terminal id, and
   watch one sandbox order arrive. Until then Phase 1's live acceptance and §6's "six
   simulated statuses" and "a real charge" rows cannot run, and `MERCADO_PAGO_POINT_TERMINAL_ID`
   stays unset — which is exactly why the provider reports itself unavailable and the till
   offers no card method.
2. **CLOSED in a later pass (§15) — the till has a device channel.** The nudge reached the
   merchant's DASHBOARD room and the native client had only a pairing socket, so its delivery
   path was its own poll at `queryAfterSeconds`. The `/rt` gateway now accepts a paired
   register's own credential and puts it in `device:<merchantId>`, and the till subscribes
   there. §5's "resolution visible in the till under 2 s" budget is now structurally
   reachable; it still needs a real terminal to produce the number (§15.4).
3. **Phases 3 and 4's command are built (§11, §12); Phase 5 is untouched.** The refund command
   and its `paid_amount` reconciliation are in and proved (§12) — what is missing is a CALLER:
   the exception flow still records a card refund as an operator's word (§12.4 item 1) — and the
   fiscal consequence of a refunded card sale is the owner's decision (§8). No OAuth, no
   `/devices` terminal configuration, no certification.
4. **Two tables exist with no reader and no writer yet.** `merchant.mp_point_credential`
   and `merchant.device_point_terminal` are Phase 5's, and their migration header says so
   rather than implying a caller: phases 1–2 charge through the deployment token, which is
   D7's "own account" mode.
5. **The signature's freshness window is ours, not the vendor's.** The vendor calls the
   check optional and publishes no number; 15 minutes is stated in the code as our choice,
   and §9's questions (one secret per account, the topic's stored name, the Integrator ID)
   are unchanged.

## 11. The second pass, 2026-09-17 — the till's card tender, on the real client

Phase 3 is built and driven on the native Linux client. The four things this pass found are
worth more than the code it wrote, because **not one of them was visible to the unit suite**
— each needed the real client, the real server and a real terminal answering.

### 11.1 What landed

| Piece                    | Where                                                         | What it does                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The two reads            | `apps/umi-pos/lib/features/checkout/checkout_repository.dart` | `TerminalTenderRepository` — `tenderProviders` and `tenderAttempt` — implemented by `ApiCheckoutRepository`, so a cash-only fake stays valid.                           |
| The offer                | `checkout_controller.dart`                                    | `cardTerminalProviderId` is the first AVAILABLE `card_present` provider, read with the policy; a failed read leaves the screen on cash.                                 |
| The capture and the wait | `checkout_surface.dart`                                       | A "Terminal de tarjeta" tile, `_chargeCardTerminal`, the waiting face, the poll at the attempt's own `queryAfter`, "Dejar de esperar", and the honest unresolved state. |
| The strings              | `app_es.arb` / `app_en.arb`                                   | Nine keys, generated with `flutter gen-l10n`.                                                                                                                           |
| The tests                | `test/checkout_point_tender_test.dart`                        | Nine cases, including the two wire-shape cases that would have caught the first two defects below.                                                                      |

### 11.2 The four decisions, each one found by running it

**D15. The operator-attested terminal is its own FAMILY, not `card_present`.** The till's
rule — "the first available `card_present` provider" — is correct, and it still chose
`manual_terminal`, because that adapter declared itself `card_present`. So a cashier who
chose the card terminal captured against a provider that answers `unknown` forever and then
waited for a device that had no order. `TenderFamily` gains `operator_attested`, and
`ManualTerminalProvider` declares it: `card_present` means "a device that ANSWERS", and a
provider that can only ever answer `unknown` is not one. Nothing in checkout changed; a
second brand still works, and the manual tile is still the policy's.

**D16. `pos.tenderProviders` answers with the MODEL, not with `{ok, data}`.** The two new
reads unwrapped `['data']` because the policy route does; these do not. The server answered
200 with the list, the cast produced null, the read threw, and the screen stayed on cash
with nothing in either log to say why — the native run is what found it. Both reads now
parse the body they actually receive, and a repository-level test drives a fake `ApiClient`
with the real wire shape so the next person cannot repeat it.

**D17. `refresh` is a QUERY PARAMETER, so it must be a string.** Passing the Dart bool
through made `Uri` throw before the request was ever sent — a poll that dies silently
rather than a poll that reads. The wire-shape test caught this one the moment it existed,
which is the argument for writing that test at all.

**D18. A card tender in flight CENTRES; the other faces read top-down.** The waiting face
used to sit at the top of a 5/11 column with the charge button stranded at the bottom and
~700 px of empty panel between them, which reads as a half-drawn screen rather than as a
wait for a terminal. Only the card face takes the column's free space and centres in it;
the cash keypad and the manual terminal are forms and keep their own heights.

**D19. The completion screen led with CHANGE for a sale that took no cash.** It drew
"Cambio a dar MXN 0.00" in the largest type on the till — for a card sale, where nobody
handed anything over and there is nothing to give back — with the word "Pagado" underneath
it at caption size. An operator glancing at the screen read the wrong line. The change block
now appears only when there is change to give (`changeMinor > 0`), so a card sale leads with
the amount the terminal took, and a cash sale with change is unchanged. Looking at the
screenshot of the real completion screen is the only instrument that would have shown this,
which is why D18 and D19 are in the same section.

**And one in the harness.** `tools/ux-sweep/pos-native-launch.sh` read its log path before it
consumed `--force`, so `--force` itself became the log path and every `grep "$log_file"` in
its wait loop failed with "unrecognized option": a launcher that appears to hang. Fixed —
the path is read after the shift, with the reason written beside it.

### 11.3 The evidence

**The gates.** `flutter analyze` clean; `flutter test` → **334 passed** (nine of them new);
`pnpm --filter @umi/api test` → **1539 passed, 22 skipped, 0 failed**;
`pnpm --filter @umi/api typecheck` clean; eslint clean on every touched module;
`pnpm --filter @umi/contract generate:check` green after the new family;
`node scripts/check-pr.mjs` green.

**The native run** (`tools/ux-sweep/pos-native-launch.sh`, the API pointed at a local stub of
the vendor's two endpoints, the till on its own workspace and maximised — EWMH fullscreen
kills this GTK client, which is why `window-workspace.sh` maximises and says so):

1. **The card method appears only with credentials.** With no terminal id configured the
   sheet offers cash and the manual terminal and NO card tile; with one configured (and the
   provider available) the card tile appears beside them. Both states were photographed.
2. **A capture leaves the customer alone.** Selecting the card tile and charging produced
   the waiting face — "Esperando en la terminal…", the amount, and the terminal's own status
   row — with the charge button inert, so a second press cannot ask for a second charge.
3. **The success is the PROVIDER's.** Flipping the stub to `processed` made the till's own
   poll resolve the tender: "Cobro confirmado", `Estado: processed`, and the attempt row
   read back from SQL as `succeeded`, `proof_source = provider`, with the vendor's payment
   id and `terminal_id = NEWLAND_N950__POSPROBE`. No person asserted that payment.
4. **An unresolved attempt is never a purchase.** On an earlier run whose terminal never
   answered, the wait ran out and the sheet said exactly that — "Hay un cobro con tarjeta
   que nadie ha confirmado. La venta no se puede cerrar hasta resolverlo." — with the tender
   left selected as `outcome_unknown` so the commit refuses the sale instead of closing it.
5. **THE SALE COMMITS, AND IT RESTS ON THE TERMINAL'S PROOF.** With the tender approved the
   operator's own Cobrar closed the sale — the till reached `Pagado · MXN 55.00` — and SQL
   says what that sale is: the tender fact is `committed`, and the attempt the commit LINKED
   to it reads `succeeded`, `provider = mercado_pago_point`, `proof_source = provider`,
   `provider_payment_id = PAYPOS…0003`, `terminal_id = NEWLAND_N950__POSPROBE`,
   `tender_id = <that tender fact>`. Two such sales are recorded. That is §1's goal sentence
   as a row: a customer paid with a card on the terminal and the till recorded a sale no
   person asserted.

### 11.4 What is still open

1. **A card sale IS committed and linked (§11.3 item 5). The one thing that stood in its way
   was rehearsal state, not code.** The first attempts recovered the earlier cart
   (`ca7bea8a…`), whose tender draft holds cash **and** a manual terminal from a previous
   session; this location forbids mixed tender, so the till refused to charge that
   combination and said so in words — the correct behaviour, and the rule `_restoreDraft`
   documents. A genuinely new sale (`Nueva venta`, which asks first because it abandons a
   cart with lines) gave a cart with no draft, and the flow went through. **Debt, named: a
   rehearsal cart whose draft is a mixed combination nobody can finish should be clearable
   by a route** — an abandoned claim left by an interrupted session should not need an
   operator to press through a confirmation. The earlier pass's debris list is the same
   complaint, and it is now on this plan's critical path twice.
2. **CLOSED in a later pass (§15) — the till subscribes.** The nudge used to resolve in the
   dashboard room alone and the till learned by asking at `queryAfter` — the vendor's own 40 s
   window. The register now joins its merchant's `device:` room with its own credential and
   re-reads on the nudge, so the wait ends on the API's answer rather than at the vendor's
   window. The poll is unchanged and remains the guarantee when the socket is down.
3. **Phase 4 steps 1 and 3 and all of Phase 5 remain**, with §10.4's items unchanged.

## 12. The third pass, 2026-09-17 — the refund command

Phase 4's command is built and proved: **a partial refund is asked of the vendor in the shape
the vendor documents, and the giving-back is its own attempt, linked to the capture, carrying
the vendor's refund id as its proof.** Every claim below is read back from SQL or from what
the stub vendor actually received.

### 12.1 What landed

| Piece              | Where                                                                 | What it does                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The refund call    | `providers/mercado-pago-point.transport.ts`                           | `POST /v1/orders/{id}/refund` — a PARTIAL refund names the payment and the amount, a TOTAL refund sends no body at all; the derived idempotency key (`refund_order`); the sixteen documented error codes classified.              |
| The refund port    | `tender-provider.port.ts`, `providers/mercado-pago-point.provider.ts` | `TenderProviderPort.refund?` — ABSENT on a provider that cannot give money back (the drawer, an operator reading a terminal), so "cannot refund" is a fact about the adapter rather than a runtime surprise.                      |
| The command        | `tender.service.ts` → `refund`                                        | Persist the refund attempt, claim the right to call the vendor exactly once, ask, record what the vendor said.                                                                                                                    |
| The second attempt | `tender.repository.ts` → `beginRefundAttempt`, `refundedAmount`       | A refund is a ROW (D6): linked to the capture it gives back, with its own amount and its own command identity, and it deliberately holds no terminal, so it cannot take the D4 lock from a till that is trying to sell something. |
| The schema         | `docs/migration/build-v3/73_mp_refund.sql`                            | `refund_of_attempt_id`, `provider_refund_id`, `provider_paid_minor_units`, `provider_tip_minor_units`; a self-FK with `on delete restrict`; and the CHECK that makes a provider-proofed refund carry the id that proves it.       |
| The route          | `packages/contract/src/route-table.ts` → `pos.tenderRefund`           | `POST /tenders/:attemptId/refund`, gated by the platform's existing `sale.refund.manual_terminal`.                                                                                                                                |
| The evidence       | `src/modules/tender/point-refund.integration.ts`                      | Six cases against the real schema and a stub vendor.                                                                                                                                                                              |

### 12.2 The three decisions

**D20. A refund is addressed by the ATTEMPT, not by the sale.** What a partial refund needs is
`transactions.payments[].id` — the id of the capture (note 01 §4.3) — and the vendor says in its
own words to save both ids. So `pos.tenderRefund` takes an attempt id, and the giving-back is a
second attempt linked to it. The sale keeps saying what it always said.

**D21. THE CEILING IS WHAT THE CUSTOMER PAID.** The terminal can add a tip, so `paid_amount`
can exceed the amount we asked for, and refunding that tip is legal. The vendor's `paid_amount`
and `tip_amount` now ride on every provider answer that has an order behind it, are recorded on
the capture (`provider_paid_minor_units`, `provider_tip_minor_units`), and the refund is
measured against THEM — with the refunds that already SUCCEEDED summed in, because a declined
refund gave nothing back and must not consume the ceiling. The vendor enforces the same rule
(`refund_amount_exceeds`); ours exists so the operator is told before the call.

**D22. A vendor's 4xx IS a decline for a refund, and never for a capture.** A capture's 4xx
says something about OUR request (`required_properties`, `already_queued_order_for_terminal`)
and nothing about the customer's card — which is why a capture never reads one as a decline. A
refund's 4xx is an ANSWER about this refund: tips forbid partials, the period closed, the amount
exceeds what is left, it is already refunded (note 01 §4.4). Those say the money did NOT move,
and the operator needs the vendor's own code. Everything else — 5xx, 429, a dead socket, a
credential problem — stays `unknown`, because none of them says whether money moved. And a
refund the vendor answers as `processing` is `unknown` too: requested is not moved.

### 12.3 The evidence

**The gates.** `pnpm --filter @umi/api test` → **1553 passed, 22 skipped, 0 failed**;
`typecheck` clean; eslint clean on every touched module; `pnpm check:lint-warnings` passed;
prettier clean; `pnpm --filter @umi/contract generate:check` green after the new route and
models; `node scripts/check-pr.mjs` green (16 migrations, none applied-then-edited);
`flutter analyze` clean (the contract is additive).

**Against a fresh database** (`umi_build_v3_mp` with `72` and `73` applied, `99_verify` OK):
`point-refund.integration.ts` → **6 passed**, and together with the tender and notification
suites **36 passed**. The cases, each read back from SQL:

1. a partial refund of 20.00 on a 55.00 sale whose terminal reported `paid_amount` 60.00 and a
   5.00 tip: the capture records `6000`/`500`, the vendor receives exactly
   `{"transactions":[{"id":"PAY…","amount":"20.00"}]}` with the derived idempotency key, and the
   REFUND attempt lands `succeeded / proof_source=provider / provider_refund_id=<the vendor's>`,
   linked to the capture, with its own 2000;
2. refunding everything that is left sends **no body at all** (the vendor's total refund);
3. a refund of one cent more than was paid is refused as `PAID_AMOUNT_EXCEEDED` **before** the
   vendor is called, and leaves no attempt behind;
4. two 30.00 partials on a 60.00 payment both succeed and a third is refused — while a refund
   the vendor DECLINED does not consume the ceiling, so the same amount can be asked again;
5. an operator without `sale.refund.manual_terminal` is refused and nothing is written; a
   refund of a refund is refused (the capture is what carries the payment id);
6. a vendor that answers `processing`, and a vendor that answers `refunded` with NO refund id,
   both leave the attempt `unknown` — never money that moved (the schema refuses the second
   one anyway, which is the point of `73`'s CHECK).

### 12.4 What is still open

1. **Nothing calls the refund command yet.** The command is proved, and `pos.tenderRefund` is on
   the router, but the platform's REFUND SURFACE — `pos-exception`'s full/partial refund flow,
   which already refunds cash and an operator-attested terminal tender — still records a card
   refund as an operator's word. The seam is known and narrow: when the tender being refunded is
   one whose attempt the provider PROVED, that flow must call this command and take its
   `terminal_refund_status` from the outcome instead of from the operator. Until it does, a card
   refund can be moved by the API but not from a screen.
2. **The fiscal consequence is the owner's decision, as §8 already says.** The plan's Phase 4
   deliverable lists it, and §8 item 3 names it as something only the owner can settle: a
   refunded card sale's CFDI is either cancelled or left stamped with a credit note beside it,
   and this repository must not guess. The command records the money; the document follows the
   decision.
3. **A refund that is still `processing` is never re-asked.** Its attempt stays `unknown` and is
   visible, but nothing polls it: the vendor reports refunds inside the ORDER
   (`transactions.refunds[]`), so the natural place to resolve it is the same notification path
   that resolves a capture (§10). That is a small, well-defined follow-up and it is named here
   rather than left to be discovered.

## 13. The fourth pass, 2026-09-17 — the caller: the sale refunds at the terminal

The refund command had no caller. This pass gives it one: the platform's own refund flow
(`pos-exception`, which already refunds cash and an operator-attested terminal) now ASKS THE
TERMINAL before it records that a card tender was given back. That is what makes §4 Phase 4's
acceptance sentence true of the system rather than of one route: **a partial refund moves money
and the sale records the refunded amount.**

### 13.1 What landed

| Piece                  | Where                                                   | What it does                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The targets read       | `pos-exception.repository.ts` → `providerRefundTargets` | Which tenders of this sale were taken by a DEVICE we integrated with, and for how much. A person-operated terminal is deliberately not in the list: its refund is a person's word, and that is the honest answer for a terminal we never integrated with. |
| Moving the money first | `pos-exception.service.ts` → `moveProviderRefunds`      | Calls `pos.tenderRefund` for each of those tenders BEFORE the exception command runs, with identities DERIVED from the preview and the tender so a retried exception asks for the same refund rather than a second one.                                   |
| The sale verifying it  | `pos-exception.repository.ts` → `commit`                | For each handed-in attempt: it must exist, belong to this merchant, be a SUCCEEDED REFUND of the very capture that paid this tender, carry the vendor's refund id, and cover what is being given back. Nothing is taken on the caller's word.             |
| The honest flag        | `merchant.pos_tender_compensation.operator_asserted`    | `false` when a provider confirmed the refund. The row now says WHO asserted that the money moved.                                                                                                                                                         |
| The two refusals       | `route-table.ts` (`pos.exceptionCommit`)                | `TERMINAL_REFUND_REFUSED` (the vendor's own code, e.g. `partial_refund_forbidden_with_tips`) and `TERMINAL_REFUND_REQUIRES_TILL`.                                                                                                                         |
| The evidence           | `pos-exception/point-card-refund.spec.ts`               | Five cases: the order, the derived identity, and every refusal.                                                                                                                                                                                           |

### 13.2 The four decisions

**D23. The money moves BEFORE the sale records it.** The till's own order — capture, then
commit — applied to refunds. A sale that recorded a card refund nobody asked the terminal for
is the exact lie this workstream exists to prevent, and the order is what makes it impossible
rather than unlikely.

**D24. The sale verifies the refund for itself.** The service hands in the attempt ids it
created, and the commit re-checks every one of them against the database: a succeeded,
provider-proofed REFUND of the very capture that paid THIS tender, covering the amount. A
caller that lied, or a race that moved the world, gets a named refusal rather than a recorded
refund.

**D25. A tender a provider took CANNOT be refunded by a person's word.** This one was found
while writing the guard, and it is the reason the guard is not simply "the operator said
`confirmed_success`": for a provider-backed tender that declaration is NOT accepted as a
substitute for the vendor's answer. Where a person is the only witness there is (a terminal we
never integrated with) their word still settles it, exactly as before, and `operator_asserted`
says which of the two happened.

**D26. A console refund of a card tender is refused, not guessed.** `TERMINAL_REFUND_REQUIRES_TILL`:
the terminal answers to a till's operator session, and the administrative path has none to give
it. Before this pass the console could record a card refund as a person's word; now it says
plainly that the refund has to be made where the terminal is. Wiring the console to the
terminal is its own increment, and it is named rather than half-done.

### 13.3 The evidence

**The gates.** `pnpm --filter @umi/api test` → **1558 passed, 22 skipped, 0 failed**;
`typecheck` clean on every file this pass touched; eslint clean on `pos-exception` and
`tender`; prettier clean; `pnpm --filter @umi/contract generate:check` green after the new
refusal codes; `node scripts/check-pr.mjs` green; and the three integration suites (tender,
notification, refund) **36 passed** against a real database.

**The caller's own cases** (`point-card-refund.spec.ts`, 5 of them, and the 28-test
`pos-exception` suite they belong to): the terminal is asked once, before anything is recorded,
with the capture's attempt id as the thing refunded; the identity is DERIVED, so two runs of the
same exception ask for one refund; the confirmed attempt travels into the commit; a DECLINED
refund refuses the whole command with the vendor's code and records nothing; an unanswered one
refuses with `PAYMENT_OUTCOME_UNKNOWN`; the console is refused; and an operator without the
terminal-refund permission is refused before anyone is asked.

**The till's side of it** (`sale_exception_test.dart`, extended, `flutter analyze` clean and the
whole POS suite **344 passed**): a provider-backed preview reaches the ready phase with the
declaration never sent — asserted by counting the terminal-outcome route's calls and by calling
`recordTerminalOutcome` anyway and watching it do nothing — and commits; a provider-backed
preview that needs approval parks on approval rather than on the terminal; and a
person-operated preview still goes to the declaration phase and still sends exactly one
declaration. The widget case drives the real Spanish dialog and asserts the sentence is shown,
the declaration's own copy is ABSENT, and the ordinary Confirmar is PRESENT — a screen with no
dead end.

### 13.4 What is still open

1. **CLOSED in the same pass — the till no longer asks a question with no power.** The PREVIEW
   now says which kind of terminal this refund faces: `manualTerminal.providerBacked` and
   `manualTerminal.provider`, read from the attempt the commit LINKED to the sale's tender
   (`providerBehindTender` in `pos-exception.repository.ts`). The client uses it: a
   provider-backed tender goes straight to the ready (or approval) phase with one statement
   instead of a declaration — "El cobro se devolverá en la terminal al confirmar el reembolso."
   — the declaration controls are not drawn, and `recordTerminalOutcome` returns without
   touching the network even if something calls it. The tender row also stops calling an
   integrated device "manual": it reads "Reembolso en terminal de tarjeta". A person-operated
   terminal is byte-for-byte what it was, and a regression case holds it there.
2. **Nothing re-asks a refund the vendor left `processing`** (§12.4 item 3, unchanged).
3. **The fiscal consequence stays the owner's decision** (§8 item 3).
4. **CLOSED — and it found the defect that made the caller's happy path impossible.**
   `point-card-refund.integration.ts` seeds a committed sale, a `manual_terminal` tender with a
   provider-proofed capture on it, an exception policy and an approval grant, then creates the
   preview with the REAL `preview` method and drives the REAL `commit` against those rows. Three
   cases: a handout that does not verify is refused `TERMINAL_REFUND_CONFIRMATION_REQUIRED` and
   nothing is written; an operator's word for a provider-backed tender is refused with no handout
   at all; and a refund attempt the vendor actually proved (`succeeded`, `proof_source=provider`,
   linked to the capture, carrying the vendor's refund id) commits — asserted on the returned
   exception AND read back from `pos_sale_exception`. Three consecutive green runs, because the
   sale chain is per-run: a committed sale and its exception are append-only, so a fixture that
   reused one sale id could only ever be refunded once.

-
- **AND IT FOUND THIS:** with the harness in place, the ACCEPTING case FAILED — the guard refused
- a refund the terminal had already made. The query joined the tender through the HANDED-IN
- attempt (`t.id = a.tender_id`), and a refund attempt carries no `tender_id` and cannot: the
- unique index `(merchant_id, cart_id, tender_id)` is what lets one cart hold one attempt per
- tender, so a refund writing the same tender would collide with the capture it refunds. The join
- therefore matched nothing, and every legitimate partial refund was refused at the last step —
- money moved at the counter and refused a place in the sale's books, which is the exact outcome
- §13 exists to prevent, arriving from the other direction. The link is one hop further and it is
- the real relationship: this refund gives back THAT capture, and the capture paid THAT tender.
- The case that would not pass is what proved it; the same case passes now.

## 15. The sixth pass, 2026-09-17 — the till hears its terminal

Phase 3 step 3 asked for the attempt to be followed by the same command identity the capture used,
and the till did that — by ASKING, at the vendor's own ten- and forty-second windows. It had no
choice: the nudge the server raises when an attempt resolves went to the merchant's DASHBOARD room,
and a register had only its pairing socket, whose room is scoped to a pairing session that is over
by the time anyone is paying. So §5's "resolution visible in the till under 2 s after the
notification" budget was a mechanism with nowhere to run (named in §10.4 item 2 and §11.4 item 2,
and true of the code until this pass).

### 15.1 What landed

| Piece                | Where                                                                                                                        | What it does                                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The device room      | `packages/contract/src/realtime-channels.ts` → `deviceRoom`                                                                  | `device:<merchantId>` — the room a café's paired registers join, deliberately NOT the dashboard's, because a room both principals can enter is a room whose membership says nothing.                                                                      |
| The second handshake | `apps/umi-api/src/modules/realtime/pairing-realtime.gateway.ts`                                                              | The `/rt` gateway now accepts EITHER the pairing triple or a paired register's own credential (`publicId`, `installationId`, `credential`) and puts the socket in the room the credential earned. The pairing branch is byte-for-byte what it was.        |
| The emission         | same file, `onModuleInit`                                                                                                    | The tender nudge is emitted to the device room as well as the dashboard's, from the SAME event bus the listener feeds — one source, two rooms, no second emitter that could disagree about what happened.                                                 |
| The till's client    | `apps/umi-pos/lib/features/entry/device_channel_socket_client.dart`                                                          | Connects with the credential from the vault (never from a log), lazily on the first listener and gone with the last, with its own jittered backoff — the library's reconnect is disabled so there is exactly one loop and it never holds a rotated token. |
| The wiring           | `checkout_surface.dart`, `composition_root.dart`                                                                             | The channel comes up where a CARD charge starts, so a cash-only sheet opens no socket; a nudge for this sale cancels the pending poll and makes the same read NOW; `dispose` takes the subscription down.                                                 |
| The evidence         | 16 gateway cases, `device_channel_socket_client_test.dart`, `checkout_point_tender_test.dart`, `realtime_contract_test.dart` | Refusals, the room key, ids-only payloads, backoff, and a sale resolved by the nudge with a poll armed ten minutes out.                                                                                                                                   |

### 15.2 The decisions

**D38. THE NUDGE GOES TO TWO ROOMS, AND THE SECOND ONE IS A DEVICE CHANNEL.** A dashboard session
and a paired register are different principals with different credentials, so putting them in one
room would make membership meaningless: the dashboard room is keyed by a merchant because a browser
was authorized for it, and the device room is keyed by a merchant because a register PROVED its
device credential. The event is emitted from the same bus to both, which is what keeps the two from
disagreeing about a fact neither of them invented.

**D39. THE ROOM KEY COMES FROM THE CREDENTIAL, NEVER FROM THE CLIENT.** A socket asks to
authenticate; it does not ask for a room. The merchant id is the one on the row
`DevicesService.authenticate` resolved from the credential hashes — the same check the register's
REST calls pass, including its refusal of a device whose credential must be rotated, because a
socket that could hear about a terminal whose every read is refused would be a channel to nowhere.
Incomplete triples are refused before any lookup, exactly as the pairing branch does.

**D40. THE SOCKET IS A LATENCY DEVICE; THE POLL IS STILL THE GUARANTEE.** Nothing about the
existing schedule changed. A nudge that arrives when no wait is live, for another sale, or after
the operator stopped waiting is ignored; a read already in flight is left to answer, so a nudge can
never become a second question; and a read that fails without re-arming a poll gets its schedule
back. The payload remains IDS ONLY: the amount, the provider's status and the proof are read from
the row, so a replayed or spoofed event can only make a register ask a question it is already
entitled to ask.

### 15.3 The evidence

**The server.** `pairing-realtime.gateway.spec.ts` → **16 cases** (10 before), and the new ones are
about the room: a paired register is admitted by its credential, joins its merchant's device room,
and never consults the pairing path; a rejected credential, a device that must rotate, and an
incomplete triple all answer the one constant rejection; and the tender nudge is emitted to
`device:<merchantId>` with ids only — asserted as the absence of an amount and a provider status,
because "ids only" is the property, not the field list. Both application roots still boot
(`app-graph.integration.ts`), which is how the gateway's new dependency is checked.

**And the ROOM KEY is proved against rows, not against a mock.** That gateway case stubs
`DevicesService.authenticate`, so it shows the socket goes where the service points it — not that
the service points at the right café. `device-credential.integration.ts` (**7 passed**, three
consecutive runs, added in the ninth pass) closes that: two cafés whose devices hold only the
SHA-256 of their installation ids and credentials, driven through the real service and the real
repository. Each credential resolves to its OWN merchant — with the row it touched as the witness,
since the lookup stamps `last_seen_at` — a credential presented for the other café's device is
refused, a right credential with a wrong installation id is refused, a revoked device is refused,
and a device mid-rotation is refused `DEVICE_ROTATION_REQUIRED`, which is the exact branch the
socket handshake catches, while resolving when the caller says it will rotate. Before this file,
D39's "the room key comes from the credential" rested on a mocked lookup, and a predicate that
matched the wrong row looks identical from behind a mock.

**And the HOP is proved on a real socket.** `tender-nudge.integration.ts` (**2 passed**, three
consecutive runs, added in the ninth pass) is the only case in this workstream that does not stop
one step short of the register: it boots the real `AppModule` on a real port, connects a real
socket.io client carrying a real device credential, and then writes the attempt row the tender path
writes. The trigger fires, the LISTEN hears it, the bus fans it out, the gateway addresses the
merchant's device room, and the CLIENT receives `tender.attempt.changed` with exactly the four ids
and nothing else — asserted on the payload rather than on the gateway's intent. An anonymous socket
in the same test is refused. Six links, previously proved six times separately, now proved once end
to end.

**The till.** `flutter analyze` clean and `flutter test` → **397 passed**. The case that matters is
the one with the poll armed TEN MINUTES out and a one-minute bound, so nothing but the channel can
end the wait: another sale's nudge changes nothing at all, this sale's nudge named by its
`attemptId` makes the read while the wait continues, and the one named by its `commandIdentity`
resolves the sale. The author mutation-checked it — making the nudge handler return immediately
turns it red — which is the difference between a test and a decoration. A second case proves the
channel is wired and silent when it should be: the poll still resolves the sale, and disposing the
sheet leaves no listener. `realtime_contract_test.dart` reads the event name and the payload's
field names out of the contract, so a rename cannot leave the till silently ignoring every nudge.

### 15.4 What is still open

1. **THE HOP IS NOW PROVEN; THE NUMBER IS STILL UNMEASURED.** `tender-nudge.integration.ts`
   (added in the ninth pass, **2 passed**, three consecutive runs) boots the real application on a
   real port, connects a real socket.io client with a real device credential, and then writes the
   attempt row the tender path writes — so the trigger, the LISTEN, the in-process bus, the device
   room and the wire are exercised in ONE test rather than six. A socket with no credential is
   refused; the admitted one receives `tender.attempt.changed` carrying exactly the four ids and
   nothing else. What remains, and cannot be produced here, is the wall-clock number and the
   terminal that starts it: a real card answering a real order is Phase 0 and Phase 5 step 5, both
   the owner's. The mechanism is proven; the measurement is not, and this plan does not claim it.
2. **The gateway is still single-process — and that is not this plan's to close.** The
   `DashboardRealtimeEvents` bus and the device room that hangs off it are in-process, so a second
   API replica would not deliver a nudge to a socket held by the first. The fix is
   `@socket.io/redis-adapter` over the `REDIS_URL` the queues already use, and it is **Workstream K
   step 4 of [the ultimate platform plan](./2026-09-15-ultimate-platform-plan.md)**, whose own
   status table records it as "Not started... the Redis realtime adapter do[es] not [exist]". This
   plan inherits the gate rather than owing it, and the honest thing is to say which document owns
   the work: a deployment runs one API replica today, and the gate has to be satisfied before a
   second one runs rather than after.
3. **A paired register has no way to say it is gone.** The socket closes and nobody notices, which
   is fine — presence is not what this channel is for, and `last_seen_at` is the REST path's job.
   Named so that a later "online register" feature does not mistake this room for a presence feed.

## 16. The seventh pass, 2026-09-17 — the guard, against rows

§13.4 item 4 was the last thing this plan owed, and writing it turned up the reason it mattered.
The case is `apps/umi-api/src/modules/pos-exception/point-card-refund.integration.ts`; the item
above records what it seeds and what it proves.

### 16.1 The decision

**D41. A REFUND REACHES ITS TENDER THROUGH THE CAPTURE, NOT THROUGH ITSELF.** The guard that
decides whether a card tender may be recorded as refunded joined the tender through the attempt the
caller handed in — `t.id = a.tender_id` — and asked that attempt to be a succeeded, provider-proofed
refund. No such row can exist: a refund attempt carries NO `tender_id`, and the schema is right to
insist, because `pos_payment_attempt_cart_tender_uq (merchant_id, cart_id, tender_id)` is what lets
one cart hold one attempt per tender, so a refund naming the same tender would collide with the
capture it refunds. The join matched nothing, so EVERY legitimate partial refund was refused
`TERMINAL_REFUND_CONFIRMATION_REQUIRED`: the money moved at the terminal and the sale could not
record it, which is the lie §13 exists to prevent, arriving from the opposite direction.

The verification is one hop further and it is the real relationship: `a.refund_of_attempt_id`
names the capture, and the capture names the tender. Two joins instead of one, and the predicate
that was already there — succeeded, provider-proofed, refund id present — is unchanged.

**WHY IT SURVIVED UNTIL NOW, STATED SO IT CANNOT SURVIVE AGAIN.** `point-card-refund.spec.ts`
mocks the repository, so it asserts the ORDER of the caller's moves and never executes this query;
`sql-preflight.integration.ts` PREPAREs the query and cannot know whether it matches a row. The
only instrument that could see it is a case that puts real rows in front of it, and that is exactly
what §13.4 item 4 asked for and what this pass wrote. The failing case is the evidence: it failed
before the fix and passes after it, three consecutive runs.

### 16.2 The evidence

| Command                                                                                                           | Result                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npx vitest run --config vitest.integration.config.ts src/modules/pos-exception/point-card-refund.integration.ts` | **3 passed**, run three times consecutively, against a disposable build-v3 database |
| `pnpm --filter @umi/api exec vitest run src/modules/pos-exception`                                                | **28 passed** — the caller's own unit cases, unmoved by the fix                     |

### 16.3 What is still open

Nothing in this plan that a person with a keyboard can finish — a claim §17 was written to test,
and §17 found two things it was wrong about.

## 17. The eighth pass, 2026-09-17 — the observability the plan asked for

§16.3 said the buildable work was done. That claim was tested by walking the plan's OWN numbered
requirements rather than its prose, and §7 — "Observability", four sentences written before any of
this existed — turned out to be two-thirds true. Items 2 and 4 were built; **items 1 and 3 were
not**, and nothing had noticed because no gate in this repository reads a requirements list.

### 17.1 What landed

| Piece                              | Where                                                                                                                                                 | What it does                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The provider-call line (§7 item 1) | `tender.service.ts` → `logProviderCall`, called from `askProvider`, `askQuery`, `askRefund`                                                           | One line per call carrying provider, operation, attempt id, correlation id, order id, the vendor's status word, the outcome and the latency. Nothing else is interpolated — no token can reach it.                                                                                     |
| The gauge (§7 item 3)              | `shared/operations/metrics.service.ts` → `gauge`; `tender.repository.ts` → `countUnresolvedPastQueryWindow`; `tender/point-attempt-health.service.ts` | A LEVEL rather than a total: attempts in a not-yet-answered state whose `query_after` has passed, counted across every café on the worker pool, published as `tender.attempts_unresolved_past_query_window` in the diagnostics snapshot, and logged at `warn` whenever it is not zero. |
| Its clock                          | `jobs/mp-point-attempt-health.scheduler.ts`, `SystemProcessor`                                                                                        | Every five minutes, on the `system` queue — the same shape the renewal sweep uses, because the API process must not do background reads.                                                                                                                                               |
| The evidence                       | `operations.spec.ts`, `point-attempt-health.service.spec.ts`, `mp-point-attempt-health.scheduler.spec.ts`, `tender.integration.ts`                    | The gauge's SET semantics; the warn/log split; the schedule; and — on the real call path, through the real registry — a capture asserted to emit a line with all five fields and nothing credential-shaped.                                                                            |

### 17.2 The decision

**D42. A LEVEL NEEDS A GAUGE, AND A REQUIREMENTS LIST NEEDS A WALK.** Two decisions, both small
and both load-bearing.

The first: `MetricsService` counted events and only ever rose, so "how many attempts are waiting
right now" had no way to be expressed — a counter would have reported the INTEGRAL of the problem.
`gauge` was added, and the health number is set rather than accumulated. §7 item 3's sentence only
works if the number can go back down.

The second: §16.3's "nothing buildable remains" was a claim about an absence, which is the kind of
claim that needs a search rather than a memory. Walking §7 found two unimplemented requirements;
walking §6 would find the "real charge" row that is the owner's, and §9's open questions, which are
recorded as open by design. **What the walk did NOT find is as useful as what it did:** every
numbered Phase step has an artifact behind it.

### 17.3 The boot probe, again

Adding the counter to `TenderModule` broke the WORKER root: `Nest can't resolve dependencies of the
PointAttemptHealthService (TenderRepository, ?)` — `OperationsModule` is `@Global()`, and a global
module's exports reach a graph only once it is registered in the root being bootstrapped. The API
root imports it; the worker root never had, because nothing in it had ever needed the metric
registry. `TenderModule` now names the dependency it uses, and `app-graph.integration.ts` — written
in §14 after exactly this class of failure shipped silently — caught it in the same minute it was
introduced. That is twice now: the module graph is the one thing `tsc` and every unit suite cannot
see.

### 17.4 What is still open

This list was re-walked after §17 rather than assumed, and it did not change: every remaining item
needs the owner's Mercado Pago account, a terminal at a counter, or a second API replica. §7's four
items are all built; §6's "a real charge" row is the one scenario in that table no stub can stand
in for; and the multi-replica fan-out is Workstream K step 4 of the platform plan rather than a gap
here (§15.4 item 2 now says so, with the citation).

**The walk that followed (§18) is the reason this section is trustworthy.** Twice now a "nothing
left" claim has been wrong: §16.3 said it and §17 found two unimplemented requirements a few
hundred words above it. A claim about an absence is only as good as the search behind it, and the
search is now the plan's own numbered lists — §3's decisions, §4's steps, §5's budgets, §6's
scenarios, §7's items, §9's questions — walked one by one against the tree instead of recalled.

## 18. The ninth pass, 2026-09-17 — the walk, and what it did not find

§17 built two requirements that §16.3 had declared absent. So this pass did the same walk again,
deliberately, on the sections §17 had not reached — and it found nothing to build. That is a result
worth writing down precisely, because "found nothing" is only meaningful if the search is named.

### 18.1 What was walked

| Requirement                                                                                                | Where it is satisfied                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §4 Phase 2 step 5 — migration 72 registered in `00_run.sh` and covered by `99_verify.sql`                  | Both hold. `99_verify` carries fifteen checks for that migration alone: the two tables, the terminal-id shape guard, the partial unique index over open attempts, the proof guards on `pos_payment_attempt`, and the version row. |
| §5 — "webhook acknowledgement under 300 ms: verify, enqueue, answer, **no database work on the hot path**" | `PointWebhookService` has no repository injected and the controller's constructor takes only that service, so the receiver CANNOT reach a database. The claim is structural, not asserted.                                        |
| §3 D10 — "there is no offline card capture, and the product says so"                                       | POS routes carry `offline: false`; `offline_policy.dart` refuses any non-cash method with a named reason (`payment_method_unsupported`); the till says "La terminal de tarjeta no está disponible. Puedes cobrar en efectivo."    |
| §4 Phase 1–5 step by step, §6's scenario table, §9's questions                                             | Each step has an artifact behind it; §6's rows are covered by suites except "a real charge", which is the owner's; §9 is five vendor-and-panel questions, recorded as open by design.                                             |

### 18.2 The one thing re-examined, and what it turned out to be

§15.4 item 2 — the multi-replica fan-out — was the last item that was neither owner-gated nor a
design note, and §17 left it alone. Re-examining it with evidence rather than reluctance settled
it: `@socket.io/redis-adapter` is **Workstream K step 4 of the ultimate platform plan**, whose own
status table records that workstream as "Not started... the Redis realtime adapter do[es] not
[exist]". This plan inherits the gate; it does not own the work. Adding a dependency the platform
plan has not scheduled, into a worktree with some three hundred uncommitted changes, to satisfy a
precondition for a scaling event that has not happened, would be churn wearing the costume of
progress. §15.4 item 2 now says all of that with the citation.

### 18.3 Housekeeping the walk turned up

- **The walk DID find one thing to build after all — a proof, not a feature.**
  `device-credential.integration.ts` (`7 passed`, three consecutive runs) runs the real
  `DevicesService.authenticate` against real device rows, which is the claim §15.2 D39 rests on and
  which had been resting on a mocked lookup. §15.3 now records it beside the gateway cases. That is
  the second time this exercise has paid: the first turned up §7's two unimplemented requirements,
  and this one turned up a security property that was asserted rather than proved.

- **…and then a second: the hop itself.** `tender-nudge.integration.ts` (`2 passed`, three
  consecutive runs) boots the real application, connects a real socket with a real device
  credential, writes an attempt row, and asserts the nudge arrives at the client carrying ids only.
  §15.4 item 1 had said the hop "needs a paired terminal... and never once end to end" — the
  terminal is needed for the NUMBER, not for the hop, and conflating the two kept six separately
  proved links from being proved together. Both files are in `test:integration:schema` now, so the
  next person to change the gateway or the listener finds out immediately.
- **The generated contract had drifted** — another session's `table-order` addition landed after
  the last generation, so the repo's own `generate:check` failed at the first step. Regenerated
  (2.21.0 → 2.22.0) and the consumers re-verified against it: API `typecheck` clean, this
  workstream's 213 tests green, `flutter analyze` clean, and the POS contract test passing.
- **The repo-wide gates are red on other workstreams, not this one.** `pnpm check:pr` fails at
  `@umi/api:lint` with three errors in the new `table-order/*` module (an unused import and two
  unnecessary assertions); `prettier --check .` flags fourteen files, none of them this
  workstream's. Every file this plan touched is clean under both.
