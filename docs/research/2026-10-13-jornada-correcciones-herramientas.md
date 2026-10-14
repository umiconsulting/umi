# Herramientas para corregir la jornada de operación

Fecha: 2026-10-13. Alcance: diagnóstico y pruebas del reporte de las tres terminales.

## Decisión antes de implementar

**Inferencia para Umi:** utiliza las herramientas existentes. No agregues otro ejecutor, transporte ni base para estas correcciones.

| Pregunta                          | Respuesta                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| ¿Existe una herramienta probada?  | Flutter Test, Vitest, Playwright, ADB y psql cubren las comprobaciones.                            |
| ¿Está instalada?                  | Sí. Flutter y Dart requieren su ruta absoluta en esta sesión.                                      |
| ¿Permite ejecución sin preguntas? | Sí. Los comandos de pruebas y las conexiones existentes permiten automatización.                   |
| ¿Cuál es el costo?                | No requieren una dependencia nueva. Las pruebas deben reutilizar las configuraciones del monorepo. |
| ¿Cuál es el respaldo?             | Usa los registros, la consulta SQL y la captura nativa cuando el árbol de accesibilidad falle.     |

## Versiones comprobadas

**Hecho documentado por la instalación local:** las versiones siguientes provienen de comandos o metadatos instalados. No representan la última versión disponible.

| Herramienta                      | Versión local                          | Licencia                           | Fuente y mantenimiento                                                                                                                                                                                                                      |
| -------------------------------- | -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flutter / Flutter Test           | 3.47.5, estable; revisión `6a19cca564` | BSD de tres cláusulas              | SDK local; [documentación oficial de pruebas](https://docs.flutter.dev/testing/overview). Canal estable observado.                                                                                                                          |
| Dart                             | 3.13.4                                 | BSD de tres cláusulas              | SDK local; [referencia oficial DateTime](https://api.dart.dev/dart-core/DateTime-class.html). SDK incluido en Flutter.                                                                                                                      |
| fake_async / clock               | 1.3.3 / 1.1.2                          | BSD de tres cláusulas              | `apps/umi-pos/pubspec.lock`; [paquete oficial fake_async 1.3.3](https://pub.dev/packages/fake_async/versions/1.3.3). Ya disponible; sin actualización propuesta.                                                                            |
| Vitest, API y dashboard          | 2.1.9                                  | MIT                                | Metadatos locales; [fuente oficial fijada a 2.1.9](https://raw.githubusercontent.com/vitest-dev/vitest/v2.1.9/docs/api/vi.md). Versión existente; soporte actual de esta versión: NO VERIFICADO.                                            |
| Playwright Test                  | 1.62.1                                 | Apache-2.0                         | CLI y metadatos locales; [documentación oficial](https://playwright.dev/docs/intro). Versión existente; sin actualización propuesta.                                                                                                        |
| PostgreSQL / psql del contenedor | 17.10                                  | PostgreSQL License                 | `select version()` en `umi-bv3-pg`; [documentación 17](https://www.postgresql.org/docs/17/) y [licencia](https://www.postgresql.org/about/licence/). La documentación clasifica 17 como versión soportada.                                  |
| ADB                              | 37.0.0-android-tools; protocolo 1.0.41 | Apache-2.0 y avisos de componentes | `adb version`; [Android Developers](https://developer.android.com/tools/adb) y [NOTICE del proveedor](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/NOTICE). Versión local; sin actualización propuesta. |
| Prettier                         | 3.9.4                                  | MIT                                | CLI y metadatos locales. Formateador existente para los markdown.                                                                                                                                                                           |

**Hecho documentado por la instalación local:** Node es `24.21.0`; pnpm es `10.29.3`. El dashboard declara Node `22.x` y pnpm imprime una advertencia de compatibilidad.

**Hecho documentado por el repositorio:** la API usa `vitest run`. Jest no está instalado ni aparece como ejecutor en su `package.json`.

```sh
/home/juan/.local/opt/flutter/bin/flutter --version
/home/juan/.local/opt/flutter/bin/dart --version
pnpm --filter @umi/api exec vitest --version
pnpm --filter @umi/dashboard exec vitest --version
pnpm exec playwright --version
adb version
npx prettier --version
docker exec umi-bv3-pg psql -U postgres -d umi_local -Atc 'select version()'
```

## Relojes y vencimiento

**Hecho documentado:** `WidgetTester.pump(Duration)` avanza los temporizadores en el entorno de `flutter test`. [Referencia de Flutter](https://api.flutter.dev/flutter/flutter_test/WidgetTester/pump.html).

**Hecho documentado:** `fake_async` controla los temporizadores. No sustituye directamente `DateTime.now()`. Su integración con `clock` permite controlar la fecha. [Paquete 1.3.3](https://pub.dev/packages/fake_async/versions/1.3.3).

**Hecho documentado:** Vitest 2.1.9 ofrece `vi.useFakeTimers()`, `vi.setSystemTime()` y avance de temporizadores. Cambiar la fecha no dispara los temporizadores pendientes. [Fuente de la versión instalada](https://raw.githubusercontent.com/vitest-dev/vitest/v2.1.9/docs/api/vi.md).

**Hecho documentado:** Playwright permite fijar la fecha y avanzar los temporizadores del navegador. Instala el reloj antes de usar las funciones que sustituye. [Guía oficial del reloj](https://playwright.dev/docs/clock).

**Inferencia para Umi:** prueba cada umbral un segundo antes, en el límite y un segundo después. Comprueba el cambio sin otro evento del servidor.

**Inferencia para Umi:** prueba una alarma por transición. Incluye silencio persistente, reconexión, datos repetidos y una estación distinta.

## Fecha y serialización

**Hecho documentado:** Dart distingue UTC y la zona local del equipo. `toLocal()` y `toUtc()` conservan el instante. [Referencia DateTime](https://api.dart.dev/dart-core/DateTime-class.html).

**Hecho documentado:** `toIso8601String()` añade `Z` para UTC. Una fecha local no incluye ese sufijo. [Referencia de serialización](https://api.dart.dev/dart-core/DateTime/toIso8601String.html).

**Hecho documentado:** PostgreSQL almacena `timestamp with time zone` como un instante UTC. La presentación depende de la zona de la sesión. [Tipos de fecha, PostgreSQL 17](https://www.postgresql.org/docs/17/datatype-datetime.html).

**Inferencia para Umi:** comprueba el mismo instante en la fila, el JSON y el recibo. Incluye un cruce de medianoche y conserva la zona de la sucursal.

**Inferencia para Umi:** evita restar siete horas como corrección general. Primero identifica qué capa pierde o aplica la zona.

## Transacciones y concurrencia

**Hecho documentado:** `SELECT FOR UPDATE` bloquea las modificaciones y otros bloqueos de esa fila hasta que termine la transacción. [Bloqueos explícitos, PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html).

**Tradeoff respaldado por fuente:** los bloqueos protegen la fila; también pueden generar esperas y bloqueos mutuos. Mantén un orden consistente al tomar varios bloqueos. [Misma referencia](https://www.postgresql.org/docs/17/explicit-locking.html).

**Inferencia para Umi:** las pruebas de mover, dividir, transferir y cobrar deben verificar invariantes comerciales. Usa dos conexiones para probar conflictos reales.

**Inferencia para Umi:** confirma una sola venta y un solo movimiento ante dos solicitudes iguales. Comprueba capacidad, cuenta, operador y revisión después de cada operación.

## Diálogos y pantalla nativa

**Hecho documentado:** Flutter recomienda contenido desplazable para un `AlertDialog` que excede la altura disponible. `Dialog` permite un control más preciso. [Referencia oficial](https://api.flutter.dev/flutter/material/AlertDialog-class.html).

**Inferencia para Umi:** conserva el componente de diálogo existente. Limita su cuerpo y permite desplazamiento antes de introducir otro sistema visual.

**Inferencia para Umi:** prueba el rechazo del PIN, el teclado abierto y texto al 200 %. El botón debe quedar visible o alcanzable y aceptar un toque.

**Hecho documentado local:** el playbook registra 1920 × 1014 píxeles útiles y densidad 1.375 en la iMin. Verifica esos valores antes de reutilizarlos. [Playbook, sección iMin](../development/LOCAL_VERIFICATION_PLAYBOOK.md#the-imin-till-over-adb).

**Inferencia para Umi:** una prueba con dimensiones lógicas equivocas puede ocultar el recorte. Usa el tamaño útil y la densidad reales de cada terminal.

## Canales consultados y límites

### Espera del tablero y conexión HTTP

**Hecho documentado:** Fastify 5.8.5 está instalado. `connectionTimeout` controla el timeout del socket.
Fuente: [referencia oficial de Fastify](https://fastify.dev/docs/latest/Reference/Server/#connectiontimeout).

**Hecho local:** la API configura 10 segundos de conexión inactiva y el tablero esperaba 12 segundos.
El cliente reintentaba antes de que terminara aquella espera. El log HTTP podía registrar 200 después del cierre del socket.

**Inferencia para Umi:** deriva la espera del límite existente y reserva dos segundos. La espera resulta de ocho segundos.
Conserva `NOTIFY` y el transporte existente. Vitest comprueba que una espera inactiva termina antes del cierre.

Se leyó la habilidad `research`, la doctrina de herramientas y el playbook de canales. Se usaron los escalones 1 y 3.

- `https://playwright.dev/docs/test-clock` falló en la herramienta web. La ruta oficial `/docs/clock` respondió.
- `https://v2.vitest.dev/api/vi.html` falló. La documentación oficial en GitHub, etiqueta `v2.1.9`, respondió.
- `flutter` y `dart` fallaron por ausencia en `PATH`. La ruta que indica `apps/umi-pos/AGENTS.md` respondió.
- No se agregó una herramienta, un servicio ni una base. No se escribió código de producto en esta investigación.
- NO VERIFICADO: estas consultas no prueban las correcciones, el sonido audible, la impresora, una operación bancaria ni la conducta durante ocho horas.

## Apéndice: aviso de cuenta ocupada después del cierre de sesión

**Herramienta elegida:** `Timer` de Dart 3.13.4 y `AppLifecycleListener` de Flutter 3.47.5. Ambos pertenecen al SDK existente, con licencia BSD de tres cláusulas.

**Hecho documentado:** `Timer.periodic` repite el callback hasta su cancelación. El intervalo real puede variar. [Referencia oficial](https://api.dart.dev/dart-async/Timer/Timer.periodic.html).

**Hecho documentado:** `Timer.cancel()` evita futuros callbacks. No cancela una petición HTTP que ya comenzó. [Referencia oficial](https://api.dart.dev/dart-async/Timer/cancel.html).

**Hecho documentado:** `AppLifecycleListener` informa las transiciones de la aplicación y ofrece `onResume`, `onPause` y `dispose`. [Referencia oficial](https://api.flutter.dev/flutter/widgets/AppLifecycleListener-class.html).

**Hecho documentado:** `setState` requiere un `State` montado. Cancelar el trabajo evita operaciones inútiles; `mounted` protege las respuestas que llegan después. [Referencia oficial](https://api.flutter.dev/flutter/widgets/State/mounted.html) y fuente local de `framework.dart`.

**Hecho local:** `CartRepository.openAccounts` usa un GET existente. `OpenAccountsList` solo carga al iniciar o al pulsar Actualizar.

**Hecho local:** `PosCartService.listAccounts` ejecuta `sweepCarriedOverAccounts` antes de listar. El GET actual tiene una posible escritura de cierre del día.

**Hecho local:** el contrato `Cart` no expone la actividad de la sesión propietaria. `claimAccount` consulta esa actividad antes de permitir la recuperación.

**Hecho local:** el canal del dispositivo expone `tender.attempt.changed`. No define un evento de liberación de cuenta ni de cierre de sesión.

Fuentes locales: `apps/umi-pos/lib/features/cart/cart_repository.dart`, `open_accounts_surface.dart`, `apps/umi-api/src/modules/pos-cart/pos-cart.service.ts`, `pos-cart.repository.ts`, `packages/contract/src/pos-cart.ts` y `realtime-channels.ts`.

| Opción                                                        | Ventaja                                                                           | Límite comprobado                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET de cuentas cada cinco segundos, solo durante el conflicto | Reutiliza permisos, cliente y ruta existentes; hasta 12 lecturas por minuto       | El listado actual puede ejecutar el cierre del día y no informa la disponibilidad tras logout.          |
| Canal existente del dispositivo                               | Evita consultas periódicas cuando existe un evento apropiado                      | El evento apropiado no existe; necesita ampliar contrato, emisión y cliente.                            |
| Lectura de disponibilidad de la cuenta afectada               | Consulta solo el conflicto y permite eliminar el aviso por evidencia del servidor | Requiere una proyección autoritativa de disponibilidad; no debe recuperar la cuenta durante la lectura. |

**Inferencia para Umi:** usa sondeo acotado con la lectura existente de cuenta y una proyección mínima de disponibilidad, si hace falta. Evita un transporte nuevo.

**Inferencia para Umi:** reutiliza el GET de cuentas únicamente si queda garantizada su lectura sin efectos y su respuesta informa disponibilidad. Un GET exitoso por sí solo no prueba liberación.

**Inferencia para Umi:** arma el temporizador solo mientras exista `CART_ACCOUNT_BUSY` en Cuentas y la aplicación esté activa. Detén el sondeo al resolver el conflicto, cambiar de pantalla o sesión y destruir el widget.

**Inferencia para Umi:** evita solicitudes superpuestas. Una lectura en curso debe bloquear otro ciclo. Un temporizador de un solo disparo, rearmado después de la respuesta, también cumple este límite.

**Inferencia para Umi:** valida después de cada `await` el montaje, la sesión, la cuenta afectada y la generación del sondeo. Descarta una respuesta de otro contexto.

**Inferencia para Umi:** si falla la lectura, conserva el aviso. Si el servidor confirma disponibilidad, actualiza la fila y elimina el aviso automáticamente. No ejecutes una recuperación o un cobro.

**Inferencia para Umi:** prueba liberación tras logout, conflicto persistente, error HTTP, lectura lenta y respuesta posterior a `dispose`. Prueba pausa, reanudación y cambio de operador con `WidgetTester.pump`.

**NO VERIFICADO:** este apéndice no ejecuta el flujo en la A11 ni demuestra la actualización automática. Solo establece el instrumento y los requisitos.

## Apéndice: el folio identifica la cuenta en la lista y la Comanda

**Herramienta elegida:** `flutter_test` de Flutter **3.47.5**, con Dart **3.13.4**, y ADB **37.0.0** para confirmar la pantalla Android. No se necesita otra dependencia.

**Hecho local:** `accountDisplayTitle` toma primero `tableName`, después `accountName` y después `accountFolio`. La mesa o el nombre desplazan hoy el folio visible.

**Hecho local:** el renglón de `OpenAccountsList` y el encabezado de Comanda llaman al mismo helper. `accountReference` ya toma `accountFolio` antes del identificador técnico.

**Hecho local:** el servidor entrega el folio canónico. La proyección usa `account_number` y produce `Cuenta XXX`, con al menos tres dígitos y sin truncar números mayores.

Fuentes: `apps/umi-pos/lib/features/cart/account_details_surface.dart`, líneas 5–11; `open_accounts_surface.dart`, línea 380; `apps/umi-pos/lib/features/catalog/catalog_surface.dart`, línea 4658; `apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts`, línea 1526.

**Inferencia para Umi:** reutiliza `accountFolio` como identificación primaria. El encabezado de una cuenta abierta debe mostrarlo aunque existan mesa y nombre.

**Inferencia para Umi:** la lista debe mostrar `Cuenta XXX · Mesa X` cuando exista mesa. Conserva la mesa y el nombre como contexto secundario.

**Inferencia para Umi:** ajusta los helpers y sus consumidores existentes. No recalcules el número en Flutter ni cambies la API, el contrato o la base para esta presentación.

**Hecho documentado:** Flutter Test ofrece `find.text` y `find.byKey` para comprobar texto dentro de un widget concreto. [Guía oficial de finders](https://docs.flutter.dev/cookbook/testing/widget/finders).

**Hecho documentado:** `pumpWidget` renderiza la superficie y permite modificar el tamaño de la vista de prueba. [Referencia oficial](https://api.flutter.dev/flutter/flutter_test/WidgetTester/pumpWidget.html).

**Inferencia para Umi:** prueba cuenta sin mesa, con mesa, con nombre y con ambos. Comprueba que el folio conserve sus dígitos y no desaparezca por la prioridad anterior.

**Inferencia para Umi:** verifica la lista y la cuenta abierta por separado. Incluye ancho de tablet y texto grande; después confirma con captura de la pantalla Android.

**NO VERIFICADO:** esta investigación no ejecutó las nuevas pruebas ni capturó el build 92. Solo identifica el código y el instrumento de verificación.

## Apéndice: bloqueo de Cuenta 004 y descarte de comandas canceladas

**Herramientas elegidas:** `psql` de PostgreSQL **17.10**, Vitest **2.1.9** y Flutter Test **3.47.5**. Reutiliza el diario de comandos y las pruebas existentes.

### Causa comprobada del bloqueo

**Hecho local:** `merchant.kitchen_command` conserva estos dos rechazos de Cuenta 004:

| Fecha UTC           | Comando           | Ítem                                              | Versión solicitada | Resultado                                               |
| ------------------- | ----------------- | ------------------------------------------------- | ------------------ | ------------------------------------------------------- |
| 2026-10-13 21:10:04 | `mark_item_ready` | Capuccino, `2dc2080a-8337-4f63-a343-4bcd36cd400f` | 3                  | `KITCHEN_INVALID_TRANSITION`, estado global `exception` |
| 2026-10-13 21:27:23 | `mark_item_ready` | Mismo ítem                                        | 3                  | Mismo rechazo                                           |

**Hecho local:** la comanda tiene versión 3. Capuccino está en cola y asignado a Cocina. Aeropress y Amanecer tienen `exception`, sin estación.

**Hecho del código:** `commandTarget` traduce `mark_item_ready` a `ready`. El repositorio valida primero la transición global `exception` → `ready`.

Esa transición no está permitida. El rechazo ocurre antes de comprobar que Capuccino es un ítem válido para marcar listo.

No corresponde a un fallo de conexión, una revisión antigua o el corte del día. El resultado persistido identifica la guardia de transición.

Fuentes: `apps/umi-api/src/modules/kds/kds.repository.ts`, funciones `commandTarget` y `executeKitchenCommand`, líneas 78–84 y 1636–1655; `kitchen-domain.ts`, líneas 86–103.

### Cambio mínimo para ítems válidos

**Inferencia para Umi:** permite `mark_item_ready` sobre ítems explícitos, válidos y dentro del alcance, aunque otros ítems mantengan la comanda en excepción.

Conserva la validación de versión, estación, curso y estado del ítem. Después deriva el estado global desde todos los ítems.

`deriveKitchenOrderStatus` mantiene `exception` si queda algún ítem en excepción. No amplíes la transición global a `ready` para toda la comanda.

**Inferencia para Umi:** aplica el mismo criterio al terminar trabajo válido por ítem. No retires del tablero las excepciones restantes ni declares terminada toda la comanda.

### Cancelado y Descartar

**Hecho del código:** `cancel_ack` ya existe en el contrato y en la restricción SQL de `kitchen_command`. Exige `kitchen.cancel_ack`.

**Hecho del código:** el diario ya guarda identidad, revisión, resultado y actor. Puede registrar la confirmación de descarte sin una columna nueva.

**Tradeoff respaldado por el código:** el comando actual cancela ítems; no confirma un ticket ya cancelado. La transición desde `cancelled` está cerrada y el alcance exige estación.

Además, la escritura actual excluye ítems listos y no alcanza ítems sin estación. Reutilizarlo exige una rama explícita de confirmación, con reglas distintas a preparar comida.

**Inferencia para Umi:** muestra el tag **Cancelado** y solo **Descartar** cuando el servidor confirme cancelación comercial. Oculta controles de preparación y desactiva casillas.

**Inferencia para Umi:** usa `cancel_ack` como confirmación persistente para esa situación. Conserva el estado cancelado; registra evento, auditoría y el `NOTIFY` existente.

**Inferencia para Umi:** el tablero puede excluir canceladas cuyo descarte ya tenga un comando confirmado. Debe definir si la confirmación aplica por estación o al ticket completo.

**Inferencia para Umi:** valida la cancelación comercial también al recibir cualquier comando productivo. Ocultar un botón no protege contra una pantalla antigua.

Fuentes: `packages/contract/src/pos-kitchen.ts`, líneas 35–46; `kds.service.ts`, función `kitchenPermission`; `kds.repository.ts`, líneas 1516–1530, 1735–1762 y 1816–1878.

### Relación comercial que debe conservarse

**Hecho del código:** `PosSaleRepository.cancel` cambia `pos_cart`, pero no actualiza su orden ni la proyección del KDS. El barrido diario tiene el mismo límite.

**Hecho del código:** `OrdersRepository.setStatus` cambia `customer_order` y agrega `order_event`. Ese método tampoco actualiza la proyección del KDS.

**Inferencia para Umi:** reconoce la cancelación autoritativa del pedido o de su carrito vinculado. No conviertas un estado final cobrado en cancelación.

Las cuentas 013, 070 y 071 tienen carritos cancelados, sin ventas cobradas. Cuenta 004 está cobrada y sigue siendo una excepción operativa.

Fuentes: `apps/umi-api/src/modules/pos-sale/pos-sale.repository.ts`, líneas 210–237; `modules/orders/orders.repository.ts`, líneas 191–210; [diagnóstico con filas](../reports/2026-10-13-comandas-anteriores-diagnostico.md).

**Inferencia para Umi:** prueba ítem válido dentro de una excepción, conservación de ítems sin estación, bloqueo de preparar canceladas y descarte idempotente. Verifica que ventas y cobros conserven sus filas.

**NO VERIFICADO:** esta investigación no ejecutó la corrección ni pulsó Descartar. No modificó producto, configuración ni datos.
