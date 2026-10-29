# Umi Support: recuperación local de la autorización ADB

Fecha: 27 de octubre de 2026.
El propietario pidió crear esta aplicación a partir de la propuesta de recuperación de ONCA.

## Objetivo y alcance aprobado

Umi Support acepta únicamente el diálogo de depuración inalámbrica para la red UmiPOS.
El punto de acceso autorizado es `bc:07:1d:ca:ae:61`.
KeepADB conserva la activación de ADB y la publicación del puerto dinámico.
El receptor existente de juan-PC conserva la reconexión por Tailscale.

La primera activación requiere la decisión del propietario dentro de la aplicación y el permiso de Accesibilidad de Android.
La aplicación permite pausar la recuperación.
No contiene permisos de Internet, escritura de ajustes ni ejecución de comandos.
No cambia UmiPOS, pagos, cuentas, claves ADB, firmware ni puertos.

## Herramienta y alternativas

Se usa AccessibilityService de Android y una aplicación nativa Java sin bibliotecas de ejecución externas.
El SDK instalado incluye API 36, build-tools 36.0.0 y Java 17.
Gradle 9.1.0 y Android Gradle Plugin 9.0.1 ya están disponibles en juan-PC.
El código nuevo usa la licencia del repositorio. Android/AOSP publica las API y sus fuentes bajo Apache 2.0.

KeepADB 1.8.38 ya resuelve el puerto dinámico, pero no puede aceptar este permiso del sistema.
Otra opción es corregir el firmware; no hay una versión compatible que confirme este arreglo.
Se elige el ayudante solicitado para conservar la instalación actual y poder retirarlo sin cambiar el firmware.

## Identidad del diálogo

Hecho documentado: AlertActivity comunica la clase accesible `android.app.Dialog`.
Un servicio ordinario no puede demostrar la clase exacta de la Activity a partir de ese evento.
No se usará una comprobación de clase que siempre impida la recuperación.

La aplicación comprueba el paquete `com.android.systemui` y su firma frente al paquete de plataforma `android`.
Lee los textos del diálogo desde los recursos de esa misma aplicación del sistema.
La pantalla activa debe contener una sola instancia de cada control esperado:

- `android:id/alertTitle`: título exacto `wifi_debugging_title`.
- `android:id/message`: mensaje completo `wifi_debugging_message`, con SSID y BSSID autorizados.
- `android:id/alwaysUse`: CheckBox con el texto exacto `wifi_debugging_always`.
- `android:id/button1`: Button con el texto exacto `wifi_debugging_allow`.

Se admiten el SSID entre comillas y sin comillas; Android devuelve normalmente el SSID entre comillas.
Se admite la dirección BSSID en letras mayúsculas o minúsculas.
Se comparan mensajes completos. Un nombre parecido o un punto de acceso distinto no coincide.
Esta firma de interfaz identifica el diálogo esperado; no demuestra la clase exacta de su Activity.

## Componentes y acciones

`TrustedDialog` valida una captura inmutable del diálogo y decide entre no actuar, marcar la casilla y permitir.
`RecoveryEngine` limita los intentos por ventana y vuelve a consultar la pantalla antes de cada acción.
`SupportAccessibilityService` adapta los nodos de Android a esas interfaces.
`MainActivity` muestra el permiso, la pausa y el último resultado local.
`SupportPreferences` conserva sólo la autorización, el resultado y sus tiempos en almacenamiento protegido del dispositivo.

El servicio consulta la ventana activa al conectarse y cuando recibe eventos de SystemUI.
Los reintentos usan intervalos acotados y no dependen de un endpoint ADB.
Cada acción exige la misma ventana, el mismo mensaje y controles visibles y habilitados.
Primero marca la casilla. Sólo permite cuando una lectura posterior confirma la marca.
Una ventana nueva, una pantalla incompleta o un cambio de red detiene la acción.
El registro no conserva capturas, texto de otras ventanas, PIN ni secretos.

## Arranque y límites

El servicio declara `directBootAware` y usa preferencias protegidas del dispositivo.
Android administra su conexión después de que el propietario active Accesibilidad.
La aplicación no intenta activar su propio permiso ni ocultar su funcionamiento.
La restauración del servicio en el firmware iMin sigue sin verificar hasta una prueba real.
El ayudante tampoco puede recuperar una caja sin Wi-Fi, Tailscale o alimentación.
Un cambio del punto de acceso requiere revisar y actualizar la lista permitida.

## Validación y despliegue

Las pruebas cubren red autorizada, redes parecidas, BSSID distinto, controles alterados, pausa y cambios entre lecturas.
También cubren el orden casilla/permiso, el límite de intentos y la supresión de clics duplicados.
La compilación ejecuta pruebas unitarias, Android Lint y el ensamblado del APK.
La verificación inspecciona el manifiesto y la firma del APK.

La instalación y la activación en Caja requieren presentar primero el APK y los resultados al propietario.
El reinicio requiere una pausa operativa autorizada.
La prueba debe observar un aumento de boot_count, el servicio de Accesibilidad, el webhook y ADB sin intervención.
El doctor debe terminar con código 0 antes de declarar la recuperación comprobada.
La reversión consiste en pausar o deshabilitar Accesibilidad y desinstalar sólo Umi Support.

## Fuentes

- https://developer.android.com/reference/android/accessibilityservice/AccessibilityService
- https://developer.android.com/privacy-and-security/direct-boot
- https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-11.0.0_r48/core/java/com/android/internal/app/AlertActivity.java
- https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-11.0.0_r48/packages/SystemUI/src/com/android/systemui/wifi/WifiDebuggingActivity.java

## Validación y ajuste del 27 de octubre

La inspección real mostró el botón PERMITIR, aunque el recurso devuelve Permitir.
La versión 1.0.1 admite el texto original o su transformación Material completa según la locale de SystemUI.
El mensaje de red permanece literal.
La actualización retuvo Accesibilidad y el reinicio 7 → 8 recuperó ADB sin intervención.
El informe de producción conserva el primer fallo y la prueba corregida.
