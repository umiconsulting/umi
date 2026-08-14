# UmiPOS Documentation Index

Updated: 2026-08-13

This index separates current instructions from historical evidence. Use current instructions for operation. Use historical evidence only to trace a decision or certification.

## Baseline coverage

| Required area                              | Current owner                                                       | Classification                      | Status   |
| ------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------- | -------- |
| Architecture                               | `PROJECT_CANONICAL_STATE.md` and `ADR_GATE_1A_AUTHORITY.md`         | Current authoritative               | Complete |
| Business model and subsystem overview      | `UMIPOS_PRODUCT_COMPLETION.md` and `UMIPOS_CASOS_DE_USO_Y_ROLES.md` | Current authoritative               | Complete |
| Authentication and authorization           | `UMIPOS_PILOT_RBAC.md` and the support runbook                      | Current authoritative               | Complete |
| Data model and API                         | API README, schema migrations, and API generated contracts          | Current authoritative               | Complete |
| Dashboard                                  | `UMIPOS_DASHBOARD_OPERATIONS.md` and Dashboard instructions         | Current authoritative               | Complete |
| Flutter POS                                | Flutter README, quickstarts, and design language                    | Current authoritative               | Complete |
| KDS                                        | `UMIPOS_KDS_OPERATIONAL_MODEL.md` and KDS architecture              | Current authoritative               | Complete |
| Catalog                                    | `CATALOG_UI_DECISIONS.md` and Dashboard operations                  | Current authoritative               | Complete |
| Inventory                                  | `UMIPOS_INVENTORY_AUTHORITY.md`                                     | Current authoritative               | Complete |
| Sales, receipts, and refunds               | end-to-end certification, quickstarts, and support runbook          | Current authoritative with evidence | Complete |
| Shifts and cash operations                 | opening and closing checklists and manager quickstart               | Current authoritative               | Complete |
| Customers, loyalty, wallet, and gift cards | `UMIPOS_CUSTOMERS_LOYALTY_STORED_VALUE.md`                          | Current authoritative               | Complete |
| Devices and registers                      | enrollment specification, hardware runtime, and quickstarts         | Current authoritative               | Complete |
| Workers and observability                  | product completion, deployment, and support runbook                 | Current authoritative               | Complete |
| Deployment and backup                      | RC deployment and backup documents                                  | Current authoritative               | Complete |
| Troubleshooting and security               | support runbook, RBAC, and security certification                   | Current authoritative               | Complete |
| Pilot and release                          | RC manifest, pilot operations, and Gate 9C certification            | Current authoritative               | Complete |
| Development setup                          | workspace, application READMEs, and repository context files        | Current authoritative               | Complete |
| Glossary                                   | `UMIPOS_GLOSSARY.md`                                                | Current authoritative               | Complete |

## Classification result

| Classification        | Result                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Current authoritative | The tables in this document identify each current owner.                                              |
| Historical evidence   | Gate 7 through Gate 10A evidence remains immutable history.                                           |
| Superseded            | RC1 is `SUPERSEDED — DO NOT DEPLOY`. RC2 is current.                                                  |
| Duplicate             | Certification files overlap by design. They record separate gates and are not operation instructions. |
| Incomplete            | No baseline technical or operational area remains incomplete.                                         |
| Missing               | No required baseline area is missing.                                                                 |
| Stale                 | Gate 10 corrected the Flutter README, Dashboard deployment guide, and Gate 2F state.                  |

## Current authoritative documents

| Area                         | Document                                                    |
| ---------------------------- | ----------------------------------------------------------- |
| Product completion           | `docs/certification/UMIPOS_PRODUCT_COMPLETION.md`           |
| Architecture state           | `docs/architecture-transition/PROJECT_CANONICAL_STATE.md`   |
| Architecture boundary        | `docs/architecture-transition/ADR_GATE_1A_AUTHORITY.md`     |
| Product roles and use cases  | `docs/product/UMIPOS_CASOS_DE_USO_Y_ROLES.md`               |
| Glossary                     | `docs/product/UMIPOS_GLOSSARY.md`                           |
| Design system                | `docs/design/UMIPOS_DESIGN_LANGUAGE_V1.md`                  |
| RBAC                         | `docs/product/UMIPOS_PILOT_RBAC.md`                         |
| Device enrollment            | `docs/product/UMIPOS_DEVICE_ENROLLMENT_SPEC.md`             |
| Dashboard operations         | `docs/product/UMIPOS_DASHBOARD_OPERATIONS.md`               |
| KDS operation                | `docs/product/UMIPOS_KDS_OPERATIONAL_MODEL.md`              |
| Catalog decisions            | `docs/product/CATALOG_UI_DECISIONS.md`                      |
| Inventory authority          | `docs/product/UMIPOS_INVENTORY_AUTHORITY.md`                |
| Customers and value          | `docs/product/UMIPOS_CUSTOMERS_LOYALTY_STORED_VALUE.md`     |
| Hardware runtime             | `docs/product/UMIPOS_HARDWARE_RUNTIME.md`                   |
| Deployment                   | `docs/deployment/UMIPOS_PILOT_RC_DEPLOYMENT.md`             |
| Configuration                | `docs/pilot/UMIPOS_PILOT_RC_MANIFEST.md`                    |
| Backup and restore           | `docs/deployment/UMIPOS_BACKUP_RESTORE.md`                  |
| Pilot operation              | `docs/pilot/UMIPOS_PILOT_OPERATIONS.md`                     |
| Opening and closing          | `docs/pilot/UMIPOS_OPENING_CLOSING_CHECKLISTS.md`           |
| Support and troubleshooting  | `docs/pilot/UMIPOS_SUPPORT_RUNBOOK.md`                      |
| Owner review                 | `docs/product/OWNER_REVIEW.md`                              |
| Deferred physical validation | `docs/certification/UMIPOS_DEFERRED_HARDWARE_VALIDATION.md` |

## Current application instructions

| Application     | Document                                                                          |
| --------------- | --------------------------------------------------------------------------------- |
| Flutter POS     | `apps/umi-pos/README.md`                                                          |
| API             | `apps/umi-api/README.md`                                                          |
| Dashboard       | `apps/umi-dashboard/REPO_CONTEXT.md` and `apps/umi-dashboard/docs/deployment.md`  |
| KDS             | `apps/umi-kds/REPO_CONTEXT.md` and `apps/umi-kds/Sources/Docs/KDSArchitecture.md` |
| Workspace setup | `WORKSPACE.md` and root `README.md`                                               |

## Current certification evidence

| Gate        | Document                                                                   | Classification                                 |
| ----------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| 7A          | `docs/certification/UMIPOS_END_TO_END_CERTIFICATION.md`                    | Historical certification evidence              |
| 7B          | `docs/certification/UMIPOS_RESILIENCE_SECURITY_FINANCIAL_CERTIFICATION.md` | Historical certification evidence              |
| 8A          | `docs/certification/UMIPOS_POS_UX_CERTIFICATION.md`                        | Historical certification evidence              |
| 8B          | `docs/certification/UMIPOS_DASHBOARD_KDS_UX_CERTIFICATION.md`              | Historical certification evidence              |
| 9A          | `docs/certification/UMIPOS_PILOT_DRY_RUN.md`                               | Historical certification evidence              |
| 9B          | `docs/certification/UMIPOS_PILOT_RC_CERTIFICATION.md`                      | Historical release evidence; RC1 is superseded |
| 9C          | `docs/certification/UMIPOS_PILOT_CERTIFICATION.md`                         | Current RC2 certification evidence             |
| 10A attempt | `docs/certification/UMIPOS_CONTROLLED_PILOT_ACTIVATION.md`                 | Blocked site evidence; not an activation       |

## Superseded or historical material

- All RC1 artifacts are historical. They must state `SUPERSEDED — DO NOT DEPLOY`.
- Dated architecture audits and migration plans remain decision evidence. They are not current deployment instructions.
- NEXO discovery and response documents remain historical source evidence. They do not define runtime architecture.
- Build-v2 and migration audit files remain migration history. New product behavior must not use them as an owner.
- Gate prompts and prior reports do not override the current canonical state, release manifest, or product completion record.

## Missing documentation status

Gate 10 closed the baseline gaps for the product inventory, glossary, deferred register, documentation index, and completion decision.
Gate 11 can now build the Owner knowledge base. Product scope is already defined.
