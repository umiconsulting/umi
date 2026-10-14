# Primer uso sin mesas

Consulta: 2026-10-12. Pregunta: ¿cómo permiten los competidores empezar cuando todavía no existen mesas?
Decisión: ofrecer creación sencilla de mesas y mantener la operación sin mesa disponible.
Alcance: cinco proveedores; documentación pública vigente al consultar. No se probaron cuentas nuevas autenticadas.

## Evidencia comparada

Cada fila indica hechos documentados. «No verificado» significa que las fuentes consultadas no resuelven esa capacidad.

| Proveedor | Preparación documentada                                                                          | Generación por cantidad                        | Primer inicio del POS sin mesas                                                             |
| --------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Square    | Dashboard: crear plano, sección y mesas                                                          | Sí: cantidad y nombres automáticos por sección | Asistente específico no verificado                                                          |
| Fudo      | Administración: crear sala y tocar casillas para añadir mesas con numeración consecutiva         | No verificado                                  | Asistente específico no verificado                                                          |
| Toast     | Toast Web: bienvenida, recorrido opcional y lista de configuración; editor de mesas por arrastre | No verificado                                  | Quick Order permite una cuenta sin mesa; estado inicial vacío no verificado                 |
| REVO XEF  | Back-office: salas; arrastrar y duplicar mesas; sincronizar app                                  | No verificado                                  | App ofrece modos de mesas virtuales y servicio en barra; estado inicial vacío no verificado |
| PoloTab   | Portal: mesas por zona y prefijo; guardar y refrescar POS                                        | Campo de cantidad no verificado                | Guía de instalación configura Comanda como pantalla inicial; puede cambiarse después        |

**Hecho documentado, Square.** La sección admite cantidad y nombres automáticos. El dibujo del plano ocurre después.
[Crear plano](https://squareup.com/help/us/en/article/6427-building-your-floor-plan).

**Hecho documentado, Square.** La guía actual de migración dice que los modos full service y bar permiten personalizar el plano desde el POS.
Esto no confirma un asistente de creación desde cero ni la generación por cantidad desde el equipo.
[Modos actuales](https://squareup.com/help/us/en/article/8569-switch-to-the-new-square-subscription-plans).

**Hecho documentado, Fudo.** Seleccionar una casilla crea una mesa. Después puede cambiarse forma, tamaño, posición y número.
[Salas y mesas](https://soporte.fu.do/es/articles/11730986-salas-y-mesas).
[Captura del editor vacío](2026-10-12-first-use-no-tables/assets/fudo-product-4.png).
La imagen captura un instante del GIF oficial; no demuestra un estado de primer encendido.

**Hecho documentado, Toast.** El primer ingreso a Toast Web ofrece guía y lista de configuración adaptadas al negocio.
Puede cerrarse el recorrido. El editor de mesas permite arrastrar elementos, guardar y publicar.
[Inicio](https://support.toasttab.com/en/article/Self-Service-Guide),
[Editor](https://support.toasttab.com/en/article/Creating-Service-Areas-and-Table-Setup-1493049150430?lang=en_US).
La cuenta sin mesa usa New order en el POS.
[Operación](https://support.toasttab.com/en/article/New-POS-Managing-Tables).

**Hecho documentado, REVO.** Su guía inicial incluye preparar el plano en el back-office y sincronizar la aplicación.
La documentación recomienda duplicar mesas para agilizar su creación.
[Primeros pasos](https://support.revo.works/es/articles/125), [Salas](https://support.revo.works/es/articles/103).
Los modos virtual y barra se configuran por dispositivo.
[Virtual](https://support.revo.works/es/articles/711), [Barra](https://support.revo.works/es/articles/712),
[Preferencias](https://support.revo.works/es/articles/118).

**Hecho documentado, PoloTab.** La instalación empieza por activación; configura Comanda como pantalla inicial.
Las mesas se preparan en el portal. La guía pide conocer zonas y cantidad, pero no muestra un campo de cantidad.
[Instalación](https://www.polotab.com/soporte/instalar-tu-punto-de-venta),
[Crear mesas](https://www.polotab.com/soporte/crear-mesas).

**No verificado para los cinco.** Mesas de demostración automáticas y asistente específico del POS al detectar cero mesas.
Las fuentes muestran preparación y alternativas operativas; no prueban ausencia de otras funciones.

## Decisión para Umi

**Preferencia del usuario.** Crear mesas al tocar casillas. Después ofrecer una cuadrícula de todas las mesas y un plano cuando exista distribución.

**Inferencia para Umi.** Separar la creación de mesas de la operación evita que tocar un espacio cree mesas durante el servicio.
La instrucción posterior del usuario precisa el recorrido:

1. En el POS portátil, pedir el tipo de pedido al iniciar una cuenta.
2. Para «Comer aquí», pedir la mesa antes de elegir productos.
3. Si no existen mesas, mostrar casillas para crear las primeras mesas y después seleccionar una.
4. En el POS fijo, exigir mesa para «Comer aquí» antes de abrir el cobro.
5. Mostrar todas las mesas en una cuadrícula y permitir consultar el plano guardado.

**Inferencia para Umi.** Ambas vistas deben usar las mismas mesas, cuentas y estados.
Crear mesas debe ser posible sin exigir formas, capacidades, zonas o dibujo completo.
La implementación publica una distribución inicial con las posiciones de las casillas seleccionadas.
La creación inicial usa un permiso limitado de operación; la edición posterior conserva los permisos de administración.

**Alternativa.** Pedir una cantidad y generar todas las mesas, como Square.
Es útil para muchas mesas. Se conserva como opción futura porque Juan prefirió la creación por casillas.

**Continuidad.** Se conservan cuentas abiertas y envío independiente de cobro.
«Para llevar» continúa sin mesa. Las cuentas existentes conservan su recuperación.
Este pase amplía [flujos sin mesa](2026-10-12-tableless-visual-flow.md) y [PoloTab](2026-10-12-polotab-menu.md).
Añade preparación inicial y el criterio de dos vistas.
La implementación y su evidencia se registran en [el informe de verificación](../reports/2026-10-12-order-entry.md).

## Instrumentos, capturas y límites

**Hecho del instrumento.** Playwright 1.62.1, Apache-2.0, usó Chromium 153.0.8010.52 mediante CDP en DISPLAY=:0.
Ambos estaban instalados. Se usó un contexto propio sin modificar las sesiones existentes.
La búsqueda web localizó fuentes; el navegador capturó las páginas y los GIF renderizados.
El [índice](2026-10-12-first-use-no-tables/assets/INDEX.md) identifica las capturas.

**Registro de rutas.** `routes.json` y `routes-extra.json` conservan URLs, respuestas y errores.
Square y PoloTab publican estas instrucciones sin capturas del editor correspondiente; se capturó la página documental.
Las pantallas autenticadas de primer inicio quedan sin verificar. No se usaron credenciales de proveedores.

**Ruta excluida.** Se exploró Poster como posible sexto ejemplo. El extractor devolvió 401 para su colección de POS.
Las búsquedas oficiales no localizaron la ruta específica. Se excluyó sin concluir nada sobre sus funciones.

**Límite del pase.** Se reutiliza el contexto de los pases anteriores; no se repite una auditoría completa de reseñas o versiones.
El código cerrado de los proveedores no se inspeccionó. No se atribuye cumplimiento de una norma a estos recorridos.
Las capacidades de los proveedores proceden de las fuentes anteriores. La decisión de Umi procede de las instrucciones del usuario.
