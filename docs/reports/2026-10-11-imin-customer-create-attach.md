# Creating a customer, attaching them, and a control that stands down

Date: 11 October 2026, 09:18–09:35 MST. Device: iMin D3-504, Estación build from this tree, API from
this tree on `:4013`, demo merchant.

The customer centre's three remaining unproven clicks — `Crear cliente`, `Adjuntar a la venta`,
`Usar venta anónima` — walked end to end, plus the guard behind them that made a control lie about
being ready.

## `Crear cliente`

The person-add icon opens **`Crear cliente mínimo`**: `Nombre` (required), `Correo opcional`,
`Teléfono opcional`, `Idioma` (`Español`), the note `No se concede consentimiento de marketing.`,
and `Cancelar` / `Crear` (`00-create-minimal-form.png`).

Filling it and pressing `Crear` posts `POST …/customers` **201** and drops the operator on the new
customer's own page. The row it wrote, read back from `merchant.customer`:

| name         | public_reference                           | preferred_language |
| ------------ | ------------------------------------------ | ------------------ |
| `Ana Prueba` | `CUS-a1f29d40-0c6d-49b8-87b9-ec7327124f41` | `es`               |

The display name with its space is stored as typed, both contacts land as `Contacto protegido`
(masked in the till, complete in the database), and the customer starts with `No hay movimientos
visibles.` and no loyalty card — the account appears with the first earn.

**Finding, legibility (same family as the kitchen ticket and the print queue):** the new customer's
`publicReference` is a UUID, `CUS-a1f29d40-…`, where the demo's own customer is `CUS-PILOT-01`
(`01-created-uuid-reference.png`). This is the string the operator would read out or write on a cup,
and it is the least readable of the three, because it is on the customer's own page.

## `Adjuntar a la venta`

With an editable sale open, the button posts `POST …/sales/<id>/customer` **201** and the cart panel
comes back showing the customer's name (`Ana Prueba`) where `Asignar cliente` used to be
(`02-attached-to-the-cart.png`). `Usar venta anónima` is the same control in reverse:
`DELETE …/sales/<id>/customer` **200**.

## The control that lied about being ready

`attachCustomer` (and five siblings) guard on the same three things — not mid-mutation, a sale to
name, a cart to version — and each of them wrote the condition out again. Nothing let the _surface_
ask, so `Adjuntar a la venta` was rendered whenever the operator had the permission, and a tap in a
state the command refuses produced **a silent `return`**: no request, no message, the screen
unchanged.

`SaleLifecycleController.canEditSale` is that condition, in one place, and the six commands now use
it. The customer centre asks it: with the sale parked, the button renders disabled and the line
underneath says `Empieza o reanuda una venta para adjuntar un cliente.`
(`03-parked-sale-button-stands-down.png`) — verified on the till after `POST …/suspend` **201**, the
reachable state where the action cannot run.

Pinned by two tests: `sale_lifecycle_test.dart` follows `canEditSale` from nothing open → open sale →
parked sale, and `customer_value_test.dart` asserts the button's `onPressed` is null with the reason
on screen. Both checked both ways: forcing the button back to enabled fails the widget test.

## A correction, kept in the open

The first run of this walk left a note in my own log that the attach tap "answered with nothing".
It did not: my tap was six pixels above the button's published top edge, and the coordinates I read
off a screenshot are not the coordinates the accessibility tree publishes. The real defect in that
neighbourhood is the silent `return` described above, which is reachable and now impossible to walk
into; the reports, tests and code comments say that, and not the tap I missed.

## Still open on this surface

`Ajustar puntos` and `Emitir tarjeta` on a customer with no loyalty account yet, and the wallet
family (`2026-10-11-loyalty-preview-lifecycle.md`: authorization, preview and tender legs still do
not agree).

Evidence: `docs/reports/evidence/2026-10-11-imin-customer-create-attach/`. POS suite **697**,
`flutter analyze` clean.
