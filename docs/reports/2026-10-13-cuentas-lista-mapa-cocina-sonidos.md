# Cuentas, cocina y símbolos de ventas

Fecha: 2026-10-13. Monorepo: `/home/juan/Projects/umiconsulting/umi`.

> **Seguimiento al build 94:** este documento conserva la medición original del build 75. El mismo APK 94 está instalado en iMin, A9 KDS y A11 móvil. La [matriz del ciclo](2026-10-13-pendientes-del-ciclo.md) reúne los cuatro frentes y las correcciones posteriores. El [selector nuevo](2026-10-13-selector-mesas.md) muestra mapa, estados, creación de mesa y liberación protegida. La [bandeja Sin estación](2026-10-13-kds-sin-estacion.md) permitió resolver 004 y descartar 013; ambas operaciones tienen capturas Android, peticiones y filas. El cierre conjunto aprobó 933 pruebas POS y `flutter analyze` sin hallazgos. Las [correcciones de jornada](2026-10-13-jornada-correcciones.md) también acreditan cinco minutos reales en A9 y actualización de la hoja del mesero. Los límites vigentes están en la matriz; la instalación pendiente descrita abajo pertenece al corte histórico 75.

Los cuatro frentes están implementados y probados en el mismo árbol, con la API de `4001` y la base `umi_local`. Se compiló un APK `0.1.0+75`, instalado y recorrido en iMin y A9. **La instalación en A11 queda pendiente:** Android rechazó `install -r` porque otra sesión había instalado el 78; después esa misma terminal recibió el 81. Se pidió coordinar qué versión debe quedar; no hubo respuesta durante la verificación. No se borraron datos ni se forzó un downgrade.

La salida compartida `build/app/outputs/flutter-apk/app-profile.apk` también fue reemplazada por el 81 de otra sesión. Se recuperó el **APK 75 instalado en la iMin**, sin volver a compilar, en `/tmp/umi-cuentas-cocina-build75.apk`. `aapt dump badging` confirmó paquete `co.umiconsulting.umi_pos.estacion`, versión `0.1.0`, código `75`. Hash, tamaño y versiones por terminal: [installed-builds.json](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/installed-builds.json).

## 1. Cuentas: Lista y Mapa

`AccountsWorkspace` presenta **Lista / Mapa**. Lista reutiliza `OpenAccountsList`, incluye cuentas con y sin mesa y combina la búsqueda existente con **Todas / Comer aquí / Para llevar**, filtrando el `fulfillmentType`. Se conserva Todas como opción para volver a ver todas las cuentas. **El filtro sólo afecta Lista**: el mapa representa la sala completa.

Se retiraron la cuadrícula, el alternador plano/lista y el modo Gestionar mesas/Tomar pedidos de `FloorPlanSurface`. Tocar selecciona; en ancho ≥720 aparece el panel lateral con la información y **Abrir cuenta** como acción primaria. Esa acción llama al callback existente y entra a Comanda. `_tableActions` sigue armando las acciones y sus permisos; mover/unir/dividir conservan sus estados y la barra de gestos. No se cambiaron las reglas de propiedad de cuentas ni la reanudación de `/sales/current`.

En pantalla angosta se conservan la hoja modal y el resumen inferior con Detalle. **Se conserva el respaldo de lista textual cuando el ancho es menor a 720 y el texto llega al 200%.** La prueba del mapa directo en `375×812`, con `TextScaler.linear(2)`, mide una etiqueta nominal de `23.4` píxeles transformada a aproximadamente **3.22 píxeles** por la escala del mapa `0.13755`. Que no haya overflow no acredita legibilidad. Por eso no se eliminó el respaldo accesible.

Evidencia en iMin: [mapa con panel](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-02-map-detail.png), [entrada a Comanda](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-03-open-account.png), [lista completa](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-04-accounts-all.png), [Para llevar](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-05-accounts-takeout.png). En A9, el mesero sólo ve Abrir cuenta, sin acciones de gestión: [panel del mesero](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/a9-01-waiter-detail.png).

## 2. Cocina: tiempo, color y avisos

Cola gris, preparación azul, vencido rojo con texto **Tiempo vencido**, listo verde. Un reloj de un segundo actualiza el vencimiento aunque no haya una nueva petición. Barra tiene 300 segundos por defecto; Cocina, 900. **Si la ruta tiene `target_seconds`, ese objetivo reemplaza el umbral de estación para el ítem**. La explicación también está en el dashboard. El reloj usa `queuedAt` del ticket; no se añadió un reloj independiente por cada curso.

Los avisos usan archivos WAV locales: llegada (880 Hz, 0.22 s), vencimiento (440 Hz, 0.65 s), ítem listo (1320 Hz, 0.35 s). El administrador puede cambiar cuál de esos tres sonidos corresponde a cada evento o apagar los sonidos de la estación. Los valores por defecto son distintos entre sí.

El tablero conserva el watch largo existente y su actualización periódica; el sonido se decide por diferencias del snapshot, sin transporte nuevo. La primera carga establece una línea base silenciosa. Llegada y vencimiento se emiten una vez por ticket/estación durante la vida del tablero, sólo para su estación seleccionada. Eventos silenciados se consumen sin reproducirse después. No se activa repetición. El botón de altavoz detiene la reproducción y guarda el silencio por dispositivo en `DisplayPreferences`; quedó silenciado en la iMin al terminar.

El portátil del mesero consulta cada cinco segundos el estado de **su cuenta activa enviada**, usando `KitchenStatusRepository`, sin peticiones superpuestas. La respuesta agrega ids de ítems listos y el sonido configurado. La primera lectura no suena; un ítem que pasa a listo sí. Cambiar de cuenta/operador establece otra línea base. Se corrigió el rechazo de permiso observado durante el recorrido: un operador con `order.fire` puede consultar su propia cuenta, validando sesión durable, sucursal y `pos_cart.operator_session_id`. No recibe permiso para el tablero completo. Los operadores con `kitchen.read` conservan el acceso anterior.

Reproducción sólo en Android; Linux y web permanecen silenciosos. Un fallo de audio no bloquea la cocina ni sus señales visuales.

Prueba real: en A9, rol Mesero, se abrió Mesa 10 y se envió Capuccino. El override lo llevó a Cocina, objetivo 30 segundos. En iMin se vio [cola gris](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-07-arrival-queued.png), [preparación azul](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-08-preparing-blue.png), [vencido rojo](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-09-overdue-red.png) y [listo verde](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-10-ready.png).

Log Android: [iMin](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-audio.txt) registra `arrival playback=started` a las 04:33:22 y `overdue playback=started` a las 04:33:50; [A9](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/a9-audio.txt) registra `ready playback=started` a las 04:35:12. El volumen multimedia no estaba silenciado. **Esto acredita ejecución del reproductor; no acredita audición física ni volumen percibido.** Se solicitó escuchar los eventos y no hubo confirmación. [Silencio](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-11-muted.png) y [silencio conservado tras cerrar/reabrir y entrar](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-12-muted-restart.png).

## 3. Dashboard: configuración guardada

Cocina permite crear/editar nombres de estaciones, su umbral en minutos, sonido encendido/apagado y selección de sonido para llegada, vencimiento y listo. Conserva el ruteo predeterminado y por categoría, agrega búsqueda de producto y su override, prioridad y objetivo en segundos, desactivación y previsualización **¿dónde cae este platillo?**. Usa el resolver existente: producto > categoría > predeterminada, y menor número de prioridad gana dentro del mismo nivel. Sin ruta efectiva aparece Sin destino; no se promete entrega a una estación inexistente.

Se corrigió la lectura del hook de categorías: los renglones están en `categories.data.items`. La interfaz permite dejar el objetivo vacío para heredar el umbral de estación. Las escrituras usan los permisos y control de versión existentes; el servidor valida umbral `30..86400`, booleano de sonidos y sonidos del catálogo cerrado.

Se verificó con el Chromium real iniciado por `./scripts/ux-browser.sh`, conexión CDP y clics/selects reales de Playwright, sin mocks. El script [dashboard-kitchen-settings.mjs](../../tools/ux-sweep/dashboard-kitchen-settings.mjs) apagó sonidos de Barra, guardó, recargó y comprobó persistencia; restauró el sonido, creó el override Capuccino → Cocina, prioridad 10, objetivo 30, y verificó el preview después de recargar. [Resultados de los clics](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-clicks.json), [override](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-02-product-override.png), [persistencia](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-03-persisted.png).

Después del recorrido POS se desactivó el override con el botón real y el preview volvió a **Capuccino: Barra**: [desactivación](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-04-override-disabled.png). Se creó y renombró una estación de prueba mediante clics: [alta y edición](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-05-station-created-edited.png). Para limpiar, se archivó mediante DELETE autenticado existente; no se presenta ese archivado como recorrido UI. Un intento de limpieza sin cabecera CSRF devolvió 403; con la cabecera correcta devolvió 200. [Configuración final](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-01-cocina.png).

Investigación previa, fuentes primarias y 15 capturas: [Toast, Square, Lightspeed, Fresh KDS, Fudo, Parrot y Soft Restaurant](../research/2026-10-13-kds-ruteo-tiempos-sonidos/README.md). Cada afirmación se distingue entre hecho documentado, lectura de captura, inferencia y NO VERIFICADO. No se extrapolaron prioridades numéricas a proveedores que no las documentan.

## 4. Ventas: pausa y equis

Se usan `PosGlyphs.pause` y `PosGlyphs.close` planos. Se mantiene el tile redondeado y se eleva **sólo esos dos glifos** a trazo `3.0`, frente al predeterminado `1.65`. A 16 px representa aproximadamente 2 px de trazo. `PosIcon` admite grosor opcional y lo incluye en `shouldRepaint`. La prueba fija glifo, tamaño y grosor para pausada/cancelada y conserva el grosor normal del check.

Comparación real en iMin: [antes, con círculos](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/00-current.png), [después, planos y más gruesos](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-01-sales-after.png).

## Herramientas, investigación y decisiones

| Herramienta            | Versión                     | Fuente y uso                                                                                                                                                                                                                      |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flutter / Dart         | 3.47.5 / 3.13.4             | SDK instalado. [CustomPainter](https://api.flutter.dev/flutter/rendering/CustomPainter-class.html) y [Paint.strokeWidth](https://api.flutter.dev/flutter/dart-ui/Paint/strokeWidth.html): extender el pintor de glifos existente. |
| audioplayers           | **6.8.1 exacta**            | [AssetSource oficial](https://pub.dev/documentation/audioplayers/6.8.1/audioplayers/AssetSource-class.html), MIT. Archivos locales y reproducción finita. [Comparativa previa](../research/2026-10-13-kds-audio.md).              |
| FFmpeg                 | n9.0.2                      | [Filtro sine oficial](https://ffmpeg.org/ffmpeg-filters.html#sine): generar tres WAV originales PCM mono, 22050 Hz.                                                                                                               |
| ADB / aapt             | 37.0.0 / Build Tools 36.0.0 | Captura, interacción, instalación, inspección y recuperación del APK ya instalado.                                                                                                                                                |
| Playwright / Chromium  | 1.62.1 / 153.0.8010.52      | Herramienta de navegador del playbook; CDP 9222 y acciones reales.                                                                                                                                                                |
| Node / pnpm / Prettier | 24.21.0 / 10.29.3 / 3.9.4   | Herramientas instaladas; pruebas API/dashboard y formato de documentación.                                                                                                                                                        |

`just_audio` 0.10.6 es una alternativa válida, pero sus listas/gapless no son necesarias para tres avisos cortos. `ToneGenerator` requeriría canal nativo y no reproduciría estos assets. No se escribió un reproductor manual. Los WAV son sintetizados originales para funcionar sin red y sin licencias de grabaciones ajenas. Se extendieron a mano los glifos porque el set existente ya es `CustomPainter`; importar otro set para dos trazos rompería su consistencia. El pintor también incorpora los símbolos de altavoz/silencio.

No se diseñó un nuevo resolver ni un nuevo transporte realtime. El sondeo del mesero se eligió por su endpoint ya existente y su alcance limitado a la cuenta del operador; latencia esperada hasta cinco segundos con API disponible y la app abierta.

## Migración, contrato y filas

Nueva migración [029_kitchen_station_alerts.sql](../migration/build-v3/migrations/029_kitchen_station_alerts.sql). Agrega `merchant.station.alert_settings` JSONB con valores por defecto y umbral Barra 300; el bloque comprueba existencia para que repetirlo conserve los cambios del administrador. Limpia el marcador temporal `alerts_configured` usado durante la prueba inicial. **La configuración vive en una columna dedicada**, porque `capabilities` describe capacidades y las rutas describen destinos/objetivos por producto o categoría. No se editaron DDL numerados anteriores.

Aplicada a la única base local y repetida con éxito:

```sh
docker exec -i umi-bv3-pg psql -U postgres -d umi_local -v ON_ERROR_STOP=1 < docs/migration/build-v3/migrations/029_kitchen_station_alerts.sql
```

[Reejecución](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/migration-repeat.txt), [settings iniciales](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/station-settings.txt), [ruta activa durante prueba](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/product-override.txt), [ticket proyectado a Cocina con target 30](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/kds-routed-item.txt), [filas finales: ruta desactivada y estación de prueba archivada](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/final-config.txt).

Contrato: campos opcionales aditivos para settings e ítems listos; se regeneraron consumidores. Se mantiene versión `2.34.0`. La declaración de permiso de `pos.kitchenOrder` refleja `order.fire` con validación adicional de propiedad en el servicio, manteniendo la alternativa `kitchen.read`. No cambia la autorización del tablero.

Cuenta de prueba local: **Cuenta 096 · Mesa 10**, un Capuccino enviado a Cocina, sin cobro ni venta comprometida. El ítem pasó a listo y el ticket se terminó después de capturar las pruebas. El override de prueba quedó inactivo. No se borraron cuentas o tickets preexistentes.

[Peticiones API reales](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/api-requests.json): conserva método, URL, status, fecha y correlación del log de `4001`, incluyendo el 403 de estado de cocina previo a corregir el acceso del mesero y los 200 posteriores. No contiene credenciales.

## Pruebas y comprobaciones

- `flutter analyze`: **sin hallazgos**, última ejecución 04:40.
- `flutter test`: **866/866 verdes**, repetición final 04:41. [Log completo](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/pos-suite.txt). El total actual del árbol compartido supera los 851 del punto de partida; no se atribuye todo el incremento a este frente.
- Se corrieron las pruebas enfocadas de cada pieza antes del build. `accounts_workspace_test.dart` cambia Mesas/Sin mesa por Lista/Mapa y exige cuentas de mesa en Lista. `open_accounts_list_test.dart` agrega fulfillment combinado con las cuentas existentes.
- `floor_plan_test.dart` y `table_state_surface_test.dart` cambian el toque directo a cuenta por seleccionar y después Abrir cuenta; conservan merge/split, servicios, paso ancho→angosto, hint y respaldo al 200%. Se agrega la medición de legibilidad descrita arriba.
- `sale_lifecycle_test.dart` fija pausa/equis planos y grosor; `display_preferences_test.dart` prueba que el silencio se guarda y se recupera.
- `kitchen_alerts_test.dart` prueba urgencia por estación/ruta/estado, baseline, deduplicación, silencio y aviso al mesero. `kitchen_board_test.dart` prueba cruzar el umbral con reloj inyectado, cambio de color y texto; fixtures anteriores fijan su reloj para no depender de la hora real.
- `pnpm --filter @umi/api test src/modules/kds`: **116 verdes**, 29 pruebas de integración omitidas por su configuración normal. [Log](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/api-tests.txt). Se agregaron validación de settings y acceso del mesero sólo a su cuenta; se conserva rechazo de tablero y cuenta ajena.
- `pnpm --filter @umi/dashboard test src/screens/kitchen-routing-model.spec.js`: **9 verdes**, resolver existente. [Log](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-tests.txt).
- ESLint de la pantalla Cocina y archivos KDS tocados; build del dashboard con `VITE_UMI_ENVIRONMENT=development`: correcto. Vite advierte tamaño del bundle, sin fallo del build.
- Se pasó `npx prettier --write` a los Markdown nuevos y al script/evidencia JSON. `pnpm format:check` global detecta múltiples archivos de otras sesiones, incluido `kitchen-projector.spec.ts` no editado aquí; se corrigió el JSON de evidencia propio señalado y no se reformatearon archivos ajenos.
- APK profile arm64 compilado una sola vez con los defines indicados, código 75, API `http://192.168.1.9:4001`, simulator false. Instalación `adb -s <serial> install -r ...` correcta en iMin/A9. A11 rechazó downgrade. No se realizó otro build para resolver la concurrencia.

## Límites y pendientes explícitos

- **A11: instalación del 75 y recorrido pendientes** por la versión 81 instalada desde otra sesión. El APK 75 recuperado está listo; no se declara instalación en las tres terminales.
- **Audición física no verificada**: no hay micrófono remoto ni confirmación del usuario. Los logs acreditan reproducción; no prueban que las tres señales sean identificables en el ruido real del local.
- Los umbrales por defecto 5/15 minutos están cubiertos por unidad y por filas de la base. El recorrido físico cruzó **30 segundos** para comprobar el objetivo de ruta; no se esperaron otros 5 y 15 minutos reales.
- No se ejecutaron las 29 integraciones KDS omitidas ni la suite completa API. `pnpm --filter @umi/api typecheck` encontró dos errores preexistentes de null/string en `pos-hardware.repository.spec.ts` (70, 95); no se modificaron. La spec pos-cash indicada por el usuario queda fuera de este frente.
- `/health` sigue devolviendo 503 por readiness/schema preexistente (`build-v3-79`, versión actual null), aunque DB/Redis y los endpoints recorridos funcionan. No se certifica readiness verde.
- No se verificaron desconexiones largas, avisos de cuentas en segundo plano, entrega después de cerrar Android ni notificaciones del sistema. El aviso al mesero aplica a su cuenta activa con app abierta.
- El modal de carrito abierto antes de enviar conservó su snapshot anterior de preparación; no se presenta `a9-03-ready-status.png` como prueba visual de Listo. El estado listo se acredita mediante iMin, API y reproducción en A9.
- No se hizo recorrido dashboard en inglés ni prueba física de accesibilidad al 200%; ésta se midió mediante widget/layout.
- Se respetaron los archivos protegidos y el trabajo sucio de otras sesiones. No se hicieron commits ni se sobrescribieron cambios ajenos para dejar el árbol limpio.
