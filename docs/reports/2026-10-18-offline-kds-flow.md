# Offline-first clean run and hardware proof — 18 October 2026

## Result

Build 157 ran the complete local flow on the real iMin and A9 while the
staging API was stopped. Build 161 later completed the portable-POS case on the
A11:

1. The iMin created and fired an order.
2. The A9 received it in **Hoy**, started it, marked the item ready and
   completed it.
3. The iMin seated Mesa 3 and marked it **Servido** with the API down.
4. The A11 seated Mesa 4 and marked it **Servido** with the API down.
5. Reconnecting the API replayed all iMin and A11 commands in order.
6. Staging finished with **zero open conflicts**.

The 04:00 operational-day boundary, KDS acknowledgement latency, the offline
table journal, the true journal count, the local-mode badge and the
post-seating error banner were all exercised in this run.

## Devices and builds

| Device | Role | Final build |
| --- | --- | --- |
| iMin D3, `192.168.0.10` | Main station / LAN host | 161 |
| Galaxy A9, `192.168.0.102` | KDS | 161 |
| Galaxy A11, `192.168.0.101` | Portable POS | 161 |

The router is the `UmiPOS` TP-Link network. The iMin local node answered:

```json
{"status":"ok","state":"Healthy","lanNode":true}
```

## Replay proof

The clean staging lane accepted every command:

| Sequence | Command | Result |
| --- | --- | --- |
| 1 | `pos.cart.open` | accepted |
| 2 | `pos.cart.line.add` | accepted |
| 3 | `pos.cart.fire` | accepted |
| 4 | `pos.kds.command` / `start_preparation` | accepted |
| 5 | `pos.kds.command` / `mark_item_ready` | accepted |
| 6 | `pos.kds.command` / `complete` | accepted |
| 7 | `pos.table.command` / `seat` | accepted |
| 8 | `pos.cart.table.set` | accepted |
| 9 | `pos.table.command` / `served` | accepted |

Final ledger state:

| Check | Result |
| --- | --- |
| Replay cursor | `9` |
| Accepted commands | `9` |
| Open conflicts | `0` |
| Mesa 3 | `served`, party size `2` |

The table commands are encrypted in the same device-order journal as the cart
and KDS commands. Replay calls the existing table service, using the same
permission, idempotency, audit and room rules as the live route.

### A11 portable-POS replay

The A11 used its own journal while the API was stopped:

| Sequence | Command | Result |
| --- | --- | --- |
| 1 | `pos.table.command` / `seat` | accepted |
| 2 | `pos.cart.open` | accepted |
| 3 | `pos.cart.table.set` | accepted |
| 4 | `pos.table.command` / `served` | accepted |

The A11 finished with zero open conflicts and Mesa 4 `served` for two guests.

## Latency

Measured by `TapLatencyProbe` on the profile builds:

| Action | Tap to paint | Frame build | Frame raster |
| --- | ---: | ---: | ---: |
| Product add, iMin | **155 ms** | 19 ms | 29 ms |
| Fire to kitchen, iMin | **154 ms** | 4 ms | 31 ms |
| Start preparation, A9 | **130 ms** | 4 ms | 3 ms |
| Item ready, A9 | **117 ms** | 5 ms | 2 ms |
| Complete ticket, A9 | **118 ms** | 3 ms | 2 ms |
| Seat party dialog, iMin | **204 ms** | 1 ms | 22 ms |
| Mark served, iMin | **145 ms** | 11 ms | 17 ms |

No action waited on an API response. The fire tap was `154 ms`; the old
fire-to-KDS ready interaction showed a multi-second spinner before the local
projection.

## Defects corrected

- **Late-night business date.** A cart opened at 03:00 now uses the operational
  day that began at 04:00 the previous morning. The offline ticket landed in
  KDS **Hoy (1)** instead of being hidden under **Todos**.
- **Offline table commands.** Seat, move, merge, split, clear, open, ordered,
  served and awaiting-payment now have a local cache, an optimistic projection
  and an encrypted `pos.table.command` journal entry.
- **KDS acknowledgement latency.** Start, item-ready and complete paint the new
  ticket state before the LAN/cloud reply. A refusal still refreshes the board.
- **False error after seating.** A failed cloud refresh after a successful local
  seating no longer replaces the room action with a red failure banner.
- **Header count.** The top badge counts the encrypted journal, including table
  and KDS work, instead of only the in-memory cart queue.
- **KDS connectivity label.** A working local board now says **Modo local**
  while the cloud is unavailable, rather than telling the cook the station is
  disconnected.

## Final clean state

After the proof, staging was returned to a clean baseline:

| Check | Result |
| --- | --- |
| Active carts | `0` |
| Active table visits | `0` |
| Replay commands | `0` |
| Device replay cursor | `0` |
| API | healthy on `offline-table-2.40` |
| iMin | logged in, empty cart |
| A9 | logged in, KDS empty |
| A11 | build 161, logged out and idle |

The temporary iMin Admin ONCA PIN for this round is `0493`. The original staff
row is backed up at
`/home/juan/umi-reset-backups/2026-10-18-b158/admin-staff.sql` on the staging
host. Cocina remains on the temporary test PIN `5555`.

## Portable operator session

The A11 was verified on build 161 at wireless-debug port `41693`. Its backup is
at `/home/juan/umi-reset-backups/2026-10-18-a11/`.

Staging has one `Admin ONCA` operator row. The platform permits that operator on
one POS at a time, so the iMin now holds the session and the A11 is left at its
PIN screen. A dedicated portable or waiter operator is the clean way to keep
both POS devices signed in simultaneously.

## Artifacts

| Artifact | SHA-256 |
| --- | --- |
| `app-staging-lan-host-b161.apk` | `59917021ccf681a297a7fa589464549dccf260a0adec6ded7082a02be94526c5` |
| `app-staging-lan-peer-192.168.0.10-b161.apk` | `1d16e59d8f4f8ed476d5731334110a04a7882d104109465680aa7d4b57ad5af0` |
| API image | `ghcr.io/umiconsulting/umi-api:offline-table-2.40` |
| Contract | `2.40.0` |
| Forward migration | `046_offline_table_commands.sql` |

The API image was built from dirty commit
`3654bd905cbeb957adde115d842f4fb53f512539` and loaded into the staging host;
it is not yet a CI-published GHCR artifact.

## Verification

- Full Flutter suite: **1056 passed**.
- Full API suite: **2040 passed**, 29 skipped.
- `flutter analyze`: no issues.
- API TypeScript typecheck: passed.
- Focused contract, migration, local-table, KDS and cart tests: passed.

## Evidence

Screenshots are in
[`evidence/2026-10-18-offline-clean-v2`](evidence/2026-10-18-offline-clean-v2/):

- `01-imin-fire-offline.png`
- `02-kds-hoy-received.png`
- `03-kds-started.png`
- `04-kds-ready.png`
- `05-kds-complete.png`
- `06-table-seated-offline.png`
- `07-table-served-offline.png`
- `08-seat-without-error-banner.png`
- `09-kds-local-mode.png`
- `10-final-imin-baseline.png`
- `11-final-kds-baseline.png`
- `12-a11-clean-table-map.png`
- `13-a11-seated-offline.png`
- `14-a11-occupied-local.png`
- `15-a11-served-offline.png`
- `16-a11-clean-baseline.png`
