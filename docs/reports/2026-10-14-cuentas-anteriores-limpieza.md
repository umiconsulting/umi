# Cuentas de un día anterior: aviso y limpieza local

Fecha: 2026-10-14. Comercio: ONCA. Entorno: desarrollo local.

## Resultado

El aviso de nueve cuentas desaparecía porque la lista usaba la fecha operativa de la cuenta activa. Esa cuenta también era del 13 de octubre. La lista clasificaba las demás cuentas del 13 como cuentas de hoy. Las cuentas seguían abiertas en la API y en Postgres.

La lista comprueba ahora que la fecha de la cuenta activa corresponde al día operativo actual. Si esa fecha es anterior, usa la hora local y el límite operativo de las 04:00. Esta hora coincide con la configuración actual de ONCA. La fuente de la fecha operativa aún debe llegar de la API para comercios con otra hora de inicio.

Se anularon las nueve cuentas visibles del 13 de octubre: 131, 141, 143, 144, 146, 150, 152, 153 y 173. Ninguna tenía pago parcial ni venta comprometida. El POS registró el motivo `other` y la nota `Cierre de periodo anterior, sin pago`. Las cuentas 123 y 132 eran borradores vacíos del mismo día. La lista las excluía porque no tenían mesa, nombre ni productos. Se anularon con una actualización SQL condicionada a la ausencia de productos, pagos, venta y borrador de cobro. Se conservaron los registros y el motivo de cancelación.

La cancelación abría un folio vacío nuevo para el administrador. El POS deja ahora la Comanda sin cuenta activa después de cancelar una cuenta abierta. Se probaron ambos caminos: administrador y operador con autoridad de carrito. La cuenta vacía 189, creada durante la comprobación del defecto, también quedó anulada. La 190 no se creó.

Las mesas 1, 3 y 6 seguían ocupadas después de anular sus cuentas. Se usó **Liberar mesa** en la iMin. Quedaron en estado `dirty` y sin personas sentadas. Quedan listas para la comprobación y limpieza física del personal. No se cambió el estado de las demás mesas.

La consulta final de ONCA dio **0** carritos con fecha anterior al 14 de octubre y estado `draft` o `prepared`. Las cuentas 185 y 186 pertenecen al día actual y siguen abiertas. No formaban parte del aviso.

## Causa de la recurrencia

ONCA tiene `merchant.merchant.pos_day_close_policy = 'manual'`. El barrido `auto_void` de la API no se ejecuta con esa política. Además, el barrido actual excluye las cuentas `suspended`. Cambiar sólo el valor a `auto_void` no resolvería las cuentas guardadas. No se cambió la política en este ciclo. Hace falta una decisión e implementación del cierre de día que incluya las cuentas guardadas, la auditoría comercial y el estado de cocina.

## Verificación y evidencia

- Flutter 3.47.5 y Dart 3.13.4: `flutter analyze` sin hallazgos; pruebas de cuentas y ciclo de venta: 95 correctas; suite completa del POS: **959 correctas**. Log: `/tmp/umi-pos-full-2026-10-14-accounts-cleanup-115.log`. Las pruebas nuevas cubren una cuenta activa con fecha vieja y la cancelación del administrador sin folio siguiente.
- ADB 1.0.41: APK `0.1.0+115` instalado en iMin `192.168.1.10:5555`, A9 `192.168.1.14:35559` y A11 `192.168.1.13:46475`. `dumpsys package` mostró `versionCode=115` en las tres. La iMin mostró el aviso al entrar, su reducción después de cada cancelación y la lista sin cuentas anteriores al final.
- PostgreSQL `psql` 17.10: [filas finales](evidence/2026-10-14-cuentas-anteriores/pos_cart-despues.txt) y [estado de mesas](evidence/2026-10-14-cuentas-anteriores/table_state-despues.txt). La actualización SQL de las dos cuentas vacías se ejecutó con `docker exec -i umi-bv3-pg psql -v ON_ERROR_STOP=1 -U postgres -d umi_local`. La transacción usó `account_number IN (123, 132)`, fecha anterior, estado `draft` y guardas `NOT EXISTS` para productos, pagos, venta y cobro. Resultado: `UPDATE 2` y `COMMIT`. No hubo migración.
- [Peticiones de cancelación](evidence/2026-10-14-cuentas-anteriores/api-cancelaciones.jsonl) y [peticiones de mesas](evidence/2026-10-14-cuentas-anteriores/api-mesas.jsonl): respuestas HTTP 201 de la API. Los dos borradores vacíos se repararon en Postgres y por ello no tienen una petición API de cancelación.
- Capturas de la iMin: [aviso oculto antes](evidence/2026-10-14-cuentas-anteriores/aviso-oculto-antes.png), [aviso correcto](evidence/2026-10-14-cuentas-anteriores/aviso-ocho-cuentas.png), [cancelación sin nuevo folio](evidence/2026-10-14-cuentas-anteriores/cancelacion-sin-nuevo-folio.png), [lista final](evidence/2026-10-14-cuentas-anteriores/lista-sin-cuentas-anteriores.png) y [mesas liberadas](evidence/2026-10-14-cuentas-anteriores/mesas-liberadas-por-limpiar.png).

## Herramientas y fuentes

Se usaron los comandos de Flutter indicados por [apps/umi-pos/AGENTS.md](../../apps/umi-pos/AGENTS.md) y la prueba nativa indicada por [LOCAL_VERIFICATION_PLAYBOOK.md](../development/LOCAL_VERIFICATION_PLAYBOOK.md). `adb` siguió la [guía oficial de Android](https://developer.android.com/tools/adb) para instalar, lanzar y capturar la pantalla. `psql` siguió el acceso local documentado en el playbook. La regla de fecha usa el componente `operationalDayStart` existente; no se escribió otro cálculo. La actualización SQL específica fue necesaria porque los borradores vacíos no aparecen en la lista ni tienen una acción de cancelación accesible en el POS.

No se comprobó una transición real de las 04:00 ni una hora operativa distinta. No se comprobó la limpieza física de las mesas ni el tablero KDS tras estas cancelaciones. No se realizó una nueva prueba funcional en A9 o A11 después de instalar el APK; sólo se comprobó la versión instalada.
