# Navigation and Information Architecture for the Umi Owner Dashboard

Research date: 2026-09-03. Scope: proven, documented UX patterns only. Each
principle names a rule, cites an authoritative source, and states a concrete
implication for the Umi Dashboard (React SPA, Spanish-speaking cafe owners and
managers, left sidebar that is growing crowded).

Current Umi sidebar (baseline for the implications below):
- Operacion: Overview, Operations hub, Orders, Devices, Staff, Customers
- Crecimiento: Loyalty, Gift cards
- Configuracion: Hours, Settings, Products and billing
- Plataforma: Cafes

That is 4 groups and 13 items, plus a generic "Operations hub" that duplicates
dedicated screens.

---

## Q1. How to structure primary navigation so it stays legible as features grow

### P1.1 Group into a small number of sections; do not use a flat long list
- Source: NN/G, "Top 3 IA Questions about Navigation Menus"
  (https://www.nngroup.com/articles/ia-questions-navigation-menus/)
- Rule: The number of categories must be set by what makes information easiest
  to find, not by a fixed number; long lists (about 20+ items) should be broken
  into a short list of the most-used items plus a grouped or second level.
- Trade-off: NN/G refuses a magic number. "5 categories are perfectly adequate"
  for narrow scope, but complex tools legitimately carry more.
- Umi implication: Keep the current grouped sidebar (grouped, not flat). Groups
  are the right structure; the problem is item count and one duplicate hub, not
  the sidebar model itself.

### P1.2 Working-memory limit: keep a scannable group near 5-7 items
- Source: Laws of UX, "Miller's Law" (https://lawsofux.com/millers-law/);
  Material Design bottom navigation uses 3-5 destinations and moves to a drawer
  at 5+ (https://m3.material.io/components/navigation-drawer/guidelines,
  https://m1.material.io/components/bottom-navigation.html).
- Rule: People hold about 7 (plus or minus 2) chunks in working memory; keep any
  one scannable cluster small. Material caps a flat bar at 5.
- Caveat: Miller's number is about memory, not a hard nav cap; the honest use is
  "chunk into small groups," which the sidebar already does.
- Umi implication: Target 4-6 items per section. "Operacion" currently holds 6
  (fine) but only after the duplicate hub is removed; do not let any section pass
  ~7.

### P1.3 Choice cost rises with the number and complexity of options
- Source: Laws of UX, "Hick's Law" (https://lawsofux.com/hicks-law/); origin
  Hick 1952 / Hyman.
- Rule: Decision time grows with the number and complexity of choices; reduce
  and prioritize options, and reveal advanced ones progressively.
- Umi implication: Every new feature added to the top level taxes every owner on
  every visit. Default new modules into an existing group or behind a second
  level; do not reflexively add a new top-level entry.

### P1.4 Limit navigation depth; two tiers is the practical ceiling
- Source: NN/G, "Menu-Design Checklist: 17 UX Guidelines"
  (https://www.nngroup.com/articles/menu-design/); IBM Carbon, UI shell left
  panel (https://carbondesignsystem.com/components/UI-shell-left-panel/usage/).
- Rule: Cascading multi-level menus are "frustrating with two tiers" and
  "highly inadvisable for more than two tiers." Carbon's side panel "does not
  support three tiers of navigation"; for deeper content use in-page tabs.
- Umi implication: Cap sidebar depth at two levels (Section > Item, or Item >
  one expandable sub-level). Any third level must live as tabs inside the
  destination page, never as a third nav indent.

### P1.5 When to introduce a second level
- Source: NN/G, "Top 3 IA Questions about Navigation Menus" (URL above); IBM
  Carbon, UI shell left panel (URL above).
- Rule: Introduce a second level when a list gets long (NN/G: consider grouping
  or multi-level around 20 items) or when a section has "more than five secondary
  navigation items, or if you expect a user to switch between secondary items
  frequently" (Carbon).
- Umi implication: Products and billing is really two jobs (catalog vs.
  subscription/invoices). When such an item spawns 3+ real sub-screens, promote
  it to a collapsible second level rather than more top-level rows.

### P1.6 Never put unbounded, user-generated lists in the primary nav
- Source: IBM Carbon, UI shell left panel (URL above).
- Rule: "Do not place content that has no upper limit (such as created by users)
  within the shell's side navigation"; usability "drops rapidly" as item count
  climbs.
- Umi implication: Cafes (locations) can grow without bound. Do not list each
  cafe as a nav row; use a location switcher/context control at the top of the
  shell, and keep "Cafes" as a single management entry.

### P1.7 On desktop, keep primary nav visible (no hamburger)
- Source: NN/G, "Menu-Design Checklist" (URL above); NN/G, "Beyond the
  Hamburger: What Makes Navigation Discoverable on Desktops"
  (https://www.nngroup.com/articles/find-navigation-desktop-not-hamburger/).
- Rule: Hiding primary categories behind a hamburger on desktop lowers
  discoverability and use; keep the sidebar visible.
- Umi implication: Owners run the shop on desktop; keep the persistent left
  sidebar. Collapse-to-icons is acceptable, but do not hide categories entirely
  by default.

### P1.8 Overflow, not deletion: give surplus items a "View more"
- Source: Shopify app design, "Navigation"
  (https://shopify.dev/docs/apps/design/navigation) — nav items 7+ convert to a
  "View more" button; Salesforce Lightning nav bar supports overflow and up to
  50 items (https://help.salesforce.com/s/articleView?id=sf.user_userdisplay_tabs_lex.htm).
- Rule: When a list exceeds the comfortable count, overflow the least-used items
  rather than crowd the primary rail.
- Umi implication: If a group must exceed ~6, move the rarely used items under a
  "Mas" / secondary area instead of expanding the visible rail.

---

## Q2. Command center / operations hub vs. dedicated task screens

### P2.1 Prefer a single, canonical entry point per task; avoid duplicate paths
- Source: NN/G, "The Same Link Twice on the Same Page: Do Duplicates Help or
  Hurt?" (https://www.nngroup.com/articles/duplicate-links/).
- Rule: Multiple links to the same destination are "generally" a net negative:
  they raise interaction cost, deplete attention, and load working memory as
  users wonder whether two paths differ. "Only show what's needed. Nothing more."
- Umi implication: The generic "Operations hub" duplicates Orders, Devices,
  Staff. That is exactly the duplicate-path anti-pattern. Give each task one
  home in the sidebar.

### P2.2 Duplicate paths cause pogo-sticking and doubt
- Source: NN/G, "No More Pogo Sticking: Protect Users from Wasted Clicks"
  (https://www.nngroup.com/articles/pogo-sticking/); duplicate-links article
  (URL above).
- Rule: When the same content is reachable from several sections, users
  pogo-stick between them to check whether the content actually differs,
  fragmenting the flow.
- Umi implication: An owner who can reach Orders from both "Operations hub" and
  "Orders" will wonder if the two show different data. Remove the ambiguity.

### P2.3 When a hub IS the right call: a curated home / action surface, not a
duplicate index
- Source: Shopify admin overview — Home "highlights urgent actions or events,
  such as unpaid orders that still need to be captured"
  (https://help.shopify.com/en/manual/shopify-admin/shopify-admin-overview);
  Stripe Dashboard Home surfaces pinned and recently-visited pages
  (https://support.stripe.com/questions/dashboard-update-may-2024).
- Rule: A single cross-domain surface works when it is a triage/overview
  layer (today's alerts, KPIs, shortcuts) that links out to the dedicated
  screens, not a second full menu that re-hosts them.
- Umi implication: Fold the useful part of "Operations hub" into "Overview" as a
  "run today" home: live orders count, device/KDS health, cash status, alerts,
  each a shortcut to the one canonical screen. Then delete "Operations hub" as a
  separate destination. Result: one home that routes, and one home per task.

### P2.4 Trade-off to record
- A command center reduces first-click cost for the daily routine (good for a
  cafe opening the shop). The risk is it becomes a parallel menu. The deciding
  test: does the hub OWN any screen, or only LINK to owners' canonical screens?
  It must only link.

---

## Q3. Information scent and labeling

### P3.1 Labels must let a user predict the destination before clicking
- Source: NN/G, "Information Scent" (https://www.nngroup.com/videos/information-scent/);
  NN/G, "3 Common IA Mistakes (that Are All Due to Low Information Scent)"
  (https://www.nngroup.com/articles/3-ia-mistakes/).
- Rule: Information scent is the cue set (label, context, prior experience) users
  read to predict what is behind a link; "clarity is the most important factor."
- Umi implication: Rename vague rows. "Operations hub" has near-zero scent for a
  cafe owner - it does not say what is behind it. Replace with concrete labels.

### P3.2 Avoid vague verbs, forced parallelism, and conversational labels
- Source: NN/G, "3 Common IA Mistakes" (URL above).
- Rule: Words like "Explore," "Discover," "Connect," "Hub" carry little meaning;
  do not force every label into a matching part of speech or an "I want to..."
  voice.
- Umi implication: Use plain café nouns in Spanish: Pedidos, Dispositivos,
  Personal, Clientes, Lealtad, Horario, Productos. Do not label a section "Hub"
  or "Centro" without a concrete noun.

### P3.3 Use standard, familiar words (match the user's mental model)
- Source: NN/G, "Menu-Design Checklist" (URL above); Laws of UX, "Jakob's Law"
  (https://lawsofux.com/jakobs-law/).
- Rule: Prefer clear, familiar, standard terms over internal jargon; users
  expect your product to work like other products they know.
- Umi implication: Name items the way Square/Toast/Shopify name the same jobs in
  Spanish so owners transfer prior knowledge. Avoid Umi-internal product code
  names (e.g., surface "Umi Cash" as "Lealtad"/"Monedero" if that reads clearer).

### P3.4 Organize by user goal/task, not by internal data model
- Source: NN/G, "Intranet Information Architecture (IA) Trends" - by 2014 about
  86% of new intranet IAs were task/topic based
  (https://www.nngroup.com/articles/intranet-information-architecture-ia/);
  NN/G IA guidance, GOV.UK task-based example.
- Rule: Web users are task-oriented; group by how people use information, not by
  who owns it internally. But category names need not start with a verb - forced
  "I need to..." labels scan poorly.
- Umi implication: Group by the owner's day - run today / grow / set up - using
  short nouns, not by which backend product (POS, KDS, Cash, ConversaFlow) owns
  the data. The current Operacion / Crecimiento / Configuracion split is already
  goal-based; keep that intent, tighten membership.

### P3.5 Order items by frequency of use, not alphabetically
- Source: NN/G, "Top 3 IA Questions about Navigation Menus" (URL above).
- Rule: Prioritize by frequency of use to help the most people reach what they
  most likely want; alphabetical is rarely the most meaningful order.
- Umi implication: Put the daily-run items (Overview, Orders) at the top of the
  first group; push setup/config down. Setup is high-frequency only during
  onboarding, low-frequency after.

---

## Q4. How real owner/admin consoles organize the operator's day

Common pattern across all five: a persistent left sidebar; a Home/overview at
top for "today"; core daily operations next; growth/marketing separate;
configuration/setup pushed to the bottom or behind a gear.

### Shopify Admin
- Source: Shopify admin overview
  (https://help.shopify.com/en/manual/shopify-admin/shopify-admin-overview);
  Polaris Navigation (https://polaris.shopify.com/components/navigation/navigation);
  Shopify app design Navigation (https://shopify.dev/docs/apps/design/navigation).
- Structure: Home (urgent actions, e.g., unpaid orders) > Orders > Products >
  Customers (the operational heart) > then Analytics, Marketing, Discounts >
  Settings lives separately (gear), not in the daily rail.
- Design rules it publishes: "Use the fewest possible categories"; items 7+
  overflow to "View more"; provide breadcrumbs / a back button so users never
  rely on the browser back button; use nouns; name the current page.
- Takeaway for Umi: Today first, core ops next, growth grouped, Settings pulled
  out of the daily flow.

### Stripe Dashboard
- Source: Stripe "Dashboard update: May 2024"
  (https://support.stripe.com/questions/dashboard-update-may-2024); Stripe
  Dashboard basics (https://docs.stripe.com/dashboard/basics).
- Structure: Sidebar organized around jobs (Home, Payments, Billing, Connect,
  Radar, Reporting), which appear based on which products are enabled; the 2024
  update added quick access to transactions/products/customers, a Products
  section to discover features, and shortcuts to pinned and recently-visited
  pages.
- Takeaway for Umi: Nav entries map to jobs, not to the internal data model;
  entries appear according to enabled products (direct precedent for
  entitlement-based nav, Q5); pinned/recent shortcuts help power users.

### Square Dashboard
- Source: Square, "Updated Square POS and Square Dashboard app"
  (https://squareup.com/us/en/the-bottom-line/inside-square/updated-square-pos-and-square-dashboard-app);
  Square Dashboard app help
  (https://squareup.com/help/us/en/article/5618-get-started-with-the-square-dashboard-app).
- Structure: Left nav grouped (Items, Payments/Transactions, Reports, Customers,
  Team, Settings). The mobile Dashboard app lets owners customize which options
  sit in the bottom bar and remove others from the main menu (personalization).
- Cautionary note (trade-off): After a 2024 redesign, Square users publicly
  complained the new nav needed "too much clicking to dig down." Adding depth to
  reduce breadth can backfire if the daily items get buried
  (https://community.squareup.com/t5/Payments-Troubleshooting/New-Dashboard-Interface-Navigation-Pain/td-p/794689).
- Takeaway for Umi: Grouping plus personalization works, but keep daily tasks one
  click deep; do not bury Orders/Overview to tidy the rail.

### Toast (restaurant back office)
- Source: Toast, "Getting Started with Analytics and Reports"
  (https://support.toasttab.com/en/article/Getting-Started-with-Analytics-and-Reports).
- Structure: Toast Web left nav with heavy sections (Front of House setup,
  Reports, Payroll). Reports alone holds 40+ reports across nine categories
  (Sales, Labor, Menus, Payments, Cash and Loss Management, Accounts, Kitchen
  Operations, Marketing, Other) - a worked example of using a second level to
  tame a large domain instead of 40 top-level rows.
- Takeaway for Umi: When one domain (e.g., reports/analytics) grows large, give
  it its own landing page with sub-categories, not many sidebar rows.

### Design-system references for the shell itself
- IBM Carbon UI shell left panel: max two tiers, promote to a second level past
  ~5 secondary items, never put unbounded content in the rail
  (https://carbondesignsystem.com/components/UI-shell-left-panel/usage/).
- Salesforce Lightning: admins pin default nav items users cannot remove, users
  may personalize the rest, and it is recommended to control this per app
  (https://help.salesforce.com/s/articleView?id=sf.user_userdisplay_tabs_lex.htm,
  https://help.salesforce.com/s/articleView?id=sf.user_userdisplay_tabs_lex_considerations.htm).

Synthesized target shape for Umi:
1. Home / "Hoy" (overview + alerts + shortcuts) - replaces Operations hub.
2. Operacion: Pedidos, Dispositivos, KDS, Personal, Clientes.
3. Crecimiento: Lealtad, Gift cards, WhatsApp/ConversaFlow.
4. (bottom / gear) Configuracion: Horario, Productos y facturacion, Ajustes.
5. Location switcher at the top of the shell; "Cafes" as one management entry,
   not one row per cafe.

---

## Q5. Role-based and entitlement-based navigation

### P5.1 Distinguish entitlement gating from audience self-selection
- Source: NN/G, "Audience-Based Navigation: 5 Reasons to Avoid It"
  (https://www.nngroup.com/articles/audience-based-navigation/).
- Rule: Do NOT make users pick "I am an owner / I am a manager" as primary
  navigation - self-identification adds a step, causes doubt, and duplicates
  content. NN/G's critique targets user self-selection, not backend permissions.
- Umi implication: Never add a "choose your role" front door. Instead, gate
  modules automatically by the signed-in user's role/entitlement. Managers
  simply do not see owner-only items; they are never asked to classify
  themselves.

### P5.2 Hide what a role cannot use; do not show dead ends
- Source: NN/G, "Progressive Disclosure"
  (https://www.nngroup.com/articles/progressive-disclosure/); Hick's Law
  (https://lawsofux.com/hicks-law/).
- Rule: Defer or hide features a user cannot or need not act on; showing fewer,
  relevant options improves learnability, efficiency, and error rate.
- Umi implication: If a café has not enabled Umi Cash or ConversaFlow, hide those
  items for that tenant rather than showing disabled rows. Managers without
  billing rights should not see "Productos y facturacion."

### P5.3 But avoid an empty or "broken" feeling - keep the app legible
- Source: Stripe entitlement-driven nav (items appear as products are enabled)
  (https://support.stripe.com/questions/dashboard-update-may-2024); Salesforce
  Lightning pinned-vs-personalizable nav
  (https://help.salesforce.com/s/articleView?id=sf.user_userdisplay_tabs_lex.htm).
- Rule: Two proven approaches: (a) show the item only when the product is
  enabled (Stripe), or (b) admins define a stable default set that lower roles
  cannot remove, with limited personalization (Salesforce).
- Umi implication: Pick per case. For entitlements the tenant has not bought,
  hide entirely (Stripe model) OR show a single discoverable "upgrade/enable"
  entry so the module is discoverable without cluttering the rail. For role
  permissions inside a tenant, hide the items that role cannot use, but keep a
  consistent core (Overview, Orders) so no role lands on an empty shell.

### P5.4 Known trade-off: discoverability vs. clutter
- Hiding unbought modules keeps the nav clean (Hick's Law) but hurts upsell
  discovery. Stripe resolves this with a dedicated "Products" area to discover
  features you do not yet use. Umi can mirror that: one "Descubrir / Activar"
  surface instead of scattering disabled rows.

---

## Where sources agree and disagree

- Strong agreement: keep depth to two tiers (NN/G, Carbon); persistent visible
  desktop sidebar (NN/G); organize by user goal/task (NN/G); clear specific
  labels with strong scent (NN/G); one canonical path per task (NN/G); fewest
  categories (Shopify); hide/defer irrelevant options (NN/G progressive
  disclosure).
- No fixed magic number: NN/G explicitly refuses one ("determined by what makes
  it easiest"), while Material (3-5 in a bar) and Miller (7 plus/minus 2) give
  chunk-size heuristics. Use these as per-group guidance, not a hard total cap.
- Real-world caution: Square's 2024 redesign shows that adding depth to shrink
  breadth can bury daily tasks and anger users - so the "reduce top-level items"
  advice must be balanced against keeping daily jobs one click deep.
- Role/audience nuance: NN/G condemns audience-based navigation, but that is
  about self-selection; entitlement/role gating done automatically (Stripe,
  Salesforce) is a different, endorsed pattern. Do not conflate them.

---

## Concrete redesign checklist for Umi

1. Delete "Operations hub" as a destination; fold its value into an "Overview /
   Hoy" home that only links to canonical screens (Q2).
2. Keep the grouped left sidebar, persistent on desktop; cap two visible tiers;
   4-6 items per group (Q1).
3. Rename every low-scent label to a concrete Spanish café noun; order by daily
   frequency; push setup to a bottom/gear area (Q3).
4. Make "Cafes" a location switcher at the top of the shell, not one nav row per
   location (Q1.6).
5. Gate modules by role and entitlement automatically; never ask the user to
   self-identify; keep a stable core so no role sees an empty app; add one
   "Descubrir/Activar" surface for unbought products (Q5).
6. When any single domain (analytics/reports, products+billing) grows past ~5
   sub-screens, give it a landing page with in-page tabs instead of more sidebar
   rows (Q1.4, Toast precedent).
