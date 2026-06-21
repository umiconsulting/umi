# Umi KDS Agent Contract

This file is the agent-agnostic operating contract for the `apps/umi-kds` repository.

Read with:

- [CLAUDE.md](./CLAUDE.md)
- [../../AGENTS.md](../../AGENTS.md)

## Repository identity

This repository is a native SwiftUI iPad application.

## Product

- Kitchen Display System for operators, not consumers.
- Optimize for shared iPads used in kitchens, not phones or consumer tablets.
- Backend is the source of truth.
- The app renders normalized kitchen orders and events in real time.
- WhatsApp is the first channel, but the app must stay channel-agnostic.

## Engineering rules

- Prefer the simplest working design.
- Put durable project facts in `AGENTS.md`.
- Put repeatable task procedures in `.agents/skills/`.
- Put open-ended delegation roles in `.claude/agents/`.
- Keep skills small, specific, and composable.
- Prefer adding a file referenced by `SKILL.md` over growing one long skill.
- Avoid agent use when a direct skill or normal implementation is enough.
- Promote new skills from successful repeated traces, not from first-contact requests.
- Keep cross-workspace routing evidence in the root `.agents/skills/task-router/` ledger so promotion remains versioned and auditable.

## Filesystem-first rule

- Treat the on-disk project structure as the primary architectural source of truth.
- Before making changes, inspect the relevant folders and place code in the narrowest existing slice that fits.
- Do not create parallel directory trees or alternate layering unless the task explicitly requires a structural change.
- Prefer extending the current filesystem organization over introducing new abstractions.
- When proposing architecture changes, explain how they align with or intentionally change the existing file structure.

## App bias

- SwiftUI
- iPad-first layouts and interactions
- landscape-first board usage
- large touch targets and distance-readable typography
- glanceable dense information over decorative UI
- avoid phone-first navigation patterns when an iPad shell is clearer
- async/await
- thin client
- realtime first
- offline cache only when justified

## Agent workflow rule

- Treat `.agents/skills/` as the local procedure source for this repo; `.claude/skills/` is a generated mirror for Claude-oriented tooling.
- Keep `CLAUDE.md` aligned with this contract as an adapter.
