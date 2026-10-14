# La comanda no aceptaba nada: la cuenta estaba suspendida en otra pantalla

Fecha: 2026-10-13. Compilación: Flutter nativa 0.1.0 build 71.
Paquete: `co.umiconsulting.umi_pos.estacion`. API local: `:4001`. Contrato: `2.34.0`.
Dispositivos: iMin D3 (`192.168.1.10:5555`), tablet A9 (`192.168.1.14:35559`) y A11
(`192.168.1.13:35975`), las tres con el build 71.

## El síntoma, medido

En el iMin, la comanda mostraba la Cuenta 073 (mesa T1, 2 partidas, MXN 150.00) y **ninguna
acción hacía nada**: ni agregar producto, ni eliminar línea, ni «Vaciar cuenta». El botón
parecía muerto — sin petición, sin mensaje nuevo, sin cambio en pantalla. La única salida era
reiniciar la app.

La primera lectura del log fue engañosa: el filtro buscaba `POST` y el borrado de línea viaja
como `DELETE`. El filtro correcto —todas las peticiones del periodo— muestra que el till **sí
mandaba** cada acción y el servidor **la rechazaba**:

| Hora (UTC) | Petición del till              | Respuesta                    |
| ---------- | ------------------------------ | ---------------------------- |
| 09:16:45   | `POST /cart/suspend`           | `409 CART_VALIDATION_FAILED` |
| 09:17:20   | `POST /cart/clear`             | `409 CART_VALIDATION_FAILED` |
| 09:18:21   | `POST /cart/clear`             | `409 CART_VALIDATION_FAILED` |
| 09:18:55   | `POST /cart/clear`             | `409 CART_VALIDATION_FAILED` |
| 09:19:14   | `DELETE /cart/lines/292dd7e7…` | `409 CART_VALIDATION_FAILED` |

## La causa

`merchant.pos_cart 073` tenía `lifecycle_state = 'suspended'` desde las 08:33:51, suspendida por
la ruta heredada `POST /sales/584e1a63…/suspend` (mismo `uuid` que el carrito). El guardia que
**todo** escrito del carrito comparte exige `lifecycle_state IN ('building_cart',
'ready_for_checkout','recovered')` ([`bump()`](../../apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts:1381)),
así que una cuenta suspendida no acepta ninguna escritura. El till, sin embargo, seguía
mostrándola como su cuenta actual: la suspensión llegó desde otra superficie y el panel de
comanda nunca se enteró.

El segundo defecto es el mensaje. `CART_VALIDATION_FAILED` cubre dos hechos distintos —un
producto que no se puede pedir y una cuenta que ya no admite escrituras— y el till los traduce
igual: _«No se agregó: el producto no está disponible en esta sucursal o la cuenta cambió»_.
Para «Vaciar cuenta» esa frase no cambia nada en pantalla, y por eso el botón se lee como roto.

## El arreglo

El till deja de sostener una cuenta que el servidor ya no acepta, y lo hace **verificando**, no
suponiendo (`CART_VALIDATION_FAILED` también es la negativa normal de un producto):

1. Ante un `CART_VALIDATION_FAILED`, el controlador del carrito relee la cuenta
   ([`cart_controller.dart`](../../apps/umi-pos/lib/features/cart/cart_controller.dart:751)).
2. Si la relectura dice que la cuenta sigue siendo suya y escribible, no toca nada: es el caso
   del producto no disponible.
3. Si dice que está `suspended`, `committed` o `cancelled` —o que ya no existe— suelta la
   comanda y publica `CART_ACCOUNT_CLOSED`.
4. La pantalla dice la verdad y desbloquea el siguiente paso: el aviso nombra la causa real, se
   limpió el estado de edición y el controlador de ventas olvida la venta, porque mientras creía
   que había una venta en curso también rechazaba «Nueva cuenta» —el callejón se cerraba por los
   dos lados
   ([`catalog_surface.dart`](../../apps/umi-pos/lib/features/catalog/catalog_surface.dart:859)).

Mensaje nuevo, en
[`operator_error_message.dart`](../../apps/umi-pos/lib/core/errors/operator_error_message.dart:183):
_«Esta cuenta ya se guardó o se cerró desde otra pantalla. La comanda quedó libre: ábrela de
nuevo desde Cuentas si quieres seguir con ella.»_

### El aviso se quedaba pegado

Primera verificación en el aparato: el aviso salió, la comanda quedó libre, el operador abrió una
cuenta nueva… y **el aviso rojo siguió ahí**, sobre una comanda vacía y sana. El usuario lo vio
antes que yo: _«¿por qué sigue saliendo el mensaje de rojo?»_.

La barra está diseñada para quedarse «hasta que el operador haga otra cosa» —es lo que promete el
propio widget—, pero nadie la retiraba cuando esa otra cosa ocurría. Ahora la barra recuerda el
código que la levantó y se va cuando el carrito dice que está sano (`phase == ready`, sin
`errorCode`, con cuenta), que es exactamente la negación del hecho que la puso ahí
([`catalog_surface.dart`](../../apps/umi-pos/lib/features/catalog/catalog_surface.dart:678)). Si
otro mensaje ocupó la barra, el aviso viejo no se lleva por delante al nuevo: se compara el texto
contra el del código que lo levantó antes de tocarlo.

## Comprobaciones

- Tres pruebas nuevas de controlador
  ([`cart_closed_account_test.dart`](../../apps/umi-pos/test/cart_closed_account_test.dart)): la
  cuenta suspendida se suelta y se explica; la cuenta que sigue siendo del till conserva su lugar;
  la cuenta que ya no existe también se suelta.
- Una prueba de interfaz nueva
  ([`cart_layout_test.dart`](../../apps/umi-pos/test/cart_layout_test.dart)): la barra del aviso
  aparece con el rechazo y desaparece cuando el till vuelve a estar sano. Comprobada por mutación:
  sin el arreglo, la prueba falla.
- Suite completa del POS: **849 pruebas aprobadas** (845 antes de los cambios).
- Análisis estático de los tres archivos modificados: sin incidencias.
- APK ARM64 en modo profile (build 71) instalado en iMin, A9 y A11.

### Verificación en el aparato

Se reprodujo la condición en el iMin: cuenta abierta con una partida y, con el till sosteniéndola,
la fila quedó en `suspended` —el mismo estado que dejó el otro camino—. Después, en el till:

1. Tocar un producto de la carta → el servidor responde `409` y el till relee la cuenta
   (`GET /cart/account…` 200). Aparece el aviso nuevo y la comanda queda vacía con «Nueva venta».
2. «Nueva venta» → crea la Cuenta 075 (`POST /sales` 201) y el till vuelve a operar.
3. Agregar un producto → `POST /cart/lines` 201, la partida entra como «Pendiente de enviar».
4. **Vaciar cuenta → «Vaciar comanda»** → `POST /cart/clear` 201 y el total vuelve a MXN 0.00,
   que es justo lo que no se podía hacer.
5. Repetida la condición con el build 71: el aviso sale al recibir el `409`, y tras «Nueva venta»
   —que abrió la Cuenta 076— **el aviso ya no está en pantalla**.

## Pendiente, por decisión del usuario

- La Cuenta 074 quedó suspendida con un Capuccino de esta verificación (la puso el diagnóstico, no
  el flujo normal). Se puede borrar o dejar como caso de prueba.
- Las Cuentas 073, 072, 071 y anteriores siguen suspendidas desde la sesión del usuario.
- El guardia de una sola cuenta activa por operador (`CART_ACCOUNT_BUSY`) no se tocó: eso es el
  paso 1 de la investigación de pausa y sigue esperando su respuesta.
