# N24 · leer la tarea cuando falta altura

Fecha local: 8 de octubre de 2026. Base N23: `20a0590`. Compilación evaluada: **N24-r1**, perfil nativo. Nota acumulativa: **8.4/10**, sin aumento.

## Problema, evidencia y decisión

G69 truncaba las acciones de comanda al 200%. G71 dejaba un campo de 76 px en un viewport de 28 px, aunque tenía foco. La [investigación primaria](N24-space-action-evidence.md) contrasta ampliación, reflujo, texto de acción y el mecanismo del SDK para revelar una región. La revisión conserva la dirección artística propia y los colores UMI `#223979` y `#7692CB`.

La carta utiliza una sola región desplazable cuando el área de trabajo real mide menos de 440 px de alto. Incluye cabecera, tipo de servicio, búsqueda, categorías y productos. La navegación y el disparador de Comanda permanecen disponibles. Con más altura se mantiene la composición anterior. El detalle de producto conserva su propietario y su layout; esta revisión no demuestra todas sus combinaciones con teclado virtual.

Un ancla de render del buscador permite revelar el campo completo después de cambiar constraints. Su FocusNode y controlador siguen siendo los mismos. El ancla no decide acciones ni permisos. Las acciones enfocadas dentro de un scroll también se revelan después del frame, mientras su ruta sea actual. Enfocar no activa el botón.

Los botones de comanda miden sus palabras con fuente, idioma y TextScaler reales, añadiendo el padding que usan. Si caben, comparten fila. Cuando no caben, las acciones secundarias ocupan otra fila y Cobrar ocupa el ancho. Si las secundarias tampoco caben, pasan a filas propias. Se conservan tooltips completos, permisos, envío, confirmación de vaciado y apertura del cobro. No se reduce texto para conservar una fila.

La comanda fija total y acciones cuando queda altura útil para las líneas. Con menos espacio, el documento entero se desplaza y el cierre permanece fijo. El umbral `208 × escala` es una política propia, no una medida suministrada por Flutter. El bloque final mantiene total y acciones juntos. No se promete que estén siempre visibles en la composición pequeña.

## Pruebas y revisión nativa

La [suite aislada](suite-N24-isolated.txt) aprueba **628 pruebas**: siete casos nuevos sobre las 621 de N23. Las [45 específicas](targeted-N24-isolated.txt) incluyen comanda, foco revelado, navegación, roles y cabecera. El [análisis](analysis-N24-isolated.txt) informa cero problemas; cuatro archivos propios tienen formato comprobado.

Los casos nuevos usan las fuentes reales, español e inglés. Comprueban palabras completas al 200%, editor enfocado antes y después de resize, consulta conservada, último producto alcanzable, confirmación de vaciado cancelada, importe canónico, Cobrar y cierre con seis líneas intactas. El caso de foco revela un botón fuera de pantalla sin activarlo; Enter lo activa una sola vez. La prueba anterior de comanda sobre teclado virtual conserva su resultado. No se declara IME validado por una inyección de viewInsets.

La [primera línea base](N24-baseline-tests.txt) falla en seis casos nuevos sobre N23; las dos pruebas de palabras identifican truncamiento. Las de pantalla baja encuentran recorte/overflow y también una suposición incorrecta del instrumento: el campo anterior no siempre tenía un ancestro Scrollable. Después se usa un finder persistente del catálogo. El último producto parecía fuera de pantalla porque el helper terminaba con un salto de scroll antes de otro frame. El [sondeo](N24-last-product-probe.txt) conserva ese estado intermedio; añadir el frame permite observar el render final. Es una corrección del instrumento, no una brecha adicional resuelta de producto.

El proceso nativo `3042254` se abre solo en el workspace 4. La captura inicial muestra PIN; se usa únicamente el acceso de la fixture desechable de API 4013. Se revisan ES/EN, 100%/200%, 1280 × 1000, 812 × 375 y 375 × 812. La medida de texto confirma las escalas reales.

| Caso nativo | Campo | Viewport de carta | Resultado |
| --- | ---: | ---: | --- |
| N23, EN200% | 76 px | 28 px | Texto recortado |
| [N24, ES200%](N24-es-editor-geometry.json) | 76 px | 175 px | Campo completo, consulta conservada |
| [N24, EN200%](N24-en-editor200-geometry.json) | 76 px | 175 px | Campo completo, consulta conservada |
| [N24, EN100%](N24-en-editor100-geometry.json) | 76 px | 195 px | Campo completo |
| [N24, ES100%](N24-es-editor100-geometry.json) | 76 px | 195 px | Campo completo |

La altura del campo con consulta incluye el control de borrado; no implica que el texto permanezca al 200%. Las [medidas del scaler](N24-native-text-measurements.json) y las capturas distinguen ese hecho. La [búsqueda ES](N24-es-landscape-editor200/screen.png) se puede leer; End se envía mediante XTEST al proceso con foco verificado y AT-SPI conserva el nodo text enfocado. No se confunde esa evidencia con voz o composición IME.

El [último producto](N24-es-landscape-last-product200/screen.png), el [bloque de acciones ES](N24-es-landscape-order-actions200/screen.png) y su [equivalente EN](N24-en-landscape-order-actions200/screen.png) se alcanzan. El total MXN 48.00 aparece junto a los tres verbos completos. El vaciado abre confirmación y se cancela en ambos idiomas. El cierre sigue alcanzable en horizontal y teléfono. Preparar Clear con Focus externo y pulsar Tab lleva a [Checkout enfocado](N24-en-tab-checkout-atspi.json); esa preparación se distingue del paso realizado con teclado. No se confirma un cobro ni se envía una orden nueva.

El instrumento inicialmente busca un footer que todavía no está construido. Se corrige el recorrido con rueda XTEST dentro de la ventana propia antes de consultar el control. Otra sonda declara una función `geometry` que reemplaza la lista del helper; se renombra `editor_geometry` y se retoma el estado observado. Los fallos se conservan separados de los recorridos completados. Los logs mantienen los espacios finales originales emitidos por las herramientas.

## Límite nuevo: G72

La inspección de la cabecera prepara Nueva venta mediante Focus externo. [Antes del resize](N24-toolbar-before-short-atspi.json) ese botón tiene foco. [Después, antes de otra tecla](N24-toolbar-after-short-before-key-atspi.json), sólo quedan panel y editor enfocados. No se activa Nueva venta ni se altera la comanda. Es una pérdida de intención al cambiar la composición de la cabecera. Se conserva como G72 abierta; no se atribuye su origen histórico sin una comparación adicional.

G68 y G70 continúan cubiertas por pruebas de navegación. Esa identidad no se extiende automáticamente a la cabecera. N24 cierra G69 y G71 en los casos medidos; G72 y G39 permanecen.

## Procedencia, datos y puntuación

La [fuente evaluada](N24-final-source.json) liga AOT, proceso y 123 entradas Dart. Los cuatro archivos propios coinciden entre fork y checkout aislado. El launcher ELF por sí solo no identifica el Dart compilado. Sólo existe una compilación N24-r1: `r2` en el nombre de la última captura indica una restauración posterior, no otro build.

La [auditoría de lectura](N24-backend-paid.json) preserva pagos, notas, variante, comanda, mesas y el timer original. La [comparación](N24-audit-comparison.json) registra únicamente un timestamp de actualización. No hay transacción capturada que pruebe la causa de ese timestamp. La evaluación y el commit excluyen el almacenamiento TPM y configuración concurrentes del usuario; tampoco están en el runtime aislado evaluado.

| Criterio | Peso | N24 | Evidencia y límite |
| --- | ---: | ---: | --- |
| Tarea y jerarquía | 20% | 8.8 | Acciones completas y total alcanzable. Operadores pendientes. |
| Calidad visual e identidad | 20% | 8.3 | UMI y dirección conservadas; sin aumento ornamental supuesto. |
| Cobertura y coherencia | 15% | 8.4 | Seis líneas en pruebas, una nativa. G39 y G72 abiertas. |
| Adaptación | 15% | 8.9 | Presupuesto vertical y acciones adaptadas en casos medidos. |
| Accesibilidad | 15% | 8.6 | Campo y acción enfocados se revelan; G72 limita continuidad. |
| Respuesta y recuperación | 10% | 8.3 | Confirmación cancelada y datos intactos; sin nuevos fallos de impresión. |
| Fluidez | 5% | 6.0 | Se conserva N21; no se atribuye un nuevo benchmark a N24. |

Media ponderada: **8.435 → 8.4**. La [vista final](N24-final-preview-r2/screen.png) vuelve a Comanda, Español, texto del sistema y búsqueda vacía, sola a pantalla completa. No cumple 10.0. N25 debe conservar la intención de foco de la cabecera y ampliar G39 con datos, errores y permisos nativos. Siguen pendientes listas extensas de ventas, memoria, inicio frío, operadores, voz, IME, escala externa, dispositivos físicos e impresión.
