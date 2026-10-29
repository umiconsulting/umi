# Issue 08: reports and inventory trust

Status: repeated independent complaint.

## Operator scenario

The owner checks a sale, a payout, or a stock count after service. The report
differs from the terminal. A pending write is missing. A stock edit hides or
removes another value.

## Independent evidence

| Product         | Language   | Evidence                                                                  | Source                                                                          |
| --------------- | ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Clover          | English    | The app returned to the previous screen from closeout and finance tabs.   | [App Store](https://apps.apple.com/us/app/clover-go-dashboard-pos/id969311778)  |
| Clover          | English    | A reviewer lost the inventory quantity view after an update.              | [App Store](https://apps.apple.com/us/app/clover-go-dashboard-pos/id969311778)  |
| Square          | English    | A reviewer reported that an inventory operation removed other stock.      | [App Store](https://apps.apple.com/us/app/square-point-of-sale-pos/id335393788) |
| Soft Restaurant | Spanish MX | A user reported a sale report that differed from the terminal.            | [App Store](https://apps.apple.com/mx/app/sr-admin/id6575394645)                |
| Odoo            | Spanish MX | A reviewer could not see product descriptions in a three-warehouse view.  | [Google Play](https://play.google.com/store/apps/details?id=com.odoo.mobile)    |
| Toast           | English    | A reviewer found mobile sales data slower and less complete than the web. | [App Store](https://apps.apple.com/us/app/toast-now/id6444586410)               |

## Diagnosis

**I:** a report is not current until the journal is empty. The owner needs the
same facts as the sale:

- accepted server facts;
- pending local work;
- conflicts that need a person.

## Recommendation

1. Mark every report as `Current`, `Pending replay`, or `Conflict`.
2. Show the last accepted time for each total.
3. Keep row-level audit history for stock changes.
4. Preview the exact rows before a bulk inventory edit.
5. Reconcile sale, tender, and stock totals.

## Acceptance scenario

1. Complete one cash sale and one split sale.
2. Leave one command in the journal.
3. Open the owner report.
4. Confirm the report marks one fact as pending.
5. Replay the command.
6. Confirm the report changes once and the stock ledger matches.

The scenario fails if a report hides pending work or counts it twice.

## Priority

Frequency: 3

User cost: 4

Money/data risk: 4

Recovery difficulty: 3

Umi fit: 4

Total: 18
