# UMI POS Pilot RC Manifest

Updated: 2026-08-13

## Release identity

| Field                | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| Release              | `UMI POS Pilot RC2`                                                |
| Version              | `6.0.0-pilot.rc2`                                                  |
| Source commit        | `1e885022b654dcecf943377ea2e1e3b739a9027a`                         |
| Branch               | `architectureUMIposIntegration`                                    |
| PR                   | `#72`                                                              |
| Base                 | `build-v3`                                                         |
| Contract             | `2.12.0`                                                           |
| Configuration schema | `1`                                                                |
| Migration range      | `build-v3-00` through `build-v3-48`                                |
| Migration digest     | `b00445e57382ec33e9780e51cc9af5c3f2561bf9c686e2a64356647eccb2c555` |

The source commit is the artifact authority. A later documentation commit records certification results.

## Release components

| Component | Artifact                              | Identity                                                                   | Status                 |
| --------- | ------------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| UMI API   | `umipos-api:6.0.0-pilot.rc2`          | `sha256:17ba3a2294eb0d91c5e29237d428a93c94bfb9b2ebba99f486978b87945582fd`  | Built                  |
| Worker    | API image with worker command         | Same digest as API                                                         | Built                  |
| Dashboard | `umipos-dashboard:6.0.0-pilot.rc2`    | `sha256:2cb2c1a2b003ff5c081987bbcc95fcb9a29881b4d2e258b7bca09f71b0d79995`  | Built                  |
| Linux POS | `umipos-linux-6.0.0-pilot.rc2.tar.gz` | SHA-256 `15a27dad69597b7dcae8b355380383f44df0fc6ad0c1a5fcb1cf19cd8f370d3a` | Built                  |
| KDS       | Source tree                           | `9f0e88f1c839a453472294ce305a515476ac0d90`                                 | Statically verified    |
| Database  | Build-v3 migrations                   | Digest above                                                               | Clean migration passed |

The generated machine manifest is `artifacts/releases/6.0.0-pilot.rc2/release-manifest.json`.
Release artifacts remain outside Git by repository policy.

## Infrastructure

The RC requires PostgreSQL, Redis, the API, the worker, the Dashboard, Caddy, and OpenTelemetry.
Use TLS at public ingress. Use PostgreSQL TLS when the database crosses a trusted private boundary.
The deployment must inject all secrets outside Git.

Object storage is disabled in RC2. No current pilot operation requires it.
If enabled later, configure an endpoint, bucket, region, access key, secret key, durability, and backup policy.

External payment authorization is not included. Manual terminal payment remains an operator assertion.
Do not enable a real provider until its test environment and reconciliation procedure pass.

## Supported boundaries

- The Linux POS artifact is built and verified.
- Dashboard and API container artifacts are built and verified.
- KDS behavior is statically and locally simulated.
- Physical iPad and Xcode builds are not verified in this environment.
- Physical printer, drawer, scanner, and customer display are not verified.

## Configuration contract

`deploy/pilot/pilot.env.example` is the template. `apps/umi-api/src/shared/config/config.schema.ts` is the runtime authority.

Required classes:

- Runtime: environment, database URLs, Redis URL, public origins, release identity, and schema identity.
- Secrets: database passwords, session keys, customer-value keys, bootstrap token, and operations token.
- Pilot-only: bootstrap identity, minimum client versions, secure cookies, trusted proxy ranges, and release identity.
- Optional: object storage, telemetry exporter, provider adapters, lifecycle jobs, and external message services.
- Test-only: smoke identities, disposable confirmation, and fixture closing count.

Production values fail closed. Keep insecure webhook mode disabled. Keep secure cookies enabled.
Do not use template placeholders or localhost values in the real pilot environment.

## Known observations and P2 items

- Physical iPad validation is pending.
- Physical peripheral validation is pending.
- Provider-specific object storage validation is pending if storage becomes enabled.
- External payment provider validation is pending.
- Final Owner preferences depend on the pilot.
- The closing runner P2 is closed. It now requires an explicit fixture count.
- RC1 is superseded. Gate 9C found and fixed a clean-database startup race before pilot activation.

## Deployment and recovery

Use [UMIPOS_PILOT_RC_DEPLOYMENT.md](../deployment/UMIPOS_PILOT_RC_DEPLOYMENT.md).
Use application rollback with the forward-compatible schema.
Do not reverse immutable business facts.
Use a verified backup restore only for database loss or corruption.

## Certification evidence

- [Pilot RC certification](../certification/UMIPOS_PILOT_RC_CERTIFICATION.md)
- [Pilot dry run](../certification/UMIPOS_PILOT_DRY_RUN.md)
- [End-to-end certification](../certification/UMIPOS_END_TO_END_CERTIFICATION.md)
- [Resilience certification](../certification/UMIPOS_RESILIENCE_SECURITY_FINANCIAL_CERTIFICATION.md)
