# Método de color para Midnight en UmiPOS

Fecha: 2026-10-12. Alcance: acentos de Midnight, contratos y método de medición.

## Instrumento

**Hecho documentado.** Color.js convierte colores a OKLCH y calcula contraste WCAG y APCA. [Documentación oficial](https://colorjs.io/docs/contrast.html).

**Hecho documentado.** Se instaló `colorjs.io` **0.5.2**, licencia MIT, en `/tmp/umi-midnight-metrics`. Node **24.21.0** ejecutó las mediciones.
La instalación aislada no cambió las dependencias del repositorio. [Licencia](https://github.com/color-js/color.js/blob/main/LICENSE).
El instrumento acepta ejecución automática. El costo fue una instalación temporal de npm.
Color.js identifica su implementación APCA como **0.0.98G-4g**. La alternativa es una lectura de tokens y contraste WCAG con el mismo instrumento.

**Hecho documentado.** También se instaló `apca-w3` **0.1.9** para examinar su fuente y licencia.
Su paquete declara `Limited W3 License`. Su licencia contiene límites de uso para contenido web.
Esta investigación usó la implementación de Color.js y no incorporó `apca-w3` a Flutter.
[Fuente y licencia](https://github.com/Myndex/apca-w3/blob/master/LICENSE.md).

**UNVERIFIED.** Esta investigación no comprobó la fecha de la última publicación de Color.js.
La versión instalada es reproducible; no se presenta como la versión más reciente.

## Contrato local

**Hecho documentado.** El contrato de diseño exige un acento por vista y contraste mínimo WCAG AA.
También exige texto y un icono cuando el color no comunica el estado por sí solo.
Fuente: `docs/design/UMIPOS_DESIGN_LANGUAGE_V1.md`, líneas 25, 34 y 97.

**Hecho documentado.** La investigación de Estación fija la marca posterior a N11: marino `#223979`, azul `#7692CB`, mineral `#F3F2EE` y tinta `#131F44`.
El azul inicial de la maqueta no define la marca final.
Fuente: `docs/research/2026-10-08-pos-estacion.md`, línea 231.

**Hecho documentado.** `packages/tokens` separa primitivas de marca y tokens de cada aplicación.
La marca conserva `#223979` y `#7692CB`. La centralización inicial conserva los colores existentes.
Los consumidores generados son dashboard y landing; el paquete no genera Dart para el POS.
Fuente: `packages/tokens/README.md`, líneas 3–11 y 30–44.

**Hecho documentado.** `dashboard.json` define variantes Midnight para superficies, tintas, líneas y estados.
La marca conserva sus valores. Fuente: `packages/tokens/tokens/dashboard.json`, descripción inicial y grupos `brand`, `surface`, `ink`, `status`.

**Hecho documentado.** El POS copia las superficies oscuras del dashboard, pero conserva otros acentos.
`primary` usa `#A8BBDE` en ambos temas oscuros. `signal` conserva `#7692CB` en todos los temas.
Fuente: `apps/umi-pos/lib/core/theme/pos_theme.dart`, líneas 21–32, 51–58 y 86–87.

**Inferencia.** El acento pastel de Midnight tiene una causa concreta: el POS comparte `primary` con Oscuro.
La marca invariable no exige que todos los fondos seleccionados usen un relleno pastel.
Conviene separar el papel del color: marca, acción, selección y estado.

## Método pactado y límites

**Hecho documentado.** La investigación de iOS transfiere `better-colors` a Flutter como principios de OKLCH y APCA.
Exige evidencia renderizada para juzgar contraste, foco y solapamientos.
Fuente: `docs/research/2026-10-04-ios-pos-design-constraints.md`, líneas 284–298.

**Hecho documentado.** La skill local propone APCA de 75 para texto de cuerpo y 60 para etiquetas.
Sus valores son simplificaciones de la tabla completa de tamaño y peso.
Fuente: `.agents/skills/design/better-colors/accessibility-contrast.md`, líneas 9–18.

**Hecho documentado.** WCAG 2.2 exige 4.5:1 para texto normal y 3:1 para texto grande, con excepciones.
El tamaño grande usa 18 puntos o 14 puntos en negrita; los puntos no son píxeles.
La tabla local de la skill usa `px` en ese lugar y necesita corrección.
[Criterio normativo](https://www.w3.org/TR/WCAG22/#contrast-minimum), [explicación de las unidades](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

**Hecho documentado.** WCAG define 3:1 para información visual necesaria de controles y gráficos, con condiciones y excepciones.
Un divisor decorativo no recibe automáticamente ese requisito.
[W3C: contraste no textual](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

**Inferencia.** El POS debe aplicar 4.5:1 a etiquetas pequeñas como criterio interno conservador.
Los píxeles lógicos de Flutter requieren análisis propio de tamaño. Estas mediciones no certifican conformidad WCAG de la aplicación nativa.

**Hecho documentado.** CSS Color 4 define OKLCH como coordenadas de claridad, croma y tono.
[Especificación](https://www.w3.org/TR/css-color-4/#ok-lab).

**Inferencia.** OKLCH sirve para construir variantes perceptuales. La separación de claridad es una guía, no una prueba de contraste.
El resultado final debe conservar el gamut sRGB y medirse tras la conversión y la composición de transparencias.
APCA debe conservar el signo y el orden del fondo y del texto.

## Medición de pares actuales

**Hecho documentado del cálculo.** Color.js produjo estos valores para colores opacos declarados.
Las cifras de la tabla se redondean para lectura. La comparación de umbrales debe usar el valor completo.

| Texto o marca | Fondo     |  WCAG | APCA Lc | Interpretación                                              |
| ------------- | --------- | ----: | ------: | ----------------------------------------------------------- |
| `#131F44`     | `#A8BBDE` |  8.28 |  +63.52 | Cumple 4.5:1; supera la guía APCA de etiquetas.             |
| `#131F44`     | `#7692CB` |  5.16 |  +42.80 | Cumple 4.5:1; queda bajo la guía APCA de etiquetas.         |
| `#A8BBDE`     | `#000000` | 10.83 |  −65.23 | Acento legible; su gran claridad explica el aspecto pastel. |
| `#7692CB`     | `#000000` |  6.74 |  −43.66 | Cumple 4.5:1; limita la lectura pequeña según la guía APCA. |
| `#FFFFFF`     | `#F58231` |  2.59 |  −55.13 | La etiqueta blanca de Pan queda bajo 4.5:1 y 3:1.           |
| `#131F44`     | `#F58231` |  6.21 |  +50.81 | Mejor contraste WCAG; APCA exige revisar tamaño y peso.     |
| `#FFFFFF`     | `#4363D8` |  5.23 |  −80.90 | La etiqueta blanca de Bebidas supera ambos controles.       |
| `#3A3A3A`     | `#000000` |  1.85 |       0 | Revisar si el borde comunica un control o solo separa.      |
| `#1C1C1C`     | `#000000` |  1.23 |       0 | El contenedor solo no ofrece una diferencia fuerte.         |

**Hecho documentado del cálculo.** `#A8BBDE` corresponde a OKLCH `(0.78937, 0.05420, 262.63751)`.
`#7692CB` corresponde a `(0.66128, 0.09120, 263.94911)`.
El pastel tiene mayor claridad y menor croma, con un tono cercano al azul de marca.

**Inferencia.** Oscurecer todos los acentos puede mejorar la apariencia y reducir la legibilidad de las etiquetas.
La solución debe ajustar el relleno y su tinta como un par. La selección puede usar una superficie oscura y una señal pequeña.
El azul de marca puede conservar su identidad sin cubrir superficies extensas.

## Propuesta para revisar en Midnight

**Inferencia.** El pastel actual supera los mínimos de contraste de su etiqueta. La objeción principal es su jerarquía y apariencia.
La etiqueta blanca de Pan presenta otro problema: el par declarado queda bajo el mínimo interno de contraste.

| Papel            | Antes                                | Después propuesto                                             |
| ---------------- | ------------------------------------ | ------------------------------------------------------------- |
| Acción principal | Fondo `#A8BBDE`, tinta `#131F44`     | Fondo `#223979`, tinta `#F2F2F2`, borde `#7692CB`             |
| Selección        | Relleno pastel `#A8BBDE`             | Fondo `#111A2E`, tinta `#A8BBDE`, señal `#7692CB`             |
| Categoría Pan    | Tinta blanca sobre naranja `#F58231` | Banda naranja de identidad y etiqueta sobre superficie neutra |

**Hecho documentado del cálculo.** La acción propuesta tiene 9.72:1 y APCA −90.3 para su texto.
Su relleno marino tiene solo 1.93:1 contra negro. El borde azul ofrece una silueta con mayor contraste.
La selección propuesta tiene 8.94:1 y APCA −63.8 para su texto.
Fuente: [mediciones conservadas](../reports/evidence/2026-10-12-midnight-audit/color-metrics.json).

**Inferencia.** Una tinta oscura sobre naranja corrige el criterio WCAG, pero queda bajo la guía APCA simplificada de etiquetas.
La categoría puede conservar su naranja como banda. El texto pequeño puede usar una superficie neutra con mayor contraste.
Estos valores son propuestas. La investigación no los implementó.

La evidencia principal incluye [el catálogo real](../reports/evidence/2026-10-12-midnight-audit/01-catalog-menu.png) y [la pantalla de hardware](../reports/evidence/2026-10-12-midnight-audit/02-hardware.png).

## Procedimiento de revisión

1. Identifica acción principal, selección, foco, estado y categoría en la captura real.
2. Registra el token, el fondo compuesto, el tamaño y el peso de cada etiqueta.
3. Mide WCAG sobre los colores finales. Conserva 4.5:1 para texto pequeño.
4. Mide APCA como diagnóstico adicional. Usa su tabla de tamaño y peso ante resultados dudosos.
5. Ajusta los pares en OKLCH y comprueba el gamut sRGB.
6. Compara las capturas en el mismo iMin, con la misma pantalla y brillo.
7. Revisa selección, foco, pulsación y estado deshabilitado.

**UNVERIFIED.** Esta nota no prueba estados completos ni la luz ambiental del iMin.
Las capturas y el informe principal deben aportar esa evidencia.
No se cambió la aplicación ni se controló el dispositivo desde esta investigación.

## Rutas y fuentes

**Hecho documentado.** Se consultaron documentación oficial de Color.js, especificaciones W3C y repositorios de los instrumentos.
Se usaron los niveles 1, 3 y 7 de la doctrina local. Todas las páginas citadas respondieron.
La primera búsqueda de la skill en `.agents/skills/better-colors` falló.
`rg --files .agents` localizó la fuente correcta en `.agents/skills/design/better-colors`.
