# Umi extension points for a live Mercado Pago Point integration

- Date: 2026-09-17.
- Method: CodeGraph 1.6.0 index for `/home/jc/umi` (26,336 nodes, 1,268 files), then a
  read of every source file that carries a structural claim below.
- Rule applied: CodeGraph gives the location. The source file gives the truth. Every
  claim below carries a `path:line` and the real code.
- Status: the map is complete. No file was changed except this one.

## 1. The tender module

The module is `apps/umi-api/src/modules/tender/`. It holds 14 files:

| File                                       | Role                                                                |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `tender.module.ts`                         | The NestJS module. It registers the providers.                      |
| `tender.controller.ts`                     | The five HTTP routes.                                               |
| `tender.service.ts`                        | The capture, query, assert and settle operations.                   |
| `tender.repository.ts`                     | The SQL for the attempt record.                                     |
| `tender-provider.port.ts`                  | The provider interface and the DI token.                            |
| `tender-provider.registry.ts`              | The `id -> provider` map.                                           |
| `point-transport.port.ts`                  | The terminal transport seam. It holds `UnconfiguredPointTransport`. |
| `tender-domain.ts`                         | The pure outcome arithmetic.                                        |
| `tender-domain.spec.ts`                    | The property tests for the arithmetic.                              |
| `tender.integration.ts`                    | The acceptance test against the real schema.                        |
| `providers/cash.provider.ts`               | The drawer.                                                         |
| `providers/manual-terminal.provider.ts`    | The operator-attested terminal.                                     |
| `providers/mercado-pago-point.provider.ts` | The card-present adapter.                                           |
| `providers/scripted-terminal.provider.ts`  | The test instrument.                                                |

### 1.1 The two ports

`TenderProviderPort` is at `apps/umi-api/src/modules/tender/tender-provider.port.ts:76`. It
declares one identity, one family, two availability fields, and two operations:

```ts
export interface TenderProviderPort {
  readonly id: string;
  readonly family: TenderFamily;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  capture(request: ProviderCaptureRequest): Promise<ProviderOutcome>;
  query(request: ProviderQueryRequest): Promise<ProviderOutcome>;
}
```

`ProviderCaptureRequest` is at `tender-provider.port.ts:19`. It carries the command
identity, the amount in integer minor units, the currency, the cart id, the location id,
the tender id and the correlation id.

`ProviderOutcome` is at `tender-provider.port.ts:49`. It is a three-branch union:
`succeeded` with a nullable payment id, `declined` with a code, and `unknown` with a
`queryAfterSeconds` clock. The DI token is at `tender-provider.port.ts:101`:

```ts
export const TENDER_PROVIDER_PORTS = 'TENDER_PROVIDER_PORTS';
```

`PointTransport` is at `apps/umi-api/src/modules/tender/point-transport.port.ts:41`. It is
the narrow seam for one device API:

```ts
export interface PointTransport {
  readonly configured: boolean;
  readonly unavailableReason: string | null;
  createOrder(input: PointOrderInput): Promise<PointOrderSnapshot>;
  readOrder(orderId: string): Promise<PointOrderSnapshot>;
}
```

`PointOrderSnapshot` keeps the provider status verbatim
(`point-transport.port.ts:34`). `PointOrderInput` carries `externalReference`
(`point-transport.port.ts:20`). This is the field that links a terminal order to a sale.

### 1.2 Where the transport is constructed

`UnconfiguredPointTransport` is at `point-transport.port.ts:50`. The module builds it in
`apps/umi-api/src/modules/tender/tender.module.ts:35`:

```ts
export const buildTenderProviders = (
  config: ConfigService<AppConfig, true>,
): TenderProviderPort[] => {
  const accessToken = config.get('MERCADO_PAGO_POINT_ACCESS_TOKEN', { infer: true });
  const terminalId = config.get('MERCADO_PAGO_POINT_TERMINAL_ID', { infer: true });
  const missing = [
    accessToken ? null : 'MERCADO_PAGO_POINT_ACCESS_TOKEN',
    terminalId ? null : 'MERCADO_PAGO_POINT_TERMINAL_ID',
  ].filter((name): name is string => name !== null);

  const providers: TenderProviderPort[] = [
    new CashProvider(),
    new ManualTerminalProvider(),
    new MercadoPagoPointProvider(
      new UnconfiguredPointTransport(
        missing.length > 0
          ? `The card terminal is not configured in this deployment: missing ${missing.join(', ')}.`
          : 'The Mercado Pago Point transport is not implemented yet.',
      ),
    ),
  ];
```

`tender.module.ts:49` is the exact swap point. A live transport replaces the
`new UnconfiguredPointTransport(...)` argument at `tender.module.ts:49`. Nothing else in
the module changes, because `MercadoPagoPointProvider` reads only
`transport.configured` and `transport.unavailableReason`
(`providers/mercado-pago-point.provider.ts:32` and `:36`).

`MercadoPagoPointProvider` has the id `mercado_pago_point` and the family `card_present`
(`providers/mercado-pago-point.provider.ts:27` and `:28`). It maps
`request.commandIdentity` into `externalReference`
(`providers/mercado-pago-point.provider.ts:46`).

### 1.3 The service and the repository

`TenderService` methods, with their lines in `tender.service.ts`:

| Method      | Line | Effect                                                   |
| ----------- | ---- | -------------------------------------------------------- |
| `capture`   | 94   | Starts an attempt and calls the provider once.           |
| `attempt`   | 199  | Reads an attempt, and queries the provider on `refresh`. |
| `assert`    | 258  | Records an operator's word. It changes no state.         |
| `settle`    | 348  | Turns an operator's word into a final state.             |
| `providers` | 468  | Returns the provider list for the till.                  |
| `authorize` | 701  | Private. It reuses the checkout gate.                    |

`TenderRepository` methods, with their lines in `tender.repository.ts`:

| Method                  | Line |
| ----------------------- | ---- |
| `authorize`             | 110  |
| `loadOpenCart`          | 129  |
| `beginAttempt`          | 160  |
| `claimProviderCapture`  | 218  |
| `resolveAttempt`        | 237  |
| `readByCommandIdentity` | 279  |
| `readById`              | 309  |

### 1.4 The routes and the guards

The controller is `apps/umi-api/src/modules/tender/tender.controller.ts`. The class gate is
at `tender.controller.ts:30`:

```ts
@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId')
```

The five routes:

| Method | Path                                                                    | Controller line |
| ------ | ----------------------------------------------------------------------- | --------------- |
| `POST` | `/api/v1/pos/merchants/:merchantId/tenders/capture`                     | 36              |
| `GET`  | `/api/v1/pos/merchants/:merchantId/tenders/:commandIdentity`            | 45              |
| `POST` | `/api/v1/pos/merchants/:merchantId/tenders/:commandIdentity/assertion`  | 55              |
| `POST` | `/api/v1/pos/merchants/:merchantId/tenders/:commandIdentity/settlement` | 74              |
| `GET`  | `/api/v1/pos/merchants/:merchantId/tender-providers`                    | 84              |

There is no `RolesGuard` on this controller. The file states the reason at
`tender.controller.ts:68`: the only extra permission is enforced in the service. That
permission is `checkout.terminal.confirm`, at `tender.service.ts:364`.

## 2. The capture path, end to end

The route is `POST .../tenders/capture` (`tender.controller.ts:36`). The order of
operations is the design, and the service states it at `tender.service.ts:44`.

1. The attempt is persisted first. `tender.service.ts:105` calls `integrity.execute` with
   the command type `tender.capture_requested`. The repository INSERT is at
   `tender.repository.ts:166`:

```sql
INSERT INTO merchant.pos_payment_attempt
  (merchant_id,location_id,cart_id,method,provider,amount_minor_units,currency,
   status,query_only,correlation_id,command_identity,tender_draft_id,expires_at)
VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,'pending',false,$8,$9::uuid,$10::uuid,
        clock_timestamp() + make_interval(secs => $11))
ON CONFLICT DO NOTHING
RETURNING ...
```

The conflict clause covers both unique indexes. The loser reads the winner's row
(`tender.repository.ts:192`).

2. The claim is the one-way gate. `tender.service.ts:164` calls
   `claimProviderCapture`. The SQL is at `tender.repository.ts:221`:

```sql
UPDATE merchant.pos_payment_attempt
   SET provider_capture_at=clock_timestamp()
 WHERE merchant_id=$1::uuid AND id=$2::uuid
   AND provider_capture_at IS NULL AND status='pending'
```

Only the writer with `rowCount === 1` reaches the provider
(`tender.repository.ts:227`).

3. The provider is asked outside any transaction. `tender.service.ts:174` calls
   `askProvider`. A provider that throws becomes `unknown`, never a decline
   (`tender.service.ts:556`).

4. The answer is recorded in a second command. `tender.service.ts:479` calls
   `resolveAttempt`. The SQL is at `tender.repository.ts:244`. The guard makes the write
   monotonic:

```sql
 WHERE merchant_id=$1::uuid AND id=$2::uuid
   AND (status IN ('pending','unknown','timeout')
        OR (status='declined' AND $3='succeeded'))
```

### 2.1 The columns the capture writes

| Column                                                        | Written by                                             |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| `merchant_id`, `location_id`, `cart_id`                       | `beginAttempt`                                         |
| `method`, `provider`                                          | `beginAttempt`                                         |
| `amount_minor_units`, `currency`                              | `beginAttempt`                                         |
| `status`                                                      | `beginAttempt` with `'pending'`, then `resolveAttempt` |
| `query_only`                                                  | `beginAttempt` with `false`, then `resolveAttempt`     |
| `correlation_id`                                              | `beginAttempt`                                         |
| `command_identity`                                            | `beginAttempt`                                         |
| `tender_draft_id`                                             | `beginAttempt`                                         |
| `expires_at`                                                  | `beginAttempt`                                         |
| `provider_capture_at`                                         | `claimProviderCapture`                                 |
| `proof_source`                                                | `resolveAttempt`                                       |
| `provider_status`, `provider_order_id`, `provider_payment_id` | `resolveAttempt`                                       |
| `query_after`                                                 | `resolveAttempt`                                       |
| `provider_query_count`                                        | `resolveAttempt`                                       |
| `resolved_at`                                                 | `resolveAttempt`                                       |

### 2.2 The link from the attempt to the tender

The attempt carries `tender_draft_id`. The commit reads it and links the attempt to the
tender it paid. The column is deliberately not a foreign key. The migration states the
reason at `docs/migration/build-v3/70_tender.sql:169`: the fact is written at commit, and
an abandoned attempt must be recorded even when no fact will ever exist.

The commit path is the existing checkout, not the tender module. `TenderService` calls
`repo.loadOpenCart` first (`tender.service.ts:101`), and the repository delegates
authorization to `PosCheckoutRepository.authorize` (`tender.repository.ts:118`).

## 3. The database shape

### 3.1 The base table

The table is created in `docs/migration/build-v3/20_merchant.sql:1944`:

```sql
create table merchant.pos_payment_attempt (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete restrict,
  location_id     uuid not null references merchant.location(id),
  cart_id       uuid not null references merchant.pos_cart(id) on delete restrict,
  method        text not null check (method in ('cash','external_terminal')),
  amount_minor_units bigint not null check (amount_minor_units >= 0),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  status        text not null
                  check (status in ('pending','succeeded','declined','cancelled','unknown','timeout')),
  query_only    boolean not null default false,
  provider_reference text,
  correlation_id text not null,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  unique (merchant_id, cart_id),
  constraint payment_attempt_ambiguity_ck
    check (status not in ('unknown','timeout') or query_only)
);
```

`32_pos_checkout.sql:134` drops `unique (merchant_id, cart_id)` and replaces it with
`pos_payment_attempt_cart_tender_uq unique(merchant_id,cart_id,tender_id)`
(`docs/migration/build-v3/32_pos_checkout.sql:136`).

### 3.2 The extension

`docs/migration/build-v3/70_tender.sql:142` adds ten columns. It adds six CHECK
constraints, each guarded by a `pg_constraint` test:

| Constraint                                 | Line | It forbids                                     |
| ------------------------------------------ | ---- | ---------------------------------------------- |
| `payment_attempt_success_provenance_ck`    | 231  | A success with no proof source.                |
| `payment_attempt_provider_proof_has_id_ck` | 248  | Provider proof without a payment id.           |
| `payment_attempt_unknown_shape_ck`         | 266  | An ambiguous attempt with no command identity. |
| `payment_attempt_provider_slug_ck`         | 282  | A malformed provider slug.                     |
| `payment_attempt_proof_source_ck`          | 298  | A fifth spelling of proof.                     |
| `payment_attempt_query_count_ck`           | 315  | A negative query counter.                      |

The two unique indexes are the money guard:

```sql
create unique index if not exists pos_payment_attempt_command_identity_uidx
  on merchant.pos_payment_attempt (merchant_id, command_identity)
  where command_identity is not null;
```

at `70_tender.sql:335`, and

```sql
create unique index if not exists payment_attempt_tender_draft_uq
  on merchant.pos_payment_attempt (merchant_id, cart_id, tender_draft_id)
  where tender_draft_id is not null;
```

at `70_tender.sql:348`.

`provider` is a free slug and not an enum (`70_tender.sql:282`). The comment at
`70_tender.sql:38` states the reason: a second brand must not need a migration.

### 3.3 Where a new migration belongs

**Fact.** `supabase/migrations` DOES NOT EXIST. The workspace `AGENTS.md` names it for
approved post-cutover migrations, but no such directory is present.

| Question                     | Answer                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| The real chain               | `docs/migration/build-v3/`                                                                                  |
| The numbering convention     | `NN_name.sql`, two digits                                                                                   |
| The last file number in use  | `71`, in `71_immutable_delete_fix.sql`                                                                      |
| The next free number         | `72`                                                                                                        |
| The runner                   | `docs/migration/build-v3/00_run.sh`                                                                         |
| The registration point       | `00_run.sh:8`, the `for f in ...` list                                                                      |
| `apps/umi-api/db/migrations` | It exists and holds only `.gitkeep`. It is not the chain.                                                   |
| The verification file        | `docs/migration/build-v3/99_verify.sql`, which asserts the tender constraints at line 219 and later         |
| The version stamp            | `70_tender.sql:578`, `insert into runtime.schema_migration(version,status) values('build-v3-70','applied')` |

**Umi-specific inference.** A new file for this work is
`docs/migration/build-v3/72_<name>.sql`, and its name goes into the list at
`00_run.sh:8` before the `99_verify` entry.

## 4. The contract

### 4.1 The route table entries

The five entries are in `packages/contract/src/route-table.ts`. The helper is
`posMerchantRoute`, declared at `route-table.ts:98`. It prefixes `/api/v1/pos/merchants/:merchantId`
(`route-table.ts:114`) and sets `auth: 'operator-session'` (`route-table.ts:120`).

| Route id              | Line | Method | Suffix                                 | Permission                  |
| --------------------- | ---- | ------ | -------------------------------------- | --------------------------- |
| `pos.tenderCapture`   | 3238 | `POST` | `/tenders/capture`                     | `checkout.commit`           |
| `pos.tenderAttempt`   | 3254 | `GET`  | `/tenders/:commandIdentity`            | `checkout.commit`           |
| `pos.tenderAssert`    | 3265 | `POST` | `/tenders/:commandIdentity/assertion`  | `checkout.commit`           |
| `pos.tenderSettle`    | 3284 | `POST` | `/tenders/:commandIdentity/settlement` | `checkout.terminal.confirm` |
| `pos.tenderProviders` | 3300 | `GET`  | `/tender-providers`                    | `checkout.commit`           |

### 4.2 The model files

The models are in `packages/contract/src/tender.ts`. It is exported from
`packages/contract/src/index.ts:36` (`export * from './tender';`).

| Model                     | Line |
| ------------------------- | ---- |
| `TenderProviderId`        | 43   |
| `TenderFamily`            | 54   |
| `TenderProofSource`       | 78   |
| `TenderOutcomeKind`       | 87   |
| `TenderOutcome`           | 90   |
| `TenderAttempt`           | 126  |
| `TenderCaptureRequest`    | 198  |
| `TenderCaptureResult`     | 212  |
| `TenderAttemptQuery`      | 230  |
| `TenderAttemptResult`     | 248  |
| `TenderOperatorAssertion` | 264  |
| `TenderAssertionRequest`  | 271  |
| `TenderAssertionResult`   | 288  |
| `TenderSettlementOutcome` | 321  |
| `TenderSettlementRequest` | 339  |
| `TenderSettlementResult`  | 351  |
| `TenderProviderQuery`     | 367  |
| `TenderProviderOption`    | 375  |
| `TenderProviderList`      | 390  |

### 4.3 The pattern for a new route

1. Add the model to `packages/contract/src/tender.ts`.
2. Add one `posMerchantRoute({...})` entry to `packages/contract/src/route-table.ts`.
3. Add the controller method to `tender.controller.ts`.
4. Regenerate the Dart client. The generated file is
   `packages/contract/generated/dart/lib/umi_contract.dart`, and the route helper for the
   provider read is at `umi_contract.dart:267`.
5. The POS consumes the route through `UmiRoutes`. The Dart repository calls
   `UmiRoutes.posTenderCapture(merchantId)` at
   `apps/umi-pos/lib/features/checkout/checkout_repository.dart:73`.

## 5. The webhook surface

### 5.1 The one existing third-party receiver

The only third-party webhook in the API is the Twilio WhatsApp ingress. It is
`apps/umi-api/src/modules/conversations/whatsapp.controller.ts`. The controller is
registered in `conversations.module.ts:49`.

The route is `POST /conversations/whatsapp`
(`whatsapp.controller.ts:58`). The pattern has four parts.

1. **A raw body.** Fastify normally parses form bodies. `apps/umi-api/src/main.ts:80`
   removes the default parser and installs one with `parseAs: 'string'`
   (`main.ts:85`). The file states the reason at `main.ts:75`: the HMAC must see the exact
   bytes.
2. **A signature header.** The handler reads `x-twilio-signature` as a header
   (`whatsapp.controller.ts:62`).
3. **A fail-closed check.** `whatsapp.controller.ts:74`:

```ts
if (!this.authToken || !this.webhookUrl) {
  if (this.allowInsecure) { ... } else {
    this.logger.error(...);
    return emptyTwiml();
  }
} else {
  const valid = validateTwilioSignature(...);
  if (!valid) { this.logger.warn(...); return emptyTwiml(); }
}
```

4. **An HMAC with a constant-time compare.** `validateTwilioSignature` is at
   `apps/umi-api/src/modules/conversations/security.service.ts:179`. The compare is at
   `security.service.ts:193`:

```ts
const computed = createHmac('sha1', authToken).update(str, 'utf8').digest('base64');
const a = Buffer.from(computed);
const b = Buffer.from(signature);
if (a.length !== b.length) return false;
return timingSafeEqual(a, b);
```

**Fact.** One route in this repository verifies an HMAC. It is the Twilio route. The
`leads.controller.ts:79` route `api/leads/webhook/email-response` is the other receiver,
and it is not a signature check.

**Fact.** There is no generic webhook module. A Mercado Pago webhook route is new work.

### 5.2 What a Point webhook needs that the Twilio route does not have

The Twilio secret is a deployment value (`TWILIO_AUTH_TOKEN`,
`whatsapp.controller.ts:53`). A third-party merchant webhook needs the per-merchant
secret instead. That secret does not exist in the schema today.

## 6. The outbox and the worker

### 6.1 The outbox row

The table is `runtime.outbox_event`. Its DDL is at
`docs/migration/build-v3/30_runtime.sql:169`. The unique key is
`outbox_event_merchant_key_uq unique (merchant_id, idempotency_key)`
(`30_runtime.sql:191`).

The one writer today is `apps/umi-api/src/modules/conversations/turn-commit.repository.ts:43`:

```sql
INSERT INTO runtime.outbox_event ...
```

A domain writes the row inside its own database transaction. The relay then drains it.

### 6.2 The relay

`OutboxRelayService` is `apps/umi-api/src/jobs/outbox-relay.service.ts:53`. A domain
registers a route with `OutboxRouter.register` (`outbox-relay.service.ts:27`). The mapping
is `event_type -> { queue, jobName }` (`outbox-relay.service.ts:14`).

The relay is INERT by default. `OUTBOX_RELAY_ENABLED` defaults to false, at
`outbox-relay.service.ts:74`. The comment at `outbox-relay.service.ts:47` states that no
routes are registered until a phase wires them.

### 6.3 The worker and a job

The queue names are in `apps/umi-api/src/jobs/queues.ts:10`:

```ts
export const QUEUES = {
  system: 'system',
  turns: 'turns',
  enrichment: 'enrichment',
  outbound: 'outbound',
  integrations: 'integrations',
  lifecycle: 'lifecycle',
} as const;
```

To add a worker:

1. Add the queue name to `QUEUES` and to `ALL_QUEUES` (`queues.ts:22`).
2. Register the queue with `BullModule.registerQueue`
   (`apps/umi-api/src/jobs/queue.module.ts:54`).
3. Write a processor class that extends `BaseProcessor`
   (`apps/umi-api/src/jobs/base.processor.ts:17`).
4. Decorate the class with `@Processor(QUEUES.<name>, workerOptions(QUEUES.<name>))`. The
   example is `apps/umi-api/src/jobs/outbound.processor.ts:21`.

**Umi-specific inference.** A terminal status job belongs on the `integrations` queue. That
queue already exists for provider sync (`queues.ts:15`), and a Point order poll is the same
class of work.

## 7. Realtime and connectivity

### 7.1 The channel names

The names are in `packages/contract/src/realtime-channels.ts`. This file has zero
dependencies on purpose, and it states the reason at `realtime-channels.ts:4`.

| Name                                   | Line | Value                            |
| -------------------------------------- | ---- | -------------------------------- |
| `REALTIME_NAMESPACE`                   | 14   | `/rt`                            |
| `REALTIME_EVENT_PAIRING_CHANGED`       | 22   | `device.pairing.changed`         |
| `pairingRoom`                          | 25   | `pairing:<pairingSessionId>`     |
| `DASHBOARD_REALTIME_NAMESPACE`         | 30   | `/rt/dashboard`                  |
| `DASHBOARD_EVENT_DEVICES_CHANGED`      | 38   | `dashboard.devices.changed`      |
| `DASHBOARD_EVENT_CONVERSATION_MESSAGE` | 45   | `dashboard.conversation.message` |
| `dashboardRoom`                        | 48   | `dashboard:<merchantId>`         |

The convention is `dashboard.<subject>.<change>` for the dashboard, and
`<subject>.<subject>.<change>` for the POS namespace.

The payload rule is stated twice: the socket is a wake-up, not a delivery gate. See
`realtime-channels.ts:35` and `realtime-channels.ts:42`. The client re-reads over REST.

### 7.2 The pairing handshake

The gateway is `apps/umi-api/src/modules/realtime/pairing-realtime.gateway.ts`. The
handshake behavior is asserted in
`apps/umi-api/src/modules/devices/pairing-realtime-handshake.integration.ts`. The credential
never travels on the socket (`realtime-channels.ts:18`). `pollPairing` is the only delivery
gate.

### 7.3 The clients

| Client          | Entry point                                                                               | Line |
| --------------- | ----------------------------------------------------------------------------------------- | ---- |
| Dashboard       | `apps/umi-dashboard/src/lib/device-realtime.js`, `useDevicesRealtime`                     | 27   |
| POS (Dart)      | `apps/umi-pos/lib/features/entry/pairing_socket_client.dart`, `realtimeNamespace = '/rt'` | 12   |
| POS socket call | same file, `socket_io.io(...)`                                                            | 54   |

**Umi-specific inference.** A terminal status channel takes the shape
`dashboard.<terminal>.changed`, and one new event plus one room builder is the whole
contract change. The till reads the status over REST after the wake-up.

## 8. The devices feature and the dashboard

### 8.1 The dashboard screen

The screen is `apps/umi-dashboard/src/screens/devices.jsx`. The component is
`DevicesScreen` at `devices.jsx:67`, and the default export is at `devices.jsx:2231`.

The route is in `apps/umi-dashboard/src/app.jsx:388`, under
`<GuardedScreen moduleKey="devices">` (`app.jsx:390`). The module registry entry is
`apps/umi-dashboard/src/lib/module-registry.js:68`.

The screen reads two lists. The POS list comes from `getPosDevices`
(`devices.jsx:26`, defined at `apps/umi-dashboard/src/data.jsx:835`). The KDS list comes
from `useDevicesData` (`apps/umi-dashboard/src/data.jsx:956`).

The POS card is `PosDeviceCard` (`devices.jsx:484`).

### 8.2 The API routes behind the screen

The controller is `apps/umi-api/src/modules/devices/devices.controller.ts`. The class gate
is `@UseGuards(AuthGuard)` at `devices.controller.ts:39`, with the prefix
`api/v1` at `:40`.

| Method  | Path                                                | Line | Guard chain                                             |
| ------- | --------------------------------------------------- | ---- | ------------------------------------------------------- |
| `POST`  | `merchants/:merchantId/devices/enrollment`          | 44   | `MerchantAccessGuard`, `EntitlementGuard`, `RolesGuard` |
| `GET`   | `merchants/:merchantId/devices`                     | 73   | same                                                    |
| `PATCH` | `merchants/:merchantId/devices/:deviceId`           | 81   | same                                                    |
| `GET`   | `merchants/:merchantId/devices/enrollment-requests` | 99   | same                                                    |
| `POST`  | `.../enrollment-requests/:requestId/approve`        | 107  | same                                                    |
| `POST`  | `.../enrollment-requests/:requestId/deny`           | 128  | same                                                    |
| `POST`  | `merchants/:merchantId/devices/:deviceId/rotate`    | 181  | same                                                    |
| `POST`  | `merchants/:merchantId/devices/:deviceId/revoke`    | 199  | same                                                    |
| `POST`  | `merchants/:merchantId/devices/replacement`         | 212  | same                                                    |

The permission key is `device.enroll` on every merchant-scoped route. The example is
`devices.controller.ts:47`.

The three pairing routes are device-authenticated and carry no merchant guard:
`devices/pairing/claim` (`:59`), `devices/pairing/:pairingSessionId/poll` (`:150`),
`devices/pairing/:pairingSessionId/acknowledge` (`:161`), and `devices/status` (`:172`).

### 8.3 The narrowest place for terminal configuration

**Fact.** `merchant.device` carries no vendor and no model column. The card shows `kind`
only.

**Fact.** `merchant.hardware_device` already exists, and it carries `manufacturer`, `model`,
`capabilities`, `transport` and `connection_state`. Its DDL is at
`docs/migration/build-v3/40_pos_hardware_runtime.sql:29`. It carries the device type
`payment_terminal_foundation` (`40_pos_hardware_runtime.sql:35`).

**Fact.** That path is deliberately blocked. The constraint is at
`40_pos_hardware_runtime.sql:71`:

```sql
constraint hardware_foundation_execution_block check(
  device_type not in ('payment_terminal_foundation','scale_foundation') or not enabled
),
```

The RPC answers `HARDWARE_FOUNDATION_ONLY` at
`apps/umi-api/src/modules/pos-hardware/pos-hardware.service.ts:606`.

**Fact.** No column for `terminal_id`, `store_id` or `pos_id` exists anywhere. No
per-merchant secret column exists. `merchant.integration` holds `external_account_id` and
`status` only.

## 9. Configuration

The file is `apps/umi-api/src/shared/config/config.schema.ts`.

### 9.1 The declaration pattern

The schema is a zod object at `config.schema.ts:22`. An optional value takes
`z.string().optional()`. A required value has no `.optional()`, and boot fails without it
(`config.schema.ts:18`). A boolean flag uses the `booleanFromEnv` preprocessor
(`config.schema.ts:9`). An unknown boolean string reaches `z.boolean()` and fails boot
(`config.schema.ts:14`).

### 9.2 The existing Mercado Pago entries

`config.schema.ts:286`:

```ts
MERCADO_PAGO_POINT_ACCESS_TOKEN: z.string().optional(),
MERCADO_PAGO_POINT_TERMINAL_ID: z.string().optional(),
```

`config.schema.ts:292`:

```ts
TENDER_SCRIPTED_PROVIDERS: booleanFromEnv.default(false),
```

The example file is `apps/umi-api/.env.example`. The two credentials are named at
`.env.example:150` and `:151`. The test flag is named at `.env.example:160`.

**Fact.** The two credential values are deployment-wide. There is no per-merchant
credential store in the schema or in the database.

## 10. Test conventions

### 10.1 The integration target

The config is `apps/umi-api/vitest.integration.config.ts`. It includes
`src/**/*.integration.ts` (`vitest.integration.config.ts:36`) and sets
`UMI_ENVIRONMENT: 'test'` (`:39`). It serializes the files because one database is shared
(`:43`).

The two scripts are `test:integration:schema` for a pristine build and
`test:integration:migration` for a backfilled clone. The file states the difference at
`vitest.integration.config.ts:12`.

### 10.2 The disposable database

The test does not create the database. It requires one, and it fails closed without it.
`apps/umi-api/src/modules/tender/tender.integration.ts:216`:

```ts
beforeAll(async () => {
  if (!APP_DSN || !WORKER_DSN) {
    throw new Error(
      'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
    );
  }
  pg = new PgService(makeConfig());
  await pg.onModuleInit();
```

The database is built by `PGPORT=5233 docs/migration/build-v3/backfill/00_run_backfill.sh`,
and the login roles are provisioned once from
`apps/umi-api/test/integration/harness-roles.sql`. Both steps are documented at
`vitest.integration.config.ts:24`.

The header of `tender.integration.ts:42` carries the exact command. It clones the source
database with `sed` and a new database name.

### 10.3 The scripted providers

The test builds the providers by hand, not from config.
`tender.integration.ts:224`:

```ts
succeeded = new ScriptedTerminalProvider('scripted_card_terminal', ['succeed']);
declined = new ScriptedTerminalProvider('scripted_declined', ['decline']);
silent = new ScriptedTerminalProvider('scripted_silent', ['silent']);
answersLater = new ScriptedTerminalProvider('scripted_late_answer', ['answer_on_query']);
withholdsProof = new ScriptedTerminalProvider('scripted_no_proof', [
  'succeed_without_payment_id',
]);
```

The registry is built from that list at `tender.integration.ts:234`.

The production switch is different. `buildTenderProviders` registers the two scripted
providers only when `TENDER_SCRIPTED_PROVIDERS` is true
(`tender.module.ts:57`).

### 10.4 The property test

The stateful and property tests are in
`apps/umi-api/src/modules/tender/tender-domain.spec.ts`. It imports `fast-check` at line 1
and calls `fc.assert` at lines 62, 81, 106, 118, 135, 192, 205, 221, 256, 278 and 311.

**Fact.** The file uses `fc.assert` with explicit arbitraries. It does not use the
`fc.commands` model-run API.

## 11. The work to do

### 11.1 Files to create

| File                                                                        | Purpose                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/umi-api/src/modules/tender/providers/mercado-pago-point.transport.ts` | The live `PointTransport`. It posts to `/v1/orders` and reads `/v1/orders/{id}`. |
| `apps/umi-api/src/modules/mercado-pago/mercado-pago.controller.ts`          | The webhook receiver. It validates the `x-signature` HMAC first.                 |
| `apps/umi-api/src/modules/mercado-pago/mercado-pago.module.ts`              | The module for the receiver and the client.                                      |
| `apps/umi-api/src/modules/mercado-pago/mercado-pago.repository.ts`          | The terminal, store and credential reads.                                        |
| `apps/umi-api/src/modules/mercado-pago/mercado-pago.service.ts`             | The client for terminals, stores and points of sale.                             |
| `apps/umi-api/src/jobs/mercado-pago.processor.ts`                           | The order poll and retry job on the `integrations` queue.                        |
| `docs/migration/build-v3/72_mp_point.sql`                                   | The new columns, the per-merchant credential table, and its RLS.                 |
| `apps/umi-api/src/modules/mercado-pago/mercado-pago.integration.ts`         | The acceptance test against the real schema.                                     |

### 11.2 Files to modify

| File                                                     | Change                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/umi-api/src/modules/tender/tender.module.ts:49`    | Swap `UnconfiguredPointTransport` for the live transport.    |
| `apps/umi-api/src/app.module.ts:110`                     | Register the new module. `TenderModule` is named here today. |
| `packages/contract/src/route-table.ts`                   | Add the terminal configuration and status routes.            |
| `packages/contract/src/realtime-channels.ts`             | Add the terminal status event and its room builder.          |
| `apps/umi-api/src/shared/config/config.schema.ts:286`    | Add the webhook secret and the API base URL.                 |
| `apps/umi-api/.env.example:150`                          | Document every new variable.                                 |
| `apps/umi-api/src/jobs/queues.ts:10`                     | Add the queue name if a new queue is required.               |
| `docs/migration/build-v3/00_run.sh:8`                    | Add `72_mp_point` to the list.                               |
| `docs/migration/build-v3/99_verify.sql`                  | Assert the new constraints.                                  |
| `apps/umi-dashboard/src/screens/devices.jsx`             | Add the terminal configuration.                              |
| `apps/umi-dashboard/src/data.jsx`                        | Add the terminal data calls.                                 |
| `packages/contract/generated/dart/lib/umi_contract.dart` | Regenerate the client.                                       |

## 12. The riskiest coupling points

### 12.1 The credential is deployment-wide, and the product is multi-tenant

| Fact                                        | Location                                               |
| ------------------------------------------- | ------------------------------------------------------ |
| The token comes from the environment.       | `tender.module.ts:37`                                  |
| The provider is built once, at module init. | `tender.module.ts:66`                                  |
| No secret column exists.                    | Verified: no per-merchant secret column in the schema. |

The registry is built ONE time from config (`tender.module.ts:19`). A per-merchant token
breaks that construction. The provider must read the credential at call time, not at boot.
This is the first structural change, and it touches the module factory that every other
tender test depends on.

### 12.2 The capture is synchronous, and a terminal is not

| Fact                                            | Location                     |
| ----------------------------------------------- | ---------------------------- |
| `capture` calls the provider and waits.         | `tender.service.ts:174`      |
| The request path holds that call.               | `tender.controller.ts:36`    |
| The provider promises a snapshot, not a stream. | `point-transport.port.ts:41` |

A Point order takes up to 40 seconds, and it can end at `action_required`
(`tender-domain.ts:96`). The `PointTransport` interface returns one snapshot. The
`unknown` branch already carries the query clock (`tender-provider.port.ts:73`), so the
model is ready. The webhook and the poll job are what resolve the attempt later.

### 12.3 The attempt is monotonic, and a webhook can arrive twice

| Fact                                    | Location                   |
| --------------------------------------- | -------------------------- |
| The resolution guard refuses a rewrite. | `tender.repository.ts:259` |
| One command identity is one attempt.    | `70_tender.sql:335`        |
| The outbox dedupes on a merchant key.   | `30_runtime.sql:191`       |

A webhook delivery can repeat, and it can arrive before the capture call returns. The
`resolveAttempt` guard makes the second write a no-op, and the `declined -> succeeded`
exception (`tender.repository.ts:261`) is what lets a late `processed` correct a premature
decline. A webhook handler must therefore NOT trust its own payload for the status. It must
read the order back, which is also the vendor's own good practice
(`06-mercadopago-mcp-and-official-tools.md`, section 5).
