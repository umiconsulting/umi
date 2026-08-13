# UmiPOS first pilot runbook

Use this runbook for the first controlled pilot. Use the current release manifest and approved pilot environment.

Deploy `UMI POS Pilot RC2`. RC1 is superseded and must not be deployed.

## Before pilot

1. Verify PostgreSQL, Redis, API, worker, Dashboard, Caddy, and telemetry.
2. Verify the release manifest, schema version, contract version, and checksums.
3. Create the business, first location, and first Owner through `pnpm pilot:bootstrap`.
4. Complete business and location settings through Dashboard.
5. Create the required Owner, Manager, Cashier, Viewer, and kitchen memberships.
6. Create an active register and assign the POS device.
7. Enroll each device through the supported registration-code flow.
8. Configure catalog, prices, modifiers, preparation routes, and opening inventory.
9. Assign the printer, drawer, scanner, display, and KDS station.
10. Resolve all Owner policy decisions before live use.
11. Run `pnpm pilot:readiness`.
12. Record physical hardware and provider checks that remain pending.
13. Confirm the payment mode is manual unless provider certification exists.
14. Confirm the current backup checksum and monitoring contact.

Do not use the certification fixture for a real business. Do not use SQL or Supabase for normal onboarding.

## Start of pilot

1. Confirm `/health/live` and `/health/ready`.
2. Confirm business, location, register, device, and operator on each client.
3. Confirm the current shift state and opening float.
4. Run safe printer, scanner, drawer, and display checks.
5. Confirm the KDS station, connection, empty board, and snapshot.
6. Complete one representative low-value transaction.
7. Confirm sale, receipt, inventory effect, hardware command, and audit.

## During pilot

- Monitor readiness, device state, KDS connection, hardware queue, and Recovery Center.
- Use public references and correlation IDs for support.
- Query the original command after an uncertain response.
- Retry only when the product marks the action as safe.
- Escalate unresolved financial, inventory, customer-value, or replay ambiguity immediately.
- Keep technical diagnostics secondary. Do not share tokens, PINs, passwords, cookies, or gift-card codes.

## End of pilot day

1. Review pending sales, kitchen work, hardware commands, and recovery items.
2. Submit the blind cash count.
3. Review the expected cash and variance.
4. Resolve and approve the variance when policy requires it.
5. Reconcile and close the shift.
6. Review sales, refunds, receipts, inventory, customer value, audit, and diagnostics.
7. Confirm no unresolved code-controlled recovery item remains.
8. Create and verify the scheduled backup.
9. Record unresolved issues with `UMIPOS_PILOT_ISSUE_LOG_TEMPLATE.md`.

## Pilot stop conditions

Stop affected operation for an incorrect financial effect, duplicate irreversible fact, tenant crossing, data loss, unresolved transaction ambiguity, authority bypass, secret exposure, unsafe recovery, or reconciliation drift.

## Incident handling

| Incident                 | Safe action                                                                       | Escalate when                                |
| ------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------- |
| Connectivity failure     | Preserve local eligible work. Reconnect and query original commands.              | A financial result remains unknown.          |
| Device failure           | Revoke or reinscribe through Dashboard. Keep existing facts unchanged.            | The device cannot regain trusted context.    |
| KDS issue                | Keep cached work visible. Block unsafe mutations. Reconnect and fetch a snapshot. | Active work is missing or duplicated.        |
| Login or authority issue | Confirm user, membership, location, device, and session state.                    | Correct authority still receives denial.     |
| Transaction uncertainty  | Search by command, sale, or receipt reference. Do not repeat payment.             | The original command has no terminal result. |
| Duplicate concern        | Stop retries. Compare command and business facts.                                 | More than one authoritative effect exists.   |
| Refund concern           | Query the original refund and compensation receipt.                               | Tender or inventory compensation is unclear. |

Use `UMIPOS_SUPPORT_RUNBOOK.md` for full triage and escalation rules.
