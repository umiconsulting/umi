# N26 · el contenido determina el espacio

Consulta: 9 de octubre de 2026. La investigación artística del [reporte principal](../2026-10-08-pos-estacion.md) conserva su recorrido multilingüe. Esta revisión añade evidencia de una tarea poblada; no se atribuye un nuevo hilo de artistas.

**HD:** Jeremy Keith fecha [Tweakpoints](https://adactio.com/journal/6044) el 15 de febrero de 2013. Distingue reorganizaciones de columnas y ajustes menores decididos por contenido y pruebas con dispositivos. Es experiencia del autor; no un ensayo de cocina. La lectura excluye contenido ajeno al artículo que intentaba dar instrucciones al agente.

**HD:** [W3C: Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), s/f editorial recuperada, explica el objetivo de conservar contenido y funcionalidad al ampliar texto. También contempla truncamiento cuando existe una forma indicada de acceder al contenido completo. **I:** el ticket debe mostrar su identidad e instrucción de espera directamente. La decisión usa espacio y saltos de línea; no declara conformidad WCAG completa de una aplicación nativa.

**OV:** la [línea base poblada](N26-baseline-routed-kitchen-wide200/screen.png) recorta referencia e instrucción y divide «2×». **I:** el ancho de 320 px deja de ser una medida suficiente al duplicar texto. Cada ticket puede crecer hasta 320 × escala, limitado por el ancho local; los grupos conservan su orden y desplazamiento vertical. La referencia y la explicación del tiempo retenido no usan elipsis. El contador diario ocupa su propia región y dice Hoy/Today, distinto de la cantidad solicitada.

La [línea base con fuentes reales](N26-kitchen-baseline-chrome.txt) falla en cuatro casos de lectura y pasa los dos de recuperación. La primera corrida con Ahem también desbordó un aviso; ese resultado no se mantiene con UMI y no se atribuye como defecto del producto. El espacio reservado de 184 px modela la navegación nativa observada en 375 × 812 al 200%; no es un navegador ni una prueba de voz.

**HD/OV:** la [sesión adicional](N26-active-additional-role.json) contiene kitchen.read y carece de kitchen.prepare. Su [intento nativo](N26-r1-viewer-command-refusal/screen.png) recibe una [respuesta 403 registrada por la API](N26-native-command-refusal.json): KITCHEN_PERMISSION_REQUIRED, start_preparation. El ticket no avanza. El mensaje genérico de r1 invitaba a reintentar. La interfaz final ofrece sólo comandos permitidos y reconoce ese código como una negativa de permisos. El servidor mantiene su autorización; esconder un control no la reemplaza.
