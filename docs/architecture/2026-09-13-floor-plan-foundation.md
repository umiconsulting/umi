**Floor-plan foundation — 2026-09-13.** Branch: `feat/table-map`. Base: `4b83d13`.

The first increment connects dashboard layout editing to a published POS map. The user
selected Konva after the linked research.

The dashboard owns layout editing. The API owns validation, storage, versions, and
publication. Flutter consumes the generated layout contract.

- Create areas and table, wall, counter, door, and label elements.
- Edit labels, capacity, dimensions, position, and rotation through forms and Konva controls.
- Support duplication, grid snapping, undo, redo, and draft autosave.
- Keep published data separate from the draft.
- Use expected versions and the existing integrity service for retry-safe writes.
- Require `merchant.manage` for dashboard configuration and an authorized POS operator for
  published reads.
- Retain publication snapshots in the existing audit record.
- Display published geometry in the POS with area and list controls.

Coordinates describe element centers in fixed logical units. Rotation uses clockwise
degrees. Table identities remain stable through edits. Duplication creates a new identity.
The API validates rotated bounds, unique element IDs, unique area names, and table labels
within each area.

The additive schema file belongs to the existing build-v3 migration program. Apply it to a
disposable database for validation. Deployment requires the schema before the API release.

This increment has no visit or open-order writes. It displays a floor plan, with no invented
occupancy or service status. Open orders, kitchen amendments, settlement, and order history
remain the next service increment. **That increment must add occupied-table publication
checks before it enables visits.**

Validation covers contract rejection, draft isolation, version conflicts, duplicate
commands, scope checks, editor history, and Flutter rendering. The
[research](../research/2026-09-13-pos-table-map-and-order-traceability.md) retains the full
service roadmap.

Verified on 2026-09-13, on that branch:

- The complete build-v3 schema applies to a fresh PostgreSQL 17 database.
- Eight database tests cover publication, audit snapshots, retries, concurrent edits, RLS,
  and operator access.
- All 1,356 API unit tests pass. Fourteen existing integration tests remain excluded from
  the default suite.
- All 65 contract tests, 56 dashboard tests, and 250 POS tests pass.
- The API and dashboard builds pass. Flutter analysis reports no issues.
- Chromium checks pass at 1440-pixel and 390-pixel widths with mocked HTTP responses.
- Browser checks cover table creation, duplication, dragging, publication preview,
  lost-response retries, and location-specific draft recovery.

The editor loads Konva only when its route opens. Valid unsaved drafts recover within the
same browser tab and location scope. The two POS contract tests now reference the generated
version and the current realtime constants file.

The schema was tested locally. No deployment or remote database change occurred.

---

**On this branch, 2026-09-16.** The verification counts above are that branch's snapshot,
not this one's. Bringing the foundation over happened in slices and the state here is:

- **Schema and contract are landed**: `62_floor_plan.sql` (the versioned draft/published
  document) and `65_table_reservation.sql` (reservations, with the exclusion constraint
  that makes a double booking impossible at the database level), plus the typed models and
  the four floor-plan routes.
- **The API is landed**: `apps/umi-api/src/modules/floor-plan/**`, ported byte-identical,
  registered, with the route-table drift test resolving all four routes and a measured
  `floor-plan.read` row in the role-surface contract (refused for cashier and manager,
  allowed for admin and owner).
- **The dashboard editor and the POS surface are in flight** (the `floor-plan.jsx` screen
  with its model and CSS, and `features/tables/floor_plan_surface.dart`).
- **Still open from §8D**: table state with a shape or icon, merge and split as one gesture,
  the turn timer, the 200-table drag/rotate/merge/split suite on both tablet shapes, and the
  measurement D's acceptance actually asks for — a party of eight moved between tables in
  under five seconds. The occupied-table publication check this document requires applies
  to that work: a layout that removes or moves an occupied table must not publish.
