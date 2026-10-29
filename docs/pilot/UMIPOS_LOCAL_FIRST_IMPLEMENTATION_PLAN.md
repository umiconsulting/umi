# UmiPOS local-first: the audit, and the plan

Status: `STAGES 1–4 IMPLEMENTED; HARDWARE ACCEPTANCE RUNNING`. Supersedes the staging assumptions in
`UMIPOS_OFFLINE_FIRST_ORDER_PATH_DESIGN.md`; the architecture there still holds.
Date: 2026-10-16.

Inputs: the Parrot artifact audit
([2026-10-16-parrot-local-architecture](../research/2026-10-16-parrot-local-architecture/README.md)),
the measured tap latencies
([UMIPOS_TAP_LATENCY_REFERENCE](./UMIPOS_TAP_LATENCY_REFERENCE.md)), and the
current code in `apps/umi-pos` and `apps/umi-api`.

## 1. The audit, side by side

|                  | Parrot (the artifact)                                           | Umi today                                                       |
| ---------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Working copy     | Room/SQLite, the whole operational surface                      | **none** — `CatalogCache` is a `LinkedHashMap`                  |
| Read path        | local, always                                                   | API on screen entry                                             |
| Write path       | local row, then sync                                            | API first, UI waits, then paints                                |
| Unit of sync     | **the row** (`dbSyncStatus`)                                    | **the command** (cash checkout only)                            |
| Sync guarantees  | a status per row                                                | idempotency, ordering, cursor, conflict summary, reconciliation |
| LAN              | Ktor server + `network_device` (ip, port, role) + NSD discovery | none                                                            |
| Deletes          | `isDeleted` soft delete                                         | n/a locally                                                     |
| Clock discipline | TrueTime                                                        | server-anchored policy                                          |
| Money authority  | the client                                                      | the server, by design                                           |

## 2. What our hot path actually does

Measured on the iMin this session:

| Action                    | tap → paint |
| ------------------------- | ----------- |
| Keypad digit (no server)  | 114–127 ms  |
| Product add               | 142–157 ms  |
| Section switch            | 166–218 ms  |
| Catalogue category switch | 221–259 ms  |
| Open tender sheet         | 291–294 ms  |

and the network beneath it: **97 ms best / 129 ms average** to the API, with 34–38
ms of jitter.

The keypad figure is the tell. It touches no server and still costs 114 ms; every
other row is that figure plus a wide-area round trip. **The API is on the
interaction path**, exactly as the owner says.

In code, that is one shape repeated: about a hundred `await` calls to a
repository from `features/`, and every cart write funnelling through
`CartController._mutation`, which sets the state to `loading`, awaits the API, and
only then publishes the new cart.

## 3. What Parrot has that we do not

1. **A durable working copy.** This is the whole advantage. Every screen is drawn
   from a local database, so no button pays a round trip.
2. **A row that carries its own sync state**, so a record and its "needs
   uploading" flag cannot drift apart.
3. **Soft deletes** (`isDeleted`), so a removal made offline syncs as an update
   instead of vanishing.
4. **A LAN registry and a node**: each peer's address and port in their own
   database, a Ktor server in the app, and DNS-SD discovery.
5. **Sync tasks as visible state** — `sync_event_table` holds a named task, its
   status, its last run and a **classified network error**.

## 4. What we have that Parrot does not, and must not lose

This is the part that matters for the "REA-level logic copy" caution — a naive
copy would make us _worse_, not better.

1. **A command log with identity and ordering.** `OfflineJournal` keys every entry
   by `commandId` and `idempotencyKey`, and `ReplayEngine` exposes a **cursor**,
   **batched submit**, **result-by-command-id**, a **conflict summary**, and an
   explicit **reconciliation** step. Parrot's per-row status has no equivalent:
   two rows that touched the same order cannot be ordered against each other.
2. **The server as the money authority.** Prices, taxes, totals and the cart
   version are decided server-side. Parrot's model lets the client own them, which
   is why its sync is a row upload rather than a reconciliation.
3. **A default-deny offline policy**, signed and expiring, with explicit ceilings.
4. **Device identity** — a durable device credential with proof of possession.

The earlier Odoo research is the cautionary tale for abandoning these: duplicate
payments, resurrected lines and IndexedDB-versus-server conflicts are all
symptoms of a row-sync without identity or ordering.

## 5. What is actually missing

Our sync machinery is not the gap. **It is only wired to two command types** —

```dart
OfflineCommandType = ['operational.ack', 'pos.checkout.cash']
```

— so the order path never enters it. The plan is therefore not "build Parrot's
system"; it is **give the order path the local copy Parrot has, and run it
through the replay engine we already trust**.

## 6. The target

```
            ┌──────────── rendered state ────────────┐
            │  base (last server answer) ⊕ pending   │
            └────────────────┬───────────────────────┘
                             │
     durable working copy ───┘         journal (ordered, idempotent)
     products, modifiers,              cart.open, line.add,
     prices, tax, tables,              line.update, line.remove,
     accounts, policy                  cart.fire, checkout.cash
                             │
                    ReplayEngine (cursor · conflicts · reconcile)
                             │
                        umi-api (money authority)
```

Reads never leave the device. Writes land in the local copy and the journal, the
screen paints, and the drain happens behind the operator. The server's answer is
still the truth; a local write is **provisional** until it is accepted.

## 7. Stages

### Stage 0 — Measure (done)

`TapLatencyProbe` measures tap→paint and frame cost; the API's own request log
measures server time. Exit criterion met: the numbers in §2, reproducible across
sessions.

### Stage 1 — The durable working copy

The piece Parrot has and we do not.

- A local store on the device (SQLite through `sqflite`/`drift`, or a versioned
  atomic snapshot if the whole set fits comfortably in memory — decide at
  implementation).
- Hydrated on session open with: catalogue (products, variants, modifiers,
  prices, tax rates), floor plan and tables, open accounts, the device's own
  registration, and the signed offline policy.
- Refreshed in the background; a refresh never blanks what is already held.
- **Exit:** with the uplink cut, the app opens the floor, the account list and the
  catalogue complete from disk, with no spinner for data it already had. A
  catalogue category switch should fall from the measured 221–259 ms toward the
  ~114 ms local floor.

#### Stage 1 implementation, 2026-10-16

The working copy is `SQLite`, as the owner selected. It uses `sqflite` on Android
and `sqflite_common_ffi` on Linux. The schema is versioned and stores the
contract JSON beside the indexes needed for a fast read.

The first tile is in place:

- Catalogue categories, products, page membership and product details come from
  SQLite first. The API refresh starts after the cached screen is painted.
- The floor plan comes from SQLite first; the API refresh follows.
- Open accounts and carts are written after every server answer. A cached account
  read paints first and refreshes behind it.
- A catalogue refresh keeps the last answer on screen when the API fails.
- Writes to a local table do not replace the partition row. Replacement would
  activate `ON DELETE CASCADE` and erase the sibling catalogue pages.
- Contract version and local page version are checked together, so a stale
  category page is not painted as current data.

Evidence from the iMin D3:

```text
SQLite: 200 KB at /data/data/co.umiconsulting.umi_pos.estacion/databases/
categories: 3, catalogue pages: 4, products: 51

Category switch, first warm pass: 141, 138, 152, 142 ms
Category switch, second pass:   139, 140, 136, 143 ms
Before:                        221–259 ms, mean 236 ms
```

The category switch is now inside the local tap range. The uplink-cut launch is
not yet verified on the iMin; the row above is a verified network-free storage
test plus a verified on-device latency result, not a substitute for that test.

### Stage 2 — The order path in the journal

- Extend `OfflineCommandType` with the order commands, each carrying the cart id,
  the operator session, `commandId` and `idempotencyKey`.
- Apply each command to the working copy **before** the screen reads it; the
  screen paints the composed state.
- Drain through `ReplayEngine` in order, per cart. Reuse the existing cursor,
  conflict summary and reconciliation rather than inventing a row-status model.
- A refused command leaves the journal and reverts the painted state — the rule
  the optimistic cart already follows.
- **Exit:** a four-line account is taken with the uplink cut, printed, and
  reconciled on reconnect; a duplicate replay applies once.

#### Stage 2 groundwork, 2026-10-16

The server replay path now accepts these order commands:

```text
pos.cart.line.add
pos.cart.line.update
pos.cart.line.remove
pos.cart.clear
pos.cart.prepare
pos.cart.fire
pos.cart.fulfillment.set
```

The replay service applies each one through `PosCartService`, which is the same
service a live tap uses. It reads the current cart and supplies the current
version, while it keeps the command idempotency key. A refusal becomes a replay
conflict. The contract policy lists only the order commands the operator can
actually use.

Still open before Stage 2 exit:

- Add the order commands to the POS command queue before the API call.
- Compose the screen from the last server cart plus queued commands.
- Drain the queue in order, and map a provisional line id after the first add.
- Persist a transport-failed command batch, then let `ReplayEngine` reconcile it.

#### Stage 2 implementation, 2026-10-17

The POS now has one ordered command lane for cart writes:

- A tap appends a local command, paints the composed cart, and returns.
- The queue keeps the last server cart as its base.
- Commands drain one at a time against the version from the previous answer.
- A provisional line id maps to the server line id after the first add.
- A provisional cart id maps to the server cart id after `pos.cart.open`.
- A gateway error, timeout, invalid error body, or unknown server fault keeps
  the command in the encrypted journal. Only a typed conflict or permission
  refusal removes it.
- Reconnect replay clears the local projection only after the journal has no
  pending order command and the server cart has been read.
- A simple product tap uses the cached product summary. It no longer fetches
  product detail when the summary proves that the product has no variants or
  options.

The API replay path accepts and applies all of these commands:

```text
pos.cart.open
pos.cart.line.add
pos.cart.line.update
pos.cart.line.remove
pos.cart.clear
pos.cart.prepare
pos.cart.fire
pos.cart.fulfillment.set
```

It uses the same `PosCartService` as a live request. A cart opened by an offline
command returns its official id to the replay result. Later commands use that id
inside the same batch, or fall back to the operator's active cart in a later
batch.

Migration `043_local_first_order_replay.sql` extends the replay table's command
type CHECK constraint. Without it, the server code accepted the command and
PostgreSQL refused the append.

Verification:

```text
Flutter analyzer: clean
Flutter tests: 1,028 passed
API typecheck: passed
Offline replay service tests: 7 passed
Staging image: healthy on contract 2.39.0
```

Real-device evidence: with the staging API container stopped, a product tap
reported `pos.cart.line.add painted=true` and painted the new line in 182 ms.
With the API restored, the queued command was accepted and the server answer
replaced the local projection.

A second run started from an empty account with the API stopped:

```text
pos.cart.open painted=true
pos.cart.line.add painted=true
local cart: 4 distinct lines, MXN 415.00
sync badge: "3 sin sincronizar"
tap → paint: 153, 194, 184, 183 ms
```

After the API returned and the app restarted, the badge disappeared. The staged
database held one `pos.cart.open` and three `pos.cart.line.add` rows for the
replayed commands. The server cart replaced the local projection without a
second cart or a duplicate open command.

Still open before Stage 2 exit:

- Verify a complete four-line order with cash checkout and print while the
  uplink is cut.
- Keep a queued cart open across app restart without creating a second local
  cart.

### Stage 3 — Soft deletes and visible sync state

- `isDeleted` on mirrored rows so a removal can sync.
- A visible per-task sync state with a classified error — Parrot's
  `sync_event_table` idea, mapped onto `SafeReplayDiagnostic`.

The first visible state is implemented: the top status area shows a pending
command count, such as `3 sin sincronizar`, and removes it only after replay and
a server cart read. Mirrored rows carry `deleted_at`; server-confirmed rows carry
`sync_state`.

Stage 3 is now closed. The recovery centre also shows the **server's** view of
this till's queue, from `SafeReplayDiagnostic`: accepted sequence, accepted
count, conflicts and queue depth in one line — counts and a safe error category,
never a token or a payload. Verified on the iMin: `Servidor: 0 · aceptadas: 0 ·
conflictos: 0 · cola: 0`, positioned directly under the status line so support
can tell "the till thinks it is behind" from "the server thinks it is ahead"
without a screen share. Mirrored catalogue pages and open accounts both retire
rows that disappear from the server (`deleted_at`), so a removal cannot linger
in the offline copy.

### Stage 4 — The node (only if the hub is wanted)

- The `network_device` idea: address and port per peer, typed by role, in our own
  store.
- A local server on the wired iMin and DNS-SD discovery. This is the largest
  stage and should not start before Stage 1 has been measured.

## 8. Risks, named

| Risk                                   | Why it bites                                  | Mitigation                                                                                      |
| -------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Applying commands twice                | The Odoo duplicate-payment failure            | `commandId` + `idempotencyKey` on every command, already in the journal                         |
| Local price drifting from the server's | The client becomes a second pricing authority | Local prices are a snapshot; the server's answer replaces them, and the policy bounds staleness |
| A painted state that never reconciles  | Operators stop trusting the screen            | Pending state is visible; a refusal reverts, as the optimistic cart already does                |
| Ordering across devices                | Two writers on one account                    | The server's one-owner rule (`CART_ACCOUNT_BUSY`) stays; one writer per account                 |
| Storage growth on a 2 GB terminal      | Journals and mirrors grow                     | Bounded retention on accepted commands; the working copy is a set, not a log                    |

## 9. What this buys, in the owner's terms

The measured floor of 114 ms for a keypad tap is local. Stage 1 moves the
166–259 ms screens onto that floor; Stage 2 moves the 142–157 ms writes onto it
and makes them work with the uplink cut. Neither stage changes what the money is
— that stays the server's.

## 10. Hardware acceptance, 2026-10-16 (iMin D3, `192.168.1.10`)

Measured on a profile build against `api-staging.umiconsulting.co`, with the API
stopped to create the outage rather than a fake connectivity flag.

### What was measured

| Moment                              | Before                      | After                                             |
| ----------------------------------- | --------------------------- | ------------------------------------------------- |
| Header while the API was dead       | `En línea` for minutes      | `Conexión inestable` ≤ 8 s, `Sin conexión` ≤ 33 s |
| Offline cash commit (tap → receipt) | ~12 s (client 15 s timeout) | **< 1 s**                                         |
| Reconnect to sale accepted          | never (no probe, no replay) | ~10–40 s, unattended                              |

### What was broken, and why it was invisible

Five defects stacked on top of each other. Each one alone was enough to strand
a sale; together they looked like "the backend is slow".

1. **Nothing probed the API.** Local-first removed the accidental probe every
   tap used to make, so the reachability counters froze at their last positive
   value. The pill said `En línea` while the backend returned 502, and replay —
   edge-triggered on `offline → recovering → online` — never fired.
   Fixed with a 10 s `GET /health/live` probe (4 s deadline) that also drains the
   journal on every success, so replay is level-triggered as well as
   edge-triggered (`connectivity_heartbeat` in `composition_root.dart`,
   `OfflineRecoveryController.replayIfPending`).
2. **The checkout waited for the 15 s client timeout** before falling back to
   the journal. When the till already knows it is offline, `_submit` now goes
   straight to a local confirmation and commit.
3. **The replay batch authorized against the command's own operator session.**
   The session that wrote the sale is usually dead by the time the network
   returns (lock, restart, shift change), so every pending sale came back
   `DEVICE_REVOKED`, forever. The batch now authorizes the submitting session,
   which travels on the replay URL; the command's session stays as attribution.
4. **Client and server canonicalized JSON differently.** The server sorted keys
   with `localeCompare`, the Dart client by code unit. `taxes` and `taxVersion`
   are the pair where those disagree, so every cash checkout replayed as
   `fingerprint_mismatch` while the cart commands beside it were accepted. The
   server now sorts by code unit (`canonical-json.ts`), with a regression test.
5. **The offline checkout command did not survive contract validation**: it sent
   `customerValueFingerprintCommandId: null` where the contract requires a UUID.

Two more surfaced in the same run and are fixed:

- A cart opened offline gets a server-minted id, and the alias only lived for
  the batch that created it. A checkout arriving in a later batch died as
  `CART_NOT_FOUND`; it now falls back to the session's active cart, which the
  price preview then verifies.
- The replay set `expectedVersion`; the checkout contract reads
  `expectedCartVersion`. The stale value produced `aggregate_version_conflict`
  on every replayed checkout.

### Evidence on staging

- Journal: `pos.cart.open`, `pos.cart.line.add`, `pos.cart.fulfillment.set`,
  `pos.checkout.cash` — four rows, all `accepted`, no conflicts.
- Provisional `436532d2-1f5c-4f70-8aaf-a887b618ccfa` → official sale
  `f0cd634a-ff37-4509-be91-95c27ec9543b`, receipt **0002**.
- Restart with the queue drained: no re-submission, no new rows, committed
  sales unchanged. Restart mid-sale: the four commands were re-submitted and
  answered `duplicate`; no second sale.

### Operator-facing fixes in the same pass

- The recovery centre listed rows as `#1 … #7` with the same sentence on each.
  It now names what happened and where it stands: `Venta en efectivo ·
MXN 120.00 — Pendiente de envío`, `Producto agregado — Enviada`.
- `blocked` is sticky against the reachability probe, so a probe cannot reopen a
  till whose credentials were refused.

### Still open

- ~~The till cannot boot without the API~~ — fixed for an unlocked till (§11).
  A **locked** till still needs the API to verify a PIN, because nothing on the
  device can check one; deciding whether to keep a local verifier is a security
  decision, not a scheduling one.
- ~~Raw API errors as banners offline~~ — the catalogue and sale-lifecycle ones
  are quiet now. The table picker still says "No se pudo actualizar la sala" and
  blocks a dine-in checkout when the floor plan cannot be refreshed, even though
  a local copy exists. The cache key and the assignment are fixed (below); the
  hardware run is pending because the staging host went down.
- ~~UTC `businessDate` in the totals preview~~ — the local cart now stamps the
  local date.
- ~~The provisional receipt does not refresh into the official one~~ — fixed,
  see below.
- ~~`push-token` retrying every 10 s~~ — bounded to one attempt per session per
  ten minutes. The endpoint still 503s on staging because FCM is not configured
  there, which is the correct answer for that deployment.
- Every guard in the checkout block still reports `price_changed`, including a
  cart-identity mismatch. _(Split into `cart_mismatch` /
  `offline_limit_exceeded`; not yet deployed.)_
- ~~The receipt header mark renders as a doubled stroke~~ — it was **not** the
  logo. The provisional sale screen put a 64 px `PosIcon` straight into a
  `Column(crossAxisAlignment: stretch)`, and `PosIcon` is a `SizedBox.square`
  around a painter that scales x and y independently — so the cloud icon was
  laid out 1 800 px wide and painted 28:1 flat, which looked like a torn dark
  ribbon above the title. Now centred. The merchant had **no logo at all**:
  `merchant_branding_logo` was empty.
- ~~The iMin build carries `UMIPOS_TAP_LATENCY_PROBE=true`~~ — a probe-free
  profile build has been produced and installed on the iMin
  (`app-staging-profile.apk`, 48.2 MB, same dart-defines minus the probe). The
  device now runs that build, signed in and online, with the Mesa 4 account
  restored and an empty queue.

### Staging state left behind

- `UMI_API_TAG=local-offline-queue`; the previous tag is in
  `/home/juan/umi-api-test/.env.before-offline-queue`.
- `merchant.staff` Admin ONCA (`40000000-0000-4000-8000-000000000110`) has PIN
  `2468`; the previous salt/hash/lookup are in
  `/home/juan/pin-backup-admin-onca.txt` on the VPS. Restore or rotate before
  the pilot.
- Replay rows, cursor, conflicts and provisional mappings for
  `Caja iMin` (`143e6ca9-…`) were cleared twice while chasing the defects; the
  two committed staging sales were left in place.

## 11. Booting and selling with no uplink (2026-10-16, later)

The gate from §10 is closed for an **unlocked** till: with the API stopped and
the app force-stopped, the iMin now comes up on the catalogue, takes a cash
sale, and prints a provisional receipt in under a second. Three changes made
that true, and each one was a separate refusal before:

1. **The release-compatibility gate aborted the boot.** `BootstrapController`
   asked the API whether this build may run, and an unreachable API is not an
   answer. It now remembers the proof it already has — the same contract and
   release, verified on this device within seven days — and continues. A
   different contract, a different build, or an expired proof still fails as
   before, so the gate is honoured rather than skipped.
2. **The entry controller needed the API for device status and a session
   refresh.** It now keeps the state the server itself resolved (device,
   merchant, branch, operator session) and, inside the same five-minute restore
   window the silent refresh already used, replays it when `deviceStatus` comes
   back as transport, timeout, 5xx or unknown. Credential and permission
   failures are never in that list: they still fail closed.
3. **A cold start had no open shift and no sale authority.** The cart is
   journaled so the sale could be built, but the charge needed a
   `cashShiftId` that only the API could supply, and sale lifecycle's failed
   `current` painted "we could not complete the sale safely" over a till that
   could sell perfectly well. The open shift this till last saw is now cached
   (keyed by merchant, location and operator session, so one operator cannot
   inherit another's drawer), and a transport-class failure in the sale
   lifecycle is neutral rather than an error banner.

Verified live: cold start with the API down → catalogue with `Conexión
inestable`, no error banner, 1 Cappuccino, `Cobrar` → `MXN 60.00` → provisional
`a504c5ce-c609-48ab-969a-7a4abd4e694a`.

### Newly found: a second account reuses the server's active cart

Replaying that cold-boot sale produced `price_changed`. The cause is not
pricing: `pos.cart.open` replay resolves to the session's **existing** active
cart instead of creating the new one the operator opened, so commands 9–11
(a fresh 60.00 cart) landed on the cart the previous boot left open (3 ×
Cappuccino, 180.00), and the price guard correctly refused to charge 60 for it.

The guard did its job — the till never charged the wrong amount — but the
operator is left with a sale that can never land. Two things are needed:

- `pos.cart.open` replay must produce a _new_ cart when the operator started a
  new account, rather than adopting the session's previous one.
- The refusal currently reports `price_changed` for every guard in that block,
  including a cart-identity mismatch; the classification should name the cart
  problem so the recovery centre does not send the operator looking at prices.

**Fixed for the replay itself.** A journaled `pos.cart.open` is a new account,
so when `create` resumes a cart that already has lines or a table, replay now
saves it (the same `suspend` the counter performs on "Nueva cuenta") and opens
the new account behind it. An empty resumed cart is adopted, because it is the
same account in every way that matters. Covered by
`saves the cart it would have resumed before opening a new account`.

That branch is unit-tested rather than hardware-replayed: reproducing it needs
the local cart to be gone while the server still holds the operator's open one,
and `pos_cart_lifecycle_guard` correctly refuses to manufacture that state by
flipping a suspended cart back to `building_cart`. The live run right after the
fix (offline sale, API restored) took the reuse path instead — line.add onto the
server's cart, checkout accepted, provisional `376fa063…` → sale `1dffff10…`,
receipt **0003** — so the fix is proven by test and the surrounding path by
hardware, not both by hardware at once.

The classification point stands: every guard in the checkout block still reports
`price_changed`, including a cart-identity mismatch.

### Three more fixed in the same pass

- **The local business date was UTC.** A cart the till opened locally stamped
  `DateTime.now().toUtc()`, so a 21:00 sale in Mazatlán carried the next day's
  operational date until the server answered. The server was right all along
  (`tg_business_date` uses the branch timezone); the local stamp now uses the
  till's own calendar. Verified on the device: a cart created after the fix
  stores `2026-10-16`, the carts before it store `2026-10-17`.
- **Replay never resumed after a cold offline boot.** The recovery scope was
  attached as the last statement of the catalogue's load, so the one boot that
  needs it — the one whose catalogue read fails for lack of uplink — skipped it.
  Without a scope the heartbeat could not replay. It is now attached after the
  load whatever its outcome, and verified: offline boot, one item added, API
  restored, two batches submitted with no UI interaction.
- **The header kept saying "2 sin sincronizar" after those commands were
  accepted.** The count came from the in-memory queue, which only cleared when
  the post-replay cart read succeeded — so a failed read left the operator
  looking at unsynced work that did not exist. The journal now decides: once it
  has nothing pending the queue clears, and the cart read only refreshes the
  screen. Verified: the badge went from `2 sin sincronizar` to `En línea` on its
  own.

Verified in the same run: `pos.cart.open` and `pos.cart.line.add` accepted, zero
conflicts.

### Dine-in offline (code complete, hardware pending)

Two things stopped a dine-in sale without a link, and both were about identity
rather than about the network:

1. **The floor plan was cached under the operator session**, which is minted
   again on every restart, lock or handover. A till that had drawn the room a
   minute ago could not find it after a restart, went to the API, and refused
   the sale. The cache key is now `merchant:location` — a published floor plan
   is a property of the room.
2. **The table assignment was not an offline command at all.** The picker chose
   a table and the till called the API to bind it; offline that call failed and
   the sale never started. `pos.cart.table.set` is now a journaled command:
   the till paints the table it chose, journals the assignment, and replay binds
   it to the cart the server creates. The server re-checks the table there, so
   two tills claiming one table in a dead spot is a conflict to report rather
   than a wrong room on a receipt.

Contract, API and client are in place, with a unit test for the replay branch
(`assigns the table the till chose while it had no uplink`) and the full API
suite green at 2023 tests.

**Partly verified on hardware.** The floor plan is served from the local copy
with the API down — the picker opens, Mesas 1–4 are drawn, one can be selected,
and "Usar mesa" is enabled. Getting there took two more fixes:

- "Usar mesa" was disabled whenever the live occupancy map was missing
  (`map == null || stale`), which is the normal state offline. It now blocks
  only while the room is actually being read; occupancy is a server fact and
  the claim is checked again at replay.
- The counter's table path is `assignAccountTable`, not `openTableAccount`; the
  first fix had been applied to the wrong method, and `_busy` returned before
  the offline branch. Both are corrected.

**Verified up to the server.** A later run journaled the assignment and replayed
it: the server answered with a refusal, `server_validation_failed`, at the table
command. The reason was not a code defect — Mesa 2 was already `seated` by the
cart from the previous run, so the server correctly refused to give it to a
second account. That is the guard working.

What that refusal exposed is a messaging defect, now fixed: a table another till
holds is reported as `table_unavailable` rather than "validation failed", so the
recovery centre tells the operator to pick another table instead of sending them
to look at the payload.

**The assignment itself now lands.** With a clean journal and a free table
(Mesa 4), the offline counter flow ran end to end: fresh account, one
Cappuccino, `Cobrar`, picker from the local plan, Mesa 4, _Usar mesa_ — and the
cash sheet opened for MXN 60.00. On reconnect the server shows
`pos_cart bffa9e50…` with `table_id = 21460337` (Mesa 4) in `building_cart`, and
the previous Mesa 2 cart moved to `suspended`. That is the outcome the operator
asked for.

**What is still wrong is the bookkeeping, not the outcome.** That run recorded
the table command as `server_validation_failed` in
`offline_replay_conflict` while the cart carries the table, so the till keeps a
conflict badge for work that actually landed. Two refusals can produce that
shape and the next session should start by logging the exact `code` from
`assignAccountTable`: `CART_VERSION_CONFLICT` is already mapped to
`aggregate_version_conflict`, so it is the other branch — most likely
`CART_TABLE_ACCOUNT_EXISTS` or `CART_ALREADY_ASSIGNED` arriving after an online
retry had already applied the same assignment, which the repository treats as
idempotent. Either way the command should settle as `accepted` when the cart's
`table_id` already equals the requested table, and the client should pass
`tableName` on this path too (the optimistic paint shows _Cuenta_ without the
table name; the assignment itself is correct).

**Fixed for the retry case, deployed.** A `CART_ALREADY_ASSIGNED` or
`CART_TABLE_ACCOUNT_EXISTS` refusal is now resolved by reading the cart: if its
`table_id` is the requested table, the command settles as `accepted` instead of
leaving a conflict for work that is already done. Covered by
`settles a table assignment that had already landed as accepted`; the live
confirmation needs a fresh journal, since the entry from the run above is
already marked conflicted on the device.

The client now passes `tableName` on the counter path too. Verified after a
restart: the till restored the server cart as **Cuenta 019 · Mesa 4** with the
queue empty and the header online, so the table survives the app and the chip
names it instead of saying _Cuenta_.

Still unverified live, and covered only by the unit test above: the
idempotent-settle branch. Reproducing it needs a lost batch response or an
online retry racing the journal, neither of which can be staged from the UI.

### A refused sale now says what to do

The classification work had a hole on the other side of the wire. New codes
fell through to the default action — _Sincronizar_ — which re-sends a command
that is going to be refused again, and every conflict row read the same
"Requiere tu revisión" with no reason.

Two changes, verified live by ringing a sale to an occupied table offline and
replaying it:

- The recovery row now carries the reason in plain language: **"La mesa ya está
  ocupada. Elige otra mesa y vuelve a cobrar."** — not a code, not a generic
  sentence.
- The action follows the reason: `table_unavailable` and `cart_mismatch` offer
  _Actualizar datos autorizados_ (look at the world again), and
  `offline_limit_exceeded` offers manager review. Re-sending the same command is
  no longer offered for any of them.

The screenshot from that run: rows #1 and #2 _Enviada_, #3 with a warning icon
and the sentence above, and the action bar showing _Actualizar datos
autorizados_. Covered by `a refusal the till can act on offers the right next
step`; the wording itself is what the screenshot shows.

### The receipt now turns into the official one

The provisional slip stayed provisional for the rest of the shift: replay runs
in the recovery controller, and the receipt is a snapshot taken at commit time,
so nothing told the screen the sale had landed. The operator was left holding a
slip that might already be official — the doubt that makes staff re-check work
they have already done.

`CheckoutController` now follows the journal while a provisional receipt is on
screen. When replay reports completion and the entry for that provisional id is
accepted (or a duplicate), the phase becomes `provisionalSynced` and the screen
switches to **Venta sincronizada**, showing the official sale reference where
the provisional id used to be.

Verified live: provisional `80c4bd14…` → official `21eb9dd5…`, receipt **0004**;
the receipt on screen showed `Venta sincronizada` with `21eb9dd5…` without the
operator touching anything, and staging's
`offline_provisional_mapping` carries the same pair.

### Quiet when the till is working

- **Product options are warmed while there is a link.** A product with no
  variants was always added from the grid with no network; one with options
  needed a detail fetch on first tap, so a barista offline could sell a plain
  espresso and not a cappuccino. The catalogue now fetches the option sheets for
  up to 25 products that need them, in the background, skipping anything already
  cached.
- **Missing options say so instead of blaming the catalogue.** A detail that was
  never cached now reads "Sin conexión: las opciones de este producto aún no
  están guardadas en esta terminal." rather than "El catálogo no está disponible
  temporalmente" over a menu that is right in front of the operator.
- **Sale-lifecycle failures no longer paint a banner while the till knows it is
  offline.** The header already says `Sin conexión`; a red bar about a call that
  could not be made is a second, louder way of saying the same thing.
- **Push registration stopped retrying every ten seconds.** The connectivity
  listener asked for a push registration on every heartbeat; staging has no FCM
  credentials, so each attempt was a 503 and a log line — six a minute per
  terminal. One attempt per session per ten minutes now, and one log line
  instead of a stream. Verified: one failure in 45 s where there used to be six.

## 12. Stage 4: the LAN node — what is actually there

### Measured, 2026-10-17 (iMin D3, office LAN)

| Question                         | Answer                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Is there a shared LAN?           | Yes. iMin `192.168.1.10/24`, gateway `192.168.1.1`; the workstation is `192.168.1.9` on the same /24                                                                                                   |
| Can the main device serve to it? | **Yes.** A toybox `nc` loop on `:8080` answered `HTTP/1.1 200` from the workstation (`umi-lan`)                                                                                                        |
| Are the other terminals present? | ARP shows `.5`, `.6`, `.14`, `.15`. `.6` (the A11) answers ARP but not ICMP, and `adb connect .6:44063` returns _no route to host_ — adb-over-wifi is off there, so I cannot drive that peer from here |
| Is the KDS a separate app?       | **No.** `apps/` holds `umi-pos`, `umi-api`, `umi-cash`, `umi-dashboard`, `umi-landing-page`. The KDS is `device.type == 'kds'` inside the same POS client                                              |

The last row decides the shape of this stage. There is no second client to teach a
new protocol; there is one client, pointed at one API, in three roles.

### The three options, and what each costs

**A. The hub is a caching proxy of the same contract.** The main device runs an
HTTP server that speaks the same routes; peers keep the same `ApiClient` and
change only their base URL when the cloud is unreachable. With a link the hub
forwards; without one it answers reads from its own SQLite mirror and accepts
writes into the journal it already has.
_This is the only option that reuses the contract, the auth model and the replay
engine instead of inventing a second source of truth._

**B. A bespoke LAN sync protocol.** Tickets and cart deltas gossiped peer-to-peer.
Cheaper to prototype, but it creates a second consistency model next to the
journal, and the two will disagree.

**C. Nothing until the cloud story is exhausted.** Legitimate: the till now sells,
prints, reopens and settles with no link. What it cannot do is _show the KDS an
order the counter took_ while both are offline.

### The blocker that decides everything: offline authentication

A peer's credential is issued and signed by the cloud. An offline hub cannot
verify it, so option A cannot simply accept the bearer tokens the peers already
hold. The hub needs its own trust: at pairing time, while the cloud is reachable,
each peer and the hub exchange a key that the hub stores; offline, the hub
accepts only paired peers and scopes every request to that device's role and
branch. That is a security design decision with a real cost — a stolen paired
terminal is trusted by the hub until it is unpaired — and it should be decided
before any code is written.

### What I would build first, when that decision is made

1. `network_device` in the working copy: role, address, port, paired key id, last
   seen — the plan's original idea, and nothing more.
2. A health surface on the hub (`/lan/health` answering role, branch, journal
   depth) and a client that prefers it when the cloud probe fails.
3. Read-through for the KDS ticket list only, because that is the one screen whose
   value is destroyed by a split brain: two offline tills showing two different
   kitchens.
4. Writes stay in each peer's journal and go to the cloud. The hub never becomes
   the authority for money.

**Recommendation: A, starting with step 1 only after the owner decides the
pairing/trust question.** Until then the LAN is measured and reachable, and this
stage deliberately does not start: it is the one change here that can make the
system less trustworthy if it is built on the wrong authority.

## 13. Dry run, 2026-10-17: the fire leg, and what it caught

Stage 2's exit also asks for a complete order, and cash/table/offline had been
proven while the kitchen leg had not. Ran on the iMin against staging:

- Cuenta 021, dine-in, 9 Cappuccino and 2 Americano limón mineral (MXN 720.00),
  `Enviar a cocina`.
- Both lines flipped from _Pendiente de enviar_ to **En cola**, the fire button
  was replaced by `Cobrar`, and `merchant.kitchen_order` went from 5 to 6.
- Ticket `883aaf6f…` in `queued` with exactly those two lines and quantities,
  both routed to station `dafcef9a…`.

So the till's half of the kitchen path works end to end: the order is fired, the
ticket exists, and it is routed to a station.

### What the dry run caught

`merchant.kitchen_device_station` is **empty** in staging, and
`ticketBelongsToDevice` refuses any order when the session has no `stationId`
(`if (!session.locationId || !session.stationId) return false`). A dedicated KDS
device with no station binding therefore answers `ticket_not_found` to every
ticket — the kitchen tablet shows nothing while the counter believes the order
was sent.

That is configuration, not code: the station binding belongs in the dashboard's
device setup (the runbook explicitly forbids setting it by SQL). It is now a
numbered step in the commercial walkthrough, and it is the first thing to check
if a pilot says "the KDS is empty".

The KDS tablet itself could not be observed from here — it is not adb-reachable
(`adb connect 192.168.1.6:44063` reports _no route to host_) — so this leg is
proven at the API and configuration layer, not on the kitchen screen.

## 14. The café's mark, and why it was never there

Two separate things were wrong, and only one of them was a drawing problem.

**The "doubled stroke" was an icon.** The provisional sale screen — the one that
appears when a cash sale lands offline — put a 64 px `PosIcon` into a
`Column(crossAxisAlignment: CrossAxisAlignment.stretch)`. `PosIcon` is a
`SizedBox.square` around a painter that scales by `size.width / 24` and
`size.height / 24`; under a stretch constraint the width is the whole panel, so
the cloud-off glyph was painted 28:1 flat across the top of the receipt. It is
centred now, and it was never the merchant's logo.

**There was no logo.** `merchant.merchant_branding_logo` was empty for every
merchant, so `merchant.logo_url` was null and the receipt had nothing to draw.

The owner had an SVG on this machine — `docs/reports/evidence/2026-10-11-onca-logo/onca-badge.svg`,
a 802 × 802 jaguar — and the upload path refused it: `MerchantBrandingLogoUpload`
accepted only `image/png` and `image/jpeg`, and `matchesDeclaredType` checked PNG
and JPEG magic bytes.

### SVG uploads, end to end

- The contract accepts `image/svg+xml` at the edge only. What is stored stays
  PNG/JPEG, so every reader (receipt, wallet passes, dashboard) keeps its size
  and content-type guarantees.
- The service refuses anything that calls itself SVG without an `<svg>` root in
  the first kilobyte — an HTML error page, a renamed JPEG — before sharp sees it.
- Vector input is rendered at `density: 300` and then fitted inside 768 px, the
  same ceiling as every other upload; an 802-unit viewBox becomes a crisp
  768 × 768 PNG (101 469 bytes for ONCA's mark).
- Covered by `rasterises an uploaded SVG and stores a bounded PNG` and
  `refuses something that claims to be SVG but is not`.

Verified on staging: the mark is stored in `merchant_branding_logo`, served at
`https://api-staging.umiconsulting.co/logos/c982abb4-…-219e79403a2f7bc8.png`
(200, `image/png`, 768 × 768), and **ticket 0005 shows the jaguar above ONCA**
on the till.

The dashboard had the same gap one layer up: `LOGO_TYPES` listed only PNG and
JPEG, so the console refused an SVG before a byte left the browser, and the
file input's `accept` attribute hid it from the picker. Both now include
`image/svg+xml`; the console still rasterises on a canvas at 768 px and only
falls back to sending the vector — which the API now renders — when a drawing
taints the canvas and cannot be read back.

Note for whoever repeats the upload: the dashboard route needs
`merchant.manage`, and the staging admin's `merchant.staff` row was bound to a
platform role with `merchant_role_id` empty, so the guard refused it. The row now
points at the merchant's `admin` role.

## 15. Stage 4, started: the requirement is "nobody notices"

The owner's answer to the trust question was a product requirement, not a
security preference: **an outage must be a non-event** — same screens, same
speed, no "sin conexión" workflow for staff to learn. That settles the model:

- **Paired trust, long window.** A device that was paired while online and seen
  recently is served by the hub with no operator step at open. Anything else
  waits for the cloud. A manager re-confirming terminals every morning is
  friction the requirement rules out.
- **Money never goes local.** The hub relays reads and kitchen state. Charges,
  shifts and receipts stay on each device's journal and go to the cloud. That is
  what keeps "nobody notices" from becoming "nobody reconciles".
- **The lane switch is invisible.** No setting, no screen, no prompt.

### What is built

`BoundedApiClient` now has a second lane. When the cloud cannot be reached
_at all_ — connection refused, name not resolving, no route — the same call is
made against `UMIPOS_LAN_HUB` (a compile-time address, e.g.
`http://192.168.1.10:8099`). The lane is used **only** when the request provably
never left the device: the failure is tagged `TRANSPORT_FAILURE_PRE_SEND` at the
point where `_client.send` throws, before any response is read. A timeout or a
connection dropped mid-response is an _unknown outcome_ and stays with the lane
that may have executed it — replaying that against a second server is how one
sale becomes two.

Covered by two tests: a refused primary is served by the hub, and a lost response
never reaches it.

### What is next, in order

1. The hub process itself on the main station: an HTTP server that answers the
   KDS board and command routes from the orders this till fired, with paired-device
   verification (device id + credential hash recorded at pairing, never the
   secret).
2. The peer registry (`network_device`: role, address, port, paired key id, last
   seen) — the plan's original idea, needed by step 1 to know whom to trust.
3. Reconciliation on reconnect: the hub hands its kitchen events to the cloud in
   the same journal order the tills already use.

Until step 1 exists, the lane is wired but has nothing to talk to: a build with
`UMIPOS_LAN_HUB` set will fall back to an address that refuses the connection,
which the client treats exactly like the cloud being down.

## 16. Stage 4 implementation and hardware evidence, 2026-10-17

The write-ownership decision and the LAN node are now implemented together.

### The sale belongs to the till that took the money

- Offline replay commits a plain cash sale at the snapshot totals the customer
  paid.
- The live cart is still checked line by line for product, variant, modifiers,
  quantity, course and note. The replay cannot apply the money to different
  food.
- Device identity, credential hash, sequence, cart version, tender, cash limits,
  catalog age, price age and tax age still gate the sale before commit.
- The server re-price and the signed delta are stored in
  `pos_committed_sale.server_repriced_totals` and
  `pos_committed_sale.divergence_minor_units`.
- The shift close reads the count and signed total of those differences and
  shows them as `Diferencias de precio sin conexión`.

The hardware run changed the Cappuccino price after the cash was taken. Replay
produced:

```text
charged total:       MXN 185.00
server re-price:     MXN 195.00
delta:               -1000 minor units
receipt:             0006
replay result:       pos.checkout.cash · accepted
```

The shift query returned one divergence and `-1000` minor units. The charged
amount, not the server preview, is the committed sale.

### The main station is the kitchen node

- `UMIPOS_LAN_NODE=host` starts a Dart HTTP server on port 4244.
- It serves `/health/live`, `/api/kds/board`, `/api/kds/command`, and the POS
  kitchen board, station and command routes already used by the Flutter client.
- The health response marks itself with `lanNode: true`, so the cloud heartbeat
  cannot mistake a live local node for a live WAN.
- A known cloud outage routes kitchen reads and commands to the LAN first, so a
  KDS tap does not wait for the 15 s cloud timeout.
- `_umi-pos._tcp.local` is advertised by a small responder and discovered with
  `multicast_dns`. The configured `UMIPOS_LAN_HUB` remains the fallback.
- Android holds `CHANGE_WIFI_MULTICAST_STATE` through a native
  `MulticastLock`. The discovery client binds the Wi-Fi interface and does not
  request Android's unsupported `SO_REUSEPORT`.

The iMin served the board over Wi-Fi while the API proxy was stopped:

```text
LAN board:    200 · 0.126 s · 7 tickets
LAN bump:     200 · 0.204 s · completed
```

A unicast DNS query to the iMin answered with PTR, SRV, TXT and A records:

```text
_umi-pos._tcp.local PTR umi-main._umi-pos._tcp.local
umi-main._umi-pos._tcp.local SRV 0 0 4244 umi-main.local
umi-main.local A 192.168.1.10
```

The laptop's Avahi browsing daemon did not receive multicast advertisements on
this access point. The direct URL lane is verified, so discovery failure cannot
orphan the peer. Check client isolation before treating multicast as present.

### Trust, journal and replay

- The first peer contact forwards its device headers to
  `GET /api/v1/devices/status`. A successful answer stores only
  `sha256(credential)` in SQLite `network_devices`.
- Offline, the presented credential hash must match an active peer row for the
  same merchant, location and role. A wrong credential is refused.
- A revoked row is deleted on the next contact. The hardware test received 403
  after revocation, and SQLite held zero rows for that device.
- The local journal records the command as `pos.kds.command`. The journal row
  advances the main station's own device cursor; the cook's operator session and
  device stay in the payload as attribution.
- Replay rechecks that the acting device is still active. An active KDS device
  carries its provisioned kitchen permission set, so the main station operator
  does not need the cook's role.
- A repeated command identity is idempotent. A cloud refusal becomes a recorded
  recovery-centre conflict.
- The hub records the peer clock offset on each request that carries
  `x-umi-client-time`. It does not use that offset to reorder commands.

### Remaining pilot boundaries

- LAN v1 is the kitchen surface. Catalogue, cart and checkout reads keep their
  cloud path and the existing journal.
- The main station process must be running. A force-stopped host has no node.
- A locked till still needs the API to verify an operator PIN. The unlocked,
  already-authenticated till is the verified offline path.
- DNS-SD is best effort. Keep the reserved hub URL configured so a router reboot
  cannot orphan a peer.

### Final verification

```text
API tests:       2033 passed · 29 skipped
Flutter tests:   1042 passed
Dashboard tests: 372 passed
Flutter analyze: clean
Contract check:  2.39.0 · generated files current
```

Staging runs API image `local-lan-node-fix3` with migration `044` applied twice.

## 17. Final local-first fixes and the current hardware boundary, 2026-10-18

This run used the existing café Wi-Fi, not the TP-Link router. It proves the
application and staging path. The final isolated network acceptance remains a
separate migration step.

### Cold start and new accounts

- The install-scoped compatibility proof now survives an APK replacement.
- A recent server-issued entry snapshot can also prove that this enrolled till
  may open while the API is absent. Device trust and the encrypted journal stay
  in secure storage.
- An offline reopen keeps a valid operator session for up to 12 hours. The
  server-issued operator expiry, device id, tenant and branch still must match.
- `Nueva cuenta` parks the current account in the journal when the API is down.
  It no longer waits for a save call that cannot land.

### Kitchen routing and replay

- A proxy response of 502, 503 or 504 means that the API did not run. Kitchen
  requests may use the LAN lane for that answer. Non-kitchen writes never move
  to the LAN lane on a 5xx answer.
- A locally fired ticket is placed before the cached server backlog. A cook can
  see the new work without scrolling through yesterday's tickets.
- Replay resolves a provisional cart id through the accepted
  `pos.cart.open` ledger. The kitchen order then loads by its official cart
  reference.
- A conflict now shows a safe guidance code, including the kitchen refusal code.
  The recovery centre has a retry control for a refused KDS command.
- Migration `045` grants the API role only the conflict columns that replay
  updates: observation time, classification, guidance, blocking state and
  acknowledgement state.

Hardware evidence on the iMin and A11:

```text
iMin cold offline launch:        opened with Admin ONCA
new account while offline:       no operator-visible failure
local cart fire:                 3 journal commands
A11 KDS board over LAN:          available during the outage
A11 KDS start command:           local overlay moved to in_preparation
main station peer heartbeat:     192.168.1.11 · active
```

The first hardware replay exposed two defects:

1. The server tried the provisional cart id as a kitchen order id.
2. The API role could not update an existing replay conflict.

Both fixes are in source and unit tests. The existing hardware journal conflict
still needs one retry against API image `local-lan-contract-2.39.3`. This is
the remaining KDS replay acceptance item.

### Verification

```text
API tests:       2036 passed · 29 skipped
Flutter tests:   1049 passed
Flutter analyze: clean
API typecheck:   clean
git diff check:  clean
```

Staging runs `local-lan-contract-2.39.3`. Migrations `044` and `045` each ran
twice with `psql`. The service health still reports schema label
`build-v3-79`; align the staging migration label before production cutover.

## 17. Pilot network rebuilt, 2026-10-17

The TP-Link Archer C50 v6 that Parrot shipped with the iMin was factory-reset
and rebuilt as the UmiPOS service network. The old network could not be joined:

- The AP advertised `WPA2-PSK+SAE` under `Parrot POS`, and the label passphrase
  failed with `SAE: Confirm mismatch`, so the installer had changed the key.
- Two coordinated WPS push-button attempts produced `WPS-PBC-ACTIVE` on the
  client but no WPS frames from the router; the label WPS PIN failed with
  `WPS-FAIL msg=8`.
- The admin UI was not reachable from the WAN side; every management port was
  filtered at `192.168.1.120`.

The reset restored the label defaults, which let the quick-setup wizard run over
a headless browser. The resulting network:

| Setting             | Value                                |
| ------------------- | ------------------------------------ |
| SSID                | `UmiPOS` / `UmiPOS-5G`               |
| Security            | WPA2-PSK AES (WPA3 off)              |
| Gateway / subnet    | `192.168.0.1` / `192.168.0.0/24`     |
| DHCP pool           | `.100`–`.249`                        |
| iMin D3 reservation | `D0-C8-57-4A-11-6D` → `192.168.0.10` |
| WPS                 | Off                                  |

Evidence gathered from the new network:

- Laptop joined `UmiPOS` and received `192.168.0.100`.
- `https://api-staging.umiconsulting.co/health` answered
  `{"status":"ok","state":"Healthy","db":true,"redis":true}`.
- The iMin D3 was reachable over ADB at `192.168.1.10:5555` before the switch
  and accepted a remote `cmd wifi connect-network UmiPOS wpa2 …`. It dropped
  from the venue network but did not associate with UmiPOS, so it needs a
  manual join (or USB ADB) and device-MAC selection before the `.10`
  reservation can be verified.

The LAN address stays `192.168.0.1`: this firmware does not expose a commit
control for the LAN IP field, and pushing it through the encrypted
`?code=2&asyn=1` transport is not worth the risk for a pilot LAN. The peer
fallback is therefore `http://192.168.0.10:4244`; mDNS remains the primary
resolver.

Artifacts after the network change:

| Build | Artifact                                | SHA-256                                                            |
| ----- | --------------------------------------- | ------------------------------------------------------------------ |
| Host  | `app-staging-lan-host.apk`              | `b61de9d04ce70587f193dabd3b9730223891a90ca30cf95aad7025583af8e1f3` |
| Peer  | `app-staging-lan-peer-192.168.0.10.apk` | `149bace4d5972c608e3c24dd2ea904f1c1bf92baf4a8f6e1f8fc59dc526b8454` |

The peer was rebuilt with `--dart-define=UMIPOS_LAN_HUB=http://192.168.0.10:4244`
on commit `3654bd905cbeb957adde115d842f4fb53f512539`; the host build did not
change because it only sets `UMIPOS_LAN_NODE=host`.

The iMin rejoined UmiPOS with its device MAC and took the reservation:

```text
192.168.0.10  d0:c8:57:4a:11:6d  (Imin Technology)  rtt 3–39 ms
GET  /health/live  -> 200 {"status":"ok","lanNode":true,...}
POST /api/kds/board (no credentials) -> 401 AUTHENTICATION_REQUIRED
```

ADB over Wi-Fi is closed again on the tablet (`5555` refused; only `4244` is
open), so reinstalling the host build needs wireless debugging re-enabled or a
USB cable. The running host build already serves the LAN node.

### LAN lane across a cloud outage

The LAN lane was exercised with the staging API stopped, not simulated:

1. `docker stop umi-api-test-api-1`; `https://api-staging.umiconsulting.co/health`
   answered `502`.
2. The A11 was cold-started. It opened the POS on cached catalog data and showed
   the offline indicator.
3. Opening KDS loaded a board (tickets, item states, `Listo`) with the
   `Conexión inestable` banner. The payload came from `192.168.0.10:4244`, not
   from the cloud.
4. The API was restarted and returned to `Healthy`.

The A11 had lost its session after the reinstall, so the `Cocina ONCA` operator
was unlocked with a known staging PIN. The material was generated with the
API's own verifier (`scrypt(pin, salt, 64)` plus
`HMAC-SHA256(JWT_SECRET, "umi-pos-pin:<merchant>:<pin>")`) inside the staging
API container; the PIN value lives in the pilot credential sheet, not here.
`merchant.device.pin_failed_attempts` was cleared for the three pilot devices
after the two rejected attempts.

## 17. Clean build 157 proof and final build 161 fixes, 2026-10-18

See [the hardware report](../reports/2026-10-18-offline-kds-flow.md).

Build 157 proved the complete local flow with the API stopped: fire, KDS
start/ready/complete, offline seating and `served`. Replay accepted all nine
commands, ending at cursor 9 with zero open conflicts. The run also exercised
the 04:00 operational-day boundary and measured 154 ms for the iMin fire and
117–130 ms for the three A9 KDS actions.

Builds 158–161 then removed the post-seating red banner, moved the header count
to the encrypted journal, and labelled a working LAN-only KDS as **Modo local**.
Build 160 verified the clean offline seating; build 161 verified the local-mode
badge and left both reachable devices logged in on an empty baseline.

The A11 later completed the portable case on build 161: it seated Mesa 4 and
marked it `served` with the API stopped, then replayed four commands with zero
conflicts. The iMin currently holds the only `Admin ONCA` session; the A11 is
left at PIN until a dedicated portable or waiter operator is created. The exact
staging state, artifact hashes and backups are in the report above.
