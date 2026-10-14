# Midnight: exposición del color

Fecha: 2026-10-12. Equipo: iMin D3-504, Android 11, build 24 de Estación.

## Resultado

Midnight conserva los colores exactos del catálogo en franjas opacas.
Las pestañas y los productos sin foto usan superficies oscuras para sus letras.
La selección y los botones secundarios usan un relleno oscuro con una señal azul.
Cobrar usa marino Umi, texto claro y un borde azul visible.

El cambio aplica a Midnight. Las pruebas conservan el comportamiento anterior de Claro y Oscuro.
Las fotos y los datos del catálogo conservan sus valores.

## Base de la decisión

La [investigación especializada](../research/2026-10-12-dark-midnight-color-exposure.md) contrasta Apple, Carbon y Material.
La [medición anterior](../research/2026-10-12-midnight-color-method.md) identifica el pastel y el contraste insuficiente de Pan.
El propietario pidió conservar el color y reducir su exposición, como la franja de las pestañas.

La aplicación usa la franja existente de 4 píxeles lógicos en cada pestaña habilitada.
La franja de un producto sin foto mide 8 píxeles lógicos. Estas medidas son decisiones Umi.
El texto conserva una superficie conocida; la categoría conserva su color sin transparencia.

| Papel                        | Antes                                    | Después                                           |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------- |
| Fondo de pestaña cerrada     | Color de categoría: naranja, azul o rojo | `#0D0D0D`; color exacto de categoría en franja    |
| Texto de pestaña cerrada     | `#FFFFFF` sobre color de categoría       | `#F2F2F2` sobre `#0D0D0D`                         |
| Fondo de producto sin foto   | Color de categoría                       | `#0D0D0D`; color exacto en franja de 8 px         |
| Iniciales en naranja         | `#FFFFFF` sobre `#F58231`                | `#F2F2F2` sobre `#0D0D0D`                         |
| Contenedor de selección      | `#1C1C1C`                                | `#111A2E`                                         |
| Selección de servicio        | Fondo `#A8BBDE`, texto `#131F44`         | Fondo `#111A2E`, texto `#A8BBDE`, borde `#7692CB` |
| Botón secundario con relleno | Fondo `#A8BBDE`, texto `#131F44`         | Fondo `#111A2E`, texto `#A8BBDE`, borde `#7692CB` |
| Cobrar habilitado            | Fondo `#7692CB`, texto `#131F44`         | Fondo `#223979`, texto `#F2F2F2`, borde `#7692CB` |
| Sombra de pestaña            | Tinta del tema con alfa 0.34             | Transparente en Midnight                          |

## Comprobación

- 41 pruebas existentes aprobadas: catálogo, marca, botones, preferencias, menús, encabezado y texto ampliado.
- 2 pruebas nuevas aprobadas: color exacto, proporción de color en pestaña, contraste, selección y botón deshabilitado.
- Análisis estático de los componentes modificados y de la prueba nueva: sin incidencias.
- Render del catálogo a 1920 × 1014 físicos, con densidad 1.375: aprobado.
- El generador de capturas ahora reconoce Midnight; antes lo interpretaba como Claro.

La [prueba nueva](../../apps/umi-pos/test/midnight_color_exposure_test.dart) pinta la pestaña y cuenta sus píxeles.
Comprueba el contraste del texto y la selección semántica tras pulsar Pan.

| Pareja final                                  | Contraste WCAG |
| --------------------------------------------- | -------------: |
| Letras sobre superficie de producto y pestaña |        17.36:1 |
| Texto de Cobrar                               |         9.72:1 |
| Texto de selección y botones secundarios      |         8.94:1 |
| Borde azul contra negro                       |         6.74:1 |

Color.js 0.5.2, MIT, calculó WCAG y APCA. Los [datos completos](evidence/2026-10-12-midnight-exposure/metrics.json) conservan los valores sin redondeo.
Pillow 12.3.0 contó píxeles exactos en la misma región de ambas capturas.
En la región de productos `[281,439,1387,987]`, naranja y azul pasan de 53.33% a 3.09% del área.
La comparación demuestra menor exposición. No mide la rapidez de reconocimiento de un operador.

## Equipo real

La actualización conserva la firma y los datos mediante `adb install -r`.
Se compiló en `/tmp/umi-midnight-exposure-build`, con el identificador de Estación.
La compilación incluye los cambios de hardware presentes en el árbol al crear la copia.
El archivo Gradle del repositorio conserva su identificador original.

Configuración: API `http://127.0.0.1:4001`, contrato `2.29.0`, perfil ARM64 y simulador de hardware deshabilitado.
Herramientas: Flutter 3.47.5 y ADB 37.0.1.
El APK anterior, build 23, está en `/tmp/umi-midnight-exposure-before/estacion-build23.apk`.

Se comprobó en el equipo:

- [Catálogo de Midnight](evidence/2026-10-12-midnight-exposure/01-catalog.png).
- [Categoría Pan seleccionada](evidence/2026-10-12-midnight-exposure/02-pan.png).
- [Cobrar habilitado](evidence/2026-10-12-midnight-exposure/03-checkout-action.png).
- [Botones secundarios de hardware](evidence/2026-10-12-midnight-exposure/04-hardware.png).
- [Catálogo Oscuro](evidence/2026-10-12-midnight-exposure/05-dark-catalog.png).
- [Detalle de producto Claro](evidence/2026-10-12-midnight-exposure/06-light-detail.png).

El producto de prueba se retiró de la comanda. No se ejecutó un cobro ni se envió a cocina.

## Límites

El informe comprueba los controles y estados indicados. No certifica la aplicación completa.
La luz ambiental y la velocidad de reconocimiento requieren observación del operador.
La pareja blanca sobre naranja sigue presente en los temas Claro y Oscuro; esta revisión modifica Midnight.
