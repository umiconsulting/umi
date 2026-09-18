# Inventory workspace redesign — the plan

_Plan · build-v3 · dashboard inventario surface · 2026-09-18_

## 0. Scope

This plan replaces the Inventario tab of the dashboard with an action-first
workspace. The plan covers five screens, the design language, the tests, and the
browser check.

This plan does NOT cover:

- The surface split between the till, the floor, and the desk. That decision is
  the subject of [the surface placement research](../research/2026-09-18-inventory-surface-placement/README.md).
  The plan assumes the split holds and works on the desk surface only.
- The permission model. The plan names the permission each action needs. It does
  not change a role.

## 1. The evidence base

Screens were read, not guessed. Every image below is in the repository.

| Source                                         | Files | Location                                                       |
| ---------------------------------------------- | ----- | -------------------------------------------------------------- |
| Vendor documentation, official                 | 8     | `docs/research/2026-09-18-inventory-surface-placement/assets/` |
| Vendor help centre, rendered                   | 17    | `assets/ugc/`                                                  |
| Community forum, merchant-posted               | 19    | `assets/ugc/community/`                                        |
| Reddit, user-posted                            | 5     | `assets/ugc/reddit/`                                           |
| App Store listings                             | 39    | `assets/store/`                                                |
| Marketplace app listings                       | 11    | `assets/marketplace/`                                          |
| Official and independent video, one frame each | 40    | `assets/video/`                                                |
| Independent review publisher                   | 19    | `assets/independent/`                                          |

Four research files carry the written evidence:

| File                                             | Owns                                   |
| ------------------------------------------------ | -------------------------------------- |
| `2026-09-18-inventory-ui-ux-surfaces.md`         | Where each vendor puts each screen     |
| `2026-09-18-inventory-operator-evidence.md`      | 55 operator reviews and posts          |
| `2026-09-18-inventory-ux-principles-and-rbac.md` | The surface rules and the RBAC sources |
| `2026-09-18-data-dense-ui-patterns.md`           | The component and interaction rules    |

## 2. The thesis

**The inventory workspace is a workbench, not a report.**

The current screen is an eight-column table with one action per row. A person
cannot use it. The evidence says why. Polaris states it best: a data table "is
not to be used for an actionable list of items that link to details pages", and
"If your use case is more about finding and taking action on objects, use a
resource list."

Three principles follow.

1. **State before data.** The first screen answers "what needs me?" It does not
   open on a list of every item.
2. **A row is a thing, not a cell.** Each row carries a state, a next action, and
   a way in. It does not carry eight facts.
3. **The session is the unit of work.** A count, a receipt, and an adjustment are
   sessions with a start, a progress, and a commit. They are not cells to type
   into.

## 3. The decisions

Each decision states the choice, the rejected alternative, the evidence, and the
check. The check is what a reviewer tests.

### D1. The surface opens on actions, not on the list

**Decision.** The Inventario view opens with three task tiles and an attention
queue. The item list sits below them.

**Rejected.** Open straight on the list. Rejected because the operator then has to
find the work in a wall of records.

**Evidence.** Apicbase opens on three tiles: `Count`, `Waste`, `Receive Order`,
each with a one-line explanation. This is a shipped inventory product, and its
home screen is a verb list. The independent operator corpus names the count as a
task the person starts on purpose.

**Check.** The Inventario view renders three tiles before any table. Each tile
names a verb and a live figure.

### D2. The attention queue is capped, and each entry is one action

**Decision.** A section named "Necesita tu atención" holds at most five entries.
Each entry is one sentence and one button. The button text is a verb plus a
noun: "Poner 12 costos".

**Rejected.** A dashboard of counters. A counter tells a person that a problem
exists and gives no way to act.

**Evidence.** NN/g requires an empty state and an exception state to offer the
next action. Carbon's empty-state pattern does the same. The operator corpus
shows the cost complaint most often: an ingredient with no cost breaks the
margins the owner came to read.

**Check.** No entry renders without exactly one button. The section caps at five
entries and shows a "Ver todo" link when more exist.

### D3. The item list is a resource list, not a data table

**Decision.** One line per item. The line holds a state dot, the name, a meta
line, a right-aligned on-hand figure, and one contextual action.

**Rejected.** The current eight-column table. Polaris says a table is for
comparison, not for finding and acting.

**Evidence.** Polaris: use a resource list when the goal is to find and act on
objects. It also fixes right alignment for numerals and puts the unit in the
header.

**Deliberate deviation.** Polaris puts the unit in the column header. Umi cannot.
An inventory item carries its own base unit, and the list mixes kilograms,
litres, and whole units in one column. A single header unit would be wrong for
most rows. The unit therefore sits inline with the value. This is the reason, and
it is checkable: a reviewer looks for a mixed unit list and confirms every row is
correct.

**Check.** A row shows at most four pieces of information. The on-hand figure
computes `text-align: right` and `font-variant-numeric: tabular-nums`.

### D4. A row action appears only when the row needs one

**Decision.** A healthy row shows no button until the pointer or the keyboard
focus arrives. A row in an attention state shows its action at rest: "Poner
costo", "Contar", or "Revisar unidad".

**Rejected.** A button on every row at all times. With 50 rows that is 50
competing calls to action, and the eye stops reading the list.

**Rejected.** No row action at all, and a click on the whole row. That hides the
verb, and the operator corpus asks for the verb.

**Evidence.** Microsoft: "Don't include commands that are part of the common app
workflow" in a secondary surface, which means the common command stays on the
main surface. Carbon: row menus are disabled while a batch selection is active,
which shows the row menu is the secondary action home. The operator corpus asks
for a named action, not a hidden one.

**Check.** A row with a cost and a normal stock level renders no visible button in
its default state. A row without a cost renders "Poner costo".

### D5. Saved views carry a count, and there are at most five

**Decision.** The views are `Todo (128)`, `Bajo stock (5)`, `Sin costo (12)`,
`Sin existencia (8)`, `Archivados (3)`.

**Amendment, 2026-09-18, after the data check.** The first draft proposed a
`Sin contar en 30 días` view. The item read does not return a last-counted date.
`_loadInventoryItems` in `apps/umi-dashboard/src/data.jsx` returns the items with
their on-hand rows and a `costedIds` list, and nothing else. A count-age view
would therefore need a new endpoint, and a view built on invented data is worse
than no view. The `Sin existencia` view replaces it. It uses the state the read
already carries: `onHandDisplay` answers `empty` when the branch has no balance
row, which means the item has never been counted at this branch. That is the same
question, answered from real data.

**Rejected.** A filter builder as the primary control. The operator corpus shows a
small, stable set of questions.

**Evidence.** The component rules cap saved views at eight and require a count
beside each name. Five is inside the cap and matches the five real questions.

**Check.** Each chip text ends with a number in parentheses. The row does not
wrap at 1280 pixels.

### D6. The filter set lives behind one button

**Decision.** Three filters stay as chips: `Tipo`, `Sin costo`, `Ubicación`. The
rest sit in a side sheet, opened by one "Filtros" button. The sheet shows the
active filter count on the button.

**Rejected.** Every filter as a chip. The chip row then becomes a second toolbar,
and the rules cap promoted chips at three.

**Evidence.** The component rules: promote no more than three filters, keep the
full set behind one entry point, and apply the filters as one batch.

**Check.** The chip row holds three chips or fewer. One button opens the sheet at
every width, as a modal sheet below 840 pixels.

### D7. A bulk action bar replaces the row menus

**Decision.** Selecting a row reveals a bar above the list:
"3 seleccionados · Activar conteo · Bloquear negativos · Limpiar". While the bar
is open, the row overflow buttons are disabled.

**Rejected.** Per-row delete inside the overflow menu. It is slower and it hides
the count from the person who is about to act.

**Evidence.** Carbon: the batch action bar appears once a row is selected, and
"single action icons and overflow menus on the row should be disabled."

**Check.** A snapshot with two rows selected shows the bar and hides the row
overflow button.

**Amendment, 2026-09-18, after the command audit.** The first draft offered
`Archivar` and `Activar` as bulk actions. The audit found no inverse command.
`inventory.item.archive` sets `active = false`, and `inventory.item.update`
accepts `displayName`, `lowStockThreshold`, `shelfLifeDays`, `parQuantity`,
`trackingPolicy`, and `negativeStockPolicy` — and no `active` field. A person
cannot clear the archive state from this surface. The bulk actions are therefore
the two useful writes the API does support, and `Archivar` moves to the single
item menu with a confirmation that states the consequence.

### D8. Archive is reversible by the inverse action, not by a toast undo

**Decision.** `Archivar` is a single-item action. The confirmation names the item
and states the consequence in one sentence: the item leaves the till, and this
panel cannot restore it.

**Rejected.** An "Undo" toast. The stock ledger is append-only. Umi cannot
un-write a ledger entry, and a toast that promises a reversal the database cannot
perform is a lie.

**Rejected.** A bulk archive with no way back. The write model cannot reverse it,
so the interface must not make it a one-click action on fifty records.

**Evidence.** The component rules ask for undo on every destructive bulk action.
The rules do not know about an append-only ledger. This is a deliberate
deviation, and the reason is the write model, not taste.

**Check.** The confirmation text holds the item name and one sentence about the
consequence. No bulk archive path exists.

### D9. Counting is a session, not a grid

**Decision.** A count runs in three steps.

1. **Áreas.** Choose the areas to count from a tile gallery. Each tile names an
   area and dates the last count.
2. **Conteo.** One item at a time. A large figure, a keypad, quick-level buttons,
   and a running "N de M". The current on-hand is hidden while the person counts.
3. **Resumen.** The counted items, the difference against the last count, the
   uncounted items, and the `Enviar conteo` button.

**Rejected.** A grid of quantity inputs per shelf, which is what Toast xtraCHEF
and Lightspeed ship. It works on a desktop with a mouse. It is wrong on a tablet
in a walk-in fridge, and the operator corpus puts the count in the walk-in
fridge.

**Evidence.** WISK ships the session model on a phone: an area list with progress,
then one item with a visual level picker and a keypad, then "Review & submit
inventory". Partender ships one bottle per screen. Toast xtraCHEF's own setup
wizard uses area tiles with `Cancel` and `Next`. Square ships "Save & Count
Later" inside the count, which shows that a count must survive an interruption.
The operator corpus names the lost count as the worst failure in the category.

**Check.** The count screen renders exactly one item figure at a time. The bottom
bar holds a running count. A reload of the page returns the person to the same
step and the same item.

### D10. A stock adjustment is one item, one number, one reason

**Decision.** The adjust sheet holds the item name, the current amount, a keypad,
the new amount, a reason, and one button.

**Rejected.** A multi-row adjustment form. A routine adjustment touches one item.

**Evidence.** Square ships exactly this sheet: an item card, a "Track stock"
toggle, a preference, a quantity, and `Cancel` / `Update stock`.

**Check.** The sheet renders one item. The reason is required. The button is
disabled until the amount changes.

### D11. Setup is a three-step wizard, not a long form

**Decision.** Creating an item runs in three short steps: `Identidad`, `Unidades`,
`Costo`. Each step fits one screen. A progress line names the step.

**Rejected.** One long form in a drawer. Atlassian requires a page or a modal for
a multi-field edit, and the current `ItemEditor` is a single long scroll.

**Evidence.** Toast xtraCHEF's inventory setup is a wizard with a tile step and a
`Next` button. Material 3 sets the small-screen pane rule: the second pane becomes
a sheet below the content, never a second column on a phone.

**Check.** No step scrolls past one viewport at 1280 pixels. The wizard is
cancelable at every step.

### D12. The keyboard is a first-class input

**Decision.** `/` focuses search. `Ctrl+K` or `Cmd+K` opens a command palette over
the workspace. Arrow keys move the row focus. `Enter` opens the row. `X` selects
the row. `Esc` closes the top layer.

**Rejected.** A mouse-only workspace. The operator corpus holds an operator who
counts 5,000 items, and the rules cite a keyboard as the reason the desktop
surface stays fast.

**Check.** Each key is documented in a `?` sheet and each key works on the list.

### D13. The detail is a panel, and the panel is read-first

**Decision.** The item detail opens as a panel at 1024 pixels and wider. Below
that it takes the full screen. The panel is read-first. Each section carries its
own `Editar` control and its own save.

**Rejected.** A drawer for everything. Material 3 fixes list-detail at 840 pixels
for two panes, and a read panel is not a form.

**Rejected.** A full page per item on the desktop. It breaks the scan loop: open,
read, close, next.

**Evidence.** Material 3 canonical layouts. Linear documents an in-place peek for
the same reason. Atlassian reserves the page for a multi-field edit, which D11
moves into a wizard.

**Check.** The panel switches at 1024 pixels. Each section shows its own save
control only when the section is dirty.

## 4. The design language

The look must be modern in behaviour and calm in appearance. It must not chase a
fashion. Concretely:

| Item        | Decision                                                                                                    | Reason                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Colour      | Keep the Umi tokens. One accent. Status uses `success`, `warning`, `danger`, and `info` with the soft wash. | The token file owns the palette. A second palette would drift.                                |
| Status      | A word plus a dot. Never colour alone.                                                                      | Colour alone fails a colour-blind reader and fails a screenshot.                              |
| Radii       | 8 pixels for a dense control, 12 for a panel, 20 stays for a marketing card.                                | The current `--r-card: 20` is too round for a table row. A new `--r-ctl: 8px` token is added. |
| Type        | `--font-body` for data. `--font-mono` for a reference code. One size per role.                              | A dense surface needs a stable rhythm.                                                        |
| Numbers     | `font-variant-numeric: tabular-nums`, right aligned, one decimal rule per field.                            | The rules require it. The existing screen already does this in one cell.                      |
| Motion      | Only the existing `--dur-1` and `--dur-2`. No motion on a data update.                                      | Motion on a list makes a scan slower.                                                         |
| Icons       | Lucide, already imported as `I`.                                                                            | The house rule.                                                                               |
| Empty space | A dense surface keeps a fixed row height of 44 pixels.                                                      | The control floor is 44 pixels in the token file.                                             |

## 5. The screens

### A. Inventario — the landing

```
  ┌ Contar stock ───────────────┐ ┌ Revisar existencia ────────┐
  │ Elige las áreas y cuenta    │ │ 5 artículos sin existencia │
  └─────────────────────────────┘ └────────────────────────────┘

  Necesita tu atención
  ● 12 artículos sin costo                    [ Poner 12 costos ]
  ● 5 artículos bajo el umbral                [ Ver bajo stock ]
  ● 8 artículos sin contar en 30 días         [ Contar ]

  Inventario                        [ Filtros (2) ]  [ ⌘K ]
  [ Todo 128 ][ Bajo stock 5 ][ Sin costo 12 ][ Sin contar 8 ][ Archivados 3 ]
  [ Buscar artículo                                    ]
  ────────────────────────────────────────────────────────────
  ● Chicharrón                        2.5 kg           ⋯
    ING-0007 · Insumo
  ● Leche entera          ⚠ Sin costo   12 L    [Poner costo] ⋯
  ...
  ────────────────────────────────────────────────────────────
  1–50 de 128          [ Anterior ]  [ Siguiente ]
```

**Amendment, 2026-09-18, after the browser run.** The first draft gave the rail
three tiles, and the third was `Nuevo artículo`. The list toolbar already carries
`Nuevo artículo` as its primary action, so the screen rendered the same primary
action twice. The browser run showed both at once. The rail now holds the two
jobs that are not the list, and `Nuevo artículo` stays the list's own primary.

States: loading (skeleton rows), empty (a verb CTA), filtered-empty (a "Limpiar
filtros" button), error (the message and a retry button).

### B. The item panel

```
  Chicharrón                                  [ Contar ] [ ⋯ ]
  ING-0007 · Insumo · Se cuenta por peso
  ─────────────────────────────────────────────────────────
  Existencia        2.5 kg          Bajo el umbral de 5 kg
  ─────────────────────────────────────────────────────────
  Identidad          Nombre, referencia, tipo        [Editar]
  Unidades           1 kg = 1000 g                   [Editar]
  Costo              $182.40 / kg · No configurado   [Poner costo]
  Alérgenos          Ninguno                         [Editar]
  Historial          Últimos 5 movimientos
```

### C. The count session

```
  Contar stock                                1 Áreas · 2 Conteo · 3 Resumen
  ────────────────────────────────────────────────────────────────────────
  Paso 1
  ┌ Walk-in ┐ ┌ Congelador ┐ ┌ Barra ┐ ┌ Almacén ┐ ┌ Estante seco ┐
  │ hace 12d │ │ hace 30d   │ │ hace 4d│ │ hace 8d │ │ hace 30d     │
  └─────────┘ └────────────┘ └───────┘ └─────────┘ └──────────────┘
                                          [ Cancelar ]  [ Siguiente ]

  Paso 2
  Leche entera                        4 de 21
        12 L en el sistema
        ┌──────────────────────────┐
        │          0.75            │  L
        └──────────────────────────┘
        [ 0 ] [ ¼ ] [ ½ ] [ ¾ ] [ Lleno ]
        [        teclado         ]
  ──────────────────────────────────────────
  [ Atrás ]                       [ Siguiente ]  [ Resumen (7) ]

  Paso 3
  Contado            21 de 21
  ────────────────────────────────────────
  Leche entera       12 L →  9 L      −3 L
  Chicharrón        2.5 kg → 2.5 kg      0
  ...
  Faltan 0 artículos
                                        [ Enviar conteo ]
```

### D. The adjust sheet

```
  ┌ Ajustar existencia ─────────────────────────── ✕ ┐
  │ Leche entera                                      │
  │ Existencia actual 12 L                            │
  │ Nueva existencia  [   9   ] L                     │
  │ Motivo            [ Merma ▾ ]                     │
  │ Nota              [               ]               │
  │                        [ Cancelar ] [ Ajustar ]   │
  └───────────────────────────────────────────────────┘
```

### E. The item wizard

```
  Nuevo artículo       1 Identidad · 2 Unidades · 3 Costo
  ────────────────────────────────────────────────────────
  Nombre            [ Chicharrón          ]
  Referencia        [ ING-0007            ]
  Tipo              [ Insumo ▾ ]
  Se cuenta         [ Por peso ▾ ]
  ────────────────────────────────────────────────────────
                                 [ Cancelar ]  [ Siguiente ]
```

## 6. The implementation

### Phase 1 — the workspace

| Step | Work                                                                                                                | File                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1.1  | Add the `--r-ctl` token and the new primitives: `.inv-tile`, `.inv-row`, `.inv-state`, `.inv-bulkbar`, `.inv-panel` | `apps/umi-dashboard/src/styles.css`    |
| 1.2  | Extend the pure model: view definitions, view counts, attention rules, row-state rules                              | `src/screens/inventory-model.js`       |
| 1.3  | Add unit tests for every new pure rule                                                                              | `src/screens/inventory-model.spec.js`  |
| 1.4  | Build the new workspace: tiles, attention queue, views, list, bulk bar, keyboard                                    | `src/screens/inventory-workspace.jsx`  |
| 1.5  | Build the item panel                                                                                                | `src/screens/inventory-item-panel.jsx` |
| 1.6  | Build the filter sheet                                                                                              | `src/screens/inventory-filters.jsx`    |
| 1.7  | Build the adjust sheet on the existing command pipeline                                                             | `src/screens/inventory-adjust.jsx`     |

### Phase 2 — the count session

| Step | Work                                                                        | File                                        |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------- |
| 2.1  | The session reducer as a pure module, with a resume key in `sessionStorage` | `src/screens/inventory-count-model.js`      |
| 2.2  | The three steps                                                             | `src/screens/inventory-count.jsx`           |
| 2.3  | Tests for the reducer: add, skip, resume, submit, blind rule                | `src/screens/inventory-count-model.spec.js` |

### Phase 3 — the item wizard

| Step | Work                                            | File                                    |
| ---- | ----------------------------------------------- | --------------------------------------- |
| 3.1  | Split the current `ItemEditor` into three steps | `src/screens/inventory-item-wizard.jsx` |
| 3.2  | Keep the existing command calls and error copy  | same                                    |

### Phase 4 — verification

| Step | Work                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | `pnpm --filter umi-dashboard test` is green                                                                                                     |
| 4.2  | `pnpm --filter umi-dashboard lint` is green                                                                                                     |
| 4.3  | The real browser check over `./scripts/ux-browser.sh`: open, filter, select, bulk archive, open the panel, run the count, submit the adjustment |
| 4.4  | A screenshot at 1440, 1024, and 390 pixels                                                                                                      |
| 4.5  | The ADR for the surface split                                                                                                                   |

## 7. What this plan does not do, and why

| Not done                                   | Reason                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Remove the inventory surface from the till | That is a Flutter change and a permission change. It needs the ADR first. The plan writes the ADR. |
| Add a phone route                          | The dashboard is a browser surface. The floor device is a later product decision.                  |
| Add a bulk import                          | Nothing in the evidence asks for it at this size.                                                  |
| Add a second palette                       | The token file owns the palette.                                                                   |

## 8. The check

A reviewer opens the real dashboard and does this:

1. The Inventario view opens on three tiles and an attention queue.
2. The `Sin costo` view lists only the items with no cost, and the chip count
   matches the row count.
3. Selecting two rows opens the bulk bar and hides the row overflow buttons.
4. `Archivar` names the count and one item.
5. The item panel opens beside the list at 1440 pixels and takes the screen at
   390 pixels.
6. A count survives a page reload at the same step and the same item.
7. The adjust sheet refuses an empty reason.
8. Every on-hand figure is right aligned and uses tabular numerals.

## 9. Sources

| Claim                                                 | Source                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A table is for comparison; use a resource list to act | [Shopify Polaris](https://polaris.shopify.com/components/data-table)                                                     |
| Batch action bar; disable the row menu                | [IBM Carbon data table](https://carbondesignsystem.com/components/data-table/usage/)                                     |
| Two panes at 840 dp; a sheet on a small screen        | [Material 3 list-detail](https://m3.material.io/foundations/layout/canonical-layouts/list-detail)                        |
| Keep the frequent command on the main surface         | [Microsoft app settings](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings) |
| Right align numerals; unit in the header              | [Shopify Polaris](https://polaris.shopify.com/components/data-table)                                                     |
| The timing ladder for loading                         | [NN/g progress indicators](https://www.nngroup.com/articles/progress-indicators/)                                        |
| Action tiles as the home screen                       | Apicbase, App Store listing                                                                                              |
| The count as a session                                | WISK, official walkthrough                                                                                               |
| One item per screen while counting                    | Partender, App Store listing                                                                                             |
| Area tiles with Cancel and Next                       | Toast xtraCHEF, help centre                                                                                              |
| Save and continue a count later                       | Square for Retail, official walkthrough                                                                                  |
| One item, one number, one reason                      | Square, merchant community post                                                                                          |
| A count sheet with a progress figure                  | MarginEdge, official walkthrough                                                                                         |

## 10. Outcome, 2026-09-18

Phases 1 to 4 are done. This section records what shipped, what the checks
measured, and what the checks caught.

### What shipped

| Phase | Files                                                                                                                                                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | `inventory-workspace.jsx` (the workbench), `inventory-item-panel.jsx`, `inventory-filters.jsx`, `inventory-adjust.jsx`, `inventory-item-editor.jsx` and `inventory-copy.js` (the editor, split out), `inventory-model.js` (the rules), `styles.css` (the primitives), `icons.jsx` (seven glyphs) |
| 2     | `inventory-count-model.js`, `inventory-count-model.spec.js`, `inventory-count.jsx`                                                                                                                                                                                                               |
| 3     | The wizard is NOT built. Phase 1 keeps the existing item dialog, which now lives in `inventory-item-editor.jsx`. See "what remains".                                                                                                                                                             |
| 4     | The checks below, and [the ADR](../architecture/2026-09-18-inventory-three-surfaces-adr.md)                                                                                                                                                                                                      |

### The checks

| Check              | Result                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests         | 321 passed, 24 files. 27 of them are new rules in `inventory-model.spec.js`. 33 more are the count session.                                               |
| Lint               | 0 errors. 67 warnings, which is exactly the pre-existing baseline. `scripts/check-lint-warning-baseline.mjs` passes.                                      |
| Translations       | `lingui compile --strict` passes. 111 new strings are translated in `src/locales/en/messages.po`.                                                         |
| Real browser, 1440 | The rail, the queue, the views with counts, the rows, the panel in a 673 px + 420 px split.                                                               |
| Real browser, 1024 | The list spans the width. No overflow.                                                                                                                    |
| Real browser, 390  | The panel covers the screen and owns the top layer. No overflow.                                                                                          |
| A live count       | The count session ran against the live API: `inventory.count.create`, `submit`, `preview`, and `reconcile` all committed. The ledger took the correction. |

### What the browser run caught, and the fix

These are defects a unit test would not have found. Each one came from opening
the real screen and clicking.

| Defect                                                                                         | Fix                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escape did not close the command palette. The backdrop then swallowed every click on the page. | The keydown handler now closes the top layer in stack order, and the branch sits above the "is the user typing" guard, because the palette autofocuses its own input. |
| No row was reachable by Tab. The roving tabindex started at -1, so every row was `-1`.         | The first row takes the 0 when `focusIndex` is -1.                                                                                                                    |
| The on-hand figure computed `text-align: start`, because the grid centred its items.           | The value cell sets `text-align: right` as well.                                                                                                                      |
| Two identical primary actions, `Nuevo artículo`, rendered at once.                             | The rail holds the two jobs; the list keeps its own primary.                                                                                                          |
| At 390 px the panel painted under the topbar, although its box measured 0,0,375×844.           | `.main` carries `isolation: isolate`, which traps a fixed child. The panel portals to `body` below 1024 px, the same way `Select` and `Menu` already do.              |
| The rail's tile title and note ran together on one line.                                       | Both are block elements.                                                                                                                                              |

### What remains

| Item                                                   | Why it is open                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 3, the three-step item wizard                    | Phase 1 keeps the working dialog. The wizard is a pure improvement and the dialog is not broken, so the wizard is the next change and not this one.                                                                                                                                                                                                                                                                                                     |
| A backend defect the count run found                   | An open count blocks a new one. `inventory_count_active_scope_uidx` raises a raw `DatabaseError`, and the API answers **500** instead of a domain conflict. The screen now adopts `overview.activeCount` instead of creating a duplicate, so the operator does not see the 500 — but the API still returns one, and a work item should be raised. The Azure DevOps MCP was not reachable from this session, so the item is recorded here and not filed. |
| The count is blind on the screen and not in the policy | The policy row records `blind: f`. D9 owns the screen rule, so the screen stays blind. If the policy is the authority, the screen should read it.                                                                                                                                                                                                                                                                                                       |
| The till still carries the count                       | The ADR proposes the removal and depends on the floor surface. Removing it first would leave the operator with no way to count.                                                                                                                                                                                                                                                                                                                         |
| A floor surface                                        | Not built. Nothing in the repository serves it.                                                                                                                                                                                                                                                                                                                                                                                                         |
