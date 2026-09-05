# Proven psychology and interaction-design principles for the Umi Dashboard

Purpose: give the Umi Dashboard redesign a set of proven, well-documented rules that
make a daily-use owner console feel natural, organic, and low-friction. Every principle
below has an authoritative source (Nielsen Norman Group, Laws of UX, or the original
usability heuristics). Each entry gives the rule in one line and a concrete implication
for the café-owner dashboard.

Product context: web owner console for Spanish-speaking café owners and managers (not
engineers). Used daily to watch orders, manage devices, staff and customers, run loyalty
and gift cards, set hours, and configure the business. The owner handles money, so the
app must feel trustworthy. The workflow must stay familiar as features grow.

---

## 1. Cognitive load and chunking

### Miller's Law (and its correction)
- Source: "Miller's Law", Laws of UX — https://lawsofux.com/millers-law/
- Source: "Working Memory", Laws of UX — https://lawsofux.com/working-memory/
- Source: "How Chunking Helps Content Processing", Nielsen Norman Group — https://www.nngroup.com/articles/chunking/
- Rule: The average person holds about 7 (plus or minus 2) items in working memory; modern
  research puts the reliable limit near 4 chunks, and each chunk fades in 20-30 seconds.
- Implication: Do not make the owner hold numbers in their head across screens. Group the
  home screen into a few labeled blocks (for example: Ventas de hoy, Pedidos activos,
  Equipo, Lealtad). Keep each block to a small set of items. Persist context (selected
  location, date range) so the owner never re-enters it.

### MISAPPLICATION TO FLAG
- Laws of UX takeaway: "Don't use the 'magical number seven' to justify unnecessary design
  limitations." Do NOT cap navigation, menus, or a table's columns at 7 because of Miller.
  Menus rely on recognition, not recall — all options stay on screen, so there is no
  memory gain from trimming to 7 (NN/G, chunking article). Chunk and label instead of
  deleting useful controls.

---

## 2. Decision cost

### Hick's Law
- Source: "Hick's Law", Laws of UX — https://lawsofux.com/hicks-law/
- Source: "Choice Overload", Laws of UX — https://lawsofux.com/choice-overload/
- Rule: Decision time grows with the number and complexity of choices (RT = a + b·log2(n)).
- Implication: On any action-heavy screen, highlight the recommended or most-used action
  and defer the rest. Example: the order card shows one primary action (Marcar listo);
  refunds, edits, and notes sit behind a secondary "más" control. Break setup (business
  config, loyalty rules) into small steps instead of one dense form.
- Caveat (when more options are fine): Laws of UX warns, "Be careful not to simplify to the
  point of abstraction." When choices are equally likely and the user is scanning (a list
  of customers, a grid of products), showing them all is faster than hiding them. Hick's
  Law applies to a single decision point, not to a well-categorized list where the user
  already knows what they seek. Categorize and group rather than hide.

---

## 3. Motor cost and targets

### Fitts's Law
- Source: "Fitts's Law and Its Applications in UX", Nielsen Norman Group — https://www.nngroup.com/articles/fitts-law/
- Source: "Fitts's Law", Laws of UX — https://lawsofux.com/fittss-law/
- Source: "Touch Targets on Touchscreens", Nielsen Norman Group — https://www.nngroup.com/articles/touch-target-size/
- Rule: The time to reach a target grows with distance and shrinks with target size; make
  frequent targets big and close, and use screen edges and corners as "infinite" targets.
- Implication:
  - Make the primary action of each task large and place it next to where the eye or hand
    already is (put "Guardar" beside the last field, not far in a header).
  - On touchscreens (tablet at the counter), touch targets must be at least 1 cm × 1 cm
    (about 0.4 in), with enough space between them to prevent mis-taps. Money actions
    (cobrar, reembolsar) get generous targets to cut error.
  - Anchor persistent controls to edges. A fixed action bar at the bottom or a top edge
    toolbar is faster to hit because the edge stops the pointer. Note: the edge advantage
    disappears on touchscreens, so rely on size and spacing there.
  - Keep primary actions inside the thumb-reach zone on tablets (lower and center), not in
    top corners that a thumb cannot reach one-handed.

---

## 4. Familiarity and mental models

### Jakob's Law
- Source: "Jakob's Law", Laws of UX — https://lawsofux.com/jakobs-law/
- Source: "Mental Models and User Experience Design", Nielsen Norman Group — https://www.nngroup.com/articles/mental-models/
- Rule: Users spend most of their time on other apps, so they expect yours to work like the
  apps they already know; leverage existing mental models so users focus on tasks, not on
  learning a new model.
- Implication: Follow the conventions café owners already meet daily — WhatsApp, Instagram,
  banking apps, other POS and delivery dashboards. Left sidebar for sections, top bar for
  account and search, a logo top-left that returns home, a gear for settings, a magnifier
  for search. Do not invent new metaphors for common actions.
- How to evolve without breaking the model (this is the owner's key worry): Jakob's Law
  takeaway — "When making changes, minimize discord by empowering users to continue using a
  familiar version for a limited time." Ship the redesign additively: keep the existing
  information architecture and labels stable, add new features into the established slots,
  and where a screen must change, offer a preview or an opt-in transition period (the
  YouTube 2017 Material redesign is the cited model). Never move or rename a daily control
  without a bridge.

---

## 5. Recognition over recall, progressive disclosure, and defaults

### Recognition rather than recall
- Source: "Memory Recognition and Recall in User Interfaces", Nielsen Norman Group — https://www.nngroup.com/articles/recognition-and-recall/
- Rule: Recognizing is easier than recalling; keep needed information and options visible so
  users do not retrieve them from memory.
- Implication: Show the customer's name, phone, and loyalty balance on the order and profile
  cards, not behind a lookup the owner must remember. Use recent lists, breadcrumbs, and
  visible state (which location, which shift) so the owner recognizes context.

### Progressive disclosure
- Source: "Progressive Disclosure", Nielsen Norman Group — https://www.nngroup.com/articles/progressive-disclosure/
- Rule: Show the few most important options first; reveal advanced or rare options on
  request. This improves learnability, efficiency, and error rate at once.
- Implication: Each screen shows the daily core; advanced settings (tax rules, device
  provisioning, loyalty tiers) live one level deeper behind a clearly labeled control with
  strong "scent" (the label predicts what is inside). Decide primary vs secondary by real
  usage data, not by guessing.

### Wizards (staged disclosure) vs inline
- Source: "Progressive Disclosure", Nielsen Norman Group — https://www.nngroup.com/articles/progressive-disclosure/
- Rule: Staged disclosure (a wizard) guides users linearly through a one-time or ordered
  task; progressive disclosure suits an interface used repeatedly.
- Implication: Use a wizard for one-time or ordered setup (first-run onboarding, opening a
  new location, creating a gift-card campaign). Use inline progressive disclosure for daily
  screens the owner revisits, so experts are not forced through steps every time.

### Sensible defaults
- Source: "Progressive Disclosure", Nielsen Norman Group — https://www.nngroup.com/articles/progressive-disclosure/
- Rule: Present the primary/default options by default; a good default lets most users
  proceed without a decision.
- Implication: Pre-fill business hours, currency (MXN), tax, and loyalty defaults with
  sensible Mexican-café values. The owner confirms rather than configures from zero.

---

## 6. Gestalt principles for grouping and reading a screen

### Proximity
- Source: "Proximity Principle in Visual Design", Nielsen Norman Group — https://www.nngroup.com/articles/gestalt-proximity/
- Rule: Items placed close together are read as one group; whitespace alone can group and
  separate, and proximity can overpower color or shape.
- Implication: Group each control with its label and its data by spacing, and separate
  unrelated blocks with clear whitespace. This lets the owner scan the dashboard in blocks
  instead of reading every element.

### Similarity
- Source: "Similarity Principle in Visual Design", Nielsen Norman Group — https://www.nngroup.com/articles/gestalt-similarity/
- Rule: Elements that share color, shape, or size are read as related.
- Implication: Give every primary action the same shape and color across the whole
  dashboard; give every destructive action (reembolsar, eliminar) the same distinct
  treatment. The owner learns one visual language once.

### Common region
- Source: "The Principle of Common Region: Containers Create Groupings", Nielsen Norman Group — https://www.nngroup.com/articles/common-region/
- Rule: Items inside a shared boundary (a card, a panel, a background) are read as one
  group; a border can overpower proximity.
- Implication: Use cards and panels to bound each job (one card per active order, one panel
  per config area). Caution from NN/G: use whitespace first; add borders only when needed —
  too many boxes create clutter and "false floors" that stop scrolling.

### Continuity (implied companion principle)
- Source: Gestalt principles overview, Nielsen Norman Group — https://www.nngroup.com/videos/the-gestalt-principles-intro/
- Rule: The eye follows aligned elements as a continuous path.
- Implication: Align controls and text to a shared grid so the eye flows down a column
  without effort. Ragged alignment forces re-reading.

---

## 7. Nielsen's 10 usability heuristics

- Source: "10 Usability Heuristics for User Interface Design", Jakob Nielsen, Nielsen Norman
  Group, 1994, last reviewed 2024 — https://www.nngroup.com/articles/ten-usability-heuristics/
- Source: "10 Usability Heuristics Applied to Complex Applications", Nielsen Norman Group — https://www.nngroup.com/articles/usability-heuristics-complex-applications/

The 10 heuristics:
1. Visibility of system status — keep users informed with timely feedback.
2. Match between system and the real world — speak the users' language, not jargon.
3. User control and freedom — provide a clear "emergency exit" (undo/cancel).
4. Consistency and standards — same words and actions mean the same thing; follow
   conventions.
5. Error prevention — design so problems do not happen in the first place.
6. Recognition rather than recall — make elements, actions, and options visible.
7. Flexibility and efficiency of use — shortcuts for experts, hidden from novices.
8. Aesthetic and minimalist design — no irrelevant or rarely needed information.
9. Help users recognize, diagnose, and recover from errors — plain-language messages that
   name the problem and suggest a fix.
10. Help and documentation — ideally not needed; provide it when it is.

The one or two that matter most for a dense operations dashboard:
- Visibility of system status (#1). An operations dashboard exists to answer "what is
  happening right now." Implication: show live order state, device online/offline, sync
  status, and last-updated time. Confirm every money action immediately.
- Recognition rather than recall (#6), tied to Aesthetic and minimalist design (#8). A dense
  screen must still let the owner scan. Implication: surface the few numbers that drive
  decisions; push detail to drill-down; never make the owner remember a value from another
  screen.

---

## 8. Trust: consistency, feedback and system status, error prevention

### Consistency and standards
- Source: "Maintain Consistency and Adhere to Standards (Usability Heuristic #4)", Nielsen Norman Group — https://www.nngroup.com/articles/consistency-and-standards/
- Rule: Keep internal consistency (same patterns across all Umi screens) and external
  consistency (follow web and industry conventions). Consistency lets users transfer
  knowledge, which lowers the learning curve and builds trust.
- Implication: One design system across the whole dashboard — one button style, one table
  style, one date format (Mexican), one money format (MXN). As features are added, they
  reuse the same components, so the app never feels bolted-on.

### Visibility of system status / feedback
- Source: "Visibility of System Status (Usability Heuristic #1)", Nielsen Norman Group — https://www.nngroup.com/articles/visibility-system-status/
- Source: "Progress Indicators Make a Slow System Less Insufferable", Nielsen Norman Group — https://www.nngroup.com/articles/progress-indicators/
- Rule: Give feedback as fast as possible, ideally immediately; communicating state lets
  users feel in control and trust the product and the brand.
- Implication: Every action (cobrar, registrar visita, canjear recompensa) returns instant,
  clear feedback — a success state, an updated balance, a receipt. Long actions show a
  progress indicator. Show a clear online/offline and sync indicator, because money data
  must feel current.

### Error prevention and recovery
- Source: "10 Usability Heuristics", heuristics #5 and #9, Nielsen Norman Group — https://www.nngroup.com/articles/ten-usability-heuristics/
- Rule: Prevent errors first (remove error-prone conditions, or confirm before commit);
  when an error occurs, explain it in plain language and suggest a fix.
- Implication: For money and destructive actions, require a confirmation that restates the
  amount and the customer, and offer undo where possible. Validate inputs inline (phone
  format, amounts). Error messages in plain Spanish that name the problem and the next step,
  never a code. This is what makes an owner handling money trust the console.

### User control and freedom
- Source: "10 Usability Heuristics", heuristic #3, Nielsen Norman Group — https://www.nngroup.com/articles/ten-usability-heuristics/
- Rule: Users act by mistake and need a clearly marked exit — undo and redo.
- Implication: Provide cancel on every flow and undo on reversible actions (a wrongly
  registered visit, an accidental status change). A visible exit reduces the fear that
  makes an owner slow and distrustful.

---

## 9. Task-oriented vs data-oriented layout

### Design around jobs, not tables
- Source: "Personas vs. Jobs-to-Be-Done", Nielsen Norman Group — https://www.nngroup.com/articles/personas-jobs-be-done/
- Source: "Task Analysis: Support Users in Achieving Their Goals", Nielsen Norman Group — https://www.nngroup.com/articles/task-analysis/
- Source: "8 Design Guidelines for Complex Applications", Nielsen Norman Group — https://www.nngroup.com/articles/complex-application-design/
- Rule: Design around the outcomes users "hire" the product for and the tasks that reach
  those outcomes — not around the database structure. NN/G's complex-app guidelines say to
  provide flexible, non-linear pathways, reduce clutter without reducing capability, and
  make important information visually salient.
- Implication: Name and shape screens after owner jobs, not after tables. "Atender pedidos",
  "Cobrar", "Fidelizar clientes", "Abrir/cerrar caja" — not "tabla de órdenes", "tabla de
  clientes". Each job screen puts its primary action first and hides the raw table behind
  it. Do not expose the schema as the UI.

### At-a-glance overview vs drill-down
- Source: "Dashboards: Making Charts and Graphs Easier to Understand", Nielsen Norman Group — https://www.nngroup.com/articles/dashboards-preattentive/
- Rule: A dashboard has one job — communicate critical information fast, with minimal
  interaction. Operational dashboards serve time-sensitive monitoring; analytical
  dashboards serve slower analysis. Use preattentive attributes (length, 2D position) for
  quantities; avoid area-based charts (pie, gauge) that are hard to read quickly.
- Implication: The Umi home is an operational overview: today's sales, active orders,
  devices, alerts — a few key numbers, each a jump-off point. Deep data (full order
  history, customer records, loyalty reports) lives in drill-down views, reached from the
  overview. Use bars and lines for the KPIs, not gauges or pies. Let the owner hover or tap
  a number to see detail without leaving the overview.

---

## Summary of misapplications to avoid
- Do not cap navigation, menus, tabs, or table columns at "7" because of Miller's Law. It
  applies to memory, not to visible on-screen options. (Laws of UX; NN/G chunking)
- Do not use Hick's Law to hide options the owner scans routinely. Categorize and group
  instead of deleting. Over-simplification hides needed power. (Laws of UX)
- Do not treat Fitts's edge advantage as universal — it does not hold on touchscreens; rely
  on target size and spacing there. (NN/G Fitts's Law)
- Do not add a border to every group — common region overused creates clutter and false
  floors. Use whitespace first. (NN/G common region)
- Do not redesign by moving or renaming daily controls without a transition; Jakob's Law
  says familiarity is the asset to protect. (Laws of UX Jakob's Law)
