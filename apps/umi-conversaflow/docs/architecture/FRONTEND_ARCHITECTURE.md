# ConversaFlow — Complete Frontend Architecture Document
### Principal-Level AI Forensic Console Redesign

> **Status:** Implementation Ready
> **Project:** `apps/umi-logs/` (Next.js 15+, App Router)
> **Supabase Project:** `xbudknbimkgjjgohnjgp`
> **Stack:** Deno Edge Functions (backend) · Next.js + React 19 (frontend)

---

## Table of Contents

1. [Current State Audit](#1-current-state-audit)
2. [Tooling Research & Selection](#2-tooling-research--selection)
3. [First Principles Architecture](#3-first-principles-architecture)
4. [Proposed Stack (Final Selection)](#4-proposed-stack-final-selection)
5. [Visual System — Matrix Design](#5-visual-system--matrix-design)
6. [Performance Proof](#6-performance-proof)
7. [Industry Pattern Analysis](#7-industry-pattern-analysis)
8. [Ideal Structural Model for ConversaFlow](#8-ideal-structural-model-for-conversaflow)
9. [Migration Plan — 6 Stages](#9-migration-plan--6-stages)
10. [Immediate Implementation Sequence](#10-immediate-implementation-sequence)

---

## 1. Current State Audit

### 1.1 Severity Summary

| Issue | Severity | Impact |
|---|---|---|
| Emoji-based log parsing — structured fields ignored | **CRITICAL** | All backend telemetry invisible |
| No correlation ID linking across views | **CRITICAL** | Traces cannot be reconstructed |
| JavaScript-level filtering after fetch | **HIGH** | Silent data truncation beyond 200-row limit |
| No cursor pagination (hard LIMIT) | **HIGH** | Data silently dropped, no historical browsing |
| No virtualization in LiveLogs | **HIGH** | Degrades at >500 events |
| `select('*')` on all queries | **MEDIUM** | Over-fetching, wasted bandwidth |
| No error boundaries | **MEDIUM** | Single failure crashes entire page |
| No streaming via Suspense | **MEDIUM** | Page blocks until slowest query |
| ISR staleness (30-60s) on incident data | **MEDIUM** | Stale data during active incidents |
| No JSON tree inspector | **MEDIUM** | Raw `<pre>` text only |
| No trace reconstruction view | **HIGH** | Cannot follow causality chain |
| Recharts SVG at scale | **LOW** | Degrades above 1000 data points |

### 1.2 The Critical Data Contract Failure

The backend now emits **structured JSON logs** with:
- `request_id` — correlates all operations in one WhatsApp message handling
- `correlation_id` — cross-service trace identifier
- `event_kind` — typed event category
- `tokens: { input, output, cache_read, cache_creation }` — per-turn accounting
- `latency_ms` — per-operation timing
- `retrieval_score` — Voyage AI semantic similarity score
- `failure_category` — structured error classification
- `customer_id`, `conversation_id`, `twilio_message_sid`
- `memory_tiers: { tier1_used, tier2_used, tier3_used }`

The current `lib/logsApi.ts` parses log events by emoji prefix:
```typescript
if (msg.startsWith('📱')) return 'incoming'
if (msg.startsWith('📊 Initial response')) return 'initial_response'
if (msg.startsWith('🔧 Processing')) return 'tool_call'
```
**All structured fields are discarded.** This is the single highest-leverage fix in the entire project.

### 1.3 Current Architecture Assessment

**Grade: B−** — Clean foundation, wrong data contract, missing forensic capabilities.

**What works well:**
- Server Components + ISR data fetching pattern
- TypeScript strict mode throughout
- shadcn/ui primitives are solid
- Parallel `Promise.all` queries
- Service role key properly server-side only

**What is structurally broken:**
- Emoji parsing masks structured telemetry
- Hard limits silently truncate data beyond N rows
- No drill-down below entity level
- No cross-entity correlation navigation
- No trace reconstruction
- No streaming (page blocks on slowest query)
- All data flows as static props — no client-side cache

---

## 2. Tooling Research & Selection

### 2.1 Final Stack — Comparison Matrix

| Tool | Bundle | Performance | Fit | Verdict |
|---|---|---|---|---|
| **TanStack Table v8** | 15KB | Excellent | Critical | ✅ Add |
| **TanStack Virtual v3** | 4KB | Excellent | Critical | ✅ Add |
| **TanStack Query v5** | 35KB | Excellent | High | ✅ Add |
| **Zustand v5** | 1KB | Excellent | High | ✅ Add |
| **ECharts** | ~180KB* | Excellent (Canvas) | High | ✅ Add |
| **Observable Plot** | 62KB | Good (SVG) | Medium | ✅ Add |
| **react-virtuoso** | 20KB | Very Good | Medium (chat only) | ✅ Add (scoped) |
| **Fuse.js** | 10KB | Good | Medium | ✅ Add |
| Custom JSON Inspector | 0KB | Excellent | Critical | ✅ Build |
| Custom SVG Trace Timeline | 0KB | Excellent | Critical | ✅ Build |
| **Recharts** | 185KB | Poor at scale | Low | ❌ Replace |
| AG Grid Community | 340KB | Excellent | Low (style conflict) | ❌ Skip |
| Glide Data Grid (Canvas) | 180KB | Extreme | Low (no links/copy) | ❌ Skip |
| react-json-view | 38KB | Poor (no virtual) | Low | ❌ Skip |
| React Flow | 83KB | Poor | Low (wrong model) | ❌ Skip |
| deck.gl / WebGL | 500KB+ | Extreme | Low (overkill) | ❌ Skip |
| SWR | 10KB | Good | Low (missing features) | ❌ Skip |
| React Aria | 30KB+ | Good | Low (Radix covers it) | ❌ Skip |

*ECharts tree-shaken to chart types in use

**Retained unchanged:** Next.js, React 19, Supabase JS, Tailwind CSS v4, shadcn/ui, Radix UI, Lucide React, Geist fonts, clsx, tailwind-merge, CVA

### 2.2 Key Decisions Justified

**TanStack Table + Virtual over AG Grid:** 15KB + 4KB vs 340KB. TanStack is headless (we own every DOM node = full Matrix aesthetic control). AG Grid's internal styles fight against a custom dark theme.

**ECharts over Recharts:** Canvas rendering handles 100K+ data points. DataZoom is a first-class component — engineers drag handles to zoom time ranges. Recharts has no zoom and SVG degrades above 1000 points.

**Zustand over Context/Redux:** 1KB, selector-based subscriptions (components only re-render on their specific slice), built-in DevTools. Context re-renders all consumers on any change.

**TanStack Query over SWR:** `useInfiniteQuery` for cursor pagination, `enabled` for conditional fetching (only load trace when a correlation ID is selected), `placeholderData` (no flash of empty between filter changes).

**Custom JSON Inspector:** A virtualized tree using TanStack Virtual, styled to Matrix tokens. `react-json-view` is 38KB with no virtualization — a Claude API response with 200 JSON nodes would create 200 DOM nodes with no windowing. Custom implementation: ~0KB extra, full aesthetic control, virtualized by design.

**Custom SVG Trace Timeline:** ConversaFlow traces are shallow (depth 2-3, max ~50 spans per request). SVG handles this perfectly. React Flow adds 83KB of node-graph infrastructure designed for interactive editors — wrong abstraction.

**Observable Plot for statistical charts:** Latency histograms (p50/p95/p99), similarity score distributions. Lightweight (62KB), beautiful mathematical aesthetics, SVG output CSS-styleable.

---

## 3. First Principles Architecture

### 3.1 The Forensic Loop

Every design decision must serve this workflow:

```
Symptom observed (metric spike / customer complaint / error alert)
         ↓
   Time range narrowed (log density histogram brush-select)
         ↓
   Entity identified (filtered, sorted, virtualized table)
         ↓
   Trace reconstructed (correlated span waterfall)
         ↓
   Evidence inspected (JSON tree, raw log line)
         ↓
   Root cause localized → fix deployed → loop back to verify
```

### 3.2 The Four-Layer Information Model

```
Layer 0 — System Pulse         (overview: is anything wrong right now?)
Layer 1 — Request Stream       (what happened in this time window?)
Layer 2 — Request Trace        (what happened inside this specific request?)
Layer 3 — Span Inspection      (what was the exact content of this operation?)
```

Navigation between layers is **drill-by-click** — clicking a correlation badge, an entity ID, or a metric card navigates forward into the next layer. The previous layer remains accessible via breadcrumb.

### 3.3 Core Architecture Planes

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA PLANE (Supabase)                        │
│   PostgreSQL + pgvector + Analytics API + External APIs         │
└───────────────────────┬─────────────────────────────────────────┘
                        │ cursor-paginated, column-specific queries
┌───────────────────────▼─────────────────────────────────────────┐
│               SERVER LAYER (Next.js RSC)                        │
│   Route segments · Streaming Suspense · Domain service modules  │
│   No state, no side effects — pure data transformation          │
└───────────────────────┬─────────────────────────────────────────┘
                        │ serialized props + RSC payload
┌───────────────────────▼─────────────────────────────────────────┐
│             CLIENT CACHE LAYER (TanStack Query)                 │
│   Stale-while-revalidate · Infinite queries · Background poll   │
└───────────────────────┬─────────────────────────────────────────┘
                        │ reactive subscriptions
┌───────────────────────▼─────────────────────────────────────────┐
│               RENDERING LAYER (React 19)                        │
│   TanStack Virtual · ECharts Canvas · Custom JSON/Trace SVG     │
│   Zustand UI state (panels, selections, expanded rows)          │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 State Management — Three Domains

| Domain | Owner | Examples | Persistence |
|---|---|---|---|
| Server state | TanStack Query | Conversation data, invocation list, live logs | Time-based (staleTime) |
| Navigation state | URL params | Time range, filters, active entity ID | Permanent (shareable URL) |
| UI state | Zustand | Expanded rows, open panels, active tab | Session only |

**Rule:** Never mix domains. URL state is shareable. Zustand is ephemeral. TanStack Query is async. Each tool does one job.

### 3.5 Pagination Contract — No OFFSET Allowed

All event/log tables use **composite cursor pagination**:

```sql
-- First page
SELECT id, created_at, status, function_name, duration_ms, error_message, request_id
FROM edge_function_logs
WHERE created_at >= :time_start
ORDER BY created_at DESC, id DESC
LIMIT 50;

-- Next page (cursor = last row's created_at + id)
SELECT id, created_at, status, function_name, duration_ms, error_message, request_id
FROM edge_function_logs
WHERE (created_at < :cursor_ts OR (created_at = :cursor_ts AND id < :cursor_id))
  AND created_at >= :time_start
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

`(created_at, id)` composite cursor is stable under high-insert-rate (two rows can share a millisecond timestamp; the ID makes the cursor unique and deterministic).

**OFFSET is forbidden on any table with >10,000 rows.** `LIMIT 50 OFFSET 50000` = full sequential scan on a 1M-row table = catastrophic.

### 3.6 Virtualization Contract

**Every list with potential for >100 rows is virtualized.**

```
TanStack Virtual v3 — row virtualization (tables, trace event lists)
TanStack Virtual v3 — variable height (expandable rows with JSON)
TanStack Virtual v3 — grid mode (heatmap cells)
react-virtuoso — reverse scroll (conversation message thread)
```

**DOM node budget:** `ceil(viewport_height / row_height) + (2 × overscan)`. For 900px viewport, 32px rows, 5-row overscan: **38 DOM nodes maximum** regardless of 100K rows. This is a hard invariant, not a target.

### 3.7 Server/Client Boundary

**Server Components** (static output from props):
- All `page.tsx` files
- `Sidebar.tsx` layout chrome
- `MetricCard.tsx`, `StatusBadge.tsx`, `Breadcrumb.tsx`
- Initial metric data (via Suspense streaming)

**Client Components** (`'use client'`):
- All tables (TanStack Table + Virtual)
- All charts (ECharts, Observable Plot)
- `TraceTimeline.tsx`, `JsonInspector.tsx`
- `FilterBar.tsx`, `CommandPalette.tsx`
- All Zustand store consumers
- `LiveLogs.tsx` (polling + expansion state)

### 3.8 Streaming Strategy

Every page that loads data uses React Suspense streaming:

```tsx
<Layout>
  {/* Renders at 0ms — no data required */}
  <PageHeader />

  {/* Streams at ~100ms — fast aggregation queries */}
  <Suspense fallback={<MetricsSkeleton />}>
    <MetricsStrip />
  </Suspense>

  {/* Streams at ~300ms — main entity data */}
  <Suspense fallback={<TableSkeleton />}>
    <ExplorationShell />
  </Suspense>

  {/* Streams at ~600ms — cross-table joins */}
  <Suspense fallback={<TraceSkeleton />}>
    <TracePanel />
  </Suspense>

  {/* Streams at ~900ms — Supabase Analytics API (slowest) */}
  <Suspense fallback={<LogSkeleton />}>
    <RawLogPanel />
  </Suspense>
</Layout>
```

**ISR is removed** from incident-relevant pages. Replace with dynamic rendering + TanStack Query `refetchInterval`. Engineers debugging an incident cannot work with 60-second stale data.

---

## 4. Proposed Stack (Final Selection)

| Layer | Technology | Justification |
|---|---|---|
| Framework | Next.js 15+ App Router | RSC + streaming + code splitting — no better alternative |
| Data fetching | TanStack Query v5 | Cursor pagination, conditional queries, background refresh |
| Tables | TanStack Table v8 + Virtual v3 | Headless, 15KB, server-side row model for 1M+ rows |
| Charts (time-series) | ECharts | Canvas rendering, DataZoom, handles 100K+ points |
| Charts (statistical) | Observable Plot | 62KB, D3-based, histogram/scatter |
| Chat thread | react-virtuoso | Reverse scroll + auto-sizing for message thread |
| State (UI) | Zustand v5 | 1KB, selector-based, no re-render waste |
| Search | Fuse.js | In-memory fuzzy search for command palette |
| JSON viewer | Custom (TanStack Virtual) | Virtualized tree, full Matrix aesthetic, 0KB overhead |
| Trace view | Custom SVG waterfall | Perfect for ConversaFlow's shallow linear trace model |
| Typography | Geist Mono | Already loaded, variable font, excellent at 11-14px |
| Styling | Tailwind CSS v4 + CSS custom properties | OKLch colors, token system, utility-first |
| UI primitives | shadcn/ui + Radix UI | Keep — excellent accessibility foundation |

---

## 5. Visual System — Matrix Design

### 5.1 Philosophy

The aesthetic is **terminal-grade** — every visual choice encodes information, creates hierarchy, or aids legibility. Nothing is decorative. The reference: the discipline of systems like Datadog, Grafana, Honeycomb, and Jaeger's log explorer — but implemented from first principles, not imitated.

**The three criteria every visual element must satisfy (at least one):**
1. **Hierarchy** — tells the engineer where to look first
2. **Encoding** — carries semantic meaning (color = event type, brightness = severity, width = duration)
3. **Legibility** — makes dense information readable at 11-14px

### 5.2 Color Token System

```css
.dark {
  /* ── SURFACES (Z-axis depth) ── */
  --surface-0:  oklch(0.04 0 0);    /* Void black — page background */
  --surface-1:  oklch(0.08 0 0);    /* Card backgrounds */
  --surface-2:  oklch(0.10 0 0);    /* Nested surfaces, code bg */
  --surface-3:  oklch(0.13 0 0);    /* Hover states */
  --surface-4:  oklch(0.17 0 0);    /* Active/selected */

  /* ── TEXT HIERARCHY ── */
  --text-primary:   oklch(0.88 0 0);   /* Main content */
  --text-secondary: oklch(0.50 0 0);   /* Labels, column headers */
  --text-dim:       oklch(0.35 0 0);   /* Timestamps, metadata */

  /* ── ACCENT SYSTEM (semantic, sparse) ── */
  --accent-matrix:       oklch(0.80 0.195 148);   /* Matrix green — success, live, active */
  --accent-matrix-dim:   oklch(0.60 0.140 148);
  --accent-matrix-glow:  oklch(0.80 0.195 148 / 0.12);
  --accent-matrix-muted: oklch(0.80 0.195 148 / 0.06);

  --accent-info:       oklch(0.72 0.170 235);   /* Electric blue — incoming data */
  --accent-info-glow:  oklch(0.72 0.170 235 / 0.10);

  --accent-warn:       oklch(0.80 0.165 75);    /* Amber — tool calls, pending */
  --accent-warn-glow:  oklch(0.80 0.165 75 / 0.10);

  --accent-error:       oklch(0.65 0.220 25);   /* Signal red — errors, security */
  --accent-error-glow:  oklch(0.65 0.220 25 / 0.10);

  --accent-ai:       oklch(0.72 0.165 290);   /* AI purple — Claude responses */
  --accent-ai-glow:  oklch(0.72 0.165 290 / 0.10);

  --accent-retrieval:       oklch(0.78 0.130 195);   /* Retrieval cyan — memory ops */
  --accent-retrieval-glow:  oklch(0.78 0.130 195 / 0.08);

  /* ── SEMANTIC EVENT COLORS ── */
  --event-incoming:   var(--accent-info);       /* WhatsApp message received */
  --event-claude:     var(--accent-ai);          /* Claude API call */
  --event-tool:       var(--accent-warn);        /* Tool call */
  --event-result:     var(--accent-matrix);      /* Tool result / success */
  --event-memory:     var(--accent-retrieval);   /* Memory tier operation */
  --event-error:      var(--accent-error);       /* Error */
  --event-security:   var(--accent-error);       /* Security event */
  --event-neutral:    oklch(0.40 0 0);           /* Boot, shutdown */
}
```

**WCAG Accessibility:**
| Pair | Contrast | Standard |
|---|---|---|
| text-primary / surface-0 | ~18:1 | AAA |
| text-secondary / surface-0 | ~7:1 | AA |
| accent-matrix / surface-0 | ~9:1 | AAA |
| accent-error / surface-0 | ~6:1 | AA |
| accent-ai / surface-0 | ~5.2:1 | AA |

`text-dim` (3.8:1) used only for non-critical metadata at ≥12px. Never for errors or actionable content.

### 5.3 Typography System

**Base decision: entire console is monospace (Geist Mono).** This is a log inspection tool. Monospace provides column alignment, consistent character width for timestamp scanning, and contextual consistency when code and non-code share the same view.

```css
body {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}
```

**Scale:**
```
11px — timestamps, metadata labels (--text-log-xs)
12px — standard log row text, table cells (--text-log-sm)
13px — default table cell text (--text-log-base)
14px — body UI text
16px — section titles
20px — page titles
18-32px — metric card values (tabular-nums mandatory)
```

**Minimum: never below 11px** for log data. Below 11px, Geist Mono loses inter-character spacing distinctiveness (l vs I vs 1 become ambiguous).

### 5.4 Spacing System (4px base)

```
2px  — micro gaps (0.5 units)
6px  — log row vertical padding (1.5 units) → target: 30px row height → 30 rows visible at once
8px  — standard component gap
12px — card internal padding
16px — section gap
24px — major section separator
32px — page-level padding
```

**Target density:** 30 log events visible simultaneously in a 900px viewport without scrolling.

### 5.5 Layout Dimensions

```css
--sidebar-width:     48px;    /* Collapsed (icon only, always) */
--sidebar-expanded:  220px;   /* Expanded (hover reveal, overlay) */
--panel-width:       460px;   /* Right-side detail panel */
```

Sidebar is `position: fixed`. Main content has `padding-left: 48px` (fixed, doesn't adjust for expanded sidebar since expanded overlays). Panel slides from right edge when an entity is selected.

### 5.6 The Tri-Zone Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ ZONE A (top bar): Time range | Search | Live indicator              40px│
├──────┬─────────────────────────────────────┬───────────────────────────┤
│      │  ZONE B (histogram zone)            │                           │
│      │  Log density chart + brush-select   │  ZONE C (inspector)       │
│  N   ├─────────────────────────────────────┤                           │
│  A   │  ZONE B (filter bar)                │  Opens on entity select.  │
│  V   │  Facet pills | Query input          │  Contains:                │
│      ├─────────────────────────────────────┤  - Trace waterfall        │
│  48px│  ZONE B (virtualized stream/table)  │  - JSON inspector         │
│      │  ↑↓ keyboard navigation             │  - Breadcrumb trail       │
│      │  Click row → opens ZONE C           │  - Related entity links   │
│      │                                     │                           │
│      │  [load more cursor page...]         │                           │
└──────┴─────────────────────────────────────┴───────────────────────────┘
        Fixed 48px sidebar (220px hover)     460px panel (toggleable)
```

### 5.7 Animation Strategy

| Trigger | Duration | Property | Justification |
|---|---|---|---|
| Row expand | 120ms ease-out | max-height | Reveals content |
| Panel slide-in | 180ms ease-out | transform: translateX | Spatial model |
| Filter apply | 80ms linear | opacity | Confirms change |
| New live log row | 200ms ease-out | transform: translateY | Distinguishes new/existing |
| Live indicator pulse | 2.5s ease-in-out infinite | box-shadow opacity | Confirms live mode |
| Hover state | instant | background-color | Feels responsive |

**Forbidden:** Page fade transitions, staggered list entrances, animated backgrounds, transitions >400ms, animations on every keystroke.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
  .live-indicator { animation: none; }
}
```

### 5.8 Interaction Model — Four Depth Levels

```
Level 0 — Passive (no interaction): surface-1 bg, text-secondary labels
Level 1 — Hover: surface-3 bg, 2px solid border-bright on left
Level 2 — Expanded (row clicked): surface-4 bg, 2px solid [event-color] on left, content slides down
Level 3 — Focused entity (correlation ID clicked): right panel opens, table dims to 60% opacity
```

### 5.9 Sidebar Navigation Structure

```
[CF] logo mark

── SYSTEM ──
  Activity icon    → /             (System Pulse)

── OPERATIONS ──
  Zap icon         → /functions    (Invocations)
  MessageSquare    → /conversations
  Users icon       → /customers

── AI ──
  Cpu icon         → /ai           (AI Costs & Tokens)
  Database icon    → /memory       (Memory Health)

── RELIABILITY ──
  ShieldAlert icon → /security
  Phone icon       → /twilio
  Layers icon      → /integrations
```

Active state: `border-left: 2px solid var(--accent-matrix)`, color matrix green
Inactive hover: `background: var(--surface-2)`, color text-primary
Default: `border-left: 2px solid transparent`, color text-secondary

---

## 6. Performance Proof

### 6.1 Why 1M+ Rows Cannot Slow This System

Each architectural layer converts an O(N) problem into O(constant):

| Layer | Without this | With this | Cost |
|---|---|---|---|
| Database | Full scan 1M rows | `WHERE (created_at, id) < cursor LIMIT 50` | O(log N) |
| Network | Transfer 1M rows | 50 rows × ~2KB = 100KB max per request | O(1) |
| JavaScript | Array of 1M items | TanStack Query cache: 50 × pages_loaded | O(pages) |
| DOM | 1M DOM nodes | TanStack Virtual: ~38 nodes always | O(1) |
| React | Reconcile 1M nodes | Reconcile ~38 virtual nodes per frame | O(1) |

**The DOM invariant:** 38 DOM nodes regardless of dataset size. This is not a target — it is enforced by the virtualization contract.

### 6.2 What Breaks First (in order)

1. **COUNT(*) queries on 1M+ rows** → Replace with `pg_stat_user_tables.n_live_tup` (approximate) or materialized views with 5-minute refresh
2. **Supabase Analytics API rate limits** → Increase polling interval, add exponential backoff, cache last successful response
3. **TanStack Query cache memory** (after 60 minutes) → `gcTime: 5 * 60 * 1000` evicts stale cache. `staleTime: 30 * 1000` triggers background refresh on access
4. **ECharts canvas context accumulation** → Strict `chart.dispose()` in useEffect cleanup
5. **TanStack Virtual measurement cache** → At 100K rows × 8 bytes = 800KB RAM (acceptable)

### 6.3 Performance Budget (Hard Limits)

| Metric | Target | Hard Limit | Enforcement |
|---|---|---|---|
| FCP | <500ms | 1s | Lighthouse CI |
| LCP | <1.2s | 2s | Lighthouse CI |
| TTI | <800ms | 1.5s | Lighthouse CI |
| CLS | <0.05 | 0.1 | Lighthouse CI |
| Initial JS bundle | <150KB gzip | 250KB | Bundle analyzer |
| Full client JS | <500KB gzip | 800KB | Bundle analyzer |
| DOM nodes (at any time) | <2,000 | — | Automated test |
| Memory (idle) | <40MB | 100MB | Chrome DevTools |
| Memory (50K rows loaded) | <120MB | 200MB | Chrome DevTools |
| Main thread frame | <16ms | 33ms | React Profiler |
| Supabase queries per page | ≤5 parallel | — | Query log |

### 6.4 Memory Usage Patterns

| Scenario | Heap | DOM Nodes |
|---|---|---|
| Overview page idle | 35-45MB | ~200 |
| Invocations table, 50 rows (1 page) | 50-60MB | ~600 |
| Invocations table, 500 rows (10 pages) | 60-75MB | ~600 (constant) |
| LiveLogs, 300 events streaming | 65-80MB | ~650 |
| Trace page, 30 spans | 55-70MB | ~400 |
| JsonInspector, 200-node JSON | 50-65MB | ~80 (virtual) |
| After 60 min (cache warm) | 100-140MB | ~600 |

---

## 7. Industry Pattern Analysis

### 7.1 Log Exploration — Key Patterns

**The Histogram Anchor:** Every mature log system places a time-density histogram at the top. Brush-selecting the histogram narrows the time range. This is not a chart — it is a **navigation control**. One gesture converts spatial position into temporal filter.

**The Faceted Sidebar:** Automatically extracts distinct values of every field (status, function_name, event_type) as clickable filters. Clicking a value adds AND filter. Impossible combinations disappear. Makes unexpected values discoverable.

**Query Language Duality:** Visual filters (pills, dropdowns) AND query language (text input with auto-complete) simultaneously, synchronized. Typing `status:error` updates the visual pill. Clicking the pill updates the text. Both modes serve different cognitive styles.

**Streaming Log Delivery:** First 20 rows appear within 200ms. Rest arrives in chunks. The investigation begins at 200ms, not when the full query completes.

**Context Lines:** When viewing an event, show N events before and after in the same execution context. Reveals causality sequence (what happened just before the error).

### 7.2 Distributed Traces — Key Patterns

**The Waterfall Model:** X-axis = absolute time. Each row = one span. Bar width = duration. Horizontal position = when span started. Indentation = parent-child hierarchy. Answers "which operation took the most time?" instantly — widest bar is the answer.

**Critical Path:** The sequential chain responsible for total latency, highlighted distinctly. "If I could make one operation faster, which would reduce total duration the most?"

**Span Detail Panel:** Non-modal right panel. Waterfall remains fully interactive behind it. Click different spans to update panel without closing it. **Split-pane inspection model.**

**Trace Search by Attribute:** "Find all traces where `retrieval_score < 0.7`" — converts trace view from lookup tool into discovery tool.

### 7.3 Error Monitoring — Key Patterns

**Error Fingerprinting:** Hash of (error_type + message_template + context) groups similar errors. Shows occurrence count, trend, affected scope — not 847 identical log lines.

**Breadcrumb Trail:** Not a stack trace. The **operational sequence** before the error: "customer sent message → memory tier 2 search → Voyage AI timeout → fallback triggered → Claude responded without semantic context."

**Affected Scope:** How many unique conversations/customers encountered this error. Is the affected scope growing?

### 7.4 Performance Techniques

**Predicate Pushdown:** Never fetch data you will not show. Every filter maps to a SQL WHERE clause. JavaScript-level filtering after fetch is forbidden.

**Composite Cursor Stability:** `(created_at, id)` cursor is stable under high-insert-rate. Page boundaries don't shift as new rows arrive.

**Canvas vs SVG Decision:**
- SVG: data points <1000, individual element click/hover needed, accessibility required
- Canvas: data points 1,000-100,000, zone-based hover acceptable, real-time updates
- WebGL: >100,000 points, 3D, geographic data

**Progressive Disclosure as DOM budget strategy:** Collapsed content = no DOM nodes. Expanded = mount. Collapsed again = unmount (not `display:none`). DOM complexity proportional to user intent.

### 7.5 Cognitive UX Patterns

**Left Navigation:** Icon-only collapsed (48px), hover expands to icon+label (220px, overlays content). Active state: 2-3px left border accent, not filled chip.

**Time Range:** Always visible top-right. Relative presets first (1h, 24h, 7d). Keyboard accessible. Persists across navigation. Shows human-readable label with absolute ISO on hover.

**Command Palette (Ctrl+K):** Modal, keyboard-first. Jump to entity by ID, page by name, recent entity. Results grouped by category. Appears within 50ms.

**Timeline-First vs Entity-First:** Both entry points lead to the same trace data. Current ConversaFlow is entity-first only. Timeline-first (log stream → entity) must be added.

**Drill-by-Click:** Every structured identifier is a navigation anchor. Click `customer_id` → customer detail. Click `request_id` → trace view. Click `status: error` → filter to that status. Click timestamp → set time range around it.

**Correlation Overlay:** Clicking a correlation ID highlights all rows sharing it (full opacity) while dimming non-matching rows (40% opacity). Not filter-based. Shows the correlation chain in context.

---

## 8. Ideal Structural Model for ConversaFlow

### 8.1 The ConversaFlow Trace Tree

```
Root span: handle_whatsapp_message
│  duration: total request duration
│  status: success | error | timeout
│  attributes: request_id, conversation_id, customer_id, twilio_message_sid
│
├── span: security_validation
│     Twilio signature verification: passed | failed
│
├── span: memory_tier1_read
│     Rolling summary retrieval: hit | miss
│     attributes: summary_length, turn_count
│
├── span: memory_tier2_search       [may run async / parallel]
│     Voyage AI embedding + pgvector search: hit | miss | degraded
│     attributes: embedding_ms, search_ms, top_k_score, result_count
│
├── span: memory_tier3_read         [may run async / parallel]
│     customer_preferences fetch: hit | miss | empty
│     attributes: facts_fields_count
│
├── span: claude_api_call
│     Anthropic API round trip: success | error | timeout
│     attributes: model, input_tokens, output_tokens, cache_read, cache_creation,
│                 cost_usd, stop_reason, latency_to_first_token
│     │
│     ├── span: tool_call_N
│     │     tool_name, input, output, success
│
├── span: memory_tier1_write        [async, non-blocking]
├── span: memory_tier2_embed        [async, non-blocking]
├── span: memory_tier3_extract      [async, non-blocking]
│
└── span: twilio_send
      Twilio API: success | queued | failed
      attributes: message_sid, error_code
```

### 8.2 The Correlation Web

```
invocation (edge_function_logs)  ←─── request_id ───→  ai_turn_log
         ↓ conversation_id                                    ↓ conversation_id
      conversation               ←─── customer_id ───→  customer
         ↓ conversation_id                                    ↓ customer_id
        messages                                      customer_preferences
         ↓ request_id
      security_logs
```

From any entity, navigation to every other entity that shares a correlation ID must be possible in ≤1 click.

### 8.3 The Five ConversaFlow-Specific Asymmetries

These are places where generic observability patterns are insufficient:

1. **The AI response text IS the primary artifact** — not metadata. Must be shown as a first-class span attribute, readable in full.

2. **Memory state is causally significant** — the rolling summary, retrieved semantic memories, and extracted customer facts injected into Claude's prompt are directly responsible for Claude's response. The trace must show exactly what each memory tier contributed.

3. **Costs are per-request** — individual messages can be inspected for token cost. This is not just aggregate accounting.

4. **Tool calls are AI decisions** — unusual tool sequences, repeated calls, and tool failures are signals of AI reasoning quality, not just performance data.

5. **3-tier memory health is a unique dimension** — embedding coverage percentage, tier activation status, and retrieval score distribution are health signals with no generic equivalent.

### 8.4 The Ten Governing Principles

1. **Time is primary.** Every view is anchored to a time range. The time range selector is always visible. All data is filtered by time first.

2. **Correlation is navigation.** Every structured identifier is a hyperlink. Moving through an investigation is following correlation IDs, not browsing menu pages.

3. **The stream precedes the entity.** The default entry into data is a filterable, scrollable stream — not a grid of entities navigated by guessing their location.

4. **The inspector does not displace.** Opening a detail view opens a panel that co-exists with the stream. Context is never lost.

5. **Depth is earned, not imposed.** Minimal information by default. Additional depth unlocked by explicit interaction.

6. **Filters are immediate.** Every filter change produces visible response within 100ms. Never block the UI on a server response.

7. **Nothing is a dead end.** Every metric, badge, and table row links to a more detailed view.

8. **Volume is irrelevant.** The interface behaves identically at 100 events or 100 million. Virtualization ensures DOM cost is bounded. Cursor pagination ensures network cost is bounded.

9. **Errors are structurally distinct.** Error states occupy different visual zones (left border, background tint, status indicator). Discoverable via dedicated filter.

10. **The AI response is the primary artifact.** Claude's reasoning, response text, tool decisions, and memory consumption are the system's output — not metadata about it.

---

## 9. Migration Plan — 6 Stages

### Stage 1 — Safe Optimizations (No Structural Changes)

> Low risk, high value, deployable immediately.

1. **Fix JavaScript-level filtering** in `app/functions/page.tsx` — push `fnFilter` and `statusFilter` into Supabase query WHERE clauses. This fixes silent data truncation beyond the 200-row limit.

2. **Fix `select('*')`** → explicit column lists in every query. Reduces payload and deserialization time.

3. **Rewrite `lib/logsApi.ts`** — replace emoji prefix detection with structured JSON parsing. Fall back to emoji heuristic for legacy unstructured entries. Extend `ParsedLogEvent` with: `requestId`, `correlationId`, `tokenCounts`, `latencyMs`, `retrievalScore`, `failureCategory`, `customerId`, `conversationId`, `parserMode`.

4. **Add `useMemo`** to `visible` computation in `LiveLogs.tsx`.

5. **Add page-level error boundaries** (`error.tsx`) and loading skeletons (`loading.tsx`).

### Stage 2 — Design System + Visual Foundation

> New visual identity. No functional regressions.

6. **Replace `app/globals.css`** with Matrix design system tokens.
7. **Update `app/layout.tsx`** — add `className="dark"`, update structure for fixed sidebar.
8. **Rewrite `components/Sidebar.tsx`** — CSS hover expansion, Lucide icons, Matrix active indicator.
9. **Rewrite `components/MetricCard.tsx`** — terminal readout, variant prop, tabular numbers.
10. **Update `components/StatusBadge.tsx`** — verify variant mappings with new color system.
11. **Rewrite `app/page.tsx`** — system pulse with 7-day activity chart, alert banners.
12. **Enhance `app/functions/LiveLogs.tsx`** — surface structured fields (request_id badge, latency, token counts, retrieval score).

### Stage 3 — Structural Refactor + Client Data Layer

> Introduce TanStack Query, Zustand, cursor pagination.

13. Add `store/` (Zustand): `useTableStore`, `useFilterStore`, `useTraceStore`, `useCommandStore`
14. Add `app/api/` Route Handlers for all entities (client → server bridge)
15. Install TanStack Query — wrap app in `QueryClientProvider`, configure `staleTime` and `gcTime`
16. Replace page-level ISR with dynamic + TanStack Query polling
17. Implement cursor pagination on `edge_function_logs`, `security_logs`, `messages`
18. Add `Breadcrumb.tsx` for Layer 2/3 navigation
19. Extract `lib/queries/` — typed Supabase query builders per entity
20. Extract `lib/parsers/` — `logParser.ts`, `traceAssembler.ts`, `tokenAccounting.ts`

### Stage 4 — Virtualization + Trace Reconstruction

> Handle large volumes, enable forensic drill-down.

21. Install TanStack Table v8 + TanStack Virtual v3
22. Build `components/data/VirtualTable/` — replaces all static `<Table>` instances in high-volume views
23. Build `components/data/JsonInspector/` — virtualized collapsible JSON tree
24. Build `components/trace/TraceTimeline.tsx` — SVG waterfall with span detail panel
25. Build `app/trace/[requestId]/page.tsx` — the forensic trace reconstruction page
26. Add `CorrelationBadge.tsx` — clickable `request_id` badge linking to trace view
27. Add `TokenAccounting.tsx` — input/output/cache token breakdown
28. Add streaming `<Suspense>` boundaries on detail pages
29. Build `app/invocations/[id]/page.tsx` — single invocation detail
30. Install react-virtuoso for conversation message thread

### Stage 5 — Full Matrix Visual System + Charts

> Apply complete visual redesign to all remaining pages. Replace Recharts.

31. Install ECharts (tree-shaken), Observable Plot
32. Replace Recharts charts with ECharts equivalents + add DataZoom
33. Build `LogDensityChart` — events/minute histogram with brush-select
34. Build `LatencyHistogram` (Observable Plot) — p50/p95/p99 distribution
35. Build `SimilarityScatter` (Observable Plot) — Voyage AI score scatter
36. Redesign `/conversations/[id]` — MessageThread (react-virtuoso) + MemoryInspector + TracePanel
37. Redesign `/customers/[id]` — FactsInspector using JsonInspector
38. Redesign `/security` + add `/security/[id]`
39. Build `CommandPalette.tsx` (Ctrl+K) using Fuse.js
40. Apply Matrix design system to all remaining pages

### Stage 6 — Advanced Forensic Tooling

> Production-grade observability capabilities.

41. Supabase Realtime subscription for live `edge_function_logs` (replaces ISR polling)
42. Trace comparison — show two traces side-by-side, highlight span duration differences
43. Error fingerprinting — group security/function errors by fingerprint, show occurrence trends
44. Token budget forecasting — linear regression overlay on daily cost chart
45. Retrieval quality dashboard — Voyage AI score trends, degradation alerts
46. Anomaly highlighting — flag invocations >3σ latency without manual filtering
47. Export + share — copy trace URL, export trace as JSON for postmortems

---

## 10. Immediate Implementation Sequence

> These are the files to modify **right now**, in this exact order.

### File 1: `app/globals.css`

Complete replacement. Foundation for everything else.

- Remove light mode from `:root` (keep as thin fallback)
- `.dark` block: Matrix token system (all values listed in §5.2)
- Map all new tokens in `@theme inline {}` for Tailwind utility access
- Apply `font-family: var(--font-mono)` globally to `body`
- Apply `font-variant-numeric: tabular-nums` to `body`
- Scanline texture via `body { background-image: repeating-linear-gradient(...) }`
- 4px custom scrollbar (green on hover)
- `::selection` → matrix green
- Keyframes: `pulse-live`, `matrix-appear`, `glow-pulse`
- CSS utility classes: `.sidebar-nav:hover .sidebar-label { opacity: 1 }`
- `prefers-reduced-motion` override block
- Change `--radius: 0.25rem` (sharper terminal corners)

### File 2: `app/layout.tsx`

- Add `className="dark"` to `<html>` element
- Add `suppressHydrationWarning` to `<html>`
- Change `<main>` to `pl-[48px]` (fixed sidebar width)
- Remove `flex min-h-screen` wrapper (sidebar goes `position: fixed`)

### File 3: `components/Sidebar.tsx`

Complete rewrite with:
- `'use client'` + `usePathname` for active state detection
- `position: fixed` via CSS class `.sidebar-nav`
- Width: 48px → 220px on hover (CSS-only, `.sidebar-nav:hover`)
- Lucide icons: `Activity`, `Zap`, `MessageSquare`, `Users`, `Cpu`, `Database`, `ShieldAlert`, `Phone`, `Layers`
- Nav groups: SYSTEM / OPERATIONS / AI / RELIABILITY
- Active state: matrix green left border + text color
- Label opacity: 0 default → 1 on `.sidebar-nav:hover` via globals.css
- Section labels hidden until expanded

### File 4: `components/MetricCard.tsx`

Complete rewrite with:
- New `variant?: 'default' | 'positive' | 'warning' | 'error'` prop
- New `href?: string` prop (card becomes link)
- New `icon?: string | React.ReactNode` (keep string for backward compat)
- Terminal readout aesthetic: 10px uppercase title, 28px tabular value, 11px sub
- Left border colored by variant
- Background: `var(--surface-1)` (vs current `--card`)

### File 5: `lib/logsApi.ts`

**Critical rewrite** — the highest-leverage change in the codebase.

```typescript
// New parsing strategy:
function parseEventMessage(event: FunctionLogEvent): ParsedLogEvent {
  // 1. Try structured JSON first
  try {
    const structured = JSON.parse(event.event_message)
    return {
      ...event,
      kind: structured.event_kind ?? deriveKindFromStructured(structured),
      shortMessage: buildStructuredShortMessage(structured),
      isError: structured.status === 'error' || !!structured.error,
      requestId: structured.request_id ?? null,
      correlationId: structured.correlation_id ?? null,
      tokenCounts: structured.tokens ?? null,
      latencyMs: structured.latency_ms ?? null,
      retrievalScore: structured.retrieval_score ?? null,
      failureCategory: structured.failure_category ?? null,
      customerId: structured.customer_id ?? null,
      conversationId: structured.conversation_id ?? null,
      parserMode: 'structured',
    }
  } catch {
    // 2. Fall back to emoji heuristic (legacy unstructured logs)
    const kind = detectKindFromEmoji(event) // existing logic
    return {
      ...event,
      kind,
      shortMessage: buildEmojiShortMessage(event, kind), // existing logic
      isError: event.level === 'error' || ...,
      requestId: null, correlationId: null, tokenCounts: null,
      latencyMs: null, retrievalScore: null, failureCategory: null,
      customerId: null, conversationId: null,
      parserMode: 'heuristic',
    }
  }
}
```

New `ParsedLogEvent` interface adds: `requestId`, `correlationId`, `tokenCounts`, `latencyMs`, `retrievalScore`, `failureCategory`, `customerId`, `conversationId`, `parserMode`.

### File 6: `app/page.tsx`

Redesigned system pulse:
- Add weekly invocations query to `Promise.all`
- 6 metric cards with `variant` and `href` props
- 7-day CSS activity bar chart (inline, no dependencies)
- Live indicator (pulsing green dot)
- Page header with timestamp
- Alert banners using Matrix tokens

### File 7: `app/functions/page.tsx`

Fix filtering bug:
- Push `fnFilter` and `statusFilter` into Supabase WHERE clauses
- Replace `.select('*')` with explicit column list: `id, function_name, status, duration_ms, error_message, created_at, request_id`
- Apply Matrix styling to page chrome

### File 8: `app/functions/LiveLogs.tsx`

Enhance with structured fields:
- Add `useMemo` for `visible` computation
- Show `requestId` as monospace badge (if `parserMode === 'structured'`)
- Show `latencyMs` right-aligned in row
- Show token counts for Claude events
- Show retrieval score for memory events
- Show failure category for error events
- Show dim `⚠ heuristic` indicator for legacy log entries
- Expanded panel: structured fields first, raw message collapsible below

### Files 9-12: Error Boundaries + Loading Skeletons

Create:
- `app/error.tsx`
- `app/loading.tsx`
- `app/functions/error.tsx`
- `app/conversations/error.tsx`
- `app/security/error.tsx`

---

## Appendix A — Folder Structure (Target)

```
apps/umi-logs/
├── app/
│   ├── api/invocations/route.ts
│   ├── api/conversations/route.ts
│   ├── api/trace/[requestId]/route.ts
│   ├── api/metrics/route.ts
│   ├── api/logs/route.ts
│   ├── trace/[requestId]/page.tsx        ← NEW
│   ├── invocations/[id]/page.tsx         ← NEW
│   ├── security/[id]/page.tsx            ← NEW
│   ├── (existing pages — progressively updated)
│   ├── error.tsx                         ← NEW
│   ├── loading.tsx                       ← NEW
│   └── globals.css                       ← REWRITE
├── components/
│   ├── layout/Sidebar.tsx                ← REWRITE
│   ├── layout/Breadcrumb.tsx             ← NEW
│   ├── layout/CommandPalette.tsx         ← NEW (Stage 5)
│   ├── data/VirtualTable/               ← NEW (Stage 4)
│   ├── data/JsonInspector/              ← NEW (Stage 4)
│   ├── data/MessageThread/              ← NEW (Stage 4)
│   ├── trace/TraceTimeline.tsx           ← NEW (Stage 4)
│   ├── charts/LogDensityChart.tsx        ← NEW (Stage 5)
│   ├── charts/LatencyHistogram.tsx       ← NEW (Stage 5)
│   ├── forensic/CorrelationBadge.tsx     ← NEW (Stage 4)
│   ├── forensic/TokenAccounting.tsx      ← NEW (Stage 4)
│   ├── MetricCard.tsx                    ← REWRITE (now)
│   └── StatusBadge.tsx                   ← UPDATE
├── lib/
│   ├── queries/invocations.ts            ← NEW (Stage 3)
│   ├── queries/conversations.ts          ← NEW
│   ├── queries/trace.ts                  ← NEW
│   ├── parsers/logParser.ts              ← NEW (Stage 1/2)
│   ├── parsers/traceAssembler.ts         ← NEW (Stage 4)
│   ├── parsers/tokenAccounting.ts        ← NEW (Stage 4)
│   ├── logsApi.ts                        ← REWRITE (now)
│   ├── supabase.ts                       ← unchanged
│   ├── anthropicApi.ts                   ← unchanged
│   └── twilioApi.ts                      ← unchanged
├── store/
│   ├── useTableStore.ts                  ← NEW (Stage 3)
│   ├── useFilterStore.ts                 ← NEW
│   ├── useTraceStore.ts                  ← NEW
│   └── useCommandStore.ts               ← NEW (Stage 5)
└── types/
    ├── domain.ts                          ← NEW
    ├── api.ts                             ← NEW
    └── trace.ts                           ← NEW
```

---

## Appendix B — Design Invariants (Must Always Hold)

1. `select('*')` never appears in any query
2. `body { font-family: var(--font-mono) }` — entire console is monospace
3. No hardcoded color values outside CSS custom properties
4. No JavaScript-level filtering of server-fetched data
5. Every list with potential for >100 rows uses TanStack Virtual
6. Every new interactive element has a keyboard-accessible path
7. `prefers-reduced-motion` overrides all animations
8. Sidebar width never affects main content layout (fixed position, overlay)
9. Every metric card with a specific entity type has an `href` to filter that type
10. Every `event_message` that is valid JSON is parsed as structured (emoji fallback only for legacy)

---

*Last updated: 2026-02-25. Derived from Phases 1-6 architectural analysis + industry pattern audit.*
