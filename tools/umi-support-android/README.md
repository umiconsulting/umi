# Umi Support

Ayudante Android de ONCA para recuperar el permiso de depuración inalámbrica.
KeepADB publica el puerto dinámico. Juan-PC conserva la reconexión por Tailscale.

## Alcance

- Nombre: **Umi Support**. Paquete: `co.umiconsulting.umi_support`.
- Versión: `1.0.1`, código `2`. Android mínimo: 11.
- Red permitida: `UmiPOS`. BSSID: `bc:07:1d:ca:ae:61`.
- La primera instalación empieza pausada. El propietario debe aceptar la función y activar Accesibilidad.
- No requiere Internet, root, permisos para cambiar ajustes ni una conexión ADB para actuar después del arranque.
- No modifica UmiPOS, pedidos, pagos, firmware ni la configuración de KeepADB.

La firma de SystemUI debe coincidir con la firma de Android.
Los cuatro controles deben conservar sus IDs, textos completos y la identidad de la red.
El botón admite el texto del recurso y su transformación Material a mayúsculas según el idioma de SystemUI.
La comparación del mensaje de red permanece literal; no cambia el SSID ni el BSSID permitido.
Un control inesperado o una plantilla sin SSID/BSSID impide la acción.
El ayudante marca la casilla y verifica su estado antes de solicitar el permiso.
Los eventos repetidos no generan otra solicitud en la misma ventana.
Los intentos tienen un límite de seis acciones y treinta segundos por ventana.

La interfaz accesible de Android no demuestra la clase exacta de la Activity.
Se valida la firma completa del diálogo del SystemUI auténtico.
La revalidación reduce las lecturas obsoletas; la consulta y el clic no forman una transacción atómica.

## Compilar y verificar

Usa Java 17, Android SDK 36 y Gradle Wrapper 9.1.0.

```sh
./gradlew :app:testDebugUnitTest :app:lintDebug --console=plain
```

La compilación release exige estos parámetros de entorno:

```sh
export UMI_SUPPORT_KEYSTORE_PATH=/ruta/externa/umi-support.p12
export UMI_SUPPORT_KEYSTORE_PASSWORD_FILE=/ruta/externa/password
./gradlew :app:testDebugUnitTest :app:lintRelease :app:assembleRelease --console=plain
```

El almacén usa el alias `umi-support`. Ambos archivos deben permanecer fuera del repositorio.
Conserva sus permisos 600. No los incluyas en un paquete de entrega.
La compilación falla si falta la firma release.
Lint conserva los errores y avisos como fallos.
Sólo se exceptúa el aviso de actualización del Gradle Wrapper fijado y la consulta necesaria de recursos externos.

## Preparar Caja

La instalación y la prueba deben coordinarse con la operación de ONCA.

1. Instala el APK firmado en Caja.
2. Abre **Umi Support**.
3. Pulsa **Activar recuperación** y lee la red autorizada.
4. Acepta y activa **Umi Support** en los ajustes de Accesibilidad de Android.
5. Confirma que KeepADB conserva **Mantener siempre activo** y su webhook.
6. Confirma que Tailscale conserva la VPN siempre activa.
7. Ejecuta una prueba de reinicio en una pausa autorizada.

La aplicación no concede su propio permiso de Accesibilidad.
No uses comandos para sustituir esa decisión del propietario.
Una pausa normal conserva el permiso, pero impide las acciones.
Si falla el almacenamiento, la aplicación cierra la autorización en memoria e intenta deshabilitar su propio servicio.
También abre los ajustes y pide desactivar Accesibilidad antes de reiniciar.

## Validación física en Caja

Las pruebas JVM validan las decisiones y los límites. No prueban los nodos ni los clics del firmware.
La prueba real debe confirmar un nuevo `boot_count`, la conexión del servicio, el webhook y el nuevo puerto.
La reconexión debe ocurrir sin tocar el diálogo ni anotar el endpoint.
Después, el doctor de ONCA debe terminar con código 0 y build 333 en las cuatro tablets.
La versión 1.0.1 completó esa prueba en Caja el 27 de octubre de 2026: boot_count 7 → 8, endpoint nuevo y ADB automático.
El doctor terminó con código 0 en las cuatro tablets con build 333.
Esta evidencia corresponde al reinicio y a la red actuales; un corte eléctrico completo no se probó.

Si Android conserva el permiso y deja de mostrar el diálogo, registra ese resultado.
No borres las llaves o redes autorizadas para fabricar otra prueba.
Juan-PC debe permanecer encendido y conectado a Tailscale.

## Reversión

Pulsa **Pausar recuperación** para detener las acciones.
Desactiva **Umi Support** en Accesibilidad y desinstala sólo `co.umiconsulting.umi_support` para retirarlo.
Conserva KeepADB y Tailscale.

Diseño y fuentes: `docs/architecture/2026-10-27-umi-support-android.md` y `docs/research/2026-10-27-umi-support-android.md` del repositorio.

La versión 1.0.0 falló porque Material mostró PERMITIR en mayúsculas.
La versión 1.0.1 reconoce el recurso original y esa transformación, con 48 pruebas aprobadas.
El informe y las capturas están en docs/reports/2026-10-27-umi-support-android.md del repositorio.
