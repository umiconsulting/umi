# ADR: cancelar un platillo que la cocina ya empezó (con gerente, y como merma)

- Fecha: 2026-10-12
- Estado: **Aceptado e implementado** (migraciones `026` y `027`, contrato `2.32.0`, till
  y API).
  Verificado en el iMin contra la base real: cancelar un platillo en `preparing` desde
  la caja pide el PIN de un gerente, lo anula, y el evento de cocina queda marcado como
  merma.
- Relación: extiende `019_cancel_sent_cart_line.sql` (la frontera original) y reusa la
  autorización de `sale.void.create` que ya usaban las excepciones de venta.

## El hecho que lo provoca

Una cuenta con dos platillos ya enviados no se podía corregir: el capuchino estaba
`ready` en Barra y la margarita seguía `queued` en Cocina. El till dejaba anular la
margarita y **no** el capuchino — el bloqueo llegaba por platillo, en el instante en que
cocina toca «Empezar»— y el único camino para arreglarlo era una persona editando la
base. La pregunta del dueño fue exacta: _«¿entonces se pueden editar hasta que en cocina
den empezar a preparar, o cómo le hacen?»_.

La respuesta de la industria (ver la investigación de política de edición) es unánime en
los cinco sistemas que un café usa de verdad —Toast, Square, SpotOn, TouchBistro,
Clover—: **una línea enviada no se edita** (se anula y se vuelve a capturar), se puede
**agregar** siempre, y para **anular algo ya enviado** se pide autorización de un
gerente. Negar la anulación no deshace el platillo: solo deja la cuenta mal y la merma
invisible.

## Decisión

Tres reglas, y ninguna es nueva salvo la segunda:

1. **Agregar** a una cuenta enviada siempre se puede (segunda ronda).
2. **Editar** una línea enviada nunca: la única salida es anular + volver a capturar.
3. **Anular** una línea enviada se puede mientras cocina no la haya tocado
   (`queued`/`exception`) sin pedir nada; a partir de ahí —`preparing`, `ready`— se pide
   un **PIN de administrador**, que autoriza ese cancelado exacto. Un ticket `completed`
   sigue sin poder anularse: ese ticket ya es el registro del día.
4. **Solo el día del ticket** (decisión del dueño, 2026-10-12, y la regla de Toast): el
   cancelado de un platillo enviado es un acto del mismo día operativo. Pasado el corte de
   las 04:00, esa cuenta se cobra o se resuelve entera con el cierre del día; no se
   desarma platillo por platillo. Aplica a los dos caminos, porque el corte no distingue
   si la cocina alcanzó a empezar.

## Por qué `admin` es su PROPIA permisión (y no `sale.void.create`)

La primera versión de este camino reusó `sale.void.create` — la que ya usan las
excepciones de venta — porque ya existía y ya se clasificaba como aprobación. **El dueño
estrechó la regla: solo un administrador autoriza este cancelado.** Esa permisión la
tienen admin, gerente, owner y supervisor a la vez, así que reusarla habría dejado la
regla en cuatro roles mientras la decisión hablaba de uno.

La permisión propia es `order.void_after_preparation.approve`, otorgada **solo a `admin`**
en `config/umipos-pilot-role-grants.json`, con su frontera declarada en
`config/umipos-pilot-approval-boundaries.json` (`cancel_sent_line_after_preparation`,
actor separado, un solo uso, ligada a huella y auditada) y su fila en el catálogo. La
anulación de una VENTA cobrada, en cambio, sigue como estaba.

## Mecanismo

| Pieza                          | Dónde vive                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autorización del administrador | `runtime.elevation_grant`, permiso **`order.void_after_preparation.approve`**, otorgado solo al rol `admin`. El RBAC del piloto se regeneró (`35_pos_pilot_rbac.sql`) y se aplicó; el aprobador se resuelve por `umi.resolve_staff_permissions` en el momento de teclear el PIN, así que no hace falta que nadie vuelva a iniciar sesión |
| Solo el día del ticket         | `merchant.customer_order.business_date` contra el día operativo en curso del comercio (migración `027`). El estado nuevo `day_closed` viaja al till como `CART_LINE_DAY_CLOSED`, con su propia frase: la salida no es buscar un gerente, es cobrar o cerrar el día                                                                       |
| Ligadura al acto               | La huella (`approvalFingerprint`) se calcula sobre seis campos — comercio, sucursal, cuenta, línea, motivo y **versión de la cuenta** — y se exige igual en los dos lados. Si la cuenta se movió mientras el gerente tecleaba el PIN, la autorización queda vieja y se vuelve a pedir                                                    |
| Gasto de la autorización       | Dentro de la transacción del comando, en el mismo acto que la anula (`consumed_by_command_id`). Una autorización que sobrevive a su comando es un permiso permanente, y pedir un gerente solo tiene sentido si autoriza **un** acto                                                                                                      |
| Segundo camino                 | `merchant.cancel_sent_cart_line(..., p_forced boolean default false)`. Sin forzar, la regla de `019` intacta; forzado, admite `preparing`/`ready`. La llamada de ocho argumentos sigue funcionando                                                                                                                                       |

## Merma y dinero: qué pasa con la cuenta

Un cancelado **se deja de cobrar**, y eso ya era así antes de esta decisión:

- La línea comercial se anula (`order_item.voided_at` + `void_reason`) y `merchant.order_total`
  suma **solo líneas vivas** (`voided_at is null`): el total de la cuenta baja en el acto.
  Un descuento colgado de una línea anulada cae con ella.
- La línea del carrito se borra, así que el till deja de mostrarla.
- El ingreso real es `merchant.payment`: una línea anulada antes de cobrar nunca llega a
  ser venta.

Lo que **nuevo** aporta esta decisión es poder decir cuándo un cancelado fue **merma**:
el renglón de cocina ya se estaba haciendo. Ese hecho viaja en el evento de cocina como
`afterPreparationStarted` (`merchant.kitchen_event.safe_payload`), junto al motivo que ya
se guardaba. No se añadió ninguna columna a propósito: «¿esto se alcanzó a hacer?» se
deriva del estado anterior del renglón, y el evento ya guarda de qué estado se movió.
El mismo `kitchen_order_item` queda en `cancelled` y el KDS lo pinta tachado, para que
nadie siga cocinando.

Dos cosas, y la segunda es una decisión de alcance: el dueño pidió **no construir nada de
mermas por ahora** (2026-10-12). El dato se sigue escribiendo —cuesta cero y es la única
forma de poder distinguir después una corrección de un platillo tirado— pero no hay
reporte ni UI encima. Y sin inventarios la merma **no** tiene costo: se sabe que un
platillo se tiró, no cuánto costó. Cuando se quiera, el reporte se arma con
`kitchen_event.safe_payload->>'afterPreparationStarted'` + `kitchen_order_item.product_name`

- el costo de receta.

## Lo que NO se hace

- **No** se permite editar la línea enviada ni con PIN: la edición silenciosa de algo que
  la cocina ya leyó es lo que Toast solo admite en modificadores y marcándolo «CHANGED».
- **No** se reanuda una línea anulada después de que el registro diario se cerró.
- **No** hay reporte de merma (decisión del dueño, 2026-10-12): el hecho se registra, el
  reporte no se construye.
- **No** se le dio la permisión al cajero ni al gerente: la tiene solo `admin`. Si el
  negocio quiere sumar al `owner` —hoy sin ella— es una línea en
  `config/umipos-pilot-role-grants.json` y regenerar el RBAC.
- **No** se resuelve todavía la cuenta de un día anterior: la línea ya no se cancela y la
  salida es cobrarla o el cierre del día (`manual`/`auto_void`), pero el candado del cierre
  diario sigue pendiente, así que hoy esa cuenta se queda listada y esperando a una
  persona. Es el siguiente paso natural, con el cierre de caja.
