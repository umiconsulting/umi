# N27 · integración y cantidades comprensibles

Revisión del 9 de octubre de 2026. Base de diseño: `48b55f7`, N26.
Destino autorizado: `/home/juan/Projects/umiconsulting/umi`, rama `feat/pos-fired-order-contract`.
La implementación está en su árbol de trabajo. La integración conserva los cambios locales anteriores.
La nota acumulativa es **8.7/10**, ponderada **8.705**. La identidad conserva UMI `#223979` y `#7692CB`.

## Integración y cobertura

La capa visual propia cubre acceso, carta, comanda, mesas, cocina, preparación, cobro, ventas, caja, clientes, inventario, hardware y ajustes.
Los campos, menús, diálogos, documentos, dibujos e iconos usan Flutter Widgets, sin importar Material ni Cupertino.
El [plan de cierre](../../plans/2026-10-09-pos-estacion-complete.md) distingue implementación, evidencia nativa y pruebas pendientes.
La ausencia de una importación visual no demuestra por sí sola que cada tarea funciona.

La integración compara el principal con la instantánea anterior al diseño, `de883b3`.
Usa una combinación de tres versiones para conservar los cambios posteriores del principal.
El único conflicto de contenido está en el formulario de conteo de caja.
La resolución conserva `countMethod=total_only`, su importe y su comando existente, con los controles propios del diseño.
Dos pruebas comprueban el envío de `1234.56` como `123456` centavos y la cancelación sin comando.

La [auditoría de conservación](N27-preservation-audit.json) comprueba **22 archivos modificados ajenos al diseño**, sin cambios de bytes.
El [registro inicial](N27-integration.json) conserva la primera aplicación.
El [registro final](N27-integration-final.json) identifica los archivos finales y sus huellas.
El principal conserva sus cambios locales sin un commit conjunto que mezcle su trabajo con el diseño.
TPM, configuración y composición concurrentes del fork quedan fuera de esta integración y de su puntuación.

La compilación normal conserva el identificador GTK `co.umiconsulting.umi_pos` y el título `UmiPOS`.
La maqueta usa una identidad separada sólo cuando `UMIPOS_ESTACION_PREVIEW=1`.
Cada apertura comprueba que el workspace está vacío antes de colocar la ventana.

## G78 · una lectura tardía alteraba la conexión

La evidencia anterior mostraba un aviso de conexión después de recuperar datos y salir de Cocina.
La reproducción nativa detiene la API desechable durante 36 segundos y sale hacia Comanda antes de terminar las lecturas.
La API se reanuda en `finally`. La comprobación no procesa dinero ni modifica inventario.

La [observación inmediata anterior](N27-baseline-immediately-after-exit.jsonl) registra conexión en línea, tres éxitos y cero fallos.
La [respuesta tardía anterior](N27-baseline-late-watch-result.jsonl) registra conexión degradada y dos fallos, con Cocina cerrada.
El controlador antiguo permite publicar los resultados del seguimiento y la lectura pendientes.
No se atribuye el problema a permisos, a una impresión de la captura ni a una caída permanente de la API.

El seguimiento ahora tiene una generación propia.
Salir de Cocina invalida ese seguimiento y las lecturas pendientes de la superficie.
Una apertura posterior no reactiva el bucle anterior.
Los resultados tardíos tampoco publican un éxito que oculte un fallo vigente.

Cuatro pruebas controlan respuestas tardías, reinicio y lectura pendiente.
Las [reproducciones anteriores](N27-watch-baseline.txt) y [de lectura](N27-poll-baseline.txt) conservan sus fallos.
La [repetición nativa corregida](N27-r1-late-watch-result.jsonl) mantiene conexión en línea, tres éxitos y cero fallos.
Esta comparación se hizo en la compilación aislada r1; el principal final incluye la misma corrección y la suite completa.
G78 se cierra en este alcance reproducido. No demuestra todos los fallos posibles de conexión.

## G79 y G80 · inventario expresa la tarea y la unidad

Los signos aislados de ajuste se convierten en **Aumentar** y **Reducir**.
Su nombre accesible identifica también el artículo.
El encabezado explica cuándo se necesita conexión y deja la versión interna de política fuera de la tarea.
Preparación llama **Objetivo** al nivel previsto.
Su estado vacío dirige al Inventario del **panel administrativo**, donde existe esa configuración.

La lectura poblada muestra 16 artículos y una ubicación existentes en la base desechable.
La cantidad anterior exponía enteros escalados y pedía conocer la representación interna de la API.
Ahora el ajuste, conteo y producción piden cantidades normales, con unidad y precisión explícitas.
Existencias, movimientos, diferencias, producción y reposición usan la misma presentación exacta.

**Hecho documentado:** [el contrato](../../../packages/contract/src/recipes.ts) define un entero seguro y una escala de cero a seis.
Los saldos usan la escala propia del artículo.
**Decisión UMI:** `1.25` a escala dos corresponde a `125`; una fracción adicional se rechaza, sin redondear.
Los ajustes y producción requieren un valor positivo. Un conteo acepta cero y requiere todos sus campos.
La confirmación conserva los comandos y las validaciones del servidor.

La revisión final detecta G81: el conteo pedía también artículos ajenos al almacén o archivados.
La API define el conteo completo con artículos activos que tienen saldo en el almacén seleccionado.
El formulario ahora usa esos mismos datos disponibles, sin pedir cantidades de otros artículos.
Una [reproducción anterior](N27-count-scope-baseline.txt) muestra cuatro campos donde sólo corresponde uno.
La prueba final completa el único campo válido y comprueba el artículo y la cantidad exactos del comando.
El servidor conserva la validación del alcance y de su instantánea; el cliente no elimina esas validaciones.
G81 se cierra para el conteo completo creado por el POS, en el alcance de esta prueba.

La conversión usa `BigInt` del SDK y texto decimal.
Una conversión mediante `double` puede perder exactitud en los valores máximos del contrato.
Una biblioteca nueva de números no aporta una ventaja necesaria a este caso acotado.
Esta es la razón escrita de la conversión propia; no sustituye las reglas de unidad o conversión del servidor.

Dos pruebas cubren el recorrido exacto de todas las escalas, signos de presentación y límites seguros.
Tres pruebas de superficie comprueban ajuste, conteo y producción, con decimales y entradas inválidas.
Cuatro pruebas adicionales comprueban inventario en 375 × 812 y 812 × 375, al 200%, con fuentes reales.
Las cuatro pruebas de adaptación ya pasaban sobre la base: amplían evidencia, sin atribuir un arreglo inexistente.

La [captura nativa final](N27-main-r5-quantity-invalid-phone200/screen.png) muestra `1.5 ml` para un artículo de escala cero.
La [lectura externa AT-SPI](N27-main-r5-quantity-invalid-atspi.json) confirma que **Confirmar** carece de estado habilitado y de acción.
La entrada se hizo con teclado nativo y foco de proceso verificado.
El formulario se cancela; la [auditoría final de solicitudes](N27-main-r5-api-flow-audit.json) no registra movimientos de inventario durante r5.
G79 y G80 se cierran para las tareas y casos documentados.

## Evidencia y límites del instrumento

La revisión del principal incluye [Clientes poblado](N27-main-customers-phone/screen.png), [Pedidos poblado](N27-main-incoming/screen.png),
[Inventario al 200%](N27-main-r5-inventory-phone200/screen.png), [Preparación al 200%](N27-main-r4-prep-phone200/screen.png)
y [Hardware sin dispositivos](N27-main-hardware-phone/screen.png).
La [geometría](N27-capture-geometry.json) comprueba tamaño solicitado, tamaño real, PNG, proceso y workspace.
La [medición de texto](N27-native-text-measurements.json) comprueba 16 → 32 y el regreso a 16.
Las pestañas de Cocina admiten desplazamiento horizontal cuando el texto no cabe.

Los errores de instrumento se conservan como límites, sin sumar puntos por ellos:

- VM Service permite leer campos en profile, pero rechaza la evaluación de expresiones en AOT.
- El primer selector de preparación esperaba una clase inexistente; se corrigió el selector.
- Los instrumentos de teclado y AT-SPI aún limitaban la ruta al fork; ahora reconocen el principal de prueba.
- La entrada emulada no cambió el texto; el teclado nativo sí lo hizo. No se atribuye un filtro inexistente al producto.
- Una comprobación esperaba `active`; la comanda canónica está `recovered`, igual que antes. Se corrigió la comprobación.

La fixture cambió antes de esta revisión: el ticket N26 ya estaba completado, versión seis.
No se atribuye ese cambio a una operación autorizada realizada aquí.
Preparación no tiene niveles objetivo: se inspecciona su estado vacío, sin afirmar una lista poblada.
La adopción completa del pedido, preparación poblada y operación autorizada de cocina mantienen pendiente la parte empírica de G39.

La [comparación final de datos](N27-main-r5-data-comparison.json) conserva ticket, artículos, ubicación y comanda originales.
La [auditoría comercial](N27-backend-paid.json) conserva dos cobros previos, 6200 y 6500 centavos, con cambio cero.
Conserva las notas Unicode, la variante y el tiempo original de mesa.
El recorrido de esta revisión no añade cobros ni movimientos de inventario.

## Verificación final

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| Suite del principal | **667 pruebas aprobadas** | [Registro](suite-N27-main.txt) |
| Análisis del principal | **0 problemas** | [Registro](analysis-N27-main.txt) |
| Cantidades e inventario específicos | 23 pruebas aprobadas | [Registro](inventory-N27-main.txt) |
| Cocina específica del fork | 54 pruebas aprobadas; también incluida en la suite principal | [Registro](kitchen-N27-fork.txt) |
| Conteo total del principal | Dos casos aprobados | [Registro](cash-policy-N27-main.txt) |
| Servicio de ventas API del principal | Seis pruebas aprobadas | [Registro](api-sale-N27-main.txt) |
| TypeScript de API | `tsc --noEmit`, salida 0 | [Registro de resultado](N27-verification.json) |
| Linux normal | Release compilado | [Registro](release-N27-main.txt) |
| Archivos y propiedad | Sin conflictos ni errores de whitespace; 22 archivos ajenos intactos | [Auditoría](N27-preservation-audit.json) |

La suite contiene dieciséis casos nuevos de esta revisión y un caso previo adicional del principal frente a N26.
No se atribuye toda la diferencia entre 650 y 667 al diseño.
El [vínculo entre fuente y proceso](N27-main-source-binding.json) registra fuentes y AOT finales del principal.
El launcher ELF, por sí solo, no identifica el código Dart.
La API de la maqueta procede del fork y usa el puerto 4013 y la base desechable.
No demuestra la ejecución nativa de todos los cambios concurrentes del backend principal.
Las capacidades locales de VM Service se redactan en los registros archivados.
La [normalización de registros](N27-log-transformations.json) quita espacios finales del terminal y líneas vacías al final, con huellas anteriores y posteriores.
La compilación r4 conserva la revisión de unidades y el teclado nativo.
La compilación final r5 incluye el alcance de conteo corregido después de esa crítica.
La [identidad de r4](N27-main-r4-source-binding.json) permanece separada de la identidad final.

## Crítica acumulativa

La revisión conserva la dirección anterior: fondo mineral, superficies opacas, tinta UMI, dibujos de café y total accesible.
La identidad visual no obtiene puntos por una compilación, un conteo de pruebas o una combinación de Git.
La conversión de cantidades mejora la relación entre texto, unidad y acción.
La generación de lecturas mejora la continuidad entre destinos.
Estas decisiones aplican las ramas de Uribe, Anartist, Low-tech y Carecore del [informe artístico](../2026-10-08-pos-estacion.md).
Las obras sostienen una intención de diseño; las pruebas del POS sostienen el comportamiento comprobado.

| Criterio | Peso | N27 | Fundamento y límite |
| --- | ---: | ---: | --- |
| Tarea y jerarquía | 20% | 9.0 | Unidad y precisión visibles; tareas completas con operadores pendientes. |
| Calidad visual e identidad | 20% | 8.3 | Dirección y colores conservados; sin nueva aprobación estética de operadores. |
| Cobertura y coherencia | 15% | 9.2 | Superficies integradas, clientes e inventario poblados; G39 empírica pendiente. |
| Adaptación | 15% | 9.0 | Teléfono y texto 200% comprobados; no representa todos los dispositivos. |
| Accesibilidad | 15% | 8.9 | Verbos, artículo, unidades y confirmación deshabilitada; voz e IME pendientes. |
| Respuesta y recuperación | 10% | 8.8 | Carrera tardía reproducida y corregida; no cubre todas las redes. |
| Fluidez | 5% | 6.0 | Benchmark N21 conservado; sin nueva medida de memoria o inicio frío. |

Media **8.705 → 8.7**. Se conserva la historia desde 1.0 y las brechas anteriores.
La [maqueta final](N27-main-r5-final-preview/screen.png) está abierta desde el principal, sola en workspace 3, Español y texto del sistema.
Operadores, voz, IME, escala externa, menús abiertos durante resize, listas extensas de ventas y dispositivos físicos siguen pendientes.
La impresión física, memoria e inicio frío también siguen pendientes.
La integración de la implementación termina esta fase. La evaluación artística **no alcanza 10.0**.
