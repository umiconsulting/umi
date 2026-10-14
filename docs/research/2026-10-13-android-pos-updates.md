# Actualización y soporte de tres POS Android

Fecha: 2026-10-13. Alcance: investigación; no se instalaron aplicaciones ni se modificaron dispositivos.

## Herramienta recomendada

**Requisito del usuario:** los tres equipos quedan en producción en el café. El administrador trabaja desde otra red. **Inferencia:** elegir administración por internet compatible con los tres equipos; usar managed Google Play para los equipos compatibles y distribución de APK mediante un administrador compatible para el iMin si carece de Google Play. ADB queda como herramienta de puesta en servicio. El control remoto complementa la distribución de versiones.

## Equipos documentados

| Equipo                          | Función      | Android documentado |
| ------------------------------- | ------------ | ------------------- |
| iMin D3-504, marca Parrot       | Caja fija    | 11                  |
| Samsung Galaxy Tab A9+, SM-X210 | Cocina, KDS  | 16                  |
| Samsung Galaxy Tab A11, SM-X133 | POS portátil | 16                  |

**Hecho documentado:** modelos y funciones en `docs/pilot/UMIPOS_SITE_DEVICE_INVENTORY.md:32`. El informe `docs/reports/2026-10-13-comanda-congelada-cuenta-suspendida.md:3` registra build 71 y paquete `co.umiconsulting.umi_pos.estacion` en los tres equipos. El historial local del 12 de octubre confirma la instalación solicitada en A9 y A11. El inventario contiene estados de instalación antiguos; el informe del 13 de octubre aporta evidencia posterior.

**Hecho documentado:** iMin ofrece distribución de aplicaciones y administración remota mediante su plataforma de partners. **UNVERIFIED:** acceso de Umi al equipo Parrot, disponibilidad de Google Play en este firmware y compatibilidad con un MDM concreto. Fuentes: [AppStore iMin, documentación v1.8](https://oss-sg.imin.sg/docs/en/AppStore.html), [DeviceManagement iMin, documentación v1.8](https://oss-sg.imin.sg/docs/en/DeviceManagement.html). Hay un aviso oficial de migración a KiwiCloud; la apertura del aviso falló. No se presupone acceso al servicio ni su nombre operativo para este terminal.

| Herramienta                   | Versión, licencia y estado                                                                                                                      | Adopción y alternativa                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Android Debug Bridge          | Instalado: `1.0.41`, paquete `37.0.0-android-tools`, `/usr/bin/adb`. Herramienta mantenida en Android SDK; condiciones de distribución del SDK. | Ya disponible; permite automatizar comandos. Requiere conexión y autorización del equipo. Alternativa: USB o distribución por Play. |
| Play Console, canal interno   | Servicio sin versión fija; condiciones comerciales de Google Play. Documentación vigente consultada.                                            | Cuenta de desarrollador, firma válida, bundle y cuentas de testers. Coste monetario exacto: UNVERIFIED en esta investigación.       |
| Managed Google Play + MDM/EMM | Servicio sin versión fija; licencia/coste dependen del proveedor de administración.                                                             | Configurar organización e inscribir equipos. Más configuración inicial; alternativa provisional: ADB.                               |
| TeamViewer Host               | Producto comercial mantenido; versión instalada y coste de soporte móvil: UNVERIFIED. Documentación modificada el 2026-05-08.                   | Instalar, asignar a una cuenta y comprobar compatibilidad del fabricante. Alternativa con intervención local: QuickSupport.         |

Fuentes de herramientas: [ADB](https://developer.android.com/tools/adb), [Play testing](https://support.google.com/googleplay/android-developer/answer/9845334), [aplicaciones privadas](https://support.google.com/googleplay/android-developer/answer/9874937), [TeamViewer Host](https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-classic/mobile/android/android-host/). No se eligió una implementación propia de actualización.

## Hallazgos

- **Hecho documentado:** ADB permite seleccionar cada equipo con `-s`. La opción `-r` reinstala conservando los datos: `adb -s <serial> install -r <archivo.apk>`. Wireless debugging requiere una conexión compatible; la documentación describe el uso en la misma red Wi-Fi y posibles desconexiones. [ADB](https://developer.android.com/tools/adb).
- **Hecho documentado:** una actualización normal necesita el mismo paquete y certificado de firma compatible. Cambiar de certificado sin un mecanismo de migración compatible impide reemplazar la aplicación existente. [Firma Android](https://developer.android.com/studio/publish/app-signing).
- **Hecho documentado del repositorio:** `apps/umi-pos/android/app/build.gradle.kts:34` toma `umiposApplicationId`, con valor predeterminado `co.umiconsulting.umi_pos`; el comentario también muestra `co.umiconsulting.umi_pos.estacion`. La compilación release usa la firma debug en la línea 49. **Inferencia:** antes de desplegar o migrar a Play, inventariar el paquete y certificado realmente instalados y definir la firma de producción; no asumir que todos los equipos usan el valor predeterminado.
- **Hecho documentado del repositorio:** `apps/umi-pos/lib/core/update/desktop_updater_io.dart:15` devuelve un actualizador vacío fuera de Linux. **Inferencia:** el actualizador de escritorio actual no resuelve las actualizaciones Android.
- **Hecho documentado:** el canal interno admite hasta 100 testers, elegidos por cuentas, y entrega versiones mediante Play Store antes de publicar en producción. Requiere cuenta Google o Workspace y adhesión al enlace de prueba. **Inferencia:** basta para un piloto de tres equipos sin lanzar una distribución pública. No confundir ese piloto con administración empresarial permanente. [Play testing](https://support.google.com/googleplay/android-developer/answer/9845334).
- **Hecho documentado:** las aplicaciones privadas pueden restringirse a organizaciones y distribuirse desde una consola EMM mediante managed Google Play. **Inferencia:** es la ruta más adecuada para mantenimiento empresarial; confirmar con el MDM elegido instalaciones, ventanas de actualización y compatibilidad de los equipos. [Aplicaciones privadas](https://support.google.com/googleplay/android-developer/answer/9874937).
- **Hecho documentado:** TeamViewer Host permite acceso sin confirmación de cada sesión, a través de la cuenta asignada. QuickSupport exige confirmación local. El control completo depende del fabricante: algunos equipos solo permiten compartir pantalla; Universal Add-On no está disponible para Host. **Inferencia:** verificar los modelos de los tres POS antes de prometer control remoto permanente. [TeamViewer Host](https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-classic/mobile/android/android-host/).

## Procedimiento propuesto

**Inferencia:** inventariar modelo, Android, disponibilidad de Play, paquete y firma; crear un APK compatible; actualizar primero un equipo fuera del horario de ventas; comprobar apertura, venta e impresión; después actualizar los otros dos. Conservar copia/sincronización de datos antes de cualquier migración que requiera reinstalar. No ejecutar una desinstalación para resolver una incompatibilidad de firma sin planificar los datos locales.

**UNVERIFIED:** disponibilidad efectiva de Play Store en cada equipo, firma efectiva instalada, tolerancia a reinicios, sincronización de datos locales y licencia necesaria para control remoto comercial. Los modelos y versiones Android constan en el inventario.

## Evidencia y rutas

Escalón 1: documentación oficial de Android, Google Play y TeamViewer. Código local inspeccionado como evidencia primaria del proyecto. `adb version` ejecutado sin contactar dispositivos. La URL inicial de TeamViewer redirigió al portugués; la ruta oficial en inglés permitió verificar la compatibilidad. No se necesitó una fuente secundaria.

## Alternativas sencillas, fuentes oficiales 13 octubre

- **Hecho documentado — AnyDesk:** instalación de aplicación y complemento de control según el equipo. Aunque se configure contraseña para acceso desatendido, Android 10 o posterior puede exigir aceptar localmente el permiso de captura de pantalla. **Inferencia:** opción sencilla cuando hay alguien en el local que pueda confirmar; no prometer acceso permanente sin probarla. Versión instalada y coste comercial: UNVERIFIED. [Guía Android](https://support.anydesk.com/docs/anydesk-for-android).
- **Hecho documentado — RustDesk:** el servicio Android requiere permisos de captura y entrada. **Inferencia:** una contraseña no garantiza recuperación desatendida después de reiniciar; comprobarlo en los POS. Versión instalada y coste de servicios: UNVERIFIED. [Documentación Android](https://rustdesk.com/docs/en/client/android/).
- **Hecho documentado — AirDroid Remote Support:** ofrece inscripción en modo desatendido y requiere configurar los permisos iniciales y el complemento de accesibilidad para controlar el equipo. El plan Standard anuncia USD 599 por licencia/año y prueba de 14 días; el Basic de USD 199 no incluye acceso desatendido Android. Controladores anunciados: Windows, macOS, Android e iOS; Linux no aparece en la lista, y la consola web administrativa no equivale a control remoto. **Inferencia:** probar el plan Standard con un dispositivo real antes de contratar; confirmar condiciones finales de licencia. Servicio sin versión fija. [Configuración](https://biz-help.airdroid.com/en/support/solutions/articles/154000202417), [planes](https://www.airdroid.com/pricing/remote-support/).
- **Hecho documentado — Vysor Share:** comparte pantalla y conexión ADB para asistencia remota; Vysor admite Linux y navegador. **Inferencia:** encaja con el mantenimiento actual si hay una computadora encendida en el local, conectada a los Android. La existencia de esa computadora es UNVERIFIED. Versión de la aplicación reportada en la consulta principal: 5.0.72; la extracción web de esta comprobación devolvió solo la interfaz mínima y no permitió corroborar el número. Licencia comercial/Pro; coste vigente: UNVERIFIED. [Producto](https://www.vysor.io/), [aplicación](https://app.vysor.io/).
- **Hecho documentado, verificado por la investigación principal — TeamViewer en Samsung Android 15 o posterior:** el acceso desatendido requiere configuración Samsung Knox mediante MDM. No extrapolar compatibilidad de Host a todos los Samsung. [Guía oficial](https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/mobile/set-up-remote-control-for-samsung-knox-devices-via-your-mdm/). En esta comprobación adicional la página devolvió error interno; queda registrada la verificación previa de la investigación principal.

**Inferencia de selección:** para asistencia ocasional, comenzar con AnyDesk si hay confirmación local; para acceso sin alguien presente, probar AirDroid Standard en un POS. Vysor Share es una alternativa para conservar ADB únicamente si existe una computadora local. Estas herramientas permiten asistir; el APK y su firma siguen determinando cómo se actualiza el POS.
