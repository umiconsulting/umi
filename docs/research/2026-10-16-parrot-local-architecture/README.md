# How Parrot's till avoids the round trip

- Date: 2026-10-16
- Question: the owner reports that "virtually every button tapped" costs an API
  call, and asks for the local-first shape Parrot used on this same hardware.
- Artifact: `~/umi-parrot-backup/2026-10-05/Download/pos_2.27.5.apk` (42 MB,
  `io.parrotsoftware.parrot_pos`). Read statically — Room puts its DDL in the
  DEX as string literals, so the local schema is directly legible.
- Decision it informs: the local working copy in `apps/umi-pos`, and the sync
  mechanism behind it.

**Method note.** This is architectural analysis of a shipped artifact, done to
understand a design. Schema shapes, table names and route paths are recorded as
facts; none of Parrot's code is copied, and nothing here is a licence to reuse
it.

## 1. The answer in one sentence

**Parrot's till is not a client of the API; it is a database with a screen, and
the API is a peer it syncs with.** Every row the UI touches is local, every row
carries its own sync state, and a background task list drains the difference
upward.

## 2. The local working copy

Their Room database holds the whole operational surface — orders, products,
tables, taxes, service charges, split checks, tips, cashier sessions, cash
movements, day closes — alongside three tables that are purely about being a node
on a network:

### `network_device` — the LAN routing table

```
deviceId, serialNumber, posName, posRole, ipAddress, port,
createdAt, updatedAt, status, isFirstSync
```

They keep each peer's **IP address and port in their own database**. This is the
hub's routing table: the primary POS knows where every other terminal is without
asking a cloud service, which is what makes the local API reachable.

### `kds_device` and `pay_device` — the roles

`kds_device` keys a kitchen screen to a `network_device` (by foreign key, with
`ON DELETE CASCADE`) and carries its `kitchenAreas` as JSON plus an `isExpo`
flag. `pay_device` keys a payment terminal to a device, with `isQuickPayment`
and `shouldReceiveQuickPayment`. So the LAN registry is typed by role, and a
device's disappearance removes its role rows with it.

### `sync_event_table` — the scheduler, not the queue

```
id, name, type, lastSyncTime, networkErrorType, taskStatus, lastLogEventSent
```

Named sync tasks with a status, a last-run time, and a **classified network
error**. The queue is not here — see below.

## 3. The queue is the rows themselves

This is the part worth copying. There is no outbox table. **Every syncable row
carries its own sync status**, e.g. `closing_summary` and
`order_notification_status` each end with `createAt`, `updateAt`,
`dbSyncStatus`. The states found in the artifact:

```
SYNCED · SYNC_REQUIRED · PENDING · FAILED · DELETED · PARTIAL
```

Two consequences that are easy to miss:

- **A delete is a state, not an absence.** `area_table` carries `isDeleted`, so
  removing a table is an update it can sync. Without that, a row deleted offline
  simply vanishes and the deletion never reaches the cloud.
- **The row is both the truth and the todo item.** There is one copy of a record.
  A separate queue has to be kept consistent with the data it describes; this
  cannot drift, because it _is_ the data.

And the scale of it is what makes the design legible as a whole: **twenty-one of
their tables carry `dbSyncStatus`**, and they are precisely the operational ones —

```
order_table             order_item_table        order_payment_table
kitchen_ticket          order_kds_command       order_kds_item_table
order_notification_status                       cashier_session
cash_movement           cashier_conciliation    closing_summary
time_clock              split_check             transfer_item
void_event              discount_usage          service_charge_usage
tax_item_usage          eater                   order_retention
```

Every order, every line, every payment, every kitchen ticket and every KDS
command is a row that knows whether it has reached the cloud. Nothing the
operator touches escapes the pattern.

## 4. The sync surface

The cloud routes carry dedicated batch endpoints, recognisable by the suffix:

```
/api/v1/orders/taxes/sync        /api/v1/split-checks/sync
/api/v1/orders/service-charges/  /api/v1/money/sync-cash-flow/
/api/v1/transactions/sync/
```

So the unit of transfer is a **batch of rows for one entity type**, not a
command. Registration and session routes sit beside them (`/api/terminals/`,
`/api/1/sessions`, `/api/v1/auth/login/`), and the catalogues are plain
collections (`/api/v1/products/`, `/api/v1/kitchen-areas/`,
`/api/v1/service-areas/`, `/api/v1/discounts/`).

## 5. The node itself

The APK ships a **Ktor server**, configured by `custom.config.yaml` and
`custom.config.conf` in its own resources (`deployment.port` 4244 and 4242), with
an Android module named `io.parrotsoftware.local_comm` holding
`ParrotLocalApiService`, a `DiscoveryManager`, a background `NetworkService`,
`NetworkStatus`, `NetworkConnectionType`, a `UrlProvider` and a
`ApiLocalHeaderProvider`. Peers are found with Android's `NsdManager` plus the
`com.github.druk:dnssd` library. Clock sync comes from a `TrueTime` module —
because a row written at 3 a.m. on a till with a wrong clock is a row that syncs
into the wrong place.

That is the whole node: a database, a server, a discovery agent and a clock, all
inside the POS application.

## 6. What this means for Umi

**The diagnosis it confirms.** Umi's till today is the inverse. Nine buttons in
ten reach the API before the screen changes, so every tap pays a wide-area round
trip: measured this session at 114 ms for a keypad digit that touches no server
at all, and 145–259 ms for anything that reads or writes. Parrot's till pays
none of that, and its architecture — not its code — is why.

**What transfers directly.**

1. A **durable local working copy**, not an in-memory cache. `CatalogCache`
   today is a `LinkedHashMap`; it does not survive a restart.
2. **Per-entity sync state** on the mirrored rows, with soft deletes.
3. A **LAN device registry** if the hub is built, carrying address and role.
4. A **sync task registry** with classified network errors, so a failed sync is
   a state a person can see rather than a swallowed exception.

**What does not transfer.** Their row-sync model assumes the client is the
authority for what it writes. Umi's server is deliberately the pricing, tax and
lifecycle authority and guards writes with an expected version. So the local
copy can own _the interaction_ without owning _the money_: prices, tax and final
totals stay server-confirmed, and the offline path reconciles against them. That
is the one place Umi must diverge from the shape.
