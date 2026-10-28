# Issue 03: split check and early departure

Status: repeated independent complaint.

## Operator scenario

One guest must leave before the table finishes. The guest wants to pay a known amount. The rest of the account stays open.

## Independent evidence

| Product    | Language   | Evidence                                                                                                         | Source                                                                                                                                       |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Square     | English    | A small-tavern owner reports difficulty with split checks.                                                       | Square Community                                                                                                                             |
| Square     | English    | A user says item split and seat split are hard to discover in Square for Restaurants.                            | Square Community, 2019-06-17                                                                                                                 |
| Square     | English    | Users ask for a single-item split for shared food and wine.                                                      | Square Feature Requests, 2017 to 2023                                                                                                        |
| Square     | English    | A guest who leaves early must move items to a new check.                                                         | Square Community, 2023-03-12                                                                                                                 |
| Square     | English    | A user reports that each split payment adds 15 to 20 seconds because the operator must return to the floor plan. | Square Community, 2023-03-25                                                                                                                 |
| Toast      | English    | A split of four requires the waiter to type each amount and can create input errors.                             | Toast Community, 2025-02-02                                                                                                                  |
| Lightspeed | English    | One reviewer calls check splitting the most laborious split flow used.                                           | Software Advice review, 2017                                                                                                                 |
| Fudo       | Spanish MX | A reviewer says opening an account, paying and creating an account are all complicated.                          | App Store MX, 2026-01-07                                                                                                                     |
| Square     | English    | A split ticket reached the KDS again and the kitchen made duplicate food.                                        | [Square Community](https://community.squareup.com/t5/Payments-Troubleshooting/Square-KDS-Duplicate-Tickets-when-Splitting-Checks/m-p/241602) |
| Square     | English    | A tavern owner paid for Restaurants Plus only to split checks.                                                   | [Square Community](https://community.squareup.com/t5/Food-Beverage/Square-for-Restaurants-Plus-splitting-a-check/m-p/823452)                 |
| Square     | English    | Square Terminal did not allow split payments from the main iPad flow.                                            | [Square Community](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Square-Terminal-for-Split-payment/m-p/736487)                 |
| Odoo       | English    | Standard Odoo split by product or customer but not equally.                                                      | [Reddit](https://www.reddit.com/r/Odoo/comments/1sn2dwr/odoo_pos_split_bill_equally/)                                                        |
| Toast      | English    | Suggested tips used a pre-discount base after a kitchen comp.                                                    | [Reddit](https://www.reddit.com/r/ToastPOS/comments/1u2juo3/toast_calculating_tips_on_prediscount_totals_for/)                               |
| Clover     | English    | Open pre-auth tabs assigned tips to the employee who opened the tab.                                             | [Reddit](https://www.reddit.com/r/CloverPOS/comments/1ba9y68/pre_auth_confuses_tips_from_open_orders_at_shift/)                              |

**IV:** The strongest repeated complaint is not the absence of a split. It is the number of manual steps and the loss of account context.

## Vendor behavior

**HD:** Square, Toast and Lightspeed document check split and payment split.

**HD:** Fudo documents partial payment with the account total, amount, method and tip on one screen.

**I:** The vendors separate item ownership, payment allocation and kitchen production. The operator must understand all three.

## Cascade across languages

The English Square and Toast reports and the Spanish Fudo report converge on one problem. The operator must translate a guest sentence into several system actions.

The operator thinks: “Ana pays fifty and leaves.” The system often asks for item moves, a new check, a payment screen and a floor-plan return.

The cascade adds a hard constraint. A financial split must have **no kitchen
side effect**. The Square duplicate-ticket report is the exact failure that Umi's
one-ledger design must prevent.

## Umi current flow

**HL:** Umi keeps one account ledger for partial payments.

Build 169 installed the first account-first slice on the iMin. The next slice adds `Split check` to the account action group. It opens the partial ledger directly.

Evidence:

- `apps/umi-pos/lib/features/checkout/checkout_surface.dart`
- `apps/umi-pos/lib/features/checkout/partial_checkout_surface.dart`
- `apps/umi-pos/lib/features/catalog/catalog_surface.dart`
- `apps/umi-pos/test/order_entry_flow_test.dart`
  - `account split check opens the one-account ledger directly`
  - `split check is absent when the checkout cannot split`
- `apps/umi-pos/test/partial_checkout_test.dart`

The account action uses the same ledger. It does not create an empty check. It does not resend a kitchen ticket.

## Gap

**I:** Umi can split by amount from the account. It lacks equal and item/seat proposals.

The next split slice must add:

- equal split with exact remaining cents;
- amount split;
- item or seat proposal with an unassigned-item check;
- a fixed summary: total, paid, this portion, tip, charge now and remaining.

## Acceptance scenario

1. Open an account for MXN 420.00.
2. Tap `Split check` from the account.
3. Pay MXN 120.00 and add a MXN 20.00 tip.
4. Confirm charge now is MXN 140.00.
5. Confirm remaining is MXN 300.00.
6. Leave the account open.
7. Pay the other MXN 300.00.
8. Confirm one account and one closed sale.
9. Confirm the kitchen ticket count does not change.

## Priority

Frequency: 4

User cost: 4

Money risk: 5

Recovery difficulty: 4

Umi fit: 5

Total: 22
