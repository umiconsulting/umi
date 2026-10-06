# Build-v3 Platform Certification

## Decision

**BUILD_V3_CERTIFIED: true**

**Authorization: YES WITH OBSERVATIONS** — build-v3 may authorize creation of
`apps/umi-pos`.

This authorization covers safe application scaffolding and progressive Gate 2 integration. It does
not certify checkout, catalog, payments, inventory, receipts, refunds, offline operation, hardware,
or pilot readiness. Those capabilities do not exist merely because the platform foundation is
certified.

## Repository evidence

- `supabase/migrations` is the active migration authority. `apps/umi-api/db/migrations` contains
  only a placeholder. Frozen `apps/umi-cash/prisma/migrations` is historical reference material.
- `apps/umi-api` is the active business mutation boundary.
- Dashboard runtime code uses UMI API routes and `@umi/contract`; it contains no direct Supabase
  write client.
- KDS runtime configuration targets `/api/kds/*`; it contains no Supabase credential or direct
  table access.
- `packages/contract` is the editable contract authority and deterministically generates neutral
  JSON, Dart, and TypeScript artifacts.
- API request access is RLS-confined; the worker privilege boundary is explicit and boot-checked.
- Gate 1C–1E tests cover identity, isolation, durable sessions, command integrity, redaction,
  resource limits, queue protection, health, and resilience primitives.

## Blocking findings

None for creating the `apps/umi-pos` application structure.

## Observations

1. Rate-limit state is process-local. Replace it with atomic distributed state before multiple API
   instances serve traffic.
2. Correlation and pipeline traces are sufficient for entry, but full OpenTelemetry export remains
   desirable before pilot operations.
3. Metrics are bounded and diagnosable, but production scrape, retention, dashboards, and alert
   delivery still require deployment configuration.
4. `apps/umi-dashboard/docs/audit-connectivity.md` and
   `apps/umi-kds/Sources/Docs/KDSArchitecture.md` retain historical service-role descriptions.
   Runtime code already uses the API; mark those passages superseded in Gate 2A.
5. Frozen `umi-cash` retains its Prisma migration history. It is not an editable build-v3 authority
   and must remain excluded from the workspace and future UmiPOS dependencies.

## Security conclusion

The entry platform applies default-deny authorization, tenant and branch isolation, RLS-confined
request access, revocable sessions, idempotency, append-only audit/financial foundations, bounded
resources, redacted telemetry, and safe diagnostics. Infrastructure must still provide CDN/WAF,
provider DDoS mitigation, trusted proxy configuration, secrets delivery, distributed limiting when
scaled, and alert routing. This certification does not claim DDoS immunity.

## Certification boundary

Certification is based on repository state
`a1e794d8fe0e9883f5677147ab81c4342f1a3980` and the focused checks recorded in this document.
No product behavior was added or certified.

## Focused validation

- Contract generation drift check, schema typecheck, and 23 contract tests: PASS.
- API typecheck and affected identity/database/integrity/operations lint: PASS.
- Cross-gate focused certification: 101 tests across 21 files, all PASS.
- Complete Supabase migration chain on disposable PostgreSQL 17: PASS.
- PostgreSQL role assertions: API `BYPASSRLS=false`; worker `BYPASSRLS=true`.
- Tenant RLS policy inventory: 39 policies.
- API access to internal audit metadata: denied.
- Readiness JSON parsing, 35 unique certification IDs, evidence-path validation, internal links,
  formatting, and `git diff --check`: PASS.
