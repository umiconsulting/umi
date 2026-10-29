# ONCA, incidente de producción 008: Caja omite Enviar a cocina

Fecha local: 27 de octubre de 2026.

## Resultado

La recuperación operativa restauró `order.fire` en la sesión de Cajero ONCA.
El rol ya tenía ese permiso. La sesión conservaba una lista anterior.
Se añadió sólo ese permiso: la lista pasó de 48 a 49 permisos.
La corrección no desplegó código ni modificó el pedido o sus productos.

Después de recargar UmiPOS, el operador pudo enviar la cuenta 016.
El propietario confirmó que el envío funcionó.
La base registra una sola comanda para esa cuenta y KDS la completó en Barra.

La cuenta 016 sigue abierta por MXN 250.00.
El propietario confirmó que todavía no la pagan.
Tiene cero intentos de pago y cero ventas registradas.
No se cobró ni se canceló la cuenta durante el soporte.

## Síntoma y evidencia inicial

La cuenta 016 del 27 de octubre pertenece a la mesa Cardón.
La pantalla mostraba líneas «Pendiente de enviar».
Mostraba **Guardar y salir**, **Dividir cuenta** y **Cobrar**, pero omitía **Enviar a cocina**.
Barra no tenía la comanda.

| Dato                           | Valor                                                  |
| ------------------------------ | ------------------------------------------------------ |
| Cuenta                         | `199ee7cf-ff8b-469f-a2e3-07c93a63aebd`                 |
| Sesión de operador             | `a567f08f-a0f2-46c5-a7f4-efc95c6f5e14`                 |
| Staff                          | Cajero ONCA, `30bb2dfc-46da-402e-a39d-599bbaa4df77`    |
| Dispositivo                    | Caja principal, `c4521c2a-6c70-4b12-9477-6110257910ff` |
| Inicio de la sesión conservada | `2026-10-26T19:30:50.010Z`                             |
| Estado inicial                 | `draft/recovered`, versión 12, sin `fired_order_id`    |

La comprobación de la pantalla reprodujo el síntoma:

```text
ORDER016_SEND_BUTTON_PROBE {"account":"016","pendingLinesVisible":true,"sendButtonVisible":false}
FAIL: pending account has no Send to kitchen
INC016_PROBE_EXIT 2
```

El script de comprobación está en
`/home/juan/.local/state/onca-support-20261027/incident-008/verify-order016-send.py`.
Es una lectura de la pantalla. No pulsa controles ni crea pedidos.

## Causa confirmada

El rol `cashier` de ONCA tiene `order.fire`.
La migración `054_onca_cashier_fire_orders.sql` ya concedió ese permiso.
`umi.resolve_staff_permissions` confirmó la concesión actual.

La sesión activa de Caja tenía `cart.write` y `checkout.commit`, pero omitía `order.fire`.
El cliente sólo muestra el botón cuando hay líneas pendientes y la sesión permite `order.fire`.
La condición está en `catalog_surface.dart`.

La recuperación de operador en `pos-entry.repository.ts` conserva la sesión anterior.
Su cálculo usa la intersección de los permisos anteriores y los permisos autorizados.
Ese cálculo retira permisos revocados, pero no incorpora una concesión nueva.
Por ello, entrar con PIN podía conservar la omisión anterior.

## Corrección operativa y auditoría

Primero se ejecutó una prueba dentro de una transacción con rollback.
La prueba exigió que la única diferencia con el rol actual fuera `order.fire`.
También comprobó la cuenta, el operador, la tablet y la vigencia de la sesión.

Después se aplicó la misma corrección en una transacción.
La operación modificó sólo la lista de permisos de esa sesión.
Las comprobaciones de hash confirmaron que la cuenta y las líneas quedaron intactas.

Auditoría:

- `runtime.security_audit_event`: `operator.permissions_reconciled`.
- Motivo: `stale_operator_permissions`.
- Request ID: `onca-008-permissions-20261027`.
- `merchant.audit_log` conserva las listas antes y después.
- La auditoría identifica la intervención como soporte administrativo.

Se recargó UmiPOS para obtener la lista corregida.
No se leyó ni se registró el PIN del operador.
No se cerró el turno de caja.

## Flujo real después de la corrección

El operador envió la cuenta a las `2026-10-27T19:17:43.166Z`.
Las cuatro líneas quedaron enlazadas con sus líneas de pedido:

| Producto     | Cantidad | Requiere preparación según catálogo |
| ------------ | -------: | ----------------------------------- |
| Dirty chai   |        1 | Sí                                  |
| Moca         |        1 | Sí                                  |
| Coricos pack |        1 | No                                  |
| Chocorico    |        5 | No                                  |

KDS recibió las dos bebidas, según la configuración del catálogo.
Las cuatro líneas comerciales conservan su relación con el pedido.
La primera comprobación esperaba cuatro líneas KDS.
Se corrigió ese criterio después de leer `requires_preparation`; no se cambió el catálogo.

| Entidad          | Identificador                                 |
| ---------------- | --------------------------------------------- |
| Pedido           | `e1c716f0-2144-496a-88b2-e6e57f7ae092`        |
| Comanda KDS      | `43cd98e6-c775-44a8-b0ae-5bb1ba70a2a5`        |
| Referencia       | Cuenta 016 · Cardón                           |
| Estación         | Barra, `81fff2aa-705d-48bb-b75d-7406ca36acb4` |
| Estado KDS final | `completed`, versión 5                        |
| Finalización KDS | `2026-10-27T19:18:10.202Z`                    |

El propietario informó que ya habían preparado el pedido por otra vía.
Barra registró la finalización. El soporte no creó otra comanda.
La cuenta quedó apartada, con estado `draft/suspended` y versión 14.
Ese estado conserva la cuenta pendiente para cobrar después.

También se verificó que el operador creó la cuenta 017 mientras la 016 seguía abierta.
La creación de otro pedido no exigió cobrar ni cancelar la 016.

## Verificación final

La lectura final comprobó una sola comanda y las líneas comerciales enviadas.
Las dos bebidas figuran `ready` y tienen `station_completed_at`.
La sesión conserva `order.fire` y todos sus permisos pertenecen al rol actual.
El diagnóstico terminó con código 0 en las cuatro tablets, con build 333.

Evidencia:
[cuentas 016 y 017](./evidence/2026-10-27-onca-incident-008/verification-final.json) y
[doctor final](./evidence/2026-10-27-onca-incident-008/doctor-final.json).

## Límites y prevención

La recuperación no cambió el algoritmo de permisos de la API.
Cuando se amplíe un rol, compara sus permisos con los de las sesiones activas.
No supongas que volver a entrar con PIN siempre incorpora la concesión nueva.
Una corrección futura de ese algoritmo debe conservar la retirada de permisos revocados.

El soporte no verificó un cobro de la 016: sigue pendiente de pago por instrucción del propietario.
El reporte de cobro de la 017 se registra en el [incidente 009](./2026-10-27-onca-production-bug-009.md).
