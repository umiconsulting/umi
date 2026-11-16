# Metadata plan — W1 typed catalogue metadata

Base: `dd46278d0bdbdfee4935b93c1955c9ec62fb76eb`.
Scope: typed inclusion, exclusion and denominator data for the 15 metric
definitions. Data only. No SQL change.

## Policy tokens

The metadata uses one closed union. Each token names one fact policy.

| Token                        | Meaning                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `committed_sale`             | A row in `merchant.pos_committed_sale`.                          |
| `uncommitted_sale`           | A cart or payment attempt before commit.                         |
| `void_adjustment`            | A committed `void` exception in `merchant.pos_sale_exception`.   |
| `refund_adjustment`          | A committed `full_refund` or `partial_refund` exception.         |
| `uncommitted_exception`      | An exception with a status other than `committed`.               |
| `committed_tender`           | A `merchant.pos_tender_fact` row with status `committed`.        |
| `uncommitted_tender`         | A tender fact with a status other than `committed`.              |
| `customer_value_allocation`  | A row in `merchant.customer_value_tender_allocation`.            |
| `business_date_window`       | The request window on `receipt_snapshot.business_date`.          |
| `prior_business_date_window` | The equally sized window before the request window.              |
| `captured_at_cutoff`         | The `committed_at <= capturedAt` cutoff.                         |
| `location_scope`             | The effective location filter and the row-level security policy. |
| `sale_business_date`         | Refund attribution to the business date of the original sale.    |
| `refund_tip`                 | The `tip_minor_units` part of an exception amount.               |
| `tender_dedupe`              | Collapse a tender fact and an allocation into one item.          |

An `X_adjustment` token is a fact that changes a money total. A metric that does
not apply the fact lists it as excluded. This is not the same as a claim that the
sale row is absent.

## Per-metric mapping

All sale, line and preset metrics read `merchant.pos_committed_sale s` joined to
`merchant.receipt_snapshot r`. The join is `apps/umi-api/src/modules/metrics/metrics.repository.ts:77-78`.
The window and location filter is `metrics.repository.ts:83-84`:
`s.merchant_id=$1::uuid AND r.business_date BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR s.location_id=$4::uuid)`.
The service passes the effective location to `runWithMerchant` (`metrics.repository.ts:133`, `:238`).

| id                 | included facts                                                                                                                                 | excluded facts                                                                                    | denominator      | proof (file:line + the SQL clause)                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `net_sales`        | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `not_applicable` | `metrics.repository.ts:77-84` base join and window; `:257` `coalesce(sum(r.grand_total),0)::bigint AS net`; `:302` assigns `net`. A void or refund is not subtracted (`:283` is the only exception read).                                                                                                                                                                  |
| `orders`           | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `not_applicable` | `metrics.repository.ts:77-84`; `:257` `count(*)::bigint AS orders`; `:303` assigns `orders`.                                                                                                                                                                                                                                                                               |
| `average_ticket`   | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `orders`         | `metrics.repository.ts:304` `averageTicket(net, orders)`; `metrics.formulas.ts:51-53` `orders ? Math.round(netSales / orders) : 0`. The unit is currency, so the quotient is a per-ticket value, not a `unit: 'ratio'` metric.                                                                                                                                             |
| `items_sold`       | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `not_applicable` | `metrics.repository.ts:264-272` `JOIN merchant.pos_cart_line cl ON cl.cart_id=s.cart_id` and `coalesce(sum(cl.quantity),0)::bigint AS units`; `:305` assigns `items`.                                                                                                                                                                                                      |
| `units_per_ticket` | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `orders`         | `metrics.repository.ts:306` `unitsPerTicket(orders, items)`; `metrics.formulas.ts:59-63` returns null at zero orders, 0 at zero items, else `floor((items * 20000 + orders) / (2 * orders)) / 10000`.                                                                                                                                                                      |
| `discounts`        | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `not_applicable` | `metrics.repository.ts:258` `coalesce(sum((r.snapshot->'discountTotal'->>'minorUnits')::bigint),0)::bigint AS discount`; `:307` assigns `discounts`.                                                                                                                                                                                                                       |
| `tips`             | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `not_applicable` | `metrics.repository.ts:259` `coalesce(sum((r.snapshot->'tip'->>'minorUnits')::bigint),0)::bigint AS tips`; `:308` assigns `tips`. A refund does not subtract from this metric.                                                                                                                                                                                             |
| `prior_net_sales`  | `committed_sale`, `prior_business_date_window`, `location_scope`                                                                               | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `not_applicable` | `metrics.repository.ts:273-280` uses `window.priorStart` and `window.priorEnd`; `metrics.formulas.ts:23-48` builds the equally sized prior window; `:309` assigns `prior`.                                                                                                                                                                                                 |
| `refunds`          | `committed_sale`, `void_adjustment`, `refund_adjustment`, `business_date_window`, `location_scope`, `sale_business_date`, `captured_at_cutoff` | `uncommitted_sale`, `uncommitted_exception`, `refund_tip`                                         | `not_applicable` | `metrics.repository.ts:281-290` `sum(x.total_minor_units - x.tip_minor_units)` with `x.status='committed'`, `r.business_date` window and `x.committed_at <= $5::timestamptz`. `db/34_pos_exception.sql:75` allows `void`, `full_refund` and `partial_refund`; the query has no type filter, so all three are included. `db/34_pos_exception.sql:113` gives the status set. |
| `payment_mix`      | `committed_sale`, `business_date_window`, `location_scope`, `committed_tender`, `customer_value_allocation`                                    | `uncommitted_sale`, `uncommitted_tender`, `void_adjustment`, `refund_adjustment`, `tender_dedupe` | `not_applicable` | `metrics.repository.ts:489-518`: the first branch reads `pos_tender_fact` with `tf.status='committed'` (`:494`); the second branch reads `customer_value_tender_allocation` (`:498-502`); `UNION ALL` (`:497`) keeps both rows. No dedupe.                                                                                                                                 |
| `channel_mix`      | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `not_applicable` | `metrics.repository.ts:521-546` groups by `coalesce(s.origin_channel,'walk_in')` and sums `r.grand_total` over the base join and window.                                                                                                                                                                                                                                   |
| `product_mix`      | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `not_applicable` | `metrics.repository.ts:548-582` groups by `cl.product_id`; `sum(cl.quantity)` for units and `sum(cl.quantity*(cl.base_price+cl.variant_delta+cl.modifier_total))` for merchandise over the base join and window.                                                                                                                                                           |
| `operator_mix`     | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `not_applicable` | `metrics.repository.ts:584-612` groups by `coalesce(st.name,'—')` through `cash_shift` and `staff`, with the line quantity and merchandise sums.                                                                                                                                                                                                                           |
| `hour_mix`         | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `not_applicable` | `metrics.repository.ts:614-642` groups by `to_char((s.committed_at AT TIME ZONE $5), 'HH24')` with the line quantity and merchandise sums.                                                                                                                                                                                                                                 |
| `series`           | `committed_sale`, `business_date_window`, `location_scope`                                                                                     | `uncommitted_sale`, `void_adjustment`, `refund_adjustment`                                        | `not_applicable` | `metrics.repository.ts:644-673` groups by `r.business_date::text` for a day range or by local hour for an hour range, and sums `r.grand_total`.                                                                                                                                                                                                                            |

## Invariants

1. The 15 ids equal `METRIC_IDS` in `packages/contract/src/metrics.ts:14-30`.
2. Every token is in the closed union.
3. No metric includes and excludes the same token.
4. Every metric includes `committed_sale` or `committed_tender`.
5. Every metric includes one window token. Only `prior_net_sales` uses the prior window.
6. Every metric includes `location_scope`.
7. Every quotient formula names `orders`. `average_ticket` and `units_per_ticket` are the two quotients.
8. Every other metric states `not_applicable`.
9. A denominator names an existing metric. The named metric has no denominator.
10. `refunds` includes `void_adjustment` and `refund_adjustment`. Every other metric excludes both.
11. `payment_mix` includes both payment sources and excludes `tender_dedupe`.

## Expected diff surface

| File                                                       | Change                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/umi-api/src/modules/metrics/metrics.catalog.ts`      | Add the policy union, the denominator union, 15 `includes` and `excludes` lists, 15 `denominator` fields. |
| `apps/umi-api/src/modules/metrics/metrics.catalog.spec.ts` | New invariant tests.                                                                                      |
| `.gate3/METADATA-PLAN.md`                                  | This file.                                                                                                |

No change: SQL, formula text, rounding, null policy, public contract `2.58.0`,
`definitionVersion` `1.0.0`, response bytes, schema, dependency.
