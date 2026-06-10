# KDS Device Revocation Implementation Plan

Created: 2026-05-23

## Goal

Implement dashboard-driven KDS device revocation.

When an owner removes a paired KDS device from the dashboard, the action should revoke that iPad's durable device session. The iPad must stop being authorized on the next backend interaction, clear its local paired credential, and return to the pairing/reactivation screen.

This is not a visual-only dashboard delete. It is an access-control operation.

## Decision

Dashboard device removal means **revoke device access**.

Expected behavior:

- Dashboard marks the device session inactive and records revocation audit fields.
- KDS command and read contracts reject inactive or unknown device tokens.
- A currently open iPad stops after the next command, snapshot fetch, event poll, or explicit session check.
- An offline iPad stops when it comes back online.
- The iPad clears its Keychain credential and shows first-pairing again.
- Reactivation requires a new dashboard-generated PIN and admin approval.

Optional future behavior:

- A separate `Archive` action may hide stale offline records after revocation, but archive must not be the same thing as revoke.

## Ownership

| Area | Owner | Reason |
|---|---|---|
| Revocation schema and token verification | `apps/umi-conversaflow` | Owns KDS backend contracts, Supabase functions, and schema-qualified `kds` migrations. |
| Dashboard remove/revoke UX | `apps/umi-dashboard` | Owns owner dashboard device screen and admin interactions. |
| iPad revoked-session UX | `apps/umi-kds` | Owns SwiftUI client behavior, Keychain credential storage, and pairing screen. |
| Architecture plan | root `docs/architecture` | Cross-product behavior decision across dashboard, backend, and native client. |

No new repo or service is needed. Existing KDS command/pairing edge functions and `kds.device_sessions` are the narrowest current owners.

## Current Context

### Current Dashboard Behavior

- The device grid reads active rows from `kds.device_sessions`.
- The remove action in `apps/umi-dashboard/src/screens/devices.jsx` calls `updateDevice(device.id, { is_active: false })`.
- `apps/umi-dashboard/server.js` applies that patch to `kds.device_sessions.is_active`.
- The dashboard currently frames the action as removal, but the backend primitive already resembles revocation.

### Current Backend Behavior

- `apps/umi-conversaflow/supabase/migrations/20260512200000_kds_device_sessions.sql` created `kds.device_sessions`.
- The deployed `kds.verify_device_token(p_token text)` only returns a session when `is_active = true`.
- `apps/umi-conversaflow/supabase/functions/kds-command/index.ts` still accepts the project anon key and does not yet require a device token.
- `apps/umi-conversaflow/supabase/functions/kds-pairing/index.ts` already mints durable device tokens during approved pairing.

### Current KDS iPad Behavior

- `apps/umi-kds/Sources/Data/DevicePairingStore.swift` stores the paired device credential in Keychain.
- `AppEnvironment.resetPairing()` already deletes the Keychain credential and returns the app to an unpaired state.
- `KDSAPIClient` sends only the Supabase anon key on reads and commands.
- `OrderRepository` treats polling and snapshot errors as recoverable connection errors. It does not yet distinguish revoked credentials from temporary transport failures.

## Decision Basis

### Documented Facts

- NIST SP 800-63B defines authenticator invalidation as removing the binding between the authenticator and the account, and says authenticators should be promptly invalidated when requested or compromised.
- NIST SP 800-63B also recommends clear user communication around intermittent events such as revocation, expiration, and reauthentication.
- RFC 7009 defines token revocation as invalidating the token and, when applicable, related tokens or grants. It says invalidation should take effect immediately, while acknowledging small propagation windows in distributed systems.
- Supabase Edge Functions can validate JWTs before code runs, but business authorization still belongs in function/database logic.
- Supabase Realtime authorization is calculated when a channel is joined. A long-lived connection should not be the only revocation enforcement point.
- iOS Keychain items can be deleted with `SecItemDelete`, which the KDS app already wraps in `DevicePairingStore.delete()`.

Primary references:

- NIST SP 800-63B: https://pages.nist.gov/800-63-4/sp800-63b.html
- RFC 7009, OAuth 2.0 Token Revocation: https://www.rfc-editor.org/rfc/rfc7009
- Supabase Edge Function auth: https://supabase.com/docs/guides/functions/auth
- Supabase Realtime authorization: https://supabase.com/docs/guides/realtime/authorization
- Apple Keychain update/delete guidance: https://developer.apple.com/documentation/security/updating-and-deleting-keychain-items

### Source-Backed Tradeoff

Use server-side durable device sessions rather than relying on the project anon key, a local heartbeat, or a long-lived client connection.

- Server-side session lookup gives immediate revocation semantics because each protected operation checks current `kds.device_sessions` state.
- JWT-only or anon-key-only authorization cannot revoke one iPad without rotating shared project credentials.
- Heartbeats are useful for liveness display, but they are not authorization.
- A persistent socket, if introduced later, still needs a server-side revocation check on reconnect and a way to close or reject stale sessions.

### Umi-Specific Inference

- The existing pairing model already produces a durable per-device token; revocation should complete that model instead of introducing another identity mechanism.
- `kds.device_sessions.is_active = false` should be treated as the canonical revoked state for v1.
- The dashboard can continue using its API layer for admin UX, but durable KDS command/read enforcement belongs in `umi-conversaflow`.
- The iPad should fail closed for explicit `device_revoked` errors, but should keep retrying for ordinary network failures.

## Target Contract

### Device Token Transport

KDS runtime requests should include the durable device token returned by pairing.

Recommended request shape:

- Header: `X-KDS-Device-Token: <plaintext-device-token>`
- Keep Supabase anon key or configured publishable key as the transport/project key where the current platform requires it.
- Do not put the device token in query strings.
- Do not log the plaintext token.

### Protected KDS Runtime Surfaces

Protect these surfaces with device-token verification:

| Surface | Current path | Required behavior |
|---|---|---|
| Commands | `kds-command` edge function | Require active device token before `transition_ticket` and `partial_cancel_items`. |
| Snapshot reads | `get_board_snapshot` through PostgREST today | Move behind a device-aware backend function or add a narrow edge-function read endpoint. |
| Event polling | `get_ticket_events` through PostgREST today | Move behind the same device-aware read endpoint or require a verified device read contract. |
| Heartbeat | dashboard local `/api/kds/heartbeat` today | Keep as liveness only; optionally reject revoked device IDs once backend check is available. |

For v1, commands must be enforced first because they mutate operational state. Reads should be enforced before treating revocation as complete.

### Revocation Response

All protected KDS runtime surfaces should return the same machine-readable error for revoked, inactive, missing, or unknown device credentials:

```json
{
  "error": "device_revoked",
  "message": "This KDS device has been removed. Pair it again from the dashboard."
}
```

HTTP status:

- `401` when the token is missing or malformed.
- `403` when the token is syntactically valid but inactive/revoked.

The iPad should treat both as terminal for the local credential.

## Schema Changes

Add revocation audit fields to `kds.device_sessions`.

```sql
ALTER TABLE kds.device_sessions
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid,
  ADD COLUMN IF NOT EXISTS revocation_reason text;

CREATE INDEX IF NOT EXISTS kds_device_sessions_revoked_idx
  ON kds.device_sessions (tenant_id, location_id, revoked_at DESC)
  WHERE is_active = false;
```

Notes:

- If the legacy non-platform path still exists, add equivalent fields using `business_id` scope or keep the migration platform-only and document the legacy path as unsupported for revocation hardening.
- If `revoked_by` references `platform.users(id)`, use `ON DELETE SET NULL`.
- Keep `is_active` as the fast enforcement field. `revoked_at` is audit context, not the gate.

## Backend Implementation

### 1. Shared Device Verification Helper

Create a shared helper in `apps/umi-conversaflow/supabase/functions/_shared/`:

- Reads `X-KDS-Device-Token`.
- Hashes the plaintext token with SHA-256.
- Calls `kds.verify_device_token` or performs an equivalent service-role query.
- Returns `{ device_id, tenant_id/business_id, location_id, station_id }` for active sessions.
- Throws a typed `device_token_missing` or `device_revoked` error.

The helper must not log the token.

### 2. Harden `kds-command`

Update `apps/umi-conversaflow/supabase/functions/kds-command/index.ts`:

- Require a verified device session before processing any action.
- Ignore client-supplied `actor_id` and `actor_channel` where they conflict with the verified device session.
- Use verified device identity for `p_actor_id` and station/channel metadata.
- Confirm ticket belongs to the verified tenant/business and station scope before mutation, either in SQL RPC guards or in the edge function.
- Return `401/403 device_revoked` for missing/inactive tokens.

### 3. Add Device-Aware KDS Read Endpoint

Current reads go directly through PostgREST RPC with the shared anon key. That cannot revoke one iPad.

Add a narrow backend read contract in `apps/umi-conversaflow`, for example `kds-board`:

Actions:

- `snapshot`
- `events`
- optional `session_status`

Each action:

- Requires `X-KDS-Device-Token`.
- Verifies the active device session.
- Uses verified tenant/business and station scope.
- Calls existing `kds.get_board_snapshot` and `kds.get_ticket_events` internally with service role.
- Returns the same response shape the iPad already decodes.

This keeps the iPad thin and preserves the existing projection/RPC logic.

### 4. Add Admin Revoke Contract

Dashboard can keep using its Node API, but the durable write should be explicit:

Endpoint shape:

`POST /api/tenants/:tenantId/kds/devices/:deviceId/revoke`

Request:

```json
{
  "reason": "removed_from_dashboard"
}
```

Response:

```json
{
  "ok": true,
  "device_id": "uuid",
  "revoked_at": "2026-05-23T00:00:00Z"
}
```

Implementation:

- Update `kds.device_sessions`.
- Set `is_active = false`.
- Set `revoked_at = now()`.
- Set `revoked_by` from dashboard user ID when available.
- Set `revocation_reason`.
- Scope by tenant and selected location.

The existing `PATCH is_active=false` can remain as a compatibility path temporarily, but the UI should call the explicit revoke endpoint.

## Dashboard Implementation

Files:

- `apps/umi-dashboard/src/screens/devices.jsx`
- `apps/umi-dashboard/src/data.jsx`
- `apps/umi-dashboard/server.js` or successor dashboard API layer

Tasks:

1. Rename the action semantics in UI from generic delete/remove to revoke/unpair.
2. Add a confirmation modal or sheet copy:
   - Title: `Revocar dispositivo`
   - Body: `Este iPad se cerrara y tendra que parearse de nuevo con un PIN.`
   - Confirm: `Revocar`
3. Add `revokeDevice(deviceId)` data helper.
4. Add explicit backend route instead of overloading `updateDevice`.
5. Keep revoked devices out of the active device grid.
6. Optionally add a future audit view or filter for revoked devices.

Dashboard should not attempt to notify the iPad directly. Revocation is enforced by backend verification on the next iPad request.

## KDS iPad Implementation

Files:

- `apps/umi-kds/Sources/Data/KDSAPIClient.swift`
- `apps/umi-kds/Sources/Data/OrderRepository.swift`
- `apps/umi-kds/Sources/Data/KDSRealtimeClient.swift`
- `apps/umi-kds/Sources/App/AppEnvironment.swift`
- `apps/umi-kds/Sources/App/AppShellView.swift`
- `apps/umi-kds/Sources/Features/Pairing/PairingView.swift`

Tasks:

1. Include `deviceSession.deviceToken` as `X-KDS-Device-Token` on commands.
2. Move snapshot and event polling calls from direct PostgREST RPC to the device-aware backend read endpoint.
3. Add a typed error case:

```swift
enum KDSDataError: Error {
    case notConfigured
    case invalidResponse
    case transportFailed(Int)
    case deviceRevoked
}
```

4. Decode `401/403` responses with `error == "device_revoked"` as `.deviceRevoked`.
5. Make `OrderRepository.start()`, `transition(...)`, `partialCancelItems(...)`, and `refreshSnapshot()` treat `.deviceRevoked` as terminal.
6. Add an `AppEnvironment.revokeLocalSession()` or reuse `resetPairing()` from the main actor.
7. Show pairing screen after the local session is reset.
8. Show a concise message on `PairingView`, such as `Este iPad fue revocado. Genera un nuevo PIN en el dashboard.`

Network failures should continue to show reconnecting/retry behavior. Only explicit revoked-session errors should clear the credential.

## Rollout Plan

### Phase 1 - Backend Schema And Admin Revoke

- Add revocation audit migration.
- Add explicit dashboard revoke route.
- Keep existing active device list behavior.
- Do not yet claim full enforcement.

Exit criterion:

- Dashboard can revoke a device and the row has `is_active = false`, `revoked_at`, and `revocation_reason`.

### Phase 2 - Command Enforcement

- Add shared device verification helper.
- Update `kds-command` to require active device token.
- Update iPad command requests to send `X-KDS-Device-Token`.
- Preserve pairing flow.

Exit criterion:

- A revoked iPad cannot transition or cancel tickets.

### Phase 3 - Read Enforcement

- Add device-aware KDS board read endpoint.
- Update iPad snapshot and event polling to use it.
- Remove direct PostgREST KDS read usage from the app runtime.

Exit criterion:

- A revoked iPad cannot keep reading board data.

### Phase 4 - iPad Reactivation UX

- Add typed revoked error handling.
- Reset Keychain credential on explicit revoked response.
- Return to pairing screen with a clear message.

Exit criterion:

- Removing a live iPad from the dashboard causes it to leave the board and ask for a new pairing PIN within one poll interval.

### Phase 5 - Cleanup And Documentation

- Update `apps/umi-kds/Sources/Docs/KDSArchitecture.md`.
- Update the KDS pairing plan or mark the runtime-hardening follow-up complete.
- Remove any dashboard-local duplicated pairing/revocation logic that conflicts with canonical backend behavior.
- Add tests and diagnostics described below.

Exit criterion:

- Device pairing, command auth, read auth, and revocation are documented as one coherent lifecycle.

## Validation Plan

### Backend

- Active token verifies successfully.
- Missing token returns `401 device_token_missing`.
- Revoked token returns `403 device_revoked`.
- Revoked token does not update `last_seen_at` / `last_used_at`.
- Commands reject revoked tokens before mutation.
- Snapshot/events reject revoked tokens before returning data.
- Re-pairing creates a new active session and token.

### Dashboard

- Revoke confirmation appears before destructive action.
- Confirming revoke updates the device row and removes it from active grid.
- Revoked device does not reappear because of heartbeat-only liveness.
- Device list still shows correct live/slow/offline states for active devices.

### iPad

- Paired active iPad opens board.
- Revoked iPad receives terminal error and clears Keychain.
- Revoked iPad returns to pairing screen.
- Ordinary network failure does not clear Keychain.
- New PIN pairing restores board access.
- Relaunch after revocation remains unpaired.

### End-To-End Manual Scenario

1. Pair an iPad from dashboard with PIN.
2. Confirm it appears in `Dispositivos KDS`.
3. Open board and verify snapshot/events load.
4. Transition a test ticket.
5. Revoke device from dashboard.
6. Confirm command attempts fail.
7. Confirm board read/polling fails and app returns to pairing.
8. Generate a new PIN and re-pair.
9. Confirm board works again with the new token.

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Direct PostgREST reads remain in the iPad | Revoked device can still view orders | Treat read enforcement as required before shipping revocation as complete. |
| Commands only use anon key | Revoked device can still mutate tickets | Enforce device token in `kds-command` before UI claims revocation. |
| Heartbeat makes revoked device look live | Dashboard confusion | Merge heartbeats only for active devices, or ignore heartbeats for revoked IDs. |
| iPad clears Keychain on temporary outage | Kitchen disruption | Only clear credential on typed `device_revoked`, not generic transport errors. |
| Legacy and platform schemas diverge | Inconsistent behavior | Prefer platform-transition path; document any legacy limitation explicitly. |
| Token appears in logs | Credential leak | Use header transport and redact token-bearing headers/body in logs. |

## Non-Goals

- No remote push notification to force-close the app in v1.
- No new permanent service or repo.
- No Supabase Realtime migration for board data.
- No QR-code pairing change.
- No change to KDS order projection ownership.
- No deletion of historical device audit records.

## Acceptance Criteria

Revocation is complete when all are true:

- Dashboard exposes an explicit revoke/unpair action with confirmation.
- Revoked devices have durable audit fields in `kds.device_sessions`.
- `kds-command` rejects revoked devices.
- KDS board snapshot and event polling reject revoked devices.
- iPad sends its durable device token on protected runtime requests.
- iPad clears its Keychain credential only for explicit revoked-session errors.
- Re-pairing with a new PIN restores access through a new active device session.
