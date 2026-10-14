# Nueva cuenta después de cancelar una cuenta reanudada

Fecha: 14 de octubre de 2026. Entorno: ONCA local. APK final: `0.1.0+121`.

## Resultado

Al reanudar una cuenta, el POS muestra **Guardar y salir**. Antes, ese botón también aparecía en una cuenta nueva si el operador cancelaba la cuenta reanudada y después tocaba **Nueva venta** dentro de la Comanda. La causa era `_editingAccount`: una marca local que seguía activa después de que el controlador limpiaba la cuenta cancelada. El botón de **Nueva venta** del panel llama directamente al controlador de ventas y no pasa por `_newSale`, que era uno de los lugares donde se limpiaba la marca.

La marca ahora guarda el ID de la cuenta reanudada. El panel sólo muestra **Guardar y salir** cuando el ID de la cuenta actual coincide. Se conserva el botón mientras se edita la cuenta reanudada y desaparece al cancelar o abrir otra cuenta. No se cambió la lógica comercial de cancelación, los permisos, la API ni la base.

## Herramientas y decisión

Se usaron Flutter **3.47.5**, Dart **3.13.4**, `flutter_test` del SDK y ADB **37.0.0**. [AGENTS del POS](../../apps/umi-pos/AGENTS.md) define Flutter nativo como el producto que se debe verificar. El [playbook local](../development/LOCAL_VERIFICATION_PLAYBOOK.md) indica usar pruebas de Flutter y clics reales en Android. `rg` localizó los dos caminos de **Nueva cuenta/Nueva venta**; `apply_patch` hizo los cambios. La comparación del ID usa el estado existente del carrito. No requiere una dependencia ni otro estado persistente.

## Verificación

- La nueva prueba de `order_entry_flow_test.dart` recorre **Cuentas → Lista → reanudar → cancelar → Nueva venta**. Falló antes del cambio porque encontró **Guardar y salir** en la cuenta nueva. Pasó después del cambio.
- `flutter analyze`: sin hallazgos. `flutter test`: **972/972** pruebas aprobadas. Log: `/tmp/umi-pos-resumed-cancel-new-121-full-test.log`. `dart format --output=none --set-exit-if-changed` confirmó los dos archivos.
- Se compiló un solo APK profile `0.1.0+121`. `adb install -r` devolvió **Success** en iMin, A9 y A11. `dumpsys package` confirmó `versionCode=121` en las tres.
- En la iMin se añadió un Americano limón mineral a la cuenta 206, se guardó, y luego se reanudó desde Lista. La [captura de la cuenta reanudada](evidence/2026-10-14-cuenta-reanudada-cancelada/imin-121-cuenta206-reanudada.png) muestra **Guardar y salir**. Se canceló con el motivo `other` y el texto `Prueba regresion 121`. Después se tocó **Nueva venta** dentro de la Comanda. La [captura de la cuenta 207](evidence/2026-10-14-cuenta-reanudada-cancelada/imin-121-nueva-cuenta-despues.png) muestra que el botón ya no aparece.
- La cuenta 207 era una cuenta vacía creada sólo para esta prueba. Se canceló con el texto `Prueba regresion 121 Cuenta 207`. La [pantalla final](evidence/2026-10-14-cuenta-reanudada-cancelada/imin-121-cuenta207-cerrada.png) quedó sin cuenta activa. La base confirma `206|abandoned|cancelled|1` y `207|abandoned|cancelled|0` para número, estado, ciclo y cantidad de líneas. El log `/tmp/umi-api-4001.log` registra los dos `POST /sales/:id/cancel` con estado **201** a las `17:00:06Z` y `17:00:51Z`.

La iMin cubrió el recorrido real. En A9 y A11 se verificaron instalación, lanzamiento y versión; no se repitió este flujo de caja en esas tabletas. `order_entry_flow_test.dart` ya estaba sin seguimiento en el árbol compartido antes de esta corrección y debe incluirse al preparar un commit.
