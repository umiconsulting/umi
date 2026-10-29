# ONCA: entrega de soporte del 27 de octubre de 2026

## Estado de esta entrega

La cuenta 020 del 27 quedó cobrada una sola vez por MXN 100.00 en efectivo.
El recibo es 0019 y el saldo pendiente es cero.
La recuperación operativa se ejecutó mediante clics reales en UmiPOS 333.
La corrección preventiva del sync quedó instalada en la build 334 en Caja, Barra, Cocina y Mesero.
CI y las 181 pruebas pasaron. El doctor 334 terminó con código 0.

Repositorio de soporte en juan-PC: `/home/juan/umi-onca-bugfix-20261024`.
Bitácora principal: `docs/reports/ONCA_PRODUCTION_BUG_LOG.md`.
Incidente actual: `docs/reports/2026-10-27-onca-production-bug-010.md`.

## Skill y acceso

La skill completa está instalada en la Mac:

`/Users/moon/.codex/skills/onca-production-support`

La copia del repositorio en juan-PC está en:

`/home/juan/umi-onca-bugfix-20261024/.agents/skills/onca-production-support`

Ambas contienen SKILL.md, agents/openai.yaml, references y scripts.
Los tres scripts conservan permiso de ejecución.
Los dos SKILL.md tienen SHA-256 `6870e309f8a14fcd63dbb6136727b138ff9f10fbc8c8e488a04533a0baf4a699`.

El acceso SSH usa Tailscale y verificación estricta.
Host: root@100.109.51.39, puerto 22.
Machine-id verificado: `97d302e7018b42eb80e9a56e78dab7b6`.
Huella ED25519: `SHA256:JNZVk8Jse74VgShkRlHZhdWUmZ+M+Ha6iSaXlB07KaE`.
Los comandos del repositorio se ejecutan como juan.

La llave pública siguiente ya fue autorizada en root:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUmRh9dE498SR4B1034uzrq8AKJU31Pkft+KGS3i78h umi-hola@github.com-umi
```

El soporte no muestra ni copia la llave privada.
El acceso verificado al VPS es juan@2.24.204.15.
Producción usa el contenedor umi-api-umi-api-1, versión onca-445bedac y contrato 2.45.0.
La configuración local del repositorio usa umi_local y no representa producción.

## Reconexión automática de Caja

Umi Support 1.0.1, código 2, está instalado en Caja.
Accesibilidad sigue habilitada.
El servicio acepta sólo el diálogo auténtico de Android para la red y el BSSID autorizados.
KeepADB comunica el puerto nuevo y juan-PC reconecta ADB.

El reinicio comprobado pasó de boot_count 7 a 8.
El endpoint cambió de 38475 a 35049.
La recuperación automática tardó 75.1 segundos desde el inicio del monitor.
El tiempo desde solicitar el reinicio fue 86.7 segundos.
No se introdujo el endpoint ni se aceptó el diálogo de forma manual en esa prueba.

La ejecución funciona en segundo plano.
Juan-PC debe permanecer encendido y conectado a Tailscale.
El receptor onca-adb-register.service está enabled y active, con Linger=yes.
La Mac no es necesaria para esa recuperación.

Código, pruebas y APK en juan-PC:

- `tools/umi-support-android`.
- `tools/umi-support-android/app/build/outputs/apk/release/app-release.apk`.
- `/home/juan/umi-support-releases/1.0.1/Umi-Support-1.0.1-onca-20261027.apk`.
- `/home/juan/umi-support-releases/1.0.1/Umi-Support-1.0.1-source.zip`.
- `/home/juan/umi-support-releases/1.0.1/Umi-Support-1.0.1-SHA256.txt`.

Los archivos tienen propietario juan y sus sumas coinciden con la entrega de la Mac.
SHA-256 del APK: `32e7bf83ed3d189f19c943acb613f0709070c8b2839170d6c3caf0b47a98a77d`.
SHA-256 del ZIP: `e794d35fca47548a20da6e386e6ddd28e7d44b866d3e58dec08b94ee64891da3`.
Pasaron 48 pruebas JVM, Lint y la verificación de firma.

La versión 1.0.0 falló porque Android mostró PERMITIR en mayúsculas.
La 1.0.1 corrigió esa comparación y conservó la validación literal de la red.
No se actualizó el firmware de la iMin.
La OTA disponible no tiene una corrección de ADB confirmada en sus notas.
El apagado eléctrico completo, otra red y un arranque con bloqueo de credenciales no se probaron.

Detalle y evidencia: `docs/reports/2026-10-27-umi-support-android.md`.

## Operación del 26 de octubre

Se conciliaron las cuentas 017, 018, 020, 024, 031, 033, 036 y 038 por MXN 2,405.00.
El propietario confirmó los medios de pago y que las entregas estaban completas.
La 018 reutilizó el pago de terminal de MXN 545.00.
Los MXN 295.00 en efectivo de la 017 ya formaban parte del cierre del 26.
La recuperación no creó otro movimiento de efectivo para ese cierre.
La 011 estaba vacía y se canceló por instrucción del propietario.
La 037 quedó excluida y conservó su estado anterior.

Detalle: `docs/reports/2026-10-26-onca-production-bug-005.md`.

## Operación del 27 de octubre

La 016 no ofrecía Enviar a cocina por una sesión con permisos anteriores.
Se repuso el permiso order.fire que ya correspondía al Cajero.
La comanda llegó a Barra y se completó sin duplicar la preparación manual.
A las 19:26Z, la 016 seguía pendiente de pago por MXN 250.00.
Ese dato es histórico y no afirma que siga abierta ahora.

La 017 para llevar contenía seis panes de muerto y dos conchas.
El operador la cobró por MXN 360.00 mediante transferencia, recibo 0015.
La API confirmó un pago y una venta.
El aviso inicial al confirmar la transferencia no tiene causa comprobada.
Los errores de guardar cuenta y reimprimir corresponden a otras operaciones.

La 020 cambió de MXN 60.00 a MXN 100.00 al agregar productos.
El propietario confirmó que recibió los MXN 100.00 completos.
El soporte reprodujo el error con clics reales y comprobó que no había un pago registrado.
El diario contenía 86 entradas: 53 enviadas y 33 resueltas.
Se reabrió UmiPOS sin borrar datos y se volvió a seleccionar la cuenta desde la API.
Un clic de Cobrar por MXN 100.00 produjo la venta 4712e168-fd99-4d5d-b968-c14607af6661.
El pago b21732b3-5f9d-48e0-ab90-4ce068632112 quedó capturado en efectivo.
El intento está succeeded y el recibo es 0019.
La pantalla mostró Pagado y después No hay cuentas abiertas.

Detalles: incidentes 008, 009 y 010, con sus carpetas de evidencia.

## Corrección del sync y build 334

La prueba reprodujo dos defectos.
Los comandos resueltos seguían contados como pendientes en memoria.
La caché reutilizaba el total anterior cuando los productos cambiaban sin recibir otra versión del servidor.

La corrección del sync consulta el ID oficial y vuelve a leer la cuenta desde la API.
Retira sólo los IDs confirmados y conserva los comandos pendientes o desconocidos.
Una respuesta tardía conserva los productos nuevos y no reemplaza otra selección.
Una lectura fallida conserva el diario y la proyección.
El siguiente sync manual reintenta la lectura sin repetir la escritura confirmada.
No se promete ese reintento automático con conexión estable y diario vacío.

Pasaron 181 pruebas relacionadas y el análisis del código.
La revisión final no encontró bloqueadores.
El PR es https://github.com/umiconsulting/umi/pull/228.
La base es fix/onca-20261026, que corresponde al código instalado en ONCA.

El APK se compiló desde `08a2ea004195d3c423d3ce74aa71e3430314f1e5`.
Las correcciones posteriores de CI sólo cambian formato y una excepción exacta para una etiqueta pública.
Se comprobó que POS, contrato y script de compilación conservan los mismos archivos.

APK de entrega:

`/home/juan/umi-pos-releases/334/UmiPOS-1.0.0-production-release-build334-final.apk`

SHA-256: `c8b3b81335c742b6a6a696e8d32c5c92b93376b7ab47d8d66c908d57f9329e09`.
Certificado de producción: `14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051`.
La carpeta también conserva manifest.json y SHA256SUMS.

La verificación final confirmó la build 334, la firma de producción y el mismo SHA-256 en las cuatro tablets.
El PR 228 quedó integrado en la rama de soporte, commit 069a07fd2670c0225f98b42d6ba5551fd9accfb5.
El sync real consultó la API y mostró cero conflictos y cola cero.
La lista local mostró No hay cuentas abiertas.
El pago y la venta de la 020 permanecen únicos después del sync.
La 020 no se volverá a cobrar para probar la nueva build.

La captura actual comprobó la sesión de Cajero ONCA después de la entrada del propietario.
El aviso previo de PIN usó una captura anterior al momento de esa confirmación.
La aplicación no pidió otro PIN en la captura actual.

La documentación y el proyecto de Umi Support conservan cambios locales en el workspace.
El ZIP final y los APK también tienen copias estables fuera del workspace.
