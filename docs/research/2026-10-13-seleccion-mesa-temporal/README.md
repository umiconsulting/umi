# Selección de mesa, mesa improvisada y salida después del pago

Fecha: 2026-10-13. Pregunta: ¿cómo debe asignar el operador una mesa disponible desde una cuenta?

Decisión informada: un selector con mapa, estado y acciones físicas explícitas. Alcance: cuatro competidores solicitados, Toast, Square, Lightspeed y Fudo. Ventana: documentación pública vigente consultada hoy. Esta ampliación no cubre todo el historial de seis meses.

Etiquetas: **HD** = hecho documentado; **LC** = lectura de captura; **HL** = hecho local; **I** = inferencia/propuesta para Umi; **NV** = NO VERIFICADO.

## Hallazgo principal

**HD:** Lightspeed Reservations distingue Paid, cuando el cliente pagó y permanece sentado, de Departed, cuando salió [L1]. Toast Tables distingue Paid, Dirty y Available, con cambios manuales [T1]. **I:** el pago no demuestra disponibilidad física. La rapidez debe venir de acciones visibles, sin liberar una mesa que todavía tiene clientes o cuentas activas.

| Capacidad                | Toast                                            | Square                                                                           | Lightspeed                                             | Fudo                                                                             |
| ------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Selección visual         | HD: plano y asignación de mesas [T1]             | HD: tocar mesa en plano del portátil [S1]                                        | HD: elegir plano, mesa y Apply [L1]                    | HD: mesa libre o búsqueda por número [F1]                                        |
| Ocupación y cobro        | HD: Paid separado de Dirty/Available [T1]        | HD: comensales ocupan mesa antes de añadir productos [S2]; NV: salida tras pagar | HD: Paid separado de Departed en Reservations [L1]     | HD: abierta roja con venta en curso [F1]; NV: cliente sentado después del cierre |
| Liberar/limpiar          | HD: Make Available y Mark as Dirty manuales [T1] | NV: limpieza física manual en estas fuentes                                      | HD: estado Departed; NV: botón de limpieza física [L1] | NV: estado de limpieza física en estas fuentes                                   |
| Añadir mesa física       | NV: creación rápida durante asignación           | HD: editor de plano/secciones [S2]; NV: mesa temporal                            | NV: mesa temporal desde asignación                     | HD: casilla del editor administrativo [F2]; NV: temporal durante servicio        |
| Mesa virtual improvisada | NV                                               | NV                                                                               | NV                                                     | NV                                                                               |

**I:** la ausencia de una función en las fuentes no prueba que el proveedor carezca de ella. La separación física/virtual propuesta abajo pertenece a Umi.

## Fuentes y capturas

- **HD [T1]:** [Use Toast Tables](https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist), actualizado 2026-09-28. Toast Tables es una aplicación separada de Toast POS. La captura pública está en `assets/toast-estados.png`.
- **HD [S1]:** [Square, pedido en mesa desde portátil](https://squareup.com/help/us/en/article/8152-take-orders-tableside-with-square-for-restaurants-mobile-pos). La captura de la guía está en `assets/square-seleccion.png`.
- **HD [S2]:** [Square, Create a floor plan](https://squareup.com/help/us/en/article/6427-building-your-floor-plan). Configuración de secciones y mesas; una mesa se ocupa al indicar comensales. La [investigación previa](../2026-10-12-first-use-no-tables.md) conserva captura del editor.
- **HD [L1]:** [Using Lightspeed Reservations on the POS](https://k-series-support.lightspeedhq.com/hc/en-us/articles/45815052598683-Using-Lightspeed-Reservations-on-the-POS). No se extrapola Reservations al POS básico sin ese módulo. Captura: `assets/lightspeed-pagado-ocupado.png`.
- **HD [F1]:** [Fudo, Abrir mesas](https://soporte.fu.do/es/articles/11730839-1-abrir-mesas), fechado 2025-08-21. Captura: `assets/fudo-abrir-mesa.png`.
- **HD [F2]:** [Fudo, Salas y mesas](https://soporte.fu.do/es/articles/11730986-salas-y-mesas), fechado 2025-10-21. El editor crea mesas consecutivas; eliminar una con ventas tiene consecuencias documentadas. Captura: `assets/fudo-crear-mesa.png`.

**LC:** las capturas muestran documentación renderizada y ejemplos publicados. No son pruebas con una licencia comercial autenticada.

## Diagnóstico local previo a implementación

**HL:** el camino vigente es `_chooseOrderTable`, en [catalog_surface.dart](../../../apps/umi-pos/lib/features/catalog/catalog_surface.dart), líneas 196–244. Carga el plano y llama a `showOrderTablePicker` con áreas y creación inicial. No le pasa estados físicos.

**HL:** [order_table_picker.dart](../../../apps/umi-pos/lib/features/tables/order_table_picker.dart), línea 206, dibuja una cuadrícula. El `AccountTablePicker` de [account_details_surface.dart](../../../apps/umi-pos/lib/features/cart/account_details_surface.dart), línea 90, es otro selector; no se encontró callsite vigente. La implementación debe cambiar el camino usado realmente.

**HL:** la creación inicial no sirve para añadir siempre otra mesa. `bootstrapTables` rechaza `FLOOR_PLAN_ALREADY_CONFIGURED` si ya existe una mesa publicada: [floor-plan.repository.ts](../../../apps/umi-api/src/modules/floor-plan/floor-plan.repository.ts), líneas 190–192.

**HL:** `clear` hace salir al grupo y deja las mesas `dirty`: [table-map.repository.ts](../../../apps/umi-api/src/modules/table-map/table-map.repository.ts). `openTable` marca disponible y rechaza si existe `seated_at`. La inspección posterior confirmó la protección existente en [018_pos_table_accounts.sql](../../migration/build-v3/migrations/018_pos_table_accounts.sql): `table_state_visit_guard` rechaza la salida con `TABLE_HAS_OPEN_ACCOUNT`. El UPDATE del grupo se revierte si un miembro conserva una cuenta abierta. **I:** se reutiliza esta protección; la nueva UI también muestra el folio que impide liberar.

**HL:** el panel existente reúne las acciones con permiso `sale.lifecycle`: [floor_plan_surface.dart](../../../apps/umi-pos/lib/features/tables/floor_plan_surface.dart), líneas 1273–1344. **I:** reutilizar esas operaciones y su controlador evita otra lógica física en el selector.

## Propuesta mínima

**I:** el selector muestra el plano publicado, selector de área, leyenda y nombre/estado de cada mesa. Tocar selecciona; el panel explica el estado. «Asignar mesa» confirma el destino. Una cuenta activa ajena bloquea asignación automática y ofrece consultar su información, sin tomarla ni mezclarla.

**I:** mantener «Agregar mesa» visible durante la operación, además del estado inicial vacío. Separar dos resultados:

1. **Mesa física adicional:** representa una mesa real improvisada. Necesita ID canónico, ubicación y capacidad mínima. La escritura debe añadir sin reemplazar el plano ni cambiar otras mesas. Conservar su historial; retirar sólo cuando esté libre y sin cuentas activas.
2. **Cuenta sin mesa:** conserva el folio y admite nombre opcional, por ejemplo «Terraza extra». No ocupa el mapa físico. Una cuenta sin mesa no implica «Para llevar». Mostrar «Sin mesa» para evitar prometer una mesa física inexistente.

**I:** no llamar «temporal» a una mesa persistente si el servidor no guarda su temporalidad y retiro. Reutilizar creación aditiva si existe una operación segura; crear ese contrato sólo si es necesario. No borrar el recurso al pagar.

**I:** para una mesa ocupada y pagada, «Los clientes se fueron» pasa a «Por limpiar». Para una mesa por limpiar, «Marcar limpia» pasa a disponible. Esas acciones viven en el selector y reutilizan el controlador actual. «Usar mesa» confirma después la selección, con otra lectura de la sala y las validaciones actuales de apertura/asignación. No se presenta limpieza y asignación como una operación atómica.

**I:** una liberación exige comprobar todas las cuentas activas del grupo, permisos y versión en servidor. Si hay una cuenta activa, no liberar: mostrar el folio. No cancelar, pagar ni mover cuentas como efecto oculto de limpiar una mesa.

**I:** alternativa segunda: representar todo con mesas virtuales en el mapa. Se rechaza porque mezcla ubicación física con identificación comercial. La lista de cuentas ya representa correctamente lo que no ocupa una mesa real.

## Método, rutas y límites

**HL:** se reutilizaron las guías research/market-research, sus procedimientos y canales. Herramientas existentes: `rg`, Playwright 1.62.1 (Apache-2.0), Chromium 153.0.8010.52, CDP 1.3, Node 24.21.0 y Prettier 3.9.4. La [API oficial de Playwright](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) recomienda el método de conexión usado. No hubo instalación ni solución de captura manual.

**HL:** las cinco páginas capturadas respondieron HTTP 200 en Chromium. Se abrió una pestaña propia y se cerró únicamente esa pestaña. El [índice](assets/INDEX.md) conserva rutas reproducibles.

| Investigación sin resultado concluyente     | Intento 1                                            | Intento 2                                               |
| ------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Mesas temporales en los cuatro proveedores  | búsqueda por dominio y frase: sin resultado primario | guías de plano/asignación/creación: función temporal NV |
| Liberación física tras cobro en Square/Fudo | búsqueda de estado ocupado/pagado: insuficiente      | fuentes S2/F1/F2: limpieza física NV                    |

**NV:** no se ejecutó encuesta de veinte reseñas, auditoría completa de novedades de seis meses, tres fuentes de practicantes ni norma de limpieza física. Esos pasos quedan pendientes; no se simula cumplimiento. CodeGraph no está disponible; se usó `rg`. No se probó esta UX en el iMin ni en las tablets en esta investigación. No se modificó producto, base o terminales.

**HL:** se leyeron los pases anteriores [primer uso](../2026-10-12-first-use-no-tables.md), [cuentas sin mesa](../2026-10-12-tableless-visual-flow.md) y [mapa/trazabilidad](../2026-09-13-pos-table-map-and-order-traceability.md). **I:** se conservan mesa opcional, cuenta persistente y separación cobro/salida. El pedido actual sustituye la cuadrícula del selector por mapa y pide acceso permanente a añadir mesa. La decisión posterior del dueño mantiene folio como título; no se retoma la antigua propuesta de relegarlo.
