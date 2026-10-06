# Gate 1E Operational Boundaries

## Protection layers

- Application: bounded request bodies and deadlines, per-IP/user/device/tenant/branch limits,
  bounded pagination, queue depth rejection, bounded concurrency, retry limits, circuit breakers,
  structured errors, redacted logs, and safe diagnostics.
- Protocol and session: durable revocable sessions, replay-resistant commands, idempotency,
  correlation identifiers, and explicit device identity hooks.
- Infrastructure: production still requires provider DDoS mitigation, CDN/WAF policy, connection
  limits, distributed rate limiting before horizontal API scaling, queue isolation, and alerts.

These controls reduce abuse impact. They do not provide or claim DDoS immunity.

## Deployment assumptions

- The current application limiter is process-local and bounded to 10,000 keys. A multi-instance
  deployment must replace its store with an atomic distributed limiter while preserving the key
  dimensions and fail-closed semantics.
- Reverse proxies must supply trustworthy client IPs and strip untrusted forwarding headers.
- CDN/WAF limits must reject oversized bodies, abusive connection rates, and known malicious
  traffic before it reaches the API.
- Queue depth, HTTP latency, dependency readiness, rate-limit rejection, dead letters, memory, and
  circuit state require operational alerts with environment-specific thresholds.
- `/health/live` proves process liveness. `/health/ready` checks PostgreSQL and Redis.
  `/health/diagnostics` requires `OPERATIONS_TOKEN` and exposes bounded aggregate diagnostics only.
- Assistant execution remains unimplemented. Future tools must use separate user/tenant budgets,
  cost ceilings, bounded concurrency, allowlisted operations, confirmation, and audit.
