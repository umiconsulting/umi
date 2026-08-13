# UMI POS Pilot RC Manifest

Updated: 2026-08-13

## Release identity

| Field                | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| Release              | `UMI POS Pilot RC1`                                                |
| Version              | `6.0.0-pilot.rc1`                                                  |
| Source commit        | `9ea8560b6c0e7304834eae0cd960804132acac89`                         |
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
| UMI API   | `umipos-api:6.0.0-pilot.rc1`          | `sha256:d3021ddd4f8ce8f31ecd78bafa59a07e023e845fdd10e8fc51f3b4e3b55a3835`  | Built                  |
| Worker    | API image with worker command         | Same digest as API                                                         | Built                  |
| Dashboard | `umipos-dashboard:6.0.0-pilot.rc1`    | `sha256:0faa0eed132f83a31ec52a470f9de97fb755f8ffa677a92368b67885402dcc3a`  | Built                  |
| Linux POS | `umipos-linux-6.0.0-pilot.rc1.tar.gz` | SHA-256 `6b33fadef2e66a05517c067acb93c74f9d82fbd3bfc1085b8bbd6714097ad402` | Built                  |
| KDS       | Source tree                           | `9f0e88f1c839a453472294ce305a515476ac0d90`                                 | Statically verified    |
| Database  | Build-v3 migrations                   | Digest above                                                               | Clean migration passed |

The generated machine manifest is `artifacts/releases/6.0.0-pilot.rc1/release-manifest.json`.
Release artifacts remain outside Git by repository policy.

## Infrastructure

The RC requires PostgreSQL, Redis, the API, the worker, the Dashboard, Caddy, and OpenTelemetry.
Use TLS at public ingress. Use PostgreSQL TLS when the database crosses a trusted private boundary.
The deployment must inject all secrets outside Git.

Object storage is disabled in RC1. No current pilot operation requires it.
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
