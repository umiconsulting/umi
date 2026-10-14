# N19 · Ventas al 200%: reflujo y un viewport del cuerpo

Consulta **2026-10-08**; lectura desde N18 **`2f440ee`**. **HD** = hecho documentado; **TR** = tradeoff respaldado; **IN** = propuesta/inferencia; **NV** = no comprobado. Investigación del agente de fondo conforme a [research](../../../.agents/skills/research/SKILL.md), [doctrina](../../agents/tool-and-research-doctrine.md) y [playbook](../2026-09-16-research-channels-playbook.md). No modifiqué aplicación, datos, preferencias ni GUI.

## Instrumentos primero

| Instrumento | Versión/licencia/mantenimiento | Costo y alcance |
| --- | --- | --- |
| Flutter: `CustomScrollView`, `SliverList`, adaptadores, foco y semántica | **3.47.5 stable**, Dart **3.13.4**; SDK local `/home/juan/.local/opt/flutter`, revisión `6a19cca56475dbfba1478ee68d7bd0c2ef891da1`, commit **2026-09-17**. [BSD de tres cláusulas](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/LICENSE). | HD: primitivas `widgets`, `rendering` y `semantics` existentes. IN: reorganizar el cuerpo de Ventas; ninguna biblioteca UI nueva. Las API web con footer «Flutter 0.0.0» se contrastaron con esta fuente fijada. |
| Driver nativo del repo y Flutter Driver | [pos-native-driver.mjs](../../../tools/ux-sweep/pos-native-driver.mjs:407), Node **24.21.0** instalado; entrypoint de desarrollo ya existente. Flutter Driver pertenece al SDK; licencia del script propio no determinada aquí. | IN: accionar la preferencia real, desplazar, enfocar y recoger geometría/semántica/captura. NV: ejecución de N19; este agente sólo leyó. |
| Referencias de diseño | W3C WCAG 2.2, edición consultada **2024-12-12**; IBM Carbon Empty states **2026-08-11**. | Referencias documentales, sin importar componentes ni recursos. No son ensayos de cajeros ni certificación del POS. |

Peldaños: documentación oficial→fuente fijada→código del proyecto; conexión artística por artículo y documentación propios. No añadí scripts ni paquetes.

## 1. Brecha observada en la evidencia existente

HD de archivo: [N18-decision](N18-decision.md:39) mantiene **G62** abierta: a texto 200% en Ventas estrecha, formulario y aviso consumen el área de lista y el desplazamiento no permite leer completo el importe de Croissant. No reclasifico esa captura como observación propia.

HD de código al iniciar N19: [SaleCenterSurface](../../../apps/umi-pos/lib/features/sale/sale_surface.dart:345) coloca búsqueda, filtros, avisos y progreso en una `Column`; sólo el bloque final usa `Expanded` y `ListView.separated`. **IN:** la altura superior queda fuera del desplazamiento de la lista y puede absorber su viewport. La fila ya adapta nombre e importe a columna; eso no asegura que exista espacio para alcanzarlos.

**IN — decisión:** un `CustomScrollView` para el cuerpo, incluyendo formulario, avisos, estados y ventas. Conservar el encabezado de navegación existente fuera del cuerpo si su altura sigue siendo usable; no fijar todo el formulario ni todos los avisos arriba. Las opciones de un menú pueden tener su propio scroll en su ruta: esta decisión se refiere al cuerpo de Ventas, no prohíbe cualquier scrollable del producto.

## 2. Arquitectura sustentada por el SDK

HD: [`CustomScrollView`](https://api.flutter.dev/flutter/widgets/CustomScrollView-class.html) combina slivers en el mismo viewport. La [guía oficial](https://docs.flutter.dev/ui/layout/scrolling/slivers), actualizada **2026-09-29**, describe slivers como partes de una misma área desplazable. IN: aprovechar esa composición para que el formulario salga de pantalla al desplazarse y la lista use el área liberada. Los ejemplos con `SliverAppBar` no exigen usar Material.

HD/TR: [`SliverToBoxAdapter`](https://api.flutter.dev/flutter/widgets/SliverToBoxAdapter-class.html) integra una caja; [`SliverList`](https://api.flutter.dev/flutter/widgets/SliverList-class.html) admite altura variable y creación diferida de filas. La fuente fija [sliver.dart](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/widgets/sliver.dart#L128) explica que no conoce a priori la altura de hijos fuera de pantalla. **IN:** adaptadores para pocos bloques superiores, lista diferida para ventas; no crear cada venta como un adaptador independiente ni forzar `itemExtent` para conservar densidad.

HD/TR: [`SingleChildScrollView`](https://api.flutter.dev/flutter/widgets/SingleChildScrollView-class.html) con muchas filas pierde las ventajas de creación diferida y genera conflicto entre altura infinita y `Expanded`. [`shrinkWrap`](https://api.flutter.dev/flutter/widgets/ScrollView/shrinkWrap.html) añade costo al recalcular el tamaño durante el desplazamiento. **IN:** no resolver G62 envolviendo la `Column` actual en otro scroll y encogiendo la lista interior. Esta preferencia arquitectónica no afirma que todos los scrolls anidados sean incorrectos.

HD: [`SliverFillRemaining(hasScrollBody: false)`](https://api.flutter.dev/flutter/widgets/SliverFillRemaining-class.html) considera tamaño del contenido y extensión previa; cede al hijo cuando éste supera el espacio restante. [Fuente fijada](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/widgets/sliver_fill.dart#L204). **IN:** alternativa para centrar un estado corto conservando crecimiento cuando su texto/reintento son largos. Un `SliverToBoxAdapter` de altura natural también sirve. Ninguno necesita un `ListView` interior para ese mensaje.

IN: composición propuesta — los nombres designan responsabilidades, no clases nuevas:

```text
CustomScrollView
  SliverPadding → búsqueda y controles en caja de altura natural
  SliverToBoxAdapter → aviso operativo, si corresponde
  estado de la consulta o SliverList.separated de ventas
  SliverToBoxAdapter → paginación / carga adicional / error recuperable
  SliverPadding → separación final respecto de navegación y zona segura
```

## 3. Estados completos sin romper N17

HD de diseño: [Carbon Empty states](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states), **2026-08-11**, distingue ausencia de datos, no coincidencias y problemas que impiden mostrarlos; propone recuperación contextual. IN: conservar esa distinción implementada en N17, ahora dentro del recorrido vertical.

| Estado | IN: tratamiento y condición |
| --- | --- |
| Primera carga / nueva consulta | Mensaje de carga propio en sliver; filtros editables. No presentar lista vacía como ausencia de ventas. Mantener la generación vigente de N17. |
| Historial vacío | Mensaje acotado al ámbito consultado. No requerir una lista interior vacía para mostrarlo. |
| Sin coincidencias | Texto de no coincidencias y términos/filtros conservados; limpiar o ajustar mediante los controles alcanzables. |
| Fallo inicial / refresco | Mensaje y reintento que siguen dentro del viewport desplazable; no confundir fallo con cero ventas. |
| Ventas disponibles | Altura de fila natural; nombre, importe, estado y acciones alcanzables. La selección sigue referida a la venta y permiso correctos. |
| Carga de otra página | Conservar filas, posición y cursor de la consulta vigente; indicar proceso cerca del footer y bloquear sólo el disparo duplicado de esa página. |
| Fallo de otra página | Conservar filas ya recibidas; reintento de página visible al final. No reemplazar toda la consulta por un estado vacío. |

TR/IN: hacer desplazables los controles añade recorrido para volver a búsqueda. Es preferible conservar un camino de regreso claro a inmovilizarlos ocupando casi todo el alto. No introducir un encabezado expansivo decorativo o múltiples zonas con gestos diferentes para disimular la brecha.

## 4. Foco, estado e índices semánticos

HD: [`FocusTraversalPolicy.defaultTraversalRequestFocusCallback`](https://api.flutter.dev/flutter/widgets/FocusTraversalPolicy/defaultTraversalRequestFocusCallback.html) solicita foco y llama [`Scrollable.ensureVisible`](https://api.flutter.dev/flutter/widgets/Scrollable/ensureVisible.html); este último recorre scrollables ancestros. **IN:** conservar recorrido de teclado y focus nodes estables al reorganizar; comprobar que búsqueda, filtros, reintento y acciones se revelan al recibir foco. El nodo enfocado en un árbol no demuestra que la captura lo muestre completo.

HD/TR: la lista diferida puede destruir y reconstruir hijos al salir del viewport; su documentación aconseja mantener lógica de negocio fuera de esos hijos. IN: el controlador de búsqueda, filtros y ventas siguen en su propietario actual; una clave por ID distingue registros al ordenar/paginar. En [SDK 3.47.5, `SliverList.separated`](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/widgets/sliver.dart#L285), `findItemIndexCallback` es el API actual; el anterior `findChildIndexCallback` separado está deprecado. No es necesario multiplicar índices por dos al usar el nuevo callback.

HD: `CustomScrollView` necesita índices y cantidad coherentes para anuncios de desplazamiento; los separadores no cuentan como filas semánticas. **IN:** hacer coincidir `semanticChildCount` con hijos indexados; no inventar el total global de ventas si sólo se conoce una página. Control/formulario y footer deben conservar semántica accesible sin falsear esa numeración. Orden de lectura: nombre→importe→estado→acciones.

HD/TR: [`liveRegion`](https://api.flutter.dev/flutter/semantics/SemanticsConfiguration/liveRegion.html) marca actualizaciones importantes para anuncios corteses; la fuente no garantiza que siempre se pronuncien y describe especialmente Android/iOS. IN: marcar mensaje de estado pertinente, evitando duplicar cada cambio en varios avisos. **NV:** voz efectiva en Linux; no se deduce desde un flag del árbol.

## 5. Reflujo y conexión artística primaria

HD: [W3C Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) explica presentación sin pérdida de información/función y sin exigir desplazamiento en dos dimensiones, con excepciones para contenido que lo requiere. **IN:** criterio útil para Ventas: reorganizar y extenderse verticalmente; no encoger texto, omitir moneda o usar elipsis como prueba de cierre. Los 320 **CSS** px de esa guía no son automáticamente los 390 píxeles lógicos de nuestra ventana nativa. [Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) aporta el criterio de que el foco no quede totalmente tapado; leer completo el importe exige una comprobación adicional.

HD artístico: [Kris De Decker, Marie Otsuka y Roel Roscam Abbing](https://solar.lowtechmagazine.com/2018/09/how-to-build-a-low-tech-website/), **2018-09-24**, explican una identidad con tipografía del navegador y un solo cambio tipográfico en el nombre; mantienen imágenes con tratamiento propio y describen su diseño móvil. El artículo enlaza la [documentación de Marie Otsuka](https://github.com/lowtechmag/solar/wiki/Solar-Web-Design), cuya ficha visible indica edición **2018-10-30**; el repositorio quedó archivado **2023-06-12**. No confundir archivo con fecha de esa edición.

IN: trasladar el mecanismo de identidad contenida al flujo de Ventas: signo, ritmo tipográfico y separadores pueden dar carácter a una columna de datos que crece. No hace falta inmovilizar una gran cabecera para sostener la identidad. La fuente artística no prueba que una lista única mejore los tiempos del POS; el fundamento del viewport es el SDK y la evidencia de G62. No se copia CSS, logo ni componente.

## Comprobación necesaria y rutas fallidas

IN: repetir N18 con datos idénticos: texto 2.0 a 390px, aviso operativo presente, primera venta y su importe completo; desplazarse hasta últimas filas, acción y footer; volver a filtros; búsqueda vacía/sin coincidencias/fallo/reintento; paginación y reordenación. Incluir 768/1280, Sistema/Grande/Muy grande, ES/EN y foco por Tab. Si una fila supera el alto, verificar separadamente que cada dato y acción se revela; centrar la fila entera puede volver a recortar un extremo. Captura y geometría del importe son más informativas que ausencia de overflow o etiqueta semántica aislada.

| Ruta | Resultado y recuperación |
| --- | --- |
| API `/widgets/Semantics/liveRegion.html` | Error interno/ruta incorrecta. Se verificó `/semantics/SemanticsProperties/liveRegion.html` y la descripción completa en `SemanticsConfiguration`, más fuente local. |
| Texto «June» o «typography» en wiki Solar Web Design | Búsqueda sin coincidencias. Lectura de metadata y artículo propio permitió distinguir fecha de edición 2018 de archivo 2023; no se inventó una revisión de diseño en 2023. |
| API con footer Flutter 0.0.0 | No sirve para identificar versión. Fuente local fijada 3.47.5 confirmó constructores y callbacks. |

**NV:** implementación N19, velocidad, transporte de escala externa, IME, voz y teléfono físico. Sólo se creó esta nota. La investigación especifica qué evidencia cerraría G62 en su alcance; no justifica una puntuación 10.0 ni cierre global de adaptación.
