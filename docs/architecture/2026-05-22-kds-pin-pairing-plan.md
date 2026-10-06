# KDS PIN Pairing Plan

Created: 2026-05-22

## Goal

Add first-run KDS pairing with a short random PIN:

- Dashboard: `Dispositivos KDS` gets a clear admin action to generate a one-time pairing PIN.
- KDS iPad app: when no paired device session exists, show a PIN entry board and wait for dashboard/admin approval before opening the board.
- Backend: keep pairing state server-owned, short-lived, rate-limited, and separate from kitchen order truth.

This is a first-pairing flow, not a replacement for the existing KDS order/event contract.

## Decision Basis

### Documented Facts

- RFC 8628, the OAuth 2.0 Device Authorization Grant, is the closest standard pattern for devices with constrained input. It separates a device-facing code from an admin/user approval step, gives the code an expiration, and has the device poll until authorization is approved, denied, or expired.
- RFC 8628 explicitly requires a `user_code`, `expires_in`, and polling `interval`, and recommends that polling waits at least the given interval, with backoff on slow responses.
- RFC 8628 calls out brute forcing of short user codes and recommends rate-limiting attempts.
- NIST SP 800-63B treats numeric PINs as secrets and requires short authentication secrets to be random, single-use, time-limited, and rate-limited when they have less than 64 bits of entropy.
- NIST SP 800-63B says pairing codes should be at least six decimal digits or equivalent.
- OWASP Authentication guidance recommends throttling and account/device-level lockout controls to prevent repeated guessing.

Primary references:

- RFC 8628, OAuth 2.0 Device Authorization Grant: https://www.rfc-editor.org/rfc/rfc8628
- NIST SP 800-63B: https://pages.nist.gov/800-63-4/sp800-63b.html
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

### Source-Backed Tradeoff

Use the device-code pattern, but keep it simpler than full OAuth:

- A six-digit PIN is familiar and fast for a kitchen iPad.
- The PIN must be short-lived, single-use, and attempt-limited because six digits has low entropy.
- The iPad should poll a pairing status endpoint at a fixed low cadence instead of opening realtime/subscription infrastructure just for onboarding.
- Admin confirmation in the dashboard prevents a leaked or guessed PIN from immediately becoming a trusted KDS session.

### Umi-Specific Inference

- `apps/umi-dashboard` owns the owner UI and currently provisions KDS device sessions through `server.js`.
- `apps/umi-kds` owns the iPad client and currently loads `DeviceSession` from `Info.plist`, with deployed-but-not-active device token functions documented in `Sources/Docs/KDSArchitecture.md`.
- Backend/session truth should remain in the KDS/conversaflow-owned schema and service layer. Dashboard should call admin endpoints; KDS should call pairing/runtime endpoints.
- The existing long one-time token in `kds.device_sessions.token_hash` can remain the durable device credential. The new PIN is only a temporary bootstrap code used to mint/approve that durable credential.

## Proposed Simple Design

### Objects

Add a small pairing table owned by the KDS backend contract:

`kds.device_pairing_requests`

| Column                                          | Purpose                                                 |
| ----------------------------------------------- | ------------------------------------------------------- |
| `id uuid primary key`                           | Pairing request ID returned to dashboard/KDS as needed. |
| `tenant_id uuid not null`                       | Tenant scope.                                           |
| `location_id uuid null`                         | Optional selected dashboard location scope.             |
| `station_id uuid null`                          | Station selected by admin.                              |
| `device_name text not null`                     | Friendly KDS name from admin or iPad.                   |
| `pin_hash text not null`                        | Hash of the six-digit PIN, never stored plaintext.      |
| `status text not null`                          | `pending`, `approved`, `denied`, `expired`, `used`.     |
| `attempt_count int not null default 0`          | Guess throttling.                                       |
| `expires_at timestamptz not null`               | Short validity window.                                  |
| `approved_by text null`                         | Dashboard/admin actor, if available.                    |
| `approved_at timestamptz null`                  | Approval time.                                          |
| `created_at timestamptz not null default now()` | Audit.                                                  |
| `used_at timestamptz null`                      | When KDS claimed the durable token.                     |

Keep existing `kds.device_sessions` for paired devices. Do not move order state or projection ownership.

### PIN Shape

- Six decimal digits, generated server-side with a cryptographically secure random source.
- Display as `123 456` in UI for readability.
- TTL: 10 minutes.
- Single use.
- Max attempts: 5 per pairing request. After 5 failed attempts, set `status = denied` or `expired` and require a new PIN.
- PIN is never returned by list endpoints after creation.

### Dashboard API

Add focused admin endpoints alongside the existing device endpoints:

`POST /api/tenants/:tenantId/kds/devices/pairing-pin`

Request:

```json
{
  "device_name": "Cocina Caliente 2",
  "station_id": "HOT LINE"
}
```

Response:

```json
{
  "pairing": {
    "id": "uuid",
    "pin": "123456",
    "expires_at": "2026-05-22T18:10:00Z",
    "device_name": "Cocina Caliente 2",
    "station_id": "HOT LINE",
    "status": "pending"
  }
}
```

`POST /api/tenants/:tenantId/kds/devices/pairing/:pairingId/approve`

Response:

```json
{ "ok": true }
```

`POST /api/tenants/:tenantId/kds/devices/pairing/:pairingId/deny`

Response:

```json
{ "ok": true }
```

Optional for the dashboard panel:

`GET /api/tenants/:tenantId/kds/devices/pairing`

Returns pending, non-expired requests for the selected location.

### KDS App API

The KDS app needs unauthenticated onboarding endpoints scoped by PIN only. These must not expose order data.

`POST /api/kds/pairing/start`

Request:

```json
{
  "pin": "123456",
  "device_name": "Juan's iPad",
  "platform": "ipad"
}
```

Response when valid and pending:

```json
{
  "pairing_id": "uuid",
  "status": "pending",
  "poll_after_seconds": 5,
  "expires_at": "2026-05-22T18:10:00Z"
}
```

Errors:

- `400 invalid_pin`
- `404 pairing_not_found`
- `409 pairing_not_pending`
- `410 pairing_expired`
- `429 too_many_attempts`

`GET /api/kds/pairing/:pairingId/status`

Response while waiting:

```json
{
  "status": "pending",
  "poll_after_seconds": 5
}
```

Response once approved:

```json
{
  "status": "approved",
  "device_session": {
    "business_id": "uuid",
    "station_id": "HOT LINE",
    "station_name": "Hot Line",
    "device_name": "Cocina Caliente 2",
    "token": "one-time-long-device-token"
  }
}
```

After returning the durable token, mark the pairing request `used`.

### Durable Credential

Keep the existing one-time long token model:

- On approval claim, create or activate a `kds.device_sessions` row.
- Return the plaintext device token to the KDS app once.
- Store only `token_hash` server-side.
- KDS stores the token in iOS Keychain, not `UserDefaults`.
- Future KDS runtime requests should include the device token when the backend contract is activated.

For the first implementation, it is acceptable to store the paired `business_id`, `station_id`, `station_name`, and `device_name` locally while leaving the current anon-read flow unchanged. The token plumbing can be activated in a narrow follow-up once backend verification is fully wired.

## Dashboard UX

Screen: `Dispositivos KDS`

Replace or adjust the current `Añadir dispositivo` sheet:

1. Admin enters device name.
2. Admin selects station.
3. Admin clicks `Generar PIN`.
4. Sheet shows the six-digit PIN, expiration countdown, and waiting state.
5. When an iPad submits that PIN, show a pending confirmation row:
   - device name from iPad
   - station
   - request age
   - `Aprobar` and `Rechazar`
6. After approval, show `Pareado` and refresh device list.

Keep the existing device grid and actions intact. The old long token should no longer be the visible primary flow for operators.

Copy:

- Button: `Generar PIN`
- PIN label: `PIN de primer pareo`
- Waiting: `Esperando solicitud del iPad`
- Confirmation: `Confirmar pareo`
- Success: `Dispositivo pareado`

## KDS iPad UX

First app launch behavior:

- If Keychain has a paired device session, open the board.
- If no paired session exists, show full-screen pairing board.

Pairing board:

- Umi mark / `Kitchen Display`
- Six large numeric boxes.
- Numeric keypad.
- `Conectar` button enabled after six digits.
- Error message area for invalid, expired, or denied PIN.
- Waiting state after submit:
  - `Esperando confirmación del administrador`
  - small spinner
  - cancel/reset button

Polling:

- Poll every 5 seconds.
- Respect `poll_after_seconds` if returned.
- Stop polling on `approved`, `denied`, `expired`, or app background cancellation.
- Use simple retry/backoff on network failures.

## Implementation Steps

1. Backend contract
   - Add pairing request table/migration in the backend-owned KDS schema.
   - Add server endpoints for admin PIN creation, approval, denial, KDS PIN start, and KDS polling.
   - Generate PIN server-side and hash before storage.
   - Enforce TTL, attempt limit, and single-use transition.

2. Dashboard
   - Add `generatePairingPin`, `approvePairing`, `denyPairing`, and optional `usePairingRequests` data helpers.
   - Update `AddDevicePanel` to use `Generar PIN` instead of exposing the durable token.
   - Show pending confirmation and completion states.

3. KDS app
   - Add `PairingSession` model and `KDSPairingClient`.
   - Add Keychain storage for paired session/token.
   - Change `AppEnvironment.bootstrap()` to load Keychain session first, then show onboarding if absent.
   - Add `PairingView` before `AppShellView`.

4. Runtime hardening follow-up
   - Send durable device token on KDS runtime requests.
   - Activate `verify_device_token` server-side for KDS commands and, if desired, board reads.
   - Keep anon project JWT only as the transport key, not the device identity.

## Validation Plan

Backend:

- PIN generation returns six digits and stores only hash.
- Expired PIN cannot be used.
- Wrong PIN increments attempts.
- Sixth wrong attempt is rejected with `429`.
- Approved pairing returns durable token once and then marks request used.
- Denied request never returns a token.

Dashboard:

- `Generar PIN` disabled until device name is present.
- PIN appears once with countdown.
- Approve/deny actions update visible state.
- Device list refreshes after success.

KDS:

- Fresh install opens pairing board.
- Invalid PIN shows inline error.
- Valid pending PIN enters waiting state.
- Denial returns to PIN input.
- Approval stores session and opens board.
- Relaunch skips pairing after successful storage.

## Non-Goals

- No QR code in v1.
- No OAuth server implementation.
- No Supabase Realtime subscription just for pairing.
- No multi-location station management redesign.
- No change to KDS order creation, projection ownership, or kitchen event semantics.

## Open Questions Before Implementation

- Should pairing endpoints live in `apps/umi-dashboard/server.js` first, or be moved immediately to the ConversaFlow/KDS backend owner? Simple v1 can use the existing dashboard server proxy, but the durable contract belongs with KDS backend ownership.
- Are station IDs in the current transition schema UUID-only, or should the legacy string station IDs remain supported for this rollout?
- Which admin identity should be recorded in `approved_by` from the current dashboard auth headers?
