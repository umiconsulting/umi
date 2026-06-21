# ConversaFlow Design System — Master Reference

> **Source of truth:** `app/globals.css` (tokens) + this document (rules).
> Updated: 2026-03-19

---

## Identity

**Aesthetic:** Warm, tactile, tabular — paper, wood, ledger. Not flat-digital.
**Inspiration:** Japanese train boards, Mexican cafe counters, British split-flap boards, wooden typesetter trays, accounting ledgers.
**Fonts:** Inter (data/UI, tabular figures) + Source Serif 4 (narrative headers).
**Color space:** Hex warm neutrals. Color reserved for status only.
**Mode:** Light by default. Dark warm charcoal for Trace depth mode via `[data-depth="trace"]`.

---

## Color Tokens

### Surfaces (warm paper stack)

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#FAFAF7` | Warm white (ledger paper) |
| `--surface-0` | `#FAFAF7` | Page background |
| `--surface-1` | `#F5F3EE` | Cream sections |
| `--surface-2` | `#EDEAE3` | Hover states |
| `--surface-3` | `#E5E2DA` | Active states |
| `--surface-4` | `#DDD9D0` | Selected |

### Text Hierarchy (ink)

| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `#1A1A18` | Ink black |
| `--text-secondary` | `#6B6860` | Faded ink |
| `--text-dim` | `#9C9890` | Pencil marks |

### Status (color ONLY for status)

| Token | Value | Usage |
|-------|-------|-------|
| `--status-active` | `#2D8A4E` | Green dot — live, success |
| `--status-pending` | `#C4880D` | Amber dot — pending, tool calls |
| `--status-error` | `#C4392D` | Red dot — errors |
| `--status-info` | `#3B7CC9` | Blue — incoming, informational |

### Event Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--event-incoming` | `#3B7CC9` | Incoming messages |
| `--event-claude` | `#7C6B8A` | AI responses |
| `--event-tool` | `#C4880D` | Tool calls |
| `--event-result` | `#2D8A4E` | Results |
| `--event-memory` | `#3B9B8A` | Memory operations |
| `--event-error` | `#C4392D` | Errors |

### Ruled Line

`--ruled-line: #D4D0C8` — horizontal rules separating sections (like a ledger).

---

## Typography

| Token | Range | Usage |
|-------|-------|-------|
| `--text-log-xs` | 10–12px | Timestamps, metadata |
| `--text-log-sm` | 11–13px | Log rows |
| `--text-log-base` | 12–14px | Table cells |
| `--text-ui` | 12–14px | UI elements |
| `--text-label` | 10–11px | Section labels (uppercase) |
| `--text-heading` | 14–18px | Section titles |
| `--text-title` | 16–20px | Page titles |
| `--text-narrative` | 18–28px | Narrative headers (Source Serif 4) |
| `--text-metric` | 22–32px | KPI values |

All use `clamp()` for fluid scaling.

---

## Containment Rules

- **NO cards, shadows, or bordered containers.**
- Sections separated by horizontal ruled lines (`--ruled-line`).
- Section headers: small uppercase labels (typesetter tray pattern).
- Status indicators: small colored dots + plain text (train board pattern).
- Empty cells: visible blank space (typesetter tray pattern).

---

## Depth Modes

| Mode | Background | Font | Density | Notes |
|------|-----------|------|---------|-------|
| **Surface** | Warm white | Inter + Serif headers | Minimal | Friendly, narrative |
| **System** | Warm white | Inter, more columns | Medium | Tabular-nums for numbers |
| **Trace** | Dark charcoal `#1C1B19` | Monospace throughout | Maximum | Via `[data-depth="trace"]` on `<html>` |

Trace mode inverts to dark via CSS custom properties override — no class toggle needed.

---

## Absence Pattern

| State | Visual |
|-------|--------|
| Empty/null | Dashed underline, dim text (`---`) |
| Stale data | Reduced text opacity |
| Delayed | Amber dot + "Delayed" text |
| Partial loading | Partially rendered row |

---

## Component Patterns

### MetricCard
- Status dot (colored) + uppercase label
- Large tabular-nums value
- Optional subtitle in secondary text
- Bottom ruled line (not card border)

### StatusBadge
- Colored dot + plain text label
- No badge container/border

### Tables
- Double-weight header border
- Horizontal ruled lines only (no vertical, no zebra)
- Hover → `--surface-2`

### Buttons
- No font-mono
- Primary: green border + bg tint
- Destructive: red border + bg tint

---

## Removed from Previous System

- OKLCh color space (replaced with hex)
- `--glow-*` tokens and `.glow-*` utilities
- `--spring-*` physics easing
- Scanline/noise background textures
- `.system-live`, `.system-alert`, `.system-critical` classes
- `.dark` class (replaced by `[data-depth="trace"]`)
- Geist / Geist Mono fonts
- Card borders and shadow containment
