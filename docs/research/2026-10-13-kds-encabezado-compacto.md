# Cocina: encabezado compacto

Fecha: 2026-10-13. Alcance: composición visual del KDS nativo de UmiPOS.

## Decisión

**Inferencia para Umi.** Usar `LayoutBuilder` y los controles existentes de UmiPOS. Reorganizar las barras en dos filas cuando el ancho disponible alcance. Conservar los controles táctiles, los filtros, sus recuentos y las alertas.

La composición propuesta para la A9 horizontal es:

1. Título, Comandas / Preparación, sonido y actualización.
2. Estación, Hoy / Anteriores / Todos y acceso a Sin estación.

El ancho lógico de referencia comunicado para la A9 horizontal es aproximadamente 1096 píxeles. **NO VERIFICADO por esta investigación:** corresponde confirmar ese ancho y la altura ganada en el dispositivo. El punto de adaptación depende del espacio local y del tamaño del texto, no del modelo de tablet.

**Inferencia para Umi.** En pantalla angosta, permitir una composición más alta. Usar `PosSelect` si las opciones completas no caben. Mostrar la estación elegida, conservar el acceso a Sin estación y mantener visible el recuento de Anteriores. El ahorro de espacio no debe ocultar trabajo pendiente.

## Herramientas elegidas

**Hecho documentado y verificación local.** Las versiones siguientes provienen de los comandos `--version` ejecutados el 2026-10-13.

| Herramienta                            | Versión local                          | Licencia y mantenimiento                                                                                                                             | Uso y costo de adopción                                                               |
| -------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Flutter / `flutter_test`               | 3.47.5, estable, revisión `6a19cca564` | BSD de tres cláusulas. SDK oficial; revisión instalada del 2026-09-17. [Licencia](https://raw.githubusercontent.com/flutter/flutter/master/LICENSE). | Distribución, pruebas de widgets y análisis. Ya instalado; ninguna dependencia nueva. |
| Dart                                   | 3.13.4, estable                        | SDK incluido en Flutter. Su versión se verificó con el binario instalado.                                                                            | Compilación y herramientas existentes; ninguna migración.                             |
| ADB                                    | 37.0.0, protocolo 1.0.41               | Proyecto Android; código ADB bajo Apache 2.0. [Licencia](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/NOTICE).   | Instalar y capturar la app Android real. Ya instalado y autorizado en las terminales. |
| Prettier                               | 3.9.4                                  | MIT. Herramienta existente del repositorio. [Licencia](https://raw.githubusercontent.com/prettier/prettier/main/LICENSE).                            | Formato del documento con `npx prettier --write`. Sin costo de incorporación.         |
| `PosTabs`, `PosSegmented`, `PosSelect` | Código del árbol actual de UmiPOS      | Componentes internos mantenidos por Umi; sin versión independiente.                                                                                  | Reutilizar apariencia, selección y semántica. Cambiar la composición local del KDS.   |

**Hecho documentado.** La guía oficial recomienda `LayoutBuilder` para decidir la composición a partir de las restricciones del padre. `MediaQuery.sizeOf` describe toda la ventana. Esta diferencia importa cuando el shell reserva espacio para navegación. [Guía adaptable de Flutter](https://docs.flutter.dev/ui/adaptive-responsive/general), [referencia de LayoutBuilder](https://api.flutter.dev/flutter/widgets/LayoutBuilder-class.html).

**Hecho documentado.** Flutter describe una barra Material con título y acciones. La zona inferior es adicional y suele contener pestañas. Esto explica el costo vertical de colocar cada grupo en una sección independiente. No exige una fila por grupo. [Referencia de AppBar](https://api.flutter.dev/flutter/material/AppBar-class.html).

**Hecho documentado.** ADB permite comunicación, instalación y ejecución de comandos en dispositivos Android. La captura nativa comprueba el cliente que usa el operador. [Documentación oficial de ADB](https://developer.android.com/tools/adb).

## Respuestas antes de implementar

| Pregunta                         | Respuesta                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Existe una herramienta probada? | Sí: Flutter resuelve restricciones y composición; `flutter_test` mide y prueba widgets.                                                 |
| ¿Está instalada?                 | Sí. El comando corto `flutter` no estaba en `PATH`; funcionó `/home/juan/.local/opt/flutter/bin/flutter`.                               |
| ¿Se puede usar sin intervención? | Sí: comandos de análisis, pruebas y ADB ya disponibles.                                                                                 |
| ¿Qué cuesta adoptarla?           | Ningún paquete nuevo. La edición se limita a la composición del KDS y sus pruebas.                                                      |
| ¿Cuál es el respaldo?            | Componentes existentes, adaptación por ancho y desplazamiento de controles cuando sea necesario. Conservar texto legible y área táctil. |

**Decisión sustentada.** Una biblioteca nueva de barras añade otro sistema visual y otra dependencia. Los controles actuales ya cubren pestañas, selección y menús. No se propone dibujar controles a mano. La única composición propia organiza widgets existentes según el espacio de UmiPOS.

**Hecho documentado local.** En `apps/umi-pos/lib/core/theme/pos_collections.dart`, `PosSegmented` usa botones con tamaño mínimo de 48 píxeles. `PosSelect` reutiliza el menú y los botones de Umi. `PosTabs` reserva 60 píxeles de altura preferida y permite desplazamiento horizontal. Conviene modificar su ubicación en esta pantalla, sin cambiar globalmente estos componentes.

## Accesibilidad y comprobación

**Hecho documentado.** Android recomienda áreas táctiles de al menos 48 × 48 dp. Reducir las áreas de toque no es una solución al espacio ocupado. Los iconos necesitan una descripción de su acción. [Accesibilidad de Android](https://developer.android.com/guide/topics/ui/accessibility/apps).

**Hecho documentado.** `flutter_test` viene con el SDK. `WidgetTester` permite renderizar e interactuar con widgets. `getRect` devuelve el rectángulo de un widget después de su distribución. [Pruebas de widgets](https://docs.flutter.dev/cookbook/testing/widget/introduction), [referencia de getRect](https://api.flutter.dev/flutter/flutter_test/WidgetController/getRect.html).

**Hecho documentado local.** `flutter_test/lib/src/accessibility.dart` define `androidTapTargetGuideline` con 48 × 48. La misma regla está en el [código oficial de Flutter](https://github.com/flutter/flutter/blob/master/packages/flutter_test/lib/src/accessibility.dart).

**Inferencia para Umi.** La validación debe cubrir:

- Capturas ADB antes y después en la A9, con igual orientación, escala y selección.
- Medición desde el inicio de la pantalla de Cocina hasta la primera comanda. Informar píxeles físicos y densidad.
- Prueba de ancho horizontal de referencia y una prueba a 360 píxeles con texto al 200 %.
- Ausencia de desbordamiento, recortes y superposición. Selección operable de pestaña, estación y fecha.
- Recuentos de Anteriores y Sin estación visibles, incluidos cero, carga y valores grandes.
- Sonido y actualización accesibles. Alertas de conectividad y errores presentes cuando corresponden.
- Preparación y Comandas conservan el filtro y actualizan la vista correcta.

**NO VERIFICADO por esta investigación:** altura final, pruebas de la implementación y capturas posteriores. Sus resultados pertenecen al reporte de verificación del cambio. Una prueba de widget no sustituye la captura Android real.

## Ajustes de nombres, categorías y filtros

**Hecho documentado.** `flutter gen-l10n`, incluido en Flutter 3.47.5, genera las clases desde los archivos ARB existentes.
Se usa para KDS y Todos. No se edita código generado a mano.
[Internacionalización de Flutter](https://docs.flutter.dev/ui/internationalization).

**Hecho documentado.** Flutter ofrece pesos tipográficos convencionales de 100 a 900.
El peso 700 representa Bold. [FontWeight](https://api.flutter.dev/flutter/dart-ui/FontWeight-class.html).
**Hecho local.** El POS incluye IBM Plex Sans SemiBold 600 y Bold 700; no incluye una variante superior.
**Inferencia para Umi.** Redondear 600 × 1.15 = 690 a 700 aumenta el peso nominal un 16.7%.
El porcentaje describe el valor tipográfico, no una medición física del grosor de cada trazo.
La categoría seleccionada ya usaba 700. Todas las categorías pasan a usar el archivo Bold existente.
Su ancho se mide con ese mismo peso para conservar espacio suficiente.

**Inferencia para Umi.** Los filtros deben ocupar el ancho disponible y empezar en una posición fija.
`WrapAlignment.start` y `CrossAxisAlignment.stretch` evitan el centrado según el contenido.
`TextPainter` reserva el ancho de los contadores según el total del tablero, independiente de la estación seleccionada.
El ícono de Anteriores conserva siempre su espacio. No se añaden controles propios ni bibliotecas.
[TextPainter](https://api.flutter.dev/flutter/painting/TextPainter-class.html).

## Fuentes y rutas de consulta

Se usaron documentación oficial y código fuente: peldaños 1 y 3 de la doctrina del repositorio. No fue necesario consultar competidores para reorganizar controles existentes.

- La URL `WidgetTester/getRect.html` falló. La referencia correcta está en `WidgetController/getRect.html` y respondió.
- Las páginas de API de `androidTapTargetGuideline` no estuvieron disponibles. Se comprobó la regla en el SDK instalado y el repositorio oficial.
- GitHub no expuso el texto de licencia de Prettier en la extracción inicial. La URL oficial de contenido sin formato sí respondió.
- No se incorporaron precios, capacidades ni mediciones sin evidencia.
