# N17: una búsqueda coherente con el nombre visible

Fecha local: 8 de octubre de 2026. Base: N16, `e32885c`. Nota acumulativa: **8.0/10**.

## Consulta canónica

**OV, G56.** La interfaz muestra Croissant como título de una venta sin nombre asignado. El repositorio compilado anterior devuelve cero resultados para `croissant`. También devuelve cero para `latte`. El [registro anterior](N17-api-before.json) ejecuta el método real del repositorio. No usa una copia de su SQL.

**Decisión con fundamento.** La API añade una subconsulta `EXISTS` sobre el nombre histórico del producto. Mantiene los filtros de comercio, ubicación y estado. Conserva el orden y el cursor existentes. El [manual PostgreSQL 17](https://www.postgresql.org/docs/17/functions-subquery.html#FUNCTIONS-SUBQUERY-EXISTS) documenta la correlación y la selección por existencia. Varias líneas coincidentes no multiplican la venta exterior. El fixture comprobado no contiene una venta con varias líneas coincidentes; ese caso conserva su límite empírico.

El [registro posterior](N17-api-after.json) encuentra un Croissant suspendido y un Latte completado. La consulta en mayúsculas encuentra el mismo Croissant. Los casos de comercio distinto, ubicación distinta y texto ausente devuelven cero resultados. Dos páginas de ventas suspendidas conservan sus IDs diferentes y el cursor final vacío.

**HD.** `ILIKE` depende de la locale para la comparación de mayúsculas. La [documentación PostgreSQL 17](https://www.postgresql.org/docs/17/functions-matching.html) conserva el significado de `%` y `_`. N17 mantiene ese contrato anterior. **NV.** No mide búsqueda sin acentos ni rendimiento con un catálogo grande. No añade índices ni migraciones.

## Intención vigente y recuperación

**OV, G55.** Las [pruebas anteriores](N17-history-before-fix.txt) reproducen tres consultas nuevas descartadas durante una solicitud pendiente. **OV, G57.** Una lectura fallida cambia la fase comercial a `failure`.

El controlador asigna una generación a cada consulta nueva. Sólo la generación vigente puede publicar resultados, cursor, error o fin de carga. El cambio de ubicación y la disposición invalidan las respuestas pendientes. Las páginas de una consulta se solicitan una a la vez. Una consulta nueva puede sustituir una página pendiente.

El historial tiene su propio error. Su lectura conserva la venta abierta, su fase, el recibo y el estado comercial. El [mecanismo del SDK Flutter fijado](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/widgets/async.dart#L595) comprueba identidad antes de publicar callbacks de `FutureBuilder`. **Inferencia UMI.** El controlador adapta ese principio sin importar un componente visual. Las solicitudes antiguas continúan en la red; sus respuestas pierden autoridad.

La superficie distingue consulta pendiente, consulta fallida, ausencia de coincidencias y vista sin ventas. La carga y la ausencia de coincidencias incluyen una región semántica activa. La consulta fallida conserva el formulario y muestra «Reintentar». Las filas anteriores quedan ocultas durante una actualización completa. Un fallo de página conserva las filas ya cargadas.

Las guías propias de [Carbon sobre estados vacíos](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states), del 11 de agosto de 2026, distinguen ausencia y fallo. Su [guía de carga](https://www.carbondesignsystem.com/building-blocks/core/components/loading/guidelines), del 28 de septiembre de 2026, distingue una operación pendiente. La [investigación primaria](N17-query-evidence.md) conserva los hechos, los límites y las rutas fallidas. Ningún componente Carbon forma parte de la interfaz.

## Comprobación nativa

La [búsqueda móvil](N17-sales-product-phone/screen.png) encuentra Croissant. El [regreso al escritorio](N17-sales-product-wide/screen.png) conserva la consulta después de visitar Caja. La [búsqueda ausente](N17-sales-no-match-wide/screen.png) muestra su mensaje propio. Latte aparece en [escritorio](N17-sales-paid-product-wide/screen.png), [tablet](N17-sales-paid-product-tablet/screen.png) y [teléfono](N17-sales-paid-product-phone/screen.png).

La prueba de recuperación detiene sólo la API 4013 del fixture. Comprueba su PID, directorio y entrada antes de detenerla. Una consulta de lectura muestra [fallo y reintento](N17-sales-history-failure-wide/screen.png). La API vuelve a iniciar. «Reintentar» recupera [Latte](N17-sales-history-recovered-wide/screen.png). El regreso a Comanda conserva Croissant. La [auditoría de lectura](N17-backend-paid.json) conserva pagos, notas, variante y ocupación anteriores. La [comparación](N17-audit-comparison.json) detecta un cambio de `updated_at` en la comanda activa. Los demás campos auditados permanecen iguales. No se solicitan cobros, aperturas ni traslados. **Inferencia:** el acceso con PIN recupera el carrito para la nueva sesión. El propietario existente actualiza su fecha en `PosCartRepository.create`. No se atribuye esa fecha a la lectura del historial.

Las [dimensiones de cada captura](N17-capture-geometry.json) comprueban el PNG y la geometría del proceso. La ventana ocupa sola el workspace 3. La revisión deja abierta la [vista completa](N17-final-preview/screen.png), en 1920 × 1080. Las inspecciones AT-SPI confirman los nombres observados; no prueban voz de un lector.

**NV.** La ventana nativa no recibe respuestas deliberadamente fuera de orden. Las pruebas controlan ese orden con `Completer`. Tampoco se captura una solicitud pendiente prolongada en el proceso nativo. Esos límites se conservan.

## Instrumentos y fallos del instrumento

Flutter 3.47.5 y Dart 3.13.4 aprueban [555 pruebas aisladas](suite-N17-isolated.txt). El [análisis](analysis-N17-isolated.txt) informa cero problemas. Las [31 pruebas del ciclo de venta](N17-history-after-fix.txt) incluyen siete casos nuevos. La API aprueba [seis pruebas del servicio](N17-api-service-tests.txt), [TypeScript](N17-api-typecheck.txt) y [compilación Nest](N17-api-build.txt). Un archivo vacío de TypeScript representa la ejecución aprobada sin mensajes; no representa ausencia de ejecución.

Node 24.21.0 ejecuta el [instrumento de lectura](../../../apps/umi-pos/tool/estacion_history_query.mjs). Usa PostgreSQL 17.10, el rol API con RLS y transacciones de lectura. Su postura observada es `read committed`. Ese aislamiento no asegura un instante único entre la selección y la expansión de las ventas. La [investigación](N17-query-evidence.md) explica la distinción entre aislamiento y orden de respuestas.

El instrumento necesita leer la configuración privada. `/proc` no contiene las variables que el proceso carga después desde `.env`. El paquete `dotenv` tampoco está disponible como dependencia directa. La corrección usa [`util.parseEnv`](https://nodejs.org/download/release/v24.21.0/docs/api/util.html#utilparseenvcontent), estable desde Node 24.10.0. El lector web bloquea la ruta `latest-v24.x`; curl recupera la documentación de 24.21.0. No se instala un paquete ni se imprime un secreto. Node usa su licencia de distribución, encabezada por MIT; la [licencia de la versión](https://github.com/nodejs/node/blob/v24.21.0/LICENSE) enumera sus componentes.

Los registros distinguen la fuente del árbol actual y el archivo compilado ejecutado. El registro anterior corresponde al archivo compilado anterior, aunque la fuente ya estaba en edición. Su SHA-256 identifica ese archivo. La huella del lanzador ELF no identifica el código Dart. El [registro nativo](N17-final-source.json) incluye la huella AOT de `libapp.so`.

La primera prueba no compila porque el instrumento usa una categoría de error inexistente. Se corrige a `transport` antes de registrar los cuatro fallos de comportamiento. La primera inspección AT-SPI espera un nombre aislado; el registro real combina título, importe y fecha. El [primer registro](N17-native-check-first.txt) conserva esa condición. La captura [de revisión](N17-native-first-query-review/screen.png) ya muestra Croissant.

El [segundo recorrido](N17-native-check-second.txt) intenta un control inexistente, «Ventas pagadas». La superficie ofrece Todas, Suspendidas y Canceladas. La espera vence antes de pulsar. El [recorrido final](N17-native-check-final.txt) busca Latte mediante Todas y comprueba el resultado real. Estos fallos del instrumento no se atribuyen a la aplicación. Los registros conservan los espacios originales de la salida CLI. La comprobación de espacios informa esos registros; la comprobación de código y Markdown pasa.

## Crítica acumulativa

La relación entre forma y acción permanece como criterio. Ventas es un destino persistente, con opciones ancladas y selección visible. N17 mejora la relación entre el nombre que se ve y la búsqueda que se hace. Los colores UMI y la dirección visual propia permanecen.

El marco artístico de Garcin sigue vigente: expresión y lectura deben convivir. Su obra inspira la crítica, pero no demuestra la eficacia de un POS. N17 no añade puntos visuales por corregir consultas. La calidad visual conserva 8.2.

La media ponderada es **8.02 → 8.0**. G56 cierra para los productos comprobados. G55 cierra en el alcance automatizado de solicitudes. G57 cierra para el error de lectura y el reintento comprobados. El texto aumentado nativo, la voz, el IME, los dispositivos físicos, las tareas secundarias y el arranque frío permanecen abiertos. N17 no cumple 10.0.
