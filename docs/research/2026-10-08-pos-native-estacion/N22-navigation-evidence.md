# N22 — navegación que responde a sus etiquetas

Fecha de consulta: 2026-10-08. Base comunicada: `3cb16cb`; puntuación anterior: 8.4/10. Investigación de lectura, sin ejecutar la aplicación ni cambiar GUI, Git, datos o preferencias. La copia de trabajo puede evolucionar mientras se consulta; los hechos locales describen el código leído, no una reconstrucción del commit base.

**HD** = hecho documentado/observado en fuente; **TR** = tradeoff respaldado; **IN** = inferencia o propuesta propia; **NV** = no verificado. Se aplica [research](../../../.agents/skills/research/SKILL.md), la [doctrina](../../agents/tool-and-research-doctrine.md) y el [playbook](../2026-09-16-research-channels-playbook.md). Este agente satisface la fase de investigación en segundo plano; no se delegó nuevamente.

## Instrumento y alcance

**HD:** el instrumento suficiente está instalado: Flutter **3.47.5**, canal stable, Dart **3.13.4**, revisión `6a19cca56475dbfba1478ee68d7bd0c2ef891da1`, fecha propia del framework **2026-09-17**. `TextPainter`, `LayoutBuilder`, `Focus` y `WidgetsApp` pertenecen al SDK, con licencia **BSD-3-Clause**, comprobada en `/home/juan/.local/opt/flutter/LICENSE`; versión comprobada en `bin/cache/flutter.version.json`. No requieren Material, Cupertino ni paquete UI. El SDK fijado es la autoridad para comportamiento; las páginas API recuperadas muestran «Flutter 0.0.0», que no identifica el SDK instalado.

**TR:** costo de adopción: medir unas pocas etiquetas, definir la partición visible/oculta y comprobar transiciones. No añade descarga, pago ni migración de componentes. No existe medición de su costo de CPU en esta investigación. El SDK advierte que sus métodos estáticos de medición crean/layout/disponen un pintor y son costosos; evitar repetirlos innecesariamente. [Fuente fijada de TextPainter](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/painting/text_painter.dart#L642).

**IN:** preferir estas primitivas y el menú propio existente. Fallback: una política conservadora de destinos visibles comprobada con todos los textos reales; un breakpoint aislado resulta insuficiente para idiomas, permisos y escalado variables. Herramientas de esta lectura: `rg`, `sed`, extracción web oficial y `apply_patch` únicamente para este documento. No se instalaron herramientas ni se abrió navegador gráfico.

## Qué explica G67

**HD:** [N21](N21-decision.md) registra una captura nativa de **812 × 375**, español al **200%**, con siete destinos: «Comanda» se presenta como «Coman/da». El informe distingue esta pérdida de ritmo/legibilidad de una omisión del texto; este agente no produjo ni volvió a observar la ventana.

**HD:** [PosNavigation](../../../apps/umi-pos/lib/core/theme/pos_collections.dart) decide compactar únicamente con `!rail`, ancho global `<600` y más de cuatro destinos. Entonces presenta los tres primeros y «Más»; sólo esa modalidad pasa a dos filas cuando `textScaler.scale(12)>16`. Sus etiquetas ordinarias permiten `maxLines:2`. [PosTheme](../../../apps/umi-pos/lib/core/theme/pos_theme.dart) define `labelMedium` a **13**, y la navegación lo usa con peso 500/700. [PosPage](../../../apps/umi-pos/lib/core/theme/pos_ui.dart) elige rail con constraints de ancho `>=1100`. Por eso 812 px con texto aumentado sigue en una fila de siete destinos.

**IN:** no basta subir 600 a otro número: la brecha aparece cuando el ancho útil de una casilla es menor que su etiqueta concreta. El sondeo de tamaño 12 tampoco representa exactamente el tamaño 13 ni un escalador no lineal. La decisión debe considerar el espacio recibido, todos los rótulos y el estilo que efectivamente se dibuja, incluyendo el rótulo que representa una sección activa dentro de «Más».

## Medición primaria, sin adivinar anchos por caracteres

**HD, peldaño 1/3:** [LayoutBuilder](https://api.flutter.dev/flutter/widgets/LayoutBuilder-class.html), s/f, entrega constraints locales en layout y reacciona a sus cambios y a dependencias suscritas. La [guía de adaptación](https://docs.flutter.dev/ui/adaptive-responsive/general), actualizada **2026-05-05**, diferencia ese espacio del tamaño completo obtenido con `MediaQuery.sizeOf`. El ejemplo Material de la guía no convierte 600 px en una obligación de Flutter. La API coincide con `packages/flutter/lib/src/widgets/layout_builder.dart` del SDK fijado.

**HD, peldaño 1/3:** [TextPainter](https://api.flutter.dev/flutter/painting/TextPainter-class.html), s/f, permite configurar texto, estilo, dirección, locale y `TextScaler`, hacer layout y leer métricas; debe disponerse al terminar. [didExceedMaxLines](https://api.flutter.dev/flutter/painting/TextPainter/didExceedMaxLines.html), s/f, informa truncamiento/ellipsis después de layout. **IN:** con `maxLines:2` no distingue una palabra partida en dos líneas de una etiqueta aceptable de dos palabras. Para exigir una línea, sondear con `maxLines:1`; alternativamente comparar el ancho intrínseco sin envolver contra el ancho de texto disponible. La regla de no partir palabras es una decisión editorial propia, no una garantía automática de esa propiedad.

**IN:** ubicar la medida después de descontar padding/SafeArea aplicables; comparar con cada slot real, descontando su padding interno. Usar `labelMedium` completo —familia IBM Plex Sans, tamaño, peso, espaciado y altura—, `Directionality`, locale y el `TextScaler` vigente. Reservar el ancho de la variante seleccionada, o evaluar ambos pesos, evita que seleccionar sea lo que provoque el cambio de modalidad. Si se cachea, invalidar cuando cambien rótulos, locale, estilo, fuente o escalador; no convertirlo a un factor lineal aproximado. Una sola línea no resuelve por sí sola altura, área táctil, foco ni descubribilidad.

**HD, peldaño 4:** Jeremy Keith, [Tweakpoints](https://adactio.com/journal/6044), **2013-02-15**, describe un cambio mayor de su trabajo en Matter decidido por el flujo del contenido y ajustes menores derivados de pruebas en dispositivos. **IN:** respalda separar el umbral estructural de rail de la corrección localizada de etiquetas. **NV:** es experiencia del autor, no experimento comparativo de un POS.

## Alternativas que requieren comparación

| Alternativa propia | Ventaja esperada / costo | Criterio para aceptar |
| --- | --- | --- |
| Siete destinos en una fila mientras todos caben | IN: acceso directo y posiciones estables; deja de servir al exceder una etiqueta | Rótulos completos, altura útil y targets comprobados |
| Prefijo estable + «Más» cuando no caben | TR: libera espacio; añade una apertura para destinos ocultos | Todos los destinos permitidos siguen alcanzables; selección visible; no oculta un destino crítico por una prioridad inventada |
| Dos filas | IN: conserva accesos y puede ampliar casillas; ocupa altura y cambia recorrido visual/foco | Medir navegación y contenido restante especialmente a 375 px de alto; comparar tareas, no contar filas |
| Barra horizontal desplazable | IN: mantiene altura; exige descubrir desplazamiento y revelar destino/foco fuera de vista | Indicación de continuidad, selected visible y teclado probado; no aceptarla sólo por ausencia de overflow |
| Rail antes de 1100 | IN: gana altura del cuerpo; consume ancho de catálogo/comanda | Etiquetas y contenido operativo siguen legibles; comprobar ventanas estrechas y texto grande |

**HD/TR, peldaño 4:** [Brad Frost, 2012-08-27](https://bradfrost.com/blog/post/complex-navigation-patterns-for-responsive-design/) presenta Priority+ y advierte que la prioridad asumida por el diseñador puede ocultar una función importante para usuarios. Enlaza a su creador: [Michael Scharnagl, 2012-06-19](https://justmarkup.com/articles/2012-06-19-responsive-multi-level-navigation/). **HD/TR:** Scharnagl experimenta con navegación de un periódico alemán y reconoce costos de taps, espacio y comportamiento en touch; no declara una solución perfecta. La cadena conserva el desacuerdo sobre conveniencia y la diferencia entre un periódico con subniveles y nuestro POS plano. Ninguna fuente establece que tres destinos sea el número correcto para este operador.

**IN:** empezar con el orden actual por rol y un prefijo estable que quepa, más una entrada explícita «Más». Conservar el destino activo oculto mediante nombre/estado/icono, sin promoverlo automáticamente al prefijo: así seleccionar no reordena destinos. Medir también ese nombre, que puede ser más ancho que «Más». No rebajar el escalado ni abreviar «Comanda» sólo para conservar una fila. Esta propuesta necesita comprobación de tareas; no tiene puntuación de usabilidad demostrada.

## Selección, permisos y transiciones

**HD:** [tillSurfacesFor](../../../apps/umi-pos/lib/core/security/operator_permissions.dart) filtra por permisos, tipo KDS y existencia de controladores, y mantiene Ajustes al final. [CatalogSurface](../../../apps/umi-pos/lib/features/catalog/catalog_surface.dart) conserva `_section` como `TillSurface`, deriva el índice de esa lista y usa `landingSurface` si deja de estar disponible. Cambiar ancho no debe convertirse en una nueva elección. «Primeros tres» significa tres de la lista permitida del rol, no tres destinos globales sin filtrar.

**IN:** visible y «Más» deben particionar esa misma lista autorizada una sola vez. Usar identidad `TillSurface` para la selección y para pruebas; no reinterpretar índices de una lista vieja tras cambios de permisos. El menú captura sus entradas al abrir, mientras el callback se consulta al terminar: revisar una actualización de permisos con el menú abierto, sin afirmar que ya produzca acceso indebido. La autorización de la ruta/servidor continúa siendo necesaria. **NV:** no se ejecutó esa transición.

**HD:** `_PosMenuViewport`, en la copia leída de [pos_collections.dart](../../../apps/umi-pos/lib/core/theme/pos_collections.dart), detecta cambios de `MediaQuery` en size/padding/viewInsets/textScaler y programa cierre si su route es current. Ya existe una defensa contra un anclaje de ventana desactualizado. `_PosMenuTrigger` devuelve foco a su nodo sólo si sigue montado. **IN/NV:** comprobar compacta→expandida y barra→rail con «Más» abierto; si el trigger desaparece, elegir un destino visible equivalente o el destino seleccionado como retorno. Un cambio de constraints locales sin cambio de MediaQuery requiere comprobarse aparte; no se ha demostrado un fallo.

**HD, peldaño 1/3:** [FocusNode](https://api.flutter.dev/flutter/widgets/FocusNode-class.html), s/f, documenta nodos persistentes y su ciclo de attach/reparent/dispose; crearlos en cada build pierde foco. `Widget.canUpdate` en `framework.dart` compara tipo y key. **IN:** una key estable puede ayudar a reconciliar hermanos, pero no garantiza conservar un elemento al moverlo entre distintos padres Row/Column/rail. Mantener nodos por identidad o definir explícitamente la recuperación, sólo si las pruebas muestran necesidad. No introducir GlobalKey como remedio automático.

## Teclado y límites de APG

**HD, SDK fijado:** `WidgetsApp.defaultShortcuts` (`app.dart:1263`) liga Tab/Shift+Tab a Next/PreviousFocus, Enter/Space a Activate, Escape a Dismiss y flechas a recorrido direccional. `_DismissModalAction` (`routes.dart:975`) permite dismiss cuando la route es barrierDismissible. El menú propio ya solicita foco, enfoca una entrada, implementa Up/Down/Home/End, revela el control y permite Escape por esa ruta. No hace falta Material para estas acciones.

**HD, peldaño 7:** [APG Menu Button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/), s/f, define Enter/Space para abrir y enfocar el primer ítem; Down/Up al abrir son opcionales. [APG Menu/Menubar](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/), s/f, asigna flechas al recorrido interior, Escape a cerrar/devolver foco y Tab/Shift+Tab a salir/cerrar. **TR:** el menú propio usa closedLoop y Tab entre controles; no es conformidad completa a ese patrón web. Una route con Escape disponible no implica por sí sola una trampa de teclado.

**HD, peldaño 7:** [APG Disclosure Navigation](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/), actualizado **2026-01-20**, explica por qué navegación normal no necesita role menu: conserva Tab/Shift+Tab entre enlaces y Escape devuelve foco al botón; flechas son adicionales. **IN:** adoptar un contrato coherente para «Más» y probarlo, sin tratar toda la barra como menubar por su aspecto. **NV:** APG es para HTML/ARIA; sus atributos no se trasplantan a Flutter, ni prueban AT-SPI/lector de pantalla Linux. Semántica nativa debería conservar nombres, estado seleccionado y expanded del trigger, y pruebas reales determinar su anuncio.

**HD:** [WCAG 2.2, edición 2024-12-12](https://www.w3.org/TR/2024/REC-WCAG22-20241212/#resize-text), requiere ampliar texto al 200% sin perder contenido/funcionalidad; su criterio reflow tiene condiciones distintas. [Understanding Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), s/f, explica reducir desplazamiento en dos dimensiones. **IN:** sirven como criterio exigente de revisión; una captura nativa al 200% no demuestra conformidad web. «Coman/da» completo es una brecha editorial comprobada, no una infracción WCAG que esta lectura haya demostrado.

## Qué verificar antes de mejorar la puntuación

**IN:** cerrar G67 requiere captura y geometría de cada etiqueta, no sólo finder presente ni cero excepciones. Comparar español/inglés, escala de sistema/Grande/Muy grande, siete destinos y roles con dos o tres, portrait/landscape y límites de cambio. Con una sección de «Más» activa: ampliar, reducir y pasar a rail; debe mantenerse la misma sección y seguir identificada. Probar Enter/Space, Tab/Shift+Tab, flechas, Escape, pointer y retorno de foco con menú abierto durante resize. Medir cuánto cuerpo operativo queda: dos filas que eliminan el espacio de trabajo pueden resolver una palabra y empeorar la tarea.

**IN:** las obras artísticas del [corpus anterior](../2026-10-08-pos-estacion.md) conservan valor para identidad, ritmo y carácter. No aportan evidencia independiente nueva para escoger esta partición ni su teclado; no se añadió decoración ni otra obra para justificar una corrección funcional. **NV:** tiempos de navegación por rol, frecuencia real, errores táctiles y lector de pantalla siguen pendientes. Esta investigación no eleva por sí sola 8.4 ni cierra G67.

## Trazabilidad y rutas fallidas

- **HD:** peldaños usados: documentación/API oficial (1), versión/estado local (2), SDK/aplicación leídos (3), relato original de diseñadores (4), APG/WCAG (7). Las comunidades artísticas ya constan en el corpus; no se simula un nuevo recorrido de foros para una API resuelta por fuente propietaria.
- **HD:** ruta local equivocada `features/catalog/presentation/catalog_surface.dart` devolvió «No such file»; `rg --files` recuperó `features/catalog/catalog_surface.dart`. `pos_interactions.dart` tampoco existe; las interacciones están en `pos_ui.dart` y `pos_collections.dart`.
- **HD:** enlace histórico de Frost `http://justmarkup.com/log/2012/06/19/responsive-multi-level-navigation/` resultó inaccesible en extracción web; búsqueda en el mismo dominio recuperó `/articles/2012-06-19-responsive-multi-level-navigation/`, abierto correctamente. No se asigna al artículo la fecha 2025 de copyright.
- **HD:** `https://adactio.com/journal/6044/` devolvió cache miss; ruta sin barra final recuperó texto propio con fecha 2013-02-15. Texto ajeno al artículo que intentaba dirigir al agente se descartó; no se siguieron esas instrucciones.
- **HD:** fuentes sin fecha de publicación se mantienen s/f; fecha de consulta/crawl no se usa como publicación. No se probó GUI, accesibilidad oral, backend ni interacción nativa en este apéndice.
