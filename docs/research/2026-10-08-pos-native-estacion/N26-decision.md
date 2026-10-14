# N26 · tickets completos y permisos visibles

Revisión del 9 de octubre de 2026. Base N25 `09b039f`. Nota acumulativa **8.6/10**, ponderada **8.56**. Compilación final N26-r3. UMI conserva `#223979` y `#7692CB`; interfaz propia sin Material ni Cupertino.

## Crítica y cambio

G74 aparece al poblar Cocina: referencia y explicación del tiempo 2 recortadas, cantidad «2×» dividida y nombres comprimidos por metadatos. La [lectura primaria](N26-reading-evidence.md) fundamenta la revisión. El ticket crece con el tamaño de texto hasta el ancho disponible, sin alterar los grupos ni los comandos. La cantidad conserva su unidad; nombre, estados y conteo tienen espacio independiente. Referencia e instrucción de espera se leen completas. G74 se cierra en ES/EN, 375 × 812 y 1280 × 1000, al 200%.

G75 es un riesgo de interpretación: la revisión r1 repite «2×» y «×2» sin una etiqueta visible que distinga pedido y día. No se afirma confusión observada de un operador. La revisión final dice Hoy/Today al presentar el conteo diario y conserva el tooltip con pedido y pendiente. La [línea base del conteo](N26-count-baseline-r1.txt) falla en dos casos antes de ese texto.

G76 se observa con Consulta UmiPOS: la sesión sólo puede leer cocina, pero r1 ofrece Empezar y disparar el tiempo retenido. El intento Empezar recibe 403 y no avanza el ticket. La interfaz usa por separado kitchen.prepare, kitchen.ready, kitchen.complete y kitchen.recall, incluida la semántica y el tap de cada línea. Los cambios locales del controlador de entrada actualizan la superficie. Las [cinco reproducciones](N26-permission-baseline.txt) fallan antes; el rol nativo final ofrece Cocina/Ajustes sin comandos de cocina ni Comanda. No se equipara esta prueba con revocación remota de permisos en vivo.

G77 distingue el código real de la API: KITCHEN_PERMISSION_REQUIRED no entraba en el mensaje de permisos. Se reconoce ese alias y se evita aconsejar un nuevo intento como solución al acceso. La [prueba anterior](N26-refusal-code-baseline.txt) falla en esa equivalencia. La variante exacta del mensaje final se comprueba en código/prueba; no se fuerza otra negativa nativa después de ocultar correctamente la acción.

## Datos e instrumentos

La [preparación](N26-fixture-preparation.json) usa el writeOrder compilado del proyecto en la base desechable. Tres productos de la fixture pasan a requerir preparación. Crea un pedido Web por 33000 centavos: dos Latte, un Sándwich de pavo y un Cheesecake; conserva variantes y notas. El segundo tiempo permanece retenido. No publica mensajes ni procesa dinero.

La primera proyección carecía de estación y quedó en excepción; el tablero vacío de esa etapa no prueba un fallo visual. La [asignación sintética](N26-fixture-routing.json) prepara una estación y sólo las tres líneas de ese pedido. Registra antes/después y pasa esas líneas y ticket a cola. No se presenta esa preparación SQL como una acción de usuario o como prueba del flujo de configuración de cocina.

La [suite final aislada](suite-N26-isolated.txt) aprueba **650 pruebas**, trece nuevas sobre N25. Las [50 de cocina](kitchen-N26-isolated.txt) cubren lectura, conteo, grupos, permisos y recuperación; se ejecutaron antes del último alias, que también pasa en la suite final. El [análisis](analysis-N26-isolated.txt) no tiene problemas. Se usan las fuentes UMI reales. Las pruebas de error Ahem se conservan como instrumento descartado para atribuir desbordamientos.

Hay tres compilaciones N26. R1 permitió la inspección poblada y reveló conteo/permisos. R2 fue compilada, ligada y detenida antes de evaluar la revisión final; no se cuenta como una revisión nativa exitosa. R3 incluye el alias y todas las correcciones. La [fuente r1 contemporánea](N26-r1-kitchen_board_surface.dart.txt) coincide con su huella. Las fuentes r1/r2/r3 y AOT están identificadas; el launcher ELF no identifica Dart.

La revisión nativa repite texto e idiomas, [ticket amplio](N26-r3-es-kitchen-wide200/screen.png), [espera en teléfono](N26-r3-es-kitchen-phone200-held/screen.png) y [rol Consulta](N26-r3-viewer-phone200/screen.png). La lectura externa de navegación confirma sólo Cocina/Ajustes. Los comandos omitidos se comprueban sobre el árbol accesible, además de la captura. No se envía ni se cobra el pedido.

Durante una pausa controlada de la API local, [la pantalla conserva el ticket y anuncia Degraded](N26-r1-en-kitchen-phone200-network-failure/screen.png). La API se reanuda en finally. La recuperación se hace desde Refresh de cabecera. Esperar un botón Refresh kitchen fue un error del instrumento: el banner no estaba presente en esa observación. Los fallos de etiquetas de bloqueo/título y controles diferidos también se conservan como errores del instrumento; no se puntúan como defectos resueltos.

Los cambios de rol dejan la comanda previa suspendida, y la sesión siguiente abre una vacía. Al regresar al propietario se [reanuda el Croissant original por su clave de historial](N26-r3-resume-verification.txt), con total MXN 48.00. La [auditoría](N26-backend-paid.json), [comparación](N26-audit-comparison.json) y [lectura final del pedido y comanda](N26-final-data.json) registran los efectos y conservan pagos, notas y mesas anteriores. Se distingue la evolución de lifecycle de un simple timestamp. El primer instrumento ejecutó la reanudación, pero esperaba una clase inexistente _Cart; falló su verificación posterior. La observación y comprobación corregidas usan _CartPanel y no repiten el comando. Se conservan el resultado fallido y la verificación positiva. Las capacidades locales del VM se redactan antes de archivar logs; las huellas corresponden a esos artefactos redactados.

## Nota y límites

| Criterio | Peso | N26 |
| --- | ---: | ---: |
| Tarea y jerarquía | 20% | 8.8 |
| Calidad visual e identidad | 20% | 8.3 |
| Cobertura y coherencia | 15% | 8.8 |
| Adaptación | 15% | 9.0 |
| Accesibilidad | 15% | 8.8 |
| Respuesta y recuperación | 10% | 8.5 |
| Fluidez | 5% | 6.0 |

Media **8.56 → 8.6**. La mejora corresponde a lectura, datos, permisos y negativas precisas; no eleva automáticamente la nota artística ni atribuye un nuevo benchmark. G39 se amplía, pero sigue abierta: faltan la adopción completa del pedido entrante, la operación autorizada de cocina, preparación/inventario con datos y otros estados. La [vista final](N26-r3-final-preview/screen.png) queda sola en workspace 4, Español y texto del sistema.

Operadores, voz, IME, escala externa, menús abiertos durante resize, listas extensas de ventas, memoria/inicio frío y dispositivos/impresión físicos continúan pendientes. No es 10.0. El aviso de conexión inestable se observa también tras recuperar datos; no se establece aquí su causa de red o autorización y su diagnóstico queda pendiente. TPM y configuración concurrentes permanecen separados del runtime, la evaluación y el commit.
