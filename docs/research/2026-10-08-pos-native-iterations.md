# POS Estación: crítica e iteraciones nativas

Este registro conserva N1–N26 del fork y N27 integrado en el principal. La investigación artística está en [el informe](2026-10-08-pos-estacion.md). Las fuentes técnicas están en [la evidencia nativa](2026-10-08-pos-native-ui-evidence.md). La rúbrica permanece en [el plan](../plans/2026-10-08-pos-native-estacion.md).

## N1: versión inicial completa, 1.0

Commit: `2a4c721`. La nota fija el punto inicial solicitado. No representa una aprobación.

La interfaz entera usa controles propios sobre Flutter Widgets. Los iconos y los instrumentos del café usan dibujos de código. El cliente compila para Linux. La primera ejecución mostró un fallo del almacén de credenciales. La API respondió correctamente. El instrumento nativo permitió separar ambos hechos.

La suite completó 479 pruebas y falló 10. La sustitución de componentes no conservó toda la semántica. El teclado redujo el catálogo por debajo de su altura mínima. La confirmación de cocina añadió un diálogo sobre el estado actualizado. Una cuenta de caja perdió su agrupación accesible. Los iconos genéricos confundieron acciones distintas.

La distribución visual conserva demasiado de la interfaz anterior. El blanco, el azul y los bordes redondos no expresan por sí solos una identidad. Una galería de arte explica posibilidades visuales. No demuestra rapidez ni facilidad de uso en una caja.

## N2: operación y semántica, 2.3

La segunda versión conserva la cobertura de N1 y corrige estas brechas:

- El campo nombra su función y conserva la semántica de edición. El marcador de posición no sustituye el nombre accesible.
- El control de servicio nombra su número en un nodo propio. La cuenta de caja conserva sus términos y su respuesta.
- El tooltip usa `RawTooltip`, una primitiva de Flutter Widgets. El diseño del contenido sigue siendo propio. La primitiva conserva interacción, semántica y posición dentro de la pantalla.
- El envío a cocina deja visible el pedido actualizado. Los fallos conservan un mensaje explícito.
- Las filas de caja limitan el ancho del total. Los nombres largos y la máscara del efectivo pueden ocupar otra línea.
- El marcador de una línea enviada comparte el espacio con los controles sin desbordar.
- La navegación inferior cede espacio cuando aparece el teclado. El total y las acciones del pedido permanecen sobre el teclado.
- El icono toma su tamaño del contexto. El cliente mantiene los idiomas configurados; el contenedor genérico usa el idioma predeterminado del SDK.

La primera corrección de caja estrechó demasiado la máscara. Las pruebas detectaron esa regresión. La versión final la corrige. No se retiraron las comprobaciones de desborde ni las condiciones de pago.

Una hipótesis inicial atribuyó el desborde corto al campo de búsqueda. La inspección del árbol lo situó en la columna del catálogo. La navegación inferior también subía con el teclado y consumía el espacio restante. La prueba de 800 × 600, con 300 de teclado, pasa después de corregir esa distribución.

### Resultado comprobado

La [suite final](2026-10-08-pos-native-estacion/suite-N2.txt) pasa las **489 pruebas**. El [análisis final](2026-10-08-pos-native-estacion/analysis-N2.txt) no reporta problemas. La recarga nativa recompiló 30 bibliotecas. La [captura del PIN](2026-10-08-pos-native-estacion/N2-pin/screen.png) pertenece a la aplicación Linux, a 1920 × 1080.

El almacén de desarrollo usa un bus privado y directorios propios. El registro del terminal recorrió el campo y la acción nativos. La aprobación usó la ruta oficial. El entorno local contiene ONCA y no contiene las cuentas antiguas del playbook. Se creó una sesión temporal y un terminal de revisión. No se modificó ningún permiso. Esa preparación no prueba el inicio de sesión del operador.

Cada apertura usa un workspace vacío. El lanzador consulta las ventanas y asigna la ventana del fork mediante una regla de Hyprland 0.56.2. La ventana de revisión ocupa sola el workspace 3.

### Nota con la misma rúbrica

| Criterio                   | Peso | Nota | Evidencia y límite                                                                                            |
| -------------------------- | ---: | ---: | ------------------------------------------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% |  2.0 | Registro nativo y pedido probado. Falta recorrer la venta completa en el instrumento.                         |
| Calidad visual e identidad |  20% |  1.5 | El acceso tiene proporción clara. Sigue siendo genérico; el icono del PIN resulta incorrecto.                 |
| Cobertura y coherencia     |  15% |  2.5 | Toda la interfaz usa los mismos controles. Faltan capturas de todas las superficies y estados.                |
| Adaptación                 |  15% |  2.4 | Pasa el caso corto con teclado y las pruebas de escala. El encabezado móvil todavía oculta acciones.          |
| Accesibilidad              |  15% |  3.2 | Nombres, agrupación, foco y objetivos tienen pruebas. Falta comprobar selección y lector de pantalla nativos. |
| Respuesta y recuperación   |  10% |  2.5 | Pago incierto e identidad de comandos pasan sus pruebas. Falta recorrer la recuperación real.                 |
| Fluidez                    |   5% |  1.8 | El movimiento reducido tiene soporte. Falta una medición nativa de cuadros e interacción.                     |

Media ponderada: **2.255 → 2.3**. Las correcciones operativas no justifican una nota alta para una identidad todavía incompleta. No se traslada la nota del prototipo web al cliente nativo.

### Crítica visual de la captura

La tarjeta del PIN centra bien la tarea. El teclado conserva objetivos amplios. El título tiene un peso adecuado. La pantalla reserva demasiado espacio sin expresar el café, la sucursal ni la identidad del producto. El signo genérico sobre el título parece una acción médica. Los tonos azules ocupan casi todo el teclado aunque las cifras ya bastan para reconocerlo. El botón desactivado reduce mucho su legibilidad. Las esquinas y los bordes repiten el mismo ritmo en elementos con funciones distintas.

El resultado es ordenado, pero todavía no es precioso ni original. La siguiente versión debe resolver identidad y reconocimiento mediante capturas del POS completo. Decorar únicamente el acceso dejaría intacta la brecha principal.

## Brechas acumulativas para N3

| Identificador | Brecha                                            | Prueba de cierre                                                                  |
| ------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| G01           | Falta revisar todas las superficies nativas       | Inventario de rutas, estados, tareas y capturas reales.                           |
| G02           | La identidad resulta genérica                     | Comparación visual con la investigación y decisiones propias para el café.        |
| G03           | Iconos distintos usan un dibujo genérico          | Inventario de glifos; reconocimiento y significado coherente en cada acción.      |
| G04           | El encabezado compacto exige desplazamiento       | Acciones y contexto visibles en teléfono y tablet; teclado y nombres largos.      |
| G05           | Edición y selección insuficientemente verificadas | Copiar, pegar, seleccionar, composición y foco en el cliente nativo.              |
| G06           | Falta medir fluidez                               | Medición del instrumento; movimiento reducido sin trabajo continuo innecesario.   |
| G07           | Un formulario pierde el valor inicial             | Conservación del texto, validación, reinicio y actualización del controlador.     |
| G08           | Varias propiedades visuales se aceptan sin efecto | Retirar propiedades vacías o implementar su efecto verificable.                   |
| G09           | Falta verificar todos los tamaños de caja         | 1280 × 720, tablet y teléfono; objetivos completos y nombres legibles.            |
| G10           | Falta una revisión final integral                 | Tareas completas, estados de error y permisos; ninguna brecha importante abierta. |

## Procedencia adicional

`RawTooltip` pertenece a [Flutter Widgets en el commit del SDK instalado](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/widgets/raw_tooltip.dart). El código de [los buscadores de Flutter Test](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter_test/lib/src/finders.dart) verifica su texto semántico. La elección conserva el diseño propio y usa una primitiva mantenida por el framework.

Hyprland documenta [las reglas nombradas de ventanas](https://wiki.hypr.land/configuring/core/rules/window-rules/) y [el cambio de workspace mediante Lua](https://wiki.hypr.land/configuring/code-snippets/). Las rutas antiguas de la wiki devolvieron errores. Se consultó la documentación actual y se verificó el resultado mediante la lista de ventanas del compositor.

Los manifiestos conservan las huellas del código de [N1](2026-10-08-pos-native-estacion/N1-manifest.json) y [N2](2026-10-08-pos-native-estacion/N2-manifest.json). Las capturas prueban apariencia y distribución. Las pruebas automáticas prueban sus condiciones. Ninguno de esos instrumentos representa una prueba con operadores humanos.

## N3: reconocimiento y distribución, 3.1

La tercera versión conserva N2 y corrige la distribución de la venta. La tarjeta tiene una altura definida por el contenido y la escala. En caja mediana, las categorías pasan a una fila. En pantallas grandes conservan su columna. La fotografía del comercio conserva su lugar. El nombre y el precio permanecen visibles cuando falta la fotografía.

En la captura de **1280 × 720**, N2 muestra dos productos completos. La [captura final de N3](2026-10-08-pos-native-estacion/N3-catalog-1280/screen.png) muestra ocho. La [tablet de 1024 × 768](2026-10-08-pos-native-estacion/N3-catalog-tablet/screen.png) muestra seis. Ambas conservan el total y la acción de cobro en el panel del pedido. Esa cantidad describe la captura; no demuestra un tiempo de búsqueda menor. El [apéndice de tipografía y reconocimiento](2026-10-08-pos-native-typography.md) conserva evidencia primaria que cuestiona esa deducción. El estudio de máquinas de bebidas no encontró una mejora significativa al reducir elementos por página. Los experimentos no equivalen a una caja de café.

El [teléfono de N3](2026-10-08-pos-native-estacion/N3-catalog-phone-dock/screen.png), a **375 × 812**, muestra cuatro productos completos. El total ocupa un lugar fijo. La acción del pedido dejó de cubrir el precio del último producto. El encabezado mantiene la sucursal, la conexión, la venta nueva, las opciones y la cuenta. El tipo de servicio ocupa otra fila. Las secciones secundarias están en [Más](2026-10-08-pos-native-estacion/N3-phone-more/screen.png).

Los dibujos ahora distinguen galleta, croissant, rollo, pastel, sándwich, pan, filtro, bebida fría y familias de café y té. Un nombre desconocido recibe una figura neutra. El dibujo no afirma una receta ni sustituye la fotografía del comercio. El nombre sigue identificando el producto. Las fotografías del fixture tienen errores de correspondencia: el Americano muestra varias bebidas y el Cheesecake muestra otro pastel. Esa brecha del material de demostración permanece explícita.

Los **142 nombres de glifos** tienen un dibujo. Las variantes que representan la misma acción comparten una familia. Caja, PIN, para llevar, correo, USB, descarga, ayuda, advertencia y acciones de persona dejaron de usar el signo genérico. El [atlas](2026-10-08-pos-native-estacion/N3-glyph-inventory.png) procede de Flutter Test. Sus barras de texto pertenecen a la fuente de pruebas Ahem. Sirve para revisar dibujos; no prueba la tipografía del producto ni reemplaza las capturas nativas.

El formulario conserva el valor inicial. La validación, el guardado, el reinicio y los cambios externos del controlador permanecen sincronizados. El propietario conserva sus controladores. El progreso determinado y el movimiento reducido detienen el reloj de animación. Esa prueba demuestra ausencia de cuadros programados por ese control, no rapidez global del POS.

### Correcciones durante la crítica

La primera adaptación del catálogo dejó siete etiquetas demasiado estrechas en el teléfono. «Más» conserva todas las secciones sin dividir sus nombres en varias líneas. La acción flotante todavía cubría productos. Se convirtió en una acción fija con el total.

La visita a Mesas detectó un desborde derecho. La pantalla tenía una fila propia; el encabezado general no la controlaba. Se sustituyó esa fila por la distribución adaptable. La [captura final de Mesas](2026-10-08-pos-native-estacion/N3-phone-tables-final/screen.png) muestra contexto, estados y acciones completos. La revisión inicial fallida se conserva como evidencia de la regresión detectada.

Flutter Test encuentra `RawTooltip`. El buscador de Flutter Driver sigue buscando el `Tooltip` de Material. Ese hecho explica un fallo del instrumento al pulsar Volver. Se añadió un buscador propio mediante `FinderExtension`, la extensión documentada por el SDK. No se cambió el control del producto para satisfacer ese buscador. Fuentes: [buscador de Driver en el SDK instalado](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter_driver/lib/src/common/handler_factory.dart), [extensiones del instrumento](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter_driver/lib/src/extension/extension.dart).

### Verificación y procedencia

La [suite de la copia aislada](2026-10-08-pos-native-estacion/suite-N3-isolated.txt) pasa **495 pruebas**. El [análisis de esa copia](2026-10-08-pos-native-estacion/analysis-N3-isolated.txt) no reporta problemas. La copia contiene N2 y los cambios propios de N3. Así se separó un trabajo concurrente sobre almacenamiento TPM. Ese trabajo queda fuera de la evaluación. El [manifiesto](2026-10-08-pos-native-estacion/N3-manifest.json) conserva las huellas y declara las diferencias de procedencia del instrumento nativo. La opción TPM permanece desactivada en esta ejecución.

El catálogo y el PIN usan la API **4013** y una base desechable. La base contiene el fixture UmiPOS Local. La aprobación del terminal recorre la ruta oficial. El inicio con el PIN publicado por el fixture respondió 201. El contexto del operador, los productos, las categorías y la caja respondieron correctamente. No se presenta una venta cobrada que todavía no se recorrió.

El inventario nativo del catálogo grande registra **30 acciones**, sin nombres ausentes ni objetivos recortados. En el teléfono inicial registra tres recortes dentro de listas desplazables. El desplazamiento real muestra Alimentos con **129 × 48**, Cheesecake y Cold brew con **164 × 176**. Las [categorías desplazadas](2026-10-08-pos-native-estacion/N3-phone-category-scrolled.json) y los [productos desplazados](2026-10-08-pos-native-estacion/N3-phone-products-scrolled.json) conservan la prueba. Los objetivos completos de esos tres controles cumplen 48. El instrumento usa 44 como umbral; el plan conserva **48**. Se examinaron también sus dimensiones con el umbral del plan. Mesas tiene tres acciones completas de 48.

El proveedor de desarrollo usa un bus privado, datos privados y un directorio temporal corto para sus sockets. Se archivó únicamente su almacén anterior de prueba. El bus privado no puede activar un diálogo gráfico. Cada apertura de la ventana ocupa un workspace vacío. Un diálogo del proveedor apareció antes de completar ese aislamiento; se retiró. No se considera cumplida la preferencia sólo por haber escrito una regla.

La comparación prueba distribución sobre Linux. Una ventana del tamaño de teléfono no verifica Android, iOS, su teclado o su lector de pantalla.

### Nota acumulativa

| Criterio                   | Peso | Nota | Evidencia y límite                                                                                             |
| -------------------------- | ---: | ---: | -------------------------------------------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% |  3.5 | Pedido y total visibles. Más productos completos. Falta la venta completa observada.                           |
| Calidad visual e identidad |  20% |  2.6 | Dibujos específicos y proporción controlada. Tipografía, colores y bordes siguen genéricos.                    |
| Cobertura y coherencia     |  15% |  3.0 | Reconocimiento y formularios propios. Falta revisar todos los estados de cada superficie.                      |
| Adaptación                 |  15% |  4.0 | Teléfono, caja mediana y Mesas; encabezados y pedido completos. Falta la revisión móvil por plataforma.        |
| Accesibilidad              |  15% |  3.5 | Nombres, objetivos completos y pruebas a escala doble. Falta lector nativo y selección completa.               |
| Respuesta y recuperación   |  10% |  2.7 | Registro y acceso reales. El cargador del acceso pierde contexto; recuperación completa todavía pendiente.     |
| Fluidez                    |   5% |  1.6 | El reloj reducido se detiene. La cadena local de acceso mostró esperas largas sin medición que aísle su causa. |

Media ponderada: **3.145 → 3.1**. El criterio de fluidez baja respecto de N2 por la nueva observación. La corrección de dibujos no compensa una tarea todavía lenta o insuficientemente comprobada.

### Brechas conservadas y nuevas

G01, G02, G05, G06, G08, G09 y G10 siguen abiertas. G03 tiene cobertura de todos los glifos, pero falta comprensión con operadores. G04 tiene evidencia del catálogo y Mesas; las demás cabeceras requieren visita. G07 queda cerrada por pruebas del ciclo del formulario.

**G11:** el [acceso en carga](2026-10-08-pos-native-estacion/N3-entry-loading/screen.png) muestra fondo negro y un círculo sin explicación. Debe conservar identidad, contexto y estado comprensible.

**G12:** la cadena local de acceso tiene esperas largas. Entre la aceptación del PIN y la creación de la venta pasaron unos 42 segundos en los registros de API. Eso no mide el primer cuadro utilizable ni atribuye la causa al diseño. Se requiere separar credenciales, red, modo de compilación y presentación.

**G13:** revisar las fotografías del fixture y comprobar reconocimiento. No ocultar fotografías del comercio para fabricar una captura uniforme.

La próxima ronda debe desarrollar la identidad tipográfica, resolver G11 y revisar formularios, cobro, caja y estados reales. El informe distingue observación, hipótesis y prueba. No usa una preferencia estética como certificación de facilidad de uso.

## N4: tipografía y estados legibles, 3.9

La cuarta versión empaqueta **IBM Plex Sans** para la operación y **Bricolage Grotesque** para títulos breves. Usa archivos oficiales fijados. Conserva sus licencias OFL y huellas. Incluye pesos reales y una cursiva real de Plex. Los archivos de fuente suman **1,247,536 bytes**. No se añade un paquete de tipografía ni una biblioteca visual. La [procedencia](2026-10-08-pos-native-estacion/N4-font-and-color-evidence.json) permite reproducir la selección. La [documentación de Flutter](https://docs.flutter.dev/cookbook/design/fonts) explica su empaquetado.

La firma tiene tres trazos y un punto de referencia. Es un dibujo propio. El [PIN de teléfono](2026-10-08-pos-native-estacion/N4-pin-phone/screen.png) conserva teclado, título y acción completos. La firma ocupa el lugar del icono aislado. El tamaño de las superficies diferencia el panel del control. El [catálogo de caja](2026-10-08-pos-native-estacion/N4-catalog-1280/screen.png) conserva fotografías, dibujos, nombres, importes y el pedido. La composición sigue sobria. La identidad todavía necesita una crítica de todas las superficies.

### Hechos comprobados

Los botones desactivados usan tinta legible. El contraste de sus tokens claros es **5.30:1**. La acción principal clara tiene **5.93:1**. Son pares sólidos calculados; no certifican cada combinación del producto. La revisión de cobro detectó una prioridad incorrecta: el estilo tipográfico imponía tinta oscura sobre azul. El color del botón ahora prevalece sobre ese estilo. Una prueba conserva esta condición.

Los campos aplican los bordes configurados para reposo y foco. El menú de edición usa `TextSelectionToolbarLayoutDelegate` de Flutter Widgets. Su ancho responde al viewport. La prueba de **320 × 420 con escala 2** conserva Cortar, Copiar y Pegar dentro de la pantalla. Fuente primaria: [implementación del SDK instalado](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/widgets/text_selection_toolbar_layout_delegate.dart).

La [prueba nativa de edición](2026-10-08-pos-native-estacion/N4-native-editing.json) conserva «Café de piñón · sin azúcar» después de copiar, cortar y pegar. El [menú nativo](2026-10-08-pos-native-estacion/N4-native-editing-menu-final/screen.png) muestra selección y acciones. El portapapeles anterior se restauró con su MIME. Se corrigieron errores del instrumento: búsqueda OR de ventanas, punto de pulsación de una etiqueta y codificación del puente X11. El buscador del campo ahora identifica `EditableText` dentro del campo propio y verifica el texto leído.

Esta ejecución de Driver tiene entrada emulada. Los atajos y el portapapeles son reales. La prueba no certifica el IME del sistema. La próxima ejecución separará esas condiciones. No se atribuye a la interfaz el fallo inicial del instrumento.

Los importes usan cifras tabulares. `TextPainter`, con Plex cargada, confirma el mismo avance para los diez dígitos. La prueba no sustituye una tarea de lectura humana. Bricolage conserva el corte estático 12pt, sin una inferencia incorrecta entre puntos ópticos y píxeles lógicos.

La pantalla ahora dice **Impuestos incluidos**. La [fuente del cálculo](../../apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts) extrae el impuesto del precio incluido. El [cobro](../../apps/umi-api/src/modules/pos-checkout/pos-checkout.service.ts) conserva esa regla. El cambio sólo explica el importe. La etiqueta larga detectó tres desbordes en la suite. Las filas ahora permiten ajuste del texto y conservan el importe. La [ejecución fallida](2026-10-08-pos-native-estacion/suite-N4-tax-label-failure.txt) permanece en el registro. «Tiempo de servicio» sustituye «Curso» y conserva el valor contractual.

### Acceso, carga y recuperación

`EntrySurface` usa un fondo propio y textos por fase. Conserva la firma, el título y el progreso. El arranque también explica su actividad. Los fallos de dispositivo y red tienen fondo y contenido desplazable. Las pruebas con fuentes reales revisan el estado de carga a escala 1 y 2. **Su captura nativa todavía no está obtenida:** la captura intermedia del acceso ya había alcanzado el catálogo. G11 conserva ese límite.

El [cronómetro de acceso](2026-10-08-pos-native-estacion/N4-login-timing/timing.json) registra **2057 ms** hasta un producto visible. Es una muestra caliente en debug. No mide el pedido completamente restaurado, cuadros ni arranque frío. La espera de 42 segundos de N3 sigue sin una causa aislada. El nuevo resultado no borra aquella observación.

La [captura intermedia](2026-10-08-pos-native-estacion/N4-login-timing/intermediate.png) mostró **MXN 0.00** después del bloqueo y otro PIN. La hipótesis inicial fue un valor temporal incorrecto. La captura final también muestra un pedido vacío. La [consulta actual del backend](../../apps/umi-api/src/modules/pos-sale/pos-sale.repository.ts) selecciona por sesión de operador. El nuevo PIN inicia otra sesión y otro pedido. **Se descarta la afirmación de un importe falso restaurado.** Falta recorrer la recuperación del pedido anterior. La comparación de estados distintos no sirve para certificar una regresión de importes.

El cobro llega a la [negativa de turno ausente](2026-10-08-pos-native-estacion/N4-checkout-review/screen.png). Evita registrar dinero. Ofrece Reintentar y Cerrar. El reintento repite una condición que el operador debe corregir en caja. La recuperación necesita una acción clara. La visita al [Centro de caja](2026-10-08-pos-native-estacion/N4-cash-1280/screen.png) muestra el fondo y la política. Su acción de apertura queda debajo del área visible inicial. Esa tarea exige otra corrección.

### Verificación y nota acumulativa

La [copia aislada](2026-10-08-pos-native-estacion/suite-N4-isolated.txt) aprueba **502 pruebas**. Su [análisis](2026-10-08-pos-native-estacion/analysis-N4-isolated.txt) no reporta problemas. El [manifiesto](2026-10-08-pos-native-estacion/N4-manifest.json) conserva fuentes, capturas y diferencias de procedencia. La copia excluye el trabajo concurrente TPM. La ejecución de trabajo aprueba 509 pruebas, pero las siete adicionales no puntúan este diseño.

| Criterio                   | Peso | Nota | Evidencia y límite                                                                                     |
| -------------------------- | ---: | ---: | ------------------------------------------------------------------------------------------------------ |
| Tarea y jerarquía          |  20% |  4.0 | Pedido y cobro recorridos. La venta completa y la apertura visible de caja siguen pendientes.          |
| Calidad visual e identidad |  20% |  4.0 | Fuentes de autores identificados, firma propia y lectura consistente. Falta crítica integral.          |
| Cobertura y coherencia     |  15% |  3.6 | Campos, botones, acceso, producto, cobro y caja. Falta revisar las demás superficies y estados.        |
| Adaptación                 |  15% |  4.5 | PIN de teléfono; menú estrecho ampliado; filas de importes adaptables. Plataformas móviles pendientes. |
| Accesibilidad              |  15% |  4.5 | Contraste corregido, edición nativa y cifras uniformes. IME y lector de pantalla siguen pendientes.    |
| Respuesta y recuperación   |  10% |  3.1 | Carga contextual implementada. Recuperación de turno y pedido anterior aún pendientes.                 |
| Fluidez                    |   5% |  2.0 | Una muestra caliente de acceso; reloj reducido conservado. Faltan inicio frío y medición de cuadros.   |

Media ponderada: **3.900 → 3.9**. La nueva muestra cambia la evidencia de fluidez; no certifica rendimiento. Las brechas detectadas durante la ronda permanecen en el cálculo.

### Brechas acumuladas para N5

G01, G02, G03, G04, G05, G06, G08, G09 y G10 conservan trabajo pendiente. G07 permanece cerrada. G11 tiene implementación y pruebas, con captura nativa pendiente. G12 tiene una muestra caliente; falta separar condiciones. G13 conserva las fotografías incorrectas del fixture.

**G14:** el detalle contiene Agregar o Guardar dentro de la lista. Un producto con opciones extensas exige revisar su acceso y el contexto al desplazarse.

**G15:** el cobro sin turno ofrece Reintentar. La acción debe conducir a resolver la condición o explicar el siguiente paso útil.

**G16:** la apertura de caja queda debajo del área inicial de 1280 × 720. El total y la acción deben permanecer visibles.

**G17 — hipótesis corregida:** no se comprobó un cero transitorio incorrecto. El nuevo acceso creó un pedido vacío de otra sesión. Falta revisar conservación y recuperación del pedido anterior después del bloqueo.

N5 debe corregir esas tareas, ejecutar entrada real del sistema y medir el cliente nativo con condiciones declaradas. Una nota de 10 requiere cerrar brechas importantes; no se obtiene al cambiar una fuente.

## N5 — Tareas completas y límites del instrumento

### Resultado

N5 permite conservar la acción de producto y la apertura de caja fuera de sus listas. La venta nativa de prueba termina en **Pagado · MXN 62.00**. La consulta posterior de la base desechable confirma una venta comprometida, un asiento de efectivo por 6200 centavos, cambio cero y la nota original. La nota se escribió con el teclado del sistema. La nota acumulativa es **4.4/10**. Las brechas nuevas impiden conceder una mejora mayor.

Esta ejecución usa la copia de verificación, basada en `7f61e9b`, con los cambios propios N5. Excluye el trabajo concurrente de almacenamiento TPM. El cliente, sus credenciales de desarrollo y API 4013 permanecen aislados. El lanzador abrió la ventana en el workspace 3 después de comprobar que estaba vacío.

### Evidencia primaria y decisiones

La [documentación del SDK](https://api.flutter.dev/flutter/flutter_driver_extension/enableFlutterDriverExtension.html) distingue la entrada simulada de Flutter Driver y el teclado del sistema. La extensión permite el teclado real cuando se desactiva la simulación. N5 lo hace por defecto. Los comandos que necesitan texto simulado lo activan sólo durante esa operación y lo desactivan al terminar. El lanzador normal usa `lib/main.dart`; la extensión requiere una opción explícita. Release rechaza el objetivo de pruebas. La fuente instalada de `traceAction` advierte sobre medir en debug. El cliente de esta ronda se compiló en **profile**.

W3C describe el [riesgo de ocultar el foco con un pie fijo](https://www.w3.org/WAI/WCAG22/Techniques/failures/F110), con revisión del 15 de julio de 2025. El [criterio reforzado](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-enhanced) exige mantener visible todo el componente enfocado. Es una referencia de diseño, no una certificación WCAG de este cliente. **Inferencia aplicada:** reservar espacio para el pie y reducir el área de la lista; evitar una capa sobre los campos. Las pruebas desplazan el contenido y comprueban que el botón conserva su posición con 200 píxeles de teclado.

La continuidad de estado explorada en las obras de _The HTML Review_ tiene aquí una traducción concreta: la nota y el pedido deben sobrevivir a una corrección de caja. Esa relación es una interpretación de diseño. La [auditoría posterior](2026-10-08-pos-native-estacion/N5-backend-task.json) demuestra conservación en esta tarea; no demuestra por sí sola comprensión o satisfacción del operador.

### Producto, caja y cobro

El [detalle de Latte](2026-10-08-pos-native-estacion/N5-latte-options-1280/screen.png) conserva Agregar al carrito y explica la variante que falta. El [detalle modal de teléfono](2026-10-08-pos-native-estacion/N5-latte-modal-phone/screen.png) hace lo mismo. La edición simple mantiene [Guardar cambios](2026-10-08-pos-native-estacion/N5-detail-1280-final/screen.png) visible. Los callbacks de agregar y editar conservan sus contratos.

La caja conserva total, acción y motivo de bloqueo en [1280 × 720](2026-10-08-pos-native-estacion/N5-cash-opening-1280/screen.png) y [375 × 812](2026-10-08-pos-native-estacion/N5-cash-opening-phone/screen.png). En áreas de trabajo menores que 240 píxeles, la composición completa permite desplazamiento para evitar un desbordamiento; ese caso no recibe la garantía de pie fijo. La política conserva todos sus valores y puede ajustar el texto en anchuras estrechas.

La primera verificación encontró cinco fallos. Dos correspondían a geometría del pie y otro a la política estrecha. El sistema propio también descontaba varias veces el mismo teclado al anidar páginas. La corrección consume el inset después de reservar su espacio. Un botón deshabilitado obtenía un nombre combinado con el total de su tarjeta; ahora cada control tiene su frontera semántica. La prueba de detalle amplia tenía foco con cursor activo y no podía usar un reloj de asentamiento indefinido. Su inspección usa avances acotados. Se conservan los [fallos iniciales](2026-10-08-pos-native-estacion/suite-N5-initial-failure.txt) y el [primer análisis](2026-10-08-pos-native-estacion/analysis-N5-initial-failure.txt).

El [cobro rechazado](2026-10-08-pos-native-estacion/N5-checkout-cash-refusal/screen.png) ofrece Abrir caja y continuar. La acción respeta el permiso de apertura. Una caja ocupada por otra terminal mantiene su explicación y no ofrece esa apertura. Durante la recuperación se bloquea un segundo toque. El reintento conserva la identidad y la clave de idempotencia del cobro. Las pruebas comprueban esos datos; la consulta nativa confirma un solo efecto monetario.

La tarea contó cinco billetes de MXN 20.00, abrió el turno con MXN 100.00 y volvió al cobro. La [pantalla pagada](2026-10-08-pos-native-estacion/N5-checkout-after-cash/screen.png) y el [comprobante](2026-10-08-pos-native-estacion/N5-receipt/screen.png) corresponden a ese recorrido. Todo ocurrió en la base desechable. No se usó una terminal financiera externa. La vuelta mediante Cerrar todavía necesita una acción que explique expresamente la continuación del cobro.

### Entrada y fluidez

La [captura de entrada nativa](2026-10-08-pos-native-estacion/N5-native-keyboard/screen.png) contiene «Café de piñón · sin azúcar». XTEST envió las teclas a la ventana enfocada del fork, con la simulación de texto desactivada. La lectura del campo devolvió exactamente esa cadena. Esto demuestra entrada de caracteres por GTK/X11; no certifica composición de un IME japonés, chino u otro método complejo. El portapapeles conserva la prueba previa de N4; no se atribuye aquí una nueva ejecución de copiar y pegar.

El [cronómetro caliente](2026-10-08-pos-native-estacion/N5-login-profile/timing.json) registra **2090 ms** desde Continuar hasta un producto visible. Incluye una captura intermedia, por lo que no aísla el coste de autenticar. No sustituye la observación lenta de N3 ni mide inicio frío.

La [muestra de cuadros](2026-10-08-pos-native-estacion/N5-frames-profile/catalog.timeline_summary.json) contiene 19 construcciones y 19 rasterizaciones durante doce pulsaciones de categoría. El peor tiempo de construcción es **6.172 ms** y el de rasterización **3.062 ms**. El resumen del SDK registra cero cuadros fuera de sus presupuestos. Se conserva un [extracto de eventos](2026-10-08-pos-native-estacion/N5-frames-profile/catalog.frames.json), sin argumentos. La medición es corta; cada pulsación espera un cuadro, pero no espera necesariamente el resultado completo de red de la categoría. No demuestra rendimiento de todas las superficies. Los campos de GPU sin observaciones no representan una GPU de coste cero. Los comandos con un texto ambiguo o un producto todavía no construido fallaron; se corrigió el instrumento con un ancestro específico y el desplazamiento iterativo del SDK.

### Crítica acumulativa

La [recuperación de historial](2026-10-08-pos-native-estacion/N5-history-initial/screen.png) muestra la venta suspendida, pero su botón queda deshabilitado ante el pedido vacío nuevo. G17 es ahora un problema reproducido. El backend exige cerrar el pedido activo antes de reanudar otro. Eso protege los pedidos con contenido. Falta una transición clara para el pedido vacío.

La revisión también encuentra dos motivos de cancelación del cliente fuera del enum contractual: `operator_session_ended` y `operator_started_new_sale`. La fuente del contrato sólo admite cuatro valores. G19 exige revisar los caminos de bloqueo vacío y sustitución. Es evidencia de incompatibilidad de código; esta ronda no atribuye a ella una respuesta nativa que no capturó.

Las opciones sin seleccionar dibujan un visto. El selector `contains('check')` del pintor captura también `radio_button_unchecked` antes de llegar a la rama de radio. G23 es un error comprobable de representación. El atlas de N3 demostraba cobertura de nombres, no corrección de todas las figuras. No se transfiere esa cobertura a comprensión.

El [cambio de tamaño con un detalle abierto](2026-10-08-pos-native-estacion/N5-resize-detail-context/screen.png) oculta el panel amplio al pasar a teléfono. G24 exige mantener la tarea y su estado al cambiar composición. La captura modal posterior representa otra apertura y no cierra esa brecha.

El estado de caja estrecho desplaza horizontalmente su instrucción; G22 exige lectura inmediata. El detalle repite título y presenta SKU y código antes de las decisiones; G20 requiere revisar jerarquía y acceso secundario. G21 exige una vuelta al cobro explícita. El título «Cobro autorizado» también requiere precisión: aparece antes del efecto monetario.

| Criterio                   | Peso | Nota N5 | Evidencia y límite                                                                           |
| -------------------------- | ---: | ------: | -------------------------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% |     5.2 | Venta y comprobante reales; acción y total visibles. Recuperación del pedido bloqueada.      |
| Calidad visual e identidad |  20% |     4.0 | Conserva fuentes y dibujos. Títulos duplicados y fotografía del fixture pendiente.           |
| Cobertura y coherencia     |  15% |     3.6 | Mayor recorrido; representación falsa de selección e incompatibilidad de motivos detectadas. |
| Adaptación                 |  15% |     4.5 | Pie en teléfono y teclado corregido. Estado de detalle al redimensionar pendiente.           |
| Accesibilidad              |  15% |     4.9 | Teclado real y controles separados. IME complejo, lector y selección aún pendientes.         |
| Respuesta y recuperación   |  10% |     4.7 | Falta de caja corregida con venta completa. Vuelta explícita y pedido anterior pendientes.   |
| Fluidez                    |   5% |     3.5 | Muestra profile dentro del presupuesto. Alcance corto e inicio frío pendiente.               |

Media ponderada: **4.435 → 4.4**. La [suite aislada](2026-10-08-pos-native-estacion/suite-N5-isolated.txt) aprueba **508 pruebas**. El [análisis final](2026-10-08-pos-native-estacion/analysis-N5-isolated.txt) no encuentra problemas. El [manifiesto](2026-10-08-pos-native-estacion/N5-manifest.json) identifica las fuentes compiladas y los límites de procedencia.

G18, descuento repetido del teclado, queda corregida en las composiciones examinadas. G14 y G16 cierran el acceso inicial de la acción en las condiciones declaradas. G15 conserva el trabajo de G21. G17 y G19–G24 pasan a N6. Las brechas amplias G01–G06, G08–G13 siguen con sus límites anteriores. N5 no cumple el objetivo de 10.0.

## N6 — Continuidad y decisiones explícitas

### Resultado y procedencia

La nota acumulativa es **5.0/10**. El detalle conserva la variante y la nota al cambiar entre escritorio y teléfono. Reanudar un pedido puede sustituir el borrador vacío mediante los comandos existentes del backend. Una vuelta desde caja permite distinguir Cerrar de Volver y cobrar. Esta última acción termina la venta de prueba de **MXN 65.00**.

La compilación profile procede de `9ebd26a` más los cambios propios N6, en `/tmp/umi-pos-n3-verify`. Excluye la configuración y el almacenamiento TPM concurrentes. El [manifiesto N6](2026-10-08-pos-native-estacion/N6-manifest.json) contiene el hash del binario y las fuentes. El lanzador reservó el workspace 3 vacío. Los cambios posteriores del cliente de Flutter Driver añaden búsquedas delimitadas y desplazamiento de listas; no cambian el binario de la aplicación. La sesión guardada se restauró al iniciar. El primer intento del instrumento de esperar el PIN falló porque la pantalla ya era el catálogo; no constituye una medida de acceso.

### Evidencia primaria aplicada

El [SDK documenta GlobalKey](https://api.flutter.dev/flutter/widgets/GlobalKey-class.html) como un mecanismo para mover un subárbol conservando su estado. Exige retirarlo e insertarlo en el mismo cuadro, conservar la clave fuera de `build` y no colocarla simultáneamente en dos lugares. También advierte del coste de reconstrucción. **Inferencia aplicada:** el catálogo posee una sola clave por apertura de producto y compone el mismo detalle en ambas anchuras. No abre un segundo formulario modal en teléfono. Esto evita la desaparición de la tarea observada en N5; no equivale a una medición de coste cero.

La [propiedad selected](https://api.flutter.dev/flutter/semantics/SemanticsProperties/selected.html) representa tanto el estado elegido como el vacío cuando su valor no es nulo. La selección se coloca en el control que recibe la acción. La prueba inspecciona ese nodo, con su etiqueta y acción, antes y después de elegir. No demuestra por sí sola la lectura con Orca u otro lector externo.

La fuente primaria contractual, `packages/contract/src/pos-sale.ts`, admite `customer_changed`, `operator_mistake`, `duplicate` y `other`. Los cierres automáticos del cliente usaban dos códigos distintos. Ahora usan `other` con una nota que explica la operación. No se cambia el enum, el backend, sus permisos ni sus comprobaciones de versión. La sustitución vacía es una secuencia de cancelar y reanudar; no se presenta como una transacción atómica.

### Pedido y detalle

El [historial inicial](2026-10-08-pos-native-estacion/N6-history-before/screen.png) permite reanudar ante el borrador vacío. El [pedido recuperado](2026-10-08-pos-native-estacion/N6-order-resumed/screen.png) contiene Cappuccino, MXN 62.00 y la nota anterior. La [consulta posterior](2026-10-08-pos-native-estacion/N6-backend-resumed.json) confirma un borrador cancelado sin líneas, con motivo canónico, y el pedido recuperado con la nota original. Las pruebas impiden la sustitución de un pedido con líneas o en cobro, no reanudan cuando falla el cierre vacío y bloquean una segunda operación simultánea.

El bloqueo explícito suspende el pedido con contenido. Un nuevo acceso crea un borrador vacío; el segundo bloqueo [vuelve al PIN](2026-10-08-pos-native-estacion/N6-empty-lock/screen.png). La [consulta de salida vacía](2026-10-08-pos-native-estacion/N6-backend-empty-exit.json) comprueba el motivo `other` y cero líneas. Esta evidencia cierra la incompatibilidad G19 en los caminos declarados. No modifica la conclusión anterior: el cero del pedido nuevo era legítimo.

El detalle presenta el nombre una vez y desplaza SKU y código a Información del producto. La [apertura de Latte](2026-10-08-pos-native-estacion/N6-latte-unselected/screen.png) ya muestra círculos vacíos en las opciones no elegidas. El pintor evalúa la familia radio antes del texto genérico `check`. Una prueba de píxeles comprueba el contorno en ambos glifos y el centro sólo en el seleccionado.

La [nota de teléfono](2026-10-08-pos-native-estacion/N6-resize-phone-note/screen.png) se escribió mediante XTEST con la simulación de texto desactivada. El instrumento confirmó el PID y el foco antes de enviar las teclas. Un intento anterior se detuvo al faltar ese foco; no envió texto a otra ventana. La lectura devolvió exactamente «Café de piñón · sin azúcar» antes y [después de volver a escritorio](2026-10-08-pos-native-estacion/N6-resize-wide-note/screen.png). La variante Chico permanece elegida en [escritorio](2026-10-08-pos-native-estacion/N6-resize-wide-choice/screen.png) y [teléfono](2026-10-08-pos-native-estacion/N6-resize-phone-choice/screen.png). La prueba automatizada también conserva modificadores. La tarea nativa añade Leche entera y termina el pedido. No se atribuye esta entrada a un IME complejo.

### Caja y cobro

El [estado estrecho](2026-10-08-pos-native-estacion/N6-cash-opening-phone/screen.png) ajusta su instrucción y metadatos en varias líneas. Ya no requiere desplazamiento horizontal para leer el motivo principal. El pie conserva total y acción en esta captura de 375 × 812. El umbral de espacio reducido es ahora 160 multiplicado por la escala de texto; debajo de él, el conjunto permite desplazamiento. No se afirma que un pie pueda quedar fijo en cualquier altura física.

El recorrido cuenta **100 + 50 + 10 + 2 = MXN 162.00**, presenta el [arqueo con diferencia cero](2026-10-08-pos-native-estacion/N6-cash-count-submitted/screen.png), concilia y muestra una [confirmación explícita](2026-10-08-pos-native-estacion/N6-cash-close-confirm/screen.png). Después del cierre, el servidor deja de devolver ese turno como actual. El instrumento esperó Turno cerrado y falló; la [pantalla observada](2026-10-08-pos-native-estacion/N6-cash-closed/screen.png) indica abrir un nuevo turno. Esa espera incorrecta no se registra como una falla de cierre.

El cobro sin turno permite abrir caja. Tras abrir con MXN 100.00, el encabezado ofrece [Volver y cobrar](2026-10-08-pos-native-estacion/N6-explicit-return/screen.png). Cerrar vuelve al catálogo con el mismo Latte pendiente. La [consulta posterior a Cerrar](2026-10-08-pos-native-estacion/N6-close-without-charge.json) conserva una sola venta y un solo efecto monetario, los de N5. No cobra al cerrar. El turno de prueba se vuelve a contar, conciliar y cerrar para repetir el camino. Tras la siguiente apertura, [Volver y cobrar](2026-10-08-pos-native-estacion/N6-return-before-charge/screen.png) conduce a [Pagado · MXN 65.00](2026-10-08-pos-native-estacion/N6-paid/screen.png).

La [consulta final](2026-10-08-pos-native-estacion/N6-backend-paid.json) registra dos ventas en efectivo, incluyendo la de N5: 6200 y 6500 centavos, ambas con cambio cero. La nueva línea conserva Latte, Chico y la nota Unicode. Las aperturas y cierres adicionales pertenecen a la repetición de pruebas; no son ventas duplicadas. Ningún efecto corresponde a una base o terminal financiera real.

### Crítica acumulativa

G17, G19, G20, G21, G22, G23 y G24 se corrigen en estos recorridos, con sus límites declarados. La selección vacía conserva un problema diferente: **G25**, el círculo usa `outlineVariant` y se ve demasiado tenue. El contorno de la tarjeta es visible, pero eso no justifica un indicador casi invisible.

**G26:** al ofrecer una nueva apertura, la pantalla conserva el arqueo anterior sin un título que lo identifique como histórico. La captura estrecha muestra MXN 162.00 encima del fondo nuevo. Aunque las cifras pertenecen a una operación real, su relación con el turno siguiente resulta ambigua y consume espacio inicial.

**G27:** el [registro de GTK](2026-10-08-pos-native-estacion/N6-gtk-observation.json) contiene 48 222 advertencias de conversión de `UTF8_STRING` al momento de la consulta. Hay ráfagas en distintos momentos. Se conserva el portapapeles del usuario. No se ha aislado la causa ni su coste en cuadros, y no se presume que sea una falla de los formularios. La nota de fluidez baja por esta incertidumbre operativa; no se traslada la muestra corta N5 a una afirmación general.

El historial todavía titula los registros Venta sin aprovechar todos los datos de reconocimiento del contrato. **G28** necesita distinguir varios pedidos por etiqueta, importe y contexto, además de explicar por qué no puede reemplazarse un pedido con contenido. La recuperación correcta no elimina esa dificultad de identificación.

El instrumento necesitó delimitar Cerrar turno al botón, porque también aparece como paso del checklist. Los campos fuera de la lista construida exigen desplazamiento iterativo. Una búsqueda de Nota para cocina falló: la etiqueta real es Nota del operador. Se registran estas limitaciones para no confundirlas con pérdida de contenido. Un segundo intento de recuperar caja agotó su espera; una captura posterior mostraba la pantalla de apertura. No se atribuye esa secuencia incompletamente observada a un fallo del backend. El recorrido final sí tiene acción, resultado y consulta de efectos.

| Criterio                   | Peso | Nota N6 | Evidencia y límite                                                                                  |
| -------------------------- | ---: | ------: | --------------------------------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% |     5.7 | Pedido recuperado y detalle simplificado. Historial ambiguo y arqueo anterior pendiente.            |
| Calidad visual e identidad |  20% |     4.3 | Nombre único y mejor separación. Fotografía del fixture e identidad integral pendientes.            |
| Cobertura y coherencia     |  15% |     4.2 | Motivos canónicos y selección corregidos. Otras superficies aún sin recorrido integral.             |
| Adaptación                 |  15% |     5.6 | Estado conservado entre teléfono y escritorio; caja ajusta instrucción. Escalas amplias pendientes. |
| Accesibilidad              |  15% |     5.4 | Estado elegido en el nodo activo, teclado real. Contraste del círculo, lector e IME pendientes.     |
| Respuesta y recuperación   |  10% |     5.6 | Recupera pedido vacío y distingue salida de cobro. Falta cubrir rechazos y recorridos restantes.    |
| Fluidez                    |   5% |     3.0 | Sin nueva medición; ráfagas GTK necesitan aislamiento.                                              |

Media ponderada: **4.99 → 5.0**. La [suite aislada](2026-10-08-pos-native-estacion/suite-N6-isolated.txt) aprueba **514 pruebas** y el [análisis](2026-10-08-pos-native-estacion/analysis-N6-isolated.txt) no encuentra problemas. Se preservan el [primer fallo de suite](2026-10-08-pos-native-estacion/suite-N6-initial-failure.txt), el [fallo posterior de título antiguo](2026-10-08-pos-native-estacion/suite-N6-title-failure.txt) y el [análisis inicial](2026-10-08-pos-native-estacion/analysis-N6-initial.txt). Las seis pruebas nuevas ejercitan conservación, protección del pedido, significado de la vuelta y representación del glifo; no certifican comprensión humana.

N7 debe corregir G25–G28 y ampliar la inspección del resto de las superficies. G01–G06, G08–G13 conservan sus brechas. N6 no cumple el objetivo de 10.0.

## N7 — Reconocimiento, contexto y revisión del instrumento

### Resultado y separación del trabajo concurrente

La nota acumulativa es **5.3/10** (media ponderada 5.295). El historial muestra producto o etiqueta e importe del servidor. El arqueo anterior queda identificado y plegado durante la apertura de un turno nuevo. Las opciones vacías conservan un círculo visible. La compilación procede de `dc90a6d` más los cambios propios N7, en la copia aislada. Por decisión expresa del usuario, configuración, composición y almacenamiento TPM conservan su trabajo independiente; no entran en la evaluación ni en este commit. La ausencia del define TPM conserva el adaptador anterior en el árbol de trabajo compartido.

### Investigación y decisiones

El [hilo de MelonLand del 4–5 de abril de 2024](https://forum.melonland.net/index.php?topic=2742.0) contiene una crítica a la presión por llenar sitios de novedades visuales. El autor declara que quiere priorizar su escritura y programación; otra respuesta enlaza The HTML Review. No es un estudio de operadores. **Inferencia aplicada:** los registros del POS necesitan contenido que permita reconocer una operación, antes de añadir decoración.

En el [proceso de Carecore](https://raphaelbastide.com/carecore/), Raphaël Bastide explica cómo una interfaz genérica para una idea sonora lo llevó a otro proyecto, y relaciona éste con obras de 2016, 2024 y 2025. Esa reflexión cuestiona gráficos intercambiables. **Inferencia aplicada:** conservar dibujos específicos del café y hacer que las cifras describan operaciones reales. No copiar sus flores ni convertir el POS en un juego. La reflexión artística no demuestra usabilidad de nuestras filas.

### Evidencia nativa y regresión

El historial en [1280 × 720](2026-10-08-pos-native-estacion/N7-history-wide/screen.png) distingue Latte de MXN 65.00 y Cappuccino suspendido de MXN 62.00. En [375 × 812](2026-10-08-pos-native-estacion/N7-history-phone/screen.png), el importe pasa a otra línea. La etiqueta del pedido, cuando existe, tiene prioridad. El total usa `cart.totals.grandTotal`; no se recalcula con los renglones. La prueba estrecha usa un total servidor deliberadamente distinto del precio de la línea para comprobar ese contrato. Conserva cliente, hora, estado y referencia seleccionable.

Un aviso explica que un pedido con contenido debe terminarse o suspenderse antes de reanudar otro. Las pruebas protegen ese pedido. También cubren la secuencia en que se cancela el borrador vacío, falla la recuperación y se vuelve a intentar: no cancela dos veces el mismo borrador. El selector expone selección en el nodo semántico que recibe la acción. El primer ensayo inspeccionaba un ancestro combinado; se conserva el fallo y se corrige la búsqueda hacia el texto del botón. Esto no certifica un lector externo.

La tarea de caja contó **100 + 50 + 10 + 5 = MXN 165.00**, con [diferencia cero](2026-10-08-pos-native-estacion/N7-count-165/screen.png), concilió y cerró el turno de N6. La nueva apertura muestra [Arqueo del turno anterior](2026-10-08-pos-native-estacion/N7-history-count-folded/screen.png) plegado. En [teléfono](2026-10-08-pos-native-estacion/N7-history-count-phone/screen.png) conserva total, acción y motivo del bloqueo. La prueba abre el resumen y verifica sus cifras sin desbordamiento. El resumen histórico no se anuncia como un nuevo cierre del turno actual. La [auditoría de efectos](2026-10-08-pos-native-estacion/N7-backend-paid.json) conserva las dos ventas previas y ningún cobro adicional.

Los círculos vacíos usan tinta secundaria en [escritorio](2026-10-08-pos-native-estacion/N7-choice-wide/screen.png) y [teléfono](2026-10-08-pos-native-estacion/N7-choice-phone/screen.png). Las capturas de mesas, cocina y sesión con prefijo `N7-baseline` pertenecen al binario N6 y muestran estados vacíos o controles de sesión. La captura inicial de pedidos entrantes era carga. La [captura posterior](2026-10-08-pos-native-estacion/N7-incoming-empty/screen.png) espera explícitamente el resultado vacío. No se confunden esos estados con tareas de atención completadas.

### Hallazgo sobre las pulsaciones y advertencias

La [documentación primaria de Future.timeout](https://api.dart.dev/dart-async/Future/timeout.html) establece que la operación original puede terminar después del timeout. La extensión del SDK instalado envuelve la ejecución con ese método; su manejador de tap espera un elemento pulsable antes de pulsarlo. Durante el primer proceso N7, una espera de Ventas venció ante el PIN y la acción apareció después del acceso. Esto afecta la interpretación causal de secuencias N6 con acciones vencidas: las consultas de efectos siguen documentando dinero y contenido, pero una espera vencida no demuestra que la pulsación haya sido cancelada.

El cliente ahora espera `waitForTappable` antes de enviar una mutación. Ante Bloquear operador ausente, falló esa observación; al cerrar Ventas y abrir después Cuenta, el [operador seguía activo](2026-10-08-pos-native-estacion/N7-preflight-no-late-tap/screen.png). Se reinició el proceso para eliminar pulsaciones anteriores pendientes. Existe una carrera entre comprobación y tap: si vence el tap mismo, el protocolo exige reiniciar antes de seguir. Escape físico, dirigido sólo al PID del fork con foco verificado, [cierra el menú](2026-10-08-pos-native-estacion/N7-escape-result/screen.png). No es una prueba de navegación completa con teclado.

El nuevo proceso registra **cero** advertencias de conversión UTF8_STRING en el corte observado. Cambiaron proceso y contexto del portapapeles. No se aplicó una corrección GTK ni se aisló la causa de G27. No hay una nueva medición de cuadros o arranque frío.

### Crítica y nota acumulativa

G25 y G26 quedan corregidas en las condiciones observadas. G28 mejora reconocimiento y explicación, pero su revisión encuentra dos problemas: los importes amplios no llegan al borde derecho y las cancelaciones automáticas de pedidos vacíos consumen demasiado espacio. No deben esconderse los datos reales para mejorar una captura. **G29:** Ajustes sólo abre bloqueo y cierre de sesión; debe mostrar un destino que corresponda a su nombre. **G30:** la evaluación necesitaba evitar pulsaciones tardías; el protocolo se corrige con el límite de carrera declarado. Los estados vacíos de otras superficies aún necesitan tareas con datos. G27 permanece abierta.

| Criterio                   | Peso |  N7 | Evidencia y límite                                                                                |
| -------------------------- | ---: | --: | ------------------------------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 6.1 | Reconoce producto e importe; separa arqueo histórico. Densidad del historial pendiente.           |
| Calidad visual e identidad |  20% | 4.5 | Indicadores visibles y menos ambigüedad. Identidad integral y fotografías del fixture pendientes. |
| Cobertura y coherencia     |  15% | 4.5 | Historial y caja; otros destinos inspeccionados sólo vacíos. Ajustes incompleto.                  |
| Adaptación                 |  15% | 5.9 | Filas y arqueo en dos anchuras; escalas amplias y plataformas móviles pendientes.                 |
| Accesibilidad              |  15% | 5.8 | Indicador legible y selección accionable. Lector externo e IME complejo pendientes.               |
| Respuesta y recuperación   |  10% | 5.8 | Reintento de recuperación protegido; falta ampliar rechazos reales.                               |
| Fluidez                    |   5% | 3.3 | Proceso sin ráfaga observada; causa GTK y mediciones completas pendientes.                        |

La [suite aislada](2026-10-08-pos-native-estacion/suite-N7-isolated.txt) aprueba **517 pruebas** y el [análisis](2026-10-08-pos-native-estacion/analysis-N7-isolated.txt) no encuentra problemas. El [manifiesto](2026-10-08-pos-native-estacion/N7-manifest.json) distingue el binario actual de las capturas previas y conserva hashes. N8 debe mejorar la identidad de la interfaz entera, revisar los destinos incompletos y ampliar adaptación y tareas nativas. N7 no satisface 10.0.

## N8 · Ajustes reales y crítica externa · 5.7/10

Fecha: 8 de octubre de 2026. Base: N7, commit `c1ae62c`. Los pesos conservan los criterios anteriores. La nota aumenta de 5.3 a **5.7**. El resultado ponderado es **5.695**. Los nuevos fallos de mesas limitan la mejora.

### Cambios y propósito

Ajustes ofrece apariencia del sistema, clara u oscura; idioma del sistema, español o inglés; y movimiento reducido. Guarda la elección en la terminal. La escritura precede al cambio visible. Un fallo conserva la elección anterior y permite reintentar. La preferencia del sistema para reducir movimiento también se respeta. Los ajustes conservan el operador y el pedido.

La selección regional reconoce `es_MX` y `en_US`. El historial alinea los importes y reduce la altura de los borradores cancelados. Conserva la referencia completa detrás de una acción explícita. Los pedidos entrantes distinguen carga, error y resultado vacío. El error conserva el pedido actual y ofrece un reintento.

El fondo claro pasa de `#F5F6F8` a `#F1F3F4`. El acento pasa de `#245BD6` a `#214EA7`. Los radios de controles y superficies usan 8 y 10 píxeles. Las superficies ahora aplican la elevación solicitada. Esta revisión busca una estación sobria y precisa. No demuestra por sí sola una identidad integral.

### Rama artística y fechas

El [proceso de Carecore](https://raphaelbastide.com/carecore/) conecta una crítica del diseño genérico con obras de 2016, 2024 y 2025. Seguí su enlace real a [Drice Ducongé dos Santos](https://dddoss.eu/). Su registro documenta un menú con HTML y CSS en junio de 2025, y un instrumento meteorológico en julio. Esto es evidencia del autor, no una medida de eficacia del POS.

La [lista de proyectos](https://dddoss.eu/projects) reúne publicaciones hechas con tecnologías web desde 2020, archivos, tipografías e instrumentos. Waterfall, de 2024, declara efectos intensos de desenfoque y animación. [me’te.o.ra](https://sites.dddoss.eu/meteora/) relaciona lugares y sonido. Su página anuncia código futuro; no comprobé una publicación de ese código.

**Inferencia aplicada:** usar ritmo tipográfico, documentos legibles y contenido específico de la operación. Las cifras deben describir el trabajo real. Los efectos intensos y el sonido no mejoran necesariamente una caja. No se trasladan esas decisiones artísticas al POS por semejanza visual.

Carecore fecha _Being a script_ en 2025. La [edición inglesa consultada](https://raphaelbastide.com/etre-script/en.html) declara 2026, segunda edición y traducción de Daniel Kennedy. Conservo ambas fechas y sus contextos. No atribuyo 2026 a la primera edición. La publicación declara tecnologías web, software libre y 100 ejemplares impresos en Montreuil.

El [criterio W3C 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html), actualizado en septiembre de 2025, orienta el control de movimiento. Es una referencia web de nivel AAA. No constituye certificación de esta aplicación nativa.

Las rutas supuestas de Drice y _Being a script_ fallaron. Los enlaces de Carecore llevaron a las páginas reales. La ruta de proyectos con barra final volvió a fallar en esta consulta. Se conserva el enlace publicado sin esa barra.

### Evidencia nativa

Las capturas muestran [Ajustes claros](2026-10-08-pos-native-estacion/N8-settings-wide/screen.png), [oscuros](2026-10-08-pos-native-estacion/N8-settings-dark/screen.png), [inglés](2026-10-08-pos-native-estacion/N8-settings-english/screen.png) y [persistencia después del reinicio](2026-10-08-pos-native-estacion/N8-settings-restored/screen.png). La aplicación nativa conserva apariencia e idioma. En [375 × 812](2026-10-08-pos-native-estacion/N8-settings-phone-spanish/screen.png), los controles caben en una página desplazable. La prueba añade escala de texto 2.0 en ambos temas.

Los pedidos entrantes muestran el resultado vacío en [teléfono](2026-10-08-pos-native-estacion/N8-incoming-phone/screen.png) y [escritorio](2026-10-08-pos-native-estacion/N8-incoming-wide/screen.png). Las pruebas examinan error, reintento y carga pendiente. El [historial](2026-10-08-pos-native-estacion/N8-history-wide/screen.png) muestra los importes al borde derecho y las referencias como una acción.

Un cliente externo AT-SPI inspecciona únicamente el PID del fork en un bus privado. La primera conexión intentó una activación de registro que no funcionó. El bus explícito permitió [abrir Ajustes](2026-10-08-pos-native-estacion/N8-atspi-open-settings.json) y [activar Clara](2026-10-08-pos-native-estacion/N8-atspi-activate-light.json). La [lectura posterior](2026-10-08-pos-native-estacion/N8-atspi-light-result.json) registra la selección. No se probó un lector hablado. Un ensayo de nombres localizados devolvió nombres vacíos; el cliente final conserva los nombres de acción disponibles.

### Mesas con datos y alcance de la preparación

El fixture desechable contiene dos áreas y seis mesas. La consulta inicial del plano devolvió `PERMISSION_DENIED`. El operador tenía permisos de propietario. Faltaba la habilitación del dashboard del fixture. La herramienta añadió una habilitación temporal de un día sólo a esa base. El [registro](2026-10-08-pos-native-estacion/N8-fixture-dashboard.json) distingue esa preparación del producto.

La herramienta publicó el [plano sintético](2026-10-08-pos-native-estacion/N8-floor-fixture.json) mediante los contratos y la API. La aplicación sentó dos personas en Mesa 1. La [captura después de confirmar](2026-10-08-pos-native-estacion/N8-table-after-confirm/screen.png) muestra la ocupación. La espera de texto `2 personas` venció porque el panel amplio muestra `Personas` y `2` por separado. Esa espera no demuestra un fallo de la operación.

La [auditoría de sólo lectura](2026-10-08-pos-native-estacion/N8-backend-paid.json) confirma la mesa ocupada, las dos personas y el origen del temporizador. Conserva las dos ventas anteriores de MXN 62.00 y MXN 65.00. No hubo un nuevo cobro en N8.

El plano aparece en [teléfono](2026-10-08-pos-native-estacion/N8-tables-phone/screen.png). Al pulsar la mesa, el [detalle](2026-10-08-pos-native-estacion/N8-table-detail-phone/screen.png) conserva personas, estado, tiempo y acciones. La ventana Linux simula el espacio disponible. No es una prueba de un dispositivo Android o iOS.

### Brechas nuevas y límites acumulados

**G31:** varios botones con icono llegan a AT-SPI sin nombre. La selección de navegación pertenece a un nodo separado de su acción. El tooltip no basta como nombre accesible. Debe corregirse la semántica del control accionable.

**G32:** el nombre de la mesa ocupada se cruza con el icono de estado. En móvil el nombre es demasiado pequeño. El panel amplio duplica el prefijo: `Mesa Mesa 1`. Debe reorganizarse la información dentro de la geometría disponible.

**G33:** al reducir la ventana, desaparece el panel de la mesa seleccionada. La aplicación conserva el mapa, pero exige otra pulsación para recuperar el detalle. La selección debe conservar una representación visible al cambiar de tamaño.

G29 queda corregida en las condiciones observadas. G28 mejora alineación y densidad. G05 mejora con una acción externa, pero falta lector hablado e IME complejo. G08 conserva propiedades visuales sin aplicar. G01, G02, G03, G06, G09 y G10 requieren más cobertura. Las fotografías incorrectas del fixture siguen pendientes.

El proceso observado registra cero advertencias `UTF8_STRING`. La causa de G27 sigue sin aislarse. No se midieron nuevos cuadros ni arranque frío. Los archivos `render-tree.json` están vacíos en este SDK de perfil. Las imágenes y AT-SPI sustentan las observaciones declaradas.

### Verificación y nota

La primera prueba dirigida tuvo dos fallos de pulsación fuera de la vista. Las pruebas ahora esperan el último cuadro tras desplazar. La primera suite tuvo un fallo por asumir español. La elección regional exige configurar `localesTestValue`, y la traducción inglesa real es `Enroll this device`.

La [suite aislada](2026-10-08-pos-native-estacion/suite-N8-isolated.txt) aprueba **527 pruebas**. El [análisis final](2026-10-08-pos-native-estacion/analysis-N8-isolated.txt) no encuentra problemas. El [manifiesto](2026-10-08-pos-native-estacion/N8-manifest.json) conserva fuentes, hashes y límites. Flutter 3.47.5, Dart 3.13.4, Hyprland 0.56.2 y AT-SPI 2.60.7 forman el entorno observado.

El trabajo TPM, configuración y composición queda fuera de la evaluación, la compilación aislada y el commit de diseño. Esta separación sigue la decisión explícita del usuario. Las siete pruebas nuevas de TPM no forman parte de las 527.

| Criterio                   | Peso |  N8 | Evidencia y límite                                                          |
| -------------------------- | ---: | --: | --------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 6.3 | Ajustes y estados claros. Mesa ocupada tiene texto superpuesto.             |
| Calidad visual e identidad |  20% | 5.1 | Tinta, radios y densidad coherentes. Identidad integral pendiente.          |
| Cobertura y coherencia     |  15% | 5.7 | Ajustes persistidos y mesas con datos. Cocina y otros flujos pendientes.    |
| Adaptación                 |  15% | 6.0 | Ajustes a escala 2.0; detalle pierde presencia al reducir ancho.            |
| Accesibilidad              |  15% | 5.7 | Acciones AT-SPI reales. Botones sin nombre y lector hablado pendientes.     |
| Respuesta y recuperación   |  10% | 6.3 | Persistencia y reintento conservan estado. Faltan rechazos nativos amplios. |
| Fluidez                    |   5% | 3.5 | Sin ráfaga GTK observada. Sin nueva medición completa.                      |

N9 debe corregir G31, G32 y G33. La nota 5.7 refleja el producto observado. N8 todavía no cumple el criterio de 10.0.

## N9 · Nombres accionables y mesas adaptables · 6.1/10

Fecha: 8 de octubre de 2026. Base: N8, commit `882aa04`. La nota acumulativa pasa de 5.7 a **6.1**. El resultado ponderado es **6.12**. Los pesos conservan la rúbrica inicial.

### Cambios y evidencia

Los botones con icono usan su tooltip como nombre del control accionable. La navegación, las áreas y las filas llevan la selección en ese mismo control. La geometría del plano expone nombre, capacidad, estado, personas y tiempo. Los elementos de decoración dejan de parecer botones deshabilitados.

El cliente externo encuentra [cero botones habilitados sin nombre en el catálogo](2026-10-08-pos-native-estacion/N9-atspi-catalog-ready.json). En [mesas](2026-10-08-pos-native-estacion/N9-atspi-table-selected.json), Volver, Actualizar, Ver lista y Acercar tienen nombre. Salón y Mesa 1 exponen selección junto con Tap y Focus. Esto corrige G31 en las superficies observadas. No certifica todos los destinos ni un lector hablado.

El icono de estado pasa al espacio inferior de la mesa. El nombre y el tiempo conservan el espacio superior. La [vista amplia](2026-10-08-pos-native-estacion/N9-table-selected-wide/screen.png) muestra el nombre sin superposición. El panel usa el nombre publicado una sola vez: `Mesa 1`. La prueba examina las posiciones de nombre, tiempo e icono en dos tamaños.

La anchura estrecha abre una lista de mesas. La elección explícita del operador permite volver al plano. Las filas muestran estado, personas, capacidad y tiempo. Al pasar de escritorio a [375 × 812](2026-10-08-pos-native-estacion/N9-table-resized-phone/screen.png), la mesa seleccionada conserva un resumen y una acción de detalle. El [plano móvil](2026-10-08-pos-native-estacion/N9-table-map-phone/screen.png) también conserva ese resumen. G32 y G33 mejoran en estas condiciones. El plano completo sigue siendo pequeño en móvil; la lista es la vista inicial para leer y actuar.

### Fuentes y decisión

La [documentación de Semantics](https://api.flutter.dev/flutter/widgets/Semantics-class.html) distingue los nodos nuevos de la información combinada. La [documentación del foco](https://api.flutter.dev/flutter/widgets/FocusableActionDetector/includeFocusSemantics.html) explica la semántica que añade Focus. **Inferencia aplicada:** el nombre y la selección deben describir la acción real, sin crear otro botón exterior sin acción.

El [criterio de redistribución de W3C](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) permite adaptar o trasladar contenido si conserva información y función. También distingue la geometría que necesita dos dimensiones. **Inferencia aplicada:** conservar el plano y ofrecer una lista legible. El resumen evita perder el contexto al cambiar de ancho. Esta referencia web no certifica el cliente nativo.

La rama de Drice llevó a [Sarah Garcin](https://sarahgarcin.com/). La autora documenta [PJ Machine, 2016–2019](https://sarahgarcin.com/projets/pj-machine), una interfaz de publicación con botones físicos. El [registro del taller](https://hackersanddesigners.nl/publishing-machines-workshop) distingue la actividad del 4 de agosto de 2017 de la actualización documental de 2024. Su [código](https://github.com/sarahgarcin/pj-machine) describe controles de teclado y una licencia GPL v3. No instalé su programa ni incorporé su código.

La autora documenta [Baking.js v2 en 2022](https://sarahgarcin.com/projets/baking-js-v2). El enlace lleva a un repositorio cuyo nombre contiene 2019. Ese nombre no cambia la fecha declarada de la versión. Su [memoria de 2013](https://sarahgarcin.com/projets/experimentation-graphique-vs-diffusion-et-lisibilite-memoire) examina experimentación y legibilidad en publicaciones. El PDF confirma mayo de 2013. Es una fuente primaria sobre su investigación y una fuente secundaria sobre aquellas revistas.

**Inferencia artística:** una herramienta puede tener una forma propia y controles previsibles. La expresividad debe ayudar a reconocer el trabajo. No se copia la estética de arcade ni se atribuye eficacia comercial a un taller artístico.

### Acción externa, teclado y traslado

AT-SPI [abrió el detalle](2026-10-08-pos-native-estacion/N9-atspi-resized-phone.json). La documentación de [do_action](https://docs.gtk.org/atspi2/method.Action.do_action.html) sustenta el mecanismo del cliente. La aceptación de la llamada se comprueba después en la interfaz.

El cliente solicitó Focus sobre Detalle. La [lectura posterior](2026-10-08-pos-native-estacion/N9-atspi-detail-focused.json) confirmó `focused`. La herramienta comprobó PID, ejecutable y foco del compositor antes de enviar [Espacio por XTEST](2026-10-08-pos-native-estacion/N9-keyboard-open-detail.json). El [detalle abierto](2026-10-08-pos-native-estacion/N9-table-keyboard-detail/screen.png) muestra dos personas, estado, tiempo y acciones. Es una tarea corta con teclado físico. No demuestra navegación completa ni entrada con IME.

La aplicación trasladó las dos personas de Mesa 1 a Mesa 2. La [captura](2026-10-08-pos-native-estacion/N9-table-moved-phone/screen.png) muestra Mesa 2 ocupada y Mesa 1 por limpiar. La [auditoría de sólo lectura](2026-10-08-pos-native-estacion/N9-backend-paid.json) confirma las dos personas y el mismo `seated_at`, `2026-10-08T22:16:32.138Z`. Conserva los dos cobros anteriores y ningún nuevo cobro.

El primer predicado de auditoría esperaba un origen libre. La prueba canónica de la API especifica un origen `dirty`. La consulta confirmó ese estado. Se corrigió el predicado; no se cambió el backend ni la operación para satisfacerlo.

### Fallos de evaluación y brechas nuevas

El primer cliente de acceso buscó el archivo de registro privado dentro del worktree limpio. No lo encontró y terminó antes de pulsar. El reintento usó el directorio propietario y condujo el mismo binario limpio. El registro TPM permanece separado de toda esta evaluación.

Una captura empezó antes de completar una acción posterior de cierre. La imagen muestra la vista cerrada y se conserva como [después de cerrar el detalle](2026-10-08-pos-native-estacion/N9-table-after-detail-close/screen.png). La captura de teclado espera primero el texto del detalle y no intercala una mutación.

**G34:** tras el traslado, la selección conserva Mesa 1, ahora por limpiar. Falta una confirmación explícita del destino. La siguiente versión debe hacer visible el resultado y dirigir el contexto a la mesa destino.

**G35:** el repositorio falso de la prueba devuelve un origen libre. La API canónica devuelve un origen por limpiar. Debe corregirse la fidelidad del fixture y comprobar el estado real del origen.

**G36:** el árbol accesible de acceso repite el título del PIN dentro de un panel combinado. Debe revisarse esa redundancia. Un título visible correcto no demuestra una lectura accesible correcta.

G01, G02, G03, G06, G08, G09 y G10 conservan pendientes. Falta ampliar tareas en cocina, clientes, inventario, hardware y recuperación. Las fotografías incorrectas del catálogo de muestra permanecen visibles y pendientes.

### Verificación y puntuación

La [suite aislada](2026-10-08-pos-native-estacion/suite-N9-isolated.txt) aprueba **533 pruebas**. El [análisis](2026-10-08-pos-native-estacion/analysis-N9-isolated.txt) no encuentra problemas. Las nuevas pruebas cubren nombre y teclado, selección accionable, geometría de ocupación, cambio de ancho y texto aumentado. Los primeros ensayos conservan errores de sintaxis y manejo de SemanticsHandle. Los handles ahora se cierran antes de la verificación final, incluso ante un fallo.

El [cronómetro de acceso](2026-10-08-pos-native-estacion/N9-entry-timed/timing.json) registra **2165 ms** hasta producto visible, con API 4013 y modo perfil. Incluye llamadas del cliente y una captura intermedia. La [captura](2026-10-08-pos-native-estacion/N9-entry-timed/intermediate.png) ya muestra productos. Es una observación de tarea; no mide exclusivamente latencia del producto, arranque frío ni cuadros.

El corte del proceso registra cero advertencias `UTF8_STRING`, pero registra advertencias repetidas de elementos del keyring privado. El [manifiesto](2026-10-08-pos-native-estacion/N9-manifest.json) conserva el recuento y los hashes. La causa de G27 permanece abierta. Las herramientas usan Flutter 3.47.5, Dart 3.13.4, Hyprland 0.56.2, AT-SPI 2.60.7, Python 3.14 y xdotool 4.20260303.1.

| Criterio                   | Peso |  N9 | Evidencia y límite                                                          |
| -------------------------- | ---: | --: | --------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 6.7 | Lista y resumen conservan contexto. Falta confirmación de traslado.         |
| Calidad visual e identidad |  20% | 5.4 | Estado sin superposición y selección clara. Identidad integral pendiente.   |
| Cobertura y coherencia     |  15% | 6.0 | Ocupación y traslado nativos. Otros destinos requieren tareas con datos.    |
| Adaptación                 |  15% | 6.5 | Cambio de ancho y escala 2.0. Dispositivos móviles físicos pendientes.      |
| Accesibilidad              |  15% | 6.5 | Nombre, selección y acción externos; Espacio real. Lector e IME pendientes. |
| Respuesta y recuperación   |  10% | 6.4 | Traslado conserva personas y tiempo. Confirmación visual pendiente.         |
| Fluidez                    |   5% | 4.2 | Acceso observado en perfil. Cuadros y arranque frío pendientes.             |

N10 debe corregir el contexto del traslado, los fixtures y la redundancia accesible. También debe ampliar la revisión de propiedades visuales y de las superficies restantes. N9 no cumple el criterio de 10.0.

## N10 · Resultado del traslado y estados reales · 6.3/10

Base: N9, commit `c7f705a`. La media ponderada es **6.345 → 6.3**. Esta ronda mejora la operación; la identidad visual permanece en 5.4. El usuario observa que la composición sigue demasiado próxima al diseño anterior y autoriza romperla por completo. Esa crítica abre una nueva dirección visual para N11.

### Observación y cambios

El traslado selecciona la mesa destino y confirma el resultado en una región accesible. La [captura amplia](2026-10-08-pos-native-estacion/N10-table-moved-wide/screen.png) y el [teléfono de 375 × 812](2026-10-08-pos-native-estacion/N10-table-moved-phone/screen.png) conservan Mesa 3 seleccionada, las dos personas y el tiempo. La [lectura externa](2026-10-08-pos-native-estacion/N10-atspi-moved-wide.json) encuentra la selección en Mesa 3 y el texto de confirmación. La [auditoría](2026-10-08-pos-native-estacion/N10-backend-paid.json) confirma el mismo instante original de ocupación y Mesa 2 por limpiar. No hay un nuevo cobro. G34 y G35 cierran en este recorrido.

El título del PIN ocupa un nodo de encabezado propio. La cantidad de dígitos ocupa otro nodo y no publica las cifras. La [lectura externa](2026-10-08-pos-native-estacion/N10-atspi-pin.json) encuentra el encabezado separado. La prueba comprueba la cantidad 0 y 2. G36 cierra para la duplicación; la voz y la lectura externa del valor siguen sin verificación.

El botón resuelve su estilo contra los estados reales de puntero, pulsación, foco, selección y deshabilitación. Los colores de selección ceden ante los de deshabilitación. No se añade Material. La [documentación de WidgetStatesController](https://api.flutter.dev/flutter/widgets/WidgetStatesController-class.html) distingue el conjunto visual de la condición intrínseca: el control debe mantenerlos sincronizados. La [documentación del resaltado hover](https://api.flutter.dev/flutter/widgets/FocusableActionDetector/onShowHoverHighlight.html) describe visibilidad del resaltado. La inspección del código del SDK mostró su dependencia del modo de entrada. La región de ratón ahora registra el puntero directamente.

### Fallos conservados

La primera prueba encontró el hover en reposo. Después de corregirlo, la comprobación de foco necesitó esperar el cuadro posterior al cambio de FocusManager. La primera prueba del PIN encontró que los textos todavía se combinaban. Se añadieron nodos propios mediante `container`. Los [ensayos](2026-10-08-pos-native-estacion/N10-targeted-first-failure.txt), [segunda ejecución](2026-10-08-pos-native-estacion/N10-targeted-second-failure.txt) y [fallo del PIN](2026-10-08-pos-native-estacion/N10-pin-first-failure.txt) permanecen disponibles. La [ejecución dirigida final](2026-10-08-pos-native-estacion/N10-targeted-final.txt) pasa 36 pruebas.

Un comando de revisión se escribió como `wait-text`; el cliente sólo reconoce `wait`. El comando desconocido no hizo nada. No se usa como evidencia de una espera. Las capturas, el árbol externo y la auditoría confirman el resultado. El cliente ahora rechaza los comandos desconocidos.

### Verificación, crítica y nota

La [suite aislada](2026-10-08-pos-native-estacion/suite-N10-isolated.txt) aprueba **536 pruebas**. El [análisis](2026-10-08-pos-native-estacion/analysis-N10-isolated.txt) no reporta problemas. El [manifiesto](2026-10-08-pos-native-estacion/N10-manifest.json) fija código limpio, binario y evidencia. El trabajo TPM del usuario sigue separado. La apertura nativa usa sola el workspace 3.

El aviso de traslado consume demasiada altura en teléfono. La cabecera, las pestañas, los botones delineados y el pedido siguen repitiendo la composición anterior. Cambiar colores y pulir controles no satisface por sí solo la petición de una dirección original. N11 debe rediseñar la estructura, la relación entre catálogo y pedido, el sistema de navegación y la expresión visual de los estados.

| Criterio                   | Peso | N10 | Evidencia y límite                                                         |
| -------------------------- | ---: | --: | -------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 7.1 | Destino y resultado visibles. Jerarquía integral pendiente.                |
| Calidad visual e identidad |  20% | 5.4 | Continúa demasiado próxima al diseño previo. Rediseño completo autorizado. |
| Cobertura y coherencia     |  15% | 6.3 | Traslado real y PIN revisado. Destinos restantes pendientes.               |
| Adaptación                 |  15% | 6.6 | Contexto en teléfono; aviso demasiado alto.                                |
| Accesibilidad              |  15% | 6.8 | Encabezado separado y estados reales. Voz e IME pendientes.                |
| Respuesta y recuperación   |  10% | 6.8 | Resultado explícito y conservación auditada.                               |
| Fluidez                    |   5% | 4.2 | No hay nueva medición de cuadros.                                          |

La próxima revisión abandona la composición heredada. Conserva los contratos de operación, la evidencia acumulada y la preferencia de abrir siempre en un workspace vacío. No conserva decisiones visuales por obligación.

## N11 · Carta y comanda con el color UMI · 6.8/10

Base: N10, commit `a0c8f2d`. La media de la rúbrica fija es **6.845 → 6.8**. La estimación comunicada antes de calcularla fue 6.9. El resultado del cálculo gobierna esta versión.

### Dirección y marca

La autorización del usuario permite reconstruir cualquier decisión visual anterior. Su instrucción posterior exige el color UMI. La [fuente compartida](../../packages/tokens/tokens/core.json) declara azul marino `#223979` y azul `#7692CB`. El [registro de marca](2026-10-08-pos-native-estacion/N11-brand-source.json) conserva la huella y la decisión. El azul local anterior del POS contradice esa fuente. Esta versión toma la fuente compartida como autoridad.

La primera propuesta de N11 usó verde. Sus [capturas iniciales](2026-10-08-pos-native-estacion/N11-initial-catalog-wide/screen.png) y [fuentes](2026-10-08-pos-native-estacion/N11-initial-source.json) permanecen como dirección descartada. No representan el resultado final. El [ensayo posterior](2026-10-08-pos-native-estacion/N11-r2-catalog-1280/screen.png) ya usa UMI, pero conserva un título y una fila frecuente demasiado altos.

El catálogo ocupa la izquierda. La comanda ocupa la derecha. Las categorías forman un índice con una línea de selección. La navegación usa tinta azul oscura. La comanda tiene una regla superior y divisiones discontinuas. La acción de cobro usa azul UMI. El [catálogo final](2026-10-08-pos-native-estacion/N11-r4-catalog-1280/screen.png) y la [comanda con un producto](2026-10-08-pos-native-estacion/N11-comanda-wide/screen.png) prueban esa distribución.

El acceso grande separa una cubierta tipográfica y el formulario. El [PIN amplio](2026-10-08-pos-native-estacion/N11-pin-wide/screen.png) muestra esa composición. El [PIN de teléfono](2026-10-08-pos-native-estacion/N11-pin-phone/screen.png) conserva sólo el formulario completo. La cubierta no añade botones ni nodos accesibles decorativos.

### Evidencia nativa y límites

El [teléfono](2026-10-08-pos-native-estacion/N11-comanda-phone/screen.png), a 375 × 812, mantiene una acción fija con el total. La [comanda abierta](2026-10-08-pos-native-estacion/N11-order-sheet-phone/screen.png) conserva las acciones inferiores. AT-SPI [abre ese panel](2026-10-08-pos-native-estacion/N11-atspi-open-order.json). La llamada aceptada se comprueba después en la captura. [Escape](2026-10-08-pos-native-estacion/N11-keyboard-close-order.json) devuelve el catálogo, según la [captura posterior](2026-10-08-pos-native-estacion/N11-after-sheet-escape-phone/screen.png). Falta un cierre visible dentro del panel.

El [detalle de Latte](2026-10-08-pos-native-estacion/N11-latte-detail-phone/screen.png) muestra la elección requerida y conserva la acción inferior. El [tema oscuro](2026-10-08-pos-native-estacion/N11-catalog-dark/screen.png) y la [tablet](2026-10-08-pos-native-estacion/N11-tablet-dark/screen.png) conservan marca, contexto y total. Son ventanas Linux. No prueban teléfonos físicos.

La revisión incluye [Mesas](2026-10-08-pos-native-estacion/N11-tables-tablet/screen.png), [Caja](2026-10-08-pos-native-estacion/N11-cash-tablet/screen.png) y [Ajustes](2026-10-08-pos-native-estacion/N11-settings-light/screen.png). Esas superficies todavía conservan parte de la estructura anterior. El catálogo inicial del nuevo identificador tenía una caché frecuente vacía. El ensayo anterior tenía productos frecuentes. Esa diferencia impide atribuir toda la densidad a la nueva distribución. La captura con Croissant demuestra la fila frecuente compacta.

La [auditoría](2026-10-08-pos-native-estacion/N11-backend-paid.json) confirma los dos cobros anteriores, sin nuevo cobro, y las dos personas de Mesa 3. Conserva el instante original. El bloqueo suspende la comanda con Croissant. El desbloqueo abre otra comanda vacía. Se prueba conservación en el backend; no se afirma restauración automática.

La [medición de categorías](2026-10-08-pos-native-estacion/N11-catalog-timeline/catalog.timeline_summary.json) registra 12 pulsaciones y 33 cuadros en perfil, a 1280 × 720. El máximo de construcción es **7.428 ms**. El máximo de rasterización es **3.346 ms**. El instrumento registra cero cuadros fuera de su presupuesto de construcción y rasterización. No mide arranque frío, tiempo de respuesta completo, GPU ni hardware móvil.

### Fuentes, fallos y procedencia

El recorrido Carecore → Drice → Garcin continúa en la [memoria de Garcin de 2013](https://sarahgarcin.com/projets/experimentation-graphique-vs-diffusion-et-lisibilite-memoire). Tres capturas web del PDF fallaron. `curl` recuperó el documento; Poppler permitió observar la página 37. Su columna de lectura, referencias marginales y ejemplos distinguen funciones sin volver ilegible el texto. La autora examina la tensión entre admirar una publicación y leerla. Es una fuente primaria sobre su investigación y secundaria sobre las revistas citadas. **Inferencia aplicada:** reservar la expresión para la composición y conservar claridad en importes, nombres y acciones. No prueba eficacia de un POS. El [recibo](2026-10-08-pos-native-estacion/N11-garcin-primary-receipt.json) fija URL, tamaño y SHA-256.

La [primera suite](2026-10-08-pos-native-estacion/N11-suite-first-failure.txt) falló por desbordes de cabecera. El tipo de servicio ahora ocupa el espacio de la comanda en escritorio y una fila propia en ancho compacto. Los ensayos de análisis y carga también conservan sus errores. La [suite final](2026-10-08-pos-native-estacion/suite-N11-isolated.txt) aprueba **538 pruebas**. El [análisis final](2026-10-08-pos-native-estacion/analysis-N11-isolated.txt) no encuentra problemas. Las nuevas pruebas contrastan los colores contra la fuente compartida y calculan los pares sólidos de texto en ambos temas.

Una consulta de acción omitió el salto de línea del nombre accesible. Otra intentó pulsar un producto todavía fuera del área visible. La salida de Caja usa Cerrar, no Volver. Esas comprobaciones de presencia agotaron su espera antes de enviar una pulsación. No cuentan como acciones exitosas. La lectura del nombre real permitió continuar. Se conserva el límite del instrumento.

La vista local tiene un identificador GTK propio sólo cuando el lanzador activa `UMIPOS_ESTACION_PREVIEW=1`. Los builds normales conservan su identidad. La regla y el evento `window.open` comprueban un workspace vacío antes de mover la ventana. Fuentes: [reglas](https://wiki.hypr.land/configuring/core/rules/window-rules/), [evento](https://wiki.hypr.land/configuring/core/advanced-configuration/events/). El [manifiesto](2026-10-08-pos-native-estacion/N11-manifest.json) confirma la ventana sola en el workspace 3, las fuentes limpias y el binario. El trabajo TPM queda fuera.

### Crítica y nota acumulativa

| Criterio                   | Peso | N11 | Evidencia y límite                                                              |
| -------------------------- | ---: | --: | ------------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 7.3 | Carta y comanda diferenciadas; total fijo. Cierre móvil pendiente.              |
| Calidad visual e identidad |  20% | 7.0 | Composición nueva y marca UMI. Superficies secundarias aún genéricas.           |
| Cobertura y coherencia     |  15% | 6.6 | Acceso, detalle, temas y estados revisados. Terminología y destinos pendientes. |
| Adaptación                 |  15% | 6.8 | Tres tamaños y pruebas de desborde. Hardware móvil pendiente.                   |
| Accesibilidad              |  15% | 6.9 | Acciones externas y pares sólidos. Voz, IME y nombres de caja pendientes.       |
| Respuesta y recuperación   |  10% | 6.8 | Conservación auditada. Progreso indeterminado pendiente.                        |
| Fluidez                    |   5% | 5.2 | Medición de cuadros en una tarea. Arranque y demás tareas pendientes.           |

La nueva dirección mejora identidad, pero no cierra G01, G03, G05, G08, G09, G10 ni G13. Las fotografías incorrectas del fixture permanecen. La fila frecuente y las tarjetas compiten por altura en teléfono. Ajustes repite grandes tarjetas delineadas. La belleza de una sola vista no basta para el producto.

**G37:** la interfaz mezcla Comanda y carrito. Unificar el texto visible sin cambiar contratos internos.

**G38:** el panel móvil carece de cierre visible. Añadirlo y comprobar regreso con teclado y tacto.

**G39:** extender la dirección a Ajustes, Caja y demás destinos. Revisar también estados vacíos, permisos y fallos.

**G40:** la cabecera del catálogo mostró Volver después de cambiar el tema sobre Ajustes. Tras cambiar el tamaño desapareció. Investigar su dependencia de la ruta y añadir una prueba.

**G41:** las acciones de cantidad de Caja repiten nombres sin identificar la denominación. Comprobar contexto accesible y corregirlo.

N12 debe resolver esas brechas y el progreso indeterminado. Mantiene la marca UMI, la rúbrica y toda la evidencia anterior. N11 no cumple 10.0.

## N12 · Secciones, estados y cierre móvil · 7.2/10

Base: N11, commit `95e82c7`. La media ponderada es **7.17 → 7.2**. La evaluación conserva las brechas anteriores. El [manifiesto](2026-10-08-pos-native-estacion/N12-manifest.json) fija fuentes, binario, medidas y artefactos. El cliente limpio excluye el trabajo TPM del usuario.

### Cambios y observación

Ajustes sustituye las grandes tarjetas por secciones con reglas y títulos alineados. La [captura de 1280 × 720](2026-10-08-pos-native-estacion/N12-settings-wide/screen.png) muestra las cuatro secciones. Caja utiliza la misma estructura, con el título sobre el conteo. La primera revisión nativa colocó el título al lado. Eso dejó una columna y exigió desplazamiento. Conservo [ese resultado](2026-10-08-pos-native-estacion/N12-cash-empty-wide/screen.png). La [segunda revisión](2026-10-08-pos-native-estacion/N12-r2-cash-empty-wide/screen.png) muestra las once denominaciones completas.

Cada acción de cantidad identifica su denominación. La [lectura externa](2026-10-08-pos-native-estacion/N12-atspi-count-70.json) y el [conteo nativo](2026-10-08-pos-native-estacion/N12-cash-count-70/screen.png) confirman 50 + 20 = 70. El conteo quedó en el formulario. La evaluación no abrió un turno ni hizo un cobro. La [auditoría de lectura](2026-10-08-pos-native-estacion/N12-backend-paid.json) conserva las ventas y los estados previos.

La comanda móvil tiene una cabecera fija y un cierre accesible. La [captura de 375 × 812](2026-10-08-pos-native-estacion/N12-order-sheet-phone/screen.png) muestra producto, contexto y total. AT-SPI [activa Cerrar comanda](2026-10-08-pos-native-estacion/N12-atspi-sheet-before-close.json). El [regreso al catálogo](2026-10-08-pos-native-estacion/N12-sheet-closed-phone/screen.png) conserva MXN 48.00. El texto visible utiliza Comanda en español y Order en inglés. Los contratos internos conservan sus nombres.

El encabezado consulta la ruta mediante `ModalRoute.of`. La [documentación primaria](https://api.flutter.dev/flutter/widgets/ModalRoute/canPop.html) especifica la actualización de sus dependientes cuando cambia `canPop`. La prueba reproduce el regreso incorrecto al cambiar el tema sobre una ruta cubierta. La corrección y la [lectura nativa](2026-10-08-pos-native-estacion/N12-atspi-dark-root.json) eliminan Volver de la raíz.

El progreso desconocido mueve un segmento y evita representar una falsa mitad completada. El modo reducido muestra marcas estáticas. El progreso conocido publica su porcentaje. El controlador se detiene y se libera. Fuentes: [AnimationController](https://api.flutter.dev/flutter/animation/AnimationController-class.html), [disableAnimationsOf](https://api.flutter.dev/flutter/widgets/MediaQuery/disableAnimationsOf.html). Las pruebas comprueban movimiento, semántica y detención. La captura intermedia de acceso ya muestra el catálogo; la apariencia nativa durante esa carga sigue pendiente.

El botón de icono resuelve su estilo contra los estados reales. Cuatro destinos secundarios incorporan la cabecera común. Sólo cocina vacía tiene observación nativa en esta ronda. El aviso compacto cambia su distribución; su nueva altura después de un traslado aún necesita observación.

La crítica sospechó que el borde de foco del producto quedaba oculto. La [captura con teclado](2026-10-08-pos-native-estacion/N12-product-keyboard-focus/screen.png) muestra el borde azul. La [lectura externa](2026-10-08-pos-native-estacion/N12-product-focus-observed.json) confirma el foco en Croissant. Esa sospecha queda descartada y no justifica un cambio.

### Verificación y límites

Las pruebas nuevas contra N11 dieron **12 aprobaciones y 5 fallos**. Conservo [la regresión previa](2026-10-08-pos-native-estacion/N12-regressions-on-N11.txt). La primera suite de N12 dio **534 aprobaciones y 7 fallos**. Detectó un desborde de cuatro píxeles, una espera infinita ante la animación real, texto anterior y un cierre tardío de semántica. El cálculo de columnas ahora incluye la separación. La espera comprueba la carga sin exigir que termine una animación continua. El [registro inicial](2026-10-08-pos-native-estacion/N12-suite-first-failure.txt) conserva esos fallos.

La [suite final](2026-10-08-pos-native-estacion/suite-N12-isolated.txt) aprueba **541 pruebas**. El [análisis](2026-10-08-pos-native-estacion/analysis-N12-isolated.txt) informa cero problemas. Las fuentes del cliente limpio coinciden con los 25 archivos propios. La ventana ocupa sola el workspace 3.

La tarea de categorías registra **39 cuadros**, máximo de construcción **8.107 ms** y máximo de rasterización **2.531 ms**. Ningún cuadro observado supera su presupuesto. El [registro](2026-10-08-pos-native-estacion/N12-catalog-timeline/catalog.timeline_summary.json) corresponde a 1280 × 720 y modo perfil. El acceso cronometrado tarda **2168 ms** e incluye el instrumento y la captura. El primer acceso fue largo y careció de un cronómetro aislado. Su causa permanece sin verificar. Ningún resultado demuestra arranque frío, hardware móvil o fluidez de todo el POS.

| Criterio                   | Peso | N12 | Evidencia y límite                                                 |
| -------------------------- | ---: | --: | ------------------------------------------------------------------ |
| Tarea y jerarquía          |  20% | 7.7 | Cierre fijo y conteo completo. Navegación integral pendiente.      |
| Calidad visual e identidad |  20% | 7.3 | Secciones abiertas y colores UMI. Formas heredadas aún presentes.  |
| Cobertura y coherencia     |  15% | 7.0 | Terminología y estados corregidos. Destinos completos pendientes.  |
| Adaptación                 |  15% | 7.1 | Caja y comanda móvil verificadas. Dispositivos físicos pendientes. |
| Accesibilidad              |  15% | 7.3 | Cierre, denominaciones y foco externos. Voz e IME pendientes.      |
| Respuesta y recuperación   |  10% | 7.0 | Progreso real y comanda conservada. Carga nativa aún pendiente.    |
| Fluidez                    |   5% | 5.2 | Una tarea medida. Otras tareas y arranque frío pendientes.         |

G37, G38, G40 y G41 cierran en los recorridos observados. G39 sigue abierta para las demás tareas y estados. G13 conserva las fotografías incorrectas del fixture.

**G42:** revisar la acción de apertura cuando el conteo supera el máximo de la política. El código permite habilitarla con un conteo positivo. La negativa canónica no se probó en esta ronda.

**G43:** el cero vacío del campo de cantidad aparece a la izquierda; el valor introducido aparece centrado. La captura de conteo muestra esa inconsistencia.

**G44:** cocina presenta Volver y Cerrar al mismo tiempo. La [captura](2026-10-08-pos-native-estacion/N12-kitchen-empty/screen.png) confirma dos salidas para la misma ruta.

**G45:** el usuario identifica formas heredadas cuyo comportamiento cambió, especialmente en Ventas. El código mezcla paneles, diálogos y páginas para destinos del mismo nivel. N13 debe resolver la relación entre forma y acción. La selección debe corresponder al destino visible. Esta crítica limita la coherencia y la dirección visual. N12 no cumple 10.0.

## N13 · La forma corresponde a la acción · 7.4/10

Base: N12, commit `7ffd17b`. La media ponderada es **7.44 → 7.4**. La observación del usuario modifica el criterio de revisión. La fidelidad al diseño anterior carece de valor por sí sola. La forma debe explicar la acción actual. Conservo los colores UMI y la investigación previa.

### Dirección y comportamiento

Las siete secciones principales comparten una navegación persistente. Ventas, Caja y Pedidos dejan de cubrir la navegación con paneles o diálogos. Mesas, Cocina y Ajustes pertenecen al mismo espacio. La selección marca el destino visible. El índice lateral combina icono y texto en una fila, con una regla azul para la selección. En teléfono, Más muestra el nombre del destino elegido.

La [comparación previa](2026-10-08-pos-native-estacion/N13-sales-before/screen.png) conserva el panel redondeado y la selección en Comanda. La [primera versión](2026-10-08-pos-native-estacion/N13-r1-sales-wide/screen.png) elimina esa contradicción, pero separa demasiado el nombre y el importe. La [revisión amplia](2026-10-08-pos-native-estacion/N13-sales-wide/screen.png) limita el ancho de lectura sin introducir otra tarjeta flotante. La [vista final](2026-10-08-pos-native-estacion/N13-final-preview/screen.png) mantiene la página y la navegación disponibles.

El recorrido artístico conserva Carecore → Drice → Garcin. Su [memoria de 2013](https://sarahgarcin.com/projets/experimentation-graphique-vs-diffusion-et-lisibilite-memoire) distingue expresión gráfica y lectura. **Inferencia aplicada:** la composición puede cambiar por completo, pero una forma no debe prometer otra acción. El usuario identifica esa contradicción en el producto. La fuente artística aporta un marco crítico; las pruebas del POS comprueban el resultado concreto.

El pedido permanece montado al cambiar de sección. `Offstage` conserva su estado, pero permite foco y animación si se utiliza solo. El cliente añade `ExcludeFocus` y `TickerMode`. Fuentes primarias: [Offstage](https://api.flutter.dev/flutter/widgets/Offstage-class.html), [ExcludeFocus](https://api.flutter.dev/flutter/widgets/ExcludeFocus-class.html), [TickerMode](https://api.flutter.dev/flutter/widgets/TickerMode-class.html). Los demás destinos se montan al seleccionarlos y se liberan al salir. Esa decisión evita conservar pantallas de consulta con sus temporizadores; los formularios de esos destinos necesitan una revisión adicional.

La prueba confirma que salir a Ventas conserva el producto, la versión de la comanda y la búsqueda. La observación nativa conserva [Chico y Leche entera antes](2026-10-08-pos-native-estacion/N13-detail-before-navigation/screen.png) y [después del regreso](2026-10-08-pos-native-estacion/N13-detail-returned/screen.png). La [lectura externa de Ventas](2026-10-08-pos-native-estacion/N13-atspi-sales-wide.json) encuentra su selección y las otras acciones disponibles. Cocina [elimina las dos salidas](2026-10-08-pos-native-estacion/N13-kitchen-1280/screen.png). G44 y G45 cierran para estos destinos.

### Crítica dentro de la versión

La nueva barra lateral redujo el espacio de Caja. La [segunda compilación](2026-10-08-pos-native-estacion/N13-cash-1280/screen.png) ocultó la última denominación. El pie de apertura ahora cambia de distribución según el ancho que requiere su contenido. La [tercera compilación](2026-10-08-pos-native-estacion/N13-r3-cash-1280/screen.png) muestra las once denominaciones, el total y la acción. La prueba reproduce el fallo anterior y comprueba el objetivo final sin abrir el turno.

El regreso del detalle tenía una flecha accionable junto a un texto que parecía pertenecer al mismo botón. Pulsar Catálogo no cerraba el detalle. **G46:** esa división contradice la forma percibida. La corrección reúne flecha y texto. La [activación externa](2026-10-08-pos-native-estacion/N13-r3-detail-close-external.json) acepta Catálogo y la [captura posterior](2026-10-08-pos-native-estacion/N13-r3-catalog-after-close/screen.png) confirma el catálogo. La prueba existente incorpora ese regreso. G46 cierra.

Ventas funciona en [tablet de 1024 × 768](2026-10-08-pos-native-estacion/N13-sales-tablet/screen.png) y [teléfono de 375 × 812](2026-10-08-pos-native-estacion/N13-sales-phone/screen.png). En teléfono los filtros ocupan tres filas. La lista pierde demasiado espacio. **G48:** reducir esa altura sin ocultar la selección ni las acciones. Más muestra Mesas en la [captura móvil](2026-10-08-pos-native-estacion/N13-tables-phone/screen.png), pero su [nombre accesible](2026-10-08-pos-native-estacion/N13-atspi-tables-phone.json) permanece Más secciones. **G47:** incluir el destino actual en ese nombre.

### Verificación y procedencia

Las pruebas nuevas contra N12 dan **6 aprobaciones y 2 fallos**. Conservo [la regresión](2026-10-08-pos-native-estacion/N13-regressions-on-N12.txt). La primera prueba de integración detectó una notificación al padre durante el montaje del historial. La carga ahora empieza después del primer cuadro. También detectó un repositorio falso con una respuesta incompleta. El fixture de prueba ahora devuelve el contrato de historial y una venta válida.

Una comprobación inicial trató cualquier `ModalBarrier` como prueba de un panel. Ese supuesto era incorrecto. La prueba final comprueba que la ruta de navegación es actual y que Comanda recibe la pulsación. Conservo [el fallo del instrumento](2026-10-08-pos-native-estacion/N13-navigation-instrument-failure.txt). Dos rutas de pruebas iniciales no existían; el reintento utilizó el inventario real del repositorio.

La [suite final](2026-10-08-pos-native-estacion/suite-N13-isolated.txt) aprueba **544 pruebas**. El [análisis](2026-10-08-pos-native-estacion/analysis-N13-isolated.txt) informa cero problemas. Flutter 3.47.5 y Dart 3.13.4 verifican las once rutas propias en un cliente limpio. El [manifiesto](2026-10-08-pos-native-estacion/N13-manifest.json) conserva hashes, límites y la ventana sola en el workspace 3. El trabajo TPM permanece separado.

La tarea de categorías registra **33 cuadros**, máximo de construcción **6.906 ms** y máximo de rasterización **2.873 ms**. El [registro](2026-10-08-pos-native-estacion/N13-catalog-timeline/catalog.timeline_summary.json) no muestra un cuadro que exceda su presupuesto. Corresponde a 1280 × 720, modo perfil y doce cambios de categoría. Conserva los límites de medición anteriores.

La [auditoría](2026-10-08-pos-native-estacion/N13-backend-paid.json) confirma los pagos previos y el tiempo original de la ocupación. La mesa destino cambió de Mesa 3 a Mesa 4. Ninguna acción registrada del driver en N13 ejecutó un traslado. La [nota de alcance](2026-10-08-pos-native-estacion/N13-backend-scope-note.json) conserva el primer fallo y marca la causa como no verificada. La revisión no cambia la mesa para satisfacer el predicado anterior. N13 no ejecutó una apertura de caja ni un pago.

| Criterio                   | Peso | N13 | Evidencia y límite                                                                   |
| -------------------------- | ---: | --: | ------------------------------------------------------------------------------------ |
| Tarea y jerarquía          |  20% | 8.0 | Destinos disponibles y selección real. Formularios al cambiar de destino pendientes. |
| Calidad visual e identidad |  20% | 7.7 | Índice propio y página de actividad. Filtros y fotografías pendientes.               |
| Cobertura y coherencia     |  15% | 7.4 | Siete destinos comparten estructura. Estados y tareas completos pendientes.          |
| Adaptación                 |  15% | 7.3 | Tres tamaños y regresión de Caja corregida. Filtros móviles pendientes.              |
| Accesibilidad              |  15% | 7.5 | Selección y regreso externos. Nombre de Más, voz e IME pendientes.                   |
| Respuesta y recuperación   |  10% | 7.1 | Comanda, búsqueda y opciones conservadas. Formularios restantes pendientes.          |
| Fluidez                    |   5% | 5.2 | Categorías medidas. Arranque frío y otras tareas pendientes.                         |

N14 debe resolver G47 y G48 y observar la conservación de formularios. G42, G43, G13 y las brechas integrales conservan su alcance. N13 no cumple 10.0.

## N14 · Continuidad entre destinos · 7.7/10

Base: N13, commit `6274af0`. La media ponderada es **7.700 → 7.7**. La evaluación conserva las brechas anteriores. El [manifiesto](2026-10-08-pos-native-estacion/N14-manifest.json) fija fuentes, pruebas y observaciones. El trabajo TPM queda fuera del diseño y de la compilación limpia.

### Formularios y acciones

**G49:** Caja perdía el conteo al salir de su destino. La comparación nativa registra [70 antes de salir](2026-10-08-pos-native-estacion/N14-cash-before-leave/screen.png) y [0 al regresar](2026-10-08-pos-native-estacion/N14-cash-after-return-before-fix/screen.png). Caja ahora conserva su formulario después de la primera visita. La comanda ya conservaba su estado desde N13. Las consultas restantes se liberan al salir. La [captura final](2026-10-08-pos-native-estacion/N14-final-cash-retained/screen.png) confirma 70 después de Caja → Ventas → Caja. G49 cierra en ese recorrido.

**G42:** el conteo debe respetar el máximo de apertura. La [API canónica](../../apps/umi-api/src/modules/pos-cash/pos-cash.repository.ts) rechaza importes que superan `maximumOpeningFloat`. La interfaz ahora explica el límite y desactiva la apertura. La [captura de 1,070](2026-10-08-pos-native-estacion/N14-final-cash-over-maximum/screen.png) muestra un máximo de 1,000. La [lectura externa](2026-10-08-pos-native-estacion/N14-final-atspi-maximum.json) encuentra la acción sin habilitación ni Tap. La prueba comprueba el máximo exacto, medio peso adicional y la corrección del conteo. No ejecuta una apertura. G42 cierra para ese límite conocido.

**G43:** el cero del campo vacío seguía una alineación distinta al valor escrito. El campo ahora alinea el texto de ayuda con `TextAlign`. La [captura de 70](2026-10-08-pos-native-estacion/N14-final-cash-70/screen.png) muestra ceros y cantidades centrados. Fuente primaria: [Stack.alignment](https://api.flutter.dev/flutter/widgets/Stack/alignment.html). G43 cierra para esas cantidades.

### Ventas y selección

Los filtros móviles comparten una fila. El texto aumentado utiliza dos filas para conservar palabras completas. Los estados mantienen sus nombres y la ordenación utiliza Recientes o Antiguas. La primera distribución dejó [Recientes partido dentro de la palabra](2026-10-08-pos-native-estacion/N14-sales-phone/screen.png). Esa versión queda rechazada. La [revisión final](2026-10-08-pos-native-estacion/N14-final-sales-phone/screen.png) conserva la palabra completa. El [estado Suspendidas](2026-10-08-pos-native-estacion/N14-final-sales-suspended-phone/screen.png) conserva las dos ventas reales y sus acciones. G48 cierra en 375 × 812 con texto normal. La prueba cubre texto aumentado; su apariencia nativa sigue pendiente.

Más incluye el destino visible en su nombre accesible. La [lectura externa final](2026-10-08-pos-native-estacion/N14-final-atspi-more.json) informa Mesas, más secciones y selección activa. Una lectura anterior ocurrió durante el cierre del menú. Conservo [ese estado transitorio](2026-10-08-pos-native-estacion/N14-atspi-more-closing.json) con su nombre correcto. La captura posterior y la lectura final comprueban el destino estable. G47 cierra.

### Eventos de la comanda

**G50:** el catálogo conservado escuchaba escaneos desde otras secciones. La [prueba previa](2026-10-08-pos-native-estacion/N14-scanner-before-fix.txt) esperaba cero consultas en Ventas y encontró una. La revisión conserva el catálogo, pero limita el escaneo al destino Comanda, sin detalle abierto, con permiso y con su ruta actual. Una generación invalida resultados y eventos pendientes cuando cambia el destino.

La [prueba corregida](2026-10-08-pos-native-estacion/N14-scanner-after-fix.txt) comprueba Ventas, Caja, regreso a Comanda, una consulta tardía, una lectura en cola y un diálogo. Las lecturas activas sí solicitan adiciones. Las lecturas fuera del contexto no las solicitan. La corrección también revisa la segunda espera de un producto con opciones. Ese segundo caso no tiene una tarea nativa con lector físico. G50 cierra en el alcance automatizado; el dispositivo físico sigue pendiente.

[Offstage](https://api.flutter.dev/flutter/widgets/Offstage-class.html) conserva hijos activos. [Route.isCurrent](https://api.flutter.dev/flutter/widgets/Route/isCurrent.html) identifica la ruta superior. **Inferencia UMI:** conservar un formulario exige controlar también los eventos que producen acciones. La propiedad `isCurrent` por sí sola no distingue las nuevas secciones dentro de la misma ruta. La selección y la generación completan esa condición.

### Verificación y crítica

Las pruebas contra N13 dieron **61 aprobaciones y 4 fallos**. Conservo [el registro](2026-10-08-pos-native-estacion/N14-regressions-on-N13.txt). La primera ejecución usó una ruta de prueba inexistente y una interacción anterior del filtro. La segunda encontró una pulsación sobre una denominación fuera del área visible. La prueba ahora desplaza el conteo antes de reducirlo. Los registros [inicial](2026-10-08-pos-native-estacion/N14-targeted-first.txt) y [siguiente](2026-10-08-pos-native-estacion/N14-targeted-second.txt) conservan los fallos.

El instrumento del escáner quedó en su cierre dentro del reloj falso de la prueba. La limpieza ahora usa `tester.runAsync`. Conservo [la localización del bloqueo](2026-10-08-pos-native-estacion/N14-scanner-instrument-probe.txt). La suite posterior aprobó 545 casos, pero el análisis pidió una comprobación explícita de `mounted`. La revisión final incluye esa condición. La [suite final](2026-10-08-pos-native-estacion/suite-N14-isolated.txt) aprueba **545 pruebas**. El [análisis final](2026-10-08-pos-native-estacion/analysis-N14-isolated.txt) informa cero problemas.

Flutter 3.47.5 y Dart 3.13.4 verifican trece rutas propias. La aplicación nativa usa modo perfil. La ventana ocupa sola el workspace 3. Una pulsación inicial utilizó el importe sin su separador de miles. La espera de presencia venció; la pulsación no ocurrió. La revisión posterior utilizó el nombre accesible real.

La tarea de doce cambios de categoría registra **35 cuadros**, construcción máxima **13.627 ms** y rasterización máxima **2.846 ms**. El [registro](2026-10-08-pos-native-estacion/N14-catalog-timeline/catalog.timeline_summary.json) no muestra cuadros que excedan esos presupuestos. El resultado no mide arranque frío, GPU física ni el POS completo. La variación frente a N13 no permite atribuir una regresión a esta interfaz.

La [auditoría de lectura](2026-10-08-pos-native-estacion/N14-backend-paid.json) conserva los dos pagos previos y el tiempo de ocupación. N14 no solicita cobros, aperturas ni traslados en la sesión nativa. La causa del traslado previo a Mesa 4 conserva el límite registrado en N13.

| Criterio                   | Peso | N14 | Evidencia y límite                                                                   |
| -------------------------- | ---: | --: | ------------------------------------------------------------------------------------ |
| Tarea y jerarquía          |  20% | 8.3 | Conteo conservado y límite explicado. Tareas completas restantes pendientes.         |
| Calidad visual e identidad |  20% | 7.9 | Filtros compactos, cantidades alineadas y marca UMI. Menús y fotografías pendientes. |
| Cobertura y coherencia     |  15% | 7.6 | Eventos del pedido respetan el destino. Estados secundarios completos pendientes.    |
| Adaptación                 |  15% | 7.6 | Ventas en teléfono y conteo en 1280 × 720. Texto aumentado nativo pendiente.         |
| Accesibilidad              |  15% | 7.8 | Nombre del destino y apertura deshabilitada externos. Voz e IME pendientes.          |
| Respuesta y recuperación   |  10% | 7.5 | Conteo y eventos tardíos resueltos. Otros formularios y carga nativa pendientes.     |
| Fluidez                    |   5% | 5.2 | Categorías medidas. Arranque frío y otras tareas pendientes.                         |

**G51:** el selector de Ventas parece desplegable, pero abre un diálogo central. La [captura](2026-10-08-pos-native-estacion/N14-select-dialog-phone/screen.png) confirma esa separación entre control y opciones. N15 debe vincular visualmente las opciones con su origen. Debe conservar teclado, selección, cierre y límites de pantalla. La documentación de [RawMenuAnchor](https://api.flutter.dev/flutter/widgets/RawMenuAnchor-class.html) ofrece anclaje sin estilo Material. El foco y la semántica requieren controles propios.

G13 conserva las fotografías incorrectas. G39, el lector hablado, el IME, los dispositivos físicos y las tareas pendientes siguen abiertos. La [vista completa](2026-10-08-pos-native-estacion/N14-final-preview/screen.png) conserva la dirección actual. N14 no cumple 10.0.

## N15: forma de apertura y continuidad entre tamaños, 7.9

N15 mantiene la dirección independiente y los colores UMI. Los selectores y los menús de acciones abren sus opciones junto al control. La forma ya corresponde a una apertura local. El menú conserva selección, cierre exterior, teclado y regreso del foco. Abre hacia arriba cuando falta espacio. La reducción de movimiento elimina su transición.

La [decisión técnica](2026-10-08-pos-native-estacion/N15-decision.md) distingue hechos de documentación e inferencias. La composición propia usa `PopupRoute` y posición calculada. La ruta también conserva la protección del escáner cuando un menú cubre la comanda. La rama artística de Garcin aporta una crítica sobre expresión y lectura. Su obra no sustituye las pruebas de operación.

### Brechas nuevas y corrección comprobada

**G52.** El cambio de teléfono a escritorio recreaba el contenido principal. Ventas perdía el filtro. Caja perdía el total. La [prueba anterior](2026-10-08-pos-native-estacion/N15-resize-before-fix.txt) reproduce el fallo. `PosPage` conserva un `Flex` y claves locales. La [prueba posterior](2026-10-08-pos-native-estacion/N15-resize-after-fix.txt) pasa.

**G53.** Esa corrección conservó el total de Caja, pero sus cantidades volvieron a cero. La [captura de revisión](2026-10-08-pos-native-estacion/N15-r2-cash-70-returned-wide/screen.png) muestra la contradicción. El contenedor interno de Caja también cambiaba el padre del contador. Sus secciones ahora conservan identidad entre distribuciones. La [prueba anterior](2026-10-08-pos-native-estacion/N15-count-before-fix.txt) falla con cantidad vacía. La [prueba posterior](2026-10-08-pos-native-estacion/N15-count-after-fix.txt) aprueba 53 casos relevantes.

La prueba comprueba una unidad de $50 y una de $20 después de cada cambio de ancho. También comprueba sus subtotales y una reducción posterior a $50. La comprobación nativa lee los valores exactos de los campos. Las capturas de [escritorio](2026-10-08-pos-native-estacion/N15-checked-cash-70-wide/screen.png), [tablet](2026-10-08-pos-native-estacion/N15-checked-cash-70-tablet/screen.png), [teléfono](2026-10-08-pos-native-estacion/N15-checked-cash-70-phone/screen.png) y [regreso al escritorio](2026-10-08-pos-native-estacion/N15-checked-cash-70-returned-wide/screen.png) corresponden a 1280 × 720, 1024 × 768, 375 × 812 y 1280 × 720. La [corrección a $50](2026-10-08-pos-native-estacion/N15-checked-cash-corrected-50/screen.png) conserva el cálculo coherente. La sesión nativa no solicita una apertura de turno.

La selección mediante flecha y Enter cambia el filtro a Suspendidas. Espacio vuelve a abrirlo; Escape lo cierra. Las [opciones](2026-10-08-pos-native-estacion/N15-checked-filter-phone/screen.png) y la [selección](2026-10-08-pos-native-estacion/N15-checked-filter-keyboard-selected/screen.png) muestran esos estados. El [regreso al escritorio](2026-10-08-pos-native-estacion/N15-checked-filter-retained-wide/screen.png) conserva el filtro y cierra las opciones de orden. La [inspección externa](2026-10-08-pos-native-estacion/N15-checked-atspi-sales.json) confirma la selección. La conservación del filtro al abandonar Ventas requiere otra revisión; esta tarea comprueba el cambio de ancho.

### Instrumentos y fallos conservados

Las pruebas del menú sobre N14 fallan porque todavía no existe el panel anclado. La primera implementación consulta el tamaño del ancla durante el cálculo de posición y provoca una aserción. La corrección captura el rectángulo antes de abrir la ruta. Conservo los registros [anteriores](2026-10-08-pos-native-estacion/N15-regressions-on-N14.txt), [del fallo de posición](2026-10-08-pos-native-estacion/N15-menu-layout-first.txt) y [de los menús corregidos](2026-10-08-pos-native-estacion/N15-menu-targeted-final.txt).

El instrumento inicial alterna entre ventana flotante y ventana distribuida. Algunas capturas reciben nombres que no corresponden a sus dimensiones. El [registro de dimensiones](2026-10-08-pos-native-estacion/N15-instrument-size-review.json) las identifica. La revisión final comprueba la geometría del proceso y las dimensiones del PNG. Sólo las capturas `N15-checked` sustentan las medidas de adaptación. El primer acceso del instrumento también usa un directorio sin el archivo privado de inscripción. La corrección usa el directorio del fixture; conserva la compilación aislada.

La auditoría inicial usa por error su fase predeterminada, anterior al pago. Esa condición falla y revierte la transacción de lectura. La [auditoría con la fase correcta](2026-10-08-pos-native-estacion/N15-backend-paid.json) confirma los dos pagos previos, la variante, la nota Unicode y el tiempo de ocupación. No se atribuye un cambio de datos al fallo del instrumento. El traslado previo de Mesa 4 conserva su causa sin verificar.

La [suite aislada](2026-10-08-pos-native-estacion/suite-N15-isolated.txt) aprueba **548 pruebas**. El [análisis final](2026-10-08-pos-native-estacion/analysis-N15-isolated.txt) informa cero problemas. La última corrección de análisis retira dos aserciones de nulidad redundantes. El comportamiento probado permanece igual. El trabajo TPM del usuario queda fuera de las seis rutas del cambio de diseño y de la compilación aislada.

La [medición con tamaño comprobado](2026-10-08-pos-native-estacion/N15-checked-catalog-timeline/catalog.timeline_summary.json) registra **30 cuadros**, construcción máxima **11.033 ms** y rasterización máxima **3.706 ms**. Ningún cuadro excede esos presupuestos en doce cambios de categoría, a 1280 × 720. La medición no cubre arranque frío, GPU física ni tareas completas. El registro anterior con tamaño incorrecto queda fuera de la evaluación.

| Criterio                   | Peso | N15 | Evidencia y límite                                                            |
| -------------------------- | ---: | --: | ----------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 8.4 | Forma y apertura coherentes; conteo editable. Tareas restantes pendientes.    |
| Calidad visual e identidad |  20% | 8.0 | Opciones próximas y marca UMI. Fotografías incorrectas pendientes.            |
| Cobertura y coherencia     |  15% | 7.8 | Selectores y acciones comparten reglas. Estados secundarios pendientes.       |
| Adaptación                 |  15% | 8.0 | Estado y campos conservados en tres anchos. Texto aumentado nativo pendiente. |
| Accesibilidad              |  15% | 8.0 | Teclado y selección externos. Voz e IME pendientes.                           |
| Respuesta y recuperación   |  10% | 7.8 | Menús cancelables y formularios conservados. Recuperación completa pendiente. |
| Fluidez                    |   5% | 5.2 | Tarea breve medida; arranque frío y otras tareas pendientes.                  |

Media ponderada: **7.89 → 7.9**. G51, G52 y G53 cierran en el alcance comprobado. G13 y G39 siguen abiertos. La nota acumula las revisiones anteriores y sus límites. N15 no cumple 10.0.

## N16: reconocimiento y consulta conservada, 7.9

La [carta en 1280 × 720](2026-10-08-pos-native-estacion/N16-catalog-1280/screen.png) muestra café negro para Americano y una rebanada para Cheesecake. La revisión sustituye las dos fotografías incorrectas del fixture. Conserva los dibujos propios y los colores UMI. La corrección no certifica las recetas ni las fotografías del comercio real.

La búsqueda sigue las páginas originales y los archivos de tres fotógrafos. Descarta una taza tapada aunque su descripción menciona Americano. La [decisión](2026-10-08-pos-native-estacion/N16-decision.md) conserva autores, fechas de 2019, 2020 y 2025, licencia y límites. El [registro](2026-10-08-pos-native-estacion/N16-media-candidates/sources.json) identifica las imágenes por SHA-256. La [transacción](2026-10-08-pos-native-estacion/N16-media-update.json) cambia exactamente dos filas. Comprueba la base desechable, el comercio, los UUID y las URL anteriores. G13 cierra sólo para estas muestras.

**G54.** Ventas perdía búsqueda, filtro y orden al salir hacia Caja. Ahora conserva su superficie y excluye su foco cuando está oculta. Al regresar, actualiza el historial con los parámetros conservados. La [prueba anterior](2026-10-08-pos-native-estacion/N16-query-before-fix.txt) reproduce el fallo. La [prueba posterior](2026-10-08-pos-native-estacion/N16-query-after-fix.txt) aprueba 33 casos. Comprueba también los parámetros que recibe el repositorio. Las capturas de [teléfono](2026-10-08-pos-native-estacion/N16-sales-query-returned-phone/screen.png) y [escritorio](2026-10-08-pos-native-estacion/N16-sales-query-returned-wide/screen.png) conservan búsqueda, selección y orden. La [inspección externa](2026-10-08-pos-native-estacion/N16-atspi-sales-returned.json) confirma selección y nombre del orden.

**G56.** La consulta `croissant` conserva sus controles, pero no encuentra la venta titulada Croissant. El [registro de lectura](2026-10-08-pos-native-estacion/N16-sales-search-gap.json) confirma que el título visible proviene del producto. La consulta canónica busca nombre asignado, cliente y recibo; omite los productos. Esta contradicción entre nombre visible y búsqueda mantiene una brecha importante. N17 debe resolverla en el propietario de la consulta.

**G55, NV.** El controlador de historial omite otra carga cuando ya tiene una solicitud pendiente. La respuesta ante cambios rápidos de filtro requiere una prueba específica. La inspección del código establece la condición; todavía no demuestra el efecto completo en la sesión nativa.

La [suite aislada](2026-10-08-pos-native-estacion/suite-N16-isolated.txt) aprueba **548 pruebas**. El [análisis](2026-10-08-pos-native-estacion/analysis-N16-isolated.txt) informa cero problemas. La revisión extiende una prueba existente; el número total no aumenta. Las tres rutas propias quedan separadas del trabajo TPM. La [auditoría de lectura](2026-10-08-pos-native-estacion/N16-backend-paid.json) conserva pagos, variante, nota Unicode y tiempo de ocupación. La revisión nativa no solicita cobro, apertura de turno ni traslado de mesa.

La [medición](2026-10-08-pos-native-estacion/N16-catalog-timeline/catalog.timeline_summary.json) registra **33 cuadros**, construcción máxima **12.139 ms** y rasterización máxima **3.087 ms**. Ningún cuadro excede esos presupuestos en doce cambios de categoría a 1280 × 720. El proceso y cada PNG confirman el tamaño solicitado. La tarea no representa arranque frío ni el POS completo.

| Criterio                   | Peso | N16 | Evidencia y límite                                                               |
| -------------------------- | ---: | --: | -------------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 8.4 | Consulta conservada; búsqueda del nombre visible pendiente.                      |
| Calidad visual e identidad |  20% | 8.2 | Fotografías reconocibles y marca UMI; juicio con operadores pendiente.           |
| Cobertura y coherencia     |  15% | 7.7 | Nueva contradicción confirmada en la búsqueda. Estados secundarios pendientes.   |
| Adaptación                 |  15% | 8.0 | Tres anchos y consulta conservada. Texto aumentado nativo pendiente.             |
| Accesibilidad              |  15% | 8.0 | Selección externa; voz e IME pendientes.                                         |
| Respuesta y recuperación   |  10% | 7.9 | Formulario conservado y resultados actualizados. Solicitudes rápidas pendientes. |
| Fluidez                    |   5% | 5.2 | Categorías medidas; arranque frío y otras tareas pendientes.                     |

Media ponderada: **7.925 → 7.9**. La nota se mantiene: los avances visuales no compensan una búsqueda contradictoria. G54 cierra en el alcance comprobado. G55, G56, G39 y los límites anteriores permanecen abiertos. N16 no cumple 10.0.

## N17: buscar el nombre visible y recuperar la lectura, 8.0

La [decisión](2026-10-08-pos-native-estacion/N17-decision.md) conserva investigación primaria y fallos del instrumento. El repositorio real anterior no encuentra Croissant ni Latte por producto. La API añade búsqueda del nombre histórico con `EXISTS`. Mantiene comercio, ubicación, estado, orden y cursor. Las [consultas posteriores](2026-10-08-pos-native-estacion/N17-api-after.json) comprueban resultados, ausencia, límites de ámbito y dos páginas diferentes.

Las [pruebas anteriores](2026-10-08-pos-native-estacion/N17-history-before-fix.txt) reproducen cuatro fallos. Una consulta nueva se descarta mientras otra sigue pendiente. Un error del historial cambia la fase comercial. N17 asigna una generación a cada consulta nueva. Sólo la vigente publica datos, cursor, error y carga. El historial conserva un error propio. La disposición y el cambio de ubicación invalidan respuestas pendientes.

La [búsqueda nativa de Croissant](2026-10-08-pos-native-estacion/N17-sales-product-phone/screen.png) conserva la consulta al visitar Caja. Latte aparece en escritorio, tablet y teléfono. La ausencia de coincidencias tiene un mensaje propio. La [caída controlada de la API local](2026-10-08-pos-native-estacion/N17-sales-history-failure-wide/screen.png) muestra un error con reintento. La API vuelve a iniciar; el [reintento](2026-10-08-pos-native-estacion/N17-sales-history-recovered-wide/screen.png) recupera Latte. La comanda conserva Croissant.

La [suite aislada](2026-10-08-pos-native-estacion/suite-N17-isolated.txt) aprueba **555 pruebas**. El [análisis](2026-10-08-pos-native-estacion/analysis-N17-isolated.txt) informa cero problemas. La API aprueba seis pruebas del servicio, TypeScript y compilación. La [auditoría de lectura](2026-10-08-pos-native-estacion/N17-backend-paid.json) conserva pagos, notas, variante y ocupación anteriores. N17 no solicita cobros, aperturas ni traslados.

| Criterio                   | Peso | N17 | Evidencia y límite                                                                      |
| -------------------------- | ---: | --: | --------------------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 8.5 | El nombre visible produce resultados. Tareas completas restantes pendientes.            |
| Calidad visual e identidad |  20% | 8.2 | Dirección propia y colores UMI. N17 conserva la nota visual.                            |
| Cobertura y coherencia     |  15% | 8.0 | Consulta, carga, fallo y ausencia distinguidos. Estados secundarios pendientes.         |
| Adaptación                 |  15% | 8.0 | Resultado en tres anchos. Texto aumentado nativo pendiente.                             |
| Accesibilidad              |  15% | 8.0 | Nombres externos y regiones activas. Voz e IME pendientes.                              |
| Respuesta y recuperación   |  10% | 8.2 | Reintento nativo y respuestas tardías automatizadas. Carga prolongada nativa pendiente. |
| Fluidez                    |   5% | 5.2 | Medición anterior de categorías. N17 no aporta una medición nueva de fluidez.           |

Media ponderada: **8.02 → 8.0**. G56 cierra para productos comprobados. G55 cierra en el alcance automatizado. G57 cierra para la lectura fallida y el reintento comprobados. El orden deliberado de respuestas y la carga prolongada no se observan en el proceso nativo. La [vista final](2026-10-08-pos-native-estacion/N17-final-preview/screen.png) queda abierta sola en el workspace 3. G39 y los límites anteriores permanecen. N17 no cumple 10.0.

## N18: aumentar texto y conservar espacio de trabajo, 8.1

La [decisión](2026-10-08-pos-native-estacion/N18-decision.md) conserva investigación primaria y cuatro compilaciones criticadas. Ajustes ofrece Sistema, Grande y Muy grande. Los mínimos de 1.5 y 2.0 respetan valores mayores del sistema. El formato anterior conserva Sistema como opción inicial.

G58 corrige palabras cortadas en la navegación móvil. G59 permite desplazar encabezados y productos de la carta juntos. G60 corrige palabras cortadas en la barra lateral y Pedidos. G61 permite alcanzar el conteo de Caja y reorganiza las denominaciones estrechas. El valor contado permanece al cambiar el tamaño. La investigación conserva sus límites de fuentes, transporte Linux y curvas Android.

**G62 permanece abierta.** Ventas con texto grande reserva demasiado espacio al formulario y al aviso. El intento nativo no revela el importe completo de Croissant. La nota incluye esta brecha; N18 no demuestra adaptación completa.

La suite aislada aprueba **568 pruebas**; el análisis informa cero problemas. Las 67 pruebas específicas comprueban preferencias, palabras completas y conservación del conteo. La medición nativa registra 39 cuadros en doce cambios de categoría a 1280 × 720. Construcción máxima: 13.304 ms; rasterización máxima: 3.356 ms. La medición no cubre arranque frío ni texto grande.

| Criterio                   | Peso | N18 | Evidencia y límite                                                           |
| -------------------------- | ---: | --: | ---------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 8.5 | Conserva tareas anteriores. G62 y tareas completas pendientes.               |
| Calidad visual e identidad |  20% | 8.2 | Colores UMI y composición propia. La nota visual permanece.                  |
| Cobertura y coherencia     |  15% | 8.0 | Estados vacíos revisados. G62 y estados secundarios pendientes.              |
| Adaptación                 |  15% | 8.3 | Carta, navegación y conteo con texto aumentado. G62 abierta.                 |
| Accesibilidad              |  15% | 8.2 | Elección real de tamaño, sin techo artificial. Voz e IME pendientes.         |
| Respuesta y recuperación   |  10% | 8.2 | Guarda la preferencia y conserva el conteo. Recuperación integral pendiente. |
| Fluidez                    |   5% | 5.2 | Categorías medidas. Arranque frío y tareas completas pendientes.             |

Media ponderada: **8.095 → 8.1**. Las correcciones cierran sólo los tamaños y las condiciones comprobados. G62, G39 y los límites anteriores permanecen. La nota visual se conserva. N18 no cumple 10.0. La [vista final](2026-10-08-pos-native-estacion/N18-final-preview/screen.png) usa los colores UMI y ocupa sola el workspace vacío.

## N19: Ventas libera espacio para datos y acciones, 8.2

La [decisión](2026-10-08-pos-native-estacion/N19-decision.md) conserva el cambio, investigación y límites. El formulario y la lista comparten desplazamiento en cuerpo estrecho con texto grande. Las filas conservan altura natural. La paginación mantiene error y reintento junto a las ventas recibidas.

**G62 se cierra en el alcance comprobado.** Croissant, MXN 48.00, estado y acción se alcanzan al 200% con aviso presente. La revisión nativa incluye español, inglés, 150%, 200%, texto normal, teléfono, tablet y escritorio. El fallo de conexión de la API propia muestra error. Reintentar recupera los datos y conserva la búsqueda.

La suite aislada aprueba **575 pruebas**; el análisis informa cero problemas. Las 38 pruebas específicas incluyen siete casos nuevos. La paginación con error y cursor conservado se comprueba con repositorio controlado. No se declara paginación nativa masiva ni medición nueva de cuadros.

| Criterio                   | Peso | N19 | Evidencia y límite                                                                |
| -------------------------- | ---: | --: | --------------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 8.5 | Nombre, importe y acción alcanzables. Tareas completas pendientes.                |
| Calidad visual e identidad |  20% | 8.2 | Dirección y colores UMI. Nota visual conservada.                                  |
| Cobertura y coherencia     |  15% | 8.1 | Estados y reintento de página. G39 permanece.                                     |
| Adaptación                 |  15% | 8.6 | G62 corregida en las escalas, idiomas y dimensiones capturados.                   |
| Accesibilidad              |  15% | 8.2 | Campo conserva foco durante cambio visible. Tab completo, voz e IME pendientes.   |
| Respuesta y recuperación   |  10% | 8.3 | Reintento nativo con búsqueda conservada. Pagos anteriores sin cambios.           |
| Fluidez                    |   5% | 5.2 | Se conserva la medición de categorías. Ventas y arranque frío sin medición nueva. |

Media ponderada: **8.165 → 8.2**. La auditoría conserva los hechos comerciales capturados. La diferencia de `updated_at` sigue al acceso por PIN; su atribución es una inferencia. El AOT y las fuentes identifican la compilación aislada. El trabajo TPM queda fuera del cambio de diseño. La [vista final](2026-10-08-pos-native-estacion/N19-final-preview/screen.png) ocupa sola el workspace 3. N19 no cumple 10.0.

## N20: documento completo y foco visible, 8.3

La [decisión](2026-10-08-pos-native-estacion/N20-decision.md) conserva la crítica, investigación y dos compilaciones. La línea base ya pasa el recorrido de búsqueda, filtro y orden. N20 no inventa ese fallo. Precisa también que un Finder fuera de escena no prueba desmontaje del encabezado.

G63 corrige nombres y omisiones del recibo. Abrir recibo muestra un documento. Imprimir recibo conserva callback y permiso. Ventas y el detalle de cobro comparten variante, notas, precios y total canónicos. La presentación responde al ancho medido del texto.

G64 aparece durante la primera inspección nativa. Una referencia seleccionable recibe foco sin indicador y queda fuera de pantalla. La prueba reproduce −521 píxeles respecto del viewport. La corrección revela la referencia, muestra un borde y comunica el foco. La segunda compilación confirma esos resultados en español e inglés.

La suite aislada aprueba **588 pruebas**; el análisis informa cero problemas. Las 57 pruebas específicas incluyen trece casos nuevos. La inspección nativa comprueba recorrido, cierre, retorno al disparador y datos de Latte. La impresión física no se prueba.

| Criterio                   | Peso | N20 | Evidencia y límite                                                                               |
| -------------------------- | ---: | --: | ------------------------------------------------------------------------------------------------ |
| Tarea y jerarquía          |  20% | 8.6 | Documento completo y acciones distintas. Tareas integrales pendientes.                           |
| Calidad visual e identidad |  20% | 8.3 | Jerarquía propia del recibo; firma, reglas y colores UMI.                                        |
| Cobertura y coherencia     |  15% | 8.3 | Recibo compartido, permisos de impresión controlados y G64. G39 permanece.                       |
| Adaptación                 |  15% | 8.7 | Importes y referencia alcanzables en escalas e idiomas registrados. Recibos extensos pendientes. |
| Accesibilidad              |  15% | 8.4 | Teclas nativas, indicador y estado de foco. Voz, IME y listas largas pendientes.                 |
| Respuesta y recuperación   |  10% | 8.3 | Conserva consulta y retorno al disparador. Fallos de impresión pendientes.                       |
| Fluidez                    |   5% | 5.2 | Conserva medición anterior. No se mide el recibo ni arranque frío.                               |

Media ponderada: **8.28 → 8.3**. La auditoría conserva los hechos comerciales capturados. Sólo cambia `updated_at`; la relación con PIN es una inferencia. El AOT y las fuentes identifican la compilación aislada. TPM permanece separado. La [vista final](2026-10-08-pos-native-estacion/N20-final-preview/screen.png) ocupa sola el workspace 4. N20 no cumple 10.0.

## N21: documentos extensos y teclado desde acciones, 8.4

La [decisión](2026-10-08-pos-native-estacion/N21-decision.md) reúne investigación primaria, línea base, dos revisiones y límites. El contrato declara hasta 500 líneas. Ese máximo no garantiza que cualquier combinación máxima llegue por HTTP. La medición usa documentos locales identificados, dentro del POS nativo. No crea ventas ni pagos.

G65 reproduce construcción de todos los artículos al abrir. El documento usa un viewport acotado y una lista diferida. Conserva altura natural del recibo breve y de cada artículo. G66 reproduce PageDown sin efecto desde Cerrar. Un controlador primario explícito une contenido y acciones.

Tres aperturas por tamaño muestran una mediana del máximo de construcción de **100.316 → 3.164 ms** para 500 líneas. Los widgets de artículo al abrir pasan de 500 a seis. La muestra breve no mejora. Los tiempos no prueban memoria, inicio frío ni cuadros físicos perdidos.

La inspección nativa alcanza el final de 500 líneas y vuelve a la referencia. Incluye español, inglés, texto del sistema, 200% y horizontal. El recibo pagado de Latte conserva variante, modificador, nota e importes. Se enfoca impresión sin activarla. La suite aislada aprueba **596 pruebas**; el análisis informa cero problemas. Ocho casos nuevos comprueban alturas variables y teclado.

**G67** aparece en 812 × 375 al 200%: «Comanda» se parte dentro de la palabra. El texto está completo, pero pierde claridad. Adaptación mantiene su nota mientras esta brecha sigue abierta. G39 y las condiciones físicas permanecen.

| Criterio                   | Peso | N21 | Evidencia y límite                                                                         |
| -------------------------- | ---: | --: | ------------------------------------------------------------------------------------------ |
| Tarea y jerarquía          |  20% | 8.7 | Inicio, región final, total y referencia alcanzables. Tareas integrales pendientes.        |
| Calidad visual e identidad |  20% | 8.3 | Dirección y colores UMI conservados. La optimización no aumenta esta nota.                 |
| Cobertura y coherencia     |  15% | 8.3 | Recibo común y pruebas de permisos anteriores. G39 permanece.                              |
| Adaptación                 |  15% | 8.7 | Recibo extenso en idiomas, escalas y horizontal. G67 limita la navegación.                 |
| Accesibilidad              |  15% | 8.5 | PageDown/PageUp nativos desde acciones y referencia revelada. Voz e IME pendientes.        |
| Respuesta y recuperación   |  10% | 8.3 | Consulta y disparador conservados. Fallos de impresión pendientes.                         |
| Fluidez                    |   5% | 6.0 | Mejor costo de apertura extensa medido. Muestra pequeña; memoria e inicio frío pendientes. |

Media ponderada: **8.355 → 8.4**. G65 y G66 se cierran en su alcance comprobado. La auditoría conserva los hechos comerciales capturados. La diferencia de `updated_at` tras acceso y reinicios no tiene transacción capturada. AOT y fuentes identifican el proceso evaluado. TPM permanece separado. La [vista final](2026-10-08-pos-native-estacion/N21-final-preview/screen.png) ocupa sola el workspace 4. N21 no cumple 10.0.

## N22: etiquetas completas y revisión del retorno, 8.4

La [decisión](2026-10-08-pos-native-estacion/N22-decision.md) conserva investigación primaria, línea base y dos compilaciones. G67 reproduce una palabra partida en navegación horizontal al 200%. La navegación mide texto y constraints reales. Conserva todos los destinos cuando caben; usa el prefijo autorizado y Más cuando no caben. Una flecha comunica la apertura de opciones. La sección secundaria seleccionada sigue identificada.

La suite aislada aprueba **612 pruebas**; el análisis informa cero problemas. Dieciséis casos nuevos comprueban etiquetas, constraints locales, cuatro destinos autorizados y selección. La inspección nativa mide párrafos dibujados en ES/EN, texto del sistema y 200%, teléfono, horizontal y tablet. Escape devuelve foco a Más. End/Home y Enter eligen secciones. Espacio abre el menú desde su disparador enfocado.

**G68** demuestra que el retorno equivalente falla al desaparecer Más durante resize a rail: sección conservada, sólo panel enfocado y primer Tab en Comanda. **G69** demuestra acciones «En…», «Va…» y «Co…» en la comanda al 200%. La corrección de G67 no elimina estas brechas. Mesas, Cocina y Pedidos amplían G39 con datos de mesas y estados vacíos; no cierran tickets, pedidos, errores ni permisos nativos adicionales.

| Criterio                   | Peso | N22 | Evidencia y límite                                                          |
| -------------------------- | ---: | --: | --------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 8.7 | Destinos completos y selección. G69 y tareas integrales pendientes.         |
| Calidad visual e identidad |  20% | 8.3 | Dirección UMI y apertura señalada. No aumenta por corrección localizada.    |
| Cobertura y coherencia     |  15% | 8.3 | Estados secundarios vacíos. G39 permanece.                                  |
| Adaptación                 |  15% | 8.8 | G67 corregida en casos registrados. G69 limita acciones.                    |
| Accesibilidad              |  15% | 8.4 | Escape y selección conservan foco. G68 limita resize; voz e IME pendientes. |
| Respuesta y recuperación   |  10% | 8.3 | Datos anteriores conservados. Sin evidencia nueva de fallos de impresión.   |
| Fluidez                    |   5% | 6.0 | Medición N21 conservada. No se mide costo del nuevo layout.                 |

Media ponderada: **8.355 → 8.4**, sin aumento. La auditoría conserva los hechos comerciales; sólo cambia `updated_at`, sin transacción capturada. AOT y fuentes identifican la compilación aislada. Los artefactos históricos N21 permanecen intactos. TPM sigue separado. La [vista final](2026-10-08-pos-native-estacion/N22-final-preview/screen.png) ocupa sola el workspace vacío a pantalla completa. N22 no cumple 10.0.

## N23: identidad de foco y continuidad de teclado, 8.4

La [decisión](2026-10-08-pos-native-estacion/N23-decision.md) conserva investigación, línea base y dos compilaciones. G68 reproduce pérdida de retorno al desaparecer Más. La navegación conserva nodos e identidad de sección. El menú devuelve intención de foco, sin activar una página. Al retirar una identidad, la lista capturada se cierra y el retorno usa un destino permitido.

La primera inspección nativa abre **G70**: Enter cambia a Cocina pero borra foco. La corrección recupera el destino activado después del callback. La segunda inspección permite Enter en Cocina, Tab a Pedidos y Enter en Pedidos con foco conservado. Inglés repite el retorno y la activación. Una identidad secundaria enfocada se conserva durante colapso y expansión, mientras la sección seleccionada permanece.

La suite aislada aprueba **621 pruebas**; el análisis informa cero problemas. Hay nueve casos nuevos y un caso integral reforzado. Las 37 pruebas específicas incluyen permisos controlados y editor. La edición nativa ya conserva foco; la corrección no se atribuye ese resultado.

**G71** mide un campo de 76 px en un viewport de 28 px, 812 × 375 EN200%. La captura confirma texto recortado. G69 conserva acciones truncadas de comanda. G68 y G70 se cierran en su alcance; G39, G69 y G71 permanecen.

| Criterio                   | Peso | N23 | Evidencia y límite                                                    |
| -------------------------- | ---: | --: | --------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | 8.7 | Recorrido completo de secciones; G69 y G71 limitan tareas.            |
| Calidad visual e identidad |  20% | 8.3 | Dirección y colores UMI conservados; no cambia por propiedad de foco. |
| Cobertura y coherencia     |  15% | 8.4 | Identidad y activación integral. G39 permanece.                       |
| Adaptación                 |  15% | 8.7 | Retorno y etiquetas; G71 reduce la región útil.                       |
| Accesibilidad              |  15% | 8.6 | Intención, equivalencia y continuidad. Voz e IME pendientes.          |
| Respuesta y recuperación   |  10% | 8.3 | Datos conservados. Sin nuevas pruebas de fallos de impresión.         |
| Fluidez                    |   5% | 6.0 | Medición N21 conservada; nodos y nuevo layout sin medida.             |

Media ponderada: **8.385 → 8.4**, sin aumento de la nota publicada. AOT y fuentes identifican la compilación; la recuperación de r1 coincide con sus huellas originales. La auditoría conserva hechos comerciales, con sólo `updated_at` distinto y sin transacción capturada. TPM sigue separado. La [vista final](2026-10-08-pos-native-estacion/N23-final-preview-r2/screen.png) ocupa sola el workspace 4 a pantalla completa. N23 no cumple 10.0.

## N24 · presupuesto de lectura y acciones completas

Base N23 `20a0590`. La nota permanece en **8.4/10**, ponderada **8.435**. Se cierra G69 en verbos de comanda y G71 en buscador horizontal: campo 76 px, viewport 175 px al 200%, ES/EN. La cabecera puede desplazarse con la carta; con poco espacio, la comanda desplaza el documento y mantiene cierre fijo. Total y acciones permanecen juntos. La revisión observa G72: Nueva venta pierde su intención de foco durante resize hacia la cabecera desplazable.

Suite **628**, específicas **45**, análisis y formato sin problemas. Siete pruebas nuevas; no se cuentan correcciones de instrumento como correcciones de producto. La revisión nativa conserva total MXN 48.00 y cancela el vaciado, sin enviar ni cobrar. La [decisión](2026-10-08-pos-native-estacion/N24-decision.md), [evidencia primaria](2026-10-08-pos-native-estacion/N24-space-action-evidence.md), [manifest](2026-10-08-pos-native-estacion/N24-manifest.json) y [vista final](2026-10-08-pos-native-estacion/N24-final-preview-r2/screen.png) documentan el alcance. TPM permanece fuera. N25 debe resolver G72 y continuar G39; operadores, voz, IME, dispositivos físicos, impresión y medidas de memoria/inicio frío siguen pendientes.

## N25 · continuidad de las acciones de cabecera

Base N24 `05f9f40`. La nota acumulativa sube a **8.5/10**, ponderada **8.465**. G72 se cierra para Nueva venta, acciones y Cuenta en las composiciones, tamaños de texto e idiomas medidos. La revisión r1 revela G73: Nueva venta puede recibir Shift+Tab, pero no anuncia Focus después de ampliar texto desde Ajustes. La revisión r2 conserva una sola clase de anfitrión y recupera esa capacidad antes de cualquier tecla. No activa la acción para restaurar foco.

Suite **637**, específicas **35**, análisis sin problemas y formato de los dos archivos propios sin cambios. Nueve casos nuevos; las seis reproducciones de cabecera fallan sobre N24 y las dos de semántica sobre r1. La [decisión](2026-10-08-pos-native-estacion/N25-decision.md), [evidencia primaria](2026-10-08-pos-native-estacion/N25-focus-evidence.md), [manifest](2026-10-08-pos-native-estacion/N25-manifest.json) y [vista final](2026-10-08-pos-native-estacion/N25-r2-final-preview/screen.png) ligan observación, código, AOT y proceso. Se conservan datos; TPM permanece separado. G39 y la validación de operadores, voz, IME, escala externa, dispositivos físicos e impresión siguen pendientes. N26 debe revisar pedido entrante y ticket de cocina poblados, un rol adicional y fallo/reintento.

## N26 · tickets poblados, conteo y permisos

Revisión del 9 de octubre. Base N25 `09b039f`. Nota acumulativa **8.6/10**, ponderada **8.56**. Se revisa un pedido Web de 33000 centavos con tres líneas, variantes, notas y segundo tiempo retenido. G74 corrige el ticket al 200%; G75 distingue cantidad y conteo diario; G76 alinea los comandos con permisos; G77 reconoce la negativa KITCHEN_PERMISSION_REQUIRED. La API documenta un 403 al rol Consulta; el ticket conserva cola/versión 1. G39 se amplía, pero no se cierra.

Suite **650**, trece casos nuevos; **50 pruebas de cocina**, análisis sin problemas. La primera corrida Ahem no sirve para atribuir el desbordamiento del aviso. Se registran tres compilaciones: r2 sólo se liga, r3 es la final. Los errores de instrumento se conservan y no se puntúan. Los cambios de rol suspenden la comanda; se reanuda el Croissant original por clave de historial, sin repetir el comando cuando falla un verificador. La [decisión](2026-10-08-pos-native-estacion/N26-decision.md), [evidencia primaria](2026-10-08-pos-native-estacion/N26-reading-evidence.md), [manifest](2026-10-08-pos-native-estacion/N26-manifest.json) y [vista final](2026-10-08-pos-native-estacion/N26-r3-final-preview/screen.png) conservan procedencia y límites. N27 debe revisar adopción completa, operación autorizada, preparación con datos y el aviso persistente de conexión. TPM y las condiciones de operadores/dispositivos permanecen separados y pendientes.

## N27 · principal integrado, unidades y conexión vigente

Revisión del 9 de octubre. Base N26 `48b55f7`. Nota acumulativa **8.7/10**, ponderada **8.705**.
El usuario elige el principal como destino. La combinación de tres versiones conserva su conteo total de caja.
La auditoría conserva 22 archivos modificados ajenos al diseño. TPM permanece separado.

G78 reproduce una conexión degradada por lecturas tardías de Cocina después de salir.
La generación de seguimiento y lectura descarta esas respuestas; la repetición nativa conserva conexión en línea.
G79 pone verbos y artículo en los ajustes de inventario y dirige la configuración de preparación al panel administrativo.
G80 presenta unidades y convierte cantidades decimales a enteros exactos del contrato, sin redondear.
El ajuste, conteo y producción bloquean entradas inválidas. Inventario se comprueba con 16 artículos existentes.
G81 corrige el alcance del formulario de conteo completo, con una reproducción fallida y una prueba de envío exacto.

La suite del principal pasa **667 pruebas**, incluidos dieciséis casos nuevos propios y un caso previo adicional del principal frente a N26.
El análisis tiene cero problemas; release Linux y TypeScript de API pasan. Seis pruebas del servicio API pasan.
Las pruebas de adaptación que ya pasaban amplían cobertura y no se puntúan como arreglos.
El teclado nativo y AT-SPI comprueban una cantidad inválida y su confirmación deshabilitada al 200%.
El formulario se cancela, sin movimientos de inventario. Los dos pagos históricos y la comanda de MXN 48.00 se conservan.

La [decisión](2026-10-08-pos-native-estacion/N27-decision.md), [verificación](2026-10-08-pos-native-estacion/N27-verification.json),
[fuente y proceso](2026-10-08-pos-native-estacion/N27-main-source-binding.json) y [vista final](2026-10-08-pos-native-estacion/N27-main-r5-final-preview/screen.png)
registran implementación y límites. La ventana del principal está sola en workspace 3.
El ticket N26 ya estaba completado antes; no se atribuye esa operación a N27.
Preparación continúa vacía. G39 conserva su verificación empírica pendiente para adopción y preparación poblada.
La cobertura del código está integrada en todas las superficies; no equivale a aprobar todas las condiciones físicas.
Operadores, voz, IME, escala externa, menús durante resize, listas extensas de ventas, memoria/inicio frío y dispositivos físicos siguen pendientes.
N27 no cumple 10.0.
