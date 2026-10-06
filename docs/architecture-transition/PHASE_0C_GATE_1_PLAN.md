# Phase 0C — Gate 1 Plan

The machine-readable plan is
[`phase-0c-gate-1-plan.json`](./phase-0c-gate-1-plan.json).

## Batch order

| Batch | Objective                                                                  | Entry result                        |
| ----- | -------------------------------------------------------------------------- | ----------------------------------- |
| G1A   | Establish authority, migration ownership, RLS, and client boundaries.      | One data and API authority          |
| G1B   | Complete identity, sessions, branch access, permissions, and entitlements. | Stable actor context                |
| G1C   | Complete the contract emitter and compatibility policy.                    | Safe client seam                    |
| G1D   | Complete data controls, audit, and command substrate.                      | Safe future writers                 |
| G1E   | Complete redaction, abuse controls, health, and operations baseline.       | Bounded public surface              |
| G1F   | Certify P0 entry criteria.                                                 | Permission to create `apps/umi-pos` |

## Rules

- Keep each batch bounded.
- Use focused validation.
- Use forward-only migrations.
- Keep NEXO read-only.
- Do not create `apps/umi-pos` in Gate 1.
- Do not implement checkout, payments, inventory, or physical cash before the entry certificate.
- Use one commit for one coherent authority change.

## Gate 1 exit

Gate 1 ends when all P0 gaps are closed and G1F records objective evidence. P1 work then prepares
the first authenticated screen and the first sale slice.
