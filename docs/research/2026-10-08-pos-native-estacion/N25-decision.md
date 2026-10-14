# N25 · conservar la acción, además del destino

Fecha local: 8 de octubre de 2026. Base N24 `05f9f40`. Compilación final **N25-r2**. Nota acumulativa **8.5/10**.

## Brecha y decisión

G72 conservaba Nueva venta enfocada antes del resize, pero devolvía foco al editor al cambiar la cabecera. La [investigación primaria](N25-focus-evidence.md) distingue propietario, anfitrión y petición de foco. La decisión conserva la intención de acción independientemente de su forma visual. UMI `#223979` y `#7692CB`, la carta y la comanda de N24 permanecen.

CatalogSurface posee tres FocusNode: Nueva venta, menú de acciones y cuenta. Los controles de cabecera reciben esos nodos. Antes de cambiar tamaño, presentación, zona desplazable o idioma, se observa qué acción tenía el foco primario. Después del frame se recupera el mismo control sólo si su contexto sigue montado, puede recibir foco y la ruta actual sigue vigente. Se revela su región. La recuperación no invoca el callback ni cambia una sección. Los nodos se disponen con su propietario.

La [línea base de cabecera](N25-header-baseline.txt) contiene seis casos, todos fallidos sobre N24. Los casos finales preservan la misma identidad para las tres acciones en ES/EN durante resize, ampliación de texto e idioma. Un séptimo caso retira Nueva venta de la superficie permitida: no se recupera ni aparece. Es una sesión controlada; no demuestra cambios de permisos del servidor en ejecución nativa.

## Hallazgo durante la primera compilación: G73

La revisión r1 conserva foco en la cabecera. Al aumentar texto desde Ajustes, la preparación Focus de Nueva venta falla. La [observación externa](N25-preparation-failure-observation.json) muestra nombre, enabled y Tap, pero no focusable ni Focus. [Shift+Tab la enfoca](N25-es-new-sale200-key-probe-atspi.json); después aparece su capacidad de foco. Se distingue esa condición de un fallo de teclado o un nombre ausente.

Dos [reproducciones de semántica](N25-semantics-baseline-r1.txt) fallan sobre r1 sin pedir foco antes de observar. Nueva venta cambiaba entre un botón con texto y otra clase de botón icono mientras Comanda estaba excluida. El SDK fijado conserva una capacidad de foco en el estado anfitrión para construir semántica. La relación causal precisa con ese caché es una inferencia; la sustitución de anfitrión y el resultado son comprobables.

La revisión r2 usa una sola clase de control para Nueva venta. El icono puede acompañar texto o mostrarse solo. Se conservan propietario, anfitrión, callback, nombre accesible y tamaño táctil. El texto visible mantiene su estilo; el botón dispone de tooltip en ambas presentaciones. No se cambia el SDK ni se simula una acción de foco inexistente en el puente.

## Verificación final

La [suite aislada](suite-N25-isolated.txt) aprueba **637 pruebas**, nueve nuevas sobre N24. Las [35 específicas](targeted-N25-isolated.txt) incluyen roles, cabecera, semántica, comanda, navegación y revelado de foco. El [análisis](analysis-N25-isolated.txt) tiene cero problemas; ambos archivos propios tienen formato comprobado. Las dos pruebas nuevas de semántica observan Focus antes de cualquier solicitud propia o tecla después del cambio desde una sección oculta.

El proceso final `3129484` se abre solo en workspace 4. La captura inicial de r2 muestra PIN con texto aumentado; se usa únicamente la fixture API 4013. Se vuelve a texto del sistema para repetir la primera condición, y después se aumenta desde Ajustes para reproducir G73.

La preparación externa enfoca Más y [Shift+Tab llega a Nueva venta](N25-r2-es-shift-tab-new-sale-atspi.json). [Después de resize, antes de otra tecla](N25-r2-es-new-sale-after-before-key-atspi.json), Nueva venta conserva foco. Tab continúa al menú de acciones; al volver a la composición amplia, ese menú sigue enfocado. Cuenta conserva foco al pasar por horizontal, ancho y teléfono.

Al 200%, la preparación Focus externa de [Nueva venta en español](N25-r2-es-new-sale200-preparation.json) funciona antes de otra tecla. Su [retorno en horizontal](N25-r2-es-new-sale200-after-before-key-atspi.json), el del [menú](N25-r2-es-more200-after-before-key-atspi.json) y el de [Cuenta](N25-r2-es-account200-after-before-key-atspi.json) conservan la acción. Inglés repite [New sale](N25-r2-en-new-sale200-after-before-key-atspi.json), [More](N25-r2-en-more200-after-before-key-atspi.json) y [Account](N25-r2-en-account200-after-before-key-atspi.json). Account continúa enfocado en [375 × 812 al 200%](N25-r2-en-account-phone200-atspi.json).

Se distinguen preparaciones AT-SPI de teclas XTEST. Nombre, foco, captura y proceso se observan después; el evento enviado por sí solo no se toma como resultado. No se activa Nueva venta, suspendido, cuenta, envío ni cobro. Las opciones de un menú ya abierto durante resize no están incluidas en esta comprobación. Voz, IME y escala externa siguen pendientes.

## Procedencia y continuidad

La [fuente final](N25-final-source.json) liga AOT, proceso y 123 entradas Dart. El [archivo contemporáneo r1](N25-r1-catalog_surface.dart.txt) coincide con su registro de huella; las revisiones r1/r2 difieren en el catálogo del target. Ambos archivos propios coinciden entre fork y checkout aislado. El launcher ELF no sustituye la identidad AOT. Los artefactos anteriores conservan sus huellas.

La [auditoría de lectura](N25-backend-paid.json) conserva pagos, notas, variante, comanda, mesas y timer. La [comparación](N25-audit-comparison.json) sólo registra actualización de timestamp. No se establece causalidad de transacción sin captura. Almacenamiento TPM y configuración concurrentes permanecen fuera de esta evaluación, runtime y commit. El commit de diseño no evalúa ese trabajo del usuario.

G72 y G73 se cierran en las condiciones documentadas. Las correcciones G69/G71 siguen cubiertas por las pruebas de comanda y por N24. G39 permanece abierta: faltan tareas secundarias nativas con datos, errores y roles adicionales. No se interpreta un retiro controlado de botón como cierre de esa brecha.

## Nota acumulativa

| Criterio | Peso | N25 | Evidencia y límite |
| --- | ---: | ---: | --- |
| Tarea y jerarquía | 20% | 8.8 | Comanda y acciones conservadas; uso por operadores pendiente. |
| Calidad visual e identidad | 20% | 8.3 | UMI y dirección mantenidas, sin aumento estético automático. |
| Cobertura y coherencia | 15% | 8.5 | Equivalencia de las tres acciones y presentación estable. G39 continúa. |
| Adaptación | 15% | 8.9 | Casos de cabecera y región útil; no todos los menús abiertos. |
| Accesibilidad | 15% | 8.7 | Intención y capacidad anunciada de foco; sin voz ni IME. |
| Respuesta y recuperación | 10% | 8.3 | Datos preservados; sin nueva prueba de fallo de impresión. |
| Fluidez | 5% | 6.0 | Benchmark N21 conservado; sin nuevo costo de foco medido. |

Media ponderada **8.465 → 8.5**. La [vista final](N25-r2-final-preview/screen.png) deja Comanda, Español, texto del sistema y búsqueda vacía, sola a pantalla completa. No cumple 10.0. N26 debe ampliar G39 con un pedido entrante y ticket de cocina poblados, un rol adicional y fallo/reintento. Mantiene listas extensas de ventas, memoria e inicio frío, operadores, voz, IME, escala externa, dispositivos físicos e impresión como condiciones pendientes.
