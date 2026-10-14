# Inventory operations, walked: waste, damage, production and the blind count

Date: 11 October 2026, 09:49–10:05 MST. Device: iMin D3-504, Estación build from this tree, API from
this tree on `:4013`, demo merchant.

The four buttons on `Operaciones de inventario` — `Aumentar`/`Reducir` were already walked, so these
were `Registrar merma`, `Registrar daño`, `Producir` and `Iniciar conteo ciego`. Two work and leave a
clean ledger, one cannot succeed on this data and says why, and one was dead: every press answered
`400 VALIDATION_FAILED`.

## Waste and damage

Both open the same quantity dialog (`Cantidad`, `Ingresa una cantidad entera.`), both require an
independent approval (`409 APPROVAL_REQUIRED`, then the approver's PIN), and both land:

| Action                                     | Call                             | Stock                              | Ledger row                                                          |
| ------------------------------------------ | -------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `Registrar merma` · Agua filtrada · 250 ml | `POST /inventory/waste` **201**  | 47900 → **47650**                  | `waste_recorded · 250 ml · effect_on_hand −250 · effect_waste +250` |
| `Registrar daño` · Leche de avena · 100 ml | `POST /inventory/damage` **201** | física 11820, **disponible 11720** | `quarantine_entered · 100 ml · effect_on_hand 0`                    |

Two things are worth the owner's eye, and neither is a failure:

1. **`Registrar daño` quarantines rather than writing off.** The client sends
   `disposition: 'quarantine'` (`inventory_controller.dart`), which the API projects as
   `quarantine_entered`: the item stays on hand and leaves the available pool, and the row grows a
   third action (release from quarantine). That is a coherent reading of "damaged" — but the dialog
   says nothing about where the quantity goes, so an operator who means "throw it away" has to know
   that `Registrar merma` is the write-off and this one is the holding pen.
2. **The action has two names.** The icon's accessible name is `Registrar daño`; the dialog it opens
   is titled `Marcar daño`.

## `Producir`

`Producir preparación` asks for `Artículo producido` (a dropdown of the tracked items),
`Cantidad que salió` and an optional `Lote`. Choosing `Agua filtrada · 500 ml` and confirming is
refused with the reason named on the glass:
**`Este artículo no tiene receta de producción.`** — honest, and exactly what the surface's own
comment promises.

It is also the only outcome this data can produce: `merchant.inventory_recipe` holds **seven
recipes, all with `target_item_id` NULL**, and the API resolves a production by
`inventory_recipe.target_item_id = dto.outputItemId`. So every item the till can offer is refused.
The till cannot do better by itself — it cannot read recipes, and its comment says so — but the
overview could: an item that is a production output is something the server knows and the contract
does not yet say.

## `Iniciar conteo ciego` — dead, and why

The button answered every press with `No fue posible completar la operación de inventario.` and no
visible cause. The API log had it:

```
400 request_refused POST …/inventory/counts code=VALIDATION_FAILED
    detail=message=The request does not match the public contract.
```

The command never reached the domain. `CreateInventoryCountRequest` types `itemIds` as
`z.array(Uuid).max(1000).default([])`, and the generated Dart writes the field whatever its value —
`"itemIds": itemIds` — so a client that leaves it out of its own call puts `"itemIds": null` on the
wire and the strict schema refuses the body.

`startCount` now says `itemIds: const []` out loud: every item in the location, which is what
`scope: 'full_location'` means. **On the rebuild**: `POST /inventory/counts` **201** and the till
opens `Conteo ciego activo — Registra cada cantidad. El sistema mostrará la varianza al enviar.`
with one empty field per item and no expected quantity in sight
(`07-blind-count-active-after.png`).

Pinned by `inventory_test.dart`, _"a blind count names its item scope instead of sending null"_,
checked both ways. The generic `No fue posible completar la operación de inventario.` was the screen's
own message for the refusal — the third surface in this tree that answers a contract violation with
something the operator cannot act on.

## Still open on this surface

1. Submitting and reconciling the inventory blind count (`Guardar conteo` → variance → reasons →
   approval) was not walked; the count started here is left open on the demo till.
2. A production cannot succeed until a recipe targets an inventory item — data or contract, the
   owner's call.
3. The `400 VALIDATION_FAILED` family: three surfaces now map it to a message with no cause in it.

Evidence: `docs/reports/evidence/2026-10-11-imin-inventory-mutations/`. POS suite **698**,
`flutter analyze` clean.
