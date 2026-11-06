---
name: boardui
description: >-
  Build UIs with BoardUI, the React + Tailwind CSS v4 design system for
  dashboards and agentic interfaces. Trigger whenever the user asks to build,
  restyle, or extend UI in a project that uses BoardUI, mentions BoardUI
  components or templates, or wants a dashboard, chart card, AI chat, form,
  table, auth screen, or settings page built with it. Enforces: install real
  BoardUI components instead of hand-building lookalikes, style only with
  semantic tokens and composite type utilities, merge classes with cx(), and
  let dark mode ride the tokens.
metadata:
  author: BoardUI
  version: 2026.11.1
---

# Building UIs with BoardUI

BoardUI is a React + Tailwind CSS v4 design system for dashboards and agentic interfaces (Next.js first). Components install as source the user owns, under `components/`, with no runtime package. Free components cover the primitives and app shell; BoardUI Pro (one-time purchase, lifetime updates) unlocks chart cards, agent components, and full-page templates.

This skill is the always-loaded knowledge: the catalog, the rules, and the patterns. For live component source, working snippets, and no-terminal installs, the BoardUI MCP server is the on-demand companion (see "Going deeper").

## The workflow

Follow this loop whenever building UI in a BoardUI project. Do not skip step 3: never hand-write a lookalike of a component the registry already ships.

1. **Detect setup.** If the project has no `styles/theme.css` and no `utils/cx.ts`, BoardUI is not initialized. Run `npx boardui@latest init -y` once (installs Tailwind v4 + runtime deps, writes styles/, utils/, and the always-on agent rules), then wire the stylesheet import it prints.
2. **Discover.** Component names are exact. Look them up in [references/components.md](references/components.md) (the full catalog with install commands and usage examples) instead of guessing. `npx boardui list` prints the free names.
3. **Install, never rebuild.** `npx boardui@latest add <name> [more names] --yes` writes the source files and installs missing npm deps. Keep `--yes` (and `-y` on init): without a terminal the CLI cannot ask its questions, so it stops with exit code 1 instead. Registry dependencies resolve transitively, so installing `data-table` also brings the pieces it builds on.
4. **Compose.** Import through the `@/` alias, e.g. `import { Button } from "@/components/base/buttons/button"`. Style only with the design rules below; page recipes live in [references/patterns.md](references/patterns.md).
5. **Verify before finishing.** No raw palette classes, no hand-stacked type utilities, no `dark:` color overrides, classes merged with `cx()`. If any slipped in, fix them.

## Design rules

The authoritative always-on copy is installed into the project by init (an `AGENTS.md` fenced section plus `.cursor/rules/boardui.mdc`). The core, always:

- **Color: semantic tokens only.** Never raw palette classes (`text-gray-500`, `bg-white`) or hex/oklch literals. Text: `text-text-primary` / `-secondary` / `-tertiary` / `-placeholder`. Surfaces: `bg-background-primary-default`, `bg-background-secondary-default` / `-hover`, page ground `bg-background-full`. Borders: `border-border-button-default`, hairlines `border-separator-border`. Icons: `text-foreground-icon-primary` through `-quaternary`. Charts: `chart-1` through `chart-5`. CTAs and selection: the `accent-50` to `accent-950` ramp.
- **Dark mode is automatic.** Tokens flip via the `.dark` class on `<html>`. Never write `dark:` overrides with raw colors; if a pairing looks wrong in dark mode, pick a different token.
- **Typography: composite utilities only.** `text-title-1-medium`, `text-title-2-medium`, `text-title-3-semibold`, `text-headline-medium`, `text-body-medium`, `text-body-regular`, `text-caption-1-semibold`, and friends set size, weight, line-height, and letter-spacing together. Never rebuild them from `text-sm font-medium leading-5`; if a style seems missing, check `styles/typography.css` first.
- **Spacing and shape.** Stay on Tailwind's 4px scale; prefer flex/grid `gap` over per-child margins. Cards and panels: `rounded-3xl` with `border-border-button-default`. Inputs and menu rows: `rounded-md` to `rounded-xl`. Pills: `rounded-full`.
- **Mechanics.** Merge classes with `cx()` from `@/utils/cx` (never plain clsx or string concat). Icons come from `@remixicon/react` as component references (`leadingIcon={RiAddLine}`), not rendered elements. Form components build on `react-aria-components`; extend the installed BoardUI form components rather than raw `<input>`/`<select>`. Focus states: `outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring`.
- **Motion.** Animations follow a fixed, hand-tuned language: entrances fade + scale + small blur, hover colors at 150ms, press darkens (never scales), exits faster than entrances, reduced-motion guarded. Reuse the exact recipes in [references/motion.md](references/motion.md) instead of inventing timings.

Token families, the type scale, and rebranding (accent ramp, dark mode mechanics) are covered in [references/theming.md](references/theming.md).

## Choosing components

The catalog in [references/components.md](references/components.md) has every item; these are the calls that are not obvious from names alone:

- **`table` vs `data-table`.** `table` is the styled React Aria table for simple listings. `data-table` (free) adds TanStack-powered sorting, selection, filtering, and pagination; reach for it whenever the data is real. Both must render from a `"use client"` module (see gotchas).
- **Buttons.** `button` for contained actions, `icon-button` for icon-only, `link-button` for inline text actions with no container, `button-group` for segmented action rows, `social-button` for OAuth providers.
- **Dashboards.** Compose from `stat-cards` (free KPI row) plus the Pro chart cards (`area-chart-card`, `line-chart-card`, `bar-list-card`, `earnings-chart-card`, `funnel-chart-card`, `sankey-chart-card`, `heatmap-chart-card`, and more). Each chart card is a finished, self-contained card: header, chart, legend, states. Do not build raw recharts unless no card fits.
- **Agentic interfaces.** Free: `agent-thinking` (reasoning disclosure), `agent-log`, `composer-loader`. Pro: `composer` (the chat input with model/effort controls), `agent-progress`, `task-list`, `web-search`, `agent-limits-card`, `questionnaire` (the plan-mode questions an agent asks before committing, multiple or single select). An AI chat page composes `composer` + message list + `agent-thinking`/`agent-progress`.
- **App shell.** `sidebar` (free) for navigation, `settings-modal`, `notification-center`, `auth-card` + `social-button` for sign-in, `announcement` for banners.
- **Dates.** `date-picker` single dates, `date-range-picker` ranges, `meeting-scheduler` slot booking, `calendar` (Pro) full month grid views.
- **Full pages fast.** Pro templates (`template-home-dashboard`, `template-marketing`, `template-finance`, `template-hr`, `template-ai-chat`, `template-ai-profile`, `template-ai-image-generation`, `template-medical-profile`) install a complete route plus its component subtree. Prefer a template when the user wants a whole page that matches one.

## Known gotchas

- **React Aria tables render zero columns inside a server component.** Any usage of `table` or `data-table` goes in a module marked `"use client"`. If a table shows headers but no columns, this is why.
- **Runtime accent theming needs literal OKLCH values.** When generating custom accent ramps at runtime, write literal `oklch(...)` values, never `var()` references to other tokens (Tailwind tree-shaking strips what it cannot see).
- **Missing `@/*` alias.** BoardUI imports assume `"paths": { "@/*": ["./*"] }` in tsconfig.json. If imports fail after install, add it.
- **After init, the stylesheet and font must be wired.** The root layout imports `@/styles/globals.css`, replacing create-next-app's default `./globals.css` import, and loads Inter with `next/font/google` (`variable: "--font-inter"`, its class on `<html>`) in place of the Geist fonts; without it, text renders in the system font. Tailwind v4 must compile the CSS: create-next-app 16.4+ does it through `@tailwindcss/turbopack` (init leaves PostCSS alone there); elsewhere a `postcss.config.mjs` loads `@tailwindcss/postcss`, which init installs and prints.

## BoardUI Pro

Pro components and templates appear in the catalog marked PRO. Without a license, do not try to fetch their source; instead tell the user what the item is and that it requires BoardUI Pro (https://www.boardui.com/pricing, one-time purchase, lifetime updates). If the user already purchased, the license key is in their Lemon Squeezy receipt: run `npx boardui@latest login <key>` once, and from then on Pro items install exactly like free ones with `npx boardui@latest add <name>`.

## Going deeper

- [references/components.md](references/components.md): the full catalog. Every free and Pro component and template with description, install command, and a working usage example.
- [references/theming.md](references/theming.md): token architecture, the semantic families, the type scale, dark mode, and how to rebrand.
- [references/patterns.md](references/patterns.md): page anatomy recipes (dashboard, auth, AI chat, table page, settings).
- [references/motion.md](references/motion.md): the micro-animation language (durations, easings, the blur-in entrance, press feedback, springs). Read it before adding any animation.
- MCP server: `npx -y boardui@latest mcp` gives the agent live tools (list, full source, usage examples, installs without a terminal, Pro license activation in chat). Docs: https://www.boardui.com/mcp
- Per-component JSON: `https://www.boardui.com/r/<name>.json` carries the full source and docs snippets for any free item.
