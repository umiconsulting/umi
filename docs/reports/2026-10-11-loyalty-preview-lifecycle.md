# The loyalty earn preview: refreshed and renewed, so a sale cannot be stranded

Date: 11 October 2026, 13:30–13:47 UTC (06:30–06:47 MST). Device: iMin D3-504, Estación build from
this tree; demo API on `:4013` rebuilt and restarted from this tree (log now
`/tmp/umi-api-4013-new.log`), demo database `umi_pos_estacion_design_20261008`.

`2026-10-11-imin-customer-sale-refused.md` closed the reasons a customer-attached sale could not be
charged at all. This closes the next layer: what happens to the preview the closeout asserts when
**time passes** or the **command around it changes**. Both stranded a real sale, and both are
measured below.

## Trap A — the window closed and could never reopen

`merchant.loyalty_earn_preview` holds ONE row per (merchant, cart, checkout version, customer, policy
version), it is append-only, and its `preview_fingerprint` is deterministic: the same cart, customer
and policy produce the same fingerprint every time. The API wrote it with
`ON CONFLICT (merchant_id, preview_fingerprint) DO NOTHING`, so asking again for the same checkout
version changed nothing and handed back the row that was already there — including an **expired**
one. The closeout asserts the preview the command names and refuses it once it has expired
(`merchant.assert_loyalty_earn_preview`), so the cart could never be charged again on that version.
Measured on 11 October: cart `fbab20bd…` version 12, preview expired 12:14:33, the retry at 12:17:04
re-previewed, the panel filled, and the commit was still refused with `LOYALTY_PREVIEW_STALE`. The
operator's only way out was to abandon the sale.

## Trap B — the command moved and the row could not follow it

The fingerprint the closeout compares against is computed OVER THE COMMAND, including its tender
drafts. An operator who corrects the cash received after the preview was taken (the customer hands
over a 500 note) changes that basis; the new computation has a _different_ preview fingerprint, so
the insert missed its `(merchant_id, preview_fingerprint)` conflict target and landed on the
five-column unique instead — a duplicate-key 500 at 12:07:05 the same night, and again tonight at
13:37:44 as `LOYALTY_PREVIEW_STALE` with the till saying only "No fue posible completar el cobro de
forma segura."

## The fix, in the schema and in the API

`docs/migration/build-v3/40_loyalty_earn_preview_lifecycle.sql` adds two `security definer` functions
and grants them to the till's own role:

- **`merchant.replace_loyalty_earn_preview`** writes the preview for a checkout version by REPLACING
  the row that version already has: the newest computation wins, with its own fingerprints, its own
  numbers and a fresh window. That is the shape the five-column unique already expresses — one live
  preview per version — and it is what makes a re-preview mean something. A preview a committed sale
  already points at is never removed (`loyalty_sale_policy_snapshot.earn_preview_id` is
  `on delete restrict`).
- **`merchant.renew_loyalty_earn_preview`** widens the window of the row a command names, and only
  while that row is expired: for the till that does NOT ask again — the sheet that sat on its
  confirmation screen past the TTL and then charges with the preview it holds. The window is capped
  at the loyalty program's own `policy_expires_at`.

Both lift the append-only guard for one statement at a time through the helper that exists for that
(`merchant.with_append_only_writable`, `20_merchant.sql`), so the till's role still has no `update`
or `delete` on the table — verified: a plain `update` is still refused
(`table merchant.loyalty_earn_preview is append-only; UPDATE is not permitted`) and the trigger is
back in place after each call.

The API uses them: `pos-customer-value.repository.ts` writes the preview through the replace, and
`pos-checkout.repository.ts` renews the pair the commit names, immediately before
`commit_customer_value_closeout`. The window itself lives in one place
(`shared/loyalty/preview-window.ts`).

## What was verified, and how

**The SQL, on the demo database.** `renew_loyalty_earn_preview` called on the expired version-12 row
returned a new expiry 300 s out, left `created_at` and the row's identity untouched, and a second
call on the now-fresh row returned the existing expiry without moving it.

**Trap A, on the till.** The preview row of a live cart (version 7) was aged out of its window
(fixture: the trigger lifted for one statement, exactly as the last night's trap left it), the till
re-previewed on its way to the charge, and the commit that had been refused at 12:17 answered
**201 with the sale committed** — the row's story in the database tells it:

```
before   cart 67cb3dea v7   created_at 13:36:32   expires_at 13:36:35 (fixture-expired)
after    cart 67cb3dea v7   created_at 13:42:40   expires_at 13:47:40 (replaced, fresh)
commit   13:43:13.134  POST /checkout 201
```

The identity did not move: both rows carry `preview_fingerprint 8e032776…` and
`checkout_fingerprint 8ed3792d…`, which is what "the same computation, a new window" means.

**No regression on the plain path, with the same deployed build.** A fresh sale with the customer
attached (Americano, MXN 45.00) committed: `pos_committed_sale` b2a7fe3d at 13:46:18, the preview
row written fresh for that version, and `loyalty_points_ledger` taking `points_earn_pending` 45 —
the same shape that succeeded at 12:18 with the old code.

## And then the same two, from the till's side (14:00–14:04 UTC)

Two client defects came out of the same walk. Both are closed and verified now.

**Trap B, on the till's side of the wire.** The pair is keyed on the command WITHOUT its customer
value — the basis — and the sheet used to ask for the preview once per (customer, cart version),
with nothing else in the key. So a tender corrected after the preview (the customer hands over a 500
note) moved the basis and left the row naming a command that no longer existed: the commit answered
`LOYALTY_PREVIEW_STALE` at 13:37:44, with the till saying only "No fue posible completar el cobro de
forma segura." The sheet now asks ONLY while the command carries no value — the only moment its
fingerprint IS the basis — keys the row on that fingerprint, and (for the plain loyalty-earn sale)
takes the value out, reviews once to get the basis, and puts it back. That is what re-keys a value
that was already applied on the confirmation screen.

**A tip could not be collected at all** — found while hunting the traps above, and it is a core café
flow. The server adds the tip to the amount due (`amountDue = discountedSubtotal + tipAmount`) and
checks the tenders cover it, while the till's applied legs were balanced against the BILL alone: a
10 % tip on MXN 326.00 left the sheet reading `Falta por cobrar MXN 32.60`, with nothing able to
raise the applied amount and a charge refused as a remaining balance. The tenders are now balanced
against `_dueMinorUnits` — the server's own amount due once a review has come back, and before that
the same arithmetic the calculator applies (the discount, then the tip on the discounted subtotal) —
and a tip or a discount re-seeds them.

Verified on the till, in two sales, with the rebuild installed:

| Sale                                                   | What happened                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MXN 371.00 + 10 % tip, no customer                     | `Efectivo recibido` read **408.10** as soon as the tip was chosen; the confirmation screen offered the repriced total; the charge answered **`Pagado · MXN 408.10`** (`pos_committed_sale` b185a6ce at 14:00:49).                                                                                                                                                                                                                           |
| MXN 45.00 + 10 % tip, Cliente Piloto, tender corrected | The tip took `Efectivo recibido` to 49.50 and the first preview was taken (14:02:42.98); the operator then tapped the `MXN 500.00` note, which moved the basis; the charge re-keyed the preview — the single row for that checkout version was REPLACED (created at 14:03:38.65, a new basis `199e7583…`, fresh window) — and the commit answered 201: **`Pagado · MXN 49.50`, `Cambio a dar MXN 450.50`** (`pos_committed_sale` 33e681bc). |

Guards, both checked both ways: _"a tip is collected: the tender covers the amount due it creates"_
(fails without the due-inclusive balance: the tender applies 116.00 where 127.60 is required) and
_"a tender corrected after the preview re-keys the pair before the charge"_ (fails with the
version-only preview key: one request instead of two, and a commit naming a preview the corrected
command was never keyed on). POS suite: **692 tests**.

## The wallet, walked next, and left standing — what it needs

The stored-value (wallet) family is the next money path, and the walk of it is written down rather
than half-fixed. On the till, with `Cliente Piloto` (wallet MXN 500.00) and a MXN 45.00 bill:

1. The wallet row is only drawn once a PREVIEW exists, and the preview only exists once a review has
   come back — so a fresh sheet offers no `Aplicar` at all. The two ways in are a recovered checkout
   draft (which carries a confirmation) and the confirmation screen a tip or a discount produces.
2. `Aplicar` → `Importe autorizado` → 20.00 → `Autorizar` works: `POST …/customer-value/stored-value/authorize`
   answers 201 and the panel's wallet drops to `MXN 480.00`.
3. **The charge then over-allocates.** The wallet leg and the cash leg are tendered side by side and
   the cash leg is never told about the wallet, so the sale applies `MXN 65.00` (the whole 45.00 bill
   plus 20.00 from the wallet) against a 45.00 due. The commit is refused for it (201 with a failure
   body) and the sheet shows NOTHING — no notice, no error, the tender screen exactly as it was.
4. **Rebalancing the legs and re-keying the basis together makes it worse.** With the cash leg
   reduced to the remainder (29.50) and the basis probe standing the wallet aside, the till re-issued
   the authorization — the wallet went 500 → 480 → 460 — over a sale that still would not close
   (`Importe aplicado MXN 69.50`). That attempt was reverted: a stored value's authorization is bound
   to the preview it was asked against, so the earn row, the tender legs and the authorization have
   to be re-issued together, and that is a design pass of its own. `_makeValuePairWhole` says so where
   the gate sits.

Also measured on the way: the sheet's own tender reading (`Falta por cobrar MXN 20.00`) does not count
stored-value legs, so a wallet that covers part of the bill reads as a shortfall that is not there.
The count of it is right for cash and terminal legs and blind to the wallet's.
