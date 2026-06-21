# KDS Repo Context

## Purpose

Native SwiftUI iPad Kitchen Display System client for operators.

## Load first

1. `AGENTS.md`
2. `Sources/Docs/KDSArchitecture.md`
3. `Sources/Data/KDSAPIClient.swift`
4. `Sources/Data/OrderRepository.swift`
5. Relevant SwiftUI view or model file

## High-authority files

- `Sources/`
- `Sources/Docs/KDSArchitecture.md`
- `AGENTS.md`

## Runtime boundary

KDS consumes backend-owned kitchen projections and sends commands through backend contracts. It must not become the source of truth for orders.

## Safe local cognition

- KDS UX rules, client architecture, testing notes, and screen behavior belong here.
- Backend projection/schema changes belong in ConversaFlow unless the root ownership map changes.

## Avoid by default

- Xcode derived data.
- Local device secrets.
- Generated build output.
