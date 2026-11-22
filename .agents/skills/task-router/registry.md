# Registry

Current at 2026-11-22. The live selection rules are below. Historical entries stay in
`routing-ledger.md`. Do not route work to a retired tracker.

## Skills

- `task-router`
  - scope: route work to the correct Umi owner slice, then to direct execution, an existing project skill, or a subagent.
  - trigger patterns: multi-repo tasks, root-level docs, cross-product planning, ownership uncertainty.
  - placement hints: start in root `.agents/skills/task-router/` (canonical source; `.claude/skills/` is a symlink into it), then descend into the owning repo if the task becomes local.
  - confidence: high
  - provenance: root workspace scaffold for Umi.
- `production-support`
  - scope: diagnose live Umi production incidents for any merchant with verified evidence, audit Android/iMin POS fleets via `fleet_doctor.py`, and ship safe hotfixes without corrupting financial records.
  - trigger patterns: live merchant outage, POS fleet Tailscale/ADB check, payment/KDS/offline incident triage.
  - placement hints: use out-of-repo fleet configs (`~/.config/umi/fleets/<merchant>.json`); pair with `ingest-ticket` when reports arrive from WhatsApp.
  - confidence: high
  - provenance: generalized 2026-11-21 from merchant-specific support runbooks.
- `ingest-ticket`
  - scope: convert client WhatsApp/Twilio reports (photos, voice notes, screen videos) into a compact ticket folder with normalized local/UTC timestamps, `ffmpeg` key frames, audio extraction, and mandatory cleanup.
  - trigger patterns: WhatsApp bug report, Twilio webhook payload, client screen video or voice note triage.
  - placement hints: run `scripts/ingest_ticket.py` first before spending LLM tokens on raw media; clean up temporary media on close.
  - confidence: high
  - provenance: built 2026-11-21 from real client support workflow.
- `onboard-cash-merchant`
  - scope: onboard a new Umi Cash merchant from an Instagram URL/handle or local logo via `fetch_instagram_profile.sh`, image upscaling, `POST /api/merchants`, branding logo upload, and secure cleanup.
  - trigger patterns: new Cash customer onboarding, Instagram profile/logo extraction, merchant provisioning.
  - placement hints: always preview upscaled logo and `draft.json` for human approval before `--apply`; run `cleanup` to wipe initial credentials.
  - confidence: high
  - provenance: built 2026-11-21 from real Umi Cash onboarding workflow.
- `pr-gates`
  - scope: Umi's PR lifecycle discipline (`dev` -> `staging` -> `main`, `pnpm check:pr`, CI validation, post-merge checks).
  - trigger patterns: opening, validating, or promoting a PR across Umi branches.
  - placement hints: delegates to `tdd`, `code-review`, and `diagnosing-bugs` at each gate.
  - confidence: high
  - provenance: canonical Umi PR gate runbook.
- `tdd`
  - scope: seam-based red-green testing discipline for bug fixes and new behavior.
  - trigger patterns: implementing fixes, writing regression tests before patching.
  - placement hints: invoked before implementation in `pr-gates`.
  - confidence: high
  - provenance: curated engineering skill.
- `code-review`
  - scope: two-axis code review (Standards + Spec) of a diff against a fixed base using parallel subagents.
  - trigger patterns: explicit review requests; pre-merge quality, security, or bug-hunt passes on changed code.
  - placement hints: run from the repo whose diff is under review.
  - confidence: high
  - provenance: curated engineering skill.
- `diagnosing-bugs`
  - scope: tight feedback-loop debugging, reproduction, and fault minimization protocol.
  - trigger patterns: hard bugs, flaky behavior, production regressions.
  - placement hints: build a minimal failing reproduction before editing code.
  - confidence: high
  - provenance: curated engineering skill.
- `playwright-cli`
  - scope: real-Chromium verification reference for `@playwright/cli` on `umi-dashboard`, `umi-cash`, and `umi-landing-page`.
  - trigger patterns: visual/browser verification, real-click QA in staging or local dev.
  - placement hints: pair with `./scripts/ux-browser.sh`.
  - confidence: high
  - provenance: backs Umi's real-browser verification playbook.
- `research`
  - scope: primary-source technical research and tool-selection protocol (`docs/agents/tool-and-research-doctrine.md`) labeling facts, tradeoffs, and Umi inferences.
  - trigger patterns: structural, security, benchmark-sensitive, or architecture decisions.
  - placement hints: start with official docs and primary sources before committing to a design.
  - confidence: high
  - provenance: Umi research standard.

## Selection rules

- Workspace-level rules and planning: root `AGENTS.md`, root `docs/`, and the named run record.
- Current requirements and pending work: the user's current instruction, the active task brief, and the run record. Do not route to Azure Boards, Trello, Plane, or a CodeGraph work-item triage.
- Source-sensitive technical decisions: `research` before locking the recommendation.
- Live merchant incidents and POS fleet checks: `production-support` (pair with `ingest-ticket` for WhatsApp/Twilio media reports).
- New Umi Cash merchant onboarding: `onboard-cash-merchant`.
- PR preparation, verification, and branch promotion (`dev` -> `staging` -> `main`): `pr-gates`.
- Product app changes: descend into the owning app directory.
- Shared backend, normalization, projections, jobs, contracts, and backend orchestration: `apps/umi-api`. It is the canonical backend.
- Owner dashboard app shell and live-data UI: `apps/umi-dashboard`.
- POS operator flows, offline replay, KDS board, and device-role mode: `apps/umi-pos`.
- Cash compatibility client and its separate Prisma: `apps/umi-cash`. It forwards the frozen wallet-pass URL to `apps/umi-api`.
- Public landing and lead capture: `apps/umi-landing-page`.
- Root artifact first, new repo last.

## Retired selection rules

Keep this section for history. Do not select these rules.

- Work-item triage, backlog validation, and stale-ticket detection: `triage-work-items-with-codegraph` is retired for Umi routing on 2026-11-15. It assumes Azure Boards, which Umi retired on 2026-11-08.
- Shared Supabase contracts, normalization, and backend orchestration in `apps/umi-conversaflow`: historical. That path is not in the current tree. Current owner: `apps/umi-api`.
- ConversaFlow operations and logs UI in `apps/umi-logs`: historical. That path is not in the current tree. Current owner for owner-facing views: `apps/umi-dashboard`.
- Static Umi owner dashboard prototype: historical. The current app is the owner dashboard app shell with live-data UI in `apps/umi-dashboard`.
- Legacy skills pruned on 2026-11-22: 25 obsolete/third-party skills removed (`design`, `setup-matt-pocock-skills`, `ask-matt`, `to-spec`, `to-tickets`, `triage`, `wayfinder`, `grill-with-docs`, `implement`, `improve-codebase-architecture`, `codebase-design`, `domain-modeling`, `prototype`, `resolving-merge-conflicts`, `adapter-sync-check`, `scientific-research-check`, `market-research`, `postgresql-best-practices`, `repository-cartographer`, `staging-validation-runner`, `owner-insights-migration`, `customer-identity-resolution`, `dashboard-customer-ux-validation`, `workspace-boundary-check`, `triage-work-items-with-codegraph`).
