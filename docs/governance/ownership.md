# Ownership Model

Umi uses explicit ownership. The root coordinates context; apps own runtime behavior.

## Root owns

- Workspace governance.
- Cross-product architecture and migration planning.
- Retrieval policy and workspace maps.
- Report, eval, trace, and memory indexes.
- Agent operating-system structure.

## API owns

- Canonical business writes and backend behavior.
- Authentication, authorization, jobs, queues, outbox, and durable side effects.
- Conversations, leads, customer value, passes, sales, inventory, and kitchen projections.
- Runtime prompts, tool orchestration, telemetry, and trace writes.
- Access to the `umi`, `merchant`, and `runtime` schemas.

## Contract owns

- Shared API types for TypeScript and Dart consumers.
- Generated artifacts for the API, Dashboard, and UmiPOS.

## UmiPOS owns

- The Flutter POS client.
- Operator journeys, device workflows, hardware access, and offline replay.
- Consumption of API contracts. It does not own business truth.

## KDS owns

- Native iPad KDS client.
- KDS board presentation, client state, interactions, and app UX.
- Consumption of API-owned projections and command contracts.

## Cash owns

- The Cash compatibility site and Next.js runtime.
- Cash-specific Prisma compatibility behavior.
- Frozen wallet-pass URL forwarding and scheduled compatibility jobs.

## Dashboard owns

- Umi owner dashboard app shell and live-data UI.
- Screen inventory, visible functions, and interaction flows that should carry forward into future production hardening.

## Landing page owns

- Public marketing pages.
- Lead capture and local delivery compatibility behavior.

## Boundary rule

Place changes where the current write model, runtime, or consumer lives.
Add a boundary only when measured constraints show that the current owner fails.
