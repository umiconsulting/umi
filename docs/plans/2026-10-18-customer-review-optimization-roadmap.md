# Customer-review optimization roadmap

Date: 2026-10-18

## Outcome

Make Umi feel immediate, keep staff work safe, and make check splitting match
the guest conversation.

The evidence is in
[the customer-review cascade](../research/2026-10-18-customer-review-cascade/README.md).

## Current verified state

| Slice | State | Evidence |
| --- | --- | --- |
| One start action and table-first account | Verified on iMin | [Build 169 report](../reports/2026-10-18-account-first-interaction-slice.md) |
| Account split entry and one ledger | Verified on iMin | [Build 170 report](../reports/2026-10-18-account-split-slice.md) |
| Portable table state | Verified on A11 | [Device report](../reports/2026-10-18-manual-end-to-end-devices.md) |
| KDS item ready and ticket complete | Verified on A9 | [Device report](../reports/2026-10-18-manual-end-to-end-devices.md) |
| Replay after an ended operator session | Verified on staging | [Replay report](../reports/2026-10-18-offline-replay-authority.md) |
| Repeat one configured line | Implemented and tested | Build 172 test suite |
| Tap budget under peak cart load | Partial | Product add measured at 155 ms; peak run is open |
| Equal and item split proposals | Open | Needs contract work |
| LAN KDS write with no WAN | Open | Needs peer and network run |

## Priority 0 — trust under load

### 1. Set and enforce a tap-response budget

- Measure product add, table change, kitchen send and split open on the iMin.
- Show an accepted, queued or refused state in less than 100 ms.
- Keep one command identity for a repeated tap.
- Fail the test if the screen shows no change or creates a duplicate line.

### 2. Prove restart recovery during order entry

- Start a dine-in account with an unsent second round.
- Kill the app before the write reaches the server.
- Reopen it and prove the account, table, modifiers and lines return.
- Prove the queue sends each command once.

### 3. Prove a financial split does not create kitchen work

- Count kitchen commands before and after the split.
- Create a two-way payment split.
- Prove the count is unchanged.
- Prove one account remains and `Remaining` falls after a part payment.

### 4. Prove the local service network without WAN

- Disconnect the TP-Link WAN.
- Keep the iMin host, A11 peer and A9 KDS on the service SSID.
- Prove POS writes, KDS updates and table state stay live.
- Restore WAN and prove one replay per command.

## Priority 1 — clear account work

### 5. Separate the split jobs

- Use `Split payment` for amount and equal-N allocation.
- Add `Split by item` for a guest's products.
- Use `Split check` only when item or seat allocation exists.
- Keep the balance summary fixed on the payment surface.

### 6. Turn the account list into a work queue

- Show the account folio, table, party, balance and service state.
- Show one next action for each account.
- Keep secondary actions in one menu.

### 7. Make device recovery a visible but separate job

- Show printer, KDS and network status beside the account.
- Keep sales and kitchen tickets durable when a device is absent.
- Give one action for the failed device.
- Do not block payment from a printer failure.

## Priority 2 — reduce repeated staff work

### 8. Add line actions where they happen

- Repeat, quantity, modifiers and void.
- Move to another open account only when the command is supported.
- Keep kitchen-sent lines under the existing permission rules.

### 9. Recover from a stale open-account conflict

- Make `Confirm reconciliation` use the current recovery run.
- Disable it while recovery is active and say why.
- Show the result of the acknowledgement.
- Add a test with a running replay and an older open conflict.
- Status: replay authority now uses the live session while it keeps the original
  operator for attribution. The visible spinner reset remains open.

### 10. Preserve local identity through a restart

- Keep the operator session and order working copy separate.
- Lock financial authority at expiry.
- Return to the same screen after a restart.
- Do not require the network to reopen an order in progress.

## Order and dependencies

| Order | Change | Depends on |
| --- | --- | --- |
| 1 | Tap response budget | Device latency probe |
| 2 | Restart recovery proof | Local working copy |
| 3 | Split kitchen-command test | Payment ledger |
| 4 | No-WAN service proof | Main host, peer and KDS |
| 5 | Split job separation | Server item-allocation contract |
| 6 | Account work queue | Authoritative balance data |
| 7 | Device recovery surface | Hardware status |
| 8 | Line action sheet | Transfer contract |
| 9 | Reconciliation recovery | Replay state test |
| 10 | Local identity through restart | Session and storage design |

## Measurement

- Tap-to-visible-response p50 and p95 by action.
- Duplicate line rate per 100 taps.
- Unsent order recovery rate after a forced stop.
- Split completion time and abandoned split count.
- Kitchen commands created by one financial split.
- Local POS and KDS availability during a WAN outage.
- Pending queue depth and age after reconnect.

