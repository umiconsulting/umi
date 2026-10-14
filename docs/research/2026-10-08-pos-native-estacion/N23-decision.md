# N23: conservar la intención de foco entre composiciones

Fecha local: 8 de octubre de 2026. Base: N22, `43aab66`. Compilación final: N23-r2. Nota acumulativa: **8.4/10**, sin aumento.

## Brecha reproducida e investigación

**G68:** al ampliar con Más abierto, Ajustes permanece seleccionada pero el foco vuelve al contenedor. N22 conserva la [observación antes de Tab](N22-r1-after-resize-before-tab-atspi.json) y el siguiente Tab en Comanda. La [investigación primaria](N23-focus-action-evidence.md) contrasta el SDK fijado y criterios de retorno lógico. El gestor de foco conserva historia genérica; no identifica una sección equivalente que aparece en otra composición.

[FocusNode.requestFocus](https://api.flutter.dev/flutter/widgets/FocusNode/requestFocus.html) describe la petición diferida y su notificación. [FocusAttachment.detach](https://api.flutter.dev/flutter/widgets/FocusAttachment/detach.html) explica el desmontaje. APG contempla un [retorno que continúe el trabajo cuando desaparece el disparador](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Esta lectura formula un contrato propio; no prueba conformidad web ni lectura hablada del POS.

La [línea base de pruebas](N23-focus-baseline-tests.txt) conserva seis casos: uno aprueba y cinco fallan. Reproduce retorno desde menú y pérdida al cambiar filas/rail. El editor controlado ya conserva foco; no se presenta como un fallo que haya corregido N23.

## Decisión y propietarios

El State de PosNavigation conserva nodos por identidad. El catálogo entrega keys de TillSurface; los textos localizados no reemplazan esa identidad. PosPage mantiene su hijo de navegación dentro del mismo Flex y KeyedSubtree. No se añade GlobalKey ni se supone que esa key exterior conserva todos los controles internos.

Cuando el layout cambia, el propietario recupera el destino antes enfocado. Si queda oculto, enfoca Más y conserva la intención durante el ciclo de colapso. Esa intención termina cuando el foco abandona Más o se abren sus opciones. Los nodos permanecen hasta disponer la navegación. El catálogo tiene siete identidades estables; esta política no se generaliza a listas ilimitadas.

El menú informa qué identidad tiene foco. Al cerrar por resize, recuperar Cocina no activa Cocina si Ajustes continúa seleccionada. La activación requiere Enter o pulsación posterior. Si la identidad ya no está permitida, el retorno usa la sección vigente permitida. Los resultados del menú se resuelven contra la lista actual, sin reutilizar índices capturados.

Un trigger que desaparece retira sólo su ruta propia después del frame. Cambios en valores o habilitación cierran las opciones capturadas. Un editor que tenía foco no recibe una petición de navegación durante resize. El retorno se omite si otra ruta actual ocupa el trabajo. Esta coordinación conserva los callbacks y la autorización existentes.

La dirección visual y los colores UMI permanecen. El foco visible distingue intención de teclado y sección seleccionada. N23 no aumenta la valoración estética por un cambio de propietario.

## Segunda brecha encontrada durante la revisión

**G70:** la primera compilación nativa recupera Cocina tras ampliar, pero [Enter deja sólo el panel enfocado](N23-r1-kitchen-activated-atspi.json). El callback de sección limpia foco antes de cambiar contenido. La [prueba integral](N23-activation-baseline-tests.txt) reproduce ese resultado en CatalogSurface.

La navegación recupera el destino activado después del callback, si sigue permitido y presente. El callback conserva su limpieza previa, útil al abandonar un editor. La recuperación no vuelve a elegir la sección ni interfiere con una ruta que el callback haya abierto. La prueba integral añade teclado y continuidad a su comprobación existente de búsqueda, comanda, filtros y conteo.

Una [prueba intermedia adicional](N23-hidden-focus-baseline-tests.txt) reproduce pérdida de una identidad secundaria al colapsar y expandir. La revisión conserva esa intención mientras Más mantiene foco. Ese caso pertenece a la implementación intermedia, no a la línea base N22.

## Comprobación final

La [suite aislada](suite-N23-isolated.txt) aprueba **621 pruebas**. Son nueve casos nuevos de foco y un caso integral reforzado. Las [37 pruebas específicas](targeted-N23-isolated.txt) incluyen navegación, geometría, menú y roles. El [análisis final](analysis-N23-isolated.txt) informa cero problemas. El formato de los seis archivos propios está comprobado.

Las pruebas usan fuentes reales. Incluyen ES/EN, barra expandida y rail, cambio de filas, editor, constraints locales y retirada de una identidad con menú abierto. Comprueban foco, selección y callbacks. No se interpreta el caso controlado de lista permitida como validación de autorización del servidor ni actualización nativa de permisos.

La segunda compilación nativa comprueba retorno en español e inglés al 200%. [Ajustes vuelve a recibir foco antes de otra tecla](N23-r2-es-after-rail-before-key-atspi.json). Al reducir, [Más conserva foco](N23-r2-es-rail-to-more-before-key-atspi.json). Espacio abre opciones; Home y Down enfocan Cocina. Al expandir, [Cocina tiene foco mientras Ajustes sigue seleccionada](N23-r2-es-kitchen-focused-settings-selected-navigation.json).

[Enter abre Cocina conservando foco](N23-r2-es-kitchen-focus-after-activation-atspi.json). Tab llega a Pedidos. [Enter abre Pedidos conservando foco](N23-r2-es-orders-focus-after-activation-atspi.json). Son teclas XTEST sobre el proceso propio con foco del compositor verificado, seguidas de captura y AT-SPI. Los eventos enviados por sí solos no constituyen el resultado.

En inglés, el recorrido repite Cocina y la activación. Después se enfoca Settings mediante la acción Focus del puente externo, sin seleccionarla. Al reducir a 375 × 812, el control identificado es Kitchen dentro de Más; al volver a rail, [Settings recupera foco y Kitchen sigue seleccionada](N23-r2-en-restored-settings-kitchen-selected-navigation.json). Se distingue esta preparación externa del tramo realizado con teclado.

El editor nativo conserva un nodo text enfocado antes y después de resize; la consulta permanece. La prueba no demuestra IME ni anuncio hablado. La inspección del espacio visible revela una brecha adicional.

## G71: foco presente, región insuficiente para leer el campo

La [captura de edición](N23-r2-en-editor-measured/screen.png), 812 × 375 EN200%, muestra casi sólo el borde superior del campo. La [geometría nativa](N23-r2-editor-geometry.json) mide:

| Región | Superior | Inferior | Altura |
| --- | ---: | ---: | ---: |
| Campo de búsqueda | 163 | 239 | 76 px |
| Viewport de contenido | 163 | 191 | 28 px |

El campo conserva foco, pero su región es mayor que el viewport disponible. La captura confirma que el texto no se puede leer en ese estado. Es una brecha de presupuesto vertical; N23 no la cierra por conservar un FocusNode. No se atribuye su origen histórico sin repetir esa medición sobre otra compilación.

El sondeo usa comandos estándar getOffset de Flutter Driver desde la herramienta CLI. Lee un objeto de render por key y otro por tipo. Esa adición no cambia el target AOT ni instala componentes. No mide presentación física, CPU o memoria. G69 permanece: las acciones de comanda siguen truncadas al 200% en el caso documentado por N22. N24 debe resolver las dos condiciones de espacio sin ocultar importes o intención de acción.

## Correcciones del instrumento y procedencia

El primer test utiliza un nombre de componente inexistente, PosTextField; se corrige a PosField antes de reproducir comportamiento. El primer análisis identifica un `!` redundante. La sonda de geometría busca «Very large»; la traducción real es «Extra large». Se corrige la ruta de lectura. Un diccionario local reemplaza accidentalmente la lista del helper de medidas: la geometría ya estaba guardada, pero falla el registro de texto del sistema. Se cambia el nombre local y se completa la restauración mediante un script nuevo. Los fallos se conservan por separado y no se contabilizan como pruebas aprobadas. Los logs conservan espacios finales emitidos por las herramientas; el control de whitespace se aplica al código y documentos editados, sin limpiar esa evidencia después.

La [fuente final](N23-final-source.json) liga el proceso, el AOT y 123 entradas Dart. La [recuperación de fuentes r1](N23-r1-source-recovery.json) conserva los dos archivos de runtime modificados respecto de la base. Collections se reconstruye deshaciendo los cambios r2 y aplicando formato de lenguaje 3.12; su huella coincide exactamente con el registro contemporáneo r1. Catalog no cambia entre ambas revisiones. Son archivos recuperados después, no un archivo contemporáneo supuesto. La CLI de geometría no está entre esas entradas del target; su huella se incluye en el manifest de fuentes propias. Los seis archivos propios coinciden con el checkout aislado. TPM sigue fuera del cambio de diseño y de la compilación evaluada.

Flutter 3.47.5/Dart 3.13.4 y el SDK `6a19cca56475dbfba1478ee68d7bd0c2ef891da1` proporcionan widgets y foco. Hyprland confirma geometría y workspace vacío. XTEST y AT-SPI aportan acción y estado externos. No se añade biblioteca UI. Los 229 artefactos N21 y 167 N22 conservan sus huellas.

La [auditoría de lectura](N23-backend-paid.json) conserva importes, pagos, notas, variante, comanda y mesas. La [comparación](N23-audit-comparison.json) sólo cambia `updated_at` de la comanda activa. Su relación con acceso y reinicios es una inferencia, sin transacción capturada. No se envían tickets, vaciados ni nuevos cobros en esta revisión.

## Nota acumulativa y siguiente revisión

| Criterio | Peso | N23 | Evidencia y límite |
| --- | ---: | ---: | --- |
| Tarea y jerarquía | 20% | 8.7 | Recorrido de secciones completo; G69 y G71 limitan tareas. |
| Calidad visual e identidad | 20% | 8.3 | Dirección y UMI conservados; no cambia por corregir foco. |
| Cobertura y coherencia | 15% | 8.4 | Identidad, retirada controlada y activación integral. G39 permanece. |
| Adaptación | 15% | 8.7 | Retorno y etiquetas; G71 reduce la valoración de región útil. |
| Accesibilidad | 15% | 8.6 | Foco equivalente, intención y continuidad nativos; voz e IME pendientes. |
| Respuesta y recuperación | 10% | 8.3 | Datos preservados. Sin nuevas pruebas de fallos de impresión. |
| Fluidez | 5% | 6.0 | Se conserva medición N21. No se mide costo de nodos o nuevo layout. |

Media ponderada: **8.385 → 8.4**, sin aumento de la nota publicada. G68 y G70 se cierran en su alcance comprobado. G69 y G71 permanecen. La [vista final](N23-final-preview-r2/screen.png) vuelve a Comanda, Español, texto del sistema y búsqueda vacía, sola a pantalla completa en el workspace 4.

N23 no cumple 10.0. N24 debe resolver el presupuesto vertical de G71 y las acciones de G69, repetir texto/caret legible, contenido final, importes y cierre en las composiciones pequeñas. Conserva G39, estados secundarios poblados y errores, listas extensas de ventas, memoria e inicio frío. Mantiene operadores, voz, IME, escala externa, dispositivos físicos e impresión como condiciones pendientes.
