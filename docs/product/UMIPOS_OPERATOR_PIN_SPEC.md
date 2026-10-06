# UmiPOS Personal Operator PIN Specification

Updated: 2026-07-29

## Purpose

The PIN identifies one staff member at a trusted UmiPOS device. The server loads the current
role, permissions, entitlements, tenant, and branch scope. The operator does not select a role.

The PIN does not change a role. An administrator changes role assignments in UMI.

## Entry flow

1. An administrator assigns one personal PIN to each staff member.
2. The administrator assigns the staff member to a tenant, branch, and role.
3. UmiPOS verifies its device credential.
4. UmiPOS gets the tenant and branch from the trusted device.
5. The operator enters only the personal PIN.
6. The API identifies the staff member within the device scope.
7. The API validates the device, staff status, role, permission, and POS entitlement.
8. The API creates a device-bound durable session.
9. UmiPOS creates a separate operator session.
10. UmiPOS shows only the actions allowed by the server response.

The app requires the PIN again after an operator lock or an app restart.

## Role change

Use the operator lock before another staff member uses the register.

The next staff member enters a different personal PIN. The API creates a new session with that
person's current permissions. This flow supports cashier-to-manager handoff without an email or
role selector.

A cash-close feature must require its canonical permission. A manager PIN does not grant this
permission when the manager role lacks it.

## PIN rules

- Use four to eight numeric digits.
- Keep each PIN unique within one tenant.
- Store a salted scrypt verifier.
- Store a keyed HMAC-SHA-256 lookup tag.
- Never store or log the plaintext PIN.
- Reject a duplicate PIN during staff creation or PIN replacement.
- Apply limits by IP, trusted device, and tenant.
- Lock a known staff PIN after repeated failures.
- Return a constant public error for an invalid or unknown PIN.

## Authority

UMI owns staff identity, role assignment, permissions, entitlement, branch scope, session
revocation, and audit. Flutter owns the PIN entry surface and session presentation.

The client must not cache a role as authority. The client must not create a permission or change
a role.

## Recovery

- A revoked device blocks PIN login.
- A rotated device credential blocks the stale credential.
- An inactive staff record blocks PIN login.
- A missing POS entitlement blocks PIN login.
- A branch mismatch blocks PIN login.
- An application restart clears local session access and returns to PIN entry.

An administrator can replace or clear a staff PIN through the canonical staff API. The API audits
the staff update without the PIN value.
