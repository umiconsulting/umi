# UmiPOS KDS Operational Model

## Authority

The UMI API owns the kitchen domain.
The existing SwiftUI iPad KDS is an operational client.
The KDS never changes a commercial or financial fact.

One committed commercial order can create one kitchen order.
The unique source-order constraint prevents a second projection.
A failed checkout creates no kitchen order.

## Kitchen model

The kitchen model contains these main records:

- `merchant.kitchen_order` for the overall preparation state;
- `merchant.kitchen_order_item` for station work;
- `merchant.kitchen_route` for deterministic route rules;
- `merchant.kitchen_command` for command recovery;
- `merchant.kitchen_event` for the ordered event feed;
- `merchant.kitchen_device_station` for device assignment.

The `kds` schema contains safe read views only.

## Product preparation

A product can set `requires_preparation` and a target duration.
An explicit product or category route also marks the matching line as preparation work.
A location default route applies only to products that already require preparation.

The route precedence is:

1. Product route.
2. Category route.
3. Location default route.
4. An explicit `Exception` item when no route exists.

The API saves the selected route in the kitchen order snapshot.
A later route change does not move existing work.

## Stations

A station belongs to one merchant and one location.
A device can use only an assigned active station.
A device heartbeat requires its protected device token.
A station change updates the canonical assignment and its configuration version.
A disabled station gets no new work.
Existing work remains in the historical route snapshot.

One order can contain items for multiple stations.
Each station sees only its own items.
The overall state comes from all item states.

## Lifecycle

The order states are:

- `Queued`;
- `InPreparation`;
- `PartiallyReady`;
- `Ready`;
- `Completed`;
- `Cancelled`;
- `Exception`.

The item states are:

- `Queued`;
- `Preparing`;
- `Ready`;
- `Cancelled`;
- `Exception`.

The API enforces each transition and optimistic version.
A recall can move `Ready` to `InPreparation` with an exact permission and reason.
A terminal state cannot regress through a normal command.

## Timers and priority

The API supplies authoritative timestamps.
The iPad calculates elapsed display time from those timestamps.
Reconnect restores the correct elapsed time without server events each second.

Priority is `Normal`, `High`, or `Urgent`.
The API checks `kitchen.priority` before a change.
Payment type and customer identity never set priority.

## Cancellation, void, and refund

A committed void creates an authoritative kitchen consequence in the same transaction.
The consequence cancels unprepared work and preserves ready work as an exception.
The KDS never removes historical work silently.

A financial refund does not delete kitchen history.
A refund does not create preparation work or an inventory assumption.

## Feed and reconnect

The KDS first reads an exact station snapshot.
It then reads ordered events by sequence.
Each event includes an aggregate version.

The KDS ignores duplicate and stale events.
It fetches a full snapshot after a gap, restart, reassignment, or network loss.
The pilot degraded policy is `READ CACHED / MUTATIONS FAIL CLOSED`.

## Command recovery

Each command binds these values:

- command ID;
- idempotency key;
- correlation ID;
- kitchen order;
- station;
- expected version;
- payload fingerprint.

A retry with the same identity returns the original result.
A changed fingerprint returns `KITCHEN_FINGERPRINT_CONFLICT`.
A stale version returns `KITCHEN_VERSION_CONFLICT`.

## Permissions

The canonical permissions are:

- `kitchen.read`;
- `kitchen.prepare`;
- `kitchen.ready`;
- `kitchen.complete`;
- `kitchen.recall`;
- `kitchen.cancel_ack`;
- `kitchen.priority`;
- `kitchen.station.read`;
- `kitchen.station.manage`;
- `kitchen.diagnostics`;
- `kitchen.merchant.read`.

The API uses permissions, not role names.
Location users must use their assigned location.
Only a principal with `kitchen.merchant.read` can omit the location scope.

## Audit and privacy

The API audits each consequential kitchen command and configuration change.
Audit and event payloads use safe references.

The KDS does not receive:

- payment details;
- wallet or gift-card data;
- customer contact;
- authentication tokens in event data;
- raw database payloads.

## POS and Dashboard visibility

UmiPOS reads a safe kitchen status through the generated Dart SDK route.
The status is read-only in the POS.
Committed sale history shows the localized kitchen status.

The Dashboard can read current orders, stations, status, elapsed time, and diagnostics.
Gate 4A does not add kitchen analytics.

## Optional print foundation

The existing kitchen ticket print contract can use this projection later.
A print failure cannot change kitchen state.
Gate 4A does not require kitchen ticket printing.

## Validation

Run these focused commands:

```sh
pnpm umi-pos:kds-concurrency-check
pnpm --filter @umi/api exec vitest run src/modules/kds src/shared/database/gate-4a-kds-migration.spec.ts
cd apps/umi-pos && flutter test test/kitchen_status_test.dart
```

The concurrency command creates a disposable database.
It runs 10 races through two independent PostgreSQL sessions.
It also runs the real KDS repository against the disposable database.
The repository checks retry recovery, multi-station work, and partial-update safety.
It removes the database after the run.

## Future boundary

The existing iPad KDS is the pilot surface.
Gate 4A does not create a Flutter KDS.
A future client must use the same UMI API authority.
