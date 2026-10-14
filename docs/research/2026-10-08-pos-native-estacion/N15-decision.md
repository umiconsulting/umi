# N15: opciones junto al control y continuidad del formulario

## Evidencia primaria y decisión

**HD.** [RawMenuAnchor](https://api.flutter.dev/flutter/widgets/RawMenuAnchor-class.html) coloca opciones junto a un ancla. La primitiva no administra por sí misma el foco ni la semántica. [PopupRoute](https://api.flutter.dev/flutter/widgets/PopupRoute-class.html) ofrece una ruta temporal, barrera y cierre. [SingleChildLayoutDelegate](https://api.flutter.dev/flutter/rendering/SingleChildLayoutDelegate-class.html) permite calcular la posición del hijo.

**Decisión con fundamento.** El menú usa `PopupRoute` y un cálculo propio de posición. La ruta conserva el cierre exterior y el foco. También conserva la regla del escáner de N14: un menú cubre la ruta de la comanda. `RawMenuAnchor` exigiría otra integración con esa regla. Ninguna opción exige Material ni una biblioteca visual.

**I.** El chevrón expresa una apertura local. Las opciones deben aparecer junto al control y mantener visible su origen. La decisión responde a G51 y a la observación del usuario sobre formas heredadas.

El menú limita su ancho y altura al área disponible. Abre arriba cuando falta espacio debajo. Mantiene la opción seleccionada, omite las opciones deshabilitadas y distingue cancelación de selección. Las flechas, Inicio y Fin recorren opciones. Enter y Espacio seleccionan; Escape cierra. El foco regresa al control. Un cambio de tamaño cierra las opciones y conserva el valor.

## Dos pérdidas de estado distintas

**OV, G52.** La captura anterior muestra que Ventas vuelve a Todas las ventas al pasar del teléfono al escritorio. Caja también pierde su total al cruzar la aparición de la navegación lateral. El contenedor `PosPage` sustituía una columna por una fila. La corrección usa un `Flex` estable y claves locales. [Widget.key](https://api.flutter.dev/flutter/widgets/Widget/key.html) documenta la relación entre la identidad del widget y la conservación de su elemento.

**OV, G53.** Después de corregir G52, el total conserva $70, pero las cantidades del contador vuelven a cero. `ShiftShell` mueve el formulario entre árboles distintos. La corrección conserva sus secciones mediante claves globales, propiedad de su estado.

**HD.** [GlobalKey](https://api.flutter.dev/flutter/widgets/GlobalKey-class.html) conserva un subárbol al cambiar de padre en el mismo cuadro. La documentación advierte del coste y pide conservar la clave entre construcciones. [KeyedSubtree](https://api.flutter.dev/flutter/widgets/KeyedSubtree-class.html) permite asignar esa identidad al contenido existente.

**Decisión con fundamento.** Las claves globales se limitan a las tres secciones móviles de Caja. El contenedor principal usa claves locales. La aplicación no recrea estas claves en cada construcción. La prueba comprueba cantidades, subtotales y una corrección posterior; conservar sólo el texto del total no basta.

## Procedencia e instrumentos

Consulta: 8–9 de octubre de 2026. SDK local: Flutter 3.47.5 y Dart 3.13.4. La revisión usa la compilación nativa de perfil, Flutter Driver y el puente externo AT-SPI. `xdotool` 4.20260303.1 envía teclas sólo después de comprobar proceso y foco. `grim` 1.5.0-2 captura únicamente el rectángulo de la ventana propia.

El lanzador ELF puede conservar el mismo SHA-256 entre versiones. La biblioteca `lib/libapp.so` contiene el código Dart compilado. El registro final identifica ambos archivos y las fuentes. Un hash del lanzador, por sí solo, no identifica una versión de la interfaz.

AT-SPI demuestra propiedades del puente accesible. No demuestra la experiencia de un lector hablado. Las capturas de Driver tampoco prueban la interacción completa. Una captura inicial omitió la navegación inferior; las capturas posteriores y el compositor la muestran. La causa de esa diferencia queda sin verificar.

La rama artística conserva [la memoria de Sarah Garcin, 2013](https://sarahgarcin.com/projets/experimentation-graphique-vs-diffusion-et-lisibilite-memoire). **I.** La expresión gráfica admite una composición propia; la lectura exige que la forma y la acción sean coherentes. La obra no demuestra usabilidad de un POS. La interacción nativa y las pruebas aportan esa evidencia concreta.
