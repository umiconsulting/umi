# Local POS API and database alignment

Date: 2026-09-13. Branch: `feat/table-map`. API code commit: `31a574e`.

## Result

The local API now uses `/home/jc/umi-table-map/apps/umi-api` on port 4001.
It reports contract `2.19.0` and schema `build-v3-62`.
The readiness endpoint confirms PostgreSQL, Redis, and schema compatibility.
The Linux POS is open at the operator PIN screen.

## Causes and corrections

- The old API process used `/home/jc/umi`, which lacked the floor-plan module.
  The replacement process uses the feature branch and an explicit release identity.
- The cash query returned `sequence::text`, then sorted by that output alias.
  Ten entries produced the order `1, 10, 2`, which the cash calculation rejected.
  The query now sorts by the qualified numeric database column.
- The cart upsert assigned `business_date`, which the API role cannot update.
  The canonical trigger derives this date from the cart creation timestamp and merchant settings.
  The upsert now leaves the date to that trigger.
- The local database lacked `merchant.floor_plan`, some canonical grants, and ten timestamp triggers.
  A transaction applied the specific differences after a complete database backup.

CodeGraph traced the cash calculation through the repository and cash service callers.
The original checkout had a current index for its own files, with an older index format.
A fresh feature-branch index included the floor-plan module and the corrected repositories.
The final sync reported that this index was current.

## Database scope

The repair affected only the local database `umi_transition_rehearsal_20260901`.
The reference database came from the canonical `docs/migration/build-v3` SQL files.
The repair applied these changes:

- Apply `62_floor_plan.sql`, including its schema version record.
- Restore API INSERT on `kitchen_order_item` and `kitchen_event`.
- Restore API INSERT and UPDATE on `kitchen_order`.
- Remove excess worker writes on `role_template`, `role_template_revision`, and `role_template_revision_permission`.
- Restore `touch_updated_at` on `device_enrollment_request`, `pos_checkout_policy`, `pos_checkout_draft`, and `customer_consent_current`.
- Restore that trigger on `hardware_device`, `hardware_pilot_policy`, `kitchen_route`, `kitchen_order`, `kitchen_order_item`, and `kitchen_device_station`.

The comparison found no remaining missing or changed tables, column types/nullability, table grants, column grants, or triggers.
The reviewed policy differences used equivalent direct and scalar-subquery merchant checks.
The remaining function and constraint differences concerned whitespace, parentheses, or equivalent constraint names.
The repair preserved these equivalent definitions and the existing business records.
The API still lacks permission to update the cart business date.

Local evidence and recovery files:

- Backup: `/tmp/umi-pos-before-alignment-20260913.dump` (custom PostgreSQL archive, mode 0600).
- Applied transaction: `/tmp/umi-pos-alignment/apply.sql`.
- Comparison script and catalog reports: `/tmp/umi-pos-alignment/`.
- API log: `/tmp/umi-pos-alignment/api.log`.
- POS log: `/tmp/umi-pos-table-map-launch.log`.

The backup and comparison files are local temporary artifacts. They are outside Git.

## Validation

- Both database failures reproduced before the query fixes.
- Ten integration tests passed against a disposable canonical database: two POS regressions and eight floor-plan tests.
- Thirty-four focused unit tests passed across cash calculations, cash repository behavior, cash service behavior, and sale service behavior.
- The API build, changed-file lint, and whitespace checks passed.
- The corrected repository read all ten entries from an existing cash shift under the API role.
- The existing catalog returned 136 products and 12 categories.
- Cart creation and recovery succeeded under the API role in a transaction that was rolled back.
- The floor-plan repository authorized the existing active operator and returned published version zero.
- The reopened POS received HTTP 200 from release metadata and device status endpoints.

The floor plan has no published document yet. An owner must create and publish a layout before the POS can display tables.
The repository checks confirm data access. A visual check of the catalog and cash screens still requires normal operator sign-in.

## Local runtime

The API uses an ignored `.env` copied from the existing local configuration.
Its metadata declares contract `2.19.0` and expected schema `build-v3-62`.
The old API watcher was stopped before the replacement process started.
The original checkout and its deployment edits remain intact.

To start the aligned API after a reboot, use the feature checkout:

```sh
cd /home/jc/umi-table-map/apps/umi-api
node --enable-source-maps dist/main.js
```

Rebuild with `pnpm --filter @umi/api build` from the workspace root after API source changes.
The running API uses compiled output. A branch change alone does not replace that process or rebuild the Linux POS.
