# N21: recibos extensos sin construir todo al abrir

Fecha local: 8 de octubre de 2026. Base: N20, `c6e7b25`. Compilación final: N21-r2. Nota acumulativa: **8.4/10**.

## Problema reproducido y criterio

La [investigación primaria](N21-long-document-evidence.md) distingue límites del contrato, transporte, presentación y medición. El contrato declara entre una y 500 líneas. Cada descripción permite hasta 300 caracteres. Cada nota permite hasta 500. Un objeto local de 500 líneas no demuestra que cualquier combinación máxima llegue por HTTP. El cliente limita la respuesta a 2 MiB.

**G65.** N20 construye todas las líneas al abrir. La [línea base de 500](N21-baseline-500-r1.json) registra 500 widgets de artículo. Sus tres aperturas registran máximos de construcción de 109.361, 95.092 y 100.316 ms. El costo crece con contenido fuera de vista. La [fuente de esa compilación](N21-baseline-source.json) conserva N20 con instrumentación nueva de desarrollo.

**G66.** [PageDown desde Cerrar](N21-baseline-500-page-down/screen.png) deja el documento en cero. La [lectura posterior](N21-baseline-500-after-page-down.json) confirma la posición. La prueba usa XTEST sobre el proceso propio con foco verificado. No atribuye el resultado a un evento supuesto.

**Hecho documentado.** [Flutter SingleChildScrollView](https://api.flutter.dev/flutter/widgets/SingleChildScrollView-class.html) distingue contenido breve de listas extensas. [SliverList](https://api.flutter.dev/flutter/widgets/SliverList-class.html) construye contenido cercano y estima alturas pendientes. [ScrollAction](https://api.flutter.dev/flutter/widgets/ScrollAction-class.html) usa un scrollable antecesor o un controlador primario. La asociación automática del controlador tiene diferencias entre plataformas.

## Decisión y dirección visual

`ReceiptDocument` usa un solo `CustomScrollView`. Un encabezado precede la lista de artículos. Los totales siguen a la lista. Las líneas conservan altura natural, variantes, modificadores, notas e importes del snapshot. El constructor de artículos convierte sólo los datos que necesita presentar.

El diálogo da una altura finita al viewport. `shrinkWrap` conserva el tamaño natural del recibo breve. La prueba comprueba creación diferida bajo esa restricción. No se coloca otra lista dentro de un desplazamiento exterior. No se añade un umbral que produzca dos caminos de presentación.

**Tradeoff.** [shrinkWrap](https://api.flutter.dev/flutter/widgets/ScrollView/shrinkWrap.html) requiere recalcular tamaño al desplazar. La lista estima extensión cuando las alturas varían. La elección conserva el diálogo breve y reduce el costo medido del extenso. No demuestra costo constante ni elimina el snapshot completo recibido.

El diálogo comparte un controlador primario explícito entre documento y acciones. PageDown y PageUp funcionan desde Cerrar. El cierre y la impresión conservan sus propietarios. La lista declara su cantidad semántica. Los separadores y encabezados no se cuentan como artículos.

La firma, reglas, tipografía y colores UMI permanecen. La [lectura final del documento](N21-r2-500-es2-phone-total/screen.png) organiza los importes sin adornos nuevos. La calidad visual mantiene **8.3**. El cambio aporta respuesta y acceso, no un aumento estético por optimización.

## Medición final y límites

El [resumen de profile](N21-profile-summary.json) conserva cada lectura bruta y su número de frames. Usa tres aperturas por tamaño y compilación. Los documentos tienen 1, 50 y 500 líneas. Conservan datos, español, escala del sistema y ventana de 375 × 812.

| Caso | Widgets de artículo al abrir N20 | Widgets al abrir N21-r2 | Mediana del máximo de construcción N20 | Mediana N21-r2 |
| --- | ---: | ---: | ---: | ---: |
| 1 línea | 1 | 1 | 1.789 ms | 2.249 ms |
| 50 líneas | 50 | 6 | 9.988 ms | 2.927 ms |
| 500 líneas | 500 | 6 | 100.316 ms | 3.164 ms |

La reapertura breve no mejora en esta muestra. Los máximos de 500 líneas bajan en las tres aperturas finales. El resultado sustenta G65 en este caso. No se presenta como una promesa universal de rendimiento.

La medición usa `SchedulerBinding.addTimingsCallback` y tiempos reales del motor. El instrumento espera el lote final. Las lecturas comparadas ocurren antes de capturas y teclas. Los percentiles son descriptivos de muestras pequeñas. No representan una distribución estable de operadores.

El monitor declara 144.00101 Hz: el presupuesto nominal es 6.944 ms. Esa configuración no prueba la frecuencia de presentación del motor. El resumen no transforma tiempos en cuadros físicos perdidos. No mide memoria, consulta HTTP, inicio frío ni latencia completa hasta píxeles visibles.

El [documento al final](N21-r2-500-system-phone-end-data.json) llega a 78097 píxeles, igual al máximo actualizado. Conserva cinco widgets de artículo. La extensión inicial estimada era 69676. Este cambio es esperado para alturas variables. No se interpreta la primera estimación como longitud exacta.

## Comprobación nativa y pruebas

La comprobación usa el mismo componente dentro del POS Linux profile. El target de desarrollo abre documentos controlados mediante la extensión Driver. Cada documento dice «Documento de prueba» y «Sin venta ni pago». Su referencia dice `CONTROLLED-N21-500-NOT-A-SALE`. El instrumento no llama a la API ni ofrece impresión. No es una venta real ni prueba del transporte.

Se comprueban inicio, PageDown, PageUp, región final, total, referencia y cierre. La [última línea al 200%](N21-r2-500-es2-phone-last-line/screen.png) conserva nombre, variante, nota y pareja de importes. La [referencia enfocada](N21-r2-500-es2-phone-reference/screen.png) vuelve a vista. [AT-SPI](N21-r2-500-es2-phone-reference-atspi.json) confirma el nombre y el foco.

La comprobación se repite en [horizontal al 200%](N21-r2-500-es2-landscape-total/screen.png) y en [inglés al 200%](N21-r2-500-en2-phone-total/screen.png). PageDown y PageUp cambian posición con Cerrar enfocado. Tab revela la referencia. Escape cierra. Los dumps del puente no prueban lectura hablada.

El flujo canónico abre el recibo pagado de Latte desde Ventas. Conserva Chico, Leche entera, nota Unicode, MXN 65.00 e impuestos MXN 8.97. La revisión registra [inglés al 200%](N21-r2-paid-latte-en2-total/screen.png), escritorio, tablet y teléfono con texto normal. Se enfoca Imprimir recibo sin activarlo. Escape retorna al disparador. La consulta «latte» permanece.

La [suite aislada](suite-N21-isolated.txt) aprueba **596 pruebas**. El [análisis](analysis-N21-isolated.txt) informa cero problemas. Ocho pruebas nuevas combinan ES/EN, escalas 1/2 y teléfono/horizontal. Usan 500 líneas de alturas variables y las fuentes reales. Comprueban creación acotada, teclado desde acciones, último artículo, total canónico, referencia y cierre. Los permisos y el callback de impresión mantienen las pruebas N20.

## Procedencia, datos e instrumentos

La [fuente final](N21-final-source.json) identifica AOT, proceso y 122 entradas Dart. La [primera revisión](N21-r1-source.json) conserva la medición anterior al count semántico explícito. Los siete archivos propios coinciden con el checkout aislado. La compilación evaluada excluye el trabajo concurrente TPM.

La auditoría de lectura conserva dos pagos en efectivo, notas, variante, comanda y mesas. La [comparación](N21-audit-comparison.json) sólo cambia `updated_at` de la comanda activa. La relación con acceso y reinicios es una inferencia. No se capturó la transacción exacta.

Flutter 3.47.5, Dart 3.13.4 y el SDK `6a19cca56475dbfba1478ee68d7bd0c2ef891da1` proporcionan componentes y medición. Driver utiliza la extensión existente. Hyprland 0.56.2 comprueba workspace, proceso y geometría. xdotool 4.20260303.1 envía teclas XTEST. AT-SPI inspecciona el bus privado. Python 3.14.7 conserva artefactos y huellas. No se añade una dependencia UI.

La herramienta ya existe, está instalada y admite automatización. El costo es instrumentación del target de desarrollo. El fallback es timeline del SDK. La comprobación PNG usa su cabecera estándar para contrastar dimensión; no reemplaza el profiler.

## Correcciones durante la revisión

La primera compilación omite `super.key` en el constructor de artículo. Se corrige. Un test mueve 4000 píxeles por gesto y no alcanza el destino horizontal. Se cambia a gestos pequeños con límite explícito. Otro Finder omite el total retenido fuera de escena. Se solicita ese nodo retenido de forma explícita. La prueba después comprueba su geometría visible.

El primer análisis solicita orden de imports del target Driver. Se corrige antes de la compilación final. El primer intento de acceso espera un PIN que la sesión restaurada ya superó. Se observa la página nativa y se continúa desde su estado real. Los fallos de instrumento quedan conservados.

La [geometría](N21-capture-geometry-final.json) conserva 49 registros contemporáneos y una recuperación de dimensiones PNG. El contador de una captura inicial fue reemplazado por otro script. La ejecución original terminó bien y comprobó sus condiciones. Su metadata original del compositor no se conserva; el registro deja esa limitación visible. La [vista final](N21-final-preview/screen.png) ocupa sola el workspace 4, a 1920 × 1080. El POS vuelve a Español y Seguir al sistema.

El bus privado informa fallos de proxies del portal de escritorio. El POS compila y funciona. No se atribuye funcionamiento de selección de archivos o impresión física a esta sesión. Los artefactos de profile siguen sin render tree útil. PNG y AT-SPI conservan pruebas complementarias.

## Brecha nueva en la composición horizontal

**G67.** La [vista horizontal sin diálogo](N21-r2-500-es2-landscape-dismiss/screen.png), de 812 × 375 al 200%, parte «Comanda» dentro de la palabra. El texto permanece completo, pero su lectura y ritmo pierden claridad. Los otros seis destinos conservan una línea. La mejora del recibo no cierra esta brecha de navegación. Adaptación mantiene 8.7 hasta corregirla y comprobar los destinos.

## Nota acumulativa y trabajo restante

Tarea 8.7; visual 8.3; cobertura 8.3; adaptación 8.7; accesibilidad 8.5; recuperación 8.3; fluidez 6.0. Los pesos se conservan. La media ponderada es **8.355 → 8.4**. **G65 y G66 se cierran en el alcance comprobado.**

N21 no cumple 10.0. Conserva G39, G67 y las tareas integrales pendientes. Faltan listas extensas de ventas por teclado, estados secundarios con datos y errores, operadores y permisos nativos adicionales, memoria e inicio frío. Permanecen voz, IME, escala externa, pruebas con operadores y dispositivos físicos. Impresión, fallos de impresión y entrega de papel siguen pendientes. El stress local no prueba el peor payload contractual.
