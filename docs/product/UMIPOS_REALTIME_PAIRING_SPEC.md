# UmiPOS Realtime Pairing Push Specification

Status: Approved for implementation  
Owner: UMI Platform and UmiPOS  
Last updated: 2026-09-01

## 1. Purpose

This specification defines the realtime push channel for device pairing approval. The channel tells a waiting UmiPOS device that its pairing state changed. The channel does not deliver the device credential. It does not replace the enrollment protocol.

## 2. Scope

This specification covers:

- The Socket.IO namespace `/rt` on the UMI API.
- The pairing nudge event `device.pairing.changed`.
- The socket handshake for a device that waits for approval.
- The UmiPOS client subscription and its polling fallback.
- The contract model for the event payload.

This specification does not cover:

- Device presence for the Dashboard devices screen (a later phase).
- KDS or UmiCash realtime channels (later phases).
- Order event push (a later phase).
- Multi-instance fan-out. See the scaling gate in section 11.

## 3. Authority

- `docs/product/UMIPOS_DEVICE_ENROLLMENT_SPEC.md` owns the pairing state machine, the credential rules, and the HTTP endpoints. This specification does not change them.
- This specification owns only the realtime transport for pairing state changes.
- `docs/research/2026-09-01-realtime-sockets-device-connection.md` records the transport decision basis (documented facts and source-backed tradeoffs).
- `runtime.device_enrollment_request` and `runtime.device_pairing_session` stay the only stores of pairing truth. The socket layer stores no state.

## 4. Canonical terms

### 4.1 Realtime namespace

The Socket.IO namespace `/rt` on the UMI API. The contract exports the name as `REALTIME_NAMESPACE`.

### 4.2 Pairing nudge

The event `device.pairing.changed`. It tells the device that the pairing state changed. The device must then call the poll endpoint one time. The contract exports the name as `REALTIME_EVENT_PAIRING_CHANGED`.

### 4.3 Handshake triplet

The three values in the socket handshake `auth` payload: `pairingSessionId`, `pollingCredential`, and `installationId`. They are the same values that the poll endpoint validates.

### 4.4 Pairing room

The Socket.IO room `pairing:{pairingSessionId}`. A validated socket joins only its own pairing room. The server emits the nudge only to this room.

## 5. Why the nudge does not carry the credential

The poll transition is the single credential-delivery gate:

- `DevicesRepository.pollPairing` moves the request from `credential_ready` to `credential_delivered` inside one database transaction.
- `DevicesService.poll` returns the plaintext credential only in that transition.
- The same transaction stamps `credential_delivered_at` and counts the poll attempt.

A credential inside a socket frame would create a second delivery gate. That change would move a security boundary. The nudge avoids this. The nudge carries only the session id, the new state, and a timestamp.

## 6. Sequence

1. UmiPOS claims a setup code and receives a pairing session (unchanged).
2. UmiPOS starts the poll loop (unchanged) and connects to `/rt` with the handshake triplet.
3. The API validates the triplet with a read-only lookup and joins the socket to its pairing room.
4. An administrator approves or denies the request on the Dashboard (unchanged).
5. The API commits the decision, then emits `device.pairing.changed` to the pairing room.
6. UmiPOS receives the nudge and calls the poll endpoint one time.
7. The poll response delivers the credential (unchanged). UmiPOS acknowledges (unchanged).
8. If the socket is not connected, the poll loop delivers the same result at the poll cadence.

## 7. Requirements

### 7.1 Handshake validation

- The API must validate the handshake triplet before any event flows.
- The API must compare `sha256(pollingCredential)` with `polling_credential_hash` and `sha256(installationId)` with `installation_hash`.
- The validation must be read-only. It must not increment `polling_attempts`. It must not change any state.
- The API must reject the handshake when the triplet does not match, when the session expired, or when `polling_attempts` is 240 or more.
- The rejection must have a constant shape. It must not tell the caller which value failed.
- The API must rate-limit handshake attempts per IP address.

### 7.2 Emit rules

- The API must emit the nudge only after the database COMMIT of the decision.
- The API must emit the nudge only to the pairing room of the affected session.
- The nudge payload must contain only `pairingSessionId`, `state`, and `occurredAt`.
- The nudge payload must not contain a device object, a credential, or a setup code.

### 7.3 Client rules

- UmiPOS must keep the poll loop as the authoritative path.
- On a nudge, UmiPOS must call the poll endpoint one time and process the response with the same logic as the poll loop.
- UmiPOS must ignore a nudge for a cancelled or superseded pairing attempt.
- A socket connection failure or a socket error must not change the poll loop behavior.
- A build flag must gate the socket path. With the flag off, UmiPOS behavior is identical to today.

### 7.4 Process and CORS rules

- Only the API process serves the `/rt` namespace. The worker process must not open a socket server.
- The gateway must apply the `CORS_ORIGINS` allowlist. A wildcard origin stays forbidden in deployed environments.

## 8. API

### 8.1 Namespace and event

| Item           | Value                                                     |
| -------------- | --------------------------------------------------------- |
| Namespace      | `/rt`                                                     |
| Event          | `device.pairing.changed`                                  |
| Room           | `pairing:{pairingSessionId}`                              |
| Handshake auth | `{ pairingSessionId, pollingCredential, installationId }` |

### 8.2 Contract requirements

- The event payload model is `DevicePairingRealtimeEvent` in `packages/contract/src/realtime.ts`:
  - `pairingSessionId`: UUID.
  - `state`: the same state enumeration as `DevicePairingPollResponse.state`.
  - `occurredAt`: ISO timestamp.
- The contract exports `REALTIME_NAMESPACE` and `REALTIME_EVENT_PAIRING_CHANGED` as constants.
- The TypeScript and Dart SDKs must be generated. Do not create handwritten event models in Flutter.
- The event does not enter `ROUTE_TABLE`. The route table describes HTTP routes only.
- `CONTRACT_VERSION` moves to `2.14.0`.

## 9. Acceptance criteria

1. The contract exports `DevicePairingRealtimeEvent`, `REALTIME_NAMESPACE`, and `REALTIME_EVENT_PAIRING_CHANGED`, and `pnpm --filter @umi/contract generate:check` passes.
2. A socket connects to `/rt` when the handshake triplet is valid.
3. The API rejects the handshake with a constant shape when the session id, the credential hash, or the installation hash does not match.
4. The API rejects the handshake when the session expired or `polling_attempts` is 240 or more.
5. Handshake validation does not increment `polling_attempts` and does not change any request or session state.
6. The API rate-limits handshake attempts per IP address.
7. On approve, the API emits exactly one `device.pairing.changed` to the pairing room after COMMIT, with only `pairingSessionId`, `state`, and `occurredAt`.
8. On deny, the API emits the same event with the denied state.
9. A socket receives only events for its own pairing session.
10. On a nudge, UmiPOS calls the poll endpoint one time and follows the existing response logic. The credential persists exactly one time.
11. With the socket path failed or the build flag off, the UmiPOS poll loop behavior is identical to the current baseline.
12. `cancelPairing`, `retryPairing`, a new `enroll`, and controller disposal each cancel the active socket subscription.
13. The device credential plaintext appears in no socket frame, no log line, and no telemetry event.
14. The worker process opens no socket server.
15. An exception in a socket handler does not reach the HTTP response writer of `AllExceptionsFilter`.
16. The UmiPOS test suite passes with the socket client absent.

## 10. Required tests

UMI API:

- Unit: the events service emits to subscribers.
- Unit: the gateway accepts a valid triplet and rejects each invalid triplet variant with a constant shape.
- Unit: `approve` and `deny` emit one event; `poll` and `acknowledge` emit no event.
- Unit: the emitted payload never contains the credential (secret-leak assertion).
- Unit: `AllExceptionsFilter` ignores non-HTTP hosts; `CsrfGuard` passes non-HTTP contexts.
- Integration (real PostgreSQL): the read-only handshake lookup returns the session for a valid triplet, returns null for a wrong installation hash, and leaves `polling_attempts` unchanged.

Contract:

- `generate:check` in CI and the checksum gate in `scripts/check-pr.mjs`.
- The pinned contract version test in `apps/umi-pos/test/contract_and_widget_test.dart`.

UmiPOS:

- A nudge leads to one poll call and one acknowledgement.
- A stream error keeps the poll loop running to completion.
- Cancel during a socket wait stops both the loop and the subscription.
- With the flag off, the gateway never subscribes.

## 11. Delivery plan

### 11.1 Contract

1. Add `src/realtime.ts` with the model, the constants, and the `realtimeModels` barrel.
2. Register the barrel in `modelCatalog` and bump `CONTRACT_VERSION`.
3. Regenerate the TypeScript and Dart SDKs.
4. Run the deterministic contract drift validation.

### 11.2 UMI API

1. Add the `RealtimeModule` with the events service and the gateway.
2. Add the read-only handshake lookup to `DevicesRepository`.
3. Emit from `DevicesService.approve` and `DevicesService.deny` after the repository returns.
4. Guard `AllExceptionsFilter` and `CsrfGuard` for non-HTTP contexts.
5. Register the module in `app.module.ts` only.

### 11.3 UmiPOS

1. Add the pairing socket client with the conditional-import pattern.
2. Add `watchPairing` to `EntryGateway` and implement it in `ApiEntryGateway`.
3. Converge the poll loop and the nudge on one response handler in `EntryController`.
4. Gate the socket path with `UMIPOS_REALTIME_ENROLLMENT_ENABLED`.

### 11.4 Rollout

1. Enable the flag for pilot builds.
2. After staging validation, raise `pollAfterSeconds` from 2 to 10. The poll becomes the fallback cadence.

### 11.5 Scaling gate

Before the platform runs more than one UMI API replica, add `@socket.io/redis-adapter` with two `ioredis` clients built from the `REDIS_URL` options parser. Do not scale the API horizontally before this gate closes.

## 12. Completion rule

Mark this feature complete only after all section 9 criteria pass. Do not remove the polling loop. Do not raise `pollAfterSeconds` before the staging validation passes. Keep one controlled compatibility window for deployed clients that do not have the socket build.

## 13. Implementation references

- `apps/umi-api/src/modules/realtime/`
- `apps/umi-api/src/modules/devices/devices.service.ts`
- `apps/umi-api/src/modules/devices/devices.repository.ts`
- `packages/contract/src/realtime.ts`
- `apps/umi-pos/lib/features/entry/entry_controller.dart`
- `apps/umi-pos/lib/features/entry/entry_gateway.dart`
- `apps/umi-pos/lib/features/entry/pairing_socket_client.dart`
