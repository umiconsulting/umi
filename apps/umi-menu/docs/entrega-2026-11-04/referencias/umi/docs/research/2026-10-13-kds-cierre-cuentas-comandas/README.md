# Cierre de cuentas y resolución de comandas

Fecha: 2026-10-13. Ventana de evidencia: documentación pública consultada hoy; revisión de novedades entre 2026-04-13 y 2026-10-13, con las lagunas indicadas abajo.

Pregunta: ¿qué operación debe resolver una comanda pendiente cuando su cuenta comercial ya está cerrada?

Esta investigación informa la separación entre cierre comercial y resolución operativa del KDS. Compara **cuatro** competidores solicitados: Toast, Square, Lightspeed KDS 2.0 y Fresh KDS. Los proveedores mexicanos del [estudio anterior](../2026-10-13-kds-ruteo-tiempos-sonidos/README.md) quedan fuera de esta ampliación puntual; sus conclusiones de ruteo siguen vigentes.

Etiquetas: **HD** = hecho documentado; **LC** = lectura de captura; **HL** = hecho local observado; **I** = inferencia o propuesta para Umi; **NV** = NO VERIFICADO. NV no significa que una función no exista.

## Respuesta práctica

**HD:** cobrar no demuestra que cocina terminó. El ejemplo oficial de Toast paga la orden antes de preparar y completar sus productos [T1]. **I:** por eso puede haber cero cuentas comerciales abiertas y trabajo operativo pendiente. Una comanda antigua activa exige resolución explícita; no debe desaparecer sólo por el pago.

**HD:** los cuatro proveedores documentan completar productos individuales [T1,S1,L1,F1]. **I:** un producto válido de Cocina debe poder quedar listo aunque otros productos de la misma orden tengan una excepción de ruteo. Eso no significa declarar lista toda la orden.

**HD:** Lightspeed limpia al terminar el turno los tickets **ya completados** [L1]. Toast conserva los anulados identificados como tales en KDS [T2]. **NV:** no se comprobó en estos cuatro una regla universal que borre automáticamente todos los pendientes al cierre diario, ni un botón exactamente llamado «Descartar» para cancelar su aviso.

## Comparación documentada

| Capacidad                                          | Toast                                                       | Square                                                                                     | Lightspeed KDS 2.0                                                                                             | Fresh KDS                                                              |
| -------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Pago/cierre separado de preparación                | HD: ejemplo pagado antes de preparar [T1]                   | NV: garantía general de cierre comercial; HD: completion configurable por dispositivo [S1] | NV: regla comercial universal; HD: estados operativos propios [L1]                                             | NV: vínculo universal con pago del POS                                 |
| Completar un ítem mientras otros siguen pendientes | HD: Curry Bread listo mientras Ramen pendiente [T1]         | HD: ítem o ticket; alcance una pantalla o todas [S1]                                       | HD: acción por producto; ticket verde cuando todos listos [L1]                                                 | HD: tachar producto/modificador; limpiar cabecera al finalizar [F1,F2] |
| Archivo / recuperación                             | HD: ticket sale de estación al completar sus productos [T1] | HD: Completed y Recall [S1]                                                                | HD: Completed; Undo durante cinco segundos [L1]                                                                | HD: limpiar cabecera; Recall si se limpió antes de tiempo [F2]         |
| Autoarchivo de fin de día/turno                    | NV: pendientes                                              | NV: pendientes                                                                             | HD: limpia completados al fin de turno señalado por POS; NV: pendientes [L1]                                   | NV: fin de día                                                         |
| Cancelado visible / reconocimiento                 | HD: VOIDED y tachado en KDS; NV: descarte/ack [T2]          | NV: descarte/ack en KDS                                                                    | HD: Canceled rojo; cambios parpadean hasta confirmar por pantalla; NV: descarte específico de cancelación [L1] | NV: descarte/ack de cancelación                                        |

## Fuentes primarias y capturas

- **HD [T1]:** [Toast, KDS workflow using new KDS view](https://dev.toasttab.com/doc/platformguide/platformGridKDSWorkflow.html). Pasos de pago, preparación por producto y finalización en expediter. **LC:** documentación renderizada en `assets/toast-flujo-pago.png`.
- **HD [T2]:** [Toast, Void an order](https://dev.toasttab.com/doc/devguide/apiVoidOrder.html), sección de visualización en KDS. El endpoint explicado tiene restricciones de pago; no extrapolamos sus permisos a cualquier devolución. **LC:** `assets/toast-cancelacion.png` muestra el ejemplo de anulados.
- **HD [S1]:** [Square, Complete and recall orders with Square KDS](https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds). La configuración distingue preparación y expo, y finalización en dispositivo individual o todos. **LC:** `assets/square-completar.png`.
- **HD [L1]:** [Lightspeed, Using the Kitchen Display System 2.0](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0). Secciones Order Status Filter, Changing the order status y Order alerts. **LC:** `assets/lightspeed-estados-archivo.png`.
- **HD [F1]:** [Fresh KDS, How do I mark items as complete?](https://help.freshkds.com/en/articles/6383865-how-do-i-mark-items-as-complete), fechado 2025-07-28. **LC:** `assets/fresh-completar-items.png` muestra producto tachado.
- **HD [F2]:** [Fresh KDS, How do I clear orders?](https://help.freshkds.com/en/articles/6383990-how-do-i-clear-orders), fechado 2025-07-28. **LC:** `assets/fresh-limpiar-ordenes.png`.

**HL:** las seis páginas respondieron HTTP 200 en Chromium. Las capturas son páginas públicas con ejemplos del proveedor, no ejecución de una licencia comercial. El [índice](assets/INDEX.md) fija URL, dispositivo y ruta reproducible.

## Qué explica Cuenta 004 en Umi

**HL:** la [evidencia SQL de lectura](../../reports/evidence/2026-10-13-aviso-cuenta-liberada/comandas-anteriores-readonly.txt), tomada a las 21:21 UTC, registra Cuenta 004 pagada/`committed`, con Capuccino ruteado a Cocina y otros dos ítems en `exception`, sin estación (`missing_route`). Las cuentas 070/071 estaban comercialmente canceladas pero seguían en cola KDS. El [diagnóstico detallado](../../reports/2026-10-13-comandas-anteriores-diagnostico.md) conserva consultas y límites.

**HL:** en la revisión anterior a la corrección de este turno, la validación del estado agregado ocurría antes del cambio por ítem: [kds.repository.ts](../../../apps/umi-api/src/modules/kds/kds.repository.ts), líneas 1637–1655. El dominio permite `exception → in_preparation`, pero no `exception → ready`: [kitchen-domain.ts](../../../apps/umi-api/src/modules/kds/kitchen-domain.ts), líneas 86–102. Por eso «Preparar» podía pasar y «Listo» rechazarse aunque el producto seleccionado fuese válido. **I:** es una validación propia de Umi; las fuentes comparadas no justifican bloquear ese producto por otros sin ruta. Esta nota no certifica la corrección posterior del agente de implementación.

**HL:** `deriveKitchenOrderStatus` conserva `exception` si queda cualquier ítem en excepción: [kitchen-domain.ts](../../../apps/umi-api/src/modules/kds/kitchen-domain.ts), líneas 77–83. **I:** completar el producto válido debe conservar esa información pendiente en la orden.

**HL:** `sweepCarriedOverAccounts` sólo opera con `auto_void`, sobre carritos anteriores en estados elegibles; excluye ventas comprometidas y cuentas ya canceladas. Actualiza carrito/mesa, sin resolver KDS: [pos-cart.repository.ts](../../../apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts), líneas 223–277. **HL:** el diagnóstico de lectura encontró política Manual. No se modificó esa configuración.

## Novedades y contradicciones

**HD:** Square documenta coordinación de tiempos entre estaciones en [v7.18, 2026-07-30](https://squareup.com/us/en/release-notes/release-notes-july-30th?country_redirection=true). Esto no prueba limpieza diaria. Lightspeed publicó [restauración de configuración KDS en julio de 2026](https://k-series-support.lightspeedhq.com/hc/en-us/articles/53360315506587-What-s-New-July-2026-Easier-guest-bookings-customizable-upsells-and-more); tampoco implica resolver tickets pendientes.

**HD:** el [changelog de API de Toast](https://dev.toasttab.com/doc/relnotes/devPortalApiChangeLog.html) tiene entradas de abril/mayo de 2026 y remite a un nuevo portal. **NV:** no se cubrió todo el semestre del nuevo portal ni una modificación reciente de limpieza KDS. El [índice de Fresh](https://help.freshkds.com/en/collections/3232375-release-notes), HTTP 200 en navegador, enumera 253 artículos, pero no confirma por sí solo sus fechas. **NV:** cobertura completa del semestre en Fresh y Lightspeed. Se evita presentar la lectura puntual como seguimiento exhaustivo.

**HD:** el [foro de Square de agosto de 2023/abril de 2024](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Square-KDS-order-clearing/td-p/677700) decía que no existía finalización independiente por dispositivo. La ayuda actual [S1] sí la documenta. **I:** prevalece la documentación actual; el foro antiguo no describe el producto de hoy. **NV:** un [reporte de usuario de 2025 sobre falta de sincronización con la app](https://community.squareup.com/t5/Feature-Requests/KDS-and-Square-App-Order-Sync/idi-p/804085) no demuestra una limitación vigente para todos los flujos.

## Rutas, método y límites

**HL:** se aplicaron [research](../../../.agents/skills/research/SKILL.md) y [market-research](../../../.agents/skills/market-research/SKILL.md), incluyendo procedimiento y canales. Herramientas existentes: Playwright 1.62.1, Chromium 153.0.8010.52, CDP 1.3, Node 24.21.0, Prettier 3.9.4; versiones registradas en la [nota técnica](../2026-10-13-jornada-correcciones-herramientas.md). [Playwright documenta `connectOverCDP`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp). Se abrió y cerró únicamente una pestaña propia del navegador existente; no se navegó la pantalla ONCA.

| Host / ruta                                   | Primer intento                                                 | Segundo intento / salida                                            |
| --------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `help.freshkds.com`, artículos F1/F2          | `web.open`: Internal Error, sin HTTP expuesto, ambos artículos | Chromium/CDP: HTTP 200, lectura y captura                           |
| `help.freshkds.com`, release notes            | `web.open`: Internal Error, sin HTTP expuesto                  | Chromium/CDP: HTTP 200, índice leído; fechas del semestre NV        |
| `community.squareup.com`, dos hilos enlazados | búsqueda web: contenido legible                                | Chromium/CDP: HTTP 200; evidencia histórica secundaria              |
| búsquedas Fresh de cancelación/autolimpieza   | búsqueda por host: sin resultado primario concluyente          | colecciones Display Settings y Orders: HTTP 200; función buscada NV |

**HL:** CodeGraph no estaba disponible; se usó `rg` y lectura de los módulos locales. **NV:** no se realizó muestra de 20 reseñas; sólo se contrastaron los dos hilos públicos anteriores. No se atribuye ese faltante a un bloqueo HTTP. No se cubrieron tres fuentes de practicantes ni una norma aplicable a limpieza KDS; esos pasos del procedimiento quedan sin cumplir. No se probó pago/cancelación en una licencia de competidor, ni comportamiento sin red o al cambiar fecha en esos productos. El alcance es evidencia primaria puntual para esta decisión operativa.

## Decisión propuesta y alternativa

**I:** mantener separados cobro y cocina. Permitir acciones sobre los ítems válidos de la estación, conservando excepciones. Para canceladas, presentar «Cancelado» y sólo una acción explícita de reconocimiento/descarte con permiso y auditoría; no simular su preparación. Ésta es propuesta para Umi, no un botón idéntico verificado en los cuatro proveedores. Para trabajo antiguo todavía válido, ofrecer resolución operativa autorizada con motivo, sin alterar ventas pagadas ni declarar pendientes como preparados.

**I:** alternativa segunda: ocultar todas las comandas de días anteriores. Se rechaza como corrección inicial porque puede esconder preparación pendiente y errores de ruteo sin resolverlos. Un archivo diario configurable podría evaluarse después, definiendo alcance, auditoría y recuperación; requiere decisión del dueño y no se aplicó aquí.

**HL:** sin cambios respecto del estudio anterior: precedencia producto/categoría, configuración de estaciones, sonidos y umbrales. **I:** esta ampliación añade la separación comercial/operativa y fundamenta resolver por ítem. No se cambió producto, base, política Manual ni terminales en esta investigación.
