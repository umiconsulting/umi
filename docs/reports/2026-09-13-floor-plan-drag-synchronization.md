# Floor-plan drag synchronization

## Observed failure

The dashboard drew T1 at approximately `(216, 372)`.
Its property fields and published document contained `(600, 400)`.
The POS displayed the published coordinates.
The counter also had different canvas and document coordinates.

## Decision basis

Documented facts:

- React Konva uses non-strict reconciliation by default. A dragged node can retain coordinates that differ from its React properties.
  [React Konva strict mode](https://github.com/konvajs/react-konva#strict-mode).
- Drag handlers must commit coordinates to application state.
  [Konva drag documentation](https://konvajs.org/docs/react/Drag_And_Drop.html).
- A Transformer changes scale. The application must convert scale into dimensions and then reset scale.
  [Konva Transformer documentation](https://konvajs.org/docs/react/Transformer.html).

Umi-specific finding:

The 900 ms autosave timer could start during a drag.
The save disabled draggable nodes, while the editor rejected changes during that save.
The installed Konva code stops an active drag when `draggable` becomes false.
Non-strict reconciliation allowed the visual displacement to remain after the document retained its previous coordinates.

## Correction

- Track the active drag or transform with a synchronous reference and React state.
- Cancel the autosave timer at interaction start. Check the reference again before a save starts.
- Commit the completed geometry through the existing history reducer. One completed interaction creates one undo step.
- Apply the same snapped and bounded coordinates to the canvas node and document.
- Reset scale after a transform. Use per-node strict reconciliation between interactions.
- Block publishing and conflicting controls during an interaction.
- Keep new edits locked while a save awaits its response. Preserve the existing retry and version checks.
- Allow area selection and zoom in the published preview.

This change preserves the shared floor-plan document and the POS coordinate model.

## Validation

The browser suite runs the full dashboard with intercepted API responses in an isolated browser context.
It covers long drags, unchanged snapped positions, long resizes, delayed saves, rotation, consecutive drags, zoom, undo/redo, publication, and reload.
It compares canvas coordinates with the document received by the test API.

Run the browser regressions from the workspace root:

```sh
pnpm --filter @umi/dashboard test:browser
```

The existing dashboard suite contains 59 tests.
The live Chromium check confirmed that all five elements match the saved coordinates after this change.
Chapultepec retained draft and published version 12 throughout that check.

A snapshot of the original visible nodes and local recovery data is at `/tmp/umi-floor-plan-before-drag-fix.json`.
The snapshot is a local temporary artifact outside Git.
