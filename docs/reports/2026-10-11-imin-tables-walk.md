# The tables screen on the iMin: the whole service lifecycle, by hand

Date: 11 October 2026, 06:10–06:26 MST. Device: iMin D3-504, Estación build from this tree, demo
merchant, API on `:4013`, plan `Salón` (4 tables) + `Terraza` (2).

The plan's coverage table leaves _"whole-room operations"_ open. `floor_plan_surface.dart` is the
largest surface the till has, and the only device walk of it before this was the merge/split the
desktop driver made. This is the device walk with real taps, from an empty plan to a party moved,
served and cleared.

## What was walked

| Step                                                            | What the till did                                                                                                                                                                                                             | API                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `Mesas`                                                         | `6 mesas`, `2 por limpiar`, rooms (`Salón 4 mesas` / `Terraza 2 mesas`), the named space (`Barra`, `Entrada`), the six-state legend, `Ajustar` and the zoom                                                                   | `GET /floor-plan`, `GET /table-state`    |
| a table                                                         | the detail panel: name, seats, state chip, `Personas`, the live timer, and the actions for that state                                                                                                                         | —                                        |
| two `Por limpiar` tables → `Seleccionar` → `Combinar`           | `Selecciona dos o más mesas libres`, `2 seleccionadas`, `Combinar mesas · 2 mesas · 8 lugares`, a party-size stepper, `Confirmar`; the two tables became ONE bounded region with a shared timer, and the panel read `Grupo 2` | `POST /table-state/merge` 201            |
| `Dividir` on the group                                          | both tables split immediately; the party stayed on the primary table (8 people) and the second went back to `Por limpiar`, which is what it was before the merge                                                              | `POST /table-state/split` 201            |
| `Pedido enviado`                                                | the table went `Ocupada → Pedido tomado` (a second round is the same action, by design)                                                                                                                                       | `POST /table-state/ordered` 201          |
| `Marcar servido`                                                | `→ Servido`                                                                                                                                                                                                                   | `POST /table-state/served` 201           |
| `Pedir la cuenta`                                               | `→ Por cobrar`                                                                                                                                                                                                                | `POST /table-state/awaiting_payment` 201 |
| `Liberar mesa` → `¿Ya se fue el grupo de Mesa 3?` → `Confirmar` | the party left, the table went to `Por limpiar`, and the header chip went back to `2 por limpiar`                                                                                                                             | `POST /table-state/clear` 201            |
| `Sentar` → party size 2                                         | `Sentar en Mesa 3 / 4 Personas / [2]` → the table went `Ocupada, 2 personas` with the timer at `5 s` (a fresh turn)                                                                                                           | `POST /table-state/seat` 201             |
| `Mover` → a free table                                          | `Moviendo Mesa 3. Toca una mesa libre.` → the party arrived at Mesa 4 with the SAME service timer (`El tiempo de atención se conserva`) and the origin went to `Por limpiar`                                                  | `POST /table-state/move` 201             |

Everything the plan describes held on the hardware: the turn timer survived the move (`seated_at`
came along), the merge kept one party across two tables, the split returned the freed table to the
state it had, and every transition landed on the server where the next reader (the KDS, the
dashboard) can see it.

## The one defect this walk found, and the fix

With a move armed, the screen carried **two instructions, one of them false**:

```
Moviendo Mesa 3. Toca una mesa libre.        ← the gesture bar: what the next tap does
Toca una mesa para ver el detalle            ← the plan's standing hint: what it does NOT do
```

Tapping a table in that mode moves a party, so the second line invited the wrong tap in the one
state where a mistake touches a real customer's table. The hint is a nicety that was rendered
whenever the row was wide enough; it now stands down while a move or a merge selection is armed,
which is the state the gesture bar already speaks for.

Verified on the same device after the rebuild: with the mode armed, `Moviendo Mesa 4. Toca una mesa
libre.` is the only instruction on screen (`05-` vs `06-` in the evidence folder). Guard:
`test/features/tables/table_state_surface_test.dart` → _"the plan hint stands down once a table mode
is armed"_, checked both ways (it fails with the condition removed). POS suite: **690 tests**.

## What the walk checked against the documentation, and left alone

Two things looked like defects until the code and the plan were read, and both are deliberate:

1. **`Pedido enviado` on a table that is already `Servido` moves it BACK to `Pedido tomado`.** The
   transition matrix is deliberately wide: `table-map.repository.ts` says _"ANY PARTY-PRESENT STATE
   MAY GO TO ANY OF THE THREE… a table orders a second round after being served… so a made-up
   sequence would refuse ordinary taps and hand the operator a refusal with no recovery action,
   which §4 of the plan forbids"_, and `table_state.integration.ts` pins the database half.
2. **A table can be marked `Pedido tomado` with no order in the till.** The table's state is the
   floor's record, not the cart's: a café that takes the order on paper still has to tell the plan
   food is in.

Two wording inconsistencies remain, both cosmetic and both for the owner's ear rather than mine:

- the action is `Pedido enviado` / `Order sent` while the state it produces — and the legend, and
  the panel chip — say `Pedido tomado` / `Order taken`, where its two siblings are imperative and
  parallel (`Marcar servido` / `Mark served`, `Pedir la cuenta`);
- the seat dialog labels the table's CAPACITY `Personas` / `Guests` above a stepper whose value is
  the party size, while the detail panel calls the same capacity `lugares` / `seats`.

Evidence: `docs/reports/evidence/2026-10-11-imin-tables-walk/`.
