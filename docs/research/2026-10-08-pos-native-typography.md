# Estación: tipografía, reconocimiento y densidad

Consulta: **2026-10-08**. Apéndice de la [investigación nativa](2026-10-08-pos-native-ui-evidence.md) y la [investigación artística](2026-10-08-pos-estacion.md). Fork: `umi-pos-estacion`.

**Recomendación — I:** probar **IBM Plex Sans para la operación y Bricolage Grotesque para títulos breves**. Plex aporta una familia de trabajo bien documentada. Bricolage aporta una procedencia expresiva particular y ajustes ópticos. **Recursive Sans Linear** es una alternativa coherente de una sola familia. Public Sans sigue siendo utilizable, pero su repositorio declara que ya no recibe mantenimiento activo.

La recomendación es una hipótesis de diseño. Las licencias y la cobertura examinada están verificadas. La superioridad de lectura entre estas fuentes en el POS sigue **NV**. No incorporé archivos a la aplicación ni abrí ventanas.

## 1. Instrumentos y método

| Instrumento                 | Versión y licencia                                                                                                         | Uso y costo                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flutter / Dart              | **3.47.5 / 3.13.4** locales; Flutter BSD de tres cláusulas.                                                                | **HD:** SDK existente. Permite fuentes empaquetadas y `TextStyle` propios sin biblioteca UI. **I:** no hace falta `google_fonts` ni descarga de tipografía en ejecución.            |
| Fontconfig, `fc-query`      | **2.18.3**, instalado en `/usr/bin/fc-query`. Licencia permisiva propia leída en `/usr/share/licenses/fontconfig/COPYING`. | **HD:** consulta familia, estilo, versión codificada, idiomas y cobertura de caracteres de archivos reales. No instala fuentes. No determina legibilidad ni calidad de composición. |
| curl                        | **8.22.0**, ya instalado; licencia curl.                                                                                   | Recuperó archivos y licencias del repositorio del propietario. No fue necesario añadir un paquete.                                                                                  |
| Python, biblioteca estándar | **3.14.7**, ya instalado; licencia PSF.                                                                                    | SHA-256, tamaños y contraste de una muestra con la cobertura que devuelve `fc-query`. No se construyó un motor de tipografía.                                                       |
| Navegación web              | Servicio sin versión expuesta.                                                                                             | Fuentes del creador → repositorio/licencia → archivo → estudios originales. La opinión del creador se conserva como intención, no como resultado experimental.                      |

**HD:** el código actual de [PosTextStyles](../../apps/umi-pos/lib/core/theme/pos_theme.dart) permite `fontFamily`, tamaños de 12 a 44 y cifras tabulares. Esta fase examinó ese archivo en lectura. Una familia nula usa la resolución de fuente disponible en plataforma. **I:** empaquetar una familia fijada permite comparar resultados consistentes entre Linux y Android.

Etiquetas: **HD**, hecho documentado; **CT**, compromiso sustentado; **I**, inferencia o propuesta; **NV / UNVERIFIED**, no verificado. Una página viva sin fecha de publicación se registra `s/f`; un copyright no se convierte en fecha de lanzamiento.

## 2. Del creador al archivo

### IBM Plex Sans

**HD:** [Mike Abbink](https://mikeabbink.com/typefaces/ibm-plex-sans/) acredita su colaboración con Bold Monday y a Paul van der Laan y Pieter van Rosmalen. Describe el equilibrio entre formas naturales y construidas. IBM sitúa la introducción de Plex en **2018**. El [repositorio oficial](https://github.com/IBM/plex) declara uso previsto en interfaces, latín extendido, romanas e itálicas. Son objetivos del diseño, no una prueba comparativa de cajeros. [Historia institucional](https://www.ibm.com/design/impact/plex/).

**HD:** muestra descargada: **IBM Plex Sans Regular 3.005**. El proyecto mantiene entregas de distintas familias; el commit consultado es de **2026-09-22**. No confundo una entrega de Mono o japonés con una actualización de esta romana latina.

**I:** primera candidata para nombre de producto, variante, campo, acción e importe. Su carácter técnico puede funcionar con una composición cálida, pero no basta para identificar una estación de café.

### Public Sans

**HD:** la fuente pertenece al proyecto USWDS y deriva de Libre Franklin. `AUTHORS.txt` distingue autores de copyright; `CONTRIBUTORS.txt` incluye Rosalie Wagner, Dan O. Williams y USWDS. Evito atribuir toda la creación a una sola persona. El [anuncio de USWDS 2.0](https://digital.gov/2019/04/08/introducing-uswds-2), **2019-04-08**, presenta Public Sans. El [repositorio](https://github.com/uswds/public-sans) documenta una `l` con cola y cifras tabulares.

**HD:** versión **2.001**, sólo escritura latina. El README actual declara sitio retirado y ausencia de mantenimiento activo; describe la variable como experimental. El commit más reciente consultado, **2026-10-01**, no demuestra trabajo sobre la fuente. Una [página USWDS](https://github.com/uswds/uswds-site/blob/main/_components/typography/typography.md) todavía la llama mantenida: conservo la contradicción.

**I:** alternativa sobria mediante archivos estáticos. Prioridad menor para esta exploración por mantenimiento y neutralidad buscada por sus autores.

### Bricolage Grotesque

**HD:** [Mathieu Triay](https://ateliertriay.github.io/bricolage/) explica una identidad entre Francia e Inglaterra. Parte de Mayenne Sans de Jérémy Landes. Documenta ejes de peso, anchura y tamaño óptico; los tamaños pequeños tienen formas más contenidas y contraformas abiertas. Declara que la familia no tiene itálicas. Su sitio lleva copyright **2023**; no afirma una fecha exacta de lanzamiento.

**HD:** muestra **Bricolage Grotesque 12pt Regular 1.001**; [repositorio del creador](https://github.com/ateliertriay/bricolage), último commit consultado **2023-07-19**. Tiene archivos estáticos y variable. Disponibilidad de fuente y código no equivale a compromiso de soporte activo.

**I:** buena candidata para títulos breves y el nombre Estación. Probar también el corte 12pt en texto antes de descartarlo. Evitar la anchura condensada y el corte de exhibición para importes pequeños hasta observarlos en el equipo real. No usar una cursiva sintética para suplir una variante inexistente.

### Recursive Sans Linear: alternativa menos obvia

**HD:** [Stephen Nixon / ArrowType](https://www.arrowtype.com/custom/recursive) vincula Recursive con su proyecto de **2018**, programación y rotulación de pincel. La familia tiene cinco ejes. Su [repositorio](https://github.com/arrowtype/recursive) declara métricas de anchura constantes entre pesos y estilos, y recomienda el extremo Sans para UI. Esa declaración no reemplaza una prueba de lectura.

**HD:** muestra estática **1.085**. La [última release indicada por la API](https://github.com/arrowtype/recursive/releases/tag/v1.085) se publicó **2022-06-30**; último commit consultado **2023-02-19**. No encontré una garantía actual de mantenimiento.

**I:** probar Sans Linear para operación y una expresión Casual moderada en títulos. Cambiar peso sin alterar anchura puede conservar estabilidad de etiquetas. Esa capacidad no obliga a animar el texto ni a usar Mono para todos los importes.

## 3. Licencias y descargas oficiales verificadas

**HD:** descargué cada muestra y su licencia en `/tmp/pos-*`. Las cuatro usan **SIL OFL 1.1**. Sus textos permiten empaquetar e incrustar la fuente con software y exigen conservar avisos y licencia; no autorizan vender la fuente aislada. El documento creado con la fuente no hereda OFL. IBM reserva el nombre **Plex** para derivados. No propongo modificar ni rebautizar los archivos.

**HD:** Public Sans combina la fuente original OFL con modificaciones GSA bajo CC0. Su [LICENSE.md](https://raw.githubusercontent.com/uswds/public-sans/e40fcf567e44b4f5f08a658247663275fa1ad741/LICENSE.md) indica aplicar OFL al conjunto. No se debe describir todo el archivo como dominio público.

| Muestra oficial fijada                                                                                                                                                                                                                    | Licencia recuperada                                                                                                                                 | Tamaño de esta muestra; SHA-256                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Plex Regular TTF](https://raw.githubusercontent.com/IBM/plex/763c36ef9117782905ae010056dfbe8fd2653a25/packages/plex-sans/fonts/complete/ttf/IBMPlexSans-Regular.ttf)                                                                     | [LICENSE.txt](https://raw.githubusercontent.com/IBM/plex/763c36ef9117782905ae010056dfbe8fd2653a25/packages/plex-sans/LICENSE.txt)                   | **200500 bytes**; `975dcda37d80f038dcd143c22e33ca2d97a0cc5a929aace1c749153b0fe1afa5` |
| [Public Sans Regular TTF](https://raw.githubusercontent.com/uswds/public-sans/e40fcf567e44b4f5f08a658247663275fa1ad741/fonts/ttf/PublicSans-Regular.ttf)                                                                                  | [OFL.txt](https://raw.githubusercontent.com/uswds/public-sans/e40fcf567e44b4f5f08a658247663275fa1ad741/OFL.txt), además del LICENSE indicado arriba | **84836 bytes**; `b577e9bc9887284e90aae5ad0699689ce36b5cd96207efbec68f77f8aed88379`  |
| [Bricolage 12pt Regular TTF](https://raw.githubusercontent.com/ateliertriay/bricolage/84745e5b96261ae5f8c6c856e262fe78d1d6efdd/fonts/ttf/BricolageGrotesque12pt-Regular.ttf)                                                              | [OFL.txt](https://raw.githubusercontent.com/ateliertriay/bricolage/84745e5b96261ae5f8c6c856e262fe78d1d6efdd/OFL.txt)                                | **114760 bytes**; `3499912f25ae2c6bf5c1ba6f35202cc7fa0c7bd65813e5620aa09e1054e8d830` |
| [Recursive Sans Linear Regular OTF](https://raw.githubusercontent.com/arrowtype/recursive/6d491202cea5cf6a493ef710cbef2527b9b08939/fonts/ArrowType-Recursive-1.085/Recursive_Desktop/separate_statics/OTF/RecursiveSansLnrSt-Regular.otf) | [OFL.txt](https://raw.githubusercontent.com/arrowtype/recursive/6d491202cea5cf6a493ef710cbef2527b9b08939/OFL.txt)                                   | **353480 bytes**; `e099f39d5761590ca1f2be8ee94a0b8c7531e43fbe92e692c955aed21bcad315` |

Estos tamaños pertenecen a un archivo Regular por candidata. No representan una familia completa ni el costo de memoria o descarga de una compilación Flutter. Las versiones internas de fuente no son necesariamente las versiones de paquetes npm.

**I:** la adopción exige elegir pesos reales, declararlos en `pubspec.yaml`, empaquetar avisos y comprobar renderizado. Conservar fuentes locales evita depender de la red durante una venta. [Mecanismo Flutter](https://docs.flutter.dev/cookbook/design/fonts), actualizado **2026-09-29**. Sus ejemplos Material no son necesarios para declarar la fuente.

## 4. Cobertura del español: comprobación y límite

**HD:** `fc-query` reconoce `es` en los cuatro archivos. Contrasté su cobertura con esta muestra:

```text
ÁÉÍÓÚÜÑáéíóúüñ¿¡€$0123456789,.%−Café de piñón
```

Cada muestra contiene todos los caracteres, tanto en la forma precompuesta como después de normalizar a **NFD**. La segunda comprobación incluye las marcas combinantes necesarias para esas letras. Resultado de caracteres ausentes: **cero en los cuatro archivos**.

**NV:** esta consulta no comprueba ubicación de marcas, kerning, sustituciones OpenType, clipping, reconocimiento de `I/l/1` o lector de pantalla. Tampoco certifica todos los nombres de producto ni toda escritura latina. Deben examinarse en el renderer del POS. No deduzco cobertura árabe o japonesa de la existencia de otras familias Plex.

**HD:** Flutter ofrece `FontFeature.tabularFigures()` para `tnum`; el comportamiento predeterminado depende de la fuente. Una llamada no garantiza que el archivo implemente la característica. [API oficial](https://api.flutter.dev/flutter/dart-ui/FontFeature/FontFeature.tabularFigures.html). Public Sans documenta cifras tabulares; no medí los avances de dígitos en las otras muestras.

## 5. Roles y tamaños propuestos para la próxima observación

**I:** esta tabla es un punto de partida, no una norma demostrada para cajeros. La [escala propia de IBM](https://www.ibm.com/design/language/typography/type-scale/) documenta 14, 16, 18, 20 y 24 con opciones de interlínea. Ese uso institucional sustenta una escala consistente; no prueba qué tamaño requiere la distancia de trabajo de Umi.

| Rol                         | Primera configuración para comparar                    | Motivo y criterio                                                                                                                                  |
| --------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Producto y variante elegida | Plex Sans **16/22**, 600 para nombre, 400 para detalle | Priorizar reconocimiento. Conservar el tramo que distingue dos nombres parecidos; permitir dos líneas cuando haga falta.                           |
| Campo y acción principal    | Plex Sans **16/22**, peso 400 o 600                    | El contenido operativo debe sobrevivir al texto ampliado. Tamaño de texto y objetivo táctil se evalúan por separado.                               |
| Metadato secundario         | Plex Sans **14/20**, 400                               | Evitar que un precio, una variante necesaria o un error dependa del tamaño de metadato. No reducir todo para obtener más columnas.                 |
| Importe de línea y cantidad | Plex Sans **16/22**, cifras tabulares cuando funcionan | Alineación de importes a la derecha; nombre a la izquierda. Mostrar moneda y formato real, sin convertir todos los nombres en texto monoespaciado. |
| Total                       | Plex Sans **28/34**, 600                               | Reconocer el resultado de la venta. Comprobar `9.00`, `111.11` y `1,888.88` sin cambio de anclaje ni recorte.                                      |
| Título breve                | Bricolage Grotesque **24/29**, 600, ancho normal       | Dar carácter sin ocupar el espacio de una portada. En móvil, reducir la extensión del título antes de reducir la información operativa.            |

**HD:** `FontVariation.opticalSize` interpreta su valor en **puntos**, no en píxeles lógicos: la API declara una relación de 96/72. El SDK local conserva esa documentación. [API](https://api.flutter.dev/flutter/dart-ui/FontVariation/FontVariation.opticalSize.html). **I:** si se fija `opsz`, documentar la unidad y observar el resultado; no asignar automáticamente el mismo número que `fontSize`. También puede elegirse un corte estático apropiado.

**HD:** desde Flutter **3.41**, `FontWeight` controla también el eje `wght` de fuentes variables. [Cambio oficial](https://docs.flutter.dev/release/breaking-changes/font-weight-variation), actualizado **2026-05-05**. **I:** en el SDK 3.47.5 no duplicar configuraciones de peso contradictorias. Verificar las fuentes variables y estáticas en Linux y Android por separado.

## 6. Reconocimiento y densidad: evidencia primaria

### Everett y Byrne, CHI 2004

**HD:** _Unintended Effects: Varying Icon Spacing Changes Users' Visual Search Strategy_, **2004-04-24–29**, DOI `10.1145/985692.985780`. El [laboratorio autor](https://chil.rice.edu/research/pubs.html) lo incluye. Recuperé el [manuscrito publicado por Michael Byrne](https://www.researchgate.net/publication/221514619_Unintended_effects_Varying_icon_spacing_changes_users%27_visual_search_strategy) tras fallar el PDF institucional. Primer experimento: 46 estudiantes, rejillas de 6–24 iconos con etiquetas y separación variable. Más elementos, rasgos menos distintivos y separación mayor aumentaron el tiempo. La segunda comparación, con 32 participantes, encontró efectos de exposición a separación variable.

**CT:** extender los espacios no asegura búsqueda más rápida. **I:** mantener relación próxima entre símbolo y nombre, y separación estable. El experimento usa ratón, iconos de 32px y nombres de archivo; no determina la densidad táctil óptima de un café.

### McDougall e Isherwood, mayo de 2009

**HD:** [What’s in a name?](https://link.springer.com/article/10.3758/BRM.41.2.325), DOI `10.3758/BRM.41.2.325`. El resumen original describe cómo cambian los predictores al aprender iconos: primero pesa la relación entre imagen y función; después, familiaridad con la función. Concreción y familiaridad gráfica también participan. Revisé el resumen del editor; texto completo **NV**.

**I:** una taza puede identificar una categoría y seguir sin distinguir Latte, Chai y Americano. Mantener nombre explícito, variante y precio. Comprobar comprensión inicial y búsqueda repetida; no valorar todos los iconos por preferencia del diseñador.

### Reppa y McDougall, publicación en línea 2015-01-17

**HD:** [When the going gets tough the beautiful get going](https://link.springer.com/article/10.3758/s13423-014-0794-z), DOI `10.3758/s13423-014-0794-z`; texto original accesible también en [Bournemouth](https://eprints.bournemouth.ac.uk/21838/1/Mcdouga..%20When%20the%20tough.pdf). Experimento 1: 19 estudiantes, búsqueda entre nueve iconos; el atractivo favoreció a los complejos, pero no produjo diferencia significativa entre los simples. Los simples se encontraron más rápido que los complejos. El segundo experimento examina abstracción y familiaridad.

**CT:** belleza y eficacia pueden relacionarse bajo condiciones concretas. **I:** no declarar que embellecer una tarjeta siempre mejora la búsqueda. El resultado no evalúa fuentes, productos de Umi ni turnos prolongados. El PDF lleva copyright 2014; la publicación y el número de revista corresponden a 2015.

### Puglisi y colaboradores: selección de bebidas, 2020/2021

**HD:** [Soda Machine and User Experience](https://journals.sagepub.com/doi/10.1177/1071181320641493), DOI `10.1177/1071181320641493`; número fechado **diciembre de 2020**, primera publicación en línea **2021-02-09**. El [manuscrito del coautor Tianqi Gao Smith](https://www.researchgate.net/publication/345255938_Soda_Machine_and_User_Experience_A_Study_of_Icon_Display), subido **2020-11-03**, permite revisar el método: veinte personas de 18–40 años, diseños recreados en Keynote/iPad. Comparó **35 iconos y dos páginas** con **20 y tres páginas**. No encontró mejora significativa del tiempo ni satisfacción global; sí una diferencia en la dimensión dependabilidad.

**CT:** reducir la cantidad visible puede trasladar trabajo a otra página. **I:** medir la ruta completa. Muestra pequeña, tarea de dispensador y cambio simultáneo de agrupación/profundidad limitan la extrapolación. Ausencia de diferencia significativa no demuestra equivalencia ni un número ideal de tarjetas.

### Una fuente cercana al POS que no prueba velocidad

**HD:** Huang y Lai, [Factors influencing the usability of icons in the LCD touchscreen](https://www.sciencedirect.com/science/article/pii/S0141938207001126), _Displays_, **octubre de 2008**, DOI `10.1016/j.displa.2007.10.003`. El resumen original tiene 30 participantes y valoraciones de veinte criterios. Extrae factores mediante PCA; no es un ensayo de encontrar y cobrar productos. Texto completo bloqueado por 403; resumen recuperado desde el índice del editor.

**I:** no convertir opiniones de importancia o familiaridad en mejora de tiempo. Tampoco citar un estudio de producto como prueba de una rejilla por su simple mención de “POS”.

## 7. Prueba que resolvería la brecha

**I:** comparar la próxima versión nativa con datos y tareas idénticos. Primero variar sólo la familia; después variar tamaño de ilustración y densidad. Contrabalancear el orden para que aprender los productos no beneficie siempre a la segunda variante. La prueba de tipografía usa nombres e importes reales; la de rejilla conserva los mismos productos y camino de selección.

- Leer y seleccionar productos parecidos: Latte, Latte frío, Chai latte y una variante con nombre largo. Registrar errores y correcciones, además del tiempo.
- Encontrar un producto al inicio, al final y después de filtrar. Medir tiempo hasta la selección correcta, toques, cambios de página y desplazamiento.
- Revisar un pedido de veinte líneas con notas, variantes y modificadores. Leer cantidades y total sin abreviar el dato que distingue la selección.
- Examinar español precompuesto y NFD, `I/l/1`, `O/0`, símbolos monetarios y texto ampliado. Observar Linux y Android, tema claro y oscuro, escala y distancia reales.

**NV:** no ejecuté estas pruebas. No existe en esta entrega un ganador medido, porcentaje de mejora ni nota estética nueva. La galería del creador acredita intención y procedencia; una rejilla bonita acredita composición. La calidad operativa exige acciones y resultados registrados.

## 8. Bloqueos y recuperación

| Ruta o instrumento             | Resultado                                                      | Recuperación y límite                                                                                                      |
| ------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `import fontTools`             | Paquete ausente.                                               | Usé `fc-query` instalado. No añadí dependencias.                                                                           |
| `hb-shape`                     | Ejecutable ausente.                                            | No declaré avances de dígitos ni composición OpenType medida. Se conservan **NV**.                                         |
| PDF de Rice vía web            | 502. curl rechazó certificado TLS que no coincide con el host. | Lista del laboratorio y manuscrito subido por coautor. No desactivé la verificación TLS.                                   |
| Artículos PMC                  | Página de comprobación del navegador.                          | Editor y PDF del repositorio institucional para Reppa/McDougall. No usé la página de comprobación como texto del artículo. |
| DOI de McDougall/Isherwood     | Redirección no extraíble.                                      | URL canónica del editor respondió con resumen y metadatos; cuerpo completo sigue **NV**.                                   |
| Página supuesta de Bold Monday | No extraíble.                                                  | Índice de Mike Abbink → ficha exacta de Plex Sans y créditos del archivo.                                                  |
| ScienceDirect Huang/Lai        | 403 al abrir.                                                  | Resumen original indexado. No atribuyo conclusiones del método completo.                                                   |

**HD:** sólo escribí este apéndice dentro del fork. Las muestras y licencias descargadas quedan en `/tmp`; los enlaces fijados y hashes permiten recuperarlas. La aplicación y el repositorio original no fueron editados en esta fase.
