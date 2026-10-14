# N19: Ventas puede usar el espacio del cuerpo

Fecha local: 8 de octubre de 2026. Base: N18, `2f440ee`. Nota acumulativa: **8.2/10**. Compilación nativa: N19-r1.

## Problema, evidencia y cambio

**G62.** En N18, búsqueda, filtros y avisos quedaban fijos. La lista recibía la altura restante. Con texto al 200%, Croissant aparecía con el importe incompleto. La [captura anterior](N18-r4-sales-2-phone-row/screen.png) conserva esa condición.

La [investigación primaria](N19-sales-reflow-evidence.md) contrasta el SDK fijado, los estados de consulta y la documentación artística original. Distingue hechos, propuestas y condiciones no verificadas. `CustomScrollView` y `SliverList.separated` pertenecen a Flutter Widgets. La composición conserva las primitivas propias del POS.

**Decisión UMI.** En el cuerpo estrecho, con escala efectiva de al menos 1.5, formulario, avisos y ventas comparten desplazamiento. Las filas tienen altura natural y creación diferida. El encabezado y la navegación permanecen accesibles. La búsqueda y los controles conservan su identidad al cambiar la composición.

Las filas usan claves por venta. La carga adicional queda al final de las ventas recibidas. Su error y reintento aparecen en ese mismo lugar. El controlador conserva páginas, cursor y generación de consulta. El cambio no añade un controlador ni modifica la API.

**Coste.** El operador debe volver hacia arriba para cambiar la búsqueda después de recorrer la lista. La corrección permite liberar espacio para los datos. No reduce el texto ni abrevia el importe.

## Comprobación nativa

La [primera vista al 200%](N19-sales-2-phone-start/screen.png) todavía muestra parte de la fila debajo del aviso. El [desplazamiento](N19-sales-2-phone-name-amount/screen.png) permite leer **Croissant y MXN 48.00 completos**. La [acción](N19-sales-2-phone-action/screen.png) también es alcanzable. Sigue desactivada porque otra comanda está en curso. La inspección no reanuda esa venta.

El [regreso a búsqueda](N19-sales-2-phone-return-search/screen.png) conserva «croissant», Suspendidas y Antiguas. La revisión incluye [inglés al 200%](N19-sales-2-en-phone-name-amount/screen.png), [español al 150%](N19-sales-1_5-phone-name-amount/screen.png), [tablet](N19-sales-2-tablet/screen.png), [escritorio](N19-sales-2-wide/screen.png) y [texto normal en teléfono](N19-sales-system-phone/screen.png).

El fallo controlado detiene sólo la API 4013 de la maqueta. Ventas muestra [error y Reintentar](N19-sales-2-phone-network-failure/screen.png), con la búsqueda conservada. La API restaurada devuelve salud 200. El reintento visible [recupera nombre e importe](N19-sales-2-phone-network-recovered/screen.png). El [registro de restauración](N19-api-restoration.json) conserva los procesos y el fallo del primer instrumento.

La [geometría](N19-capture-geometry-final.json) verifica **15 capturas** y sus dimensiones reales. El proceso Linux usa profile. La ventana estrecha mide 375 × 812; tablet, 1024 × 768; escritorio, 1280 × 720. La [vista final](N19-final-preview/screen.png) ocupa sola el workspace 3, a 1920 × 1080. Usa Español y Seguir al sistema.

**G62 se cierra en este alcance.** Nombre, importe, estado y acción se alcanzan con el aviso presente. El resultado comprende las condiciones anteriores y el operador Owner. No demuestra todos los registros, permisos o dispositivos físicos.

## Pruebas y conservación de datos

La [comparación anterior](N19-history-before-fix.txt) ejecuta las mismas cuatro pruebas de lectura sobre N18. Los dos casos al 150% pasan. Los dos casos al 200% fallan y registran desbordamiento vertical. La versión corregida aprueba los cuatro. El instrumento usa el viewport ancestro de la venta y gestos reales antes de buscar hijos diferidos.

Las [38 pruebas específicas](N19-sales-targeted.txt) aprueban. Siete casos nuevos amplían la suite anterior: cuatro combinan idioma y escala; uno añade estados de consulta al 200%; dos comprueban reintento de página. La búsqueda mantiene texto y foco al cambiar de composición mientras el campo está visible.

La prueba de paginación conserva la primera venta, bloquea el disparo duplicado y reintenta el mismo cursor. Después añade la segunda venta y elimina el reintento. Es evidencia de widgets y controlador con repositorio controlado. La fixture nativa tiene pocas ventas; N19 no demuestra paginación nativa de cincuenta registros.

La [suite aislada](suite-N19-isolated.txt) aprueba **575 pruebas**. El [análisis](analysis-N19-isolated.txt) informa cero problemas. La [inspección de imports](N19-import-inspection.json) no encuentra importación directa de Material ni Cupertino. No se añaden dependencias.

La [auditoría](N19-backend-paid.json) usa una transacción de lectura sobre la base desechable. Conserva los pagos, notas, variante, comanda y mesas capturados. La [comparación](N19-audit-comparison.json) detecta sólo `updated_at` de la comanda activa. La relación con el acceso por PIN es una inferencia. No se capturó la transacción exacta.

El [registro de fuentes](N19-final-source.json) identifica 120 entradas Dart, el AOT y el proceso. Los dos archivos propios coinciden con el checkout aislado. Las fuentes permanecen iguales después de las capturas. El registro excluye los cambios concurrentes de TPM.

## Criterio artístico

El [artículo original de Low-tech Magazine](https://solar.lowtechmagazine.com/2018/09/how-to-build-a-low-tech-website/) está fechado 2018-09-24. La documentación enlazada de Marie Otsuka indica edición 2018-10-30. El archivo del repositorio en 2023 no representa una nueva versión visual. La investigación conserva esa diferencia.

**Inferencia UMI.** La identidad puede permanecer en el signo, la tipografía y el ritmo de una columna que crece. No requiere inmovilizar el formulario. La dirección Estación conserva la firma, las fuentes y los colores UMI. La referencia artística aporta un mecanismo de identidad. No prueba velocidad operativa.

La revisión mejora la adaptación y la recuperación. La nota visual permanece en 8.2. No se atribuye una mejora estética a cada corrección funcional.

## Instrumentos, errores y límites

Flutter 3.47.5 y Dart 3.13.4 pertenecen al SDK fijado `6a19cca56475dbfba1478ee68d7bd0c2ef891da1`. Hyprland 0.56.2 verifica ventana y workspace. Flutter Driver acciona controles. Python 3.14.7 conserva geometría y fuentes; Node 24.21.0 ejecuta la API propia. Se reutilizan los instrumentos del proyecto.

La primera prueba mide el scroll del campo de búsqueda, en vez del viewport de la venta. Se corrige el buscador. Un primer traslado de claves las declara en otro estado y falla al compilar. Se corrige su propietario. Otros intentos buscan una fila o búsqueda todavía fuera del área construida. Los gestos finales construyen esos hijos antes de inspeccionarlos. Los registros conservan estos errores; no se presentan como fallos del producto.

El primer recorrido inglés intenta pulsar una opción fuera del viewport. El siguiente la desplaza antes de pulsar. Otra búsqueda de «Seguir al sistema» encuentra varias opciones de Ajustes. La acción final usa la sección Tamaño del texto. No se cambia la interfaz para aceptar ese buscador ambiguo.

El primer intento de restaurar la API supone `/usr/bin/node`. Esa ruta no existe. La restauración usa `process.execPath` y comprueba puerto, base, propietario y salud. El registro distingue esa corrección del funcionamiento del POS.

Los snapshots de profile devuelven un render tree vacío. Los PNG y dimensiones aportan la evidencia visual. No se infiere voz desde ese árbol. El documento primario contiene las condiciones que debe comprobar una revisión posterior de foco y semántica.

Pendientes: recorrido completo por Tab con contenido diferido, voz, IME, permisos y tareas secundarias con datos, escala externa, dispositivos físicos y arranque frío. N19 no mide nuevamente cuadros ni extiende la medición de categorías de N18 a Ventas.

## Nota acumulativa

Los pesos permanecen iguales. Tarea 8.5; visual 8.2; cobertura 8.1; adaptación 8.6; accesibilidad 8.2; recuperación 8.3; fluidez 5.2. La media es **8.165 → 8.2**. La revisión cierra G62 en su alcance y conserva G39 y los límites anteriores. N19 no cumple 10.0.
