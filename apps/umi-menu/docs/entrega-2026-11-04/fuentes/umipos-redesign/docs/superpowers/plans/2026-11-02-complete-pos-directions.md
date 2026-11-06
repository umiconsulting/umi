# Complete POS Visual Directions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this coherent presentation task with one implementer and an independent review. No native work.

**Goal:** Make proposals2 and3 recognizably different complete POS interfaces across every operational screen, retaining proposal1 and every existing prototype capability.

**Architecture:** Keep the existing Scene, domain models, local owners and callbacks. Recompose shared controls into design-specific layouts without remounting their state owners. Use narrowly scoped CSS and optional presentation props; do not fork business logic.

**Tech Stack:** React18, TypeScript, Vite, installed BoardUI, Stageshow frames, CSS.

**Spec:** The binding task3H brief at `/private/tmp/umi-redesign-parity-20261102/.superpowers/sdd/2026-11-02-redesign-parity/task-3h-complete-visual-directions.md`, including its screen-by-screen composition table.

## Global Constraints

- Preserve proposal1 exactly, all existing product data, callbacks, roles, permissions, flow order, PIN behavior, photos only in1, and current device frames.
- Proposal2 follows Zavo operational composition with UMI branding. Proposal3 reimagines original UMI: navy navigation, persistent umi, categories/frequent strip and right comanda. Neither is a palette swap.
- Keep the existing map geometry and available-table green semantics. KDS exposes only station preparation, never collection.
- Reuse installed BoardUI controls, semantic tokens, composite typography, cx() and ScrollFade. No packages, fake analytics, decorative category icons, stock copy or product photos in2/3.
- Preserve all existing prototype settings/hardware/cash/partial-payment and exception controls. No domain models, backend, native, dashboard or customer-menu edits.
- Touch controls at least44px; visible labels at least12px. Both themes; desktop, phone and portrait/landscape tablet compositions.
- Prototype is not Git. Use the tar baseline; do not initialize Git or commit. Root owns publication to the already authorized existing Pages project.

## Task1: Complete both operational visual systems

**Files:** `src/main.tsx`, `src/Payment.tsx`, `src/ProductOptions.tsx`, `src/Kitchen.tsx`, `src/PosTables.tsx`, `src/Cash.tsx`, `src/CashCount.tsx`, `src/Settings.tsx`, `src/PosReceipt.tsx`; add a scoped operations stylesheet and small presentation components only where extracting existing markup reduces risk. Update `docs/redesign-three-options.md`, `src/REHEARSAL.md` and appropriate QA scripts.

**Interfaces:** optional presentation prop with the exact existing discriminator:

```ts
type Design = '1' | '2' | '3'
// Add design?: Design; default to '1' on an existing component when needed.
// Keep current callbacks, Scene and local hook owners unchanged.
// Never key Workspace, Payment, Cash or Settings by design.
```

- [x] Inspect task references and current complete screens, including the exact current controls. Record the visible sameness before changing it.
- [x] Extract shared JSX groups once inside existing state-owning components, then compose them according to the task table. Preserve original1 markup as the default branch and keep data-targets unique. New layout wrappers must not duplicate mounted form controls.
- [x] Implement account/modifiers/payment/receipt first and send comparative Windows2/3 and phone2/3 captures to root. Continue companion surfaces while root reviews; no extra design approval gate.
- [x] Implement incoming orders, full table map/inspector, KDS, cash/counting and settings with the same two visual systems. Keep pending/error/closed/empty states and confirmations reachable.
- [x] Capture one final matrix; use crops without navigation to judge whether each screen has a meaningful content-layout difference. Fix concrete clipping/identity failures, not another discretionary aesthetic cycle.
- [x] Run existing focused flow/roles/parity/operations checks once for each changed design; run new geometry and state-retention checks only where the new presentation can regress. Do not repeat unaffected dashboard/native tests. Confirm design1 baseline screenshots and typecheck.
- [x] Freeze product source and write task3H report with exact changes, checks, screen coverage, images and limits. Root packages immutable review, builds, publishes, verifies public flows and records completion.

## Preflight interface review

| Producer / consumer | Preservation check |
| --- | --- |
| Workspace / Payment, Cash, Settings | Optional design props change presentation; current state owner, keys and callbacks persist. |
| Workspace / ProductOptions, incoming and receipt | Existing Scene and action targets remain; extract existing markup without creating a second copy of controls. |
| Kitchen cards / station actions | Group the same derived cards only; do not alter stationPatch, readyItems or saved-account projection. |
| PosTables / FloorPlan | Preserve geometry, fit, selection and callbacks; rearrange its surrounding tools/details only. |
| Cash / CashCount | Preserve policy-controlled blind/denomination/total-only behavior and current financial operations. |
| All views / styles / QA | Scope2/3, retain1 baseline, inspect both themes and short landscape heights. Layout distinction and existing interaction must both pass. |

Ruling: this completes the already authorized three-proposal redesign after the user rejected its narrow scope. No new approval question or native work. The task is presentation architecture over existing flows; there is no new business subsystem.

Implementation source frozen after the bounded fit corrections. Existing suites passed for both designs; typecheck and66 focused state/geometry checks passed. Final matrix:336 states, zero horizontal overflow, zero escaped fixed footers and zero browser errors. Root completed the design1 comparison (28/30 exact, two tiny localized KDS residuals), final build, independent review and public validation. All six tours reached paid receipts;53 public and13 shared Pages checks passed.

The subsequent user correction to Pedidos3 is complete: one informative register/expanded comanda,14 focused cases and29 existing flow checks passed, scoped review approved. Root rebuilt, verified the four source hashes, published a2eb13dc and passed21 final public checks. Documentation-only closure follows the reviewed build. Native work remains paused; automatic animation certification remains inconclusive.
