# Design skills for coding agents

15 design skills for Claude Code / Cursor / Codex, installed via `npx skills add`.

---

## The one idea that organizes everything

AI UI looks generic because **the model emits the average of its training data**. You cannot fix that
by asking for "something beautiful" — averaging *is* the default. There are three places to intervene:

| | Intervene | How | Skills |
|---|---|---|---|
| **1** | **before** generation | inject constraints, taste, structure | `hallmark` · `frontend-design` · `ui-ux-pro-max` · `theme-factory` · `design-system` |
| **2** | **after** generation | audit output against evidence and rules | `improve-ui` · `baseline-ui` · `fixing-*` · `better-colors` · `better-typography` · `hallmark audit` |
| **3** | **around** generation | let the agent *see* its output and iterate | `webapp-testing` + Playwright/Chrome-DevTools MCP |

**Layer 1 alone has a ceiling.** Rules tell the model what to avoid, but it still cannot see what it is
choosing between, so taste stays a guess. `improve-ui` concedes the same limit when it refuses to judge
hierarchy or density without *"rendered or user evidence."* **Layers 2 and 3 are where the quality is.**

### Adopt `DESIGN.md`
The one convention worth taking from this space. It is converging from three directions at once:
`improve-ui` **consumes** it, ibelick's `create-design-md` **produces** it, and **Google Labs ships
`@google/design.md`** to generate and lint it (`npx @google/design.md lint|export`, exporting to
`css-tailwind` / `json-tailwind` / `dtcg`). It fixes the failure mode where AI workflows collapse three
distinct jobs into one: deciding the look, writing the spec, implementing it.

---

## Pick a skill in 10 seconds

| I want to… | Use | Watch out |
|---|---|---|
| Build a new page that doesn't look AI-made | **`hallmark`** | Heaviest. 16 of 20 themes unshipped |
| Same, lightweight, no lock-in | **`frontend-design`** | 55 lines of prose. No code, no assets |
| Audit without touching my code | **`improve-ui`** or **`hallmark audit`** | `improve-ui` is strictly read-only |
| Kill AI tells in Tailwind/React | **`baseline-ui`** | Tailwind + React only |
| Fix a11y / motion jank / meta tags | **`fixing-*`** | a11y skill cites **no WCAG numbers** |
| Pick a style / palette / font pairing | **`ui-ux-pro-max`** | ⚠️ **30% of palettes fail contrast** |
| **Check or fix a palette's contrast** | **`better-colors`** | OKLCH + APCA. The validator the others lack |
| **Get typography right** | **`better-typography`** | 16 principles + Tailwind cheat sheet |
| Defensible palette fast, with buy-in | **`theme-factory`** | Colors are real; "fonts" are not |
| Set up 3-layer design tokens | **`design-system`** | DTCG-*shaped*, not conformant |
| Build a real React artifact | **`web-artifacts-builder`** | Tailwind pinned 3.4.1; 43 frozen shadcn components |
| Mockups / prototypes / decks | **`baoyu-design`** | Sandboxed to `designs/`. Best with Opus 4.8 |
| Verify it works in a browser | **`webapp-testing`** | No assertions, no test runner |

---

## ⚠️ Before you compose anything

**Only one skill may own an artifact's visual identity.** `frontend-design` is explicitly
*anti-default and anti-consistency* — it will fight an existing design system. If you already have one,
use `improve-ui` instead. `theme-factory` and `design-system` are the token-layer alternatives.

**The two official skills contradict each other.** `web-artifacts-builder` still says to avoid "purple
gradients… **Inter font**"; `frontend-design` **deleted** that blacklist in PR #1293 (2026-06-09),
replacing it with a three-cluster calibration. Commentary describing a font blacklist in
`frontend-design` is describing a version that no longer exists.

**Everything here runs offline** — no network egress, no API keys.

---

## Layer 1 — Direction & generation

### `hallmark` — the strongest anti-slop generator
`Nutlope/hallmark` · 14,428★ · MIT · **106 files, 9,591 lines of Markdown, zero code**

**Use for:** a new landing/marketing page or component that must not look generated.
**Not for:** app logic (own contract: "visual/interaction layer only"), data-dense dashboards, brand
identity, or token-tight sessions.

- **58 gates** — not the 57 its README claims (`slop-test.md` is titled "58 gates": 1–57 plus `38a`).
- **6-axis pre-emit self-critique** (Philosophy/Hierarchy/Execution/Specificity/Restraint/Variety),
  scored 1–5; `<3` forces a revision pass; result stamped into the CSS. **This is a layer-2 loop built
  into a layer-1 skill** — the reason it outperforms plain rule injection.
- 50 component archetypes (**14 navs**, rotated so no two builds match), 21 macrostructures, 4 genres.
- 4 verbs: default · **`audit`** (read-only, incl. a "stamp lies" check) · `redesign` · `study`
  (DNA extraction from a URL/screenshot, with a refuse list: themeforest, dribbble, behance).
- Stateful: `.hallmark/log.json`, `preflight.json`, a CSS stamp, a root `tokens.css`.

Representative rules: no gradient text in *any* genre · banned fonts incl. **Poppins** · max 3 families
("Four families is slop") · no italic headings · no invented metrics ("trusted by 50,000+ teams") ·
no fake browser/phone chrome · neutrals ≥0.005 chroma · accent ≤~5% of viewport.

> **⚠️ 16 of 20 theme palettes don't ship.** They live in the repo's root `site/css/tokens.css`, outside
> the skill; here that path resolves to `.agents/site/`, **which doesn't exist**. Only carnival, cobalt,
> hum and lumen have real specs — the rest are names plus a blurb, reconstructed from `color.md` rules.
> Copy `site/css/tokens.css` from the upstream repo if you want the other 16.

### `frontend-design` — official, and much smaller than its reputation
`anthropics/skills` · Apache 2.0 · **55 lines of prose. No scripts, no fonts, no components.**

**Use for:** taste guidance with zero lock-in on greenfield UI.
**Not for:** an existing design system (it is explicitly anti-default), or reproducible output.

Zero occurrences of React, Tailwind, shadcn, Figma, or "component". **It is a taste prompt.**

Contains a **calibration list of the three looks AI design clusters around** (warm cream `#F4F1EA` +
serif + terracotta · near-black + one acid accent · broadsheet with hairline rules), then a two-pass
method: brainstorm tokens (**Color** 4–6 hex · **Type** 2+ roles · **Layout** prose + ASCII wireframes ·
**Signature**) → self-review against the brief *before* writing code.

**~20% of the skill is UX-writing doctrine** — name things by what people control ("a person manages
notifications, not webhook config"), "Publish" stays "Published" through the flow, errors never
apologize. **The most overlooked part, and the most portable.**

**Composes with:** `web-artifacts-builder` (supplies the aesthetic the builder omits), `theme-factory`
(its token block *is* a custom theme), `webapp-testing` (it asks for screenshots, ships no capture).

### `ui-ux-pro-max` — a real search engine over a padded database
`nextlevelbuilder/ui-ux-pro-max-skill` · 108,283★ · MIT

**Use for:** a defensible starting style/palette/type pairing; stack-specific do/don'ts (22 stacks).
**Not for:** anything needing accessible-by-default color.

Contents: **84 styles · 192 palettes · 74 font pairings · 192 product types · 99 UX guidelines**
(not the 98 advertised) · 105 icons (not 104) · 16 motion presets · 25 charts · 22 stacks. The
"database" is **35 CSVs** read by a hand-rolled **BM25** engine (`core.py`, 464 lines, stdlib only)
with mtime-keyed caches and a deterministic tie-break — genuinely well-built.

> ### ⚠️ 29.6% of the color database fails the skill's own #1 rule
> Across all **1,344** foreground/background pairs: **Muted/Muted-Foreground fails 4.5:1 in 150/192
> palettes (78%)**; Accent/On-Accent 113/192 (59%); total **398/1,344**. At a 3:1 threshold failures drop
> to **0/576** — these were engineered to 3:1 (large-text/non-text) and shipped as general-purpose.
> Worst: `#10B981`+white = **2.54:1**. The SKILL.md priority-1 row reads *"Accessibility | CRITICAL |
> Contrast 4.5:1"*, and the bundled `validate_data.py` **never computes a contrast ratio.**
> Muted-foreground is normally secondary **body** text. **Always check a palette before shipping it.**

> **⚠️ Two live gotchas.** (1) Claude Code registers the **old 67/96/57 copy** at
> `~/.claude/skills/ui-ux-pro-max`, not this 84/192/74 one. (2) SKILL.md invokes
> `${CLAUDE_PLUGIN_ROOT}/.claude/skills/...` **11×**; that variable is unset in a plain skills install,
> so it expands to a nonexistent path. **Fix the paths before first use.**

**On the star count:** 108,283★ against **480 watchers** (226:1; Linux ≈ 25:1), on 196 commits, from an
org whose other 10 repos hold **under 3,700 stars combined**. The 192 palettes derive from **50 distinct
primary hexes** (`#2563EB` is primary of 17), and 26 are exact duplicates. The *depth* files are real —
`styles.csv` at 1,622 chars/row, `ux-guidelines.csv` with a code example on 99/99 rows.
**Use the depth, distrust the counts.**

### `baoyu-design` — artifact factory, sandboxed
`JimLiu/baoyu-design` · 2,737★ · MIT · **150 files — the only skill here with substantial real code**

**Use for:** mockups, clickable prototypes, decks, wireframes — artifacts that are *not* your
production codebase. **Not for:** editing your live app (output lands in `designs/<project>/`), or
enforcing taste on existing code (no audit mode, no gates).

Repackages **Claude Design** (the engine behind claude.ai/design) as a local skill — a community
effort, **explicitly not affiliated with Anthropic**. Internal evidence supports the port:
`references/claude.md` maps hosted-only tools (`questions_v2`, `fork_verifier_agent`, `gen_pptx`), and
it preserves Claude Design's original design-system import/compile path.

33 built-in skills · 11 starter components (`deck-stage.js`, 2,755 lines) · **editable PPTX** (vendors
pptxgenjs, native animations) · `.mp4` export · **offline `.fig` decoding** via a vendored 5,113-line
`fig-materialize.mjs` — **no Figma account, no MCP, no rate limit.** Process-first: *"easily 10+
questions across a couple of Ask-Question rounds."* Weakest anti-slop enforcement of the set (one
paragraph of tropes), so pair it with a layer-2 pass when porting output into real code.

Works well as a prototype-then-implement loop with Claude Code's built-in browser preview.

---

## Layer 2 — Audit & remediation (the high-leverage half)

The `ibelick/ui-skills` family (5,709★, MIT) is the most rigorous work here. Its insight is that there
are **two audit epistemologies**, and you want both:

- **`improve-ui` is relativist** — the product's own evidence is the only law.
  *"Absence of design documentation is not a finding."* → **"is it self-consistent?"**
- **`baseline-ui` + `fixing-*` are absolutist** — a fixed rule sheet regardless of repo.
  → **"is it correct?"**

### `improve-ui` — read-only auditor that writes plans for another agent
**Use for:** design-system drift, handoff prep, or any audit that *structurally cannot* touch your tree.
**Not for:** applying fixes now (it refuses), greenfield surfaces, or a11y/SEO/perf (deferred to siblings).

1. **Read-only**, single write target: `design-plans/`. No installs, no commits.
2. **Contains zero design rules** — all normative content comes from the audited repo.
3. **Plans are self-contained**: *"its executor has no context from the audit or conversation."*

A finding survives only if **all three** hold — **Contract** (*"'Prefer,' 'generally,' names, omissions,
and repetition do not establish a contract"*), **Runtime** (traced path to the surface), **Correction**
(exactly one; if the evidence supports several, **reject**). Then an explicit falsification pass.
Hard cap: **"Stop at three."** Fail-closed: *"No supported findings were found."*
Cannot prove hierarchy/density/clarity — *"require rendered or user evidence"* (→ layer 3).

> **⚠️ Installed via the `ui-skills` CLI this skill is broken** — `llms.txt` serves only `SKILL.md`, but
> line 110 tells it to read `references/plan-template.md`, which the CLI never delivers. **The copy here
> includes that file.**

### `baseline-ui` — deslop lint for Tailwind + React
42 rules (15 MUST / 15 NEVER / 12 SHOULD). Despite promising "spacing, hierarchy, typography", it is
mostly **anti-AI-tell**: no gradients unless asked · no purple/multicolor gradients · no glow as a
primary affordance · one accent per view · no animation unless requested · `h-dvh` not `h-screen` ·
`text-balance`/`text-pretty` · `tabular-nums` · never touch `tracking-*` · fixed z-index scale ·
`AlertDialog` for destructive actions · never block paste.
**Only numeric threshold: 200ms interaction feedback.**
**Not for** non-Tailwind/React codebases (~¼ of rules become noise) or repos with a house design system.

Quietly one of the most useful skills in this set despite attracting almost no attention.

### `better-colors` — OKLCH, and the only real contrast validator here
`jakubkrehel/skills` · 610★ · MIT · SKILL.md + 4 references (`accessibility-contrast.md`,
`color-conversion.md`, `gamut-and-tailwind.md`, `palette-generation.md`)

**Use for:** checking or repairing a palette, generating ramps, converting hex/rgb/hsl → OKLCH,
Display-P3 gamut boundaries, Tailwind v4 theming.
**Why it earns its place:** it is **the answer to `ui-ux-pro-max`'s 30% contrast failure.**

*"Most color problems in CSS (broken palettes, failing contrast, hue drift) come from using color
spaces that don't match how we see. OKLCH fixes the model so the tools work."*

It ships **actual numbers**, which almost nothing else here does:

| Rule | Value |
|---|---|
| Light/dark boundary | L > 0.6 → use dark text |
| Lightness gap (light bg) | Foreground L < 0.35 when bg L > 0.9 |
| Hue drift threshold | > 10° spread across steps = visible drift |
| **APCA body text** | **\|Lc\| ≥ 75 minimum, ≥ 90 preferred** |
| WCAG 2 normal text | 4.5:1 AA · 7:1 AAA |
| **Contrast fix** | **Adjust L only; chroma has negligible effect** |

That last rule is the operational one: failing palettes are mechanically repairable by darkening
foreground lightness alone, so the palette keeps its character. It also carries **APCA** alongside
WCAG 2 — the perceptual model WCAG 3 is moving toward, and the only mention of it in this library.

### `better-typography` — the type layer `theme-factory` doesn't give you
`jakubkrehel/skills` · 610★ · MIT · SKILL.md + 6 references (`choosing-fonts.md`, `css-cheat-sheet.md`,
`details-and-accessibility.md`, `spacing-and-sizing.md`, `variable-fonts-and-opentype.md`,
`wrapping-and-punctuation.md`)

**16 numbered principles:** serve the right format · properties over raw tags · **no fake weights** ·
fewer fonts/sizes/weights · type scale with semantic names · heading sizes descend with level ·
line-height by role · letter-spacing by size · **cap the measure** · wrap deliberately · tabular numbers
on changing values · truncate without losing content · underlines from the font · **inputs at 16px on
mobile** (the iOS zoom bug) · size and contrast floors.

Its discipline is the selling point: *"check how the codebase styles things and express every change in
that system… **Never introduce a second styling approach just to apply a typography fix.**"*
`css-cheat-sheet.md` maps each declaration to its Tailwind equivalent, so it works in either world
without forcing a migration.

### `fixing-accessibility` · `fixing-motion-performance` · `fixing-metadata`
Prioritized, critical-first checklists. Two modes: ambient constraints, or "review this file → quote
the exact line / why it matters / a concrete fix."

- **`fixing-motion-performance`** — the strongest of the three. Ships a rendering-steps glossary
  (composite / paint / layout) grounding every rule. Catches read-write interleaving, scroll-event-driven
  animation, and rAF without a stop condition — plus a rule most guides miss: **never animate CSS
  variables** for transform/opacity/position, and never inherited ones. Hard number: **blur ≤ 8px**,
  never continuous. Prefers Scroll/View Timelines + IntersectionObserver. Ships a working FLIP snippet.
- **`fixing-accessibility`** — good ARIA philosophy (*"prefer native HTML before adding aria"*, no
  `tabindex > 0`, toasts must not be the only channel for critical info).
  > **⚠️ Cites no WCAG criteria, no levels, no ratios.** "WCAG" appears once — in its description; the
  > entire contrast rule is *"ensure sufficient contrast."* It is a heuristics checklist, **not a
  > conformance tool**, and it reads source rather than rendering. Pair it with a real axe/Lighthouse run.
- **`fixing-metadata`** — correctness, not SEO strategy. Deterministic metadata, absolute OG URLs,
  `og:url` matches canonical, staging `noindex`, and an anti-hallucination guard: *"do not invent
  ratings, reviews, prices, or organization details."*

---

## Layer 1½ / 3 — Tokens, build, verification

### `design-system` — three-layer tokens
**96 tokens: 57 primitive / 15 semantic / 18 component / 6 dark**, with **39 using reference syntax**
(`semantic.color.primary → {primitive.color.blue.600}` → `component.button.bg → {semantic.color.primary}`).
A real three-layer implementation, not a README diagram. `generate-tokens.cjs` resolves to CSS vars;
`validate-tokens.cjs` flags raw hex in source.
> **⚠️ DTCG-*shaped*, not conformant.** Its `$schema` points at `design-tokens.org/schema.json`, which
> **does not resolve** (the spec lives at `tr.designtokens.org`), and its top-level `dark` group is a
> custom extension — DTCG has no theme-group concept. Don't promise a client spec compliance.

### `theme-factory` — 10 palettes, confirmation-gated
Ocean Depths · Sunset Boulevard · Forest Canopy · Modern Minimalist · Golden Hour · Arctic Frost ·
Desert Rose · Tech Innovation · Botanical Garden · Midnight Galaxy.
Protocol: show the showcase PDF → ask → **wait for confirmation** → apply.
> **⚠️ The "10 font pairings" are really 2.** Every pairing is DejaVu or FreeSans — Linux
> container/matplotlib fonts that render as generic sans/serif on the web. **The colors are the
> deliverable; source typography elsewhere.**

### `web-artifacts-builder` — the only executable build skill
React 18 + TS + **Vite 5.4.11** (dev) + **Parcel** (single-file bundle) + **Tailwind pinned 3.4.1**
(not v4) + 26 Radix packages + **43 shadcn components** vendored as a frozen tarball.
**Absent vs current shadcn:** `sidebar`, `chart`, `input-otp`, `pagination`, `alert-dialog`, `data-table`
— there is no registry access, so use the shadcn MCP for anything newer.
Explicitly **not** for simple single-file artifacts.

### `webapp-testing` — close the loop
Not an MCP and not a test framework: it has Claude **write Python Playwright scripts**.
`scripts/with_server.py` manages server lifecycle (repeatable `--server`/`--port`, socket-polls until
ready, `finally`-block terminate→kill). One non-negotiable rule: `wait_for_load_state('networkidle')`
before inspecting.
**No assertions, no runner, no tracing, no multi-browser.** Prefer the Playwright / Chrome-DevTools /
claude-in-chrome MCP servers for interactive work; reach for this when you need a **scripted,
repeatable, server-managed** run.

---

## Recipes

**New marketing page, must not look generated**
```
hallmark (build) → webapp-testing (screenshot) → hallmark audit → fix
```
Layer 1 → 3 → 2. The audit pass is what separates this from a one-shot prompt.

**Existing app feels inconsistent**
```
DESIGN.md → improve-ui (read-only audit) → design-plans/*.md → executor agent
```
Generate `DESIGN.md` with `npx @google/design.md` or ibelick's `create-design-md`.

**Quality gate before merge**
```
baseline-ui + fixing-accessibility + fixing-motion-performance → then verify in a real browser
```
The source-reading auditors cannot see contrast, focus order, or overlap. Layer 3 is not optional here.

**Design exploration for stakeholders**
```
baoyu-design → designs/<project>/ → PPTX / PDF / MP4
```

---

## Composes with (outside this folder)

- **shadcn MCP / `vercel:shadcn`** — components beyond the 43 frozen in `web-artifacts-builder`.
- **Playwright MCP · Chrome DevTools MCP · claude-in-chrome** — layer 3, interactively. Chrome DevTools
  MCP adds `lighthouse_audit` and `performance_start_trace`, which no skill here provides.
- **`dataviz` skill** — charts and dashboards.
- **`@google/design.md`** — `npx @google/design.md lint|export`; the emerging interop format.
- **No skill here integrates Figma MCP.** `baoyu-design` decodes `.fig` **offline**, which is usually
  better — no account, no MCP, no rate limit.

---

## Gaps worth closing

| Gap | Why it matters |
|---|---|
| `create-design-md` not installed | **Produces the `DESIGN.md` that `improve-ui` consumes.** Closes the loop: `npx skills add ibelick/ui-skills --skill create-design-md` |
| `hallmark` themes | 16 of 20 palettes unshipped — copy `site/css/tokens.css` from upstream |
| `ui-ux-pro-max` paths | `${CLAUDE_PLUGIN_ROOT}` unset → 11 broken invocation sites |
| `ui-ux-pro-max` stale copy | Claude Code registers the old 67/96/57 copy in `~/.claude/skills/` |

---

## Skill authoring notes

Triggering is **pure description-matching** against always-resident metadata — the `description` line is
the highest-leverage line in any skill. **Progressive disclosure:** L1 metadata ~100 tokens/skill always
loaded · L2 SKILL.md body on trigger (<5k tokens recommended) · L3 resources only when read — and
**scripts run via bash contribute only their output, never their source.** There is **no context penalty
for bundled content that is never read**, so bundle generously and keep SKILL.md lean.

**Security:** skills are executable capability, not just prompts. Audit `SKILL.md` *and* bundled scripts.
Skills that fetch external URLs are the highest-risk category — fetched content can carry injected
instructions.
