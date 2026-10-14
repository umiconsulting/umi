# N23: foco por identidad y presupuesto de acciones

Consulta local: 2026-10-08. Base N22: `43aab66`, nota 8.4. **HD** = hecho documentado u observado; **IN** = inferencia/propuesta; **TR** = tradeoff; **NV** = no verificado. Se aplica [research](../../../.agents/skills/research/SKILL.md) y la [doctrina](../../agents/tool-and-research-doctrine.md).

## Fuentes y herramientas suficientes

**HD:** Flutter 3.47.5/Dart 3.13.4, revisión `6a19cca56475dbfba1478ee68d7bd0c2ef891da1`, está instalado. El SDK BSD-3-Clause proporciona FocusNode, PopupRoute y WidgetsBinding. No requiere Material, Cupertino ni paquete UI. Las páginas API muestran 0.0.0 en su pie; no se usa como versión. Se contrasta `packages/flutter/lib/src/widgets/focus_manager.dart`, `focus_scope.dart`, `navigator.dart` y el código propio. Driver, Hyprland, XTEST y AT-SPI ya permiten verificar el resultado. Costo: nodos persistentes y coordinación de cierre, sin compra, instalación ni dependencia nueva. **NV:** CPU/memoria del cambio no se han medido. Fallback: retorno explícito a un destino permitido al reconstruir navegación, con pruebas que impidan activar una página o robar foco.

**HD:** la investigación en segundo plano se intentó; no entregó un archivo final. Root continuó la lectura directa y contrastó las fuentes. No se atribuye a ese agente una entrega completa. Las comunidades artísticas y relatos de diseño del [corpus](../2026-10-08-pos-estacion.md) siguen siendo antecedentes; no se simula un nuevo hallazgo underground para justificar un arreglo de foco.

## G68: lo que el SDK garantiza y lo que no

**HD:** [N22](N22-decision.md) conserva AT-SPI antes y después de resize. Ajustes permanece seleccionada, pero el foco queda en el panel y el primer Tab llega a Comanda. Es una observación nativa; no una deducción de código.

**HD, API + SDK:** [FocusAttachment.detach](https://api.flutter.dev/flutter/widgets/FocusAttachment/detach.html), s/f, separa el nodo del árbol. Disponer el nodo también lo separa. La fuente fijada, `focus_manager.dart:223`, usa `UnfocusDisposition.previouslyFocusedChild` si ese nodo tiene foco o está pendiente. El gestor recupera historia de foco; no conoce la identidad operativa de una sección ni el equivalente que aparecerá en otro layout.

**HD, API + SDK:** [FocusNode.requestFocus](https://api.flutter.dev/flutter/widgets/FocusNode/requestFocus.html), s/f, permite solicitar foco antes de attach y difiere esa petición. Su notificación ocurre en una microtask y puede retrasarse un frame. [FocusNode](https://api.flutter.dev/flutter/widgets/FocusNode-class.html) documenta propietario, host y manager; el propietario conserva y dispone el nodo. **IN:** conservar nodos por identidad y solicitar el retorno después de reconstruir evita depender de orden de disposición o historia genérica. No garantiza geometría visible: debe comprobarse en el renderer.

**HD:** PosPage conserva un Flex y su hijo KeyedSubtree con ValueKey, cambiando dirección y posición. N23 no introduce GlobalKey. El State de PosNavigation puede permanecer en ese hijo, pero sus controles internos cambian de padre y Más puede desaparecer. **IN:** la key exterior permite reconciliar esa navegación; no conserva por sí sola todos sus triggers internos. El propietario debe conservar nodos y decidir el nuevo objetivo.

**HD:** [APG Dialog Modal](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), s/f, indica retorno al disparador, o a un elemento que continúe el trabajo si el disparador desaparece. [APG Disclosure Navigation](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/) registra Escape y retorno al botón. **IN:** sirven para formular un contrato de retorno lógico. No convierten el PopupRoute en HTML/ARIA ni prueban conformidad completa, voz o todas las teclas.

## Contrato propio que debe comprobarse

**IN:** distinguir el destino seleccionado del que estaba enfocado en la lista. Si Ajustes está seleccionada y Cocina enfocada cuando la ventana amplía, recuperar Cocina sin seleccionar Cocina. Enter después debe poder seleccionarla. Si sigue oculta, recuperar Más. Si esa identidad ya no está permitida, volver al control de la sección vigente permitida. El índice anterior no representa identidad después de filtrar una lista.

**IN:** usar keys de TillSurface en el catálogo y valores de menú basados en esa identidad. Conservar nodos en el State de navegación. No reutilizar el mismo nodo simultáneamente para Más y un destino visible. Un cambio de idioma no debe reinterpretar una key de sección como otra. El fallback de etiquetas sin key queda limitado a rótulos únicos y estables; no se presenta como identidad de dominio universal.

**IN:** restaurar durante reconstrucción sólo si antes había foco en navegación. Conservar una identidad enfocada secundaria al colapsar y expandir, hasta que el foco abandone Más o el operador abra sus opciones. Después de activación explícita, recuperar ese destino si el callback ha eliminado foco; esto no cambia la sección otra vez. Un campo del contenido debe conservar su edición durante resize. Con menú abierto, usar la identidad enfocada y restaurar al cerrar. No pedir foco detrás de otra ruta actual. Si el trigger desaparece, retirar sólo su ruta propia después del frame. Si cambian valores/habilitación, cerrar la lista capturada en vez de operar un índice viejo. No se afirma que el servidor autorizara antes una operación indebida.

**TR:** los nodos se conservan hasta disponer la navegación. El catálogo tiene siete identidades estables. Esta elección evita disponer un nodo mientras su host anterior se desmonta. No se interpreta como consumo nulo ni como política adecuada para una navegación de identidades ilimitadas.

**NV:** anuncio hablado, IME, operadores y equipos físicos. Las pruebas deben comprobar foco real, acciones, lista permitida y ausencia de selección involuntaria; un FocusNode existente no basta.

## G69: claridad de acción y espacio disponible

**HD:** N22-r2, 1280 × 1000 ES200%, muestra «En…», «Va…» y «Co…». `_CartPanel` usa una fila de tres Expanded y ellipsis. `PosButton` usa `labelLarge` de 14, peso 600, altura 1.25; añade 16 px a cada lado. Al 200%, el texto dispone de menos que el ancho completo de su botón. El tooltip conserva la frase, pero la evidencia sólo prueba su disponibilidad, no reconocimiento rápido.

**HD:** [GOV.UK Button](https://design-system.service.gov.uk/components/button/), s/f, recomienda describir la acción con texto y distinguir una acción principal de secundarias. Advierte que demasiadas acciones principales reducen claridad y que el color solo no explica una acción destructiva. Es guía primaria de ese equipo para formularios web; no un estudio de nuestro POS ni un requisito de adoptar su biblioteca.

**IN:** evaluar una acción de cobro con espacio suficiente y secundarias diferenciadas, midiendo los rótulos reales. No reducir escala, reemplazar todos los verbos con iconos ni esconder la intención en tooltips. Conservar autorización, confirmación de vaciado, envío a cocina y total canónico. Si hacen falta filas, comprobar antes su altura con texto grande y la región disponible para artículos. Cambiar el overflow a visible no es una solución si el texto sale de su control.

**TR:** más filas pueden consumir el cuerpo del pedido. Mover contenido al scroll puede dejar el total fuera de vista. Una solución tiene que comprobar último artículo, total, acción primaria, cierre y teclado en horizontal. **NV:** N23 todavía no implementa una solución para G69; queda trabajo posterior y no se cierra por investigación.

## Rutas corregidas y límites

**HD:** el primer test escribió PosTextField, que no existe en el sistema propio. `rg` localizó PosField y se corrigió antes de reproducir comportamiento. La línea base conserva ese fallo de compilación por separado. El primer análisis de implementación detectó un `!` redundante al pasar un callback a variable local; se retiró antes del análisis final. No se atribuyen resultados de pruebas a estas fuentes de lectura.

**HD de revisión:** la primera compilación nativa recupera el foco durante resize, pero Enter en Cocina deja sólo el panel enfocado. Se registra G70 y se reproduce también en la prueba integral de CatalogSurface. N23 corrige el retorno después del callback de activación en el propietario de navegación; el callback conserva su limpieza de foco previa. Una prueba adicional reproduce pérdida de la identidad secundaria en un ciclo de colapso; la revisión conserva esa intención sólo mientras Más mantiene foco. Los resultados finales necesitan el registro de la segunda compilación.

**HD de inspección final:** la edición conserva foco nativo, pero la lectura por getOffset da campo de 76 px y viewport de 28 px en 812 × 375 EN200%. La captura confirma texto recortado. Se registra G71 como presupuesto vertical; no se confunde foco conservado con legibilidad. Las rutas de instrumento «Very large» y la variable local `measurements` se corrigen según el registro de decisión; la geometría y los errores originales se conservan.
