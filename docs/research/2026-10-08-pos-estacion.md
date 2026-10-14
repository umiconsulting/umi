# UMI · Estación: investigación artística y propuesta de diseño para el POS

Fecha de consulta inicial: 8 de octubre de 2026. Actualización: 9 de octubre de 2026.
Estado: diseño nativo integrado en el árbol de trabajo del repositorio principal `umi`.

**Actualización nativa N27:** implementación propia sin Material ni Cupertino, integrada en el principal; **667 pruebas aprobadas**, análisis sin problemas y release Linux compilado. Nota acumulativa **8.7/10**. Conserva UMI `#223979` y `#7692CB`. Inventario muestra cantidades normales y unidades, con conversión exacta. Cocina descarta lecturas tardías después de salir. La integración conserva el conteo total de caja y 22 archivos modificados ajenos al diseño. La [vista final](2026-10-08-pos-native-estacion/N27-main-r5-final-preview/screen.png), [inventario al 200%](2026-10-08-pos-native-estacion/N27-main-r5-inventory-phone200/screen.png), [decisión N27](2026-10-08-pos-native-estacion/N27-decision.md), [verificación](2026-10-08-pos-native-estacion/N27-verification.json), [registro](2026-10-08-pos-native-iterations.md) y [plan de cierre](../plans/2026-10-09-pos-estacion-complete.md) conservan evidencia y límites. La comanda original mantiene MXN 48.00. La maqueta está sola en workspace 3, desde el principal. TPM queda separado. G39 empírica, operadores, voz, IME y dispositivos físicos siguen pendientes; no es 10.0. La maqueta HTML corresponde a la fase exploratoria anterior.

**Conclusión:** un tema propio sin Material y sin biblioteca de componentes es técnicamente viable. Recomiendo conservar Flutter y construir la capa visual con sus primitivas. La dirección propuesta combina una estación de trabajo estable, dibujos geométricos propios y un pedido con el total siempre accesible.

La investigación siguió conversaciones de artistas hasta sus obras, declaraciones y código público. Incluye fuentes en inglés, español, francés, portugués y japonés. Una muestra enlazada está en catalán. El recorrido temporal abarca obras de 1997–2003 y debates de 2017–2026.

Entrego una primera maqueta completa del alcance exploratorio y tres revisiones posteriores. El plan final conserva el ciclo de observación, crítica, nueva investigación y corrección hasta cumplir el criterio de 10.0. La puntuación de preparación de aquella maqueta HTML fue **7.6/10**. Esa nota no se transfiere al producto nativo. Las pruebas con operadores siguen pendientes.

## 1. Archivos y alcance

- [Maqueta interactiva](2026-10-08-pos-estacion/index.html). Abre el archivo en un navegador. Funciona sin instalación y sin recursos externos.
- [Venta en 1024 × 768](2026-10-08-pos-estacion/evidence/v4/sell-1024.png).
- [Venta en 390 × 844](2026-10-08-pos-estacion/evidence/v4/sell-390.png).
- [Mesas](2026-10-08-pos-estacion/evidence/v4/tables-1024.png) y [caja](2026-10-08-pos-estacion/evidence/v4/cash-1024.png).
- [Inspección final reproducible](2026-10-08-pos-estacion/evidence/v4/inspection.json).
- [Registro de 16 documentos primarios](2026-10-08-pos-estacion/evidence/sources/receipts.json), con URL, tamaño, archivo recuperado y SHA-256.

La maqueta contiene catálogo, búsqueda, categorías, cantidades, notas, pedidos guardados, mesas, caja, pago y recuperación de un resultado incierto. Incluye aspecto claro, aspecto oscuro y movimiento reducido. Los importes y las operaciones son de muestra. La maqueta no se conecta a la API ni procesa dinero.

“Sin biblioteca” significa aquí **sin biblioteca de componentes o lenguaje visual prefabricado**. La implementación nativa conserva Flutter como SDK. El producto actual también necesita sus dependencias de almacenamiento, conectividad y contratos.

Esta entrega estudia una dirección de diseño. La maqueta web sirve para examinar composición e interacción. Las instrucciones del proyecto establecen que la evidencia del POS real debe venir de la aplicación nativa.

## 2. Método y límites de la evidencia

Uso cuatro etiquetas:

| Etiqueta | Significado                                                                      |
| -------- | -------------------------------------------------------------------------------- |
| **HD**   | Hecho documentado por la fuente que lo posee.                                    |
| **OV**   | Observación visual de una captura o interacción realizada en esta investigación. |
| **I**    | Inferencia o decisión de diseño; admite crítica.                                 |
| **NV**   | No verificado. No cuenta como resultado demostrado.                              |

Un comentario de un artista prueba su intención o su experiencia declarada. No prueba la eficacia de un POS. Una captura prueba una composición en un momento y tamaño. No prueba toda la interacción de una obra.

Separé la fecha de creación, la publicación del hilo, la edición y la recuperación del archivo. El día del rastreo del buscador no determina la antigüedad de una obra. Cuando una fuente sólo indica un año, conservo ese año. Cuando no indica fecha, uso `s/f`.

La selección favorece relaciones rastreables y casos que contradicen la dirección propuesta. Incluye comunidades pequeñas, obras experimentales, documentación oficial y crítica directa. “Underground” describe el recorrido fuera de las galerías comerciales de tendencias; no atribuyo esa identidad a todos los autores.

### Instrumentos

| Instrumento                     | Versión observada             | Uso y fundamento                                                                                                  |
| ------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Búsqueda web                    | Servicio; versión no expuesta | Descubrimiento multilingüe y lectura de fuentes primarias.                                                        |
| curl                            | 8.22.0                        | Recuperación de HTML público y JSON cuando falla la extracción.                                                   |
| Python                          | 3.14.7                        | Lectura de JSON, inventario del código y comprobación de archivos.                                                |
| Flutter / Dart                  | 3.47.5 / 3.13.4               | SDK instalado; viabilidad local, no medición de una nueva UI nativa.                                              |
| Playwright                      | 1.62.1                        | Clics, foco, capturas y medidas en el navegador real. [Documentación oficial](https://playwright.dev/docs/intro). |
| Chromium                        | 153.0.8010.52                 | Motor instalado utilizado en las cuatro revisiones.                                                               |
| axe-core / adaptador Playwright | 4.13.0 / 4.13.0               | Comprobaciones automáticas de accesibilidad. [Repositorio oficial](https://github.com/dequelabs/axe-core).        |

**HD.** Flutter usa licencia BSD; Playwright usa Apache-2.0; axe-core usa MPL-2.0. Las versiones provienen de los ejecutables o paquetes locales. Los instrumentos de revisión ya estaban instalados. No se añadió una dependencia a la maqueta. [Flutter](https://docs.flutter.dev/resources/architectural-overview), [Playwright](https://github.com/microsoft/playwright/blob/main/LICENSE), [axe-core](https://github.com/dequelabs/axe-core/blob/develop/LICENSE).

**I.** HTML, CSS y SVG propios son adecuados para una maqueta portable. La elección también cumple la petición de evitar una biblioteca visual. Playwright resuelve la inspección; no se construyó un motor de pruebas ni un navegador propio.

## 3. El recorrido: foro → autor → obra → decisión

### Rama A: MelonLand y Asatte

**HD.** Stephan E Perez presenta Asatte en MelonLand el **2026-09-05**. Su respuesta del **2026-09-22** enlaza un artículo sobre los primeros artistas. Ese artículo permite seguir cuatro obras originales. [Hilo de Asatte](https://forum.melonland.net/index.php?topic=6002.0), [primer mes](https://asatte.io/news/20260922/asattes_first_month).

```text
MelonLand / Asatte, septiembre 2026
└── Asatte's first month
    ├── Melon → Crow Island → mundo del autor
    ├── lycheecreature → Cosmology Map → obra en Neocities
    ├── Marziponder / AmbienceAntarctica → hilo propio → obra
    └── Miaki / Meerkat-girl → Human Facsimile → archivo japonés
```

| Autor y fuente primaria                                                                                                                                                                                                     | Fecha y evidencia                                                                                                                                   | Transferencia propuesta al POS                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Melon: [ficha de Crow Island](https://asatte.io/melon/island), [obra](https://melonking.net/vr/?world=island), [manifiesto](https://melonking.net/thoughts/manifesto)                                                       | **HD:** la ficha declara 2017-01-01; ese día exacto no tiene validación independiente. El manifiesto está fechado 2021-11-22 y editado 2022-12-22.  | **I:** identidad de un lugar propio; zonas de trabajo estables. El rechazo artístico a la uniformidad no justifica inconsistencias al cobrar. |
| lycheecreature: [ficha](https://asatte.io/lycheecreature/cosmology_map), [Cosmology Map](https://lycheecreature.neocities.org/asa/world/)                                                                                   | **HD:** la autora declara junio de 2026. El HTML reconoce una restricción de la portada en vertical y ofrece enlaces alternativos.                  | **I:** detalles por capas. Todas las tareas del POS deben conservar un camino directo en móvil.                                               |
| Marziponder: [hilo propio](https://forum.melonland.net/index.php?topic=4985.0), [Ambience Antarctica](https://www.ambienceantarctica.com/), [ficha](https://asatte.io/AmbienceAntarctica/ambience_antarctica)               | **HD:** anuncio 2025-11-21. Un usuario reporta videos que no cargan; el 2025-11-22 la autora declara una recompresión.                              | **I:** la atmósfera puede depender de datos y conservar continuidad. El POS debe mostrar la información sin esperar una rotación ambiental.   |
| Miaki / Meerkat-girl y Hiroshi Murakami: [ficha](https://asatte.io/miaki/human_facsimile), [archivo original HamTama](https://www.hamtama.tokyo/ja/archive/2021/hiroshi-murakami-meerkat-girl-collaboration-performance000) | **HD:** el original y sus créditos indican 2021-06-20. Asatte registra 2021-01-20 en un campo; su declaración dice junio. Conservo la discrepancia. | **I:** cada acción necesita una respuesta comprensible. Añadir, enviar y cobrar deben producir confirmaciones distintas.                      |

**OV.** Cosmology Map presenta una composición circular, objetos de colores y enlaces distribuidos en un espacio oscuro. La captura confirma una identidad fuerte. No demuestra una tarea rápida. [Captura](2026-10-08-pos-estacion/evidence/v3/reference-lychee-cosmology.png).

**OV.** Orbit Oasis presenta una portada con motivos, tipografía y color muy específicos. La propia portada dice que el sitio no es completamente responsive. La fecha de creación de esa portada queda `s/f`. [Obra](https://orbitoasis.net/), [captura](2026-10-08-pos-estacion/evidence/v3/reference-orbitoasis.png).

**I.** Esa rama aporta pertenencia, profundidad y cuidado del detalle. El diseño operativo transforma esos mecanismos: navegación explícita, jerarquía estable y ausencia de espera decorativa.

### Rama B: un debate de 2024 abre otra red artística

**HD.** El hilo “for the webmaster who doesn't want offbeat design” comienza el **2024-04-04**. Discute la presión de hacer una web llamativa. En su respuesta, Melooon enlaza directamente la tercera edición de The HTML Review. [Hilo y respuesta](https://forum.melonland.net/index.php?topic=2742.0).

```text
MelonLand, abril 2024
└── respuesta de Melooon → The HTML Review 03
    ├── archivo → edición 01, primavera 2022
    │   ├── Shelby Wilson → A Room with a Window
    │   └── Nick Montfort → Progress
    ├── Garry Ing → A View Source Web, primavera 2024
    └── archivo → edición 05, primavera 2026
        ├── Raphaël Bastide → Carecore → declaración del proceso
        └── Christopher Shank → Cursor Park → créditos y propósito
```

**HD.** La [carta editorial de 2022](https://thehtml.review/01/a-letter-from-the-editor) identifica a Shelby Wilson como directora artística. Describe literatura concebida para la web. La [edición 01](https://thehtml.review/01/) enlaza las obras y sus autores.

**OV.** La portada de 2022 usa azul, blanco, ventanas y persianas. La edición de 2024 cambia a texto inclinado, organización circular y una composición clara rosada. Una misma comunidad admite resultados muy diferentes. [Captura 2022](2026-10-08-pos-estacion/evidence/v3/reference-html-review-2022.png), [edición 2024](https://thehtml.review/03/), [captura 2024](2026-10-08-pos-estacion/evidence/v3/reference-html-review-2024.png).

| Obra o declaración                                                                                                | Lo que permite afirmar                                                                                                                                                | Decisión de diseño                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Shelby Wilson, [A Room with a Window](https://shelby.cool/a-room-with-a-window/), publicada en la edición de 2022 | **OV:** ventana, persiana y luz componen una escena coherente. No probé todos sus gestos. [Captura](2026-10-08-pos-estacion/evidence/v3/reference-window-shelby.png). | **I:** la continuidad entre estado y respuesta puede dar personalidad. Mantener esa continuidad al abrir un pedido o cerrar una nota.      |
| Nick Montfort, [Progress](https://thehtml.review/01/progress), 2022                                               | **HD:** el índice explica una obra computacional y documenta problemas de cobertura de glifos.                                                                        | **I:** verificar los caracteres en cada plataforma. La tipografía expresiva no debe comprometer importes o etiquetas.                      |
| Garry Ing, [A View Source Web](https://viewsource.info/), primavera 2024                                          | **HD:** el autor describe su relación con HyperCard, HTML y la posibilidad de examinar el código.                                                                     | **I:** mantener el sistema propio pequeño, inspeccionable y explicable. La transparencia técnica pertenece al desarrollo y a Diagnósticos. |
| Raphaël Bastide, [Carecore](https://raphaelbastide.com/carecore/), edición 05, primavera 2026                     | **HD:** describe cómo una aplicación generada convirtió una idea particular en una interfaz que percibió como genérica. El relato es del artista.                     | **I:** exigir decisiones específicas del POS. Revisar qué detalle podría trasladarse a cualquier otra aplicación sin cambiar su sentido.   |
| Christopher Shank, [Cursor Park](https://cursors.place/), edición 05, primavera 2026                              | **HD:** el autor documenta un espacio de refugio y presencia compartida; incluye créditos y relación con la revista.                                                  | **I:** admitir un ritmo tranquilo. Reservar la urgencia visual para una situación operativa que la requiera.                               |

**OV.** La captura de Carecore muestra una escena vegetal con controles y mensajes en sus bordes. El carácter depende de esa actividad concreta. No afirma que esos controles sean adecuados para una caja. [Captura](2026-10-08-pos-estacion/evidence/v3/reference-carecore-2026.png).

### Rama C: español y catalán, con crítica que produce una corrección

**HD.** Marcel Costa presenta tarjetas de contacto con HTML y CSS el **2024-01-04**. Enlaza variantes clara y oscura. Separa las reglas generales de los colores del tema. La tarjeta recuperada tiene contenido en catalán. [Hilo](https://forum.anartist.org/t/tarjeta-de-contacto-con-html-y-css-puro/981), [clara](https://tarja.anartist.org/marcelcosta/), [oscura](https://tarja.anartist.org/marcelcosta-dark/).

**HD.** Chinicuil presenta el rediseño de Anartist el **2025-12-08**. El **2025-12-11**, ayman señala texto ilegible sobre ciertos fondos. El **2025-12-12**, Chinicuil acepta aumentar el contraste. El **2025-12-22** enlaza una guía de estilos. [Conversación original](https://forum.anartist.org/t/re-branding-anartist/1597), [guía](https://anartist.org/estilos/).

**I.** Esta es una secuencia verificable de propuesta, crítica y corrección. La simpatía por una estética no resuelve la legibilidad. El sistema propio necesita tokens comunes y pruebas de cada estado.

### Rama D: ritmo, dato y gesto en francés, portugués y español

| Fuente primaria                                                                                                                                                                                                                 | Fecha y contenido documentado                                                                                                                               | Transferencia al POS                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Ana María Uribe: [entrevista en varios idiomas](https://vispo.com/uribe/interview/), [correo de la autora](https://www.vispo.com/uribe/datos/aboutAnaMariaEnglish.htm), [Anipoemas](https://www.vispo.com/uribe/anipoemas.html) | **HD:** obras del índice 1997–2003; correo 2003-03-20. Fecha de la entrevista: `s/f`. La autora relaciona tipografía, ritmo y secuencias breves.            | **I:** personalidad a través de la organización de texto y cifras; movimiento ligado a un cambio.                                |
| Julien Levesque: [Street Views Patchwork](https://julienlevesque.net/street-views-patchwork) y [Little Umbrella](https://julienlevesque.net/little-umbrella)                                                                    | **HD:** fichas del autor fechadas 2009 y 2013. La segunda convierte un dato meteorológico en apertura o cierre de un objeto. Funcionamiento actual: **NV**. | **I:** una relación legible entre dato y respuesta. Un cambio de estado debe comunicar qué sucedió.                              |
| Fabio FON: [Três categorias da web arte](https://www.fabiofon.com/webartenobrasil/texto_3categorias.html)                                                                                                                       | **HD:** texto propio de 2000. Distingue mecanismos metalingüísticos, narrativos y participativos. Es un marco artístico.                                    | **I:** escoger una relación con la persona antes de escoger efectos. La tarea mantiene el significado conocido de los controles. |
| Albertine Meunier y Olivain Porry: [Slop Machine](https://albertinemeunier.net/slop-machine)                                                                                                                                    | **HD:** declaración y créditos de 2025; reflexión artística sobre saturación artificial.                                                                    | **I:** juzgar la acumulación de efectos por su propósito. Un recurso aislado no prueba por sí solo que un diseño sea “slop”.     |

### Rama E: Low-tech, con una revisión cinco años después

**HD.** Kris De Decker, Marie Otsuka y Roel Roscam Abbing publican sus decisiones de diseño el **2018-09-24**. La identidad utiliza tipografía y un signo; las imágenes tienen un tratamiento limitado. La documentación propia explica el proceso. [Artículo original](https://solar.lowtechmagazine.com/2018/09/how-to-build-a-low-tech-website/), [documentación del diseño](https://github.com/lowtechmag/solar/wiki/Solar-Web-Design).

**HD.** La [revisión de junio de 2023](https://solar.lowtechmagazine.com/2023/06/rebuilding-a-solar-powered-website/) permite revelar las imágenes originales. Esa continuidad muestra una decisión revisable, no una estética congelada.

**OV.** La página observada conserva grandes imágenes tramadas, estructura editorial y una indicación de batería. La captura de hoy no representa necesariamente cada detalle del sitio de 2018. [Captura actual](2026-10-08-pos-estacion/evidence/v3/reference-lowtech-2018.png).

**I.** Para Umi, el dibujo y la tipografía pueden sostener una identidad sin grandes recursos externos. La limitación de medios debe favorecer la lectura. No se infiere una reducción de memoria del POS a partir de este sitio.

## 4. Lo que los foros permiten concluir

| Conversación                                                                                          | Fecha         | Lectura de la evidencia                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [UX brutalism, Hacker News](https://news.ycombinator.com/item?id=14986869)                            | 2017-08-11    | Opiniones contrapuestas sobre material visible, expresión y usabilidad. La etiqueta estética no produce consenso.                |
| [MelonLand: presión de ser diferente](https://forum.melonland.net/index.php?topic=2742.0)             | 2024-04-04    | Testimonios de autores sobre decoración y propósito. Ofrece un enlace real hacia otra comunidad artística.                       |
| [Anartist: HTML/CSS propio](https://forum.anartist.org/t/tarjeta-de-contacto-con-html-y-css-puro/981) | 2024-01-04    | El autor publica código y ejemplos; prueba una solución pequeña para su alcance.                                                 |
| [Design Arena, Hacker News](https://news.ycombinator.com/item?id=44878257)                            | 2025-08-12    | Su creadora explica comparaciones de estética por votación. Los comentarios cuestionan fórmulas repetidas y etiquetas de estilo. |
| [Anartist: contraste](https://forum.anartist.org/t/re-branding-anartist/1597)                         | 2025-12-08–22 | Una crítica identifica una brecha y la autora acepta una corrección.                                                             |
| [Asatte en MelonLand](https://forum.melonland.net/index.php?topic=6002.0)                             | 2026-09-05–22 | Conversación con autores y enlaces a sus obras. Permite verificar procedencia y discrepancias.                                   |

**I.** Ninguno de esos hilos prueba qué tema prefiere un cajero de Umi. Sí permiten establecer un método: seguir autores, estudiar mecanismos y comprobar las consecuencias. Una votación de belleza no sustituye una prueba de operación.

## 5. Viabilidad en el proyecto disponible

### Hechos locales

El cliente es Flutter nativo. El [pubspec](../../apps/umi-pos/pubspec.yaml) declara sus dependencias. El tema importaba Material al comenzar esta investigación. El [tema integrado](../../apps/umi-pos/lib/core/theme/umi_theme.dart) ahora usa primitivas propias; la evidencia de retirada pertenece a N1 y sus revisiones. El [lenguaje de diseño](../design/UMIPOS_DESIGN_LANGUAGE_V1.md) conserva reglas relevantes para la operación.

**HD.** El inventario del 2026-10-08 encontró 108 archivos Dart y 24 importaciones directas de `flutter/material.dart`: 18 en funciones, cuatro en componentes compartidos, una en la aplicación y una en el tema.

El conteo literal también encontró 50 referencias a `showDialog`, 46 a `AlertDialog(`, 44 a `TextField(` y 210 a `Theme.of`. Son coincidencias de texto, no un inventario de todos los controles. Por ejemplo, un conteo de `FilledButton(` no incluye necesariamente `FilledButton.icon(`.

**HD.** Flutter separa sus capas de motor, renderizado, composición y componentes. Material y Cupertino implementan lenguajes visuales sobre esa base. [Arquitectura oficial](https://docs.flutter.dev/resources/architectural-overview).

**I.** Por eso, retirar Material no exige reemplazar el motor ni los contratos. El trabajo consiste en reemplazar componentes, temas y comportamiento de presentación. No es un simple cambio de colores. Tampoco demuestra, por sí solo, una mejora grande de memoria o velocidad.

### Qué construir y qué reutilizar

| Necesidad           | Base oficial                                                                                                                                       | Responsabilidad del sistema propio                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Aplicación y rutas  | [WidgetsApp](https://api.flutter.dev/flutter/widgets/WidgetsApp-class.html)                                                                        | Tema propio, transiciones, títulos y composición.                 |
| Botón e interacción | [FocusableActionDetector](https://api.flutter.dev/flutter/widgets/FocusableActionDetector-class.html), gestos y acciones                           | Estados visible, pulsado, seleccionado, deshabilitado y enfocado. |
| Accesibilidad       | [Semantics](https://api.flutter.dev/flutter/widgets/Semantics-class.html)                                                                          | Nombre, rol, estado, valor y anuncio comprensible.                |
| Entrada de texto    | [EditableText](https://api.flutter.dev/flutter/widgets/EditableText-class.html)                                                                    | Decoración, error, selección, teclado, portapapeles y contexto.   |
| Diálogo             | [RawDialogRoute](https://api.flutter.dev/flutter/widgets/RawDialogRoute-class.html)                                                                | Foco inicial, retorno de foco, cierre permitido y presentación.   |
| Diseño responsive   | [LayoutBuilder](https://api.flutter.dev/flutter/widgets/LayoutBuilder-class.html), [guía oficial](https://docs.flutter.dev/ui/adaptive-responsive) | Adaptación a espacio disponible, tamaño de texto e input.         |
| Dibujo propio       | [CustomPainter](https://api.flutter.dev/flutter/rendering/CustomPainter-class.html)                                                                | Ilustraciones y mapas; semántica separada para controles.         |

**I.** La dificultad principal está en campos, menús, diálogos y accesibilidad. Un botón que cambia de color cuesta poco. Un campo correcto con IME, selección y lector de pantalla exige más cuidado.

Recomiendo componentes propios dentro de `apps/umi-pos`, con tokens compartidos mediante un tema heredado. Los controladores y contratos existentes siguen siendo la base del comportamiento. El mapa puede usar dibujo propio; los controles deben conservar estructura y semántica.

La primera estimación de esfuerzo quedó **NV**. N1–N27 construyen la capa visual y comprueban recorridos nativos, cobros, documentos y recuperación. El [inventario final](../plans/2026-10-09-pos-estacion-complete.md) registra todas las superficies integradas y sus límites de validación. No se extrapola este trabajo a una cifra de esfuerzo para otros proyectos.

## 6. Dirección propuesta: UMI · Estación

**I.** El concepto es una estación de trabajo reconocible durante un turno. La personalidad aparece en la geometría, el ritmo de los números, las ilustraciones y las relaciones entre áreas. Las acciones conservan nombres directos.

La síntesis es propia de esta propuesta. No copié una pantalla de un artista ni reutilicé sus imágenes como recursos del POS. “Originalidad absoluta frente a toda interfaz existente” queda **NV**. Es una síntesis trazable, abierta a crítica.

### Gramática visual

La tabla conserva la propuesta de la maqueta HTML. El nativo desarrolla esa dirección con tipografía local IBM Plex Sans y Bricolage Grotesque.
Las [licencias y procedencia](../../apps/umi-pos/assets/fonts/provenance.json) acompañan los archivos integrados.
Los nombres y los importes siguen siendo texto; los dibujos no sustituyen su significado.

| Elemento      | Decisión                                             | Razón                                                                      |
| ------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| Superficies   | Fondo mineral claro y paneles opacos                 | Mantener lectura y separación sin depender de lo que esté detrás.          |
| Tinta         | Oscura, con contraste estable                        | El texto y los importes conservan prioridad.                               |
| Acento        | Azul preciso para selección y acción                 | Una señal consistente; el estado también tiene texto.                      |
| Motivo propio | Dibujos geométricos de la colección del café         | Ayudar al reconocimiento y dar continuidad al catálogo.                    |
| Composición   | Catálogo de un lado; pedido y total del otro         | Mantener el contexto durante la operación.                                 |
| Separadores   | Líneas suaves; una regla discontinua para el resumen | Distinguir productos de las cuentas sin rodear cada dato con otra tarjeta. |
| Tipografía    | Sans del sistema; cifras tabulares para dinero       | Jerarquía legible sin una descarga adicional en la maqueta.                |
| Movimiento    | Respuesta breve y causal                             | Confirmar una acción sin introducir una espera.                            |

Los símbolos de producto son SVG propios. El POS nativo puede dibujarlos con `CustomPainter` o recursos vectoriales del proyecto. El trazo no reemplaza el nombre del producto. Productos parecidos requieren variantes más claras o una imagen real cuando el catálogo lo justifique.

### Tokens iniciales

| Token            | Claro                     | Oscuro                      |
| ---------------- | ------------------------- | --------------------------- |
| Fondo            | `#F5F6F8`                 | `#141B24`                   |
| Panel            | `#FFFFFF`                 | `#1D2632`                   |
| Texto principal  | `#17212D`                 | `#EDF1F7`                   |
| Texto secundario | `#566473`                 | `#B0BCCB`                   |
| Línea            | `#D0D7E0`                 | `#566374`                   |
| Acción           | `#245BD6`                 | `#9ABAFF`, con texto oscuro |
| Selección suave  | `#E9EFFF`                 | `#283C5B`                   |
| Atención         | `#805100` sobre `#FFF2D8` | `#FFD38A` sobre `#3F311C`   |
| Error            | `#B02B2B` sobre `#FFEDED` | `#FFA9A9` sobre `#43282C`   |

Esta tabla conserva los tokens de la primera maqueta HTML. El usuario fijó después los colores UMI como condición. Desde N11, el POS nativo usa azul marino `#223979`, azul `#7692CB`, fondo mineral `#F3F2EE` y tinta `#131F44`. La implementación integrada conserva esa decisión. La propuesta inicial de acento `#245BD6` no define la marca final.

Los controles mantienen el piso del proyecto: 48 × 48 píxeles lógicos. La acción principal mide al menos 52 píxeles de alto. La maqueta usa 56 para revisar el cobro. Los radios parten de 14 para controles y 20 para áreas de tarea; admiten una variación limitada en dibujos y producto.

El texto operativo del producto debe partir de 15–16 píxeles y soportar aumento. Los rótulos de 12 píxeles de la maqueta corresponden a información secundaria. Hace falta comprobarlos en la tablet real, con iluminación y distancia de uso.

### Apple como referencia acotada

**HD.** Apple recomienda movimiento con propósito, breve, opcional y coherente con el gesto. Su documentación también pide conservar el contexto al adaptar una interfaz. [Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles).

**I.** Esos principios encajan con Umi. La propuesta usa esa claridad temporal y espacial. La apariencia depende del catálogo, del pedido y de sus estados. Las superficies opacas facilitan una base de contraste conocida.

### Criterio contra lo recargado y lo intercambiable

Para cada detalle, registrar cuatro respuestas:

1. ¿Qué tarea, estado o rasgo del café explica este detalle?
2. ¿Qué pierde la persona si se elimina?
3. ¿El detalle compite con un importe, una decisión o un error?
4. ¿Su repetición durante 200 pedidos todavía resulta cómoda?

**I.** Un detalle sólo ornamental puede existir en un lugar limitado, si no interfiere. Un conjunto de efectos sin relación entre sí debilita la identidad. Los fondos, las sombras y los dibujos se revisan con ese criterio, no por pertenecer a una tendencia.

## 7. Responsive e interacción

La tabla describe la maqueta HTML inicial. Sus cortes no proceden de un estándar universal.
El nativo N11–N27 calcula la composición con el espacio disponible, las etiquetas y el tamaño de texto.
La cantidad de columnas puede cambiar dentro de una misma clase de dispositivo.
El [plan final](../plans/2026-10-09-pos-estacion-complete.md) identifica los tamaños nativos comprobados y los límites.

| Espacio     | Distribución actual                                           | Tarea que debe mantenerse                                            |
| ----------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| ≥1440 px    | Navegación lateral; cuatro columnas; pedido lateral de 380 px | Leer catálogo, cantidades y total al mismo tiempo.                   |
| 821–1439 px | Navegación lateral; tres columnas; pedido de 310 px           | El cobro queda visible; la lista de productos admite desplazamiento. |
| 561–820 px  | Navegación lateral compacta; catálogo; barra de pedido        | Acceder al pedido sin perder el catálogo.                            |
| 320–560 px  | Dos columnas; navegación inferior; pedido en diálogo          | Terminar las mismas tareas sin reducir las áreas táctiles.           |

El pedido conserva el total durante el desplazamiento de sus líneas. En móvil, una barra muestra cantidad y total. La barra sólo aparece en Venta. El foco del catálogo se desplaza a una posición visible cuando podría quedar detrás de la barra.

### Respuesta a una acción

| Acción             | Respuesta propuesta                              | Restricción                                                        |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------ |
| Añadir producto    | Cantidad, total y mensaje dentro del pedido      | No abrir una notificación flotante sobre otro control.             |
| Editar nota        | Diálogo con el producto y retorno de foco        | La nota de muestra no cambia el precio.                            |
| Revisar cobro      | Total, método, importe recibido y decisión final | Revisar no debe registrar dinero.                                  |
| Cobrar             | Estado de proceso y bloqueo de duplicado         | El POS real depende del resultado de la API.                       |
| Resultado incierto | Referencia y camino de verificación              | No ofrecer repetir el cobro mientras el resultado sea desconocido. |
| Venta completa     | Importe, método, cambio definitivo y referencia  | El fallo de impresión conserva un estado físico separado.          |
| Sin conexión       | Estado persistente y requisitos de las acciones  | Las opciones reales dependen de la política de la sucursal.        |

Las duraciones iniciales del producto pueden partir de sus tokens actuales: 120 ms y 220 ms. Son decisiones revisables. La maqueta elimina sus transformaciones y transiciones bajo movimiento reducido. No añade sonido automático.

## 8. Accesibilidad: requisitos y evidencia

**HD.** WCAG 2.2 AA define el criterio de tamaño mínimo de objetivo con 24 × 24 CSS px y excepciones de separación. Umi tiene un requisito propio más estricto: 48 × 48 píxeles lógicos. No son la misma unidad ni el mismo umbral. [W3C: tamaño mínimo](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

**HD.** W3C fija 4.5:1 para texto normal y 3:1 para texto grande, con sus condiciones. También establece criterios de reflow, foco no oculto y control del movimiento. [Contraste](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [foco](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html), [movimiento](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).

**OV.** La revisión final no detectó desbordamiento horizontal en las 15 combinaciones de tres áreas y cinco tamaños. No encontró controles medidos menores de 48 px en las 17 muestras registradas. axe-core no reportó infracciones en las vistas de la matriz, el pago probado o el aspecto oscuro probado.

Esas mediciones pertenecen a Chromium y a esta maqueta. No certifican conformidad completa. Las pruebas de lector de pantalla, texto aumentado, IME, plataforma nativa y uso táctil real siguen **NV**.

## 9. Historial de crítica e iteración

### Regla de puntuación

El **1.0** inicial registra una propuesta sin artefacto. No es una nota del POS existente. Después de la primera versión completa, cada nota se calcula con los mismos criterios. La falta de evidencia nativa y de operadores pesa en el resultado.

Los números de gusto son juicios del investigador. Los resultados de controles y flujos tienen registros verificables. Ninguna décima implica precisión científica sobre belleza.

| Criterio                       |     Peso |      V1 |      V2 |      V3 |      V4 |
| ------------------------------ | -------: | ------: | ------: | ------: | ------: |
| Identidad y síntesis propia    |      10% |     7.0 |     7.5 |     8.0 |     8.0 |
| Elegancia y moderación         |      10% |     7.0 |     8.0 |     8.5 |     8.5 |
| Jerarquía y densidad operativa |      15% |     5.0 |     8.0 |     8.0 |     9.0 |
| Adaptación a tamaños           |      15% |     6.0 |     9.0 |     9.0 |     9.0 |
| Estados de pago y recuperación |      10% |     8.0 |     8.0 |     8.5 |     8.5 |
| Accesibilidad y foco           |      10% |     6.0 |     8.0 |     9.0 |     9.0 |
| Movimiento con propósito       |       5% |     9.0 |     9.0 |     9.0 |     9.0 |
| Consistencia                   |       5% |     7.0 |     8.0 |     8.5 |     8.5 |
| Implementación y prueba nativa |      10% |     5.0 |     5.0 |     5.0 |     5.0 |
| Prueba con operadores          |      10% |     1.0 |     1.0 |     1.0 |     1.0 |
| **Total ponderado**            | **100%** | **5.9** | **7.2** | **7.4** | **7.6** |

La categoría nativa recibe 5 por su fundamento técnico y el inventario local, no por una implementación terminada. La categoría de operadores conserva 1 por ausencia de pruebas. Esta penalización hace visible lo que falta para una decisión de producto.

### V1: primera versión completa del estudio, en una entrega

La primera escritura incluyó las tres áreas, el flujo completo de cobro simulado, variantes de estado y comportamiento responsive. Se guardó sin ajustes posteriores como [V1](2026-10-08-pos-estacion/evidence/v1/prototype.html).

**OV.** La captura en 1024 × 768 muestra el cobro debajo del área visible. El filtro “Té” mide 43.66 px de ancho en móvil. El control desplegable de recuperación mide 21.75 px de alto. [Inspección V1](2026-10-08-pos-estacion/evidence/v1/inspection.json).

**Crítica:** demasiada altura dedicada al catálogo y al encabezado; el total pierde acceso. Las ilustraciones son coherentes, pero la densidad todavía no sirve al panel objetivo.

**Cambio indicado:** fijar una región útil para el pedido; conservar 48 px también en filtros y desplegables. La lección de Anartist sobre contraste se amplía aquí a geometría: el agrado visual no elimina un defecto operativo.

### V2: total visible y objetivos completos

Se limitaron las áreas de desplazamiento; se fijó el resumen; se aumentaron los objetivos pequeños. Se explicitó Venta en el encabezado. Se guardó [V2](2026-10-08-pos-estacion/evidence/v2/prototype.html).

**OV.** El cobro queda visible. Todas las muestras medidas cumplen 48 px. La revisión automática no reporta infracciones. Sin embargo, la lista del pedido dispone de poco espacio: sólo se ve una línea completa al inicio. [Inspección V2](2026-10-08-pos-estacion/evidence/v2/inspection.json).

**Crítica:** el total mejoró, pero el pedido quedó comprimido. La solución necesita conservar contexto de los artículos, no sólo el botón final.

**Nueva investigación:** el enlace de MelonLand conduce a The HTML Review 03 y a su archivo. La edición 05 permite llegar a Carecore. Su declaración da un criterio específico para revisar la identidad de la interfaz.

### V3: pedido junto al encabezado y foco conservado

Se movió el pedido al lado del encabezado. Se mejoró el retorno de foco después de una nota, el recorrido con teclado y la secuencia de referencias. Se guardó [V3](2026-10-08-pos-estacion/evidence/v3/prototype.html).

**OV.** La captura muestra el pedido más arriba. Sin embargo, el orden de dos bloques CSS conserva una altura de la revisión anterior. La composición sigue mostrando una sola línea completa. La medida del botón final pasa, pero la captura revela la brecha. [Inspección V3](2026-10-08-pos-estacion/evidence/v3/inspection.json).

**Crítica:** un resultado automático favorable no prueba toda la composición. El orden de estilos impide que el cambio espacial consiga su propósito.

### V4: corrección de la altura efectiva

Se corrigió el orden de estilos. Se mantuvo el resto de las correcciones. Se guardó [V4](2026-10-08-pos-estacion/evidence/v4/prototype.html).

**OV. Resultado comprobado:** dos líneas iniciales del pedido visibles, total y acción accesibles en 1024 × 768. La captura final confirma la corrección de la altura. La lista tiene desplazamiento propio; falta examinar el contexto operativo de un pedido de 20 líneas. El registro final conserva capturas y SHA-256. [Inspección V4](2026-10-08-pos-estacion/evidence/v4/inspection.json), [captura V4](2026-10-08-pos-estacion/evidence/v4/sell-1024.png).

### Registro técnico del instrumento

El primer intento de axe-core exigió crear un contexto explícito de navegador. Se corrigió antes de obtener la matriz. Ese fallo queda en [el registro del instrumento](2026-10-08-pos-estacion/evidence/harness-first-attempt.json).

V1 registra además un error de JavaScript sin URL de origen. El instrumento compartía el registro de errores con las referencias externas; no permite atribuir ese error a una página concreta. V2 separó los errores del archivo local de los errores de las obras. V2, V3 y V4 no registraron errores de JavaScript de la maqueta.

## 10. Plan para completar la dirección y llegar al criterio de 10.0

### Fase 1: inventario de superficies y estados

Registrar las rutas actuales, los controles, los permisos, los estados de carga y las decisiones terminales. Usar el código y los flujos existentes como fuente. Incluir acceso, venta, mesas, preparación, pagos, caja, devoluciones, recuperación, hardware y las funciones disponibles por rol.

**Salida:** una matriz de cobertura. Cada superficie tendrá sus estados necesarios y sus datos. Toda ausencia tendrá un motivo registrado.

### Fase 2: sistema visual propio

Implementar tokens y componentes nativos: botón, selector, campo, error, aviso, diálogo, navegación, lista, dinero y fila de pedido. Mantener geometría separada de color. Examinar estados claro, oscuro, seleccionado, deshabilitado y enfocado.

Comprobar selección de texto, pegado, teclado móvil y lector de pantalla desde el primer campo. Los dibujos tienen una capa independiente de la semántica operativa.

**Salida:** un conjunto pequeño de componentes que cubre el inventario. Un control nuevo necesita un motivo, no sólo una apariencia distinta.

### Fase 3: primera versión nativa entera, en una entrega

Construir toda la cobertura acordada antes de iniciar la crítica estética. La primera versión incluye navegación, datos del contrato, estados vacíos, proceso, éxito, fallo y recuperación. Registrar esa entrega como N1 y conservarla íntegra.

“One-shot” describe la entrega completa que se somete a crítica. No implica omitir los controles técnicos de desarrollo. Un montaje parcial del catálogo no cuenta como N1 entera.

**Salida:** versión navegable del alcance completo; inventario sin huecos accidentales; baseline visual y funcional guardado.

### Fase 4: bucle final de crítica acumulativa

```text
N1 completa
  → observar tareas, tamaños y estados
  → contrastar con la investigación y con las versiones anteriores
  → registrar cada brecha, gravedad y evidencia
  → investigar otra fuente cuando la brecha lo requiera
  → corregir la versión completa
  → repetir las comprobaciones que afectan al cambio
  → recalcular la nota con los mismos pesos
  → conservar la versión y continuar hasta cumplir 10.0
```

Cada ronda debe conservar versión, SHA-256, tamaños, capturas, resultados, fuentes nuevas y decisiones. Una mejora no puede borrar una pérdida anterior. Un retroceso puede reducir la nota. No hay un número fijo de rondas ni una subida automática por repetición.

Investigar una brecha concreta: legibilidad, identificación de producto, fatiga, orientación, coste de gesto o ritmo. Abrir una fuente nueva debe responder esa brecha. Añadir referencias por cantidad no mejora el diseño.

### Puertas para el 10.0

| Puerta             | Evidencia necesaria                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Cobertura          | Todas las superficies y estados del alcance están implementados y revisados.                                            |
| Originalidad       | La genealogía y las decisiones propias están documentadas; la identidad se sostiene entre superficies.                  |
| Operación          | Operadores completan tareas representativas; se registran dudas, errores y recuperación.                                |
| Dinero             | Flujos nativos conservan importes, referencias y restricciones; un resultado incierto impide un nuevo intento inseguro. |
| Accesibilidad      | Pruebas automáticas y manuales; foco, lector de pantalla, texto aumentado, IME y controles táctiles.                    |
| Responsive         | Panel 1024 × 768, tablet y teléfono reales; rotación, teclado visible y safe areas.                                     |
| Rendimiento        | Medidas en release del equipo objetivo; coste de cuadros, memoria y entrada.                                            |
| Consistencia       | Regresión sin brechas críticas o importantes de rondas previas.                                                         |
| Criterio artístico | Revisión humana de personalidad, moderación y coherencia contextual.                                                    |

El 10.0 significa cumplimiento de la rúbrica y del alcance acordado. No significa belleza universal. No se asigna por redondear 9.6 ni por cansancio del proceso. La estética y la intuición necesitan juicio humano además de mediciones.

### Prueba de operación propuesta

Incluir operadores nuevos y experimentados. Probar pedidos con productos similares, notas largas, cantidades, cambio, pedido guardado, mesa ocupada, efectivo con diferencia y recuperación incierta.

Registrar si la tarea termina, dónde se duda y qué error aparece. Comparar con el POS actual en la misma tarea y dispositivo. La meta es completar la operación sin errores críticos y sin aumentar el esfuerzo del operador. El tamaño y el criterio exactos de la muestra deben fijarse antes de medir.

## 11. Rutas fallidas y procedencia

| Fuente                 | Primera ruta                     | Recuperación y límite                                                                |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| Asatte / MelonLand     | Extracción vacía o error interno | HTML público con curl; JSON Inertia; navegador con HTTP 200.                         |
| HamTama japonés        | Error de extracción              | HTML original y créditos recuperados; obra no ejecutada como performance.            |
| Cosmology Map          | Error de extracción              | HTML y advertencia móvil recuperados; captura de escritorio.                         |
| Anartist               | Error de caché en un intento     | Lectura posterior y JSON público de Discourse.                                       |
| Street Views Patchwork | Error de caché en la obra        | HTML recuperado; funcionamiento actual de APIs queda NV.                             |
| Ambience Antarctica    | Extracción de cero líneas        | HTML de entrada recuperado; reproducción y datos vivos quedan NV.                    |
| Hacker News 2017       | HTTP 429 al abrir el hilo        | Texto indexado y API pública Firebase para fecha e identificador.                    |
| lines / llllllll.co    | robots.txt                       | Se usaron MelonLand, Anartist y fuentes enlazadas; no se afirma lectura de ese foro. |
| Chromium local         | El aislamiento bloqueó sockets   | Ejecución autorizada fuera del aislamiento; revisión terminada y navegador cerrado.  |

Los documentos recuperados son públicos y no requirieron credenciales. El registro de fuentes distingue sus archivos de las capturas. La fecha de modificación local sólo describe el archivo recuperado, no la fecha de creación de la obra.

Para repetir la revisión local desde la raíz del repositorio:

```sh
node docs/research/2026-10-08-pos-estacion/inspect.mjs --pass=revision_nueva
```

Para repetir también las capturas de referencias públicas:

```sh
node docs/research/2026-10-08-pos-estacion/inspect.mjs --pass=revision_con_fuentes --references
```

El script usa Chromium instalado y Playwright del repositorio. `index.html` por sí solo no necesita esas herramientas.

## 12. Decisión recomendada y brechas abiertas

**I.** Adoptar UMI · Estación como dirección de exploración nativa. Conservar la estructura del pedido, la distinción de estados y la claridad del total. Construir el sistema visual propio con Flutter Widgets.

Las siguientes brechas orientan la próxima ronda:

- Comprobar reconocimiento de dibujos cuando dos productos usan recipientes parecidos.
- Sustituir contenido de muestra por nombres e importes reales del catálogo de prueba.
- Examinar 20 líneas de pedido, nombres largos, descuentos, pago dividido y permisos.
- Comprobar texto aumentado, teclado visible y lector de pantalla en nativo.
- Medir rendimiento e interacción táctil en el equipo objetivo.
- Observar operadores antes de afirmar que el diseño resulta intuitivo.

La investigación, la propuesta y las revisiones están entregadas. La preparación del producto conserva una nota menor de 10.0 porque esas brechas requieren evidencia adicional. El plan mantiene el ciclo abierto hasta resolverlas.
