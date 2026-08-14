# Phase 0C — Validation Strategy

## Principle

Use a small set of risk-based gates. Do not combine unrelated UI, financial, security, and
resilience tests in one serial suite.

## Per change

- Run lint and typecheck for changed packages.
- Run focused unit tests for changed rules.
- Validate changed contract schemas and generated output.
- Run affected SQL, RLS, or integration tests when a boundary changes.
- Check formatting and the diff.

## Pull request

- Run authorization and branch negatives for affected resources.
- Run RLS and role checks for data-policy changes.
- Run contract drift and compatibility checks.
- Apply changed migrations to an empty database and an upgrade fixture.
- Run focused app builds.
- Run secret, dependency, and generated-artifact checks.

## Release or pilot

- Run one complete sale across order, payment, cash, inventory, loyalty, receipt, KDS, and audit.
- Inject response loss at each commit boundary.
- Test payment ambiguity and duplicate provider events.
- Test cash opening, blind count, reconciliation, close, reopen, and handoff.
- Run offline replay, snapshot expiry, tamper, conflict, and recovery.
- Test device, user, branch, entitlement, and version revocation.
- Test printer, scanner, drawer, manual terminal, and KDS fallback on certified hardware.
- Run backup restoration and compatible-release rollback.
- Run load, abuse, queue saturation, and graceful-degradation tests.

## Strong coverage domains

Keep deterministic vectors for money, tax, rounding, idempotency, response loss, concurrency,
refund ceilings, receipt hashes, cash reconciliation, inventory conservation, offline sequence,
KDS deduplication, authorization, RLS, revocation, and audit redaction.

Use UI tests for critical operator journeys and accessibility. Do not create a test for each minor
visual detail.
