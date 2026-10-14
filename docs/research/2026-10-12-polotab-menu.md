# PoloTab: menú del operador y PoloMini

Fecha de consulta: 2026-10-12. Pregunta: ¿cómo presenta PoloTab las categorías, los productos y sus opciones en el POS?
Esta investigación informa la distribución y la exposición del color en el catálogo de Umi.
Alcance: un proveedor, PoloTab, por petición explícita del usuario.

La [galería HTML](2026-10-12-polotab-menu/report.html) reúne 19 referencias visuales: 12 de menú y siete de mesas.
La sección de mesas aparece primero. Todas las referencias tienen fuentes e instantes de video.
El [índice](2026-10-12-polotab-menu/assets/INDEX.md) identifica cada archivo.

## Herramientas y evidencia

**Hecho documentado.** Se usaron el sitio oficial, su soporte y videos enlazados por el soporte.
Las imágenes comerciales y los fotogramas de uso se identifican por separado.
Los videos completos permanecen en `/tmp/umi-polotab-research`; no se agregaron al repositorio.

**Hecho del instrumento.** Playwright 1.62.1, Apache-2.0, capturó Chromium 153.0.8010.52 en `DISPLAY=:0`.
El navegador usó su espacio de trabajo propio; no reemplazó las ventanas ni sesiones existentes.
FFmpeg n9.0.2 extrajo fotogramas de dos videos oficiales. La compilación instalada declara GPL-3.0 o posterior.
Se eligieron herramientas ya instaladas. No fue necesario instalar paquetes.
`capture-routes.json` conserva las respuestas del navegador y las dimensiones originales.
La galería ampliada aprobó la lectura de sus 19 referencias y la comprobación de ancho a 1440 y 390 píxeles.
No tuvo imágenes rotas ni desbordamiento horizontal. `gallery-check.json` conserva el resultado.

## Pantallas

**Hecho observado.** El [POS comercial](https://www.polotab.com/) tiene tres áreas: comanda izquierda, categorías centrales y catálogo derecho.
Las tarjetas visibles muestran nombre, precio y franja inferior de color. No muestran un botón «+» dentro del producto.
La categoría activa tiene borde y encabezado. [Captura](2026-10-12-polotab-menu/assets/pos-device.png).

**Hecho observado.** La selección de opciones ocupa el área del catálogo mientras la comanda permanece visible.
La [imagen oficial](https://www.polotab.com/producto/puntoDeVentaNewFeat.avif) muestra grupos con requisitos y límites, bordes, marcas y una acción **Agregar**.
[Captura](2026-10-12-polotab-menu/assets/pos-home.png).

**Hecho documentado.** Los [modificadores](https://www.polotab.com/soporte/como-agrego-modificadores-a-mi-producto) pueden ser obligatorios o de selección múltiple.
Se eligen antes de confirmar el producto.

**Hecho observado.** El [tutorial de promociones](https://www.polotab.com/soporte/aplicar-una-promocion-en-el-pos) confirma el catálogo oscuro con franjas.
Los fotogramas 00:05, 00:17 y 00:22 muestran opciones, productos y comanda.
La documentación coloca promociones en un menú de tres puntos, para producto o cuenta.
[Video original](https://drive.google.com/file/d/1AEl2Xd-4HoX0UqPgxDISOjN54f65kVNl/view).

**Hecho observado.** En [PoloMini](https://www.polotab.com/polomini), las categorías aparecen en dos columnas y el resumen de cuenta queda abajo.
La imagen comercial muestra categorías con colores oscuros y algunas fotografías.
[Captura](2026-10-12-polotab-menu/assets/polomini-menu.png).

**Hecho observado.** El [tutorial de PoloMini](https://www.polotab.com/soporte/conoce-tu-polomini) muestra categorías y productos en dos columnas.
En 00:50, los productos tienen nombre y precio; no tienen «+» dentro de las tarjetas visibles.
En 01:10, la confirmación de envío conserva la referencia M1 y la acción de cobro.
[Video original](https://drive.google.com/file/d/1qwRgVgrGZDX3nm9KvAYiO20dRgw8z7Ms/view).

**Hecho documentado.** PoloMini puede tomar pedidos, gestionar mesas y cobrar, según el [soporte oficial](https://www.polotab.com/soporte/conoce-tu-polomini).
Esto no determina los permisos que debe tener cada rol de Umi.

## Ampliación: mesas y cuenta abierta

**Hecho observado.** El mismo tutorial de PoloMini muestra mesas como tarjetas nombradas, sin posiciones físicas dibujadas.
En 00:30, el POS muestra filtros **Mis mesas**, **Ocupadas** y **Disponibles**.
En 00:37–00:40, el recorrido es **A mesa → elegir M1 → personas → encargado → Sentar**.
En 00:44, el catálogo del portátil conserva M1 y la tarjeta del POS muestra encargado y dos personas.
En 01:10, el envío conserva la referencia de mesa, el resumen y la acción **Cobrar**.
La galería contiene los siete pasos observados; `tables-gallery.json` conserva sus descripciones e instantes.

**Hecho documentado.** [Crear mesas](https://www.polotab.com/soporte/crear-mesas) describe el alta previa en el portal.
Las mesas se organizan por zonas y prefijos; después se guarda y refresca el POS.
[Cómo funcionan mesas](https://www.polotab.com/soporte/como-funcionan-mesas) describe la misma preparación.

**Hecho documentado.** [Comandas](https://www.polotab.com/soporte/como-funcionan-las-comandas) indica que una mesa conserva su cuenta activa hasta cobrar.
Los ajustes permiten enviar al tomar el pedido o al cobrar.

**No verificado.** Crear una mesa al vuelo desde el POS, omitir los pasos de personas o encargado, y recuperar una cuenta al tocar la mesa ocupada.
Los fotogramas demuestran la secuencia del tutorial; no demuestran todas las configuraciones disponibles.

**Inferencia para Umi.** Una cuadrícula de mesas nombradas permite operar sin diseñar un plano físico.
En una cuenta ya abierta, reutilizar mesa y encargado evita preguntas repetidas.
La alternativa es repetir los tres diálogos del tutorial en cada entrada; no se recomienda por la fricción añadida.

**Continuidad.** La ampliación agrega el flujo de mesas y conserva la investigación anterior del menú.
No cambia la aplicación ni los permisos del mesero.

## Comparación del menú e inferencias

| Aspecto           | POS horizontal          | PoloMini                                                                     | Inferencia para Umi                                         |
| ----------------- | ----------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Categorías        | Columna persistente     | Cuadrícula de dos columnas                                                   | Adaptar la navegación al ancho                              |
| Producto visible  | Nombre, precio y franja | Nombre y precio, relleno completo en el tutorial                             | Evaluar tarjetas compactas, con toda la tarjeta como acción |
| Opciones          | Reemplazan el catálogo  | Secuencia completa de modificadores no verificada en los fotogramas elegidos | Conservar la comanda visible al personalizar                |
| Selección         | Borde y marca           | Selector de asiento en el tutorial                                           | Usar una señal además del color                             |
| Resumen de cuenta | Panel izquierdo         | Pie inferior                                                                 | Mantener total y acciones accesibles                        |

**Diferencia entre fuentes.** El portátil comercial muestra fotografías y rellenos oscuros; el tutorial muestra rellenos azules intensos.
La versión y la configuración de ambos no están verificadas. No se debe afirmar que usan un contrato de color común.

**Inferencia.** Para Midnight, la referencia más útil es la franja de color sobre una superficie oscura conocida.
Las fotografías con reflejos, perspectiva y tratamientos comerciales no permiten medir contraste normativo.
La alternativa es colorear toda la tarjeta, como el portátil del tutorial. No se recomienda sin medir el contraste de cada pareja.

**Inferencia.** La densidad del catálogo horizontal merece una prueba en el iMin antes de reducir las tarjetas de Umi.
Estas imágenes no prueban rapidez, tamaño táctil ni ausencia de errores del operador.
No hay evidencia suficiente para justificar cambiar la comanda de Umi del lado derecho al izquierdo.

## Continuidad y límites

**Hecho del repositorio.** La investigación anterior [Catálogo e inventario](2026-09-18-catalog-vs-inventory-ia.md) distingue administración de menú e inventario en PoloTab.
Esta consulta agrega pantallas del catálogo operativo; conserva aquella distinción.
La [investigación de cuentas](2026-10-12-tableless-visual-flow.md) aborda otro flujo y permanece como referencia de apertura y recuperación.
Umi conserva sus decisiones de cuenta abierta y permisos; esta investigación no cambia la aplicación.
El catálogo de Umi pertenece a `apps/umi-pos/lib/features/catalog/catalog_surface.dart`; la franja de frecuentes aparece desde la línea 2812.
El encabezado de cuenta usa `accountDisplayTitle` desde la línea 3906 en la fuente consultada.

**No verificado.** Versión instalada de PoloTab, contrato interno de color y medidas de rendimiento o accesibilidad.
No se hizo una muestra de reseñas: el usuario pidió referencias visuales de un proveedor concreto.
No se encontraron notas de versión que documenten estos diseños; los videos y las páginas son las referencias disponibles.

## Rutas y límites de acceso

| Ruta                                          | Resultado                                        | Alternativa                                                         |
| --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| Inicio, PoloMini y soporte oficiales          | HTTP 200                                         | Captura renderizada con Chromium                                    |
| AVIF con lectura web                          | Error de descarga                                | HTTP 200 directo; captura del archivo en Chromium                   |
| Google Drive `/file/d/.../view`               | HTTP 200, lector web solo muestra acceso         | Chromium recupera la vista pública; descarga pública del video      |
| Descarga de video PoloMini                    | HTTP 200, aviso de análisis antivirus por tamaño | Formulario público de confirmación: HTTP 200, video de 162 segundos |
| YouTube con lector web                        | Límite de acceso                                 | Metadatos públicos y videos enlazados por soporte                   |
| Lanzador de navegador con ruta predeterminada | Ejecutable ausente                               | `/usr/bin/chromium` instalado; captura aprobada                     |

La consulta no ingresó en cuentas de PoloTab ni solicitó una demo.
Los originales y los videos oficiales están enlazados junto a cada imagen.
