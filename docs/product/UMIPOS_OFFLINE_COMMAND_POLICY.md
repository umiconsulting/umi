# UmiPOS Offline Command Policy

Updated: 2026-07-28

The server is the policy authority. The native client may journal only command types in the
current, unexpired server policy. Web never supports sensitive offline journaling.

| Command | State | Risk / required authority | Reconciliation |
| --- | --- | --- | --- |
| `operational.ack` | Allowed | Low; trusted active device, operator, tenant, branch, `offline.replay` | Ordered acknowledgement |
| Cart preparation | Blocked | Pricing and availability snapshots are not yet policy-certified | Future explicit policy |
| Sale preparation | Blocked | Financial snapshot freshness policy is absent | Future explicit policy |
| Cash sale commit | Blocked | No server-issued amount/count/freshness limits exist | Required before enablement |
| Receipt request | Blocked | Must follow an accepted sale | Recover accepted result by command ID |
| External terminal/card | Prohibited | Requires real-time provider authority | Unknown outcomes remain query-only |
| Enrollment, credentials, roles, permissions, elevation, refunds, configuration | Prohibited | Security-sensitive or destructive | Online authority only |

The default limits are 250 native queue records, 20 commands per batch, and 24 hours maximum
command age. Server policy may lower these bounds. Pending or unresolved financial records are
never deleted by age. Replay preserves the original command ID, device sequence, idempotency key,
fingerprint, and payload.

Residual risks: platform keystore availability, device compromise while unlocked, storage rollback
outside application control, and prolonged loss of server policy. Production deployment requires
device management, OS patching, server rate limiting, and incident procedures.
