# Negative stock editor verification

Date: 2026-10-30. Base: `36b0ea8d`. Branch: `fix/inventory-negative-stock-default`.

New items start with `Permitir saldo negativo` (`allow_and_flag`). Existing items retain their saved policy.
The editor shows a short explanation for allow, block, and authorization policies.
The detail panel uses the same policy labels under `Si falta inventario`.

## Evidence

- Test-first regression failed with the previous `block` default, then passed with the new default.
- Dashboard tests: 452 passed across 36 files. The focused model has 36 passing tests.
- Dashboard build and strict Lingui compilation passed. Both catalogs contain all messages.
- Dashboard lint: zero errors and the same 68 baseline warnings.
- Scoped Prettier and `git diff --check` passed.
- After the rebase onto the final initial-cost correction, all three affected dashboard tasks passed: build, lint, and test.
- Chromium 153.0.8010.12 used a separate context through CDP port 9225. The existing context remained intact.
- Real clicks created three items and changed an unrelated field on each item. All six command payloads preserved the selected policy.
- Real API reads confirmed persisted `allow_and_flag`, `block`, and `manager_override` values after each save.
- Each saved policy appeared with its Spanish label in the editor and detail panel.
- At 390 × 640, the policy control and explanation remained readable. Save and Cancel remained fully inside the viewport.
- A real mobile policy selection and Cancel click passed. Screenshots received visual inspection.

The reusable browser scenario is `apps/umi-dashboard/e2e/inventory-negative-stock-scenarios.js`.
The local result is `/private/tmp/umi-inventory-negative-stock-browser-result.json`.
Screenshots are `/private/tmp/negative-stock-detail-{allow_and_flag,block,manager_override}.png`,
`/private/tmp/negative-stock-mobile-policy.png`, and `/private/tmp/negative-stock-mobile-controls.png`.

## Limits

The mobile inventory entry control has an inherited layout problem. The page header intercepts its click after viewport resize.
The editor check follows the existing initial-cost procedure: open at desktop size, then resize to mobile size.
The task preserves this unrelated layout. The branch includes the separately reviewed initial-cost correction through its base.
The local synthetic merchant retains nine test items from three browser runs. Each item has a shelf life of three days.
The browser harness closes only its own context. Checkout enforcement remains covered by the existing phase 2 verification.

The change contains no backend code, migrations, notification behavior, or manual-cost edits.
The PR requires approval before merge. This work does not authorize deployment or notifications.
