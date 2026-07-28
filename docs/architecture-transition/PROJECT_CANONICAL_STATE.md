# UMI × UmiPOS — Canonical Project State

Updated: 2026-07-27

## Product authority

UmiPOS is an application of UMI. UMI owns all business and data authority.
Future clients use `packages/contract` and controlled UMI APIs.

## Completed platform gates

- Gate 1A established one Supabase migration authority, API authority, RLS, and tenant and branch isolation.
- Gate 1B established `packages/contract` as the only editable public contract authority.
- Gate 1C established durable identity, staff, session, permission, entitlement, and elevation foundations.
- Gate 1D established canonical idempotent business commands, optimistic aggregate versions,
  append-only audit and financial events, compensation references, correlation propagation,
  and tenant-visible redacted audit search.
- Gate 1E established bounded structured telemetry, safe operational diagnostics, layered abuse
  limits, dependency readiness, queue protection, deadlines, circuit breakers, and backpressure.
- Gate 1F certified the build-v3 entry platform and authorized `apps/umi-pos` creation with
  documented, non-blocking operational observations.

## Current implementation state

- `supabase/migrations/` is the only editable migration source.
- `apps/umi-api` is the only authoritative business write boundary.
- `packages/contract` generates neutral JSON, TypeScript, and Dart artifacts.
- `umi.user` owns login identity.
- `tenant.staff` owns the employment fact.
- `umi.user_role` and `umi.user_permission_override` own access grants.
- `runtime.session` owns durable application sessions.
- The API request role remains RLS-confined.
- Internal session, elevation, and security audit tables are not readable by clients.
- `tenant.business_command` owns command idempotency, fingerprint conflict detection, safe
  retry classification, and stored results.
- `tenant.aggregate_version` owns generic optimistic concurrency claims.
- `tenant.audit_event` is the append-only, hash-linked business audit authority.
- `runtime.audit_event_internal` separates internal metadata from client-visible audit data.
- `tenant.financial_event` provides the neutral append-only financial-event foundation.
- Financial corrections are new compensating events; existing financial events are never
  updated or deleted.
- Request and correlation identifiers are validated at the HTTP boundary and propagated
  through logs, commands, audit events, and public error envelopes.
- Logs, traces, and dead letters redact sensitive content and retain safe error categories.
- `/health/live` reports process liveness; `/health/ready` reports PostgreSQL and Redis readiness.
- `/health/diagnostics` requires an operations token and returns bounded aggregate telemetry.
- HTTP requests have bounded bodies, connection/request deadlines, and per-IP limits before route
  authorization.
- Authenticated traffic has independent user, device, tenant, and branch budgets.
- Queue admission rejects work at the bounded depth instead of allowing unbounded growth.
- Platform resilience utilities provide explicit deadlines, circuit state, and bounded concurrency.

## Prohibitions

- Do not create an independent UmiPOS backend or database.
- Do not give service-role credentials to a client.
- Do not write authoritative tables from Dashboard, KDS, Flutter, or Assistant clients.
- Do not add a second contract or migration authority.
- Do not update or delete audit or financial events.
- Do not reuse an idempotency key with a different canonical command fingerprint.
- Do not expose `runtime.audit_event_internal` through a public API or generated contract.
- Do not log raw credentials, authorization data, payment-sensitive values, customer message
  content, or raw phone numbers.
- Do not claim DDoS immunity; production requires provider mitigation, CDN/WAF controls, and a
  distributed limiter before horizontal scaling.

## Current local baseline

- Branch: `architectureUMIposIntegration`
- Build-v3 certification source commit: `a1e794d8fe0e9883f5677147ab81c4342f1a3980`
- Certification date: `2026-07-27`
- `BUILD_V3_CERTIFIED`: `true`
- UmiPOS application creation: `YES WITH OBSERVATIONS`
- Remote publication: deferred because the branch has no configured upstream.
