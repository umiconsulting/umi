# UmiPOS Offline Command Policy

Updated: 2026-07-28

The server is the policy authority. The native client may journal only command types in the
current, unexpired server policy. Web never supports sensitive offline journaling.

| Command | State | Risk / required authority | Reconciliation |
| --- | --- | --- | --- |
| `operational.ack` | Allowed | Low; trusted active device, operator, tenant, branch, `offline.replay` | Ordered acknowledgement |
| Cart preparation | Online only | Server remains the pricing and availability authority | Preserve its authoritative snapshot |
| Cash checkout | Conditionally allowed | Active trusted native device, valid operator, `offline.cash.checkout`, `pos.offline_cash`, fresh signed-fingerprint policy and snapshots, matching branch/currency, and configured integer limits | Provisional until ordered replay is accepted |
| Receipt request | Blocked | Must follow an accepted sale | Recover accepted result by command ID |
| External terminal/card | Prohibited | Requires real-time provider authority | Unknown outcomes remain query-only |
| Enrollment, credentials, roles, permissions, elevation, refunds, configuration | Prohibited | Security-sensitive or destructive | Online authority only |

Offline cash is default deny. A branch policy sets expiry, maximum policy age, single-sale and
accumulated amounts in integer minor units, sale count, active queue depth, command age, catalog,
pricing, and tax freshness, permission, entitlement, device class, credential version, branch,
currency, and optional manager-review threshold. Missing trusted server-time anchors, stale or
corrupt policy, rotation, revocation, scope changes, and Web block checkout.

An accepted offline checkout remains provisional locally until the generated-SDK replay gateway
recovers or receives the authoritative result and durably maps the provisional reference to the
official sale and receipt. Unknown responses are queried by the original command identity; they
are never treated as failure or submitted as a new payment. Pending, unknown, or unresolved
financial records are never deleted by age. Accepted records have bounded encrypted retention
after durable result and mapping persistence.

Residual risks: platform keystore availability, device compromise while unlocked, storage rollback
outside application control, and prolonged loss of server policy. Production deployment requires
device management, OS patching, server rate limiting, and incident procedures.
