# ONCA: rechazo de efectivo durante la validación del replay

## Defecto reproducido

Con la API disponible, una escritura del carrito puede seguir pendiente mientras el replay valida su sesión.
El modo nativo permite registrar efectivo en el journal después de conservar los comandos anteriores.
El cliente usaba `_worthTryingOnline` para decidir también si ese registro local estaba autorizado.
Ese valor es falso cuando existen comandos pendientes, aunque la conexión siga en línea.
La elegibilidad recibía `localCommitWhileOnline=false` y devolvía `policy_invalid` con una política válida.
El cobro no llegaba a la API.

La regresión usa `CartCommandQueue`, `OfflineRecoveryController`, el journal cifrado y la política reales.
Sólo demora las respuestas externas de escritura y de inicio del replay.
Antes del cambio obtiene `policy_invalid`, con conexión `online`, recuperación `validatingAuthority` y un comando pendiente.

## Corrección

El permiso `localCommitWhileOnline` depende de la opción explícita `localFirstFastPathEnabled`.
Los comandos pendientes conservan su orden y no revocan esa opción.
La conservación durable sigue siendo obligatoria antes del efectivo.
El servicio conserva la validación de autoridad, política, límites e importe recibido.
La identidad del cobro conserva la deduplicación y el replay conserva el orden por secuencia.

El modo deshabilitado sigue sin crear efectivo local mientras el cliente está en línea.
Dos confirmaciones del mismo cobro producen una sola entrada de efectivo.
No se cambia la API, el esquema de base de datos ni el formato del journal.

## Validación

- Regresión roja antes del cambio: `policy_invalid`.
- Dos regresiones verdes después del cambio: modo habilitado y modo deshabilitado.
- 171 pruebas relacionadas aprobadas: checkout, modo local, cola, política y ciclo de venta.
- Análisis de los dos archivos Dart sin incidencias.
- Formato Dart y `git diff --check` aprobados.
- Revisión independiente sin hallazgos bloqueantes.

Se usaron Flutter 3.47.5 y Dart 3.13.4 en Juan-PC como el usuario `juan`.
Las pruebas no ejecutan cobros ni escrituras en producción.
La evidencia se conserva en `/home/juan/.local/state/onca-support-20261104/checkout-state/`:
`cash-replay-handshake-red.log`, `cash-replay-handshake-green.log`, `cash-block-regression-suite.log` y `cash-block-analyze.log`.

## Alcance y entrega

Este defecto es independiente del límite que cuenta historial confirmado como capacidad activa del journal.
Ese límite se corrige en otro PR.
La prueba combinada con 250 confirmados necesita ambas correcciones para completar el efectivo.
La cuenta real del incidente se recuperó antes de cambiar este código.
Su código técnico histórico no quedó conservado; esta reproducción no prueba por sí sola esa atribución.

La corrección requiere aprobación del PR y una nueva build antes de probarla en las tablets.
No se generó ni instaló otro APK en esta investigación.
El rollback consiste en revertir este cambio y reconstruir el APK anterior.
No se requiere una migración de base de datos.
