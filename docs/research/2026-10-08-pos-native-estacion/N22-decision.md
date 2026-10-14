# N22: etiquetas completas y acción visible de Más

Fecha local: 8 de octubre de 2026. Base: N21, `3cb16cb`. Compilación final: N22-r2. Nota acumulativa: **8.4/10**, sin aumento.

## Problema, investigación y criterio

**G67** aparece en N21: «Comanda» se parte dentro de una palabra en 812 × 375, español al 200%. La [línea base horizontal](N22-baseline-es2-landscape-navigation/screen.png) reproduce la composición anterior. Los siete destinos permanecen en una fila porque la decisión depende del ancho global de 600 px. La etiqueta permite dos líneas. El texto está completo; la brecha es de claridad editorial, sin declaración de infracción WCAG.

La [investigación primaria](N22-navigation-evidence.md) contrasta fuente del SDK fijado, contratos de foco y relatos originales. [Jeremy Keith, 2013-02-15](https://adactio.com/journal/6044) explica ajustes decididos por el flujo de contenido. [Brad Frost, 2012-08-27](https://bradfrost.com/blog/post/complex-navigation-patterns-for-responsive-design/) describe Priority+ y su riesgo de esconder funciones importantes. Remite al [experimento de Michael Scharnagl, 2012-06-19](https://justmarkup.com/articles/2012-06-19-responsive-multi-level-navigation/), que registra costos de taps y espacio en un periódico alemán. Son relatos primarios, no ensayos de operación del POS ni demostración de que tres destinos sean óptimos.

La fuente de [LayoutBuilder](https://api.flutter.dev/flutter/widgets/LayoutBuilder-class.html) permite responder a constraints locales. [TextPainter](https://api.flutter.dev/flutter/painting/TextPainter-class.html) mide estilo, idioma, dirección y escala reales. El reporte distingue las recomendaciones de APG de su aplicación nativa; no declara conformidad completa con un menú web ni lectura hablada.

## Decisión visual y comportamiento

La navegación mide las etiquetas con el estilo que dibuja y el `TextScaler` vigente. Descuenta padding y área segura. Reserva el peso seleccionado. Presenta todos los destinos cuando caben; cuando no caben, mantiene los tres primeros autorizados y Más. Las listas de cuatro o menos conservan todos sus destinos. Las filas responden al ancho disponible; no se rebaja la escala ni se abrevian palabras.

Las secciones conservan orden e identidad. Elegir una sección secundaria cambia nombre, icono y selección de Más, sin promoverla al prefijo. Una flecha junto al nombre expresa que ese control abre opciones. La reserva incluye el nombre secundario más ancho y la flecha, evitando que una selección cambie las columnas. La composición de rail conserva su dirección y los colores UMI `#223979` y `#7692CB`.

**Tradeoff:** compactar añade una apertura para secciones secundarias. Dos filas aumentan la altura de navegación del teléfono con texto grande. La [vista horizontal](N22-r2-es2-landscape-labels/screen.png) conserva las palabras completas; la [vista de teléfono](N22-r2-es2-phone-labels/screen.png) conserva nombres y sección seleccionada. El escaso cuerpo de trabajo en horizontal al 200% requiere más revisión de tareas. No se deduce comodidad operativa de estas capturas.

## Comprobación y alcance

La [prueba sobre la línea base aislada](N22-navigation-baseline-tests.txt) aprueba diez casos y falla seis. Reproduce palabras partidas en ES/EN horizontal al 200%, constraints locales, cuatro destinos autorizados y selección de opciones. La [suite final aislada](suite-N22-isolated.txt) aprueba **612 pruebas**, dieciséis nuevas. El [análisis final](analysis-N22-isolated.txt) informa cero problemas. Las [36 pruebas específicas](targeted-N22-isolated.txt) incluyen navegación, tamaños de texto, permisos y menú.

La prueba usa las fuentes reales. Comprueba una sola caja de selección por etiqueta, ausencia de truncamiento y texto dentro de su párrafo. Combina ES/EN, escalas 1/2 y 375 × 812, 812 × 375, 1024 × 768. Un caso usa ancho local 420 dentro de una ventana 1024. Otro recorre cuatro destinos autorizados y comprueba los índices recibidos. Dos conservan selección durante expansión y reapertura por puntero, seguida de elección con teclado. No se presentan estos últimos como conservación de foco ni transición a rail: esa prueba usa una barra expandida.

La compilación nativa final mide los `RenderParagraph` realmente pintados. Cada [lectura](N22-r2-en2-landscape-labels-navigation.json) conserva texto, origen global, tamaño, cajas, idioma, escala e índice. Las verificaciones exigen una caja, ausencia de truncamiento y posición dentro del viewport. La presencia de un Finder por sí sola no sustituye esa geometría.

N22-r2 comprueba ES/EN al 200% en teléfono, horizontal y tablet. Incluye texto del sistema en ambos idiomas, selección de Ajustes y Mesas, End/Home, Enter, Escape y apertura con Espacio. [Escape](N22-r2-menu-escape-focus-atspi.json) devuelve foco a Más; [seleccionar Mesas](N22-r2-menu-selected-tables-atspi.json) conserva nombre del destino y disparador. AT-SPI es inspección del puente, sin lector hablado. La referencia exacta de cada captura consta en las geometrías r1/r2.

Mesas muestra datos del fixture; [Cocina](N22-r2-en2-tablet-kitchen/screen.png) y [Pedidos](N22-r2-en2-tablet-orders/screen.png) muestran estados vacíos en tablet inglesa al 200%. Esta observación amplía G39, pero no cierra estados con tickets, pedidos entrantes, errores o permisos de operadores nativos adicionales.

## Brechas que limitan esta revisión

**G68, observada:** al ampliar de 812 × 375 al 200% a rail de 1280 × 720 con Más abierto, la sección Ajustes permanece. El menú se cierra, pero el foco no vuelve a una acción equivalente. [Antes del cambio](N22-r1-before-resize-menu-focus-atspi.json), Ajustes está enfocado. [Después, antes de Tab](N22-r1-after-resize-before-tab-atspi.json), sólo el panel está enfocado. [El primer Tab](N22-r1-after-resize-first-tab-atspi.json) enfoca Comanda. La hipótesis de investigación se convierte en una brecha comprobada. No se atribuye su origen a una revisión anterior sin una comparación de esa transición.

**G69, observada:** la [comanda de 1280 × 1000 al 200%](N22-r2-observed-start/screen.png) presenta «En…», «Va…» y «Co…». La fila de tres acciones conserva `maxLines:1` y ellipsis en `catalog_surface.dart`. Los tooltips conservan frases completas, pero no sustituyen claridad visual del control. No se activó envío, vaciado ni cobro para inspeccionar este caso. El origen histórico de la brecha no se reconstruye aquí.

**Corrección del instrumento:** un primer acceso en ventana baja falla al intentar pulsar Continuar fuera de vista. `_EntryFrame` ya dispone de `SingleChildScrollView`. La captura inicial no demuestra una acción inaccesible. El acceso se completa en una ventana amplia. El siguiente arranque restaura la sesión y se observa antes de actuar; no se vuelve a esperar un PIN inexistente. El primer análisis identifica un import redundante del sondeo; se retira y se recompila. Los artefactos r1 y r2 permanecen identificados por separado.

## Procedencia y puntuación

La [fuente final](N22-final-source.json) liga el proceso aislado, su AOT y 123 entradas Dart. Los cinco archivos propios coinciden con el checkout de compilación. No se añaden dependencias UI. Flutter 3.47.5/Dart 3.13.4, SDK `6a19cca56475dbfba1478ee68d7bd0c2ef891da1`, proporcionan los widgets y la medida. Hyprland, Driver, XTEST y AT-SPI aportan geometría, acción y foco complementarios. No se mide CPU, memoria, arranque frío ni nuevos tiempos de cuadros.

La [auditoría](N22-backend-paid.json) conserva dos pagos en efectivo, importes, notas, variante, comanda y mesas. La [comparación](N22-audit-comparison.json) sólo cambia `updated_at` de la comanda activa. Su relación con acceso o reinicio es una inferencia; no se capturó la transacción exacta. TPM queda fuera del cambio de diseño y de la compilación final evaluada. Los 229 artefactos históricos N21 mantienen sus huellas.

| Criterio | Peso | N22 | Razón y límite |
| --- | ---: | ---: | --- |
| Tarea y jerarquía | 20% | 8.7 | Destinos completos y selección. G69 y tareas integrales pendientes. |
| Calidad visual e identidad | 20% | 8.3 | Palabras completas y apertura señalada; sin aumento global por corrección localizada. |
| Cobertura y coherencia | 15% | 8.3 | Estados secundarios vacíos comprobados; G39 permanece. |
| Adaptación | 15% | 8.8 | G67 corregida en geometrías, idiomas y escalas registradas. G69 limita las acciones. |
| Accesibilidad | 15% | 8.4 | Escape/selección conservan foco; G68 impide retorno equivalente durante resize. Voz e IME pendientes. |
| Respuesta y recuperación | 10% | 8.3 | Datos anteriores conservados; sin evidencia nueva de fallos de impresión. |
| Fluidez | 5% | 6.0 | Se conserva la medición N21; no se infiere costo del nuevo layout. |

Media ponderada: **8.355 → 8.4**. G67 se cierra en su alcance comprobado. El aumento de adaptación queda compensado por la brecha de foco. La [vista final](N22-final-preview/screen.png) vuelve a Comanda, Español y texto del sistema, sola a pantalla completa en el workspace vacío.

N22 no cumple 10.0. N23 debe resolver G68 y G69, repetir sus acciones fallidas y revisar el presupuesto vertical. Conserva G39, listas extensas de ventas, estados secundarios con datos/errores, memoria e inicio frío. Permanecen operadores, voz, IME, escala externa del sistema, dispositivos físicos e impresión. La puntuación conserva las revisiones anteriores y sus límites.
