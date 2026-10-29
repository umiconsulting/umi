# ONCA: Umi Support 1.0.1 instalado y probado en Caja

Fecha: 27 de octubre de 2026.

## Resultado

Umi Support 1.0.1, código 2, quedó instalado y activo en la iMin de Caja.
El propietario activó Accesibilidad una vez en la tablet.
La autorización permaneció activa durante la actualización y el reinicio.
La prueba real recuperó ADB automáticamente, con boot_count de 7 a 8.
El receptor recibió el puerto nuevo y abrió el transporte sin introducir un endpoint.
UmiPOS quedó al frente después de la verificación.

El doctor terminó con código 0 en Caja, Barra, Cocina y Mesero.
Las cuatro tablets conservan UmiPOS build 333.
Las 48 pruebas JVM pasaron. Lint Debug y Release terminaron sin incidencias.
La firma pública y el hash del APK instalado coinciden con el artefacto verificado.

## Fallo observado y causa confirmada

La versión 1.0.0 no aceptó el diálogo después del primer reinicio.
La espera de cuatro minutos terminó sin ADB, con boot_count de 6 a 7.
El propietario aceptó el permiso para recuperar la conexión.
KeepADB publicó el puerto nuevo; el soporte no introdujo ese endpoint manualmente.

La inspección del SystemUI real mostró el recurso «Permitir» y el botón accesible «PERMITIR».
Android Material transforma la etiqueta del botón a mayúsculas.
La versión inicial comparaba exclusivamente el texto original del recurso.
El servicio sí sobrevivió al reinicio; el rechazo ocurrió al reconocer el diálogo.

Se reprodujo el fallo con los textos exactos de la iMin: 48 pruebas, dos fallos.
La versión 1.0.1 acepta el recurso original o su transformación completa según el idioma de SystemUI.
La comparación del mensaje, SSID y BSSID permanece literal.
La corrección no acepta redes adicionales, etiquetas arbitrarias ni botones de otros diálogos.

## Prueba real de la corrección

| Comprobación                                         | Resultado                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Versión instalada                                    | 1.0.1, código 2                                                                       |
| Servicio antes y después del reinicio                | Habilitado y enlazado                                                                 |
| Diálogo ya abierto                                   | El ayudante marcó la casilla y solicitó el permiso; desapareció en unos tres segundos |
| Reinicio de la versión corregida                     | boot_count 7 → 8                                                                      |
| Puerto anterior                                      | `192.168.0.10:38475`                                                                  |
| Puerto publicado por KeepADB                         | `192.168.0.10:35049`                                                                  |
| Transporte conectado automáticamente                 | `100.64.178.95:35049`                                                                 |
| Tiempo observado por el monitor                      | 75.1 segundos                                                                         |
| Tiempo desde la solicitud de reinicio                | 86.7 segundos                                                                         |
| Introducción manual del endpoint                     | No                                                                                    |
| Ejecución manual de adb connect                      | No                                                                                    |
| Aceptación manual del permiso en la prueba corregida | No                                                                                    |
| Resultado mostrado tras el reinicio                  | «Permiso solicitado para la red autorizada»                                           |
| Diagnóstico final                                    | Código 0, cuatro tablets con build 333                                                |
| Operación de Caja                                    | UmiPOS abierto al finalizar                                                           |

El tiempo observado empieza cuando termina el comando adb reboot.
El tiempo total incluye ese comando y las consultas finales.
La recuperación completa tardó aproximadamente un minuto y medio.

## Funcionamiento en segundo plano

Android administra el servicio de Accesibilidad habilitado por el propietario.
No hace falta dejar abierta la pantalla de Umi Support.
El servicio reconoce sólo el diálogo de la red UmiPOS y su BSSID autorizado.
KeepADB conserva la activación y la publicación del puerto dinámico.
Juan-PC conserva la reconexión por Tailscale.
La computadora debe permanecer encendida y conectada a Tailscale.

El servicio verifica el paquete SystemUI, su firma de plataforma, cuatro IDs y los textos completos.
Android publica este permiso como android.app.Dialog.
La API no demuestra el nombre exacto de su Activity.
La comprobación usa la firma estructural y textual del diálogo del SystemUI auténtico.
La revalidación reduce lecturas obsoletas; la consulta y el clic no forman una operación atómica.

## Artefacto y firma pública

- Paquete: `co.umiconsulting.umi_support`.
- APK: `tools/umi-support-android/app/build/outputs/apk/release/app-release.apk`.
- SHA-256: `32e7bf83ed3d189f19c943acb613f0709070c8b2839170d6c3caf0b47a98a77d`.
- Certificado SHA-256: `e8d675db1dbb7c2286bd9e319293966a358831ec334e416467d4cf68ff181504`.
- Firma: APK Signature Scheme v2, RSA de 3072 bits.
- App no depurable, sin permisos declarados de Internet ni escritura de ajustes.
- La clave de firma y su contraseña permanecen fuera del repositorio, con permisos 600.

Se instaló el canario por autorización expresa del propietario.
No se modificó la API, el APK de UmiPOS, el firmware, las llaves ADB ni los puertos de escucha.
No se repitió un cobro ni se modificaron cuentas o saldos.
El archivo ajeno apps/umi-pos/pubspec.lock conserva su SHA-256 inicial.
El código y la documentación permanecen en el workspace de soporte; no se integró main durante esta prueba.

## Alcance y reversión

Se probó un reinicio real con la versión corregida y la red actual.
No se realizó una prueba de corte eléctrico, de otra red o de otro firmware.
Un cambio del punto de acceso requiere revisar el BSSID permitido.
El propietario puede pausar la recuperación desde Umi Support.
Para retirarlo, desactiva su Accesibilidad y desinstala sólo co.umiconsulting.umi_support.
Conserva KeepADB y Tailscale.

## Evidencia

- [Primer reinicio fallido](./evidence/2026-10-27-umi-support/reboot-test-1.json).
- [Recuperación manual del primer intento](./evidence/2026-10-27-umi-support/manual-recovery-after-test-1.json).
- [Controles reales de Android 11](./evidence/2026-10-27-umi-support/dialog-snapshot-android11.json).
- [Causa confirmada](./evidence/2026-10-27-umi-support/confirmed-cause-v1.0.1.json).
- [Pruebas, Lint y firma](./evidence/2026-10-27-umi-support/verification-v1.0.1.json).
- [Prueba de reinicio exitosa](./evidence/2026-10-27-umi-support/reboot-test-2.json).
- [Verificación física](./evidence/2026-10-27-umi-support/physical-verification-v1.0.1.json).
- [Estado del ayudante después del reinicio](./evidence/2026-10-27-umi-support/after-reboot-v1.0.1.png).
- [Diagnóstico final de flota](./evidence/2026-10-27-umi-support/doctor-after-reboot-v1.0.1.json).
- [Diseño](../architecture/2026-10-27-umi-support-android.md).
- [Investigación de fuentes primarias](../research/2026-10-27-umi-support-android.md).

Se usaron Java 17.0.20.1, Gradle 9.1.0, AGP 9.0.1, SDK 36 y JUnit 4.13.2.
La compilación conserva un aviso del SDK sobre su versión XML; Lint no detectó incidencias.

## Paquete final conservado en juan-PC

El código y el APK compilado permanecen en tools/umi-support-android.
El paquete de entrega también quedó en /home/juan/umi-support-releases/1.0.1/.
Contiene el APK final, Umi-Support-1.0.1-source.zip y Umi-Support-1.0.1-SHA256.txt.
La verificación confirmó propietario juan y coincidencia con los archivos de la Mac.
SHA-256 del ZIP: e794d35fca47548a20da6e386e6ddd28e7d44b866d3e58dec08b94ee64891da3.
La ejecución de Umi Support no depende de la Mac.
