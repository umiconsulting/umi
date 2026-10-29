# Account-first interaction model

Date: 2026-10-18

## Outcome

Make the account the first object. The table is the account location. The order
screen edits the account. The map, list, order and payment screens use the same
account identity and the same next action.

This plan follows the competitor review in
[Table, account and split-check flows](../research/2026-10-18-pos-table-account-flow/README.md).

## Preserved invariants

- Keep `umi-api` as the owner of financial writes.
- Keep the existing `dine_in` and `takeout` fulfillment types.
- Do not invent a counter fulfillment type.
- Keep one account ledger for partial payments.
- Do not resend kitchen tickets for a financial split.
- Do not turn a paid table into a free table.
- Keep offline journal behavior and current recovery rules.

## Stage 1: Interaction model

### Slice 1 — Start and identify

Status: implemented in build 169.

- One `Start order` action replaces `New account` and `New account without table`.
- The action asks `Dine in` or `Takeaway`.
- `Dine in` chooses the table before the first product.
- `Takeaway` keeps the account tableless.
- Occupied table cards show the open account folio.
- The table panel shows the account folio.
- The account list shows the operator name.

### Slice 1 — One next action

Status: implemented in build 169.

- An account table shows `Resume account` as the primary action.
- A table with guests and no account shows `Open account`.
- A free table shows `Seat` as the primary action.
- A dirty table shows `Mark ready` as the primary action.
- Secondary actions keep lower visual weight.

### Slice 2 — Split from the account

Status: implemented in build 170.

- Add `Split check` to the account action group.
- Open the existing partial-payment ledger directly.
- Do not require the operator to enter checkout first.
- Show `Total`, `Paid`, `This charge`, `Tip`, `Charge now` and `Remaining`.
- Keep the one-account ledger.
- Keep the action visible when the checkout supports partial payments.
- Disable it when the account is empty, a cart write is active, or the device
  cannot collect partial payments.
- Hide it when the checkout has no partial-payment repository.

### Slice 3 — Edit the line

Status: partially implemented in build 171.

- Open a line action sheet from each order line.
- Keep quantity, modifiers, repeat and void.
- Add seat or course only when the contract supports the value.
- Add move to another account only through a supported API command.
- Do not invent local-only assignment that the server cannot replay.
- Repeat now adds the same confirmed configuration from the line.
- Move to another account remains deferred because no line-move command exists.

### Slice 4 — Richer map cards

Status: partially planned.

- Add party size and account folio to the map state.
- Add account total when the map receives open-account data.
- Add server and customer only from authoritative account fields.
- Keep state text and icon. Do not rely on color alone.

## Acceptance flow

Run this flow on the iMin and the A11:

1. Tap `Start order`.
2. Choose `Dine in`.
3. Choose a free table.
4. Add an item.
5. Send the item to the kitchen.
6. Save the account and return to Accounts.
7. Find the account in Map and List.
8. Resume the account from the table.
9. Add a second round.
10. Split the charge.
11. Pay one part with a tip.
12. Check the remaining balance.

The flow fails when the operator must guess which account is open, which action
is next, or whether a table is occupied and paid.

## Stage 2: Customer-review research

Status: completed for the eight core competitors, Parrot, and the adjacent
regional providers recorded in the review inventory.

### Source pass

Build one competitor inventory from the repository. For each competitor, search
official documentation, help centers, app-store reviews, community posts,
YouTube walkthroughs, partner reviews and local-language sources.

Use English and Spanish first. Add Portuguese, French or another language when
the product serves that market.

The first cross-provider pass is in
[Customer-review cascade](../research/2026-10-18-customer-review-cascade/README.md).
The implementation order is in
[Customer-review optimization roadmap](../plans/2026-10-18-customer-review-optimization-roadmap.md).

### Cascade rule

Each complaint starts a new search branch:

1. Record the exact screen, action, charge or state named by the reviewer.
2. Search the same complaint across other reviewers and languages.
3. Check official documentation and screenshots for the intended behavior.
4. Trace the local Umi flow for the same failure mode.
5. Decide the user cost, frequency and severity.
6. Add an acceptance test or mark the issue unverified.

Do not stop at one review. Do not count repeated copies of one review as
independent evidence.

### Review priority

Rank each issue by:

- frequency across independent sources;
- user cost;
- money or data risk;
- recovery difficulty;
- fit with Umi's operating model;
- strength of the evidence.

### Final output

Produce a review-backed optimization plan. Include:

- one table for all competitors;
- one evidence file for each repeated complaint;
- one Umi gap for each evidence-backed issue;
- one acceptance scenario for each proposed change;
- a priority order for the next implementation slices.

The output is the
[review cascade](../research/2026-10-18-customer-review-cascade/README.md) and
the [optimization roadmap](../plans/2026-10-18-customer-review-optimization-roadmap.md).
