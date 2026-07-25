# Umi Platform Architecture

> Developer presentation · Goal architecture · build-v3 is the database source of truth

Umi is one platform with several product surfaces. One backend owns all business writes.
Thin clients use versioned contracts and shared projections. Each business fact has one owner.

## 1. The architecture in one view

```mermaid
flowchart TB
  classDef app fill:#eff6ff,stroke:#2563eb,color:#172554,stroke-width:1px
  classDef api fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b,stroke-width:2px
  classDef data fill:#ecfdf5,stroke:#059669,color:#022c22,stroke-width:2px
  classDef infra fill:#f8fafc,stroke:#64748b,color:#0f172a,stroke-width:1px
  classDef external fill:#fdf4ff,stroke:#a21caf,color:#4a044e,stroke-width:1px
  classDef contract fill:#fffbeb,stroke:#d97706,color:#451a03,stroke-width:2px

  subgraph Surfaces["Umi product surfaces"]
    direction LR
    WA["WhatsApp<br/>conversation + ordering"]:::app
    Landing["Landing<br/>leads + diagnostics"]:::app
    Wallet["Cash experience<br/>loyalty + wallet passes"]:::app
    Dashboard["Dashboard<br/>back office + reports"]:::app
    POS["UmiPOS<br/>Flutter Android terminal"]:::app
    KDS["Umi KDS<br/>Flutter kitchen client"]:::app
    Ops["Operations UI<br/>traces + incidents"]:::app
  end

  Contract["@umi/contract<br/>routes + schemas + entitlements"]:::contract

  subgraph Backend["One backend · apps/umi-api"]
    direction LR
    Web["umi-api web<br/>NestJS + Fastify"]:::api
    Redis[("Redis<br/>BullMQ execution")]:::infra
    Worker["umi-worker<br/>BullMQ processors"]:::api
    Web --> Redis --> Worker
  end

  subgraph Store["Supabase PostgreSQL · build-v3"]
    direction LR
    Umi[("umi<br/>identity + access + commercial terms")]:::data
    Tenant[("tenant<br/>café business facts")]:::data
    Runtime[("runtime<br/>machine state + delivery")]:::data
  end

  subgraph Providers["External providers"]
    direction LR
    Channel["Twilio · SMTP<br/>Apple + Google Wallet · Zettle"]:::external
    AI["Anthropic + Voyage<br/>reasoning + embeddings"]:::external
    Payments["Card provider<br/>terminal + settlement"]:::external
    Telemetry["OpenTelemetry + Sentry<br/>signals + failures"]:::external
  end

  WA --> Channel --> Web
  Landing --> Contract
  Wallet --> Contract
  Dashboard --> Contract
  POS --> Contract
  KDS --> Contract
  Contract --> Web

  POS <-->|"branch LAN · mTLS"| KDS

  Web --> Umi
  Web --> Tenant
  Web --> Runtime
  Worker --> Umi
  Worker --> Tenant
  Worker --> Runtime

  Worker --> Channel
  Worker --> AI
  Web --> Payments

  Web -.-> Telemetry
  Worker -.-> Telemetry
  POS -.-> Telemetry
  KDS -.-> Telemetry
  Telemetry --> Ops
```

The key rule is simple. Product surfaces never become parallel platforms.
They consume one API and one data model. The POS and KDS also have a local resilience channel.

## 2. Product ownership

| Product or package | Owns | Does not own | Main communication |
| --- | --- | --- | --- |
| `apps/umi-api` | Business rules, writes, authorization, queues, adapters, and projections | Product UI and device hardware | HTTPS, PostgreSQL, BullMQ, provider APIs |
| `apps/umi-dashboard` | Owner and manager workflows | Business data or financial rules | Cookie-authenticated API calls |
| Umi Cash experience | Customer registration, QR, loyalty display, and wallet delivery | Loyalty balance truth or ledger rules | Public and authenticated API calls |
| `apps/umi-landing-page` | Marketing, lead capture, and diagnostics | Prospect storage and email workflow state | Public API calls |
| `apps/umi-pos` | Terminal UI, hardware ports, encrypted local state, and offline journal | Authoritative prices, money, orders, or loyalty | Versioned API and paired-KDS LAN |
| `apps/umi-kds` | Kitchen board, ticket actions, and local ticket journal | Order truth, payment truth, or customer messaging | Versioned API, event cursor, and POS LAN |
| Operations UI | Trace search, health, incidents, and reconciliation | Business facts | OpenTelemetry, Sentry, and read-only diagnostics |
| `packages/contract` | Routes, payload schemas, errors, versions, and product keys | Business logic | TypeScript package and neutral JSON artifact |
| `packages/tokens` | Shared brand primitives and generated app tokens | Product layout decisions | Generated CSS, JavaScript, and JSON |
| root `supabase/` | Ordered database migrations | Runtime business logic | Supabase CLI and PostgreSQL |

The Umi Cash capability can change its repository shape. Its business owner stays `umi-api`.
The public wallet URL must remain stable because printed QR codes depend on it.

### Business lifecycle

```mermaid
flowchart LR
  classDef phase fill:#eff6ff,stroke:#2563eb,color:#172554
  classDef fact fill:#ecfdf5,stroke:#059669,color:#022c22
  classDef value fill:#fff7ed,stroke:#ea580c,color:#431407

  Lead["Landing lead"]:::phase --> Prospect["umi.prospect<br/>+ prospect_event"]:::fact
  Prospect --> Sale["Umi sales process"]:::phase
  Sale --> Access["business + subscription<br/>+ effective_entitlement"]:::fact
  Access --> Setup["Dashboard setup<br/>branch · staff · catalog · devices"]:::phase
  Setup --> Reach["Customer reach<br/>WhatsApp · wallet · walk-in"]:::phase
  Reach --> Order["customer_order<br/>items · events · payment"]:::fact
  Order --> Kitchen["KDS fulfillment"]:::value
  Order --> Receipt["Receipt + settlement"]:::value
  Order --> Loyalty["Loyalty effects"]:::value
  Kitchen --> Insight["Dashboard + customer history"]:::phase
  Receipt --> Insight
  Loyalty --> Insight
  Insight --> Retain["Lifecycle messages<br/>and repeat visits"]:::value
```

The flow starts before a café becomes a tenant. It ends with an auditable customer and business outcome.
Each step writes facts once and exposes them through the next product surface.

## 3. Target workspace shape

```text
Umi/
├── apps/
│   ├── umi-api/              # sole backend and financial writer
│   ├── umi-dashboard/        # owner and manager web console
│   ├── umi-landing-page/     # public marketing and lead capture
│   ├── umi-pos/              # Flutter Android point of sale
│   └── umi-kds/              # Flutter kitchen display client
├── packages/
│   ├── contract/             # sole API contract source
│   └── tokens/               # shared design values and generated outputs
├── supabase/
│   └── migrations/           # sole ordered migration authority
└── docs/
    ├── architecture/         # decisions and system maps
    └── migration/build-v3/   # authoritative relational model
```

The workspace uses a monorepo for coordination. A shared repository does not imply shared runtime ownership.

## 4. The four communication planes

```mermaid
flowchart TB
  classDef plane fill:#f8fafc,stroke:#334155,color:#0f172a,stroke-width:1px
  classDef source fill:#eff6ff,stroke:#2563eb,color:#172554
  classDef core fill:#ecfdf5,stroke:#059669,color:#022c22,stroke-width:2px

  Clients["Dashboard · Landing · Wallet · POS · KDS · WhatsApp"]:::source

  subgraph P1["1 · Command plane"]
    Contract["HTTPS + @umi/contract<br/>versioned commands and queries"]:::plane
  end

  subgraph P2["2 · Durable delivery plane"]
    Outbox["runtime.outbox_event<br/>atomic event intent"]:::core
    Bull["BullMQ + Redis<br/>retry and scheduling"]:::plane
    Adapters["Provider adapters<br/>Twilio · email · wallet · AI"]:::plane
    Outbox --> Bull --> Adapters
  end

  subgraph P3["3 · Projection plane"]
    Facts["tenant facts"]:::core
    Views["security_invoker views<br/>order_ticket · order_total · analytics"]:::plane
    Facts --> Views
  end

  subgraph P4["4 · Device resilience plane"]
    Journal["POS SQLCipher journal"]:::plane
    LAN["POS ↔ KDS<br/>mTLS + signed envelopes"]:::plane
    Replay["Ordered API replay"]:::plane
    Journal --> LAN
    Journal --> Replay
  end

  Clients --> Contract
  Contract --> Facts
  Facts --> Outbox
  Views --> Clients
  Replay --> Contract
```

These planes solve different problems.

- The command plane validates intent and authorization.
- The outbox stores a unique event intent with the business change.
- BullMQ executes side effects with retries.
- Projections give all clients one derived view.
- The LAN plane keeps the kitchen active during an internet outage.

## 5. Backend structure

`apps/umi-api` runs one image as two processes. The web process serves requests.
The worker process performs slow and retryable work.

```mermaid
flowchart TB
  classDef edge fill:#eff6ff,stroke:#2563eb,color:#172554
  classDef domain fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b
  classDef shared fill:#f8fafc,stroke:#64748b,color:#0f172a
  classDef data fill:#ecfdf5,stroke:#059669,color:#022c22
  classDef async fill:#fff7ed,stroke:#ea580c,color:#431407

  Request["HTTP request"]:::edge
  Controller["Controller<br/>parse + authorize + delegate"]:::domain
  Guard["Guards + contract validation<br/>identity · role · entitlement · device"]:::domain
  Service["Domain service<br/>business rules + transaction plan"]:::domain
  Repository["Repository<br/>schema-qualified parameterized SQL"]:::domain
  Pg["PgService<br/>api pool + worker pool"]:::shared
  DB[("build-v3 PostgreSQL")]:::data

  Request --> Guard --> Controller --> Service --> Repository --> Pg --> DB

  Service -->|"same transaction"| Outbox["runtime.outbox_event"]:::async
  Outbox --> Relay["Outbox relay"]:::async
  Relay --> Redis[("BullMQ / Redis")]:::async
  Redis --> Processor["Processor"]:::async
  Processor --> Adapter["One adapter per provider"]:::shared

  Context["Request context<br/>business · user · request"]:::shared -.-> Pg
  Config["Validated config"]:::shared -.-> Controller
  Logging["Structured logs + traces"]:::shared -.-> Controller
  Logging -.-> Processor
```

### Domain modules

| Module group | Modules | Purpose |
| --- | --- | --- |
| Platform access | `auth`, `identity`, `tenants`, `staff` | Login, role grants, business scope, and staff employment |
| Customer platform | `customers`, `cash`, `lifecycle` | Customer 360, loyalty, stored value, rewards, and lifecycle messages |
| Conversation | `conversations`, `voice`, `hours` | WhatsApp ingress, AI turns, tools, voice, and availability |
| Operations | `kds`, `pos`, `leads` | Kitchen, point of sale, prospects, and lead workflows |
| Async work | `turns`, `enrichment`, `outbound`, `integrations`, `lifecycle` | Queue consumers, schedules, retries, and provider delivery |
| Shared infrastructure | `database`, `adapters`, `auth`, `config`, `logging`, `ratelimit` | One implementation for each cross-cutting concern |

### Layer rule

```text
controller → service → repository → PgService → PostgreSQL
```

Controllers contain transport logic. Services contain business rules.
Repositories contain SQL. Adapters contain external provider logic.

## 6. build-v3 data authority

build-v3 uses schemas for authorship, not for product modules. Product domains live in backend code.

```mermaid
flowchart LR
  classDef umi fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b,stroke-width:2px
  classDef tenant fill:#ecfdf5,stroke:#059669,color:#022c22,stroke-width:2px
  classDef runtime fill:#fff7ed,stroke:#ea580c,color:#431407,stroke-width:2px
  classDef derived fill:#f8fafc,stroke:#64748b,color:#0f172a

  subgraph U["umi · Umi-authored facts"]
    Identity["user · role · permission · user_role"]:::umi
    Catalog["channel_type · feature · plan"]:::umi
    Commercial["subscription · entitlement_override · invoice"]:::umi
    Growth["prospect · prospect_event"]:::umi
    PlatformAudit["audit_log"]:::umi
  end

  subgraph T["tenant · café-authored facts"]
    Org["business · branch · station · integration · staff"]:::tenant
    Customer["customer · contact · customer_note"]:::tenant
    Loyalty["loyalty_program · card · visits<br/>rewards · ledgers · wallet_pass"]:::tenant
    Commerce["product · options · modifiers · availability"]:::tenant
    Conversation["conversation · message · knowledge"]:::tenant
    Order["customer_order · order_item<br/>order_event · payment · refund"]:::tenant
    Device["device · tenant.audit_log"]:::tenant
  end

  subgraph R["runtime · machine state"]
    Session["session · device_session · otp · pairing"]:::runtime
    Delivery["inbound_event · outbox_event<br/>idempotency_key · dead_letter"]:::runtime
    Working["conversation_state · reminder_sent"]:::runtime
    Sync["integration_sync · pass_device"]:::runtime
    Search["product_embedding · message_embedding<br/>knowledge_embedding"]:::runtime
  end

  Identity --> Org
  Commercial --> Org
  Catalog --> Customer
  Org --> Customer
  Org --> Loyalty
  Org --> Commerce
  Org --> Conversation
  Org --> Order
  Org --> Device
  Customer --> Loyalty
  Customer --> Conversation
  Customer --> Order
  Commerce --> Order
  Conversation --> Order
  Identity --> Session
  Device --> Session
  Order --> Delivery
  Conversation --> Working
  Commerce --> Search
  Conversation --> Search

  Order --> OrderTicket["order_ticket<br/>shared live projection"]:::derived
  Order --> OrderTotal["order_total<br/>derived live-line value"]:::derived
  Conversation --> Analytics["conversation_analytics<br/>derived outcome view"]:::derived
```

### Schema meaning

| Schema | Question it answers | Access rule |
| --- | --- | --- |
| `umi` | What does Umi know and grant? | Umi controls writes. Selected business rows use RLS. |
| `tenant` | What happened inside a café? | Every business fact uses business scope and RLS. |
| `runtime` | What must the machine read to continue? | The backend and worker control access. |
| `extensions` | Which PostgreSQL capabilities support the model? | Application roles receive usage only. |

Telemetry does not belong in these schemas. OpenTelemetry and Sentry receive operational signals.

### Database roles

```mermaid
flowchart TB
  AppLogin["API login role"] --> API["api<br/>NOLOGIN · RLS enforced"]
  WorkerLogin["Worker login role"] --> Worker["worker<br/>NOLOGIN · BYPASSRLS"]
  AnalystLogin["Diagnostic login role"] --> Readonly["readonly<br/>NOLOGIN · read only"]

  API -->|"SET LOCAL app.current_business"| Tenant["tenant rows for one business"]
  Worker -->|"explicit business predicates"| All["cross-business jobs + sealed runtime"]
  Readonly --> Safe["non-secret diagnostics"]
```

The request role sets `app.current_business` inside the same transaction. RLS applies to each request.
The worker can cross businesses only for trusted background work. Secret tables remain sealed.

## 7. Shared packages

### `packages/contract`

The contract is the only editable definition of HTTP routes and payload shapes.

```mermaid
flowchart LR
  classDef source fill:#fffbeb,stroke:#d97706,color:#451a03,stroke-width:2px
  classDef output fill:#eff6ff,stroke:#2563eb,color:#172554
  classDef consumer fill:#ecfdf5,stroke:#059669,color:#022c22

  Zod["routes.ts + schemas.ts + entitlements.ts<br/>TypeScript + Zod"]:::source
  TS["CJS + ESM + types"]:::output
  JSON["umi-contract-vX.Y.Z.json<br/>JSON Schema + route metadata + hash"]:::output

  Zod --> TS
  Zod --> JSON

  TS --> API["umi-api"]:::consumer
  TS --> Dash["dashboard"]:::consumer
  TS --> Web["wallet + landing"]:::consumer
  JSON --> Dart["generated Dart client"]:::consumer
  Dart --> POS["UmiPOS"]:::consumer
  Dart --> KDS["Umi KDS"]:::consumer
```

The neutral artifact includes these fields:

- Contract version and content hash.
- Method and `/api/v{major}/...` path.
- Request and response schemas.
- Authentication mode.
- Idempotency requirement.
- Stable machine error codes.
- Offline eligibility.
- Approval requirements.

No developer writes a parallel Dart model. Generated output stays immutable and versioned.

### `packages/tokens`

The token package centralizes stable brand values. It keeps product-specific typography and surfaces separate.

| Output | Consumer | Purpose |
| --- | --- | --- |
| `dashboard.css` | Dashboard | CSS custom properties |
| `landing.cjs` and `landing.mjs` | Landing | Tailwind theme input |
| `tokens.json` | Tooling and future clients | Resolved neutral values |

The package shares real brand facts only. It does not force all products to look identical.

## 8. Business channels

| Channel | User intent | Trust proof | Durable entry | Main result |
| --- | --- | --- | --- | --- |
| WhatsApp | Ask, order, or receive status | Twilio signature and sender resolution | `runtime.inbound_event` | Conversation, order, or outbound reply |
| Dashboard | Configure and inspect the business | User cookie, role, business scope, entitlement | API transaction | Config, audit fact, or report |
| Landing | Submit interest or a diagnostic | Public validation and abuse controls | `umi.prospect` and `prospect_event` | Sales follow-up |
| Wallet | Register, scan, top up, redeem, or receive a pass | Customer flow or staff authorization | Loyalty facts and ledgers | Updated loyalty state |
| POS | Sell, tender, refund, or manage a shift | Device proof, operator session, role, branch, entitlement | Idempotent POS command | Atomic sale and receipt |
| KDS | Read and advance kitchen work | Enrolled device and station scope | Ordered event command | Fulfillment change and notification |
| POS ↔ KDS LAN | Continue kitchen work offline | Branch certificate, mTLS, signature, sequence | Local durable journals | Ticket delivery and signed ACK |
| Email | Send lead, reset, or lifecycle messages | Server-held provider credentials | Outbox or scheduled job | Provider delivery result |
| Wallet provider | Create and update passes | Server-held signing material | Wallet pass and device state | Apple or Google pass update |
| Telemetry | Explain behavior and failures | Service identity and redaction | OTel/Sentry event | Trace, metric, log, or alert |

### Catalog and menu flow

```mermaid
flowchart LR
  classDef source fill:#eff6ff,stroke:#2563eb,color:#172554
  classDef api fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b
  classDef fact fill:#ecfdf5,stroke:#059669,color:#022c22
  classDef consumer fill:#fff7ed,stroke:#ea580c,color:#431407

  Dashboard["Dashboard authoring"]:::source --> API["umi-api catalog module"]:::api
  Sync["Zettle, Square, or POS sync"]:::source --> API
  Authority["business.menu_source<br/>dashboard or pos_sync"]:::fact --> API

  API --> Catalog["product_category · product<br/>option_group · modifier"]:::fact
  API --> Availability["product_branch_availability"]:::fact
  Catalog --> Embed["runtime.product_embedding"]:::fact

  Catalog --> WA["WhatsApp tools"]:::consumer
  Catalog --> POS["POS signed catalog snapshot"]:::consumer
  Catalog --> Dash["Dashboard catalog"]:::consumer
  Availability --> WA
  Availability --> POS
  Availability --> Dash
  Embed --> WA
```

One selected authority writes the catalog. Every sales channel reads the same product and availability facts.
The POS snapshot pins a catalog version for offline use.

## 9. WhatsApp ordering flow

```mermaid
sequenceDiagram
  autonumber
  actor C as Customer
  participant T as Twilio
  participant A as umi-api
  participant D as PostgreSQL
  participant Q as BullMQ
  participant W as umi-worker
  participant M as Anthropic / Voyage
  participant K as KDS

  C->>T: WhatsApp message
  T->>A: Signed webhook
  A->>A: Verify signature and resolve business
  A->>D: Insert runtime.inbound_event
  A->>Q: Enqueue turn.integrity
  A-->>T: Fast acknowledgement

  Q->>W: Process ordered turn
  W->>D: Load conversation and working state
  W->>M: Reason, call tools, or create embeddings
  M-->>W: Tool plan or model output

  alt The customer confirms an order
    W->>D: Commit order, items, opening event, and outbox
    D-->>W: One transaction succeeds
    K->>A: Poll order_ticket and event cursor
    A-->>K: Normalized kitchen ticket
  end

  W->>D: Commit message and reply outbox
  W->>D: Claim pending outbox event
  W->>Q: Enqueue outbound job
  Q->>W: Deliver outbound job
  W->>T: Send WhatsApp reply
  T-->>C: Customer message
```

The webhook stays fast. Slow model work runs in the worker.
The database commits the business fact before the worker sends an external message.

## 10. The order model

Every order channel writes the same aggregate. The `source` field records the origin.

```mermaid
flowchart TB
  classDef source fill:#eff6ff,stroke:#2563eb,color:#172554
  classDef tx fill:#ecfdf5,stroke:#059669,color:#022c22,stroke-width:2px
  classDef view fill:#f8fafc,stroke:#64748b,color:#0f172a
  classDef consumer fill:#fff7ed,stroke:#ea580c,color:#431407

  WA["WhatsApp"]:::source
  POS["UmiPOS"]:::source
  WEB["Dashboard / web"]:::source

  subgraph TX["One authoritative transaction"]
    Checkout["pos_checkout<br/>draft and quote state"]:::tx
    Order["tenant.customer_order<br/>fulfillment + version"]:::tx
    Items["tenant.order_item<br/>immutable line snapshots"]:::tx
    Event["tenant.order_event<br/>ordered change feed"]:::tx
    Payment["tenant.payment / refund<br/>settled money facts"]:::tx
    Outbox["runtime.outbox_event<br/>side-effect intent"]:::tx

    Checkout -->|"commit"| Order
    Order --- Items
    Order --- Event
    Order --- Payment
    Order --- Outbox
  end

  WA --> Order
  POS --> Checkout
  WEB --> Order

  Order --> Ticket["tenant.order_ticket<br/>order + nested lines · no total"]:::view
  Items --> Total["tenant.order_total<br/>sum of live lines"]:::view
  Payment --> Receipt["Receipt snapshot<br/>belongs to payment"]:::view

  Ticket --> KDS["KDS board"]:::consumer
  Ticket --> Status["Customer status"]:::consumer
  Ticket --> Dash["Dashboard order view"]:::consumer
  Total --> Dash
  Receipt --> POSReceipt["Print + digital receipt"]:::consumer
  Payment --> Reports["Revenue + settlement reports"]:::consumer
```

### Order lifecycle

```mermaid
stateDiagram-v2
  [*] --> placed
  placed --> preparing
  placed --> canceled
  preparing --> ready
  preparing --> canceled
  ready --> completed
  ready --> canceled
  completed --> [*]
  canceled --> [*]
```

### Load-bearing order rules

- `customer_order.status` stores current fulfillment state.
- `customer_order.version` supports optimistic concurrency.
- `order_event.sequence` gives pull clients a stable cursor.
- `order_event` records status and line changes.
- `order_item` stores price and name snapshots.
- A line change voids the old row and adds a new row.
- A voided line remains visible to the kitchen.
- `order_total` derives the value of live lines.
- `payment` and `refund` store settled money.
- Revenue reports read payments, not mutable order lines.
- A draft checkout never appears in the KDS.
- A station belongs to the paired device scope.
- Future item routing belongs on each order line.

### Ticket and money are separate views

| Question | Source |
| --- | --- |
| What must the kitchen prepare? | `tenant.order_ticket` |
| What do the current live lines cost? | `tenant.order_total` |
| What did the customer pay? | `tenant.payment` |
| What money returned later? | `tenant.refund` |
| What appears on the receipt? | Immutable receipt snapshot linked to payment |

This split prevents a later line void from rewriting historical revenue.

## 11. UmiPOS online sale

```mermaid
sequenceDiagram
  autonumber
  actor S as Cashier
  participant P as UmiPOS
  participant A as umi-api / modules/pos
  participant R as Redis
  participant D as build-v3 PostgreSQL
  participant X as Payment adapter
  participant K as Umi KDS
  participant W as Worker

  S->>P: Start sale
  P->>A: Device proof + operator session + branch
  A->>D: Validate user, device, role, and entitlement
  A-->>P: Signed bootstrap and catalog

  S->>P: Build cart and select tenders
  P->>A: Versioned command + Idempotency-Key
  A->>D: Load or create command result
  A->>D: Derive price, tax, policy, and business date

  opt External card tender
    A->>X: Create or query payment intent
    X-->>A: Captured, declined, pending, or unknown
  end

  A->>D: Atomic sale commit
  Note over A,D: Order + lines + payment + cash + loyalty + inventory + receipt + event + result
  D-->>A: Official identifiers and immutable result
  A-->>P: Recorded command result

  K->>A: Poll order ticket and cursor
  A-->>K: New committed ticket
  W->>D: Claim pending outbox intent
  W->>R: Enqueue notification or reconciliation job
```

External provider calls stay outside database locks. The final database transaction records every authoritative sale effect.
The same command and fingerprint return the recorded result. A changed fingerprint returns `idempotency_conflict`.

## 12. UmiPOS offline and LAN flow

```mermaid
sequenceDiagram
  autonumber
  participant A as umi-api
  participant P as UmiPOS journal
  participant K as KDS journal

  P->>A: Start shift online
  A-->>P: Signed shift, policy, catalog, and contract snapshot

  Note over P,A: Internet becomes unavailable
  P->>P: Persist cart and command before tender
  P->>P: Commit eligible local sale
  P->>K: Signed ticket over branch mTLS
  K->>K: Persist ticket before ACK
  K-->>P: Signed ACK with message hash
  P->>P: Print provisional receipt
  K->>K: Record kitchen transitions

  Note over P,A: Internet returns
  P->>A: Replay commands in device sequence
  A->>A: Validate snapshot, device, operator, and policy
  A-->>P: Official order and receipt identifiers
  P->>A: Upload KDS actions with expected version
  A-->>P: Reconciliation result or visible conflict
```

Offline support is an explicit capability set. It does not copy the server into the device.

### Offline trust rules

- Start the shift online.
- Encrypt local data with SQLCipher.
- Store the key in the platform keystore.
- Persist a command before network or tender work.
- Use one stable `clientCommandId`.
- Preserve original price and policy snapshots.
- Block refunds and loyalty redemption offline.
- Block official shift close until sync completes.
- Show every replay conflict.
- Never drop or silently reprice a command.

## 13. Loyalty and wallet flow

```mermaid
flowchart LR
  classDef input fill:#eff6ff,stroke:#2563eb,color:#172554
  classDef service fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b
  classDef fact fill:#ecfdf5,stroke:#059669,color:#022c22
  classDef output fill:#fff7ed,stroke:#ea580c,color:#431407

  QR["Umi QR"]:::input --> Resolve["Resolve customer"]:::service
  Phone["Verified phone"]:::input --> Resolve
  POS["POS checkout"]:::input --> Resolve

  Resolve --> Auth["Authorize reward, wallet, or gift card"]:::service
  Auth --> Commit{"Checkout result"}:::service
  Commit -->|"success"| Ledger["Append loyalty facts<br/>visit · redemption · money delta"]:::fact
  Commit -->|"failure"| Reverse["Reverse authorization"]:::fact

  Ledger --> Card["Derived card state"]:::output
  Ledger --> Pass["Apple / Google pass update"]:::output
  Ledger --> History["Customer history"]:::output
  Ledger --> Analytics["Dashboard analytics"]:::output
```

The loyalty card stores identity only. Stored value equals the sum of ledger deltas.
Visit count equals the count of visits. Money ledgers never update or delete prior facts.

## 14. Device and user trust

```mermaid
flowchart TB
  classDef actor fill:#fff7ed,stroke:#c2410c,color:#431407
  classDef proof fill:#eff6ff,stroke:#2563eb,color:#172554
  classDef gate fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b
  classDef data fill:#ecfdf5,stroke:#059669,color:#022c22

  Owner["Owner"]:::actor -->|"creates enrollment"| Pair["runtime.pairing"]:::data
  Device["POS or KDS"]:::actor -->|"non-exportable P-256 public key"| Pair
  Pair --> Registered["tenant.device<br/>business + branch + kind"]:::data
  Registered --> Session["runtime.device_session / session"]:::data

  User["Staff user"]:::actor --> Login["umi.user"]:::data
  Login --> Role["umi.user_role + permission"]:::data

  Command["Signed command"]:::proof --> DeviceGate["Device + branch + version gate"]:::gate
  Session --> DeviceGate
  DeviceGate --> UserGate["Operator + role + entitlement gate"]:::gate
  Role --> UserGate
  Entitlement["umi.effective_entitlement"]:::data --> UserGate
  UserGate --> RLS["api transaction + RLS"]:::gate
```

### Trust by surface

| Surface | Proof | Scope |
| --- | --- | --- |
| Dashboard | Rotating httpOnly session cookies and CSRF protection | User roles and business |
| POS | Device signature plus short operator session | One device, business, branch, and shift |
| KDS | Enrolled device proof and paired station | One device, business, branch, and station |
| WhatsApp | Twilio signature and sender account | Resolved business and customer channel |
| Worker | Trusted worker role | Explicit cross-business job scope |
| Read-only tools | Restricted diagnostic role | Non-secret reporting data |

No client receives database credentials. A device revocation fails the next online command.

## 15. Important libraries and dependencies

### Backend and data

| Library or service | Job | Why Umi uses it |
| --- | --- | --- |
| Node.js | Backend runtime | It supports the TypeScript service, workers, and shared package tools. |
| NestJS | Module, dependency, guard, and lifecycle structure | It gives each business domain an explicit module boundary. |
| Fastify | HTTP transport | It provides a small, fast server and exact webhook body control. |
| `@fastify/cookie` | Cookie parsing and response helpers | Dashboard sessions use signed httpOnly cookies. |
| BullMQ | Queue workers, retries, priorities, and schedules | Slow work cannot block inbound HTTP requests. |
| Redis | BullMQ execution state | It provides fast queue coordination and worker locks. |
| `pg` | PostgreSQL pools and parameterized SQL | Repositories keep SQL explicit and preserve PostgreSQL features. |
| PostgreSQL | Transactions, constraints, views, RLS, and ledgers | The database enforces core platform invariants. |
| Supabase | Managed PostgreSQL host, migration tooling, backup, and recovery | It keeps PostgreSQL canonical while Umi owns the API. |
| pgvector | Vector search | It stores product, message, and knowledge embeddings in `runtime`. |
| Zod | Contract schemas and type inference | One definition validates data and generates client types. |
| `class-validator` and `class-transformer` | Nest request DTO validation | They protect the HTTP boundary while contract adapters remain explicit. |
| `jose` | JWT and JOSE primitives | It supports secure web sessions and signed token work. |

### Product clients

| Library or service | Job | Why Umi uses it |
| --- | --- | --- |
| React | Dashboard, landing, and wallet UI | It provides component-based web product surfaces. |
| Vite | Dashboard build and development server | It gives the SPA a fast and direct build path. |
| React Router | Dashboard navigation | It maps product modules to clear routes. |
| Next.js | Landing and public wallet routes | It combines public pages with server routes where required. |
| Flutter | POS and KDS clients | It supports Android terminals and the iPad KDS from one client stack. |
| SQLCipher | Encrypted device database | POS recovery data stays encrypted at rest. |
| Android Keystore and Apple Keychain | Non-exportable keys | A copied file cannot copy the device identity. |
| PassKit and Google Wallet APIs | Loyalty passes | Umi can issue and update platform-native wallet passes. |
| QR libraries | Customer and loyalty lookup | A scan resolves a Umi customer or card without manual search. |

### Channels and operations

| Library or service | Job | Why Umi uses it |
| --- | --- | --- |
| Twilio | WhatsApp ingress and delivery | It connects the customer conversation channel to the API. |
| Anthropic SDK | Model calls and tool selection | It powers the conversational order assistant. |
| Voyage AI | Embeddings | It supports semantic product, memory, and knowledge retrieval. |
| Nodemailer | SMTP email | One adapter sends reset, lead, and lifecycle email. |
| Zettle adapter | Catalog integration | It imports an external menu source when a business selects it. |
| OpenTelemetry | Traces, metrics, and logs | It keeps telemetry outside the business database. |
| Sentry | Client and service failures | It adds crash context and release correlation. |
| Docker Compose | Runtime packaging | One image runs the web and worker commands. |
| Caddy | TLS and reverse proxy | It terminates public HTTPS for the API. |

### Workspace and quality

| Tool | Job | Why Umi uses it |
| --- | --- | --- |
| pnpm | Workspace dependency management | It links shared packages with one lockfile. |
| Turborepo | Task graph and cache | It orders package builds and runs checks across apps. |
| tsup | Contract package build | It emits ESM, CommonJS, and type declarations. |
| Vitest and Jest | Unit and integration tests | They verify services, contracts, and web behavior. |
| Swift test fixtures | KDS behavior reference | They preserve the kitchen contract during the Flutter implementation. |

The dependency principle is narrow. One library has one main job.
Umi avoids a second framework for a problem that the existing stack already solves.

## 16. Deployment topology

```mermaid
flowchart LR
  classDef edge fill:#eff6ff,stroke:#2563eb,color:#172554
  classDef runtime fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b
  classDef store fill:#ecfdf5,stroke:#059669,color:#022c22
  classDef ops fill:#f8fafc,stroke:#64748b,color:#0f172a

  Internet["Internet clients + providers"]:::edge
  Caddy["Caddy<br/>TLS + reverse proxy"]:::runtime

  subgraph VPS["Umi runtime"]
    Web["umi-api<br/>node dist/main"]:::runtime
    Worker["umi-worker<br/>node dist/worker"]:::runtime
    Redis[("Redis<br/>AOF + BullMQ")]:::store
  end

  DB[("Supabase PostgreSQL<br/>build-v3")]:::store
  OTel["OTel Collector<br/>traces + metrics + logs"]:::ops
  Sentry["Sentry"]:::ops

  Internet --> Caddy --> Web
  Web --> Redis
  Redis --> Worker
  Web --> DB
  Worker --> DB
  Web -.-> OTel
  Worker -.-> OTel
  Web -.-> Sentry
  Worker -.-> Sentry
```

The web and worker share code, modules, adapters, and configuration. They scale independently.
PostgreSQL remains the business source of truth. Redis never becomes business storage.

## 17. Core invariants

### Data

- Keep all authoritative writes in `umi-api`.
- Use build-v3 names and schema boundaries.
- Store money as signed 64-bit centavos plus currency.
- Derive balances, counts, and working totals.
- Keep financial ledgers append-only.
- Use compensating facts for corrections.
- Keep receipts immutable after commit.
- Keep telemetry outside business schemas.

### Orders

- Write an order and its opening event in one transaction.
- Record line changes in the ordered event feed.
- Use order versions for optimistic concurrency.
- Show only committed orders to the KDS.
- Keep payment state separate from fulfillment state.
- Keep provider calls outside database locks.

### Communication

- Write the outbox row with the business change.
- Use deterministic idempotency keys.
- Assume at-least-once delivery.
- Make every consumer idempotent.
- Keep a dead-letter trail for terminal failures.
- Use one adapter for each provider.

### Security

- Keep database credentials out of every client.
- Enforce business scope through RLS.
- Bind a POS or KDS device to one branch.
- Keep device private keys non-exportable.
- Revoke access on the next online command.
- Redact customer, device, token, and card data from telemetry.

### Contracts

- Edit routes and schemas only in `packages/contract`.
- Put the API major in the path.
- Generate Dart models and clients.
- Keep older majors stable during their support window.
- Reject unsupported versions explicitly.

## 18. How a feature crosses the platform

```mermaid
flowchart LR
  Need["Business need"] --> Contract["1 · Contract"]
  Contract --> Domain["2 · API domain module"]
  Domain --> Data["3 · build-v3 migration or query"]
  Data --> Async["4 · outbox or worker, when required"]
  Async --> Clients["5 · thin client UI"]
  Clients --> Verify["6 · contract + integration + flow tests"]
```

1. Define the business fact and its owner.
2. Extend `packages/contract`.
3. Add the narrowest `umi-api` module change.
4. Add a build-v3 migration when the fact needs storage.
5. Add an outbox route for an external side effect.
6. Generate or consume the client contract.
7. Verify the complete business flow.

## 19. Decision basis and references

### Documented facts

- [build-v3 foundation](../migration/build-v3/00_foundation.sql)
- [build-v3 Umi schema](../migration/build-v3/10_umi.sql)
- [build-v3 tenant schema](../migration/build-v3/20_tenant.sql)
- [build-v3 runtime schema](../migration/build-v3/30_runtime.sql)
- [build-v3 RLS and grants](../migration/build-v3/90_rls.sql)
- [build-v3 order model](../migration/build-v3/ORDER_MODEL.md)
- UmiPOS fusion plan: `UMIPOS_FUSION_IMPLEMENTATION_PLAN.md`
- [UmiPOS contract seam](2026-07-20-umipos-contract-seam.md)
- [Umi API centralization](2026-06-23-umi-api-centralization-spec.md)
- [`@umi/contract` guide](../../packages/contract/README.md)
- [`@umi/tokens` guide](../../packages/tokens/README.md)
- [Umi API root modules](../../apps/umi-api/src/app.module.ts)
- [Umi worker root modules](../../apps/umi-api/src/worker.module.ts)

### Source-backed tradeoffs

- [NestJS Fastify adapter](https://docs.nestjs.com/techniques/performance)
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [BullMQ custom job IDs](https://docs.bullmq.io/guide/jobs/job-ids)
- [node-postgres parameterized queries](https://node-postgres.com/features/queries)
- [node-postgres pools and transactions](https://node-postgres.com/apis/pool)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Zod schemas and type inference](https://zod.dev/)
- [Flutter offline-first architecture](https://docs.flutter.dev/app-architecture/design-patterns/offline-first)

### Umi-specific decisions

- UmiPOS is an Umi client, not a peer platform.
- `umi-api` is the sole backend and financial writer.
- build-v3 schemas represent authorship.
- KDS consumes an order projection and never owns an order.
- The database outbox provides the durable side-effect boundary.
- The POS and KDS use a direct LAN channel only for resilience.
- Umi Cash capabilities use the shared loyalty domain.
- OpenTelemetry and Sentry own operational telemetry.
