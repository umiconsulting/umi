# UmiPOS Device Enrollment Specification

Status: Implemented and validated  
Owner: UMI Platform and UmiPOS  
Last updated: 2026-07-29

## 1. Purpose

This specification defines approval-based trusted device enrollment for UmiPOS.

The flow establishes device trust before user authentication. It does not grant operator permissions.

## 2. Scope

This specification covers:

- device enrollment;
- one-time enrollment challenges;
- device credentials;
- secure client storage;
- device status verification;
- credential rotation;
- device revocation;
- device replacement;
- browser development behavior;
- recovery states;
- audit and telemetry;
- acceptance tests.

This specification does not cover:

- user password management;
- operator PIN creation;
- manager approval;
- catalog behavior;
- cart behavior;
- checkout behavior;
- payment behavior;
- offline command replay.

## 3. Authority

The UMI API is the only device-trust authority.

`tenant.device` stores the authoritative device state.

`runtime.device_enrollment_request` stores one-time enrollment requests.

`runtime.device_pairing_session` stores polling state and credential hashes.

UmiPOS stores only the client credential and safe presentation context.

UmiPOS must not grant trust from local state alone.

## 4. Canonical terms

### 4.1 Installation identity

An installation identity is a random identifier created by UmiPOS.

It identifies one application installation. It is not proof of device trust.

### 4.2 Enrollment challenge

An enrollment challenge is a short-lived server request to pair one device.

An owner, administrator, or approved management flow creates the challenge. Creation does not approve the device.

### 4.3 Setup code

A setup code is the one-time value that connects UmiPOS to an enrollment request.

The current contract uses eight uppercase letters or digits.

### 4.4 Pairing session

A pairing session is an opaque server reference for one requesting installation.

It does not authenticate a trusted device.

### 4.5 Polling credential

A polling credential authorizes status checks for one pairing session.

It cannot authorize any other API operation.

### 4.6 Device credential

A device credential is a server-issued secret returned after successful enrollment.

The API stores only its cryptographic hash.

### 4.7 Device public ID

A device public ID is a safe server identifier for client requests and operator display.

It is not a secret.

### 4.8 Ephemeral device public key

An ephemeral device public key can protect credential delivery to the requesting installation.

It is optional until an approved platform library supports the selected standard.

### 4.9 Operator PIN

An operator PIN verifies an operator after device trust and user authentication.

It must not enroll a device.

## 5. Why enrollment does not use only a PIN

A PIN identifies or approves a person. It does not establish a device identity.

A shared PIN can move between devices. It cannot bind one credential to one installation.

The challenge flow provides:

- one-time use;
- a five-to-ten-minute expiry;
- tenant scope;
- branch scope;
- device type;
- platform scope;
- administrator authorization;
- explicit approval or denial;
- a separate polling credential;
- replay resistance;
- a server-issued device credential;
- an audit record.

The operator PIN remains separate. This separation limits the effect of a stolen PIN.

## 6. Enrollment sequence

1. The administrator selects the tenant, branch, device type, and display name.
2. The API creates an enrollment request.
3. The dashboard shows one setup code and an optional QR code.
4. UmiPOS submits the code with its installation identifier.
5. The API returns an opaque pairing session and a separate polling credential.
6. The dashboard shows the requesting device and its safe metadata.
7. The administrator approves or denies the request.
8. UmiPOS polls with the pairing session and polling credential.
9. The API issues one device credential after approval.
10. UmiPOS stores the credential in platform secure storage.
11. UmiPOS acknowledges durable credential storage.
12. UmiPOS verifies device status before user authentication.

No step before administrator approval creates a trusted device credential.

### 6.1 Flow

```text
Administrator      Dashboard          UMI API             UmiPOS
      |                 |                 |                   |
      | create request  |---------------->|                   |
      |<-- code or QR --|                 |                   |
      |                 |                 |<-- claim code ----|
      |                 |                 |-- pairing data --->|
      |<-- safe request ------------------|                   |
      | approve or deny |---------------->|                   |
      |                 |                 |<-- poll status ----|
      |                 |                 |-- credential* ---->|
      |                 |                 |<-- acknowledge ----|
```

`credential*` is available only after approval.

## 7. Enrollment request requirements

Each enrollment request must contain:

- enrollment request ID;
- setup-code hash;
- tenant ID;
- optional branch ID;
- device display name;
- device type;
- platform;
- idempotency key;
- expiry time;
- bounded attempt count;
- claim time;
- approval state;
- approval time;
- denial time;
- approving user ID;
- creator user ID;
- optional replacement device ID;
- creation time.

The API must enforce these rules:

- The server sets an expiry from five through ten minutes.
- The default expiry is five minutes.
- The setup code works once.
- The attempt count cannot exceed five.
- The API stores no plaintext setup code.
- A repeated idempotency key returns the same request identity.
- A branch must belong to the selected tenant.
- A claimed code cannot create a second pairing session.
- An expired request always fails closed.
- A denied request cannot become approved.
- An approved request cannot move to another tenant or branch.
- A claimed installation identifier cannot change.

### 7.1 Request states

The request state must be machine-readable.

```text
created
claimed
awaiting_approval
approved
denied
credential_ready
credential_delivered
completed
expired
cancelled
```

State transitions must be monotonic. Terminal states cannot return to an active state.

### 7.2 Setup code and QR code

The manual setup code contains eight uppercase letters or digits.

The QR code contains a versioned pairing payload.

The payload may contain:

- contract version;
- enrollment request public reference;
- setup code;
- API origin identifier.

The payload must not contain:

- a device credential;
- a polling credential;
- an administrator token;
- tenant-sensitive metadata;
- a reusable secret.

The dashboard must hide the setup code after expiry or cancellation.

### 7.3 Pairing session

The pairing session ID must be opaque and unguessable.

The API must bind it to:

- the enrollment request;
- the tenant;
- the branch;
- the installation identifier hash;
- the device type;
- the platform;
- the optional ephemeral public key.

### 7.4 Polling credential

The API returns the polling credential only after a successful code claim.

The API stores only its cryptographic hash.

The polling credential must:

- expire with the pairing session;
- authorize only pairing status;
- remain separate from the device credential;
- stop working after completion, denial, cancellation, or expiry;
- use constant-time hash comparison;
- never appear in logs, audit public data, or telemetry.

### 7.5 Optional ephemeral public key

UmiPOS may create an ephemeral key pair before it claims the setup code.

The private key must remain in platform secure storage.

The public key may travel in the claim request.

Use only an approved standard and a maintained cryptographic library.

Do not create a custom encryption scheme.

When supported, the API seals the device credential to the ephemeral public key.

Without this capability, TLS protects one-time credential delivery.

If the unsealed response is lost, the request must restart. The API must not expose plaintext again.

### 7.6 Rate limits

The API must enforce independent bounded limits by:

- source IP;
- tenant;
- installation identifier hash;
- trusted device when present;
- enrollment request;
- authenticated administrator;
- pairing session.

Limits must apply to:

- request creation;
- setup-code claims;
- pending-request queries;
- approval and denial;
- polling;
- credential acknowledgement.

The API must return a safe retry time where disclosure is acceptable.

Rate limits do not replace the bounded attempt count.

### 7.7 Constant-shape rejection

Public claim rejection responses must use the same status, body shape, and approximate processing path.

The response must not disclose whether:

- the request exists;
- the code is wrong;
- the request expired;
- the request was claimed;
- the tenant or branch differs.

The safe public code is:

```text
ENROLLMENT_NOT_AVAILABLE
```

Internal audit can record the precise reason.

## 8. Enrollment API

The routes in this section define the required target contract.

### 8.1 Begin enrollment

Route:

```text
POST /api/tenants/{tenantId}/devices/enrollment
```

Authorization:

- authenticated user;
- tenant membership;
- `owner`, `admin`, or `super_admin` role.

Request:

```json
{
  "branchId": "uuid-or-null",
  "displayName": "Front counter POS",
  "type": "pos_terminal",
  "platform": "linux",
  "idempotencyKey": "uuid"
}
```

Response:

```json
{
  "enrollmentRequestId": "opaque-public-reference",
  "setupCode": "A1B2C3D4",
  "qrPayload": "optional-versioned-payload",
  "expiresAt": "ISO-8601 timestamp",
  "pollAfterSeconds": 2
}
```

### 8.2 Claim setup code

Route:

```text
POST /api/devices/pairing/claim
```

Request:

```json
{
  "setupCode": "A1B2C3D4",
  "installationId": "uuid",
  "platform": "linux",
  "deviceType": "pos_terminal",
  "ephemeralPublicKey": "optional-standard-key"
}
```

Response:

```json
{
  "pairingSessionId": "opaque-reference",
  "pollingCredential": "one-session-secret",
  "state": "awaiting_approval",
  "expiresAt": "ISO-8601 timestamp",
  "pollAfterSeconds": 2
}
```

Claiming the code must not return a trusted device credential.

### 8.3 List pending requests

Route:

```text
GET /api/tenants/{tenantId}/devices/enrollment-requests
```

The dashboard response contains only safe request metadata.

Required metadata includes:

- request public reference;
- branch;
- device type;
- platform;
- requested display name;
- claim status;
- safe installation suffix;
- request time;
- expiry time.

### 8.4 Approve or deny

Routes:

```text
POST /api/tenants/{tenantId}/devices/enrollment-requests/{requestId}/approve
POST /api/tenants/{tenantId}/devices/enrollment-requests/{requestId}/deny
```

Authorization requires an approved administrator role and matching tenant scope.

Approval must bind the final tenant, branch, display name, type, and platform.

Denial must consume the request without creating a device.

### 8.5 Poll pairing state

Route:

```text
POST /api/devices/pairing/{pairingSessionId}/poll
```

Request:

```json
{
  "pollingCredential": "one-session-secret",
  "installationId": "uuid"
}
```

Pending response:

```json
{
  "state": "awaiting_approval",
  "pollAfterSeconds": 2,
  "expiresAt": "ISO-8601 timestamp"
}
```

Approved response:

```json
{
  "state": "credential_ready",
  "device": {
    "id": "uuid",
    "publicId": "uuid",
    "tenantId": "uuid",
    "branchId": "uuid",
    "displayName": "Front counter POS",
    "type": "pos_terminal",
    "platform": "linux",
    "state": "active",
    "credentialVersion": 1
  },
  "credentialEnvelope": "one-time-credential-or-sealed-envelope"
}
```

Polling must use bounded intervals and server-provided backoff.

### 8.6 Acknowledge credential storage

Route:

```text
POST /api/devices/pairing/{pairingSessionId}/acknowledge
```

The request proves possession of the issued credential.

The API completes the pairing session only after successful proof.

### 8.7 Device status

Route:

```text
GET /api/devices/status
```

Required headers:

```text
x-umi-device-id
x-umi-device-public-id
x-umi-installation-id
x-umi-device-credential
```

The API validates hashes and the active lifecycle state.

### 8.8 Contract requirements

All request and response models must come from `packages/contract`.

The TypeScript and Dart SDKs must be generated.

Do not create handwritten pairing models in Flutter.

Consequential commands require an idempotency key and correlation ID.

Every request body and response body must have a bounded size.

### 8.9 Persistence model

The target server model requires one enrollment-request record and one pairing-session record.

The enrollment-request record owns:

- tenant and branch scope;
- selected device metadata;
- setup-code hash;
- request state;
- attempt count;
- creation and expiry;
- creator;
- approver or denier;
- transition times;
- idempotency data.

The pairing-session record owns:

- opaque session ID;
- enrollment-request relationship;
- installation identifier hash;
- polling-credential hash;
- optional ephemeral public key;
- poll state;
- delivery state;
- acknowledgement state;
- expiry;
- safe correlation references.

The pairing session must not store a plaintext device credential.

The API creates `tenant.device` only after authorized approval.

The API must enforce these database constraints:

- one active claim per enrollment request;
- one pairing session per claimed request;
- one installation identity per pairing session;
- one final device per approved request;
- immutable tenant and branch scope after claim;
- immutable setup-code hash;
- immutable polling-credential hash;
- monotonic state transitions;
- unique idempotency identity;
- bounded attempt count.

The API must use row locks or equivalent atomic controls for claim, approval, delivery, and acknowledgement.

Concurrent approval and denial must produce one terminal result.

## 9. Device lifecycle

The canonical lifecycle contains:

```text
enrollment_pending
active
rotation_required
rotated
revoked
replaced
```

The API must end durable sessions after rotation, revocation, or replacement.

A revoked device cannot authenticate, refresh, replay, or create an operator session.

A replaced device cannot become active through its previous credential.

## 10. Secure client storage

UmiPOS uses `flutter_secure_storage` through one storage boundary.

The namespace is:

```text
co.umiconsulting.umipos.
```

Secure values include:

- installation ID;
- pairing session ID;
- polling credential;
- optional ephemeral private key;
- internal device ID;
- device public ID;
- device credential;
- credential version;
- device state;
- access token;
- refresh token;
- tenant context;
- branch context;
- operator-session ID.

The application must perform a secure-storage health check during bootstrap.

The application must fail closed when secure storage is unavailable.

The application must not use a plaintext fallback.

UmiPOS must delete pairing secrets after:

- completed enrollment;
- denial;
- cancellation;
- expiry;
- secure recovery abandonment.

UmiPOS must replace pairing secrets atomically when a new request starts.

### 10.1 Native platforms

The storage plugin uses the platform credential service.

Linux requires a Secret Service provider, such as GNOME Keyring.

macOS and iOS use Keychain.

Android uses its platform-backed secure storage implementation.

Windows uses its platform credential protection implementation.

### 10.2 Web

Web storage has weaker endpoint guarantees than native secure storage.

Web supports online development and online operation only.

Web must not support sensitive offline financial journaling.

Production Web deployment requires HTTPS and an approved threat review.

Browser storage must not reduce server controls for approval, expiry, attempts, or polling.

## 11. Browser CORS policy

The UMI API owns CORS policy. UmiPOS must not bypass browser CORS controls.

Allowed development origins must be explicit.

Example:

```text
http://localhost:8088
http://127.0.0.1:8088
```

The API must support these methods:

```text
GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS
```

The API must accept all headers used by UmiPOS:

```text
accept
authorization
content-type
x-correlation-id
x-umi-app
x-umi-client
x-umi-device-id
x-umi-device-public-id
x-umi-installation-id
x-umi-device-credential
```

The same global policy must apply to enrollment, login, context, catalog, cart, checkout, and recovery routes.

Do not maintain a separate CORS list for each screen.

## 12. User authentication boundary

Device enrollment must complete before POS login.

User authentication uses an email and password. It creates a durable device-bound session.

Device trust does not grant a user role.

A user role does not grant device trust.

The server computes effective roles and permissions for the selected tenant and branch.

## 13. Operator PIN boundary

The operator session starts after user authentication and branch selection.

The server stores only the PIN salt and scrypt hash.

The server limits PIN attempts and can lock PIN verification.

The PIN can approve an allowed operator action. It cannot enroll or reactivate a device.

## 14. Pairing experience

### 14.1 Dashboard

The administrator first selects:

- tenant;
- branch;
- device type;
- display name;
- platform when known.

The dashboard then shows:

- the eight-character setup code;
- the optional QR code;
- the expiry countdown;
- safe setup instructions;
- the pending request after the device claims the code;
- explicit approve and deny actions.

The dashboard must not auto-approve a claimed request.

Approval and denial require a visible confirmation.

The pending request must show enough data to detect an unexpected device.

It must not show secrets or a raw installation identifier.

### 14.2 UmiPOS

UmiPOS must support these states:

```text
not_enrolled
claiming_code
awaiting_approval
approved
storing_credential
verifying_device
completed
denied
expired
network_recovery
storage_blocked
```

The operator can enter the setup code manually.

The application can scan a QR code only through an approved scanner adapter.

UmiPOS must show the tenant, branch, and display name after the claim response confirms them.

UmiPOS must state that approval is pending.

UmiPOS must not show an infinite spinner.

### 14.3 Polling behavior

UmiPOS must follow the server-provided polling interval.

The minimum polling interval is two seconds.

The client must use bounded exponential backoff after transport failures.

The client must stop polling after:

- approval and credential delivery;
- denial;
- expiry;
- cancellation;
- storage failure;
- application shutdown.

The client must resume a valid pairing session after restart.

The client must not create a second pairing session during recovery.

### 14.4 Accessibility and localization

The dashboard and UmiPOS must support English and Spanish.

Controls must support keyboard, pointer, touch, and screen readers.

Status must not depend only on color.

The expiry countdown must not cause excessive screen-reader announcements.

Approve and deny controls must have distinct labels and focus states.

## 15. Recovery behavior

### 15.1 Expired request

Show a safe expiry message. Preserve the installation identity.

Request a new enrollment request from an authorized administrator.

Delete the expired polling credential and ephemeral private key.

### 15.2 Incorrect code

Show a generic rejection. Do not disclose which value was incorrect.

Do not retry without an operator action.

### 15.3 Denied request

Stop polling and delete pairing secrets.

Do not create a device credential.

Show a safe denial message and administrator contact guidance.

### 15.4 Secure-storage failure

Block enrollment completion. Do not request a device credential.

Show platform recovery guidance.

If a credential response was received, do not acknowledge it before durable storage succeeds.

### 15.5 Lost credential response

When an approved response is lost, query the same pairing session.

Do not create a new device or pairing session automatically.

Return the same sealed credential envelope when approved key delivery supports safe replay.

Without sealed delivery, expire the request and require a new enrollment.

### 15.6 Device revocation

Delete local device credentials after the server confirms revocation.

Clear user and operator sessions.

Route to the blocked-device recovery state.

### 15.7 Credential rotation

Store the replacement credential and version atomically.

Never reuse the previous credential.

### 15.8 Device replacement

Create a new device and credential.

Keep the replacement relationship in the server record.

The previous device remains revoked or replaced.

## 16. Error model

Public errors must use stable codes.

Required codes include:

- `ENROLLMENT_NOT_AVAILABLE`;
- `PAIRING_AWAITING_APPROVAL`;
- `PAIRING_DENIED`;
- `PAIRING_EXPIRED`;
- `PAIRING_CANCELLED`;
- `PAIRING_RATE_LIMITED`;
- `POLLING_CREDENTIAL_INVALID`;
- `CREDENTIAL_DELIVERY_UNAVAILABLE`;
- `DEVICE_CREDENTIAL_INVALID`;
- `DEVICE_ROTATION_REQUIRED`;
- `DEVICE_NOT_ALLOWED`;
- `SECURE_STORAGE_UNAVAILABLE`;
- `REQUEST_TIMEOUT`;
- `CONFIGURATION_INVALID`.

The UI must not show:

- stack traces;
- SQL errors;
- database names;
- secret values;
- raw credentials;
- internal framework errors.

## 17. Audit and telemetry

The server must audit:

- enrollment request created;
- setup code claimed;
- pairing session created;
- pending request viewed;
- approval attempted;
- request approved;
- request denied;
- request expired;
- request cancelled;
- poll rejected;
- credential issued;
- credential acknowledged;
- enrollment completed;
- credential rotated;
- device revoked;
- device replaced;
- device authentication denied.

Telemetry may include:

- opaque device reference;
- opaque tenant reference;
- opaque branch reference;
- correlation ID;
- safe result code;
- duration;
- bounded attempt count.

Telemetry must not include:

- setup code;
- polling credential;
- ephemeral private key;
- device credential;
- password;
- PIN;
- access token;
- refresh token;
- raw installation identity.

Each transition must include a correlation ID and an opaque request reference.

Internal audit must record the exact rejection reason.

Public telemetry must use safe result categories.

## 18. Local development

Local enrollment requires:

- the UMI API;
- PostgreSQL with current migrations;
- Redis for API readiness;
- one tenant;
- one active branch;
- one authorized administrator;
- one cashier or operator identity;
- the dashboard approval surface;
- an explicit development CORS origin.

Do not point UmiPOS at another product API.

Use a disposable database for enrollment demonstrations.

Do not reuse local credentials in staging or production.

Local fixtures must not auto-approve a request.

## 19. Acceptance criteria

Device enrollment is acceptable only when:

1. The administrator selects the tenant, branch, device type, and display name.
2. The API creates one enrollment request.
3. The dashboard shows one eight-character setup code.
4. The dashboard can show a versioned QR payload.
5. The server sets a five-to-ten-minute expiry.
6. The setup code works once.
7. The API stores only the setup-code hash.
8. The API limits failed attempts.
9. Limits apply by IP, tenant, installation, administrator, request, and pairing session.
10. UmiPOS claims the request with its installation identifier.
11. The optional ephemeral public key uses an approved standard.
12. The API returns an opaque pairing session.
13. The API returns a separate polling credential.
14. The API stores only the polling-credential hash.
15. The dashboard shows the claimed device safely.
16. The administrator explicitly approves or denies the request.
17. No trusted credential exists before approval.
18. Denial creates no device.
19. UmiPOS uses bounded polling and server backoff.
20. Public rejection responses have a constant shape.
21. Tenant and branch scope remain server-authoritative.
22. The API creates one device after one approval.
23. The API issues one device credential.
24. The API stores only the credential hash.
25. UmiPOS stores the credential through secure storage.
26. UmiPOS acknowledges storage before completion.
27. Secure-storage failure blocks completion.
28. Lost responses do not create a second device.
29. Device status verification precedes login.
30. Revoked devices fail closed.
31. Rotated credentials invalidate previous credentials.
32. Replacement does not reactivate the old device.
33. User roles remain separate from device trust.
34. Operator PIN remains separate from device enrollment.
35. All Web POS routes pass the global CORS preflight.
36. Every sensitive transition creates an audit event.
37. Logs and telemetry contain no secret values.
38. Focused pairing, revocation, storage, and abuse tests pass.

## 20. Required tests

API tests must cover:

- authorized request creation;
- unauthorized request creation;
- wrong tenant;
- wrong branch;
- configurable expiry bounds;
- setup-code expiry;
- setup-code reuse;
- incorrect code;
- attempt exhaustion;
- IP limit;
- tenant limit;
- installation limit;
- administrator limit;
- request limit;
- pairing-session limit;
- constant-shape rejection;
- pairing-session opacity;
- polling-credential hashing;
- polling-credential scope;
- pending request visibility;
- approval authorization;
- denial authorization;
- approval after denial;
- claim after approval;
- bounded polling;
- duplicate poll;
- response loss;
- credential acknowledgement;
- credential delivery before approval;
- duplicate completion;
- QR payload version;
- ephemeral public-key validation;
- credential hashing;
- revocation;
- rotation;
- replacement;
- session revocation;
- CORS preflight for every UmiPOS header.

Flutter tests must cover:

- installation identity creation;
- manual setup-code entry;
- QR payload parsing;
- claim request;
- pairing credential persistence;
- awaiting-approval state;
- denied state;
- expired state;
- bounded polling;
- server backoff;
- restart during pairing;
- lost poll response;
- credential acknowledgement;
- secure-storage failure;
- enrollment success;
- enrollment expiry;
- enrollment rejection;
- credential persistence;
- device-status restoration;
- revoked-device routing;
- rotation-required routing;
- session cleanup;
- English and Spanish messages;
- keyboard and screen-reader behavior.

## 21. Implementation status

The canonical flow uses one eight-character setup code.

UmiPOS claims the code with its installation identifier.

The API returns a pairing session and a separate polling credential.

The Dashboard shows the request and supports approval or denial.

The API creates the trusted device only after approval.

UmiPOS polls, stores the credential, and acknowledges durable storage.

The old immediate activation route is not part of the public route catalog.

The implementation includes:

- a five-minute request expiry;
- one-time code consumption;
- tenant and branch binding;
- administrator and tenant rate limits;
- IP, installation, request, and polling-session limits;
- an optional ephemeral public-key field;
- constant-shape public rejection;
- hashed setup codes and polling credentials;
- complete transition audit;
- secure pairing recovery after restart;
- English and Spanish operator copy.

## 22. Delivery plan

### 22.1 Contracts

1. Add enrollment-request, pairing-session, polling, approval, denial, and acknowledgement contracts.
2. Add stable public error codes.
3. Add versioned QR payload contracts.
4. Regenerate the TypeScript and Dart SDKs.
5. Run deterministic contract drift validation.

### 22.2 Database

1. Add the enrollment-request and pairing-session persistence model.
2. Store only setup-code and polling-credential hashes.
3. Add atomic transition functions or guarded transactions.
4. Add expiry and active-request indexes.
5. Add tenant, branch, and administrator authorization controls.
6. Add append-only transition audit records.
7. Validate negative cases in disposable PostgreSQL.

### 22.3 UMI API

1. Implement request creation.
2. Implement code claim and pairing-session creation.
3. Implement the pending-request list.
4. Implement administrator approval and denial.
5. Implement bounded polling.
6. Implement credential delivery and acknowledgement.
7. Implement the complete rate-limit matrix.
8. Implement constant-shape public rejection.
9. Preserve correlation IDs across all transitions.

### 22.4 Dashboard

1. Add tenant, branch, device type, and display-name selection.
2. Show the setup code and optional QR code.
3. Show safe pending-device metadata.
4. Add explicit approve and deny actions.
5. Add expiry, completion, and audit-safe states.
6. Add English and Spanish text.
7. Add keyboard and screen-reader support.

### 22.5 UmiPOS

1. Replace immediate completion with code claim.
2. Store the pairing session and polling credential securely.
3. Add the awaiting-approval state.
4. Add bounded polling and restart recovery.
5. Store the approved device credential atomically.
6. Acknowledge durable credential storage.
7. Delete pairing secrets after a terminal state.
8. Preserve the existing login boundary after device verification.

### 22.6 Security validation

1. Test replay, enumeration, brute force, expiry, and request flooding.
2. Test cross-tenant and cross-branch access.
3. Test concurrent approval and denial.
4. Test response loss during credential delivery.
5. Test revoked and rotated device behavior.
6. Scan logs, telemetry, and diagnostics for secrets.
7. Validate CORS preflight for all UmiPOS routes and headers.

### 22.7 Completion rule

Mark the pairing flow complete only after all Section 19 criteria pass.

Do not remove the existing baseline until the new contract migration is complete.

Use one controlled compatibility window if deployed clients require it.

## 23. Implementation references

- `packages/contract/src/device.ts`
- `apps/umi-api/src/modules/devices`
- `apps/umi-api/src/modules/auth`
- `apps/umi-api/src/modules/pos-entry`
- `apps/umi-pos/lib/core/security/credential_vault.dart`
- `apps/umi-pos/lib/core/storage/storage.dart`
- `apps/umi-pos/lib/features/entry`
- `supabase/migrations/20260728000100_gate_2b_device_trust.sql`
