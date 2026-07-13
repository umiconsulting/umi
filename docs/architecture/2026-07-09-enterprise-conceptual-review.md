# Umi Platform — Enterprise Conceptual Review of build-v2

*A yardstick review conducted in strict ANSI/SPARC order: **Enterprise Reality → Conceptual → Logical → Physical**. Every claim is grounded in the restored complete production database (`umi_prod_snapshot`). Software artifacts — table names, column names, framework words — are treated as unreliable hints; business meaning is derived from actual rows, distinct values, cardinalities, and joins. build-v2 (the assembled `umi_backfill_dev`, DDL in `docs/migration/build-v2/*.sql`) is the hypothesis under test.*

---

## Executive Summary

**Verdict: build-v2 is a *directionally faithful* model of the enterprise — roughly 70% faithful — but it is not yet a *pristine* one.** Its one great strength is that it correctly discovered the deepest truth in the data: **this is two enterprises, not one** — Umi (a SaaS vendor) selling a loyalty-and-WhatsApp-ordering product to independent Mexican cafés — and it renders that boundary as its top-level schema split (`umi` sealed / café-world RLS-scoped). That skeleton is right and should be preserved.

But build-v2 then distorts the enterprise in five systematic ways, and every one of them lands directly on the owner's stated pain — **legibility, standardized names, explicit layers**. The model invents an identity-resolution apparatus the enterprise never exercises, hides business concepts behind framework words, re-imports concepts the enterprise struck, stores derived money/stamp totals as if they were facts, and locates authority by request-path instead of by owner.

**The 5–8 highest-impact corrections (naming and layers first):**

1. **Rename the café schema `tenant` → `cafe`, and its root table `tenant.tenant` → `cafe.client`.** A café is *"a café Umi has as a client"* — a plain business word beats a doubled multitenancy word. Isolation column `tenant_id` → `cafe_id`. *(Owner's #1 legibility ask.)*
2. **Restore an EXPLICIT domain layer via mandatory table-name prefixes** (`loyalty_`, `menu_`/`order_`, customer, org, comms) inside the café schema, so `\dt cafe.*` groups itself by business domain. The schema names the *enterprise*; the prefix names the *domain*.
3. **Collapse the invented customer identity apparatus (`contact` + `contact_identity` + resolver columns) into ONE Customer + its Reachability.** The data proves the resolver is inert (`merge_state` uniformly `resolved`, `confidence`/`collected_via`/`external_id` 0-populated, 11/11 WhatsApp values byte-identical to the phone). This is literally the owner's named "people.contact split" pain.
4. **Name the raw value `raw_phone_number`, not `display_value`.** Identity must key on the **raw phone the customer gave**, with any normalization an explicitly-derived, clearly-paired companion — never a lossy normalization alone (one already corrupted a US `+1 480…` into a Mexican `+52 480…`). *(Owner's raw_X/normalized_X law.)*
5. **Strike the word "points."** `loyalty.points_ledger` holds **money in centavos** (`topup`/`purchase`/`migration_initial_balance`; zero `earn`/`redeem` rows). Rename to `cafe.loyalty_saldo_ledger`. The enterprise has **stamps** (visit counts) and **saldo** (centavos) — never points.
6. **One money ledger, derived balances.** De-duplicate the double-booked saldo fact (`points_ledger` vs `wallet_transactions`, **101¢ apart**); model saldo balance and stamp totals as **derived from movements** (the card's `total_visits`=20 vs 5 real events proves the cache drifts). Keep at most one clearly-named cache.
7. **Relocate Umi-owned authority out of the café's namespace.** The channel-type vocabulary, the `super_admin` cross-tenant operator, and the role catalog are **Umi's**, not the café's — move them to the `umi` layer. Reconcile the Néctar subscription conflict (platform `disabled` vs source `ACTIVE`) to one owner-of-truth so the design can answer *"is this café paying?"*
8. **Drop 0-row aspirational scaffolding** (payments, refunds, channels, channel_accounts, product modifiers) and machinery masquerading as business data (the standing `_migration` schema, `search_text` generated columns, `name_embedding` vectors) from the canonical entity layer.

None of these disturb the correct two-enterprise skeleton. They are concentrated, mechanical, and high-value — mostly renames and de-duplications that make the schema state the business without a data dictionary.

---

## 1. Enterprise Discovery — What enterprise is this?

**This is two enterprises in a vendor/customer relationship, not one.** The data cannot be read as a single business.

### Enterprise A — Umi (the SaaS vendor / consultancy)
`umiconsulting.co` sells a loyalty-and-WhatsApp-ordering product to independent cafés. Three facts prove Umi sits *above* the cafés rather than being one of them:

- One login, `hola@umiconsulting.co`, holds **active memberships in multiple café tenants at once** — a cross-tenant operator no single café would ever have.
- `grow.subscriptions` is **Umi billing each café**: exactly one row per tenant, `plan=standard`, with `active`/`disabled` lifecycle. This is *Umi's* revenue, denominated as a per-café SaaS contract. The money direction here is **café → Umi**, the reverse of every other value flow in the database.
- The role catalog (`Owner/Admin/Staff/Viewer`) is **global** — verified `tenant_id IS NULL` for all four roles. Umi defines the vocabulary that every café operates inside.

### Enterprise B — the Café (five real instances)
Each `tenant` is an independent Mexican café/restaurant in Sinaloa (Culiacán / Mazatlán; `timezone America/Mazatlan`). Verified population, uneven and real:

| Café | Customers | Notable |
|---|---|---|
| El Gran Ribera | 353 | all 23 reward redemptions; the one live gift card |
| Kalala | 73 | the **only** café with a menu (136 products) and orders (51) |
| Néctar | 20 | the lone subscription-status conflict |
| Northwest | 1 | zero saldo |
| Umi Café | 0 | Umi's own disabled dogfood tenant |

Each café owns its own staff, customers, stamp program, and (for some) a stored-value wallet. `umicafe` is Umi's own disabled test café (0 customers) — the vendor dogfooding its own product.

### The boundary that matters
A `tenant` means *"a café Umi sells to."* The café's world (customers, stamps, saldo, menu, orders, conversations) is scoped strictly inside one tenant. Umi's world (subscriptions, the role catalog, the cross-tenant superadmin, migration lineage) spans all tenants. The build-v2 split — a sealed `umi` schema for the vendor's own business and an RLS-scoped café schema for the café's business — **correctly names this two-enterprise reality**. The conceptual model must keep these two enterprises distinct and never let Umi-internal machinery masquerade as café business facts.

### A crucial asymmetry
**Loyalty and customer-reachability are intrinsic to *every* café; ordering/menu/KDS is intrinsic to only *one*.** Only Kalala has a menu (136 products) and orders (51); the other four have zero products. So "ordering" is a per-tenant **capability**, not a universal concept of the café enterprise.

---

## 2. Enterprise Conceptual Model — Concepts that genuinely exist

Each concept below survived the *"would it exist if all software vanished?"* test against real rows. Business words only.

### Umi's enterprise (the vendor)

**Café Client (the tenant).**
- *What:* an independent café business that has bought Umi's product. Five exist; two active (EGR, Kalala), three disabled (Néctar, Northwest, Umi's own).
- *Why:* it is the unit Umi sells to, bills, and isolates.
- *Recognized by:* Umi, and by the café itself.
- *Without software:* yes — "a café we have as a client" is a real-world relationship.
- *Proposition asserted by one instance:* "This named café is a client of Umi, in this operational state."
- *Authority:* Umi (the vendor onboards/suspends clients).
- *Lifecycle:* prospect → active → suspended/disabled. Verified: `status ∈ {active, disabled}`.

**Software Subscription (Umi's revenue agreement).**
- *What:* the paid contract by which a café licenses Umi's product. One per café.
- *Why:* it is Umi's income and the entitlement that keeps a café's program running.
- *Recognized by:* Umi (biller) and the café (payer).
- *Without software:* yes — a service contract.
- *Proposition:* "This café owes Umi a recurring fee under the *standard* plan and is currently in this billing state."
- *Authority:* Umi.
- *Lifecycle:* active ↔ suspended → disabled. **Integrity gap flagged:** for Néctar the platform says `disabled` while the source-of-record metadata says `ACTIVE` — the authoritative state of Umi's own revenue is unsettled.

**Operator Access Grant (membership + role).**
- *What:* the right of a login to act inside a specific café, at a specific authority level (Owner/Admin/Staff/Viewer).
- *Why:* it governs who may stamp, redeem, configure, or merely view.
- *Recognized by:* Umi (defines the role catalog) and the café (assigns people).
- *Without software:* partially — "the manager vs. the barista" is a real distinction; the *global role catalog* is a Umi artifact.
- *Proposition:* "This login may act as {role} within this café."
- *Authority:* role vocabulary = Umi (global, `tenant_id IS NULL`); assignment = the café. Verified assignments: Admin ×9, Staff ×3.
- *Lifecycle:* granted → active → revoked.

### The Café's enterprise (per tenant)

**Customer (a person the café knows).**
- *What:* a café patron, identified by their **Mexican mobile phone number**. 447 total across the four populated cafés.
- *Why:* the café needs to recognise returning patrons to run loyalty and to reach them.
- *Recognized by:* the café (and its staff at the counter).
- *Without software:* yes — "the regular whose number we have."
- *Proposition:* "This café knows a person reachable at this phone, named {display_name}, with birthday {birth_date}."
- *Authority:* the café (staff enrol customers); the phone is asserted by the customer.
- *Lifecycle:* enrolled → active → (dormant). **Identity is per-café, not global:** the same human at two cafés is two customers. Verified: uniqueness is `(tenant, phone)`; 447/447 have a phone, **0 have an email**, 435 have a birthday.

**Reachability Channel (how the café contacts a customer).**
- *What:* a means of reaching a customer — phone (all 447) and, for 11 customers, WhatsApp.
- *Why:* birthday messages and "come back" nudges must be delivered somewhere.
- *Recognized by:* the café.
- *Without software:* yes — "we text them / we WhatsApp them."
- *Proposition:* "This customer can be reached via {phone|whatsapp} at this address."
- *Authority:* the customer supplies it; the café records it.
- *Lifecycle:* added → verified → superseded. Verified kinds: `phone` (447), `whatsapp` (11). **The 11 WhatsApp values are byte-identical to the same customer's phone** — they assert no new reachability fact.

**Loyalty Membership + Card (enrolment in the stamp program).**
- *What:* the customer's standing in one café's stamp program, embodied in a physical/wallet stamp card.
- *Why:* it is where a customer's progress toward a reward lives.
- *Recognized by:* café + customer.
- *Without software:* yes — a paper stamp card is the ancestor.
- *Proposition:* "This customer is enrolled in this café's stamp program and holds this card."
- *Authority:* the café issues it.
- *Lifecycle:* issued → active → (retired). Verified ~1:1:1 with customers (EGR 353 people / 353 accounts / 353 cards; 445 cards / 447 people overall). **The separate `account` record adds no real-world participant beyond the card — flag as redundant.**

**Reward Rule (the loyalty promise / terms).**
- *What:* the café's stated deal: "collect N visits, receive this free item."
- *Why:* it is the contract that gives stamps their meaning.
- *Recognized by:* café + customer (it's advertised).
- *Without software:* yes — "buy 10, get 1 free" printed on the card.
- *Proposition:* "At this café, {N} qualifying visits earns {named item}."
- *Authority:* the café (owner sets terms).
- *Lifecycle:* drafted → active → superseded. Verified: exactly one active rule per café — **EGR = 7 visits → ¡Capuccino Gratis!; Kalala/Néctar/Northwest/Umi = 10 visits → Bebida gratis**; many inactive historical variants (Kalala has 12 superseded configs).

**Visit / Stamp Earned (a recognized visit).**
- *What:* the café recognising a qualifying visit and granting stamp(s). 537 events.
- *Why:* it advances the customer toward the reward; it is the atomic loyalty fact.
- *Recognized by:* the barista who grants it (attributed to a staff member) + customer.
- *Without software:* yes — stamping the card.
- *Proposition:* "On this date, staff member X granted this customer N stamps at this café."
- *Authority:* the café's staff. Verified: 537 events attributed across 5 staff members; notes like `8 sellos (registro manual)`.
- *Lifecycle:* **immutable historical fact** (append-only).

**Reward Redemption (the promise fulfilled).**
- *What:* the customer exchanging a completed card for the free item. 23 events, all at El Gran Ribera.
- *Why:* it discharges the loyalty obligation and resets the cycle.
- *Recognized by:* staff + customer.
- *Without software:* yes — handing over the free coffee.
- *Proposition:* "On this date, staff member X gave this customer the reward {config} at this café."
- *Authority:* the café's staff.
- *Lifecycle:* **immutable fact.**

**Stored Value / Saldo (a prepaid money balance the café owes the customer).**
- *What:* prepaid credit, in **centavos MXN**, that a customer loads and later spends. A genuine money liability, café → customer.
- *Why:* customers pre-pay; the café holds their money as spendable credit.
- *Recognized by:* café + customer.
- *Without software:* yes — a house account / prepaid tab.
- *Proposition:* "This café holds {amount} in prepaid credit belonging to this customer."
- *Authority:* the café (cash taken at the counter by staff).
- *Lifecycle:* loaded (topup) → spent (purchase), append-only. Verified small and concentrated: outstanding saldo ≈ **1,095 MXN across 6 cards / 3 cafés**; Northwest and Umi hold zero.

**Value Movement (a load or spend of saldo).**
- *What:* one money event against a saldo balance — `topup` (+) or `purchase` (−).
- *Why:* it is the atomic fact that changes what the café owes.
- *Recognized by:* café (staff at register) + customer.
- *Without software:* yes — "put 150 pesos on my account" / "take it off my balance."
- *Proposition:* "On this date, this customer's balance changed by {±amount} because of a {topup|purchase}."
- *Authority:* the café's staff.
- *Lifecycle:* **immutable ledger entry.** Verified genuine post-migration events are tiny: 2 topups + 2 purchases; the other 348 ledger rows are migration seeds.

**Gift Card (a bearer money liability).**
- *What:* prepaid value redeemable by whoever holds the code — like saldo, but bearer-identified rather than customer-identified. Exactly one live instrument (EGR, 100 MXN, unredeemed).
- *Why:* a café sells transferable prepaid value.
- *Recognized by:* café + code-bearer.
- *Without software:* yes — a plastic gift card.
- *Proposition:* "The café owes {amount} to whoever presents code {X}."
- *Authority:* the café issues it.
- *Lifecycle:* loaded → redeemed/expired.

**Menu Item / Product (a per-café capability).**
- *What:* something the café sells, with a price in centavos and a category. Only Kalala has a menu (136 products).
- *Why:* to take orders / show a catalogue.
- *Recognized by:* the café.
- *Without software:* yes — the physical menu board.
- *Proposition:* "This café offers {item} at {price}, currently {available|not}."
- *Authority:* the café.
- *Lifecycle:* added → available ↔ unavailable → removed. (Modifiers are an *anticipated* feature — tables exist, **0 rows** — not a real concept yet.)

**Order (a customer's request to buy — one café's process).**
- *What:* a placed order that walks a preparation lifecycle. 51 orders, **100% originating via WhatsApp**, Kalala only.
- *Why:* to fulfil a purchase and drive the kitchen.
- *Recognized by:* café (staff/kitchen) + customer.
- *Without software:* yes — a ticket at the counter.
- *Proposition:* "This customer requested these items from this café; the order is now in state {…}."
- *Authority:* the customer places; the café progresses it.
- *Lifecycle:* **mutable state** — verified `pending → preparing/accepted → ready → completed | cancelled` (24 completed, 26 cancelled, 1 pending).

**Order Transition (an immutable step in an order's life).**
- *What:* the recorded fact that an order moved between states.
- *Why:* an audit trail of fulfilment.
- *Proposition:* "At this time the order moved from {old} to {new}."
- *Authority:* the café's system-of-work (staff/kitchen actions).
- *Lifecycle:* immutable. (Verified `event_kind ∈ {status_changed, status_change, order_upserted, snapshot_reconciled}`; only the status transitions are genuine business facts.)

**Conversation & Message (an exchange with the customer).**
- *What:* a WhatsApp dialogue between a customer and the café's automated assistant. 1,376 messages (704 customer / 672 assistant).
- *Why:* customers ask, order, and are nudged over WhatsApp.
- *Recognized by:* café + customer.
- *Without software:* the *conversation* would exist (a phone chat); the automated-assistant half is software-mediated but the communication fact is real.
- *Proposition:* "On this date this customer and this café exchanged this message."
- *Authority:* both parties author messages.
- *Lifecycle:* immutable facts within a mutable conversation thread.

**Business Hours.**
- *What:* when a café (location) is open, per day of week.
- *Why:* governs ordering availability and customer expectations.
- *Authority:* the café.
- *Lifecycle:* set → amended. Clean intrinsic data (e.g. Kalala Sun closed, Mon–Fri 07:30–20:00).

**Staff Member (who works the counter).**
- *What:* the café's employee roster; the barista who stamps/redeems.
- *Why:* provenance — every visit/redemption is attributed to a staff member.
- *Authority:* the café.
- *Lifecycle:* hired → active → departed. Verified: 11 staff, all `active`; 8/11 carry an inline email.

**Location / Branch.**
- *What:* a physical café site; staff and hours attach to it.
- *Why:* a café can have branches; hours and staff are location-scoped.
- *Authority:* the café.
- *Lifecycle:* opened → active → closed.

**Wallet Pass (a customer's card in Apple/Google Wallet).**
- *What:* the customer's loyalty card materialised as a mobile wallet pass. 417 passes (Apple 350, Google 67).
- *Why:* how customers carry and present the card.
- *Recognized by:* the café, the customer, **and an external authority (Apple/Google)** who issues the pass identity.
- *Without software:* no — this concept is inherently digital, but the *card* it represents is real.
- *Proposition:* "This customer's card exists as a wallet pass identified by {serial/object id} under {Apple|Google}."
- *Authority:* **external** (Apple Wallet, Google Wallet) issue the serial/object id; the café triggers issuance.
- *Lifecycle:* provisioned → active → removed. A customer adding a pass mints a new instance **with no deploy**.

---

## 3. Authorities — who defines / owns / creates / retires each concept

**Umi-internal, defined by the vendor (no external governor):**
- **Café Client, Software Subscription, Operator Access Grant, Role catalog** — defined, created, modified, retired by **Umi**. Internal origin. New instances (onboard a café, grant access) appear **without a deploy** (data entry). Subscription and membership records are **mutable**. The role *vocabulary* is global and would require a deploy/config change to extend.

**Café-internal, defined by the café (staff at the counter):**
- **Customer, Reachability Channel, Loyalty Membership/Card, Reward Rule, Menu Item, Business Hours, Staff Member, Location** — owned and mutated by **the café**. Internal origin. New instances appear **without a deploy** (a barista enrols a customer, an owner edits the reward rule). These are **mutable master data**.
- **Visit/Stamp Earned, Reward Redemption, Value Movement, Order Transition, Message** — created by **café staff/customers** in the course of business. Internal origin, no deploy. **Immutable** once recorded (append-only facts). The **Order** itself is café-owned and **mutable** state; its transitions are immutable.
- **Stored Value / Gift Card** balances are café-owned money liabilities; only *movements* create/retire value, and those are immutable.

**Externally governed (third-party authorities that mint instances with no deploy):**
- **Wallet Pass** — identity issued by **Apple Wallet / Google Wallet**. External origin. A customer adding a pass creates a new instance with no deploy. The café cannot forge the serial/object id.
- **WhatsApp** — the real messaging channel through which conversations arrive. It is a genuine external channel but is **under-modeled** in the data (its only trace is `source_system = conversaflow`); it should be a first-class channel concept, not a provenance string.

**Anticipated-but-absent authorities (flag — do not model as real yet):**
- **Payment processor / POS (Stripe/Zettle/etc.).** The schema anticipates them (`ops.payments.provider`, `currency MXN`) but **payments, refunds, channels, channel_accounts are all 0 rows**. Cafés actually settle in cash/transfer off-platform. This authority **does not exist in the enterprise's reality** and must not be given first-class conceptual status.

**Migration lineage is NOT an external authority (flag):** every `source_system`/`auth_subject`/`external_refs.product_key` value points to **Umi's own former apps** (verified `external_refs.product_key ∈ {conversaflow (137), cash (9)}`; `auth_subject` prefixed `cash:`). These document the internal merge of two Umi products into one database — software lineage, not real-world governance.

---

## 4. Enterprise Relationships — as fact sentences

**A Café Client subscribes to Umi under one Software Subscription.**
Meaning: the paid vendor→client agreement. Owner: Umi. Cardinality: 1 café ⟷ 1 subscription (verified one row per tenant). Lifecycle: born at onboarding, dies at churn. Invariant: exactly one current subscription per café; the platform status is the authority (currently violated for Néctar — reconcile).

**An Operator (login) holds an Access Grant within a Café Client at one Role.**
Meaning: authority to act inside a café. Owner: café assigns, Umi defines roles. Cardinality: one login → many grants (the Umi superadmin spans several cafés); one café → many grants. Lifecycle: granted→revoked. Invariant: every grant names a role drawn from the global catalog; a grant is meaningless without both a login and a café.

**A Customer belongs to exactly one Café Client.**
Meaning: café-scoped identity. Owner: the café. Cardinality: 1 customer → 1 café; the same human at two cafés is two customers. Lifecycle: enrolled→dormant. Invariant: a customer is unique by `(café, phone)`; a customer without a phone cannot be recognised (verified 447/447 have a phone).

**A Customer is reachable through one or more Reachability Channels.**
Meaning: how the café contacts them. Owner: café records, customer asserts. Cardinality: 1 customer → 1..N channels (all have phone; 11 also have WhatsApp). Invariant: at least one channel (phone) must exist; a channel belongs to exactly one customer within the café.

**A Customer is enrolled in a Café Client's stamp program via one Loyalty Card.**
Meaning: their standing in loyalty. Owner: café. Cardinality: verified ~1:1 customer⟷card per café. Lifecycle: issued→retired. Invariant: a card belongs to exactly one customer and one café; its stamp count and saldo are derivable from events, never authored directly.

**A Café Client publishes one active Reward Rule (and retains superseded ones).**
Meaning: the loyalty promise in force. Owner: café. Cardinality: 1 café → exactly 1 active rule, 0..N historical. Invariant: exactly one `is_active` per café (verified). A Reward Redemption must cite the rule it fulfils.

**A Stamp-Earned event is granted by a Staff Member to a Customer's Card at a Café Client.**
Meaning: the atomic loyalty fact. Owner: café. Cardinality: 1 card → 0..N visit events; each event names exactly one staff member and one card. Lifecycle: immutable. Invariant: a customer's visit total equals the count of their visit events — the running total is a cache, not a source (verified drift: card shows `total_visits=20` vs 5 actual events → cache must be recomputed, never trusted).

**A Reward Redemption is granted by a Staff Member to a Customer against one Reward Rule.**
Meaning: the promise discharged. Owner: café. Cardinality: 1 customer → 0..N redemptions (verified all 23 at EGR). Lifecycle: immutable. Invariant: a redemption resets the customer's current-cycle stamp progress and must reference an existing rule and staff member.

**A Value Movement changes a Customer's Stored Value at a Café Client.**
Meaning: money loaded or spent. Owner: café. Cardinality: 1 card → 0..N movements. Lifecycle: immutable append-only. Invariant: the customer's saldo equals the signed sum of their value movements, in centavos (verified: ledger sum = card balance = balances table = 109,500¢). **A single real money event must be recorded once** — it is currently double-booked with a 101¢ discrepancy.

**A Gift Card carries Stored Value redeemable by its Bearer at a Café Client.**
Meaning: bearer money liability. Owner: café. Cardinality: 1 café → 0..N gift cards (verified: 1 live). Invariant: outstanding value = load minus redemptions; authority is the code-bearer, not an identified customer.

**A Café Client offers Menu Items, and a Customer places an Order composed of Order Lines drawn from them.**
Meaning: the ordering capability (only where a menu exists). Owner: café. Cardinality: 1 café → 0..N products (only Kalala: 136); 1 order → 1..N lines; 1 customer → 0..N orders. Lifecycle: order is mutable state, lines are fixed at placement. Invariant: an order belongs to exactly one café and (normally) one customer; only cafés with a menu can have orders (verified: 100% of orders are Kalala, 100% WhatsApp-sourced).

**An Order accumulates immutable Order Transitions.**
Meaning: fulfilment audit trail. Owner: café's system-of-work. Cardinality: 1 order → 1..N transitions. Invariant: each transition records old→new state; the order's current status is the last transition's new state (a derived projection). Non-transition event kinds (`order_upserted`, `snapshot_reconciled`) are sync bookkeeping, not business transitions.

**A Customer and a Café Client exchange Messages within a Conversation.**
Meaning: WhatsApp dialogue. Owner: both parties. Cardinality: 1 conversation → 1..N messages; 1 customer → 0..N conversations. Lifecycle: messages immutable, conversation thread mutable. Invariant: every message belongs to one conversation scoped to one café and one customer.

**A Loyalty Card is materialised as one or more Wallet Passes issued by an external Wallet authority.**
Meaning: the card carried in a phone. Owner: café triggers; Apple/Google issue identity. Cardinality: 1 card → 0..N passes (a customer may add on multiple devices). Invariant: pass identity (serial/object id) is externally minted; a new pass appears with no deploy.

**A Staff Member works at a Location of a Café Client; Business Hours belong to a Location.**
Meaning: physical operation. Owner: café. Cardinality: 1 café → 1..N locations; 1 location → 0..N staff, 0..7 daily-hours rows. Invariant: staff attribution on visits/redemptions must reference a staff member of the same café.

---

## 5. Controlled Vocabularies (grounded in distinct values)

**Café Client status** — `active`, `disabled` (verified). Owner: Umi. Changes as Umi onboards/suspends. New values require a code/enum change (deploy). Introduced by Umi only.

**Software Subscription plan** — `standard` (only value). Owner: Umi. New plan tiers = product decision + deploy. Introduced by Umi.

**Software Subscription status** — platform: `active`, `disabled`; source-metadata: `ACTIVE`, `SUSPENDED` (verified — the two vocabularies disagree for Néctar). Owner: Umi. **Flag:** two competing status vocabularies for the same fact; must be unified to one owner-of-truth.

**Operator Role** — `Owner`, `Admin`, `Staff`, `Viewer` (global catalog, `tenant_id IS NULL`). Observed in use: `Admin` (9), `Staff` (3). Owner: **Umi** (global). A café cannot invent a role; new roles = deploy. This is the one vocabulary the café consumes but does not own.

**Reachability Channel kind** — `phone` (447), `whatsapp` (11). Owner: shared — the set of channel *types* is Umi/product-defined (deploy to add, e.g. email), but *instances* are café/customer data. No email instances exist despite the column.

**Reward Rule terms** — `visits_required ∈ {7, 10}`; `reward_name` is **free text authored by the café** (e.g. `¡Capuccino Gratis!`, `Bebida gratis`, `Cookie de temporada`, `¡Bebida Grrrratis!`). Owner: the café. Fully café-editable **without a deploy** — this is genuine café content, not a fixed enum. Exactly one `is_active` per café.

**Value Movement / saldo reason** — `topup`, `purchase`, plus migration seed `migration_initial_balance` (verified 2/2/348 rows). Owner: café operations for the real reasons; `migration_*` is a Umi ETL artifact (not a business vocabulary). New economic reason types = deploy. **Flag:** the `earn`/`redeem` "points" reasons permitted by the constraint have **zero rows** — the model permits a concept the enterprise does not have.

**Gift-card ledger reason** — `migration_initial_load` (only value present); business set is load / redeem / expire (schema-defined). Owner: café ops; deploy to extend.

**Order status** — `pending`, `preparing`/`accepted`, `ready`, `completed`, `cancelled` (observed terminal split: completed 24, cancelled 26, pending 1). Owner: the café's fulfilment process; the *set* is product-defined (deploy to add a state). Instances created by staff/kitchen actions, no deploy.

**Order-event kind** — `status_changed` (78), `status_change` (52), `order_upserted` (52), `snapshot_reconciled` (26). Owner: Umi's software. **Flag:** `status_changed` and `status_change` are two spellings of one business transition (a duplicated vocabulary), and `order_upserted`/`snapshot_reconciled` are replication bookkeeping, not business events. Only one canonical transition kind should survive in the model.

**Order-event source** — `kds` (156), `conversaflow` (52). Owner: Umi (these are Umi's own apps). **Flag:** internal software provenance, not a business vocabulary.

**Message role** — customer vs assistant (704 / 672). Owner: the conversation itself; fixed by the medium.

**Wallet Pass provider** — `apple` (350), `google` (67); `status = active` (all 417). Owner: **external** (Apple/Google). New providers = external ecosystems + deploy; new *instances* appear with no deploy.

**Staff / Membership status** — `active` (11 staff, 12 memberships — only value present). Owner: the café. Would extend to inactive/departed via data, no deploy.

**Migration-lineage keys** — `external_refs.product_key ∈ {conversaflow (137), cash (9)}`; `auth_subject` prefixes `cash:`. Owner: Umi. **Flag:** these are Umi's own former-product identifiers documenting a one-time data merge; they are **not** an enterprise vocabulary and must not be modeled as external authority.

---

## 6. Critique of the Existing Conceptual Model (build-v2)

The 42 raw findings collapse into **seven themes**. Each names the conceptual law it breaks and how far the damage spreads.

### Theme 1 — The invented identity apparatus (the single largest defect)
**Findings:** the `tenant.contact` anchor; `contact_identity` resolver columns (`confidence`, `match_type`, `collected_via`, `external_id`); the `tenant.channel` catalog with `normalization_rule` / `deterministic_matchable` / `default_trust`; the duplicate WhatsApp identity row.
**Conceptual violation:** The model discovered exactly **one** central café concept — the **Customer**, *"a person the café knows, identified by their Mexican mobile phone,"* reachable through one or more channels. build-v2 shatters that one concept into a three-table probabilistic-resolution engine (`contact` → `contact_identity` → `customer`) plus a nine-row channel-matching registry. The data proves the engine is **inert**: `merge_state` is `resolved` for all rows, `merged_into` is null everywhere, `confidence`/`collected_via`/`external_id` are 0/458 populated, and the 11 WhatsApp identities are byte-for-byte copies of the same person's phone (11/11). This is literally the owner's named pain (the *"people.contact style split"*) and re-commits strike-list artifact #7 (`account` vs `card`) one layer up.
**Blast radius:** the entire customer spine — every `customer_id`/`contact_id` FK, every join a developer writes to answer *"who is this patron,"* and the wallet-pass, loyalty, order and conversation tables that all hang off customer identity. The most-touched region of the schema, so its over-abstraction taxes every query.

### Theme 2 — Authorship schemas erase the business-domain layer (the owner's #1 legibility ask)
**Findings:** the `umi/tenant/runtime/observability` split collapses loyalty, commerce, comms and org into one permission-scoped namespace.
**Conceptual violation:** The café's world is several distinct concept clusters (stamp program, ordering capability, conversations, org/staff/hours). Folding them into one flat `tenant` schema optimises for the *permission model*, not the *reader* — and the owner demanded EXPLICIT LAYERS and pristine navigability. The permission boundary (RLS-vs-sealed) is **orthogonal** to which domain a table belongs to.
**Blast radius:** every table in the café's world; a new developer running `\dt tenant.*` sees 30+ tables with no domain grouping. Navigation-wide, not local. *(Resolution in §9: keep the enterprise boundary as the schema — it is the primary conceptual truth — but restore domain as a mandatory table-name prefix.)*

### Theme 3 — Mechanism names where business words belong
**Findings:** `tenant.tenant`, `display_value`/`normalized_value`, `card_ledger`, `born_at`, `customer_note.fact`, `tenant."order"` (reserved word), `nudge_sent`/`journey`, `principal_type`.
**Conceptual violation:** Every one substitutes a software/framework word for a plain business word the enterprise actually uses (café, raw phone, saldo, birthday, note, order, reminder, customer/staff/device). `display_value` is the exact banned anti-pattern: a de-facto raw value that hides that it is the authoritative datum the customer gave, sitting beside a lossy `normalized_value`.
**Blast radius:** legibility-wide but mechanically shallow — pure renames, no structural change. High owner-value, low risk.

### Theme 4 — Struck concepts re-imported as vocabularies
**Findings:** `card_ledger.reason` admits `earn`/`redeem` ("points"); `loyalty_settings` re-abstracts the dissolved "program"; `business.menu_source`/`product.source` invent a Zettle/POS authority; `payment.status`/`refund.status` seed a settlement authority; product modifier tables.
**Conceptual violation:** The model explicitly **struck the word "points"** (the ledger holds centavos — verified 0 `earn`/`redeem` rows), and ruled that the POS/payment-processor authority **does not exist in the enterprise** (payments, refunds, channels, modifiers = 0 rows). build-v2 grants first-class conceptual status to authorities and vocabularies the business has never once exercised.
**Blast radius:** the loyalty-money layer and the commerce layer; every CHECK constraint that lists a value with no row behind it teaches the reader a concept the business does not have.

### Theme 5 — Money-ledger integrity leaks
**Findings:** `idempotency_key NOT NULL` on the ledgers; duplicate ledgers (`points_ledger` vs `wallet_transactions`, 101¢ apart); triple-stored balance; cached `total_visits` drift.
**Conceptual violation:** A **Value Movement**'s identity is the money event itself (card, amount, time, reason, staff). `idempotency_key` answers *"has the writer sent this before"* — a delivery-guarantee, not a fact the café asks about its money. Saldo and stamp totals are **derived from movements**, never authored; the model requires one append-only ledger and at most one clearly-labelled cache.
**Blast radius:** the café's real money liability (≈1,095 MXN). Small in volume, maximal in correctness sensitivity — a double-booked movement or trusted stale cache is a wrong balance shown to a paying customer.

### Theme 6 — Misplaced authority (Umi-owned facts living in the café's namespace, and vice-versa)
**Findings:** `tenant.channel` (Umi/product-owned vocabulary) sits in the café's RLS schema; the `super_admin` grant (Umi god-mode) is a row inside one café's `tenant_access`; the role vocabulary is duplicated CHECK enums instead of a Umi-owned catalog; subscription status has a shadow authority in jsonb.
**Conceptual violation:** The model's central discovery is **two enterprises**. Umi owns the role vocabulary, the channel-type vocabulary, and the cross-tenant operator; the café owns its customers, cards and orders. build-v2 already hoisted `umi.permission` correctly but left these equally-global Umi facts inside `tenant.*`, so *"who is Umi's operator"* and *"what channels exist"* are authored inside the café's data space, and the true scope of Umi's cross-tenant power is invisible at the tenant boundary.
**Blast radius:** the security/authority model and the vendor↔café boundary — the one boundary the whole design exists to enforce. A `super_admin` row hidden in one tenant partition is also an audit hazard.

### Theme 7 — ETL, search and ML plumbing masquerading as business data
**Findings:** the `_migration` schema baked into the canonical build with standing grants; `synthetic`/lineage flags in entity `metadata` jsonb; `branch.search_text` generated column; `product.name_embedding` vector on the menu item.
**Conceptual violation:** The model ruled migration lineage is **not an enterprise authority** and must not be modeled; and search/embedding artifacts are retrieval subsystems, not business facts. A one-time crosswalk with permanent grants elevates disposable machinery to first-class status.
**Blast radius:** the whole canonical DDL's credibility as an *enterprise* model; localized per-table for search/ML, but the `_migration` schema pollutes the top-level namespace a reader trusts to contain only the business.

**Contradiction resolved by re-query:** reviewers disagreed on the café-root's new name (`client` vs `cafe` vs `merchant`). The data settles it — the row is authored, billed and suspended **by Umi** (subscription is one-per-café, café→Umi money direction), and is recognized by both parties as *"a café we have as a client."* So the enterprise concept is **Client**; the *schema* it roots is the **café's** world. Decision in §9: schema `cafe`, root table `cafe.client`. No reviewer contradiction survives the data.

### Highest-impact findings (verified)

| # | Severity / Category | Location | Defect | Correction |
|---|---|---|---|---|
| 1 | critical / invented-concept | `11_tenant_core.sql:195` `tenant.contact` | Thin identity anchor between customer and reachability; carries no business attributes, only an inert `merge_state` (447/447 `resolved`, `merged_into` all null). The owner's named "people.contact split." | Delete `tenant.contact`; hang reachability directly off `cafe.customer`. Model merge as an event/log only if it ever becomes real. |
| 2 | critical / implementation-leak | `11_tenant_core.sql:227,240` identity keyed on `normalized_value` | Identity keys on a **lossy normalization**, not the phone the customer gave (one US `+1 480…` corrupted to `+52 480…`). Owner's raw_X/normalized_X pain. | Key identity on `raw_phone_number`; normalization is a labelled derived companion, never sole truth. |
| 3 | critical / over-abstraction | `00_foundation.sql:47-50`; `tenant.*` | Four authorship schemas collapse loyalty/commerce/comms/org into one namespace — erases the business-domain layer the owner demanded. | Keep enterprise boundary as schema; add mandatory domain **prefixes** (`loyalty_`, `menu_`/`order_`, …). |
| 4 | major / invented-concept | `11_tenant_core.sql:89-117` `tenant.channel` | 9-row catalog with `normalization_rule`/`deterministic_matchable`/`default_trust` (resolver params); only `phone`/`whatsapp` ever occur; 7 rows have zero instances. | Reduce to a 2-value vocabulary (`umi.channel_type`); move resolver tuning to code. |
| 5 | major / invented-concept | `11_tenant_core.sql:229-232` `contact_identity` resolver cols | `confidence`/`match_type`/`collected_via`/`external_id` — a scoring machine's scratch space; 0/458 populated, `match_type` uniformly `deterministic`. | Strip resolver columns; keep only channel + raw value + normalized + `is_primary` + `verified_at`. |
| 6 | major / duplication | `11_tenant_core.sql:70-80` vs `126-143` `tenant.tenant` vs `tenant.business` | Strictly 1:1 (a cash+conversaflow merge artifact) modeled as two concepts. | Fold `business` into `cafe.client`. One café = one row. |
| 7 | major / naming | `11_tenant_core.sql:70` `tenant.tenant` | The Café Client named with a doubled multitenancy word; collides with `tenant_id`. | Rename schema `tenant`→`cafe`, root `tenant.tenant`→`cafe.client`, `tenant_id`→`cafe_id`. |
| 8 | major / naming | `11_tenant_core.sql:227-228` `display_value` | The de-facto raw value hidden behind a display-word beside a lossy `normalized_value`. | Rename `display_value`→`raw_phone_number`/`raw_value`. |
| 9 | major / invented-concept | `13_tenant_loyalty.sql:113-115` `card_ledger.reason` | Money ledger (centavos) admits `earn`/`redeem` "points" reasons — zero rows; re-imports the struck "points" concept. | Rename to `loyalty_saldo_ledger`; drop `earn`/`redeem`; keep money reasons only. |
| 10 | major / implementation-leak | `13_tenant_loyalty.sql:118,122` `idempotency_key NOT NULL` | Delivery-guarantee baked as a mandatory money-fact attribute. | Move idempotency to a `runtime` write-guard; not an enterprise ledger column. |
| 11 | major / hidden-authority | `11_tenant_core.sql:358-363` + `00_foundation.sql:159-171` `super_admin` | Umi cross-tenant god-mode stored as a role string inside one café's `tenant_access`; scope invisible at the boundary. | Model as `umi.platform_operator`; not a café role value. |
| 12 | major / duplication | `18_umi.sql:120-124` subscription status | Platform `billing_status` enum vs source status in jsonb — two competing authorities; Néctar unresolved. | One `umi.subscription.status` + typed `source_status` provenance; reconcile Néctar. |
| 13 | major / duplication | `11_tenant_core.sql:363`, `18_umi.sql:217-218`, `00_foundation.sql:168` role enums | Role vocabulary duplicated as CHECK enums + a hardcoded literal, while permissions are a proper catalog — inconsistent authority. | One `umi.role` catalog FK'd by both; drop the enums and the literal. |
| 14 | major / implementation-leak | `00_foundation.sql:52,87,203-251` `_migration` schema | One-time ETL crosswalk baked into canonical build with standing grants — lineage elevated to first-class. | Move to throwaway `etl_crosswalk`, dropped post-cutover. |
| 15 | major / duplication | `11_tenant_core.sql` `contact_identity` vs `staff.email/phone` vs `login.email/phone` | "How we reach a person" modeled three incompatible ways (identity spine for customers, inline columns for staff/login). Strike #9. | Choose one reachability representation across customer/staff/login. |
| 16 | minor / duplication | `11_tenant_core.sql:221-259` WhatsApp identity | WhatsApp `normalized_value` byte-identical to the phone for 11/11; `external_id` null — a re-tagged duplicate identifier. | Derive WhatsApp-reachability as a flag on the phone identity; mint a row only for a distinct address/PSID. |
| 17 | minor / naming | `12_tenant_commerce.sql:163` `tenant."order"` | Reserved word forces defensive quoting everywhere. | Rename to `cafe.customer_order`. |
| 18 | minor / naming | `11_tenant_core.sql:274` `born_at date` | `_at` convention is for timestamptz instants, not a birthday date. | Rename to `birthday`. |
| 19 | minor / invented-concept | `11_tenant_core.sql:132-133`, `12_tenant_commerce.sql:72-73` `menu_source`/`product.source` | Invents a Zettle/POS authorship authority (0 instances) duplicated at two grains. | Drop invented POS values; single grain constrained to observed `dashboard` if provenance is needed. |
| 20 | minor / invented-concept | `12_tenant_commerce.sql:293-295,325-326` `payment.status`/`refund.status` | Rich settlement vocabulary for an authority with zero enterprise instances. | Defer until a real settlement authority exists. |
| 21 | minor / missing-concept | `12_tenant_commerce.sql:170` `order.status` | The one operationally central status column left ungoverned while trivial ones are constrained. | Add CHECK `{pending, accepted, preparing, ready, completed, cancelled}`. |
| 22 | minor / implementation-leak | `16_runtime.sql:189-191` `principal_type = person\|user\|device` | Re-encodes the old core-vs-loyalty identity accident (strike #9) as an auth enum. | `owner_kind = customer\|staff\|device`, or split FK columns. |
| 23 | minor / implementation-leak | `11_tenant_core.sql:164-165,187-188` `branch.search_text` (generated) | A trigram-index target materialised onto the entity. | Drop; build a trigram index on `lower(name)`. |
| 24 | minor / implementation-leak | `12_tenant_commerce.sql:80-98` `product.name_embedding` vector | ML retrieval artifact carried on the menu item. | Move to a derived `menu_product_embedding` search table. |

---

## 7. Conceptual Corrections

Where build-v2 diverged from the discovered enterprise, the corrected concepts are:

1. **Customer is ONE concept, not three.** Delete the `contact` anchor and the `customer`/`contact` split. A Customer is a person the café knows, unique by **(café, raw phone)**. Reachability hangs *directly* off the Customer. Verified basis: 447/447 have a phone, 0 have email, identity is deterministic per-(café, phone). There is no probabilistic identity problem in this enterprise, so there is no resolver concept — `confidence`, `match_type`, `collected_via`, `merge_state` are struck from the conceptual layer entirely. If a genuine cross-channel merge (e.g. an Instagram PSID vs a phone) ever appears, model it as a **merge event/log against Customer**, never as a permanent anchor table.

2. **Reachability Channel is a two-value controlled vocabulary owned by Umi, not an entity.** The channel *kinds* the enterprise exercises are exactly `phone` (447) and `whatsapp` (11). "Channel" is not a business entity carrying trust weights and normalization rules — those are resolver configuration. The vocabulary is **Umi/product-defined** (adding `email` needs a deploy), so its authority sits in Umi's layer, consumed by the café. **A WhatsApp reachability that merely repeats the phone number asserts no new fact** (verified 11/11 identical) — model WhatsApp-reachability as a *capability flag on the single phone identity*, minting a distinct channel row only when it carries a distinct address/PSID.

3. **The customer's identifier is the raw phone the customer gave.** Identity keys on the **raw** value, with normalization as an explicitly-derived, clearly-paired companion — never a lossy normalization alone (which already corrupted a US `+1 480…` into `+52 480…`). This is the owner's raw_X/normalized_X law made conceptual.

4. **One Café Client, not tenant + business.** `ops.businesses` is 1:1 with `core.tenants` (a cash+conversaflow merge artifact). The café is a single concept: its name, timezone, hours-config and branding all belong to one root.

5. **One Loyalty Card, not account + card.** Verified ~1:1:1 with the customer (445 cards / 447 people); "account" adds no real-world participant. Saldo balance and stamp totals are **derived from movements**, never stored as truth.

6. **Two enterprises, made primary.** The top conceptual partition is *"whose business is this fact?"* — Umi's (client roster, subscription revenue, role & channel vocabularies, cross-tenant operator) vs the café's (customers, stamps, saldo, menu, orders, conversations). `runtime` and `observability` are **non-business machinery**, correctly held apart from *both* enterprises.

7. **Umi's revenue state has exactly one authority.** Subscription status is a single owned value; the source-of-record status (Néctar's `ACTIVE`) is a **typed provenance column**, not a shadow authority in jsonb. The Néctar conflict (platform `disabled` / source `ACTIVE`) must be reconciled by Umi to one value before the model is trustworthy — the design must be *able to answer* "is this café a paying client?"

8. **Role vocabulary has one owner (Umi).** `Owner/Admin/Staff/Viewer` is a global Umi catalog (verified `tenant_id IS NULL`). It is a Umi-owned reference table FK'd by both the café's access grants and Umi's permission map — not duplicated CHECK enums that can drift.

9. **The cross-tenant operator is Umi authority, not a café membership.** `super_admin` is not one of the café's roles; it is Umi's god-mode and belongs in Umi's layer, visible as vendor authority — not a role string hidden inside one café's access rows.

10. **Struck concepts stay struck.** No "points" (money is centavos; stamps are visit counts). No POS/Zettle/payment-processor authority (0 rows). No product modifiers, channels, channel_accounts (0 rows). No generic "loyalty settings/program" bag — the loyalty promise lives in concrete concepts (Card, Reward Rule, Visit, Redemption, Saldo). Model these only when a real instance appears.

11. **Machinery is not enterprise data.** Migration lineage, search indexes and ML embeddings are excluded from the entity layer; they live in a throwaway ETL crosswalk (dropped after cutover) or in dedicated derived/search structures.

---

## 8. Evaluation of the Logical Relational Model

**Verdict: build-v2's relational model is directionally right on the two-enterprise boundary but distorts the corrected conceptual enterprise in five structural ways — chiefly by mistaking *identifiers and classifications for entities*.**

**(a) Faithful where it counts.** The `umi`-sealed / café-RLS split is a *correct logical rendering* of the model's central discovery: two enterprises in a vendor/customer relationship. Hoisting `umi.permission` out of the café's space is exactly right. The append-only visit/redemption/ledger facts and the mutable-order + immutable-transition split also faithfully mirror the conceptual lifecycles.

**(b) An identifier reified as three entities — the customer spine.** The model has one participant (Customer) and one dependent (its Reachability). build-v2's logical model interposes `tenant.contact` — a relation with **no business attributes**, existing only to hold `merge_state`. In relational terms this is a surrogate anchor with a mandatory 1:1 to `customer` (verified 447:447, `merge_state` uniformly `resolved`): it adds a join and a FK but no proposition. That is an identifier masquerading as an entity — the precise defect the model struck as `account` vs `card`, re-committed. The corrected logical model is **two relations**: `customer` (the participant) and `customer_channel` (its reachability, a weak entity keyed by the café + raw value).

**(c) A controlled vocabulary reified as an entity — `tenant.channel`.** The model classifies channel-kind as a §5 *controlled vocabulary* (a small product-defined set). build-v2 promotes it to a full relation carrying `normalization_rule`, `deterministic_matchable`, `default_trust`, `namespace` — matching-algorithm parameters, not business attributes — and seeds 7 rows (sms/email/instagram/messenger/pos/web/manual) with **zero instances**. A lookup table whose non-key columns describe an *algorithm* rather than the *thing classified* is a classification mistaken for an entity. Corrected: a 2-value vocabulary (a `channel_type` reference in Umi's layer, or a CHECK), with resolver tuning moved to code.

**(d) A single fact double-booked, and derived state stored as truth.** The logical model carries `points_ledger` **and** `wallet_transactions` for the same Value Movement (101¢ apart), and materialises the saldo balance in three places (`cards.balance_cents` = `balances.balance` = `sum(ledger)`) and stamp totals on the card (`total_visits` = 20 vs 5 real events). Relationally this is unnormalised: derivable values stored as base facts, with no single functional dependency owning the truth. The model demands **one** movement ledger with balance/totals derived (at most one clearly-named cache).

**(e) Authority located by request-path, not by owner.** `tenant.channel` (Umi-owned) and the `super_admin` grant (Umi-owned) live in the café's RLS relation because that is where the *read path* touches them — an implementation criterion, not the conceptual owner. The role vocabulary is two CHECK enums plus a hardcoded `'super_admin'` literal in `can_access_tenant`, with no owning relation — so the model's *"Umi defines the role vocabulary"* has no relational home and can drift. And Umi's subscription status keeps a **second, competing** authority in jsonb (`source_subscription_status`), leaving the primary key question — *is this café paying?* — logically unanswerable for Néctar.

**Distortions traceable to implementation, each against the model:** `idempotency_key NOT NULL` (delivery guarantee → mandatory ledger attribute; the movement's identity is the money event); `branch.search_text` generated column and `product.name_embedding` (retrieval/ML artifacts → entity attributes; the model strikes search plumbing); `_migration` as a standing granted schema (ETL crosswalk → first-class namespace; the model rules lineage is *not* an authority); `principal_type = person|user` (the old core-vs-loyalty identity accident re-encoded as an auth enum; the model recognizes Customer/Staff/Device).

**Net:** the logical model is **~70% faithful**. Its failures are concentrated and systematic — **identifiers and vocabularies promoted to entities, derived state stored as base facts, and authority placed by read-path rather than owner.** Every one is correctable without disturbing the (correct) two-enterprise skeleton.

---

## 9. Physical & Naming Recommendations — the owner's #1 ask

### (a) The explicit, standardized layer scheme

**Two axes, both explicit. Axis 1 is the schema; Axis 2 is a mandatory table-name prefix.**

#### Axis 1 — SCHEMA = the enterprise / authority boundary (the primary layer)
The most important discovered fact is that this is **two enterprises plus shared machinery**. That boundary *must* be the schema, because (i) it is the deepest conceptual truth, and (ii) it must exactly equal the RLS/sealed security boundary — if domains were schemas, the vendor↔café line would smear across `loyalty`/`commerce`/`comms` and a café could read Umi's business tables. **Business-domain-as-schema is therefore rejected at the top level.**

| Schema | Contains | Sealed / RLS | Is it business? |
|---|---|---|---|
| `umi` | Umi's own SaaS business: the client roster, the subscription (Umi's revenue), the global role & channel-type vocabularies, the permission map, the cross-tenant platform operator | Sealed | Yes — Umi's |
| `cafe` | The café's entire world, RLS-scoped to one café: org spine, customers, loyalty, menu/orders, conversations | RLS (`cafe_id`) | Yes — the café's |
| `runtime` | Machinery: sessions, idempotency, reminder-sent guards, jobs. **No business concepts.** | Sealed | No |
| `observability` | Telemetry only. **No business concepts.** | Sealed | No |

*(`tenant` schema renamed → `cafe`: a plain business word beats a multitenancy word, per the owner. Isolation column `tenant_id` → `cafe_id`.)*

#### Axis 2 — DOMAIN = mandatory table-name prefix inside `cafe` (the secondary, legibility layer)
This is how the owner gets EXPLICIT domain layers without sacrificing the enterprise boundary. Every café table is prefixed by its business domain, so `\dt cafe.*` groups itself:

- **Org spine (unprefixed — the café's identity):** `client`, `branch`, `staff`, `business_hours`
- **Customer:** `customer`, `customer_channel`, `customer_note`
- **`loyalty_`:** `loyalty_card`, `loyalty_reward_rule`, `loyalty_visit`, `loyalty_redemption`, `loyalty_saldo_ledger`, `loyalty_gift_card`, `loyalty_gift_card_ledger`, `loyalty_wallet_pass`
- **`menu_` / `order_`:** `menu_product`, `menu_category`, `customer_order`, `order_line`, `order_transition`
- **Comms:** `conversation`, `message`

#### Naming conventions (enforced everywhere)
- **Plain business words only.** No `tenant.tenant`, no `principal_type`, no reserved words.
- **raw_X / normalized_X law.** A `normalized_*` column may exist *only* beside the `raw_*` it derives from; the raw value is authoritative, the normalized is a documented cache.
- **`_at` = timestamptz instant** only (so `born_at`→`birthday`). `_on`/plain nouns for dates.
- **`_ledger` = append-only money movements; balances/totals are derived caches, named `*_cache` if materialised.**
- **Vocabularies the enterprise doesn't exercise are not seeded** (no 7 empty channels, no POS statuses).
- **Umi-owned vocabularies live in `umi`** and are FK-referenced, never duplicated as CHECK enums.

### (b) Old → New naming table (every flagged item)

#### Schemas
| Old | New | Why |
|---|---|---|
| schema `tenant` | schema `cafe` | plain business word; `tenant` is a multitenancy mechanism |
| schema `_migration` (in canonical build) | **drop from canonical**; move to throwaway `etl_crosswalk` script, dropped post-cutover | lineage is not an enterprise authority |
| col `tenant_id` (isolation key) | `cafe_id` | name the concept, not the mechanism |

#### Café-world tables
| Old | New | Action |
|---|---|---|
| `tenant.tenant` | `cafe.client` | rename; **fold `tenant.business` into it** |
| `tenant.business` | *(folded into `cafe.client`)* | drop — 1:1 merge artifact |
| `tenant.contact` | **DROP** | fold `merge_state`/`merged_into` onto customer only if merge ever becomes real |
| `tenant.contact_identity` | `cafe.customer_channel` | repoint FK directly to `cafe.customer` |
| `tenant.channel` | `umi.channel_type` | move to Umi layer; reduce to `{phone, whatsapp}` |
| `tenant.customer` | `cafe.customer` | rename |
| `tenant.customer_note` | `cafe.customer_note` | rename |
| `tenant.branch` | `cafe.branch` | rename |
| `tenant.staff` | `cafe.staff` | rename |
| `tenant.login` | `umi.operator` | platform login is Umi-scoped, not café-scoped |
| `tenant.tenant_access` | `cafe.operator_grant` (per-café role edge) **+** `umi.platform_operator` (the `super_admin` grant) | split by authority |
| `tenant.loyalty_settings` | `cafe.loyalty_program` | trim card_prefix/pass_style/branding to impl-side config |
| `tenant.reward_rule` | `cafe.loyalty_reward_rule` | rename |
| `loyalty.accounts` | *(folded into `cafe.loyalty_card`)* | drop — adds no participant |
| `tenant.card` | `cafe.loyalty_card` | rename; balance/total are derived caches |
| `tenant.card_ledger` | `cafe.loyalty_saldo_ledger` | it holds money (centavos), not "points" |
| `tenant.gift_card` | `cafe.loyalty_gift_card` | rename |
| `tenant.gift_card_ledger` | `cafe.loyalty_gift_card_ledger` | rename |
| `loyalty.points_ledger` / `wallet_transactions` | **one** `cafe.loyalty_saldo_ledger` | de-duplicate the double-booked money fact |
| `tenant.visit` | `cafe.loyalty_visit` | rename |
| `tenant.redemption` | `cafe.loyalty_redemption` | rename |
| `loyalty.passes` | `cafe.loyalty_wallet_pass` | externally-issued identity |
| `tenant.product` | `cafe.menu_product` | rename |
| `tenant.product_category` | `cafe.menu_category` | rename |
| `tenant."order"` | `cafe.customer_order` | kill reserved word |
| `ops.order_items` | `cafe.order_line` | rename |
| `ops.order_events` | `cafe.order_transition` | keep only real transitions |
| `ops.payments` / `refunds` / `channels` / `channel_accounts` / `product_modifiers*` | **DROP** | 0 rows — defer until a real authority exists |
| `comms.conversations` | `cafe.conversation` | rename |
| `comms.messages` | `cafe.message` | rename |
| `runtime.nudge_sent` | `runtime.reminder_sent` | plain word |

#### Columns
| Old | New | Rule |
|---|---|---|
| `contact_identity.display_value` | `customer_channel.raw_value` (`raw_phone_number` for phone) | authoritative raw datum, plainly named |
| `contact_identity.normalized_value` | `customer_channel.normalized_value` | keep, **documented as derived-from-`raw_value`**, never sole truth |
| `contact_identity.confidence` / `match_type` / `collected_via` / `external_id` | **DROP** (→ `etl_crosswalk`/resolver workspace) | resolver scratch, not business fact |
| `contact.merge_state` / `merged_into` | **DROP** | inert; re-add as a merge event only when real |
| `channel.default_trust` / `deterministic_matchable` / `normalization_rule` | **DROP** (→ resolver config in code) | algorithm params, not business facts |
| `customer.born_at` | `customer.birthday` | `_at` is for timestamptz |
| `customer.metadata->>'synthetic'` (ETL flag) | move to `etl_crosswalk` provenance side-table | lineage off the entity |
| `customer_note.fact` | `customer_note.note` | plain word |
| `card_ledger.reason` CHECK | drop `earn`/`redeem`; keep `migration_initial_balance`, `topup`, `purchase`, `adjustment`, `gift_card_redeem` | no "points" in a money ledger |
| `card_ledger.idempotency_key NOT NULL` | move to `runtime` write-guard (or nullable, labelled runtime-only) | delivery guarantee ≠ money fact |
| `business.menu_source` / `product.source` | drop invented `zettle`/`pos` values; keep single grain constrained to observed `dashboard` | no non-existent POS authority |
| `order.status` | add CHECK `{pending, accepted, preparing, ready, completed, cancelled}` | govern the vocabulary that matters |
| `payment.status` / `refund.status` | **defer** (tables dropped) | no settlement authority exists |
| subscription `billing_status` + jsonb `source_subscription_status` | `umi.subscription.status` (single authority) + `umi.subscription.source_status` (typed provenance) | one owner-of-truth; **reconcile Néctar** |
| `tenant_access.role` / `role_permission.role` CHECK enums + `'super_admin'` literal | `umi.role` catalog table, FK'd by both | one owner for the role vocabulary |
| `branch.search_text` (generated) | **DROP**; build trigram index on `lower(name)` | index is invisible to the model |
| `product.name_embedding` / `embedding_model` / `synced_at` | move to `cafe.menu_product_embedding` (derived search table) | ML index ≠ business fact |
| `session.principal_type = person\|user\|device` | `owner_kind = customer\|staff\|device` (or split FK columns) | collapse the core-vs-loyalty accident |
| `nudge_sent.journey` | `reminder_sent.reminder_type` | plain words |

**Néctar reconciliation (required before trust):** platform says `disabled`, the migrated cash source says `ACTIVE` (verified, in jsonb). Umi must confirm the billing reality and set `umi.subscription.status` to one value; `source_status` retains `ACTIVE` as provenance only. The design must never again carry two competing answers to "is this café paying?"

### (c) Navigation test — can a new developer read the schema and understand the business?

Run `\dn` then `\dt cafe.*`. A developer with **zero prior context** reads, top to bottom:

> **Four schemas** — `umi` (the vendor's own business), `cafe` (a café's business, one per client), `runtime` and `observability` (plumbing, no business here). *So this is a vendor selling to cafés — two businesses, cleanly split.*
>
> Inside **`umi`**: `client`, `subscription`, `role`, `permission`, `channel_type`, `platform_operator`. *Umi bills cafés, defines the roles and channels, and has cross-tenant operators.*
>
> Inside **`cafe`**, tables group by prefix: `client / branch / staff / business_hours` (the café and its people) · `customer / customer_channel / customer_note` (patrons, reachable by raw phone) · `loyalty_card / loyalty_reward_rule / loyalty_visit / loyalty_redemption / loyalty_saldo_ledger / loyalty_gift_card / loyalty_wallet_pass` (*a stamp program, a prepaid money balance, and a wallet pass*) · `menu_product / menu_category / customer_order / order_line / order_transition` (*an optional ordering capability*) · `conversation / message` (*WhatsApp dialogue*).

They can state the business — *"Umi sells a loyalty-and-WhatsApp-ordering product to independent cafés; each café knows its customers by phone, runs a stamp program, may hold prepaid saldo, and (some) take WhatsApp orders"* — **without opening a single row, and without a data dictionary.** Reading `cafe.customer` → `cafe.customer_channel(raw_phone_number, normalized_value)` they see the raw value is truth and the normalized is derived. They never meet a `tenant.tenant`, a `contact` anchor with no attributes, a `display_value` that is secretly the real value, a "points" ledger full of pesos, or a `super_admin` string hidden in a café's rows.

**That is the pristine legibility the owner asked for: the schema list names the two enterprises, and every table name states its domain and its business meaning.**

---

## Verdict & Prioritized Actions

**Verdict.** build-v2 is a **faithful skeleton wrapped in an unfaithful surface.** It got the one irreducible thing right — the two-enterprise boundary rendered as the schema split — and it is **~70% faithful** overall. But it is **not yet a pristine model of the enterprise**: it invents an identity-resolution machine the business never runs, hides business concepts behind framework words, re-imports struck concepts as live vocabularies, stores derived money and stamp totals as if they were base facts, and locates Umi-owned authority inside the café's namespace. Each failure is concentrated and correctable **without touching the correct skeleton.** Accept the two-enterprise schema split; reject the customer spine, the channel entity, the duplicate ledgers, and the misplaced authority as currently built.

### Prioritized action list

**P0 — Correctness / money integrity (do first; a paying customer sees a wrong number otherwise):**
1. Collapse the double-booked saldo ledger into **one** `cafe.loyalty_saldo_ledger`; reconcile the 101¢ discrepancy.
2. Make saldo balance and stamp `total_visits` **derived** from movements; keep at most one clearly-named cache (`*_cache`). Recompute the drifted `total_visits` (20 vs 5).
3. Reconcile the **Néctar** subscription conflict to one `umi.subscription.status`; retain `ACTIVE` only as typed `source_status` provenance.

**P1 — Legibility & layers (the owner's #1 ask; mostly mechanical renames):**
4. Rename schema `tenant` → `cafe`, `tenant.tenant` → `cafe.client`, `tenant_id` → `cafe_id`; fold `tenant.business` into `cafe.client`.
5. Apply mandatory domain prefixes (`loyalty_`, `menu_`/`order_`, comms) to every café table.
6. Rename `display_value` → `raw_phone_number`; document `normalized_value` as derived-from-raw; key identity on the raw value.
7. Rename `card_ledger` → `loyalty_saldo_ledger` and strike the word "points"; drop `earn`/`redeem` from the reason CHECK.
8. Plain-word renames: `born_at`→`birthday`, `customer_note.fact`→`note`, `tenant."order"`→`cafe.customer_order`, `nudge_sent`/`journey`→`reminder_sent`/`reminder_type`, `principal_type`→`owner_kind`.

**P2 — Correct the conceptual structure (identifiers/vocabularies wrongly reified as entities):**
9. Delete `tenant.contact`; hang `cafe.customer_channel` directly off `cafe.customer`. Drop resolver columns (`confidence`, `match_type`, `collected_via`, `external_id`, `merge_state`, `merged_into`).
10. Demote `tenant.channel` to `umi.channel_type` = `{phone, whatsapp}`; move `normalization_rule`/`deterministic_matchable`/`default_trust` to resolver code. Stop minting WhatsApp identity rows that duplicate the phone.
11. Fold `loyalty.accounts` into `cafe.loyalty_card`.

**P3 — Authority placement (make the vendor↔café boundary honest):**
12. Move the `super_admin` cross-tenant operator to `umi.platform_operator`; move `tenant.login` to `umi.operator`.
13. Introduce one `umi.role` catalog FK'd by both the café's `operator_grant` and Umi's `role_permission`; drop the duplicate CHECK enums and the hardcoded `'super_admin'` literal.
14. Add the `order.status` CHECK (the one governance the model is missing).

**P4 — Strike machinery & aspirational scaffolding from the canonical entity layer:**
15. Move `_migration` out of the canonical build into a throwaway `etl_crosswalk` (dropped post-cutover); move `synthetic`/lineage flags off entities into a provenance side-table.
16. Drop `branch.search_text` (use a trigram index); move `product.name_embedding` to a derived `menu_product_embedding` table.
17. Drop the 0-row tables — `payments`, `refunds`, `channels`, `channel_accounts`, `product_modifiers*` — and the invented `menu_source`/`product.source` POS authority; defer until a real instance appears.

Execute P0 before any cutover, P1–P2 as the rename sweep that delivers the owner's legibility mandate, and P3–P4 to finish making the schema a truthful enterprise model rather than an implementation trace.