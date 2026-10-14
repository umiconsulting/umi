# N18: texto legible y espacio para trabajar

Fecha local: 8 de octubre de 2026. Base: N17, `5b2cb80`. Nota acumulativa: **8.1/10**. Compilación final: N18-r4.

## Evidencia y decisión

La [investigación primaria](N18-text-scale-evidence.md) rastrea el SDK instalado, el portal Linux y las estrategias de texto. Distingue hechos, decisiones y condiciones pendientes. Flutter 3.47.5 y Dart 3.13.4 permiten una preferencia propia sin añadir componentes Material ni Cupertino.

El POS ofrece Seguir al sistema, Grande y Muy grande. Las dos opciones grandes aplican mínimos de 1.5 y 2.0. No reducen una preferencia mayor del sistema. Sistema conserva la estrategia original. El campo opcional mantiene la lectura del formato `display.v1` anterior. El fallo de escritura conserva la opción previa.

El [contrato `TextScaler.clamp`](https://api.flutter.dev/flutter/painting/TextScaler/clamp.html) limita cada tamaño resultante. La implementación mantiene los resultados no lineales superiores al mínimo. Modifica los inferiores. Las pruebas comprueban ambos casos; no equivalen a una ejecución Android.

**Inferencia UMI.** Una elección propia permite aumentar texto sin modificar preferencias globales del escritorio. El instrumento acciona el control visible. Su callback de lectura mide tamaños efectivos de 12, 14, 16, 20 y 28. No inyecta una escala ni modifica datos comerciales. El resultado prueba esta función del POS, no el transporte GTK o XDG.

## Brechas detectadas durante la crítica

**G58.** La navegación del teléfono divide Comanda al aumentar texto. Los cuatro controles pasan a dos filas. Las etiquetas mantienen su tamaño. **G60.** La barra lateral también divide Comanda al 200%. Su ancho usa las fuentes, las etiquetas y el escalador efectivos. Mide todas las etiquetas con el peso seleccionado para evitar cambios de ancho entre destinos.

**G59.** La carta de la primera compilación con texto grande deja los productos fuera del espacio visible. La búsqueda, las categorías y Frecuentes pasan al mismo desplazamiento que los productos. La rejilla puede usar una columna. El selector del servicio ocupa otra fila. Frecuentes usa filas con nombre e importe. El controlador anterior conserva Comer aquí y Para llevar como datos de la comanda.

**G60.** El estado vacío de Pedidos divide «entrantes.» dentro de la palabra. La tarjeta usa más ancho útil cuando crece el texto. Conserva la fuente y permite desplazar el mensaje y Actualizar. Las pruebas registran las cajas de cada palabra en español e inglés.

**G61.** El aviso de Caja ocupa la altura disponible al 200%. El [intento de desplazamiento anterior](N18-r3-cash-2-phone-fund-attempt/screen.png) no permite alcanzar Fondo inicial. El aviso y el área de trabajo pasan a un desplazamiento exterior en teléfono con texto grande. El área de trabajo conserva una altura de viewport y su desplazamiento interior.

La primera corrección revela otra parte de G61: las filas de denominación exceden el ancho. El importe pasa encima de los controles cuando no caben juntos. El campo aumenta con su fuente. Cada campo conserva su identidad. El área principal conserva su estado al cambiar la composición. La prueba cuenta MXN 1,500.00 y conserva ese valor al volver al tamaño normal. No solicita apertura de turno.

## Comprobación nativa

Las [mediciones reales](N18-native-text-measurements-r4.json) registran la preferencia conservada después de reiniciar. Una fuente base de 16 produce 32 con Muy grande y 24 con Grande. El regreso a Sistema produce 16 en este entorno. El [primer recorrido](N18-native-text-measurements-r1.json) conserva la secuencia inicial de las tres opciones. Estos resultados no prueban un sistema configurado por encima de 200%.

La carta permite alcanzar [Americano](N18-r4-catalog-2-phone-americano/screen.png) y [Galleta de chocolate](N18-r4-catalog-2-phone-galleta/screen.png) en 375 × 812. Nombre e importe se leen completos. [Pedidos](N18-r4-orders-2-phone/screen.png) conserva palabras completas. El [desplazamiento hasta Actualizar](N18-r4-orders-2-phone-action/screen.png) permite alcanzar su acción. La inspección incluye [inglés](N18-r4-orders-2-en-phone/screen.png), [Caja en tablet](N18-r4-cash-2-tablet/screen.png) y [barra lateral](N18-r4-cash-2-wide/screen.png).

La comprobación adicional alcanza los [controles del primer billete](N18-r4-cash-2-phone-controls/screen.png) y los [controles de la última moneda](N18-r4-cash-2-phone-last-coin/screen.png). El centrado del primer control corta parte superior de su etiqueta en esa captura. La última moneda muestra etiqueta, campo, botones y total. No se comprueban todas las denominaciones nativas ni todos los estados de Caja.

La [auditoría de lectura](N18-backend-paid.json) conserva pagos, notas, variante, comanda y mesas. La [comparación](N18-audit-comparison.json) detecta sólo un cambio de `updated_at` en la comanda activa. La atribución al acceso con PIN es una inferencia basada en el propietario anterior. No se registra la transacción exacta. La revisión no solicita cobros, aperturas ni traslados.

El [registro final](N18-final-source.json) identifica el AOT y 120 fuentes nativas sin cambios posteriores. Los 19 archivos propios coinciden con el checkout aislado. La [geometría final](N18-capture-geometry-final.json) confirma 1920 × 1080 y el workspace 3 vacío. La [vista final](N18-final-preview/screen.png) vuelve a Sistema y Español.

**G62, abierta.** En [Ventas con texto grande](N18-r4-sales-2-phone-row/screen.png), el formulario y el aviso consumen el área de la lista. El intento de desplazar Croissant no permite leer su importe completo. N18 conserva esta evidencia y no declara cierre de toda la adaptación. N19 debe reorganizar esa superficie y comprobar búsqueda, selección, importes y acciones.

La [suite aislada](suite-N18-isolated.txt) aprueba **568 pruebas**. Las [pruebas específicas](N18-targeted-after-fix.txt) aprueban **67 casos**. Trece casos nuevos comprueban preferencias, fuentes reales, navegación, estados vacíos y conservación del conteo. El [análisis](analysis-N18-isolated.txt) informa cero problemas. Una observación de orden de imports en una prueba se corrige antes del análisis final.

La [medición de categorías](N18-r4-catalog-timeline/catalog.timeline_summary.json) registra 39 cuadros, construcción máxima de 13.304 ms y rasterización máxima de 3.356 ms. Ningún cuadro excede los presupuestos registrados en doce cambios de categoría. La ventana comprueba 1280 × 720. La tarea no representa arranque frío, texto grande ni operación completa.

La evaluación excluye los cambios concurrentes de TPM. La compilación procede del checkout limpio con configuración y composición anteriores. Los registros identifican AOT y fuentes. La huella del lanzador ELF no identifica el programa Dart.

## Fundamento visual

La [guía de tipografía de IBM](https://www.ibm.com/design/language/typography/type-scale/) relaciona jerarquía, interlínea y distancia. Los criterios W3C de [aumento de texto](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) y [reflujo](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) orientan la crítica. No certifican este cliente nativo.

La [obra Low-tech Magazine de 2018](https://solar.lowtechmagazine.com/2018/09/how-to-build-a-low-tech-website/) conserva identidad mediante decisiones concretas de texto e imagen. El [trabajo Progress de 2022](https://thehtml.review/01/progress) conserva la relación entre texto y soporte. Estas fuentes prolongan la investigación artística anterior. No demuestran rapidez de caja.

La dirección Estación conserva títulos, firma, dibujos y colores UMI. La distribución responde al contenido aumentado. Las correcciones no añaden decoración ni justifican una mejora de la nota visual.

## Instrumentos y condiciones pendientes

Flutter Driver acciona el proceso Linux en profile. Hyprland 0.56.2 comprueba el workspace vacío y las dimensiones. El PNG comprueba las dimensiones de cada captura. Las fuentes de pruebas se cargan desde los mismos archivos IBM Plex Sans y Bricolage Grotesque del producto.

El primer instrumento busca un PageStorageKey mediante ValueKey. La búsqueda no identifica el desplazamiento. Se detiene sólo ese observador y se utiliza el tipo real. La lectura del SDK muestra que `scrollUntilVisible` no transmite su timeout al gesto interior. El registro distingue ese fallo del producto.

Las primeras pruebas cargan sólo IBM Plex Sans. Bricolage Grotesque seguía reemplazada por Ahem. Esa condición producía cortes ajenos a las fuentes reales. Las pruebas finales cargan ambas familias. No se reduce el texto para aceptar Ahem como medida nativa.

La primera adaptación del estado no preparado usa medición intrínseca sobre un LayoutBuilder. Se corrige `SliverFillRemaining.hasScrollBody`. La prueba del selector de servicio comprueba la rama sin datos preparados. El primer instrumento del conteo intenta buscar un control aún fuera del área construida. La prueba final desplaza el aviso y después acciona el control visible.

Pendientes: voz, composición IME, dispositivos físicos, cambios externos de escala del sistema, tareas secundarias con datos y errores, arranque frío y revisión integral. Una ventana Linux estrecha no demuestra operación en teléfono físico. N18 no cumple 10.0.


## Nota acumulativa

La misma rúbrica produce **8.095 → 8.1**. Adaptación alcanza 8.3 y accesibilidad 8.2 por las condiciones comprobadas. Calidad visual permanece en 8.2; cobertura permanece en 8.0 por G62. Las demás notas conservan N17. El [registro acumulativo](../2026-10-08-pos-native-iterations.md) contiene todos los pesos. La preferencia nueva no convierte la interfaz completa en un resultado de 10.0.
