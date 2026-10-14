# Exposición de color en Oscuro y Midnight

Fecha: 2026-10-12. Alcance: categorías, productos, selección y acción principal del POS.

## Instrumentos y fuentes

**Hecho documentado.** Se usó Color.js **0.5.2**, licencia MIT, con Node **24.21.0** para las métricas de color.
El instrumento está en `/tmp/umi-midnight-metrics`. No se agregó una dependencia al POS.
[Documentación](https://colorjs.io/docs/contrast.html), [licencia](https://github.com/color-js/color.js/blob/main/LICENSE).

**Hecho documentado.** Se consultaron Apple HIG, IBM Carbon y Material Design 2 en sus fuentes oficiales.
La documentación de Android dark theme indica una actualización del **2026-10-01**.
Carbon Color indica **2026-09-25**; Carbon Themes indica **2026-08-12**.
Los principios se aplican a los componentes propios de Flutter. No requieren incorporar componentes Material.
[Android](https://developer.android.com/develop/ui/views/theming/darktheme), [Carbon Color](https://www.carbondesignsystem.com/building-blocks/foundations/color/guidelines), [Carbon Themes](https://www.carbondesignsystem.com/guidelines/themes/overview/).

## Principios primarios relevantes

**Hecho documentado.** Apple distingue fondos base y elevados en oscuro. Los elevados son más claros y comunican profundidad.
Oscuro no constituye una inversión completa del tema claro. Apple exige legibilidad en ambos modos.
Apple admite el mismo recurso de imagen cuando funciona en ambos modos; las variantes dependen de la imagen.
[Apple: Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode).

**Hecho documentado.** Apple pide significado consistente del color y variantes adecuadas para apariencia y contraste.
Esta regla permite separar la identidad del catálogo de la señal de interactividad.
[Apple: Color](https://developer.apple.com/design/human-interface-guidelines/color).

**Hecho documentado.** Carbon mantiene el papel y el nombre de cada token entre temas; sus valores cambian.
Su modelo tiene una base y tres capas. Cada capa coordina superficie, campo, borde y estados.
Los tokens de texto pueden funcionar entre capas cuando conservan contraste suficiente.
Carbon reserva los cambios grandes de tema para diferencias visuales grandes; usa capas para diferencias menores.
[Carbon Themes](https://www.carbondesignsystem.com/guidelines/themes/overview/), [Carbon Color](https://www.carbondesignsystem.com/building-blocks/foundations/color/guidelines).

**Hecho documentado.** Material 2 propone que las superficies oscuras ocupen la mayor parte de la interfaz.
Limita la extensión de los acentos. Permite conservar la saturación de marca en uno o dos elementos destacados.
Su sistema de profundidad aclara las superficies elevadas. Su fondo recomendado es gris oscuro, no negro puro.
Estos principios pertenecen a Material 2; no constituyen una obligación del contrato Midnight de Umi.
[Material: Dark theme](https://m2.material.io/design/color/dark-theme.html), [contenido oficial recuperado](https://m2.material.io/page-data/Guidelines/5095560397979648.json).

**Inferencia.** La recomendación de Material sobre colores menos saturados no obliga a sustituir todo color del catálogo.
El contraste depende del par final. La identidad exacta puede ocupar una banda, con texto sobre otra superficie.
Esta solución conserva la marca y reduce su exposición sin modificar el HEX.

## Decisiones para Umi

**Inferencia.** Midnight debe conservar el negro de su base y sus tintas neutrales.
Oscuro debe conservar su base marino. Ambos pueden usar capas algo más claras para tarjetas y menús.
La presencia de una capa elevada no convierte Midnight en Oscuro.
Fuente local: `packages/tokens/tokens/dashboard.json`, grupos `surface`, `ink` y `line`.

| Papel                     | Antes                                              | Después propuesto                                                 |
| ------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| Identidad de categoría    | Color del propietario cubre la pestaña             | Color exacto en banda opaca; fondo neutral y etiqueta legible     |
| Producto sin foto         | Color del propietario cubre el bloque de iniciales | Color exacto en banda; iniciales claras sobre superficie oscura   |
| Producto con foto         | Imagen original del catálogo                       | Imagen original del catálogo; tratamiento del contenedor por tema |
| Selección Midnight        | Fondo pastel extenso                               | Fondo `#111A2E`, tinta `#A8BBDE` y señal `#7692CB`                |
| Acción principal Midnight | Fondo `#A8BBDE`, tinta `#131F44`                   | Fondo `#223979`, tinta `#F2F2F2` y borde `#7692CB`                |

**Inferencia.** Una banda inicial de 4 píxeles lógicos permite evaluar esta solución en el iMin.
La medida es una decisión Umi, no una exigencia de Apple, Carbon o Material.
La banda debe conservar opacidad completa. Una transparencia modifica el color compuesto y su identidad visible.
La categoría conserva además su nombre. Su color no debe ser el único medio de identificación.

**Inferencia.** Una selección indica el estado actual; una acción indica el siguiente paso.
Los dos papeles necesitan tokens distintos. El relleno principal puede tener mayor énfasis que la selección.
El borde azul mantiene visible la acción marino contra negro. Un foco visible necesita su propio estado.

**Hecho documentado del cálculo.** La acción propuesta ofrece contraste textual de **9.72:1** y APCA **−90.3**.
El relleno marino contra negro ofrece solo **1.93:1**; por eso la propuesta incluye un borde azul.
La selección propuesta ofrece **8.94:1** y APCA **−63.8** para su texto.
Blanco sobre naranja Pan `#F58231` ofrece **2.59:1**. La banda permite retirar el texto de ese par insuficiente.
[Métricas](../reports/evidence/2026-10-12-midnight-audit/color-metrics.json), [método y límites](2026-10-12-midnight-color-method.md).

**Inferencia.** Estas métricas justifican los pares; las capturas deben justificar su jerarquía y exposición.
La lectura real necesita el tamaño, el peso, los estados y la luz del equipo.
El informe no afirma conformidad WCAG de la aplicación nativa.

## Límites y verificación

**Hecho documentado.** El requisito del usuario conserva las fotos originales del catálogo.
La propuesta no cambia sus archivos, colores ni filtros. El contenedor usa el tema correspondiente.

**Inferencia.** Compara Claro, Oscuro y Midnight con categorías naranja, azul y roja.
Comprueba productos con foto y sin foto, selección, foco, pulsación y estado deshabilitado.
Comprueba que una pulsación en la banda pertenece al mismo control y conserva el objetivo táctil.
Comprueba que el cambio de tema conserva la categoría elegida y el pedido.

**UNVERIFIED.** Esta investigación no ejecutó la propuesta en el dispositivo. El agente principal controla esa comprobación.
El contenido de los temas claro y oscuro requiere una comparación renderizada tras cualquier cambio común de componentes.

## Rutas de recuperación

**Hecho documentado.** Apple HTML entregó una pantalla de JavaScript. Sus JSON oficiales respondieron por `curl`.
Rutas: `/tutorials/data/design/human-interface-guidelines/dark-mode.json` y `/tutorials/data/design/human-interface-guidelines/color.json`.

**Hecho documentado.** Carbon cambió la ruta de Color. `/guidelines/color/usage/` devolvió 404 por `curl`.
La ruta actual `/building-blocks/foundations/color/guidelines` respondió mediante búsqueda y lectura web.
Carbon Themes respondió por `curl`, aunque la lectura web devolvió un error.

**Hecho documentado.** Material HTML entregó una pantalla de JavaScript.
`/site_meta.js` identificó el documento de Dark theme. El cliente oficial usa `/page-data/Guidelines/<document_id>.json`.
El documento **5095560397979648** respondió por `curl` con el contenido completo.
No se usaron copias de terceros para las decisiones.

Se usaron los niveles 1 y 3 de la doctrina local: documentación oficial y cliente oficial.
