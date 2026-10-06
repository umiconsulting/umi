# Phase 0C — Security and Abuse Baseline

## Scope

This baseline uses OWASP Top 10:2025 and OWASP API Security Top 10:2023. It does not claim DDoS
immunity.

## Critical findings

| Threat               | Surface                                 | Current mitigation              | Missing mitigation                                    | Gate     | Residual risk                |
| -------------------- | --------------------------------------- | ------------------------------- | ----------------------------------------------------- | -------- | ---------------------------- |
| Cross-tenant access  | API and SQL                             | RLS app pool and guards         | Final roles, branch context, worker exceptions        | 1A       | Critical until cutover proof |
| Session theft/reuse  | Dashboard and future POS                | Signed JWT and secure cookies   | Durable families, reuse detection, revocation         | 1B       | Critical                     |
| Direct authority     | Dashboard and KDS                       | Some API routes                 | Remove direct Supabase operational paths              | 1A       | Critical                     |
| Device spoofing      | POS and KDS                             | Partial KDS device model        | POS public-key proof, nonce, branch binding           | Gate 2   | Critical                     |
| Financial replay     | Checkout and payment                    | Partial idempotency tables      | Fingerprint store and atomic result                   | Gate 3   | Critical                     |
| Sensitive-flow abuse | Login, PIN, enrollment, refund, receipt | In-memory limits                | Distributed buckets and alerts                        | 1E       | Critical                     |
| Resource exhaustion  | API, sync, reports, media, Assistant    | Some schema limits              | Global payload, page, export, queue, and cost budgets | 1E       | High                         |
| Unsafe upstream      | Payments, email, AI, media              | Adapters and timeouts vary      | Circuit breakers, schema validation, ambiguity state  | Gate 3/4 | High                         |
| Data exposure        | Logs and errors                         | Request IDs and structured logs | Full redaction policy and tests                       | 1E       | High                         |
| Supply chain         | Monorepo packages                       | Lockfiles and package managers  | Provenance, update policy, SBOM, signed releases      | Gate 4   | Medium                       |

## Protection layers

### Application

- Enforce object and function authorization for each operation.
- Bind tenant, branch, actor, device, resource version, and entitlement.
- Validate schemas, uploads, URLs, file types, sizes, pages, exports, and batch counts.
- Use idempotency, replay resistance, optimistic versions, and fail-closed errors.
- Redact logs. Audit all consequential decisions.

### Protocol and session

- Use TLS, secure cookies, CSRF controls, durable session rotation, and central revocation.
- Sign device commands with timestamp, nonce, method, path, body hash, and command ID.
- Use bounded timeouts, circuit breakers, backpressure, and queue limits.

### Network and provider

- Put public traffic behind a CDN and WAF with provider DDoS mitigation.
- Apply distributed rate limits near the edge and in the API.
- Separate public, app, worker, database, and observability networks.
- Alert on saturation, denial spikes, provider errors, and cost anomalies.

## Assistant controls

Use an allowlist, strict schemas, permission checks, tenant isolation, result limits, time and cost
budgets, prompt-injection separation, redaction, confirmation, fresh PIN, manager approval, and
audit. Never give the Assistant raw SQL or service credentials.
