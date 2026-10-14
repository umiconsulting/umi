# N21 · Recibos extensos: medir antes de decidir

Consulta: **2026-10-08**. Base: **c6e7b25dabbe16485bd6a7c04ba7d935c870d962**, N20 = 8.3. La composición de esa base se comprobó con `git show c6e7b25:apps/umi-pos/lib/shared/widgets/receipt_document.dart`; el archivo de trabajo puede evolucionar durante N21. Aplicadas [research SKILL](../../../.agents/skills/research/SKILL.md), [doctrina](../../agents/tool-and-research-doctrine.md) y [playbook](../2026-09-16-research-channels-playbook.md). Sólo investigación y este documento; sin ejecutar app, GUI, consultas de datos, cambios de preferencias ni mutaciones Git.

**HD** = hecho documentado/leído; **TR** = tradeoff respaldado; **IN** = inferencia o propuesta; **NV** = no verificado. Esta nota no contiene mediciones nuevas del recibo.

## Herramienta primero

| Instrumento | Versión, licencia y disponibilidad | Costo y límite |
| --- | --- | --- |
| Flutter, `FrameTiming`, `SchedulerBinding` | **HD:** Flutter **3.47.5**, Dart **3.13.4**, revisión **6a19cca56475dbfba1478ee68d7bd0c2ef891da1**, SDK fechado 2026-09-17, instalado en `/home/juan/.local/opt/flutter`; [BSD-3-Clause](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/LICENSE). | **TR:** instrumento propio del motor para profile, sin librería UI. Registrar un callback y eliminarlo cuesta instrumentación pequeña; construir `FrameTiming` artificialmente no mide el proceso. |
| Dart/Flutter DevTools | **HD:** instalado **2.60.0**, leído de `bin/cache/dart-sdk/bin/resources/devtools/version.json`; [licencia BSD-3-Clause](https://github.com/flutter/devtools/blob/master/LICENSE). | **TR:** Performance View admite desktop y profile; Memory permite investigar asignaciones. No requiere migración UI. No se abrió en esta investigación. |
| `flutter_driver` / `TimelineSummary` | **HD:** del mismo SDK fijado; [Driver existente](../../../apps/umi-pos/tool/estacion_driver.dart) ya captura timeline y resumen para catálogo. | **TR:** automatizable mediante VM service. La secuencia del catálogo no demuestra rendimiento de recibos. Una traza cruda no equivale al formato de exportación DevTools. |

**IN:** la herramienta probada está instalada y puede manejarse sin prompts mediante el instrumento propio. Adopción: extender una medición acotada, conservar datos brutos y separar captura visual de benchmark. Fallback: timeline del SDK más inspección de árbol/teclado, dejando NV la prestación que no se mida. No hay razón para adoptar otra biblioteca UI, un profiler casero o una nueva API de paginación del recibo.

## Límites que sí existen y dónde se aplican

**HD:** [ReceiptSnapshot y ReceiptLineSnapshot](../../../packages/contract/src/platform.ts) declaran en Zod:

| Campo | Límite declarado |
| --- | --- |
| `lines` | 1–500 líneas |
| `description` | longitud 1–300 |
| `modifiers` | hasta 100 textos por línea; longitud 1–160 cada uno |
| `note` | nullable/opcional; longitud hasta 500 |
| `variantName` | nullable/opcional; longitud 1–160 |
| `payments` | hasta 8 pagos |

**HD:** [contract.json generado](../../../packages/contract/generated/contract.json) reproduce `minItems:1`, `maxItems:500` y los límites de textos/modificadores. Se trata de los máximos de `z.string`, no de ancho visual. [SaleReceiptResult](../../../packages/contract/src/pos-sale.ts) devuelve un snapshot nullable dentro del resultado; no pagina sus líneas. El contrato de [CartSnapshot](../../../packages/contract/src/pos-cart.ts) declara hasta **250** items: no confundir ese tipo con el máximo del documento.

**HD:** la [ruta GET](../../../apps/umi-api/src/modules/pos-sale/pos-sale.controller.ts) valida query mediante `ZodValidationPipe`; el [servicio](../../../apps/umi-api/src/modules/pos-sale/pos-sale.service.ts) autoriza y devuelve el resultado del [repositorio](../../../apps/umi-api/src/modules/pos-sale/pos-sale.repository.ts), que lee `receipt.snapshot` íntegro de PostgreSQL. En ese camino leído no se llama `ReceiptSnapshot.parse` ni `SaleReceiptResult.parse`. Los interceptores registrados son logging y operaciones; no validan ese payload. El [Dart generado](../../../packages/contract/generated/dart/lib/umi_contract.dart) convierte/castea campos en `fromJson`, sin comprobar `maxItems`.

**TR:** 500 es un máximo contractual verificable; esta lectura de fuente no lo convierte en una garantía de cada snapshot almacenado o respuesta histórica. [DDL de receipt_snapshot](../../../docs/migration/build-v3/20_merchant.sql) guarda JSONB y el total monetario; su definición leída no limita cantidad de líneas. **NV:** contenido de la base desplegada y validación adicional fuera del camino inspeccionado; no se consultaron datos.

**HD:** [ApiClient](../../../apps/umi-pos/lib/core/network/api_client.dart) corta el stream al superar **2 × 1024 × 1024 bytes**, con `RESPONSE_TOO_LARGE`. El [límite HTTP de API](../../../apps/umi-api/src/shared/operations/resource-limits.ts) de **1 MiB** configura `bodyLimit` en [main.ts](../../../apps/umi-api/src/main.ts): es entrada, no un máximo de esta respuesta GET.

**IN:** 500 líneas breves y 500 con detalles no son el mismo stress. Sólo modificadores ASCII en los máximos declarados sumarían `500 × 100 × 160 = 8 000 000` bytes antes de JSON: esa combinación contractual supera el transporte del cliente. Medir un objeto construido localmente debe identificarse como prueba de presentación, separada de lo que efectivamente llega por HTTP. No truncar silenciosamente un documento para ocultar el costo.

## Qué puede medir profile

**HD:** [FrameTiming](https://api.flutter.dev/flutter/dart-ui/FrameTiming-class.html) distingue `buildDuration` en UI, `rasterDuration` en raster, `vsyncOverhead` y `totalSpan` desde vsync hasta raster finish. Sus timestamps no deben mezclarse directamente con el epoch de `DateTime`. [Fuente fijada](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/engine/src/flutter/lib/ui/platform_dispatcher.dart#L2153). Son tiempos de frames, no el tiempo de consulta HTTP ni una medición completa de píxeles vistos por una persona.

**HD:** [addTimingsCallback](https://api.flutter.dev/flutter/scheduler/SchedulerBinding/addTimingsCallback.html) entrega batches aproximadamente cada **100 ms en profile** y cada segundo en release. El primer frame se comunica inmediatamente; eso no promete entrega inmediata al abrir cada modal. Permite varios callbacks, a diferencia del único slot de `PlatformDispatcher.onReportTimings`; el callback debe retirarse al terminar. El SDK advierte que latencia y frames lentos son distintos por el pipeline. No trasladar a este Linux la estimación de costo medida por Flutter en un iPhone 6s.

**HD:** [Performance profiling](https://docs.flutter.dev/perf/ui-performance) y [Performance View](https://docs.flutter.dev/tools/devtools/performance), actualizadas **2026-07-31**, recomiendan profile; los tiempos debug no representan release. La vista funciona con aplicaciones desktop. Activar tracing detallado de build/layout/paint puede cambiar los tiempos; capturas de pantalla y dumps deben quedar fuera del intervalo comparable.

**HD:** [TimelineSummary fijado](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter_driver/lib/src/driver/timeline_summary.dart#L42) usa `kBuildBudget = 16 ms` constante y declara que los conteos `missed_*_budget_count` no equivalen a frames físicos perdidos. **IN:** conservar ese dato como umbral fijo si se usa, y comparar duraciones con `1000 / Hz` del display comprobado. No afirmar Hz a partir del nombre del equipo.

**IN:** protocolo mínimo: misma revisión/profile, ventana, tema, idioma, escalador, movimiento y snapshot; separar apertura fría, reapertura y desplazamiento sostenido. Registrar número de frames, max y percentiles de build/raster, totalSpan y presupuesto usado. Delimitar la secuencia por frames/intervalo y recibir el batch final antes de cerrar el muestreo. Medir aparte solicitud→documento disponible. Un promedio pequeño puede esconder una apertura larga; pocos frames no sostienen un percentil estable.

**TR:** [Memory View](https://docs.flutter.dev/tools/devtools/memory), actualizada 2026-07-31 pero con nota interna de referencia a DevTools **2.23.0**, explica diferencia entre memoria retenida, bloat y leak. La versión instalada es 2.60.0: no se comprobó coincidencia exacta de pantallas. **IN:** comparar apertura/cierre repetidos y retención del subtree antes de llamar leak a un pico. Los bytes del raster cache de FrameTiming no representan toda la memoria de recibo.

## Construir todo o diferir líneas

**HD:** en la base N20, [ReceiptDocument](../../../apps/umi-pos/lib/shared/widgets/receipt_document.dart) crea todas las `_ReceiptLine` en un `Column`; cada línea construye también sus modificadores/notas. `_ReceiptAmount` calcula anchos con `TextPainter` durante layout para decidir Row/Column. [PosAlertDialog](../../../apps/umi-pos/lib/core/theme/pos_ui.dart) aporta un `SingleChildScrollView`. El costo real de ese diseño todavía no se midió aquí.

**HD:** [SingleChildScrollView](https://api.flutter.dev/flutter/widgets/SingleChildScrollView-class.html), s/f, es apropiado para una caja que suele caber y necesita desplazarse ocasionalmente; recomienda `ListView`/slivers cuando hay muchos hijos y el contenido suele exceder el viewport. [SliverList](https://api.flutter.dev/flutter/widgets/SliverList-class.html), s/f, crea subtrees diferidos y estima extensión de hijos variables aún no materializados. La creación diferida del render no elimina el snapshot JSON completo ya recibido.

| Alternativa | Tradeoff respaldado y decisión propuesta |
| --- | --- |
| Mantener Column/SCSV | **TR:** conserva composición sencilla y alturas exactas de todas las cajas; paga construcción/layout del documento completo. **IN:** válida si los casos representativos y extensos cumplen las mediciones y tareas reales. |
| Un CustomScrollView acotado con encabezado, SliverList y totales | **TR:** difiere líneas fuera de la región construida; administra creación/destrucción y estima extensión de alturas variables. **IN:** comparar cuando aparezca un costo medido; conservar un solo propietario de desplazamiento. |
| Umbral híbrido | **IN:** puede conservar recibos breves sencillos, pero añade dos caminos. Elegir el umbral mediante curvas de costo/densidad, no porque 40 o 100 parezca una cifra razonable. |

**IN:** no sustituir todas las filas por múltiples `SliverToBoxAdapter`, ni colocar `ListView(shrinkWrap:true)` dentro del scroll exterior esperando obtener la misma creación diferida. No fijar altura por artículo: nombres, modificadores, idioma y 200% alteran altura. Si una línea individual extremadamente compleja domina el costo, diferir las demás no demuestra que esa línea sea barata.

## Leer un documento largo con teclado y semántica

**HD:** [WidgetsApp fijado](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/widgets/app.dart#L1297) asigna PageUp/PageDown a `ScrollIntent`; [ScrollAction](https://api.flutter.dev/flutter/widgets/ScrollAction-class.html) busca el scrollable antecesor del contexto de foco o un `PrimaryScrollController` con clientes. El incremento por defecto es 80% del viewport por página. Space en desktop activa controles; no debe darse por equivalente a PageDown.

**HD:** una [ModalRoute](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/widgets/routes.dart#L1199) aporta controlador primario propio. Pero la herencia automática de [PrimaryScrollController](https://api.flutter.dev/flutter/widgets/PrimaryScrollController-class.html) cubre por defecto plataformas móviles y scroll vertical, no Linux. [SingleChildScrollView fijado](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/widgets/single_child_scroll_view.dart#L253) decide esa asociación mediante `primary`/controller/herencia. **IN:** comprobar PageDown desde Cerrar o Imprimir, que son hermanos del contenido. Asociar explícitamente el único scrollable del modal puede resolver navegación independientemente de eager/lazy. **NV:** no se ejecutaron teclas aquí.

**HD:** [APG Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), s/f, recomienda enfocar contenido estático inicial cuando un documento largo/estructurado lo necesita, mantener Tab/Shift+Tab dentro, cerrar con Escape y retornar al invocador. Desaconseja anunciar un documento estructurado como una sola cadena descriptiva. **IN:** traducir esos criterios al modal nativo; no importar ARIA como si fuera API Flutter ni agregar un tab stop a cada artículo sólo para leerlo.

**HD:** [CustomScrollView](https://api.flutter.dev/flutter/widgets/CustomScrollView-class.html) necesita índices y count semánticos coherentes para sus anuncios; separadores no cuentan como artículos. Sus ejemplos de TalkBack/VoiceOver no prueban lectura Linux. [SelectableRegion](https://api.flutter.dev/flutter/widgets/SelectableRegion-class.html) configura selección; ésta es distinta de semántica. La base permite seleccionar referencia mediante PosSelectableText, no selecciona todo el recibo.

**IN:** matriz útil de presentación: 1, 40, 250 y 500 líneas como puntos de ensayo, con nombres/notas largas y detalle variable, ES/EN y sistema/200%, ancho móvil y escritorio. Los puntos intermedios no son límites del producto. Verificar comienzo, mitad, último artículo y total, PageUp/PageDown con foco en acciones, Escape/retorno y ausencia de impresión accidental. Si se cambia a slivers, confirmar continuidad al cruzar regiones creadas, semántica de artículo/importe y acceso al total; un count correcto o dump AT-SPI no sustituyen lectura hablada.

**TR:** [WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) e [Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html) aportan criterio de información disponible y relaciones perceptibles. **IN:** mantener cada importe unido a su artículo y un eje de lectura; 200% Flutter no certifica conformidad web ni una geometría de 320 CSS px. El corpus artístico anterior aporta identidad visual, pero no un criterio nuevo para costo de layout/teclado: N21 no agrega decoración ni evidencia artística por obligación.

## Persistencia y alcance de la evidencia

**HD:** escalón 1: docs/API propias Flutter y DevTools; escalón 3: SDK fijado y contrato/API/cliente/DDL locales para condiciones y límites reales; escalón 7: criterios W3C. Consulta de API s/f no se transforma en fecha de publicación.

| Ruta fallida o conflicto | Recuperación y límite |
| --- | --- |
| `features/sale/receipt_document.dart` | No existe. `rg --files` localizó `shared/widgets/receipt_document.dart`; se fijó base mediante `git show`, porque la copia de trabajo evolucionó. |
| `apps/umi-api/src/common` / `apps/umi-pos/lib/core/http` | No existen. Fuentes encontradas en `shared/http` y `core/network`. |
| `packages/contract/generated/openapi.yaml` | No existe; se leyó schema Zod y `generated/contract.json`, sin inventar un OpenAPI. |
| `widgets/SelectionArea-class.html` | Error del extractor y namespace incorrecto para la clase; recuperación por `SelectableRegion`/`SelectionContainer` de widgets. Material SelectionArea no se adopta. |
| API Flutter muestra `Flutter 0.0.0`; Memory docs indican 2.23.0 | Fuente SDK fijada y `version.json` local prevalecen para versiones. No se normalizaron los conflictos. |

**NV:** frames, memoria, entrega de teclado, lector hablado, uso real de 500 líneas, payloads desplegados y prestaciones físicas de este POS permanecen pendientes de medición. La decisión eager/lazy y cualquier aumento de puntuación deben citar los resultados obtenidos por el investigador principal, no esta propuesta experimental.
