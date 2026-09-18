# Floor-plan drag synchronization

## Observed failure

The dashboard drew T1 at approximately `(216, 372)`. Its property fields and published
document contained `(600, 400)`. The POS displayed the published coordinates. The counter
also had different canvas and document coordinates.

## Decision basis

Documented facts:

- React Konva uses non-strict reconciliation by default. A dragged node can retain
  coordinates that differ from its React properties.
  [React Konva strict mode](https://github.com/konvajs/react-konva#strict-mode).
- Drag handlers must commit coordinates to application state.
  [Konva drag documentation](https://konvajs.org/docs/react/Drag_And_Drop.html).
- A Transformer changes scale. The application must convert scale into dimensions and then
  reset scale.
  [Konva Transformer documentation](https://konvajs.org/docs/react/Transformer.html).

Umi-specific finding:

The 900 ms autosave timer could start during a drag. The save disabled draggable nodes,
while the editor rejected changes during that save. The installed Konva code stops an active
drag when `draggable` becomes false. Non-strict reconciliation allowed the visual
displacement to remain after the document retained its previous coordinates.

## Correction

- Track the active drag or transform with a synchronous reference and React state.

---

**On this branch, 2026-09-16.** This report travels with the editor because the code's shape
is the answer to the failure above: a reader who "simplifies" the drag/transform tracking
back into plain React state re-introduces a canvas that disagrees with the published
document. The editor landed on this branch with that correction included; the API's
`API/validation` half — rotated bounds and the rest — was already landed separately and is
enforced server-side.
