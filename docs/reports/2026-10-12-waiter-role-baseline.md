# Waiter role baseline

## Decision

The `waiter` template grants `catalog.read`, `cart.write`, and `order.fire`.
It grants no checkout or cash permissions.
The POS can read tables with `cart.write`.
The merchant can choose additional permissions through its role configuration.

Migration `020_waiter_role_template.sql` creates the template and merchant roles.
It preserves custom role assignments.
It adds baseline permissions only to template roles at revision 1.
`scripts/onca-waiter-fixture.sql` assigns Mesero only when the current role is a legacy staff or cashier default.
The fixture preserves an existing custom role.

## Local evidence

A read of `umi_local` found Mesero 1 assigned to `custom-mesero-a7ec3f`.
That role already had `order.fire` and had no `checkout.commit`.
A new physical login first showed the waiter navigation, then showed cashier navigation.
The live `umi.resolve_staff_permissions` function was the legacy definition from file 35.
It ignored `merchant_role_id` and returned the staff permissions.
`PosEntryRepository.startOperator` uses this function to create the operator snapshot.
No production update of the snapshot permissions was found.
Migration 020 restores the resolver from file 49.
The file 35 generator preserves that resolver when the merchant role schema exists.
The next verification must apply the resolver fix and create a new operator session.
This change did not modify the local assignment or session permissions.

The active RBAC function lacked the merchant role permission branch from schema file 49.
A grant insert failed with `record "new" has no field "id"` in the disposable clone.
A reapply of schema file 35 had replaced the function and staff trigger with their earlier definitions.
Migration 020 restores both definitions.
File 35 now preserves the merchant role branch and staff assignment trigger during a reapply.

## Checks

The disposable database was `umi_open_accounts_verify_20261012`.
Migration 020 applied twice without extra rows on the second apply.
The ONCA fixture preserved the existing custom role.
File 35 and migration 020 both passed a complete reapply.
The effective permission test passed after file 35 ran last.
The RBAC generator check passed.
The template had exactly the three permissions above.
The integration suite passed 5 tests with Vitest 2.1.9 and Node 24.21.0.
ESLint passed for the changed backend files.

The tests cover an unpublished plan, empty accounts, accounts without a table, account ownership, financial ambiguity, and visits.
They also prove that a staff assignment change and a role grant change end the affected operator session.

`openTable` now reads only the published plan.
The account list excludes empty accounts without a table.
Read and claim still support those accounts by ID.
A table account stays visible when empty.
