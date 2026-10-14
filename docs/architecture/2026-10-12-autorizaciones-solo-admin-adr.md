# ADR: las autorizaciones son del admin (nadie más pone el PIN)

- Fecha: 2026-10-12
- Estado: **Aceptado e implementado** (matriz del piloto regenerada, migración `028`,
  matriz documental de casos de uso alineada).
- Relación: generaliza lo que `2026-10-12-cancelar-despues-de-empezar-adr.md` hizo para un
  solo acto (cancelar un platillo ya empezado) a **toda** autorización.

## El hecho que lo provoca

El dueño había pedido, el mismo día, «deja que el cajero pueda hacer todo con el dinero»:
eso agregó al rol `cashier` las permisiones de autorización del dinero (`cash.drawer.no_sale.approve`,
`cash.movement.paid_in/paid_out/safe_drop.approve`, `cash.shift.close.approve`,
`cash.variance.approve`) y también las de hacer (`cash.drawer.no_sale`, `cash.shift.handoff`,
`cash.count.recount`). Horas después lo revirtió: **«las operaciones más sensibles deben
obtener el PIN de un admin».**

La distinción importa y es la que ordena todo lo demás. El till ya pregunta: cada retiro
sin venta abre el diálogo del PIN del encargado, cada movimiento por encima del umbral
también, cada descuento, cada excepción y cada cancelado de un platillo ya hecho. El PIN se
resuelve contra `umi.resolve_staff_permissions`, es decir, contra **quien lo teclea**. La
decisión no es de pantallas: es de quién tiene la permisión.

## Decisión

1. **Autorizar es de `admin` y de nadie más.** La familia `*.approve`, más las que autorizan
   sin decirlo en el nombre (`sale.void.create`, `stored_value.reconcile`,
   `order.void_after_preparation.approve`) y el visto bueno de un replay offline
   (`offline.recovery.review`), quedan solo en el rol `admin`. En el piloto eso son 27
   permisiones que solo tienen _Administradora UmiPOS_ y _Admin ONCA_.
2. **Hacer sigue repartido.** Quien opera conserva su permisión de operar y por eso puede
   _pedir_ la operación sensible; lo que ya no puede es autorizarse a sí mismo ni avalar a
   otro. El rol «Cajero» conserva `cash.drawer.no_sale`, `cash.movement.paid_out`,
   `cash.reconcile` y el resto.
3. **Dos actos sin forma de pedir autorización se estrechan quitando el acto**, porque no
   existe un camino de PIN para ellos: `cash.shift.handoff` (entregar la custodia del cajón)
   y `cash.count.recount` (volver a contar con el cajón ya abierto). Quedan en owner, admin,
   manager y supervisor — como los tenía la matriz documental — y fuera del cajero.
4. **El admin puede autorizar su propio acto** (2026-10-13, misma conversación). Antes, quien
   tecleaba el PIN tenía que ser **otra persona** distinta de la que estaba en sesión: eso se
   escribió cuando las autorizaciones vivían en cajeros y gerentes, y una segunda persona era
   el control. Al mover el control a la permisión, la regla vieja se volvió un candado: en un
   café con **un solo admin** —la forma normal de un negocio chico, y la de este piloto— el
   admin sentado en la caja, tecleando su propio PIN, leía «ese PIN no autoriza este
   movimiento» y la operación sensible quedaba imposible. Hoy el PIN prueba una credencial
   viva de alguien que **tiene** la permisión, la autorización se gasta una vez y va ligada a
   la huella del acto, y `approved_by` guarda quién aprobó — el propio actor cuando fue su
   acto. **No** se pide una segunda persona; se pide una autorización.
   La excepción está escrita en `config/umipos-pilot-approval-boundaries.json`
   (`selfApprovalException.role = admin`) y una prueba la vigila para que no se amplíe a otro
   rol sin que el gate falle.

## Cómo se aplica (y por qué fueron dos mitades)

| Mitad                      | Dónde                                                                         | Qué gobierna                                                                  |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Roles canónicos            | `config/umipos-pilot-role-grants.json` → `35_pos_pilot_rbac.sql` (regenerado) | `umi.role` / `umi.role_permission`: los roles del piloto                      |
| Roles propios del comercio | migración `028`                                                               | `merchant.role` / `merchant.role_permission`: los que se crean desde el panel |

La segunda mitad es la que hacía que el cambio no se sintiera. `umi.resolve_staff_permissions`
**prefiere** el rol propio (`merchant_role_id`) sobre el canónico, y en este comercio el rol
«Cajero» —creado a mano el 2026-10-07— arrastraba **23** permisiones de autorización. Estrechar
solo los roles canónicos habría dejado la caja igual: la cajera seguía pudiendo autorizar.

No hace falta que nadie vuelva a iniciar sesión: el aprobador se resuelve en el momento de
teclear el PIN. Lo que sí queda cacheado es la lista de permisiones de la _sesión del
operador_ (`runtime.operator_session.permissions`), que es la que decide qué botones dibuja
el till; un operador que ya estaba dentro la refresca al volver a entrar.

## Lo que queda fuera, a propósito

- **La propietaria conserva `inventory.invoice.approve` y `inventory.recipe.approve`.** No es
  un descuido: `docs/migration/build-v3/76_recipes_inventory.sql` las otorga al owner y
  `99_verify.sql` **falla el build** si el owner no las tiene («the approval gate would have
  no holder»). Moverlas a admin es tocar la cadena y su verificador, y son aprobaciones de
  compras y recetas —panel, no caja—, así que se deja como está y se decide aparte.
- **El editor de roles del panel todavía no impide** que alguien vuelva a dar una autorización
  a un rol propio: la `028` limpia lo que había y corre una vez. El siguiente paso, si se
  quiere que la regla no se pueda deshacer desde la UI, es validarlo al guardar el rol.
