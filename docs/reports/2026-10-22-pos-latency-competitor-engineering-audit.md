# POS latency: Parrot APK engineering audit

Date: 2026-10-22

## Result

The evidence does not support treating Umi's latency as a UI or micro-optimization problem.
Parrot's shipped POS keeps the operational order path inside the store, uses Room as the
working database, exposes a Ktor service to peer devices, and synchronizes with the cloud
through a separate background path. Umi has a catalogue cache and a command queue, but two
critical interactions still wait for the remote API:

1. opening a new account and adding its first product;
2. reviewing and committing checkout.

The correct engineering decision is a local store hub with a durable local command model,
not more spinners, more caching in widgets, or a shorter cloud request sequence.

## Artifact and method

- Artifact: `/home/juan/umi-parrot-backup/2026-10-05/Download/pos_2.27.5.apk`
- Package: `io.parrotsoftware.parrotpos`
- Version: `2.27.5` (`50022705`)
- SHA-256: `fdc0492cd7ea3107ec6e74bb520d21a0cc602ac015fba2f7aea449f8dc07d1c3`
- Analysis: static JADX inspection plus direct APK resource extraction
- The APK was not executed. The cloud implementation and runtime network selection are not
  visible from this artifact, so those claims are marked as inferred.

## What the APK proves

### 1. The operational write is local

`OrderLocalRepositoryImpl` receives the Room DAOs for orders, items, payments, taxes, service
charges, retentions and split checks. Its `localAddOrderPayments` path:

- checks payment transaction identities already present locally;
- creates `DBOrderPayment` rows;
- records the associated cash movement;
- inserts the payments;
- recalculates the order total;
- returns the committed local rows.

Its `localCloseIfPaid` method reads the locally calculated remaining balance. It closes the
order locally only when the remaining balance is zero, then calls `localUpdateState` with
`FINISHED` and `AUTOMATIC_CLOSE`.

This is not merely a cache. The final paid result and close transition can be produced
without waiting for a cloud response.

### 2. Split checks follow the same rule

`SplitCheckRepositoryImpl.localCreateSplitChecks` maps every requested split to
`DBSplitCheck` with `DBSyncStatus.SYNC_REQUIRED`, inserts the batch through `SplitCheckDao`,
and immediately returns the local split rows.

Cloud delivery is a separate concern represented by the row's sync status. Creating a split
does not wait for cloud acknowledgement.

### 3. The local API is the peer-facing path

`OrderPOSRepositoryImpl` depends on `ParrotLocalApiService`, not directly on the cloud API.
Its `posCreateOrder`, `posAddOrderPayments` and split-check paths invoke operations such as
`createOrder`, `createOrderPayments` and `createSplitChecks` through `NetworkInteractor`.

`ParrotLocalApiService` exposes 163 operations for the live store: orders, payments, cashier
movements, tables, menus, permissions, discounts, kitchen tickets, printing, split checks and
sync settings. This is the surface of a local application server.

The APK contains:

- `POSService`, a foreground service with an `isMainPOS` role, a `posServer`, `networkService`,
  sync managers, print dispatcher and local repositories;
- Ktor server libraries and an Android keystore;
- `custom.config.yaml` and `custom.config.conf`, which declare Ktor ports `4244` and `4242`;
- discovery and network-device services for locating the primary POS.

The exact hostname selection is not established statically. The structure and the previously
recorded vendor documentation support the inference that peers address the designated main POS
over the LAN.

### 4. Cloud synchronization is outside the interaction

`SyncServer` starts independently of the order UI. It observes remote sync events and runs
its own ping loop. WorkManager upload/download tasks carry row changes in batches, and the
twenty-one operational Room tables carry `dbSyncStatus`.

The UI request therefore has two possible completion boundaries:

- local commit: affects the operator and local peers;
- cloud acknowledgement: changes the sync badge later.

Parrot does not make the second boundary hold the first one hostage.

## Umi's measured gap

Production iMin, 2026-10-22:

| Action                              |                   Observed | Layer                                                                         |
| ----------------------------------- | -------------------------: | ----------------------------------------------------------------------------- |
| First product with no account       |                about 1.8 s | sequential `POST /sales`, then `POST /cart/lines`                             |
| Open checkout sheet                 |                about 5.3 s | repeated policy reads, cart read, missing-checkout probe, partial-ledger read |
| Cash checkout                       | about 2.0 s before refusal | two `POST /checkout` calls                                                    |
| External/manual tender through paid |                about 5.7 s | capture, settlement, preview and commit                                       |

Source inspection explains each delay:

- `CatalogSurface._addProduct` waits for `SaleLifecycleController.newSale()` when no cart exists.
- For an operator with sale-lifecycle permission, `SaleLifecycleController._start` calls
  `SaleRepository.start`, which is the remote `POST /sales` route.
- Checkout policy, offline policy and tender providers are loaded more than once while opening
  the checkout.
- `_anchorCheckout` refreshes the cart remotely before reading recovery state.
- The final cash path sends a preview checkout and then a second checkout command.
- Split checks are stored in PostgreSQL and every subsequent balance check is a remote read.

Umi's existing `CartController` queue already proves the local interaction pattern can work.
It is simply not yet the authority for the complete account, split and checkout lifecycle.

## Required architecture

### Topology

The wired iMin is the store hub. The A9 and A11 are peers on the store LAN. The cloud remains
the eventual canonical and reporting system.

```text
POS / handheld / KDS
        |
        | LAN command groups and local reads
        v
Store hub on iMin
  SQLite projection + command log + cloud outbox
        |
        | asynchronous, idempotent batches
        v
Cloud API + PostgreSQL ledger
```

### Non-negotiable invariants

- One operator intent is one durable local transaction.
- Every command has an immutable command ID and idempotency key.
- One account has one serialization point. The hub assigns its next revision.
- A cash payment and the resulting paid/closed projection commit locally before paint.
- The cloud cannot create a second authoritative account or payment.
- A conflict is stored and visible; it is never deleted or silently retried as a new intent.
- Card capture and provider authorization remain online boundaries. Their result is then
  recorded locally.
- Prices visible before server repricing must come from a versioned signed/cached catalogue,
  never from an unverified UI calculation.

### Implementation sequence

1. Define the hub BFF contract around command groups, not individual tables. The first groups
   are `open_account`, `add_item`, `record_payment`, `create_split`, `settle_account`, and
   `close_account`.
2. Add a local HTTP server to UmiPOS or a small service co-resident with the iMin app. It must
   expose the operations currently called remotely by account entry and checkout.
3. Apply the group to SQLite in one transaction: validate revision, write projection, append
   audit event, append cloud outbox row, return the new revision.
4. Route all POS devices through the hub using explicit store-network identity and stable
   device roles. Do not infer the hub from a device name or a last-seen IP.
5. Move cloud upload to a single outbox worker with ordered batches, backoff and typed
   outcomes. The screen never waits for that worker.
6. Make checkout calculate from the local accounted balance and recorded payments. Preserve
   server-side reconciliation of price, tax, inventory and tender rules.
7. Surface one health state: local committed, cloud pending, conflict, or blocked. A hidden
   queue is a defect.

## Acceptance criteria

| Scenario                                     |                                                           Target |
| -------------------------------------------- | ---------------------------------------------------------------: |
| Product added to an existing account         |                                         local paint p95 < 250 ms |
| First product opens a new account            |                                         local paint p95 < 300 ms |
| Dismiss WAN during account and catalogue use |                                 no spinner for cached operations |
| Open checkout from a local account           |                                            interactive p95 < 1 s |
| Cash payment to paid/closed screen           |                                                        p95 < 2 s |
| First local split payment                    |                       p95 < 500 ms, before cloud acknowledgement |
| Duplicate submit                             |                                  one payment and one close event |
| Process killed after local payment           |            restart returns the paid state and pending outbox row |
| Two devices edit one account                 | one accepted revision; other gets a visible, resolvable conflict |
| WAN restored after several sales             |                             batches apply once, in account order |
| Card authorization fails                     |                       no paid/closed local projection is created |

## Alternatives

**Co-locate the API and database near the café and remove duplicate calls.** This is useful
and should be done as an intermediate mitigation. It cannot produce a multi-device offline
store and preserves a WAN floor on every uncached action.

**Keep the current SQLite cache and optimistic queue without a hub.** This makes one device
feel faster but cannot make cashier, handheld and KDS share the same account safely under
partition. It is the partial approach the evidence rejects.

**Copy Parrot's row-sync model for all money.** This is also rejected. Rows do not express
account order or a single authority for a tender. Umi should use command groups, revisions,
idempotency and an append-only audit while keeping server-side reconciliation.

## Evidence limits

- Manifest and application identity: `ev_0f147f9ffcc4b96337e803ff2503ebeaa0d570bdbbe4cb7f7b3bb5cbde8657c6`
- Local order repository inventory: `ev_a76e8ed08c27c1785a949668e5a5b0176f8f4cd7ab5fd9ad30ec6bfd3dc925bf`
- Local payment mutation: `ev_ee774a59941f029654d8b809872ed7a2fe77efe2fed25222b5cbf059a4108f6e`
- Local automatic close: `ev_b01c5aa287f122f93d951d2a4350e54660d0fc21281d90073cfa091e66aacd4b`
- Local split creation: `ev_0e6dcb49ed0c6e4401630494e71f8fbd5d1f77904b2c90970bac1355fa94f674`
- Evidence for the local routes: `ev_3c578d2241309fc53890603dd4d414e86ceb95adc58d71d9945e4e1299bc05df`
- Evidence for POS routing: `ev_0ee13baadc774f8ad041a21e3ddab5843880d62ca143587f804fb090a145e522`
- Foreground service/topology: `ev_35cffc47c5120fa5653199952bcaeed092432373074900f51113007271b97068`
- Background cloud sync: `ev_b26daf8c638de5ae77ee053ef0e59118a841a755d5fa6b1baf2c7bc9038563c9`
- Static inspection establishes classes, dependencies, configuration and local write order.
- It does not prove the runtime URL selected for every call or Parrot's server-side conflict
  behavior.
- The Ktor keystore and network discovery prove that a local server exists; they do not prove
  every LAN authentication or recovery path.
- Umi performance figures are production device/API measurements for the cited session, not a
  statistically complete benchmark.
