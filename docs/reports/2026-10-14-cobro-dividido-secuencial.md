# Cobro dividido secuencial en el POS

Fecha: 14 de octubre de 2026. Entorno de prueba: ONCA local. Este cambio usa la misma API y la misma base `umi_local`; el APK final de esta entrega es `0.1.0+113`. El `+110` permitió el recorrido de cobro real; el `+111` ajustó la pantalla de preparación; el `+112` muestra los datos bancarios al elegir transferencia en un cobro dividido; y el `+113` mejora el encabezado de ese modal.

## Decisión y alcance

La pantalla anterior armaba dos medios dentro de un solo cobro. El nuevo flujo registra cada abono confirmado contra una sola cuenta y muestra siempre el total del consumo, lo pagado, lo pendiente y el historial. El operador puede escribir un importe desigual o usar un atajo de partes iguales; la propina pertenece al abono que se está cobrando. El saldo lo calcula la API a partir de los pagos persistidos. Cuando llega a cero, el POS cierra la venta con los mismos tramos del historial.

La elección sigue la [investigación de Fudo, Parrot, Soft Restaurant y Consul Rest](../research/2026-10-14-cobro-dividido-pos-mexico/README.md). El atajo «Por productos» quedó fuera: registrar sólo un monto calculado con productos, sin persistir qué artículos asumió cada persona, permitiría seleccionarlos de nuevo en el siguiente abono. Se puede incorporar con un ledger de asignaciones de ítems.

El primer abono fija la comanda hasta cerrar la cuenta; el POS lo advierte antes de aceptarlo. Cada abono tiene un identificador e idempotencia propios. Si se pierde la respuesta, la pantalla consulta el ledger antes de permitir otro cobro. Un resultado externo incierto bloquea nuevos abonos hasta resolverse con evidencia. Las restricciones de permisos, propina, efectivo y medios mixtos se validan en la API.

## Herramientas y fuentes

Flutter 3.47.5 / Dart 3.13.4 se usaron para la UI y sus pruebas de widgets. La [referencia oficial de Flutter CLI](https://docs.flutter.dev/reference/flutter-cli) indica `flutter analyze` y `flutter test`; su [guía de pruebas](https://docs.flutter.dev/testing/overview) distingue las pruebas de widgets de las verificaciones en el dispositivo real. PostgreSQL 17.10 almacena los tramos y protege la tabla con RLS, siguiendo el patrón de migraciones numeradas del repositorio. ADB 1.0.41 instala el APK y captura la iMin; la [documentación oficial de Android](https://developer.android.com/tools/adb) describe `adb exec-out screencap -p`. Para la pantalla fugaz de acceso se grabó la iMin con `adb screenrecord` y se extrajo un fotograma con FFmpeg n9.0.2; su [documentación oficial](https://ffmpeg.org/ffmpeg.html) recomienda `-ss` y `-frames:v` para extraer un fotograma puntual. `pnpm` 10.29.3 ejecuta contrato/API, y Prettier 3.9.4 formatea este Markdown, como exige `AGENTS.md`.

El saldo, la idempotencia y el asiento de efectivo se implementaron en el servicio y repositorio existentes. No se agregó dependencia ni se hizo un cálculo manual en el cliente: el servidor conserva el estado que debe sobrevivir a un reinicio o a otra terminal.

## Contrato, base y caja

El contrato POS pasa a `2.36.0` con lectura y escritura de abonos por cuenta. La migración [`036_checkout_partial_payments.sql`](../migration/build-v3/migrations/036_checkout_partial_payments.sql) agrega el ledger de abonos, posición de hasta 32 tramos y RLS por comercio y sucursal. Se aplicó varias veces a `umi_local` con el mismo comando para comprobar que es re-ejecutable:

```sh
docker exec -i umi-bv3-pg psql -U postgres -d umi_local -v ON_ERROR_STOP=1 < docs/migration/build-v3/migrations/036_checkout_partial_payments.sql
```

La ejecución final se hizo de forma atómica, después de quitar los delimitadores de transacción internos de la migración para cumplir el comprobador del repositorio:

```sh
docker exec -i umi-bv3-pg psql -U postgres -d umi_local -v ON_ERROR_STOP=1 --single-transaction < docs/migration/build-v3/migrations/036_checkout_partial_payments.sql
```

La migración se aplicó cuatro veces sin error; en las repeticiones los objetos existentes se conservaron. Se comprobó en la base que `api` y `worker` pueden leer/insertar/actualizar, pero no borrar; `readonly` no puede leerla. RLS y `FORCE ROW LEVEL SECURITY` están activos. Un trigger impide editar o borrar importes confirmados. Cada pago en efectivo se asienta en el turno abierto que lo recibe y el cierre final comprueba esos asientos para evitar duplicados.

## Verificación

- **Antes:** la [captura real de la iMin](evidence/2026-10-14-cobro-dividido/imin-antes-cobro-dividido.png) muestra que «Dividir el pago» pedía elegir un segundo método antes de cobrar.
- **POS:** `flutter analyze` sin hallazgos; 60 pruebas focales de checkout y las 955 pruebas de la suite completa verdes. Se agregó `test/partial_checkout_test.dart` con siete casos de importe desigual, propina, recuperación e incertidumbre. `test/money_format_test.dart` se actualizó para permitir seis prellenados numéricos de campos editables; los saldos visibles siguen pasando por `formatMinorUnits`. Las pruebas existentes `test/checkout_test.dart` y `test/checkout_point_tender_test.dart` siguieron verdes sin cambios.
- **Contrato y API:** 86/86 pruebas de contrato, 81/81 del checkout focal y 1/1 de integración contra `umi_local` verdes; compilación de API verde. La suite completa de API tuvo 1941 aciertos y cuatro fallos ajenos a este cambio: forma de las migraciones 029, 033 y 035 y publicación de los códigos `FCM_NOT_CONFIGURED`/`VALIDATION_ERROR`. El typecheck aislado de la API conserva dos errores previos de nulabilidad en `pos-hardware.repository.spec.ts`; la compilación de la aplicación sí pasó.
- **Dispositivos:** `+110` se instaló en iMin D3, A9 (KDS) y A11 (POS portátil), con `versionCode=110` comprobado por `dumpsys package`. En la iMin se cobró la cuenta 182 de Mesa 7 por $90 con tres tramos **desiguales** en efectivo: $40, $30 y $20. [Primer abono](evidence/2026-10-14-cobro-dividido/imin-110-primer-abono.png), [tres abonos y saldo cero](evidence/2026-10-14-cobro-dividido/imin-110-tres-abonos.png) y [venta cerrada](evidence/2026-10-14-cobro-dividido/imin-110-venta-cerrada.png). Las tablets iniciaron en una pantalla de reintento cuando aún estaban bloqueadas; desbloqueadas y reiniciadas llegaron a PIN. La bitácora Flutter registró `readyForAuthentication` en ambas; el primer arranque había registrado `apiUnavailable`. El APK final `+111` se instaló después en los tres equipos: `versionCode=111` y `versionName=0.1.0` verificados por `dumpsys package`; las capturas muestran [iMin](evidence/2026-10-14-cobro-dividido/imin-111-acceso.png), [A9](evidence/2026-10-14-cobro-dividido/a9-111-acceso.png) y [A11](evidence/2026-10-14-cobro-dividido/a11-111-final.png) en la pantalla de PIN. No se ejecutó el cobro dividido en las tablets: la prueba de operación real fue en la iMin.
- **API y base:** el [log de la API](evidence/2026-10-14-cobro-dividido/api-cuenta-182.jsonl) registra tres `POST /partial-payments` con 201 y los dos pasos de `/checkout` con 201. Las [filas consultadas](evidence/2026-10-14-cobro-dividido/db-cuenta-182.txt) muestran tres pagos confirmados de 4000, 3000 y 2000 centavos, tres asientos de caja en el mismo turno por 9000 centavos en total, una sola venta confirmada y cero asientos duplicados al cierre.
- **Preparación del terminal:** por pedido posterior del dueño, las pantallas de carga de acceso ahora muestran sólo `umi`, sin el ícono ni «Estación». La [captura real de la iMin con `+111`](evidence/2026-10-14-cobro-dividido/imin-111-preparando-umi.png) muestra la carga sin esos elementos. La pantalla de PIN conserva su diseño. `flutter analyze` y las 36 pruebas focales de acceso pasaron; la suite POS completa volvió a pasar 955/955. `pos_type_and_entry_test.dart` cambió de premisa para comprobar explícitamente el texto, la ausencia de marca gráfica y la legibilidad hasta 200%.

Durante el cierre se cayó la Wi‑Fi local y la computadora pasó brevemente al hotspot del iPhone (`172.20.10.2`). Se compiló un `+112` temporal con esa dirección, **sin instalarlo** en ninguna terminal. Volvió la red original: la computadora recuperó `192.168.1.9`, `/health/release` respondió 200 y las tres terminales volvieron por ADB. La A11 cambió su puerto ADB a `46475`; la [captura tras recuperar la red](evidence/2026-10-14-cobro-dividido/a11-111-red-restaurada.png) muestra su PIN. Se volvió a compilar `+111` con `http://192.168.1.9:4001`. Los ajustes posteriores de transferencia produjeron el `+112` y el `+113` con esa misma URL. El `+113` es el APK que quedó en `build/app/outputs/flutter-apk/app-profile.apk`.

## Ajuste posterior: transferencia en cobro dividido

Al tocar «Transferencia» en cobro dividido ahora se abre la misma ficha bancaria del cobro normal, con logo, banco, titular, CLABE, concepto y **el importe exacto de ese abono**. «Cerrar» conserva el método anterior; «Usar transferencia» sólo selecciona el método y no registra el pago. La ficha se puede volver a abrir para consultar un importe editado. El flujo reutiliza `BankTransferDialog` y los datos de la política del checkout; no agrega una copia de la UI ni cambia API, contrato o base.

`flutter analyze` terminó sin hallazgos. Las 61 pruebas focales de `partial_checkout_test.dart`, `checkout_test.dart` y `checkout_point_tender_test.dart` pasaron, así como las **956 pruebas** de la suite POS. La nueva prueba de widget comprueba la ficha real, el importe de consumo más propina, la cancelación, la reapertura tras editar el importe y que consultar la ficha no envía un cobro.

El APK `0.1.0+112` se compiló en perfil con `UMIPOS_API_BASE_URL=http://192.168.1.9:4001`, se instaló en iMin, A9 y A11 y `dumpsys package` confirmó `versionCode=112` en las tres. En la iMin se abrió la cuenta 141 de Mesa 1, se entró a «Dividir el pago» y se tocó «Transferencia»: la [captura real del modal](evidence/2026-10-14-cobro-dividido/imin-112-transferencia-dividida.png) muestra ONCA, el importe MXN 90.00 y los datos **de prueba, no aptos para transferir**. El [log de la API](evidence/2026-10-14-cobro-dividido/api-cuenta-141-modal.txt) muestra la lectura de la política y de la cuenta; tras seleccionar el método se canceló el borrador de checkout, sin `POST /partial-payments`. La consulta a `merchant.pos_partial_payment` para el carrito de esa cuenta devolvió cero filas. No se simuló un abono bancario real ni se repitió el recorrido visual en las tablets: allí se verificó la instalación.

## Ajuste visual del modal

El dueño pidió quitar el fondo azul del encabezado. En tema claro, el logo ahora tiene un borde fino, el nombre usa tinta negra y el subtítulo usa gris; una línea separa el encabezado del importe. En tema oscuro se usan los colores de texto y borde de `PosThemeData`. El modal conserva `PosAlertDialog`, componente propio en `apps/umi-pos/lib/core/theme/pos_ui.dart`, sobre Flutter 3.47.5. Se verificó con `flutter analyze` y `flutter test`, como indica la [guía oficial de Flutter](https://docs.flutter.dev/testing/overview). No se creó un componente nuevo para un cambio de estilo local.

El `+113` se instaló en iMin, A9 y A11; `dumpsys package` devolvió `versionCode=113` en las tres. La [captura anterior](evidence/2026-10-14-cobro-dividido/imin-112-transferencia-dividida.png) y la [captura nueva de la iMin](evidence/2026-10-14-cobro-dividido/imin-113-transferencia-sin-azul.png) muestran el cambio en la misma cuenta 141. `flutter analyze` no tuvo hallazgos; pasaron las 61 pruebas focales de cobro y las 956 pruebas del POS. Se cerró el modal sin registrar un pago. No se comprobó el tema oscuro en un dispositivo real ni se repitió el recorrido visual en las tablets.

## Límites que quedan

El cobro parcial en esta primera entrega admite efectivo, terminal externa confirmada por un operador y transferencia confirmada con referencia. El cobro integrado con tarjeta conserva su flujo de cuenta completa: no se afirma que un abono parcial haya sido capturado por el proveedor. El diario de caja puede mostrar un abono previo al cierre sin folio de venta, porque la consulta que construye esa fila vive en `apps/umi-api/src/modules/pos-cash/pos-cash.repository.ts`, archivo que el dueño pidió no tocar. Su asiento y su vínculo con la cuenta sí persisten mediante `tender_fact_id`.

No se ejecutó un cargo bancario real ni se desplegó a staging o producción. Antes de desplegar la API en cada entorno debe aplicarse la migración 036 a su propia base. En la cuenta 182, el estado de la mesa permaneció `ordered` después de cerrar la venta; este ciclo no cambió la política de liberación de mesas.
