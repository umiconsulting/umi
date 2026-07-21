# Umi Owner Console — Design Research Dossier

_AI-agent frontend UX + pure-design literature → a harmony framework for the login (and the dashboard). Curated from X (via Scrapling) + web research, validated against primary sources._

---

## 0. Thesis (read this first)

**Harmony = one system resolves every visual decision. Beauty = honesty + craft practiced inside that system.**
Two load-bearing ideas, and the AI-frontend research and the pure-design canon point at _both_:

1. **The token layer is the harmony contract** — it is simultaneously the generative-UI "declarative spec" (CopilotKit), a ratified W3C standard (DTCG, stable Oct 2025), and the substrate for color/type/grid (design canon). One artifact, three justifications.
2. **Honesty is the trust layer — and trust reads as beauty.** (NN/G: fake reassurance doesn't build trust. Rams: good design is honest + unobtrusive.)

---

## 1. Curation from X (scraped via Scrapling — profiles, not the paid API)

X full-archive search needs App-Only auth + paid credits (402); profile pages return real post text unauthenticated. Curated voices:

**AI-frontend / generative UI**

- **@rauchg** (Vercel) — _"Eve.dev is Next.js for agents"_ → the **agent-as-frontend** paradigm (`agent/instructions.md` as the new `pages/index.js`).
- **@CopilotKit** — creators of **AG-UI (Agent-User Interaction protocol)**; "The Frontend Stack for Agents & Generative UI."
- **@nutlope** (Together) — ships **beautiful AI web apps** (roomgpt, llamacoder); "building beautiful web apps."
- **@shadcn** — design systems; _"treat intelligence as borrowed — drain it when available"_ (skills like `/improve`).

**Interaction & visual craft**

- **@raunofreiberg** (Vercel, staff design engineer) — **Devouring Details**: a 23-chapter interaction-design manual + 23 React components. The gold standard for micro-interaction craft.
- **@emilkowalski_** — motion / micro-interactions (Sonner, Vaul).
- **@steveschoger** (Refactoring UI) — visual craft; _"think outside the database — your UI doesn't need to map 1:1 to your data's fields."_
- **@erikdkennedy** (Learn UI Design) — "50+ practical UI/UX design tips"; practical visual-design teaching.

**Pure design (iterate pass)**

- **@meodai** — **color as a systematic instrument** ("a synthesiser for colour," music-hardware analogy). Palettes as engineering.
- **@jessicahische** — lettering / typographic craft.
- _(@michaelbierut / @jarrettfuller profiles were gated — X only serves some unauthenticated.)_

---

## 2. Curation from articles (full text scraped) — key extracted principles

**Microsoft Design — "UX design for agents"** (Apr 2025)

- Agents _"should be (mostly) invisible."_ They _"require a huge degree of user trust — which must be earned."_ Traditional UX principles don't fully cover the new paradigm.

**Fuselab — "Agent UX 2026"** (cites NN/G)

- **Four principles: transparency, user control, proactive status communication, structured error recovery.**
- _"NNGroup's research… found users rarely verify the sources AI systems cite, despite claiming those citations increase confidence… surface explanations do not build real trust. The interface must show reasoning at the decision level."_
- _"A confirmation screen showing only the booked flight is not transparency."_

**CopilotKit — Generative UI**

- Two axes: **freedom** and **control** (who decides representation — agent or programmer).
- **Declarative generative UI**: agents return a **structured spec** (e.g. a Card/JSON), not arbitrary code → _"preserves consistency… brand alignment."_

**Agentic-Design — UI/UX patterns**

- Trust & Transparency Systems: decision visualization, source attribution, confidence indicators, **progressive disclosure of reasoning**. Plus Error Recovery, Visual Reasoning Interfaces, cognitive-load management.

**Alan Tippins — "The New Rules of UX (for AI Agents)"**

- 13 heuristics. _"Core principles — clarity, reversibility, trust — still matter." "Transparency builds trust." "Trust depends on recoverability."_ Abstract steps unless the user wants control.

---

## 3. Research validation (primary sources)

_Layered: documented fact · source-backed tradeoff · Umi inference._

**Documented facts**

- **Response-time thresholds 0.1 / 1 / 10s** (Nielsen, from Miller 1968): <0.1s = instantaneous; past ~1s you _must_ give feedback; past 10s attention breaks. → loading/progress states are a perceptual requirement, not decoration.
- **Surface transparency ≠ trust** (NN/G Explainable AI; arXiv 2501.01303 _Citations & Trust in LLM Responses_): citations raise _perceived_ trust but users rarely verify, and explanations are often hallucinated. Show reasoning at the _decision_ level.
- **Design tokens are a W3C standard**: DTCG spec reached **first stable version Oct 2025** — tokens = "single source of truth for colors, typography, spacing," interoperable design↔code, with theming, aliases, Oklch/Display-P3.
- **Gestalt principles** (Wertheimer/Koffka/Köhler, 1910s–20s): proximity, similarity, common region, figure-ground, Prägnanz — established perceptual psychology.

**Tradeoffs**

- Token/declarative spec: consistency + brand safety vs. expressive freedom. For a brand surface like login, constraining freedom to guarantee harmony is the correct trade.
- Optimistic/streaming feedback cuts perceived latency but must stay honest (same trust finding).
- Motion aids continuity (Gestalt common fate) but must honor `prefers-reduced-motion`.

---

## 4. Pure-design literature (the "not web design" layer)

- **Gestalt** → whitespace grouping (proximity), uniform field styling (similarity), the card as _common region_, card-vs-canvas _figure-ground_.
- **Color — Albers (_Interaction of Color_), Itten**: color is **relative to its surround** (simultaneous contrast). Itten harmony = analogous/complementary + contrast of hue vs. value vs. saturation.
- **Munsell** (hue/value/chroma): why a disciplined value-ramp on one hue (the `--ink-1…4` navy ladder) reads as harmonious.
- **Typographic modular scale**: size steps on a ratio (~1.25) → harmonic hierarchy.
- **Swiss grid — Müller-Brockmann (_Grid Systems_)**: a baseline grid + one spacing scale = mathematical rhythm, even in a single card.
- **Dieter Rams**: _"good design is as little design as possible"_ — honest, unobtrusive.

---

## 5. Distillation → engineering feats (buildable, on this plain-CSS React stack)

| Design idea (source)                                             | Engineering feat                                                                | Login relevance                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Transparency at the _decision_ level, not surface (Fuselab/NN/G) | Honest status + recoverable errors; no decorative reassurance                   | **High** — drop "Supabase" copy; real verify/error states |
| Declarative UI = a structured _spec_ (CopilotKit)                | **Design tokens as the contract** (`styles.css :root` = the spec)               | **High** — every pixel resolves to a token                |
| Progressive disclosure (Agentic-Design, Tippins)                 | Layered reveal; abstract steps unless control requested                         | Med — minimal card, contextual "forgot password"          |
| Proactive status + streaming (AG-UI, MS)                         | Optimistic UI, skeletons, eased state transitions (`--ease`)                    | Med — button loading, login↔forgot↔sent transitions       |
| Interaction craft (raunofreiberg, emilkowalski, steveschoger)    | Optical alignment, modular type scale, spring/eased motion, focus-visible, a11y | **High** — where harmony & beauty are won                 |

---

## 6. Synthesis → the five harmony dimensions (applied to login)

| Dimension   | Principle / source                        | Concrete move                                                                                                                     |
| ----------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Color**   | Albers/Itten, Munsell, meodai, DTCG Oklch | Mark + accents on the **navy→blue axis**; kill the terracotta ✕ (simultaneous-contrast error); one warm accent only if deliberate |
| **Type**    | Modular scale, Hische, Rams               | 4 sizes on a **~1.25 ratio** (11/13/15/25); tighten measure; one voice                                                            |
| **Space**   | Gestalt, Müller-Brockmann                 | One **8px scale**; label↔field tight, groups looser; card as common region; consider **split-navy** for figure-ground             |
| **Motion**  | Nielsen 0.1/1/10s, common fate            | Honest **loading** on submit; eased `--ease` transitions; `prefers-reduced-motion` guard                                          |
| **Honesty** | NN/G, Rams, a11y                          | Replace "Supabase" copy; recoverable errors; `autocomplete`/ARIA/focus-visible                                                    |

---

## 7. Applied to the current login (live-render defects → fixes)

1. **Terracotta ✕ mark** reads as _close/error_ + wrong color source (`--tenant-brand`, invalid pre-tenant) → **navy/blue wave mark** (Albers/Itten + Rams).
2. **"Inicia sesión con tu cuenta Supabase del proyecto Umi"** leaks internals → honest copy ("Accede al panel de tu negocio") (Rams + NN/G).
3. **Generic centered card**, no brand character → use the navy the dashboard sidebar already uses (split-navy) or a warmer, better-composed card.
4. **No `autocomplete`, no honest loading state** → a11y + Nielsen thresholds.
5. **Ad-hoc type sizes (22/17/13.5/11)** → modular scale.

Two on-token directions already prototyped + rendered: **Refined card** (navy wave mark, honest copy, security footer) and **Split-navy** (brand panel + form; harmonizes with the dashboard sidebar).

---

## 8. Sources

- Microsoft Design — UX design for agents · Fuselab — Agent UX 2026 · CopilotKit — Generative UI · Agentic-Design — UI/UX patterns · Alan Tippins — New Rules of UX for AI Agents
- NN/G — Explainable AI in Chat Interfaces · Response Time Limits · Gestalt Proximity/Similarity
- W3C DTCG — Design Tokens spec (first stable, Oct 2025)
- arXiv 2501.01303 — Citations and Trust in LLM Generated Responses
- Design canon — Gestalt (Wertheimer/Koffka/Köhler); Albers _Interaction of Color_; Itten; Munsell; Müller-Brockmann _Grid Systems_; Dieter Rams
- X (scraped): @rauchg, @CopilotKit, @nutlope, @shadcn, @raunofreiberg, @emilkowalski_, @steveschoger, @erikdkennedy, @meodai, @jessicahische
