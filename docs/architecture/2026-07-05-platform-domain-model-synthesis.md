# Umi — Platform Domain Model: Resolution & Synthesis

**Date:** 2026-07-05
**Status:** **Accepted target.** Resolves the `reality-first` ⟷ `conceptual-critique` tension and is the current domain model. Supersedes the DB-redesign cluster (see §12).
**Framing:** **Alpha — nothing is released.** Design for the _right_ model, not the migration-safe one. Consolidation-vs-current-state gating (the umi-cash dual-writer, etc.) is a **sequencing footnote (§10)**, not a design constraint. No table is preserved because it exists today.
**Method carried forward:** Codd/Date/Halpin, ANSI/SPARC conceptual-before-physical (from the two prior docs) **+** the Salesforce CRM object model, NIST SP 800-63C federated identity (`issuer`/`subject`), and the CDP identity-graph / Fellegi-Sunter entity-resolution literature (new grounding, §11).

---

## 0. What this doc resolves

The chain was a dialectic: `platform-database-architecture` (target) → `audit` → `abstraction-elimination` → `codd` → `pillars` → **`reality-first`** (consolidated those) → **`enterprise-conceptual-critique`** (attacked reality-first). The last two are the live top-of-chain and were left **in unresolved tension**:

- **`reality-first`** — a competent _logical/physical_ redesign; right facts, but it let storage residency, USAGE seals, RLS reachability, and retention define its top-level structure.
- **`enterprise-conceptual-critique`** — its Phase-2 critic; correct that **authorship, not storage**, is the conceptual boundary (ANSI/SPARC P2), but it stopped at "critique," not a target.

They disagree on ~6 folds. This doc **adjudicates them with an explicit rule (§1)**, **honors the critique's conceptual-before-physical ordering (§2, §7)**, and **adds four facts neither doc had**: the demand/supply spines (§3), federated customer identity (§4), `channel` ≠ `supplier` + the missing supply-side fact (§5), and Umi-as-tenant-zero (§6). It also **connects the DB model to the code architecture** — the piece missing from every prior doc (§7).

---

## 1. The merge rule (how reality-first and the critique combine)

They test **different things**, so they are not actually opposed:

- **reality-first** asks: _is this distinction load-bearing at runtime?_ (does code read it back; does a feature depend on it)
- **the critique** asks: _is this distinction real in the business, and who authors it?_

> **Rule: keep a separate entity when _either_ test passes; fold only when _both_ say fold.**

This cancels each method's failure mode — reality-first's tendency to fold a real thing because nothing queries it _yet_, and the critique's tendency to preserve fidelity nothing will ever exercise. Every §8 verdict is this rule applied.

---

## 2. Conceptual model — authorship first (honoring P2)

Partition by **whose fact it is**, invariant under schema count, seals, pools, retention, and whether telemetry lives in Postgres or OTel:

1. **Umi's business** — prospects, the tenants that pay Umi, the agreement, what they're billed.
2. **The restaurant's (tenant's) business** — everything the restaurant does to serve diners. **This universe has internal structure — see §3.**
3. **Software machinery** — outbox, dedup gates, idempotency, sessions, pairing, the debounce "turn," telemetry. **Quarantined — not promoted to a peer "truth."**

**External authorities** govern several facts _neither_ enterprise owns. The test for external-mirror vs. tenant/Umi-authored is the **first-principle authority test (§5a): absent all software and every vendor, who may create/change/retire it?** By that test the genuine mirrors are: **Meta/Twilio** = the WhatsApp number + delivery; **Apple/Google** = the wallet pass; **ISO 4217/E.164** = currency, weekday, phone format — each exists only because an outside institution issues it, so Umi _mirrors_ it, never authors it. **The menu is NOT one of these** (§5a) — the owner authors it; Zettle is a replaceable _source_, not its authority. Both errors are symmetric: modeling a genuine external as a tenant "forever" fact invites overwrite/revocation conflicts; modeling a genuine tenant fact (the menu) as an external mirror wrongly cedes the owner's authority to a vendor.

Physical schemas _realize_ these universes but are stated **below the conceptual line (§7)** — never above it.

---

## 3. The restaurant universe has two spines (the core addition)

The prior docs treat the restaurant as one flat universe (customer, staff, orders, loyalty, menu mixed). That hides the sharpest structure. **Grounded in the Salesforce object model** — which separates the demand funnel (`Lead → Account → Contact → Opportunity`) from the operator (`User`) as a first principle — the restaurant universe has **two spines hanging off one shared skeleton**:

```
              lead ─converts→ tenant ─→ business ─→ branch          (shared org skeleton)
                                           │            │
  DEMAND spine  (external · acquired · resolved) ───────┤            ← identity graph lives HERE, only here
    customer ─→ identity{ wa_id · card · ig · phone · email }        (§4)
    conversation · order · loyalty
                                                        │
  SUPPLY spine  (internal · assigned · deterministic) ──┤            ← RBAC / procurement, NO identity graph
    user ─→ membership( role, scope = tenant|business|branch )
    supplier ─→ inventory · device(KDS/POS) · menu(⟵Zettle) · hours
```

**Why customer ≠ staff/owner** — they enter through opposite doors, so they are different _kinds_ of entity, not two roles of one:

|              | **Customer** (demand)                                          | **Staff / Owner** (supply)                 |
| ------------ | -------------------------------------------------------------- | ------------------------------------------ |
| Enters via   | **acquisition** — reached through channels                     | **onboarding** — hired / signed up         |
| Identity is  | **collected & resolved** (many federated touchpoints → stitch) | **assigned & authenticated** (one login)   |
| Matching     | deterministic → probabilistic (Fellegi-Sunter)                 | none — the business _asserts_ who they are |
| Model        | **identity graph** (CDP)                                       | **RBAC / IAM** (membership + role + scope) |
| Relationship | **served**                                                     | **employs / operates**                     |

**Consequence — `people` dies, and there is no `contact`/`party` root.** A customer is a resolved demand node (§4); a staff member is a `user` + `membership(role, scope)` attached to a node in the org tree. Unifying them under a universal human root optimizes for a rare edge case (owner-is-also-a-customer) at the cost of fusing two unrelated problems — the same `core`/`grow`-swallowing-two-things sin the `abstraction-elimination` review condemned. Both prior docs already keep customer/staff/login as _separate relations_; this doc supplies the **principle** for why (and forbids re-introducing a party root): identity-resolution is a demand-only problem.

---

## 4. Customer identity is a federated graph (demand spine only)

A phone/WhatsApp/Instagram handle is **not an attribute Umi owns** — it is a **federated identifier**: an `(issuer, subject)` pair (NIST SP 800-63C) whose `subject` is meaningful only inside the issuing service's namespace. Umi **collects and mirrors** identity; the external services (Meta, the POS, email providers) issue it. This is the critique's "authority over the human's identity is the customer's; the record _mirrors_ it" — **the mirror principle applied to identity itself** — realized with the CDP identity-graph shape reality-first only gestured at (`customer_contact` with a dedup unique key).

**Model:**

- **`contact`** — the resolved node (the "golden record" / unified profile). Thin; a resolution anchor, no business attributes.
- **`contact_identity`** (matures `contact_method`) — a **provider-stamped identifier edge**: `(contact_id, channel_id, external_id/subject, normalized_value, confidence, match_type, verified_at, collected_via, first/last_seen)`. Deterministic key = `UNIQUE(tenant_id, channel_id, normalized_value)`.
- **`channel`** — a **global reference catalog** (the "issuer" namespace: WhatsApp/Instagram/POS/email/web/manual), carrying the namespace, `normalization_rule` (E.164, lowercased email), `deterministic_matchable`, and default trust. Rides the `global_catalog_read` RLS exception (cross-tenant reference data).
- **`customer`** — the _commercial/loyalty relationship_ a `contact` has with the tenant (absorbs `loyalty.accounts`). First-class Customer-360 row, not a 3-way join.

**Build deterministic-only now** (within-channel exact + cross-channel via `normalized_value`); leave `confidence`/`match_type` as the **seam** for probabilistic matching (Fellegi-Sunter m/u) later. The CDP literature is unanimous: start deterministic (high precision, no ML); add probabilistic only when volume justifies the false-merge risk. **This is not EAV** — each row is a _typed identifier edge_, the standard MDM/CDP golden-record shape, which passes the abstraction-elimination "boring database" test.

_(Scope note per the critique: the customer is **customer-of-a-restaurant** — tenant-scoped. There is no cross-tenant global person. The identity graph resolves federated identifiers **within** a tenant; it does not stitch a diner across two restaurants.)_

---

## 5. `channel` ≠ `supplier`, and the missing supply-side fact

"Provider" is **overloaded** across the two spines and must not become one table:

- **Demand:** the thing a customer is _reached through_ → **`channel`** (the identity **issuer**, §4).
- **Supply:** the thing that _supplies inventory_ → **`supplier` / `vendor`** (procurement).

They share the English word and **nothing else** — different spine, lifecycle, attributes, zero shared behavior. Collapsing them into one `provider`, or reaching for a grand `party` root over customer/supplier/staff/channel, is **false generality** — it re-introduces the polymorphic root the schema was praised for _not_ having, to serve a query ("all parties regardless of role") that never happens. **Role-named tables, joined by FKs to the shared org tree.** The one generalization that _is_ real — federated `(issuer, subject)` identity — is scoped to the demand spine, where it earns its keep.

**A symmetric gap this surfaces:** just as the critique found **Umi's own revenue unmodeled** (no invoice/price/payment), the tenant's **supply side is entirely absent** — there is no `supplier`, no inventory-sourcing, no procurement fact anywhere in the schema today. The menu _items_ are tenant-authored (§5a), but _where the goods come from_ — the supplier — is unmodeled. **Flag, do not invent** (no writer exists): the supply spine is a **known-missing universe**, to be modeled only when a real writer/feature appears — not frozen into speculative DDL now.

---

## 5a. Authority ≠ system-of-record — the menu, and POS as a product

**The menu is tenant-authored; the "Zettle owns the menu" call was wrong — and it was the critique's own sin.** The conceptual-critique demoted the menu to an external Zettle mirror by reading the _current integration code_ (`upsertFromZettle`, force-unavailable-on-absence) as _authority_. That is exactly the error it accused reality-first of: letting the implementation define the conceptual model. `upsertFromZettle` is where the menu currently _enters_; it is not _whose fact it is_.

**First-principle authority test** (the rule that sorts external-mirror vs. tenant-authored): _absent all software and every vendor, who may create/change/retire this fact?_ The menu → the **owner** (they'd write it on a chalkboard; Zettle vanishing changes nothing) → **tenant-authored**. Run across the whole mirror list, **only the menu flips**; pass/WhatsApp-id/currency stay external.

**Separate the three things the critique conflated:**

| Layer                                                | For the menu                                                                                                                                                                                | Fixed?                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Authority** (who may decide)                       | the tenant (owner/admin); authored at **business** level, **branch** overrides availability/price                                                                                           | fixed                                                                |
| **System-of-record** (which system holds the master) | the **Umi API/DB** — Umi's own architecture ("a single backend owns all data; everything else is a thin client"). Zettle is _one source feeding it_; dashboard + POS are _interfaces to it_ | configurable per tenant: `menu_source ∈ {dashboard, zettle, pos, …}` |
| **Interface** (what writes it)                       | dashboard menu editor · Zettle sync · Umi POS — all through the one API                                                                                                                     | many                                                                 |

So the menu is **one tenant fact** with a per-row **`source` provenance stamp** and a tenant-level **system-of-record setting** that decides sync-conflict _direction_. Zettle's overwrite-on-absence is a _policy of the Zettle source_ (active only when Zettle is the chosen SoR), **not** eternal authority — and "Zettle is the authority" directly contradicts Umi's foundational "the API owns the data" principle.

**POS as a product (the literal accounting).** A Umi POS is a likely near-future product; seating it now converts several speculative `∅writer` question-marks into load-bearing facts:

- It joins the catalog: `subscription_item.product_key` gains **`pos`** (with cash/conversaflow/kds/dashboard).
- It is simultaneously an **order channel**, a **payment/refund writer**, a **menu-authoring interface**, and a **loyalty actor** (card scan at the register).
- Under the merge rule (§1), this **promotes `channel`, `payment`, `refund` from `∅writer` to load-bearing** — the second real order channel (beside WhatsApp), the first real payment writer. The multi-channel/payment structure the prior docs called "anticipatory" is now _earned_.
- The dashboard menu editor writing via the API makes the tenant-authored-menu path load-bearing **now**, not hypothetical.

**General rule (symmetry with the identity graph, §4).** Both `product` (menu) and `contact` (customer) are entities carrying a **provenance/source** dimension. The asymmetry is authority _direction_: identity's source is **sovereign** (Meta issues → Umi mirrors, read-mostly); the menu's source is **subordinate** (the tenant decides → the source is just where it's entered). **Every entity records its provenance; the authority test decides whether that provenance is a sovereign to _mirror_ or a channel of entry to _reconcile_.**

---

## 6. Umi is tenant-zero (recursion + self-observability)

The demand spine is **self-similar across two altitudes**, which is exactly Salesforce's B2B-`Account` vs B2C-`Person Account` duality:

- **Umi's** funnel: prospect café (**lead**) → **tenant** (Account) → **subscription** (Opportunity).
- **A tenant's** funnel: WhatsApp walk-up (**lead**) → **customer** (Person Account) → **order** (Opportunity).

Same shape, one level up. This **answers the critique's "Umi is an unmodelled implicit singleton"**: model **Umi as a tenant of its own platform (tenant-zero)**, so leads/subscriptions/billing and _observability of our own system_ are the tenant model pointed at Umi — one model, plus dogfooding. "Observability of our own system" is then not a bolt-on telemetry schema; it is the recursion terminating at the top: Umi watches tenants; Umi-as-tenant-zero watches Umi.

_(Flagged **Umi-inference** — elegant and operation-first, but a synthesis, not a documented pattern. Pressure-test before committing; Umi's commercial data must stay sealed from real tenants, which the §7 seal already enforces. See §10.)_

---

## 7. Physical realization — below the conceptual line (the code integration)

The critique's P2 is honored by stating schemas as **realizations**, never as the model:

- **Schema = the authorship/permission boundary**, realized by the load-bearing seals the audit verified:
  - **`umi`** — Umi's business; `REVOKE USAGE` from the tenant request role (crown-jewel PII, kept forever).
  - **`tenant`** — the restaurant's business; per-tenant RLS. One documented exception: **`login`** is a _cross-tenant principal_ (no `tenant_id`, self-access RLS, secret-sealed) — a real conceptual fact, not an "RLS carve-out."
  - **`runtime`** — quarantined machinery; worker/service-role sealed.
  - **`observability`** — telemetry until it leaves for OTel (then the layout is 3). _This count change is a migration event, not a conceptual conclusion._
  - _(optional 5th)_ **`vault`** — auth secrets sealed even from `umi_app`, reached via `SECURITY DEFINER`; the "seal-by-default so the next secrets table doesn't leak" argument (§10 decision).
- **Schema is NOT the domain boundary.** This is the integration missing from every prior DB doc: **domain (cash / kds / conversaflow / leads) lives in the _code_** — backend `modules/<domain>/`, frontend `products/<domain>/`, and a per-module `AGENTS.md` — **never in schema names.** The old 6-tenant-schema split (`loyalty`/`comms`/`kitchen`/`device`…) was the _schema trying to also be the domain organizer_; free it. The domain boundary is drawn three times in code and should align there; the schema draws only the coarser authorship/permission cut.

So the stack is: **3 conceptual universes → 4 physical schemas (→ 3 after OTel) → N code modules within the `tenant` universe.** An engineer opening the DB sees _Umi's business · the restaurant's business · the plumbing_; an engineer opening the code sees _cash · kds · conversaflow · leads · platform-core_. Neither leaks into the other.

---

## 8. Adjudicated folds (the §1 rule applied)

Greenfield — the ⛔ dual-writer gating from the prior docs is dropped from the _design_ (it returns only as sequencing, §10).

| Contested item                                                                                                             | reality-first                             | critique                                                             | **Verdict (merge rule)**                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `people` as a human root                                                                                                   | keep (roles-as-edges)                     | keep (distinct principals)                                           | **Kill entirely.** Split into demand `contact`/`customer` (§4) and supply `user`+`membership` (§3). Both tests fail for a unified root.                                                                             |
| `loyalty.accounts`                                                                                                         | fold into `card`                          | —                                                                    | **Dissolves into `customer`** (§4) — the loyalty _relationship_ is the customer entity, not a fold into the instrument.                                                                                             |
| `card` derived caches (balance, visit-count)                                                                               | keep balance cache; enshrines visit-count | **card = identity only**                                             | **Critique wins.** balance = `SUM(ledger)`, visit-count = `COUNT(visits)`; the one-cache rule applies to visits too.                                                                                                |
| `conversation` vs live cart/CAS state                                                                                      | keeps them fused in pillar-1              | **split** (cart/state is machinery)                                  | **Critique wins.** "A dialogue thread exists" is the business fact; `draft_cart`/`state_version` join the machinery quarantine (like `conversation_turns`).                                                         |
| `conversation_turns`                                                                                                       | operational, stays in Postgres            | machinery (quarantine), stays                                        | **Both agree it stays;** name it _machinery_, not a "truth pillar."                                                                                                                                                 |
| `birthday_reward`                                                                                                          | fold into `reward_redemption`             | **keep** (entity that can expire unredeemed)                         | **Critique wins** (real, `OR`-to-keep) — folding loses every issued-but-active/expired fact.                                                                                                                        |
| `ops.businesses` config                                                                                                    | **fold into `tenant`**                    | **keep separate** (tenant-authored config ≠ Umi-owned identity root) | **Critique wins.** Two owners = two layers; keep config with its writing module, don't inject it into the RLS root.                                                                                                 |
| RBAC (5 tables)                                                                                                            | collapse to `role` enum                   | keep if tenant-authored                                              | **`tenant_access` + `role` enum** _until custom roles are actually sold_ (fact to confirm, §10).                                                                                                                    |
| option-group vs modifier                                                                                                   | fold into one `product_option`            | **keep distinct** (different grain)                                  | **Critique wins** — or accept the live **Zettle `variants` mirror** as the form.                                                                                                                                    |
| **menu** (product/category/option)                                                                                         | tenant-authored                           | external Zettle mirror                                               | **Corrected (§5a).** Tenant-authored; the **Umi API/DB is the system-of-record**, Zettle a replaceable _source_ (per-row `source` stamp + tenant SoR setting). The critique mis-read the current sync as authority. |
| pass / whatsapp-id / message-SID / currency                                                                                | tenant-authored "forever"                 | **external mirrors**                                                 | **Critique wins.** Genuinely external (Apple/Meta/Twilio/ISO); mirror them; keep the ISO currency column; the SID is a dedup gate → quarantine.                                                                     |
| dead tables (`automation_rules`, `jobs/job_attempts`, `memory_items`, `otp`, unused `device_type`s, migration enum values) | delete                                    | delete                                                               | **Delete.** Both agree.                                                                                                                                                                                             |

---

## 9. Hard invariants preserved (do not re-litigate)

- **Service-role USAGE seals** on the sealed schemas — real, gate-fails-closed; "move to public" stays rejected.
- **Structural tenant isolation** — composite `(tenant_id, id)` FKs make cross-tenant references physically impossible; per-tenant RLS.
- **Append-only money ledgers** (`card_ledger`, `gift_card_ledger`) — `block_append_only_mutation` + `UNIQUE(idempotency_key)`. **Never collapse a ledger to a running-total column.**
- **Secret-column REVOKE** surgery (passwords, tokens) — sealed even where the row is readable.

---

## 10. Open decisions (business, not inventable)

1. **In-house billing vs external processor** → shapes the missing Umi money fact (`invoice`). Until decided, record that Umi's revenue is _deliberately unmodeled_, not "done."
2. **`vault` schema vs table-level `REVOKE`** for auth secrets (seal-by-default vs fewer schemas).
3. **Roles: tenant-authored or fixed?** → decides `tenant_access` + enum vs a role reference table.
4. **`tenant` schema name** — `tenant` (neutral) vs `restaurant` (pure reality-first).
5. **Supply spine scope** — is `supplier`/procurement in scope for alpha? (Likely _no_ — keep it a flagged known-gap until a real writer exists, §5.)
6. **Tenant-zero (§6)** — adopt Umi-as-a-tenant, or keep Umi as a separate admin concern? (Bold; pressure-test.)
7. **umi-cash dual-writer decommission date** — the only _sequencing_ gate (loyalty consolidation); not a design constraint in alpha.
8. **Menu system-of-record policy** — per tenant, is the master the Umi dashboard/POS or an external sync (Zettle)? Decides sync-conflict direction (does Umi push to, or pull from, the integration) and whether `menu_source` is a tenant setting or a global default.
9. **POS as a product** — confirm `pos` joins the catalog; it makes `channel`/`payment`/`refund` load-bearing, so design them as real relations now, not `∅writer` placeholders (§5a).

---

## 11. Research-check ledger (per `scientific-research-check`)

- **Documented fact:** the demand funnel (`Lead/Account/Contact`) is separated from the operator (`User`) as a first principle (Salesforce); a federated identifier is issuer-scoped `(issuer, subject)` (NIST 800-63C); identity resolution is deterministic-then-probabilistic (CDP / Fellegi-Sunter); conceptual precedes physical (ANSI/SPARC, carried from the critique). → _customer gets an identity graph; staff get RBAC; schema realizes authorship, below the conceptual line._ **High confidence.**
- **Source-backed tradeoff:** ERP procurement (suppliers) and CRM demand (customers/channels) are canonically separate modules → don't unify `provider`. Same "role-named over abstract" principle the abstraction-elimination review already set for Umi. **Medium-high.**
- **Umi-specific inference (flagged):** the two spines are self-similar and Umi should be **tenant-zero**, making observability the top instance of the tenant model. Elegant, operation-first, **not** a documented pattern — a proposal to pressure-test, not settled fact.
- **Invalidated if:** staff routinely self-serve as anonymous external actors (e.g. clock-in via WhatsApp with no pre-provisioned login) → the customer/staff wall weakens and the identity graph starts to apply to staff. Or suppliers become multi-touchpoint _acquired_ parties (a supplier marketplace Umi resolves) → `supplier` would want the identity-graph substrate. Neither is true today.

**Primary sources:** Salesforce Lead/Account/Contact/User object model; NIST SP 800-63C (Federation, issuer/subject); RudderStack / Treasure Data / Twilio identity-graph; "(Almost) All of Entity Resolution" (arXiv 2008.04443); Halpin & Morgan ORM; ANSI/X3/SPARC 1975; Codd 1970.

---

## 12. Supersedes / consolidates

This doc is the current accepted target. The following are **superseded as the current model** (kept as history — read them for the _process_, not the answer):

- `2026-07-03-reality-first-audit-and-redesign.md` — the logical/physical relational spec. **Carried forward by reference** (its per-relation predicates remain the working spec, as amended by §8 here).
- `2026-07-03-enterprise-conceptual-modeling-critique.md` — the conceptual ordering (authorship before storage) this doc adopts wholesale; its §7 corrections are §8 verdicts here.
- `2026-07-03-data-storage-pillars.md`, `2026-07-02-codd-enterprise-model.md`, `2026-07-02-abstraction-elimination-review.md`, `2026-07-02-platform-database-architecture-audit.md`, `platform-database-architecture.md` — subsumed (the first was already consolidated by reality-first).

**Net new here vs. all of the above:** the merge rule (§1); the demand/supply spines (§3); federated customer identity as the mirror-principle-applied-to-identity (§4); `channel` ≠ `supplier` + the missing supply-side fact (§5); **authority ≠ system-of-record** — the menu-is-tenant-authored correction + POS-as-a-product (§5a, which corrects the critique's own reverse-the-implementation-into-authority slip); Umi-as-tenant-zero (§6); and **schema = authorship, domain = code** (§7) — the DB↔monorepo integration no prior doc made.
