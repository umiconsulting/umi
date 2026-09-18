# The tender path — one integrated payment, with a typed outcome for every attempt

_ADR · build-v3 · `merchant` schema · order + POS-checkout + fiscal cluster · 2026-09-16_

**Status:** PROPOSED (2026-09-16) — records the provider split the owner's plan already chose,
and fixes the invariants the till must hold before any provider call is written.
**Extends:** [`2026-09-08-cfdi-facturacion-fase-3-adr.md`](/home/jc/umi/docs/architecture/2026-09-08-cfdi-facturacion-fase-3-adr.md) (the PAC front and the CFDI state machine)
**Evidence:** [`2026-09-16-mexico-payments-and-fiscal.md`](/home/jc/umi/docs/research/2026-09-16-mexico-payments-and-fiscal.md) (primary sources, provider by provider)
**Workstream:** plan of record `docs/plans/2026-09-15-ultimate-platform-plan.md` §8G

---

## 1. Context — what is decided, and what is missing

The provider choice is made and the plan records it: **Conekta** is the payment gateway and a
**Mercado Libre terminal** handles physical card processing. What the plan calls for next is an
ADR that records both halves and says which tenders each owns (§8G step 1), because the two
halves fail differently and only one of them can be reached from the till today.

**What exists.** The contract already models `payment_unknown`, `outcome_unknown` and
`terminal_outcome_unknown`, and `pos-checkout.ts` refuses a stored result for an unknown:
_an unknown terminal outcome must be query-only_ (`packages/contract/src/pos-checkout.ts:127`).
`fiscal.ts` carries `CfdiDocument`, `CfdiStatus` (pending → stamped → cancelled) and the stamp
request, and `shared/adapters/facturapi.adapter.ts` is a working Facturapi REST adapter —
`createOrganization`, `stampInvoice`, `cancelInvoice` with SAT motives — with its own spec.

**What does not exist.** No Conekta client, no terminal adapter, no route that captures a card,
no stamping flow that calls the Fiscal adapter from a committed sale, no surcharge or
payment-level refund, and no test of the three outcomes as a sequence. The checkout can take
**cash only**: the tender screen offers exactly `Efectivo` (verified by hand on the native till).

## 2. Decision

### 2.1 Two halves, one tender surface, and neither half issues the CFDI

| Tender                                                           | Owner of the money     | Reached from                         |
| ---------------------------------------------------------------- | ---------------------- | ------------------------------------ |
| Card present — the customer's card                               | **Mercado Pago Point** | the Point device, ordered by our API |
| Card not present, and alternative methods (QR, SPEI, OXXO, BNPL) | **Conekta**            | our API, no device                   |
| Cash                                                             | the drawer             | already implemented, unchanged       |

**Neither provider issues the fiscal record.** That is the finding that shapes this ADR, and it
is primary-sourced on both sides: the Conekta documentation index has no stamping endpoint, no
UUID, no certificate upload and no cancellation, and mentions CFDI only as a merchant onboarding
document; Mercado Pago states that emission is not automatic for a Point sale. **Facturapi is the
PAC**, and the fiscal record is Umi's own state machine, not a provider's.

### 2.2 Three outcomes for every attempt, and the third one is the point

Every attempt ends in exactly one of **success**, **failure**, or **unknown**. The unknown is not
an error state to be retried blindly; it is a state with its own obligation:

1. **It must be recorded as unknown**, never as paid and never as failed.
2. **It must be queryable by the same command identity** — the same idempotency key that started
   the attempt asks the provider what happened to it. §8G step 3 says this in one line: an
   unknown result must be queryable by the same command identity.
3. **An operator's assertion is never provider proof.** "The customer says it went through" is
   not a capture, and it must not be storable as one.

The primary source for how often this happens is the terminal's own status flow
`created → at_terminal → processed | failed | action_required | canceled | expired`, where
**`action_required` means the terminal did not answer within 40 seconds and the status does not
change**. A till that treats that as failure is wrong; a till that treats it as success is worse.

### 2.3 Idempotency is our duty, because the provider does not do it for us

Conekta documents idempotency as a **duty of the merchant's webhook handler** — store the event
`id`, skip an event already processed, answer 2xx or the provider retries. It does **not**
document a request-idempotency header for order or charge creation (the research crawl of its
271-page index found the word only on the QR page, and marks the point UNVERIFIED — so the code
must not assume the header exists). Mercado Pago Point's failures include the terminal not
loading an order and the payment API having an interruption, with standalone charging as the
documented workaround.

So the identity of a payment attempt lives **on our side**: one command identity per attempt,
persisted before the provider is called, and the provider's own identifiers (order id, payment
id) written against it when they arrive.

### 2.4 The fiscal record is its own state machine, with a clock

`pending → stamped → cancelled`, the UUID, the RFC, the payment form and the payment method
stored on the sale, and the deadline **visible to the owner** rather than implied. The deadline
is not 24 hours from the sale: the SAT requires the CFDI to reach the PAC within 24 hours of the
operation, and the _global invoice_ for public sales within 24 hours after the close of the
chosen period (day, week or month) — so a café that invoices in the aggregate has a different
clock than one that stamps per ticket, and the owner has to be able to see which one is running.

Cancellation matters at café sizes: the issuer may cancel **without the receiver's acceptance
when the total is up to $1,000 MXN**, which is most single tickets.

### 2.5 The terminal is one adapter behind one interface

A second terminal brand must not touch checkout (§8G step 6). The interface is ours; the Point
device is its first implementation. Cash is a member of the same interface rather than a special
case above it, because the till's tender screen already treats it as one method among several.

### 2.6 A divided check is a decision the operator makes, not a side effect of a tap

The location's policy decides whether a sale MAY carry more than one tender
(`mixed_tender_enabled`, `maximum_tender_lines` in `merchant.pos_checkout_policy`). It does not
decide what a tap on a method tile means, and conflating the two produced the defect this section
fixes: wherever mixed tender was allowed, tapping a second tile silently built a split the operator
never asked for — two legs, both carrying a number, and a charge nobody chose.

**The rule.** A method tile replaces the selected method. A second method joins the sale only after
the operator arms `Dividir el pago`, and the mode is named on screen before any second tile is
tapped. Disarming returns the sale to one method, and it is refused while a card attempt is
unresolved, because an attempt the terminal may already have charged owns the sale.

**The order of the legs is the order the money is taken: cash first, then the card.** The cash leg is
what the drawer takes at the counter and what the change is measured from — a cash + card-terminal
split used to compare the drawer against the whole bill and report a shortfall on a bill that was
fully covered.

**A split that does not add up is not offered for charge.** The reading names the gap
(`Falta` / `Sobra`), and the charge button is inert until the legs cover the bill, so the refusal the
server would return (`REMAINING_BALANCE`, `TENDER_OVERALLOCATION`) is never the first the operator
hears of it.

**Where the policy forbids a split, the screen says so** rather than leaving the absent control to
be read as a missing feature.

**Proved by.** `apps/umi-pos/test/checkout_test.dart` (replace, arm/add, short/over, one-method note)
and `apps/umi-pos/test/checkout_point_tender_test.dart` (a cash + card-terminal split charges the
card for ITS leg, and a cash tap cannot drop a card the terminal may already have charged). Driven
for real on the native Linux till by `tools/ux-sweep/pos-native-flows.mjs`
(`tender-split-is-a-decision`), which passes on both a one-method location and one that allows a
split.

## 3. The invariants, and how each is proved

The plan's acceptance is three sentences. They are testable without a live merchant account,
which is why they come before the provider work:

| Invariant (§8G acceptance)                     | What must be true in the model                                                                                     | How it is proved                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **A retried payment never charges twice**      | One command identity per attempt; a retry of that identity returns the first attempt's own outcome, not a new call | A stateful test over the attempt sequence, plus a duplicate webhook replay |
| **A terminal timeout never marks a sale paid** | `action_required` and every unqueryable result store **unknown**, never `paid`; `queryOnly` is enforced by schema  | The existing contract invariant, extended to the capture flow, plus a spec |
| **A cancelled sale cancels its fiscal record** | Cancellation is one command that cancels the CFDI and the sale together, with the SAT motive recorded              | An integration test against a disposable database and the fiscal fake      |

`fast-check` is the tool for the stateful sequence (§8G Tools), and the fiscal provider gets a
fake so the sequence is provable without a stamp.

## 4. What this changes

- **The tender screen gains methods.** It offers `Efectivo` and nothing else today; the interface
  above is what makes the second and third methods additive rather than a rewrite.
- **The checkout gains an attempt record** keyed by command identity, with the provider's order
  and payment ids on it, written before the provider call and updated after.
- **The fiscal path gains a caller.** `facturapi.adapter.ts` exists and nothing calls it from a
  committed sale; the stamp becomes a step of the commit, with its own state.
- **The provider sandboxes are the verification, not the production account:** Conekta's sandbox
  and the Point integration sandbox, with webhook replay for a duplicate and a late event.

## 5. Consequences to accept

- **Two providers means two reconciliations.** The Point terminal reports its own settlements,
  and the research records that matching a terminal payment to a POS sale is a known chore. The
  attempt record is what makes that match possible; without it the café reconciles by hand.
- **An unknown can sit unknown for a while.** The till must show it and the owner must be able to
  clear it deliberately; a system that hides the unknown has converted it into a false success.
- **The QR documentation is not trustworthy yet.** Conekta's published QR page carries an
  internal "Security Review Required — do not publish until reviewed" block and an unresolved
  header name, so the QR flow is the last of the online methods to implement, not the first.
- **Nothing here is live until credentials exist.** This ADR fixes the model and the invariants;
  it does not claim a capture has ever been taken.
