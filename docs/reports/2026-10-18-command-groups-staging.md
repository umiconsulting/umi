# Command groups on staging

Date: 2026-10-18

## Result

The offline table-account action is now one durable command group.
The group has one command ID, one idempotency key, and one cloud replay step.
The server opens the account and claims the table in one cart transaction.

The server also keeps the provisional cart ID.
A later replay batch can resolve this ID after the group is accepted.
The command no longer depends on which account is active on the device.

A semantic refusal now blocks only its own account stream.
The server keeps a processed cursor beside the accepted cursor.
An unrelated account can continue in the same batch.
A following command on the refused account is recorded as `stream_blocked`.
The history remains visible.

## Implementation

- The contract accepts `pos.command.group`.
- The first effect is `open_table_account`.
- The group carries the account and table aggregate keys.
- The client stores the provisional cart ID in the journal.
- The server rejects a group whose ID does not equal its idempotency key.
- The server maps the provisional cart ID to the official cart ID.
- The client maps the official cart ID before a later command uses it.
- The server derives an account, table, or kitchen stream key from each command.
- A database function writes the conflict and processed cursor in one step.
- The function verifies the merchant, location, and device scope.
- The client returns blocked account steps to the journal after resolution.
- The header shows local saved work, LAN hub reachability, and cloud reachability.
- A LAN health probe runs separately from the cloud heartbeat.
- The main station accepts a peer command group into its own durable journal.
- The hub derives one stable command identity from the peer and group IDs.
- The hub stores the peer device and operator session for attribution.
- A duplicate peer delivery returns the original hub sequence.
- The peer can read the queued, accepted, or conflicted hub state by group ID.
- The hub accepts host-owned cart commands for account-open, add, clear,
  prepare, fire, and fulfillment changes.
- The replay envelope carries peer device and operator origin for audit.
- A new line uses the till's durable provisional line ID as the official line
  ID, so later edits keep one identity through the hub.
- The peer journals shared account commands before it sends them to the hub.
- The peer record is marked `hubOwned`; cloud replay skips that local copy.
- The hub writes a normal host command without the ownership marker.
- The hub serializes intake by account before authentication.
- Independent account lanes do not wait for each other.
- The peer keeps the local record until the hub reports the cloud result.
- A transport failure leaves the local record pending for a later retry.
- A hub conflict remains visible in the recovery centre.
- Peer conflict resolution goes through the host device authority.
- The refused step stays in history, and blocked account steps return to the queue.
- The peer maps the official cart ID from the hub result.
- The command-group key equals `groupId`, as the cloud requires.
- The hub outbox accepts a table move.
- The host KDS sends its own kitchen commands through the local node.
- Peer table-state commands use the hub outbox, lane, and status routes.
- A successful table account open commits the seated room state.
- A local credential-store failure reports storage, not a false network outage.
- Existing user changes remain in the worktree.

Key files:

- `packages/contract/src/pos-offline.ts`
- `apps/umi-api/src/modules/pos-offline/pos-offline.service.ts`
- `apps/umi-api/src/modules/pos-offline/pos-offline.repository.ts`
- `apps/umi-pos/lib/features/cart/cart_command_queue.dart`
- `apps/umi-pos/lib/features/cart/cart_controller.dart`
- `apps/umi-pos/lib/features/kitchen/hub_command_forwarder.dart`
- `apps/umi-pos/lib/features/kitchen/lan_kds_node.dart`
- `docs/migration/build-v3/migrations/049_offline_command_groups.sql`
- `docs/migration/build-v3/migrations/050_offline_account_streams.sql`

## Verification

- API tests: **2,060 passed**, **29 skipped**.
- Flutter tests: **1,099 passed**.
- Flutter analyzer: **no issues**.
- API typecheck: **passed**.
- `git diff --check`: **passed**.
- Focused API tests: **21 passed**.
- Local PostgreSQL replay suite: **8 passed**.
- Focused client queue tests: **10 passed**.
- Hub handoff tests: **6 passed**.
- LAN intake tests: **11 passed**.
- Account sequencing tests: **2 passed**.
- Release diagnostic tests: **4 passed**.

The client tests prove these results:

- An offline table action writes one command group.
- The same action writes no separate cart open command.
- The same action writes no separate table command.
- A later line command uses the official cart ID.

The server tests prove these results:

- The server calls `openTable` once.
- The server keeps the selected party size.
- The server returns the official cart ID.
- The server refuses an invalid multi-effect group.
- A later batch resolves the provisional cart ID.
- A table refusal does not stop another account.
- A same-account follow-up returns `stream_blocked`.
- The processed cursor advances while the accepted cursor does not.

The local PostgreSQL replay tests prove these results:

- Two refused account groups remain independent.
- A third command on one refused account is `stream_blocked`.
- An unrelated acknowledgement still commits.
- Resolution closes the parent and its blocked dependants.
- The conflict write and cursor update commit together.

The client status tests prove these results:

- Hub reachability can be reachable while the cloud is offline.
- The status text names local, LAN, and cloud lanes separately.
- The LAN probe uses the configured hub address.
- A local credential read fails as `storage`, before any network request.

The LAN node tests prove these results:

- A paired peer can submit one table-account group.
- The command enters the host journal once.
- The journal uses the host device sequence and credential.
- The payload keeps the peer device and operator session.
- A duplicate delivery does not add another command.
- The peer can read the hub status of its group.
- A peer cart command enters the host journal with the host as writer.
- The same command keeps the peer device and operator in its origin fields.
- The line command keeps its durable client line ID through the hub.
- The command-group key equals the group ID.
- A peer can read the host status of one cart command.
- A peer table move enters the host journal.
- A peer table-state command enters the host journal.
- The host resolves a peer conflict and advances the account lane.
- The refused command remains in history.

The peer handoff tests prove these results:

- The peer entry reaches the hub once.
- A later status check does not submit it again.
- The hub status closes the local entry with the official ID.
- Same-account commands reach the hub in device order.
- A transport failure preserves the local entry.
- A hub conflict remains visible with its failure.
- A peer conflict uses the hub gateway and not the cloud gateway.
- A peer table command carries the hub-owned marker.

The account sequencing tests prove these results:

- One account keeps its command order.
- Another account proceeds without waiting.
- A refused command releases its account lane.

## Staging database

- Migration: `049_offline_command_groups.sql`
- Migration SHA-256: `f920398c407d35909b7b6e2cd47c3b150b4207421701f986a15cc84b2b0df8ec`
- Migration: `050_offline_account_streams.sql`
- Migration SHA-256: `78db5a3c3e5f17e3c9a98686963e5434d44a64b073fe352fdfc27a7e84ba2b66`
- Both migrations ran twice with no error.
- The database constraint accepts `pos.command.group`.
- A rolled-back probe returned the expected official cart ID.
- A rolled-back probe called the scoped conflict function on staging.
- The probe advanced the processed cursor and left no row after rollback.

## Staging API

- Image: `ghcr.io/umiconsulting/umi-api:offline-hub-peer-2.43`
- Image digest:
  `sha256:b3a805df225dad508951cfb8dc282ba513896e3d49232b45e1e47f08ab4b59b8`
- Release: `0.1.0`
- Git commit: `3654bd905cbeb957adde115d842f4fb53f512539`
- Contract: `2.43.0`
- Health: `Healthy`
- Database schema: `build-v3-79`
- Replay batch and conflict routes return `401` without credentials.
- Environment backup:
  `/home/juan/umi-api-test/.env.bak.peer-handoff-20261019T004943Z`

The direct image transfer was necessary because the local GitHub token does not
have the `write:packages` scope.

## Device artifacts

| Artifact                                                                                | SHA-256                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/umi-pos/build/app/outputs/flutter-apk/app-staging-lan-host-b192.apk`              | `5a1e2931de6952e762edbae55e2d56546885ad3ad7b3ef0bffa524417fffe304` |
| `apps/umi-pos/build/app/outputs/flutter-apk/app-staging-lan-peer-192.168.0.10-b192.apk` | `60a0943d3f9f736ec30a73c7fe06592ce44164abefd75c22e4a25bf039e915c6` |
| `apps/umi-pos/build/app/outputs/flutter-apk/app-staging-lan-host-clean-b192.apk`        | `4dcdcda04cca89834c7bdb1d94e5dd99a4dda9808eeabb56c98e21bbc5f7a15c` |

## Device state

- ADB reaches the iMin at `192.168.0.10:37913`.
- The original `co.umiconsulting.umi_pos.estacion` app data still has a broken secure-store alias.
- The clean test package `co.umiconsulting.umi_pos.clean` preserves the old data.
- Build b192 is installed under the clean package.
- The clean terminal is enrolled to ONCA on staging.
- The operator session reaches the catalog and local hub.
- A Mesa 3 account accepted an Aeropress order.
- The KDS showed the local ticket, started it, marked it ready, and finished it.
- Mesa 3 then showed `Ocupada, 2 personas` with a live timer.
- Enrollment evidence:
  `docs/reports/evidence/2026-10-18-peer-handoff/imin-clean-enrolled.png`
- Catalog evidence:
  `docs/reports/evidence/2026-10-18-peer-handoff/imin-clean-catalog.png`
- Room evidence:
  `docs/reports/evidence/2026-10-18-peer-handoff/imin-mesa-3-occupied.png`
- The iMin is on the `UmiPOS` network at `192.168.0.10`.
- The device reaches staging with 109–190 ms of ICMP latency.
- Chrome on the iMin reaches `/health/release` over TLS.
- TLS evidence:
  `docs/reports/evidence/2026-10-18-peer-handoff/imin-tls-staging-release.png`
- The host build binds TCP port 4244.
- The original package reports `LOCAL_CREDENTIAL_READ_FAILED`.
- No old app data was cleared.
- The A9 and A11 have no current wireless-debug connection.

Restore wireless debugging on the A9 or A11 before the next device run.
Use the API container stop for the outage test.
Do not disable Wi-Fi on a device that uses wireless debugging.

## Remaining work

The peer-to-hub handoff is complete for account, cart and table commands.
The clean iMin package completed the physical order, kitchen, and room path.

The A9 and A11 still have no wireless-debug connection. A separate-device
outage test remains for those two devices.

The original package still needs recovery or re-enrollment before normal use.
Do not clear its data without approval.
