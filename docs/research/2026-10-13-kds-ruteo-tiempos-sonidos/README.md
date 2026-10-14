# KDS: ruteo, tiempos y sonidos

Fecha: 2026-10-13. Ventana: documentación pública consultada ese día.

Pregunta: ¿qué configuración necesita Cocina para explicar dónde llega cada platillo?

Esta investigación informa el diseño del módulo Cocina. Incluye siete competidores: Toast, Square, Lightspeed, Fresh KDS, Soft Restaurant, Parrot y Fudo.

## Método y herramientas

**Hecho medido:** Playwright 1.62.1 condujo Chromium 153.0.8010.52 mediante CDP 1.3 en el puerto 9222. Node fue 24.21.0 y Prettier 3.9.4.
El navegador real ya estaba activo. Se usó una pestaña propia, sin cambiar la sesión del dashboard.

**Hecho documentado:** [Playwright recomienda `connectOverCDP`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) para conectar Chromium existente.
La fuente local es [el playbook](../../development/LOCAL_VERIFICATION_PLAYBOOK.md) y `scripts/ux-browser.sh`.
Playwright usa licencia Apache-2.0. El repositorio ya fija esta dependencia; no hubo instalación ni servidor adicional.

**Hecho medido:** las diez páginas de la primera captura respondieron HTTP 200 en Chromium. El registro está en `/tmp/umi-kds-market-capture.json`.
Las capturas muestran documentación pública renderizada. Las imágenes del proveedor muestran pantallas de ejemplo; no prueban un flujo en una cuenta comercial.
El [índice](assets/INDEX.md) identifica cada imagen y su fuente.

**Decisión metodológica:** se priorizó documentación del proveedor, guía técnica y capturas. No se hizo una encuesta de reseñas.
Los requisitos son configuración operativa, no satisfacción del cliente. Tampoco se compraron licencias de los competidores.

Etiquetas: **HD** = hecho documentado con fuente; **LC** = lectura de captura; **I** = inferencia para Umi; **NV** = NO VERIFICADO.
Todas las celdas de la tabla tienen una etiqueta. NV no significa que la función no exista.

## Comparación

| Producto           | Categoría y producto                                                                      | Prioridad                                                               | Tiempo objetivo y vencimiento                                         | Sonido y silencio                                                                                | Platillo sin ruta                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Toast              | HD: herencia menú/grupo y excepción por producto [T1,T2]                                  | NV: prioridad numérica de reglas                                        | HD: preparación por producto; colores por edad [T3,T4]                | HD: entrada, listo en expo, cambio, anulación. NV: silencio individual de cada evento [T4]       | HD: sin estaciones asignadas va a todas [T2]                        |
| Square             | HD: categorías de cocina con productos asignados. NV: override directo independiente [S1] | NV: prioridad numérica de reglas                                        | HD: umbrales amarillo/rojo por pantalla y preparación escalonada [S2] | HD: entrada on/off en dashboard y KDS [S2]                                                       | NV: fallback automático; HD: comprobar asignación y categorías [S3] |
| Lightspeed KDS 2.0 | HD: selección por ítems y categorías [L1]                                                 | HD: prioridad del pedido. NV: prioridad de reglas [L1]                  | HD: demora y vencido en minutos por estación [L2]                     | HD: campana al entrar; silencio de pestaña/dispositivo. NV: tonos por evento [L2]                | NV: fallback automático                                             |
| Fresh KDS          | HD: el integrador hace ruteo categoría/producto; no es nativo del endpoint [F1]           | HD: función de priorizar pedidos. NV: prioridad numérica de reglas [F2] | HD: transición por pantalla/tipo de orden, configurable [F3]          | HD: tonos separados para entrada, cambios y llegada del cliente. NV: sonido por vencimiento [F4] | HD: destinos los indica el integrador; NV: fallback comercial [F1]  |
| Soft Restaurant    | HD: configuración por producto y monitor en manual. NV: precedencia de categoría [R1]     | NV: prioridad numérica de reglas                                        | HD: tiempos de preparación/alerta por producto y monitor [R1]         | NV: tonos y apagado; HD: monitor del mesero muestra ítem terminado [R1]                          | NV                                                                  |
| Parrot             | HD: nombre y conexión de estación; NV: categoría/producto y precedencia [P1]              | NV                                                                      | NV                                                                    | NV                                                                                               | NV                                                                  |
| Fudo               | HD: áreas asignadas a categorías o productos [U1,U2]                                      | HD: se prioriza por tipo/demora. NV: prioridad numérica de reglas [U3]  | HD: objetivo producto/categoría y límite de muy demorado [U3]         | HD: alertas sonoras on/off; punto titilante al quedar listo [U3]                                 | HD: sin área de impresión el producto no aparece [U3]               |

## Hallazgos por proveedor

### Toast

**HD:** la configuración vive en Kitchen > Kitchen stations > Prep stations. La asignación hereda desde menú y grupo.
Una excepción rompe la herencia de un producto. Esto separa la regla general de la excepción [T1,T2].

**HD:** los tiempos de preparación por producto se expresan en segundos. La función de disparo por tiempo sincroniza preparaciones diferentes [T3].
Este tiempo no equivale al umbral de antigüedad del ticket [T4].

**HD:** el KDS dispone de sonidos por entrada, listo en expo, cambio y anulación [T4].
**LC:** `toast-product-routing.png` muestra el control de herencia en la ficha de producto.
**NV:** no se verificó el catálogo completo de tonos ni el silencio de cada evento en una sesión real.

### Square

**HD:** las categorías de cocina pueden diferir de las categorías comerciales. Se asignan productos y luego se seleccionan categorías por pantalla [S1].
**HD:** timers amarillo y rojo y sonido de entrada se editan tanto en dashboard como en KDS [S2].
**HD:** la solución para órdenes ausentes revisa origen, productos asignados y categorías visibles [S3].
**NV:** el nombre «Items & Categories» no demuestra una regla de override con prioridad numérica.

### Lightspeed

**HD:** al configurar estación se seleccionan ítems o categorías. Los pedidos permiten cambiar su prioridad [L1].
**HD:** la configuración ofrece `Delayed After` y `Late after` en minutos; la señal cambia a naranja o rojo [L2].
**HD:** una entrada produce campana. Su documentación exige volumen, pestaña audible y permiso del navegador [L2].
**LC:** `lightspeed-wait-times-product.png` muestra controles separados para demora y vencido.
**NV:** prioridad del pedido no demuestra prioridad de las reglas de ruteo.

### Fresh KDS

**HD:** la guía del integrador delega categoría/producto al emisor. Cada grupo distinto de ítems requiere una petición con sus destinos [F1].
**HD:** el operador configura tonos distintos para entrada, cambios y llegada del cliente; los cambios se guardan automáticamente [F4].
**HD:** la transición de antigüedad se configura por pantalla y tipo de pedido. Los valores iniciales documentados son cinco y ocho minutos [F3].
**LC:** `fresh-sound-product.png` muestra controles de sonido separados por evento, volumen y `Mute Order Sounds`.
También muestra `Repeat Until Order Acknowledged` desactivado para entrada y llegada del cliente.
**I:** Umi puede usar tonos finitos sin copiar la repetición. El silencio debe ser un control visible del operador.

**Conflicto documentado:** el catálogo actual anuncia ruteo por modificadores [F2], mientras la guía API niega ruteo nativo por categoría/producto [F1].
**I:** son capas o versiones distintas; no extrapolar la ficha comercial a la API. Su relación exacta queda NV.

### México y Latinoamérica

**HD:** el manual oficial de Soft Restaurant 11 documenta tiempos por producto/monitor y un monitor que muestra los productos terminados del mesero [R1].
**NV:** el artículo de personalización sirve un video; no se comprobó su configuración de audio [R2].

**HD:** Parrot documenta conexión y nombre del KDS [P1]. **NV:** esa página no resuelve prioridad, tiempos, audio o fallback.
Se comprobó una segunda ruta, la sección de configuración [P2]. No hubo bloqueo HTTP; hubo un vacío documental.

**HD:** Fudo guarda área por categoría y producto [U1,U2]. Permite objetivo por producto/categoría y un umbral adicional de muy demorado [U3].
**HD:** al terminar un ítem muestra un punto titilante en la mesa. Las alertas sonoras se activan en Administración > Monitor de cocina [U3].
**HD:** activar ese sonido desactiva otras notificaciones de la aplicación [U3]. **I:** Umi debe evitar este efecto secundario.

## Decisión para Umi

**I:** conservar una regla general por categoría y agregar excepciones explícitas por producto. Mostrar en la previsualización la estación y el origen de la regla.
Usar los términos «Por categoría», «Excepción por producto» y «Predeterminada». Explicar que un número menor gana entre reglas equivalentes.

**HD del código:** el [resolver del dashboard](../../../apps/umi-dashboard/src/screens/kitchen-routing-model.js:28) aplica producto, categoría, predeterminada, prioridad ascendente e id.
El [resolver de la API](../../../apps/umi-api/src/modules/kds/kitchen-domain.ts:35) aplica esa precedencia.
El [proyector](../../../apps/umi-api/src/modules/kds/kitchen-projector.ts:161) guarda `target_seconds` de la ruta, con respaldo del producto.
Sin ruta, una línea que requiere preparación queda `exception` [kitchen-domain.ts:66](../../../apps/umi-api/src/modules/kds/kitchen-domain.ts:66).

**I:** separar objetivo de ruta y umbral de estación. El objetivo describe el platillo; el umbral describe la urgencia de la estación.
La UI debe explicar cualquier precedencia temporal que adopte la implementación. Esta investigación no fija una fórmula nueva.

**I:** ofrecer sonidos finitos y distintos por evento, con encendido y tono. Guardar la configuración central y permitir silencio local persistente.
Mostrar texto de vencimiento e ícono además del color.

**HD:** WCAG 2.2, criterio 1.4.1, requiere información adicional al color [W1].
**I:** aplicar ese principio también al Android nativo, sin afirmar certificación WCAG del POS.

**Alternativa finalista:** ruteo sólo por categorías de cocina, como Square. Se rechaza porque obliga a crear categorías artificiales para excepciones del platillo.
**I:** conservar el resolver existente cuesta menos y responde a la pregunta del dueño sin modificar la precedencia.

## Cambios respecto de las investigaciones previas

**Antecedentes consultados:** [inventario POS/KDS del 6 de septiembre](../2026-09-06-restaurant-pos-kds-feature-inventory-research.md),
[arquitectura de clientes](../2026-09-06-pos-kds-client-architecture-vendor-research.md) y
[pausar órdenes del 13 de octubre](../2026-10-13-pausar-orden-competencia/README.md).
El deep dive del 17 de septiembre se consultó para recuperar fuentes; su foco de inventario queda fuera del análisis actual.
Void/refund y volumen de acciones se revisaron para el contexto; no determinan esta configuración.

**Sin cambios:** el backend posee la verdad operativa; estación, expediter y mesero cumplen funciones distintas.
El tiempo de preparación no es una retención manual. El KDS no debe convertirse en dueño comercial de la orden.

**Nuevo:** capturas actuales, separación de objetivo y vencimiento, tonos por evento, vacío documental de Parrot y conflicto de capas en Fresh.

## Rutas, límites y verificaciones pendientes

| Ruta                                        | Resultado observado                            | Alcance                                                                           |
| ------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Toast ayuda y guía técnica                  | HTTP 200 en Chromium                           | Documento y ejemplos; no sesión comercial                                         |
| Square ayuda de ajustes y ruteo             | HTTP 200 en Chromium                           | Texto; sin captura del panel autenticado                                          |
| Lightspeed uso y configuración              | HTTP 200 en Chromium                           | Documentos con imágenes de producto                                               |
| Fresh ficha sonidos y ficha tiempos         | HTTP 200 en Chromium                           | Documentos con imágenes de producto                                               |
| Soft Restaurant artículo y manual oficial   | Artículo HTTP 200; manual HTTP 404 en Chromium | Video no transcrito; texto histórico del manual disponible mediante extractor web |
| softrestaurant.com/recursos/manuales        | HTTP 404 con curl y extractor web              | Segunda ruta del host; manual vivo bloqueado por cambio de URL                    |
| Parrot artículo KDS y sección configuración | HTTP 200                                       | Conexión documentada; campos avanzados NV                                         |
| Fudo artículo KDS y áreas de impresión      | HTTP 200                                       | Documentación pública; sin tenant comercial                                       |

**NV:** changelog exhaustivo de abril a octubre de los siete proveedores. El índice de novedades Fresh se abrió, pero conserva entradas antiguas [F5].
Las fechas recientes de edición de Toast no equivalen a fecha de lanzamiento.
**NV:** encuesta de veinte reseñas, tres fuentes de operadores, escucha de tonos reales y flujos autenticados de competidores.
No se midió latencia ni fiabilidad de esos productos. Ninguna captura de documentación sustituye las pruebas Android y dashboard de Umi.
No hubo host bloqueado en las diez capturas iniciales. El manual oficial falló en la captura adicional.
Se intentó también el índice de manuales y dio 404. El extractor devolvió texto histórico del manual, no una descarga viva.
Las afirmaciones de Soft Restaurant corresponden al manual 11; su vigencia en 12 queda NV.
CodeGraph no estuvo disponible como herramienta invocable; `rg` y lectura directa identificaron los archivos de Umi.

## Fuentes primarias

- T1: [Toast, estaciones](https://support.toasttab.com/en/article/Prep-Stations-Basics).
- T2: [Toast, herencia y ruta ausente](https://doc.toasttab.com/doc/platformguide/adminAssigningPrepStationsMenuBuilder.html).
- T3: [Toast, preparación por tiempo](https://support.toasttab.com/en/article/Item-Fire-by-Prep-Time).
- T4: [Toast, referencia KDS](https://doc.toasttab.com/doc/platformguide/adminKdsConfigQuickRef.html).
- S1: [Square, categorías](https://squareup.com/help/gb/en/article/8170-filter-orders-by-category-with-square-kds).
- S2: [Square, timers y sonidos](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android).
- S3: [Square, órdenes ausentes](https://squareup.com/help/us/en/article/8103-troubleshoot-missing-orders-with-square-kds).
- L1: [Lightspeed, configuración](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22168531609499-Setting-up-the-Kitchen-Display-System-2-0).
- L2: [Lightspeed, uso y tiempos](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0).
- F1: [Fresh, guía del integrador](https://www.fresh.technology/kds/developer-guide).
- F2: [Fresh, catálogo de funciones](https://www.fresh.technology/es/kds-features/sounds).
- F3: [Fresh, tiempos de transición](https://help.freshkds.com/en/articles/2437578-how-do-i-change-caution-and-late-ticket-times).
- F4: [Fresh, tonos](https://help.freshkds.com/en/articles/2437581-can-i-change-the-notification-sound).
- F5: [Fresh, índice de novedades](https://help.freshkds.com/en/collections/3232375-release-notes).
- R1: [Soft Restaurant, manual oficial 11](https://softrestaurant.com/recursos/manuales?download=193%3Ades-mnl-sr11-manual-de-usuario-soft-restaurant-11-v1-0&start=25).
- R2: [Soft Restaurant, personalización](https://softrestaurant.zohodesk.com/portal/es/kb/articles/4-personalizaci%C3%B3n-del-monitor-de-producci%C3%B3n).
- P1: [Parrot, KDS](https://soporte.parrotsoftware.com.mx/es_MX/configuracion-de-pos/conecta-tu-kds-kitchen-display-system).
- P2: [Parrot, configuración POS](https://soporte.parrotsoftware.com.mx/es_MX/configuracion-de-pos).
- U1: [Fudo, áreas](https://soporte.fu.do/es/articles/11730988-areas-de-impresion).
- U2: [Fudo, categorías](https://soporte.fu.do/es/articles/11730923-categorias-de-productos).
- U3: [Fudo, KDS](https://soporte.fu.do/es/articles/11730998-sistema-de-monitor-de-cocina-kds).
- W1: [W3C, WCAG 2.2, uso del color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).
