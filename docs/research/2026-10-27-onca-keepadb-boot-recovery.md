# ONCA: KeepADB y la autorización después de reiniciar Caja

Fecha: 27 de octubre de 2026.

## Herramienta y alcance

Se usó KeepADB 1.8.38, versionCode 135, con licencia AGPLv3.
Ya estaba instalado en las cuatro tablets. No se instaló otra versión.
Se usó Android Debug Bridge 1.0.41, paquete 37.0.0-android-tools.
El diagnóstico oficial del repositorio revisó las cuatro tablets con build 333.

KeepADB ofrece servicio en primer plano, recepción de arranque y webhook.
La adopción no exigió otra aplicación ni un servicio nuevo.
ADB y el diagnóstico funcionaron sin interacción después de recuperar el transporte.
La alternativa comprobada fue aceptar el permiso en la tablet.

Las fuentes públicas de GitHub respondieron por HTTP.
Se consultó el tag exacto v1.8.38. El código de master no define este diagnóstico.

## Hechos del dispositivo

Caja es una iMin D3 con Android 11.
El firmware informa `RQ3A.210705.001` y parche `2022-03-05`.

El primer reinicio cambió `boot_count` de 4 a 5.
El diagnóstico persistente de KeepADB registró
`boot_recovery outcome=skipped detail=persisted_intent_off`.
La orden anterior de apagado permanecía guardada, aunque Android tenía ADB activo.

El propietario activó la depuración desde la aplicación.
KeepADB registró `desired=true` y `lastIntentOff=false`.
El propietario también aceptó «Permitir siempre en esta red» para `UmiPOS`.
El volcado de Android contenía la entrada `wifiAP` esperada antes del segundo reinicio.

El segundo reinicio cambió `boot_count` de 5 a 6.
KeepADB inició e intentó activar ADB.
Android mostró otra vez el permiso de red, con «Permitir siempre» sin marcar.
El propietario confirmó esa pantalla.
Las dos pruebas agotaron 210 segundos sin recuperación automática.

El segundo arranque registró dos veces:

```text
AdbDebuggingManager: Expected keyStore, but got tag=null
```

Después de aceptar el permiso, Caja publicó `100.64.178.95:43761`.
El receptor recuperó ADB. El diagnóstico completo terminó con código 0.
El volcado posterior contiene una red autorizada y dos llaves públicas emparejadas.
Sólo se conservaron los conteos. No se exportaron llaves privadas.

## Hechos documentados en KeepADB v1.8.38

`BootReceiver` recibe `BOOT_COMPLETED` y consulta `KeepADBService.shouldRun`.
Si la última orden explícita es apagar y ADB está apagado, omite la recuperación.
El servicio registra esa decisión como `persisted_intent_off`.

La activación desde la aplicación guarda la orden deseada.
«Mantener siempre activo» no sustituye esa orden ni el permiso de Android.
El servicio limita los intentos cuando Android acepta la escritura y después la revierte.

Fuentes del tag exacto:

- [BootReceiver.java](https://github.com/m00sfett/KeepADB/blob/v1.8.38/app/src/main/java/de/hohnepeople/keepadb/BootReceiver.java).
- [KeepADBService.java](https://github.com/m00sfett/KeepADB/blob/v1.8.38/app/src/main/java/de/hohnepeople/keepadb/KeepADBService.java).
- [KeepADB.java](https://github.com/m00sfett/KeepADB/blob/v1.8.38/app/src/main/java/de/hohnepeople/keepadb/KeepADB.java).
- [KeepADBPreferences.java](https://github.com/m00sfett/KeepADB/blob/v1.8.38/app/src/main/java/de/hohnepeople/keepadb/KeepADBPreferences.java).
- [Repositorio y licencia](https://github.com/m00sfett/KeepADB/tree/v1.8.38).

## Hechos documentados en AOSP 11

`AdbDebuggingManager.getTrustedNetworks` lee las redes del almacén XML.
En el tag consultado, llama a `XmlUtils.beginDocument` y después a `parser.next`.
`beginDocument` ya coloca el lector en la etiqueta inicial.
La comprobación posterior puede encontrar texto sin nombre de etiqueta.
Ese camino registra el mismo error observado y devuelve una lista vacía.

La escritura `persistKeyStore` conserva las redes en etiquetas `wifiAP`.
Por ello, ver la red serializada no demuestra que el siguiente arranque pueda leerla.

Fuentes:

- [AdbDebuggingManager.java, android-11.0.0_r48](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-11.0.0_r48/services/core/java/com/android/server/adb/AdbDebuggingManager.java).
- [XmlUtils.java, android-11.0.0_r48](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-11.0.0_r48/core/java/com/android/internal/util/XmlUtils.java).
- [iMin: depuración](https://oss-sg.imin.sg/docs/en/DockingDebugging.html).
- [iMin: energía y Transmission Mode](https://www.imin.com/faq/).

## Inferencia y límites

La primera causa está confirmada por la decisión explícita del receptor de arranque.
La segunda causa inmediata es la autorización de red que Android solicita de nuevo.

El error de lectura es compatible con el camino AOSP descrito.
El código binario exacto del framework iMin no se extrajo.
La atribución a ese defecto concreto de AOSP sigue como inferencia.
Una versión de firmware que lo corrija está **NO VERIFICADA**.
Una actualización de Android o KeepADB no se presentó como solución probada.

La opción Transmission Mode no aparece en esta D3.
El usuario lo confirmó y se revisó la pantalla de Batería.
No se aplicó un ajuste desconocido en su lugar.

## Decisión operativa

Se conserva KeepADB con la orden encendida y su webhook actual.
Se conservan los puertos dinámicos y Tailscale.
Se conserva la verificación SSH estricta.
No se instaló firmware ni se activó root.

Después de reiniciar, una persona debe revisar el permiso de red.
La recuperación automática de Caja sigue pendiente.
Una corrección del firmware requiere validar el modelo y la ruta oficial de iMin.
La alternativa debe probar otro reinicio completo antes de aprobar la persistencia.

Evidencia del soporte:
[incidente 007](../reports/2026-10-27-onca-production-bug-007.md) y
[diagnóstico final](../reports/evidence/2026-10-27-onca-support/doctor-final.json).

## Consulta de firmware y vía de corrección

La lectura del equipo confirmó estos identificadores:

| Dato                      | Valor                                              |
| ------------------------- | -------------------------------------------------- |
| Modelo                    | D3                                                 |
| Dispositivo               | `rk3566_rgo`                                       |
| Compilación visible       | `1.0.3.4.23_230926`                                |
| Compilación incremental   | `eng.yeguif.20230926.065226`                       |
| Actualizador de red       | `com.neostra.update` 5.28, código 215              |
| Servicio de actualización | `android.rockchip.update.service` 1.8.9, código 39 |

La documentación de iMin remite a **Wireless Update** para actualizaciones compatibles.
Esa indicación genérica no confirma una corrección de ADB para esta compilación.
La búsqueda pública por modelo, compilación y firmware no encontró un paquete correctivo confirmado.

La lista de aplicaciones permitidas en
[Android11 permissions description](https://oss-sg.imin.sg/docs/en/Permissions.html)
se refiere al acceso de aplicaciones a periféricos USB.
No documenta una solución para la autorización de red de ADB.
No se aplicó esa lista como sustituto del permiso observado.

El paso pendiente es obtener del proveedor una corrección compatible con estos identificadores.
La revisión debe comprobar el registro de cambios y el procedimiento de recuperación.
Una instalación debe realizarse en una ventana de mantenimiento autorizada.
Después, deben pasar reinicios completos sin tocar la pantalla de permisos.
No se identificó ni se instaló una actualización de firmware durante esta revisión.

Las búsquedas y las lecturas fueron de consulta. La aplicación de producción siguió operativa.

## Actualización ofrecida y parche AOSP identificado

La consulta directa del actualizador añadió evidencia el 27 de octubre.

| Dato                             | Resultado                             |
| -------------------------------- | ------------------------------------- |
| Firmware instalado               | `1.0.3.4.23_230926`                   |
| Actualización ofrecida           | `1.0.6.4.23_241120`                   |
| Fecha de publicación mostrada    | 22 de noviembre de 2024               |
| Tamaño mostrado                  | 132.97 MB                             |
| Aplicación que ofrece el paquete | `com.neostra.update/.GoogleOtaClient` |
| Fabricante informado por Android | `neostra`                             |

El texto de cambios del dispositivo dice:

```text
1.Optimization system
2.Minor bug fixes
```

El texto no menciona ADB, el archivo de autorizaciones ni el permiso de red.
La búsqueda del número exacto no encontró un historial público más detallado.
No se identificó otra versión de iMin que documente esta corrección específica.

Sí se encontró una corrección oficial de Android:
[Fix ADB key file reading](https://android.googlesource.com/platform/frameworks/base/+/c113a129072f).
El cambio se escribió el 15 de junio de 2022 y se integró el 28 de junio.
Corresponde al bug `236299256` y al commit
`c113a129072f3c73c8b56fcd35ee117ede11abe9`.
Su Change-Id es `Iae955aca17e873288d58b16f184bd4d325d50d86`.

La descripción oficial indica que el archivo de autorizaciones se escribía bien,
pero el lector no podía leerlo. Por ello, las redes Wi-Fi autorizadas no se restauraban.
El síntoma coincide con el permiso que vuelve a aparecer en Caja.
El error `Expected keyStore, but got tag=null` también coincide con el código anterior.
La atribución al binario exacto de iMin sigue como inferencia.

La fecha de la actualización ofrecida no demuestra que incluya el parche.
La inclusión del parche en `1.0.6.4.23_241120` queda **NO VERIFICADA**.

Se revisaron las notas y los archivos públicos del actualizador.
También se leyó su APK instalado, sin modificarlo.
Sólo se identificaron los servidores HTTPS de metadatos de Adups.
No se obtuvo una URL pública del paquete ni se analizó su framework.
No se accedió a datos privados de la aplicación.
No se descargó ni se instaló el firmware.

La definición de `MANAGE_DEBUGGING` en esta iMin es `signature|privileged`.
No existe una concesión ordinaria de ADB para dar ese permiso a KeepADB.
No se activaron servicios de Accesibilidad.
Los reintentos de KeepADB no pueden garantizar que Android acepte la autorización.

### Pregunta concreta para el proveedor

Confirma si el firmware D3 `1.0.6.4.23_241120` incorpora el bug AOSP
`236299256`, Change-Id `Iae955aca17e873288d58b16f184bd4d325d50d86`,
o una corrección equivalente para restaurar las redes autorizadas al arrancar.

El proveedor debe confirmar el modelo, la revisión de hardware y la ruta de recuperación.
Después de una actualización autorizada, la prueba debe reiniciar Caja y recuperar
Tailscale, el nuevo endpoint y ADB sin confirmar un permiso en la pantalla.
La validación debe comprobar el contador de arranques y ejecutar el doctor.

Fuentes adicionales:
[FAQ oficial de D3](https://doc.neostra.com/doc/cjwt/tssbfaq/d3xl/d3-faq/) y
[depuración oficial](https://doc.neostra.com/doc/kfzts/kfzts/).
La guía genérica no confirma que el paquete ofrecido incluya este parche.

## Alternativa local sin actualizar el firmware

Estado inicial: propuesta técnica. La construcción, instalación y prueba posteriores se registran al final.

Android ofrece servicios de Accesibilidad con filtros por paquete y acciones sobre controles.
Una aplicación local podría actuar sobre la pantalla
`com.android.systemui.wifi.WifiDebuggingActivity`.
El código AOSP 11 usa una casilla y un botón para conceder el permiso a la red.
El botón llama a `allowWirelessDebugging` desde el proceso del sistema.

El ayudante propuesto requiere habilitar Accesibilidad una vez en la tablet.
La implementación comprueba SystemUI, su firma y el diálogo completo de la red autorizada.
La API de Accesibilidad publica una clase genérica; no demuestra la Activity exacta.
La red permitida sería `UmiPOS`, BSSID `bc:07:1d:ca:ae:61`.
Después, marcaría «Permitir siempre en esta red» y pulsaría **Permitir**.
KeepADB conservaría la publicación del puerto dinámico por Tailscale.

La propuesta no requiere root ni una actualización del sistema.
No concede `MANAGE_DEBUGGING` a una aplicación común.
Usa la autorización normal del diálogo mediante acciones de interfaz.
Debe actuar exclusivamente sobre ese diálogo de red.
Debe detenerse ante otra actividad, otro punto de acceso o un control inesperado.

La compatibilidad con el diálogo exacto de iMin sigue **NO VERIFICADA**.
La permanencia del servicio después de un reinicio también requiere una prueba real.
El servicio no debe declararse eficaz hasta recuperar ADB sin intervención tras reiniciar.
La prueba debe comprobar `boot_count`, el webhook, el transporte ADB y el doctor.

Fuentes:
[AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService) y
[WifiDebuggingActivity de AOSP 11](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-11.0.0_r48/packages/SystemUI/src/com/android/systemui/wifi/WifiDebuggingActivity.java).

## Avance anterior: Umi Support construido antes de la instalación

Se creó un APK firmado de Umi Support 1.0.0 con 45 pruebas aprobadas.
La instalación y la prueba de reinicio siguen pendientes.
La recuperación automática de Caja continúa **NO VERIFICADA**.
Consulta la [entrega y evidencia de Umi Support](../reports/2026-10-27-umi-support-android.md).

## Validación posterior: Umi Support 1.0.1 instalado

Umi Support 1.0.1, código 2, quedó instalado y activo en Caja.
La primera prueba de 1.0.0 falló por la etiqueta Material «PERMITIR».
La corrección conserva la comparación literal de la red autorizada.
El reinicio de la versión corregida pasó de boot_count 7 a 8 y recuperó ADB automáticamente.
KeepADB publicó el puerto nuevo y el receptor abrió el transporte sin introducir el endpoint.
El doctor final terminó con código 0 en las cuatro tablets, todas con UmiPOS build 333.
No se instaló firmware ni se modificaron pagos.

Informe: [Umi Support instalado y probado](../reports/2026-10-27-umi-support-android.md).
