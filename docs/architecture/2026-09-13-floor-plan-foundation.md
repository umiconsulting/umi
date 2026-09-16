**Floor-plan foundation — 2026-09-13.** Branch: `feat/table-map`. Base: `4b83d13`.

The first increment connects dashboard layout editing to a published POS map. The user selected Konva after the linked research.

The dashboard owns layout editing. The API owns validation, storage, versions, and publication. Flutter consumes the generated layout contract.

- Create areas and table, wall, counter, door, and label elements.
- Edit labels, capacity, dimensions, position, and rotation through forms and Konva controls.
- Support duplication, grid snapping, undo, redo, and draft autosave.
- Keep published data separate from the draft.
- Use expected versions and the existing integrity service for retry-safe writes.
- Require `merchant.manage` for dashboard configuration and an authorized POS operator for published reads.
- Retain publication snapshots in the existing audit record.
- Display published geometry in the POS with area and list controls.

Coordinates describe element centers in fixed logical units. Rotation uses clockwise degrees. Table identities remain stable through edits. Duplication creates a new identity. The API validates rotated bounds, unique element IDs, unique area names, and table labels within each area.

The additive schema file belongs to the existing build-v3 migration program. Apply it to a disposable database for validation. Deployment requires the schema before the API release.

This increment has no visit or open-order writes. It displays a floor plan, with no invented occupancy or service status. Open orders, kitchen amendments, settlement, and order history remain the next service increment. That increment must add occupied-table publication checks before it enables visits.

Validation covers contract rejection, draft isolation, version conflicts, duplicate commands, scope checks, editor history, and Flutter rendering. The [research](../research/2026-09-13-pos-table-map-and-order-traceability.md) retains the full service roadmap.

Verified on 2026-09-13:

- The complete build-v3 schema applies to a fresh PostgreSQL 17 database.
- Eight database tests cover publication, audit snapshots, retries, concurrent edits, RLS, and operator access.
- All 1,356 API unit tests pass. Fourteen existing integration tests remain excluded from the default suite.
- All 65 contract tests, 56 dashboard tests, and 250 POS tests pass.
- The API and dashboard builds pass. Flutter analysis reports no issues.
- Chromium checks pass at 1440-pixel and 390-pixel widths with mocked HTTP responses.
- Browser checks cover table creation, duplication, dragging, publication preview, lost-response retries, and location-specific draft recovery.

The editor loads Konva only when its route opens. Valid unsaved drafts recover within the same browser tab and location scope.
The two POS contract tests now reference the generated version and the current realtime constants file.

The schema was tested locally. No deployment or remote database change occurred.
