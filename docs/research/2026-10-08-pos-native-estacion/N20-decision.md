# N20: teclado visible y recibo como documento

Fecha local: 8 de octubre de 2026. Base: N19, `be69963`. Nota acumulativa: **8.3/10**. Compilación final: N20-r2.

## Crítica y evidencia primaria

La [investigación](N20-keyboard-evidence.md) fija SDK, foco, modalidad y campos del recibo. Distingue hechos, propuestas y condiciones pendientes. Consulta fuentes de Flutter, Square, GOV.UK y W3C. La conexión artística vuelve al artículo original de Low-tech Magazine de 2018.

La [línea base](N20-native-baseline.txt) comprueba Tab y Shift+Tab entre búsqueda, filtro y orden. Return abre las opciones. Down cambia el foco. Escape cierra y devuelve el foco al filtro. Esa secuencia ya funciona en N19. N20 conserva el resultado y no presenta un fallo supuesto.

**Precisión sobre N19.** Un Finder con `skipOffstage` puede omitir un encabezado retenido fuera del viewport. La ausencia del Finder no prueba desmontaje. El SDK conserva el hijo de `SliverToBoxAdapter`; la lista de ventas usa creación diferida. Los artefactos históricos permanecen intactos. Esta nota corrige su interpretación.

**G63.** La [vista anterior del recibo](N20-baseline-receipt-view/screen.png) muestra referencia, descripción y cantidad. Omite precios, variantes, notas y total disponibles en el snapshot. Su botón que llama a impresión dice «Ver para reimpresión». El nombre describe una vista, aunque el callback solicita impresión.

**Decisión UMI.** El menú usa Abrir recibo. La acción del documento usa Imprimir recibo. El callback y sus permisos permanecen en su propietario. `printAuthoritativeReceipt` envía primero el original; COPIA requiere otro camino. No se atribuye esa operación al botón nuevo.

## Documento y dirección visual

Ventas y el detalle posterior al cobro comparten `ReceiptDocument`. El documento usa firma Estación, referencia seleccionable, fecha operativa, artículos, ajustes y total. Presenta comercio y sucursal cuando existen. Presenta variante, modificadores y nota recibidos. Los campos opcionales ausentes no generan texto ficticio.

Cada artículo muestra cantidad, precio unitario e importe de línea. Subtotal, impuestos, descuento, propina y total proceden del snapshot. Los ajustes opcionales de valor cero se omiten. La vista no suma precios para reconstruir el total.

La [guía de Square](https://squareup.com/help/us/en/article/6139-print-receipts) distingue selección de transacción e impresión. [GOV.UK Button](https://design-system.service.gov.uk/components/button/) relaciona texto y acción real. Son criterios documentales; no se importan componentes ni recursos.

**Inferencia artística.** El [trabajo de De Decker, Otsuka y Roscam Abbing](https://solar.lowtechmagazine.com/2018/09/how-to-build-a-low-tech-website/), fechado 2018-09-24, aporta identidad tipográfica contenida. Estación usa jerarquía, reglas y ritmo para organizar el documento. Conserva colores UMI. No añade textura ni simulación de papel. La obra no prueba eficacia de caja.

La composición adapta cada pareja de etiqueta e importe a su ancho real. `TextPainter` mide fuentes y escala efectivas. Usa una fila cuando cabe; usa columna cuando falta ancho. El contenido comparte el desplazamiento del diálogo. Se elimina el `ListView` interior del recibo anterior.

La [vista con texto normal](N20-r2-receipt-system-wide/screen.png) muestra el documento completo. La [vista al 200%](N20-r2-receipt-2-phone-total/screen.png) permite leer los importes y el total. La jerarquía del título, artículos y total conserva la dirección Estación. Esta revisión justifica una mejora visual pequeña, de 8.2 a 8.3.

## Brecha descubierta en la primera compilación

**G64.** La primera compilación N20-r1 incluye la referencia seleccionable en el recorrido. La [captura tras Tab](N20-receipt-2-phone-tab-print/screen.png) no muestra un indicador visible. El [puente](N20-receipt-2-phone-tab-print-atspi.json) no identifica una referencia enfocada. El nombre de ese artefacto expresa el destino previsto por el instrumento, no un resultado demostrado.

La [prueba anterior](N20-selection-before-fix.txt) confirma que el nodo de selección recibe foco mientras su referencia queda fuera del viewport. Su extremo superior queda en −521, con viewport desde 0. Este resultado precisa la inferencia de la captura nativa.

La primitiva `PosSelectionArea` revela su contenido al recibir foco. Comunica `focusable` y `focused` a semántica. Un borde azul identifica el foco de teclado. El espacio del borde permanece reservado. La primitiva mantiene selección, controles y menú anteriores.

Los diálogos declaran recorrido cerrado de forma explícita. Las [dos pruebas de línea base](N20-dialog-baseline.txt) ya pasan en el caso simple. El cambio declara la política modal; no se presenta como reparación de un escape reproducido.

## Comprobación nativa final

N20-r2 revela la [referencia completa](N20-r2-receipt-2-phone-reference/screen.png) y muestra su borde. [AT-SPI](N20-r2-receipt-2-phone-reference-atspi.json) identifica la referencia como enfocada. Tab recorre referencia, Imprimir recibo y Cerrar. Shift+Tab recorre los mismos destinos en sentido inverso.

[Escape](N20-r2-receipt-2-phone-dismiss-atspi.json) devuelve el foco a Acciones de la venta. El recorrido inverso alcanza referencia de venta, [orden](N20-r2-return-sort/screen.png), [filtro](N20-r2-return-filter/screen.png) y [búsqueda](N20-r2-return-search/screen.png). Los controles se revelan y conservan «latte».

La revisión incluye [inglés al 200%](N20-r2-receipt-2-en-phone-total/screen.png), [foco de referencia en inglés](N20-r2-receipt-2-en-phone-reference-atspi.json), [tablet con texto normal](N20-r2-receipt-system-tablet/screen.png) y [teléfono con texto normal](N20-r2-receipt-system-phone/screen.png). Los datos de Latte conservan Chico, Leche entera y la nota Unicode. El total real es MXN 65.00; los impuestos son MXN 8.97.

La inspección nativa abre y cierra el documento. No activa Imprimir recibo. La prueba de widgets comprueba el callback con datos controlados. La voz y la entrega física de papel siguen pendientes.

La [geometría](N20-capture-geometry-final.json) verifica **47 capturas**, incluidos los estados criticados. La [vista final](N20-final-preview/screen.png) ocupa sola el workspace **4**, a 1920 × 1080. El lanzador eligió ese workspace vacío. El POS vuelve a Español y Seguir al sistema.

**G63 y G64 se cierran en el alcance comprobado.** G39 conserva tareas secundarias pendientes. El recorrido no demuestra todos los registros de una lista larga ni todos los dispositivos.

## Pruebas, fuentes y datos

La [suite aislada](suite-N20-isolated.txt) aprueba **588 pruebas**. El [análisis](analysis-N20-isolated.txt) informa cero problemas. Las [57 pruebas específicas](N20-targeted-final-r2.txt) cubren menús, edición, modalidad, permisos, importes y revelado. Trece casos nuevos amplían N19.

Cuatro casos de documento combinan español e inglés con escalas 1 y 2. Usan las fuentes reales. Mantienen un importe de línea distinto del producto de cantidad y precio. Mantienen el total del snapshot. Comprueban variante, modificador, nota, descuento, impuestos y propina.

Cuatro casos de flujo comprueban apertura sin impresión y permiso de impresión presente o ausente. El callback controlado recibe identificador y snapshot sin cambios. Dos casos comprueban retorno por teclado a controles fuera de pantalla. Dos casos comprueban modalidad y restauración. Un caso reproduce y corrige G64.

El [registro final](N20-final-source.json) identifica 121 entradas Dart, AOT y proceso. Los 15 archivos propios coinciden con el checkout aislado. La [línea base](N20-baseline-binding.json) identifica el proceso N19 usado. La [primera compilación](N20-r1-source.json) conserva sus fuentes anteriores a G64. La [inspección](N20-import-inspection.json) no encuentra imports directos Material o Cupertino. No se añaden dependencias.

La [auditoría de lectura](N20-backend-paid.json) conserva los pagos, notas, variante, comanda y mesas capturados. La [comparación](N20-audit-comparison.json) detecta sólo `updated_at` de la comanda activa. Su relación con accesos por PIN es una inferencia. No se capturó la transacción exacta. El trabajo concurrente TPM queda fuera del diseño y de la compilación evaluada.

## Instrumentos, correcciones y límites

Flutter 3.47.5 y Dart 3.13.4 pertenecen al SDK fijado `6a19cca56475dbfba1478ee68d7bd0c2ef891da1`. Hyprland 0.56.2 verifica proceso, foco y workspace. xdotool 4.20260303.1 envía teclas XTEST a la ventana comprobada. AT-SPI observa el puente privado. Python 3.14.7 conserva geometría y fuentes. Se reutilizan los instrumentos del proyecto.

El primer test usa rutas y familias de fuentes equivocadas. Se corrigen con los assets existentes. Un test inglés espera Recent; el producto usa Newest. Se corrige el instrumento. El análisis solicita llaves en un bucle del test. Se corrige antes de la suite final.

El primer test de G64 trata un nodo nullable como obligatorio sin afirmar su presencia. Se corrige el acceso. Después, la limpieza de un SemanticsHandle ocurre demasiado tarde. Se mueve a `finally`, dentro del test. La prueba final anterior sigue fallando por geometría; la corregida pasa. Estos errores de instrumento permanecen registrados.

Los snapshots de profile devuelven un render tree vacío. Los PNG aportan evidencia visual; AT-SPI aporta estado del puente. Ninguno prueba pronunciación. N20 no mide nuevos cuadros ni extiende la medición de categorías a recibos.

Pendientes: recibos extensos, listas largas por teclado, operadores y permisos nativos adicionales, tareas secundarias con datos y errores, voz, IME, escala externa, dispositivos físicos, impresión y arranque frío. El contenido del recibo usa cajas completas; su costo con cientos de líneas no se ha medido.

## Nota acumulativa

La rúbrica mantiene sus pesos. Tarea 8.6; visual 8.3; cobertura 8.3; adaptación 8.7; accesibilidad 8.4; recuperación 8.3; fluidez 5.2. La media ponderada es **8.28 → 8.3**. La nota conserva todos los límites anteriores. N20 no cumple 10.0.
