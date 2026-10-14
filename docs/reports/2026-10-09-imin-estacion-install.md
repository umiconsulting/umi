# Estación instalada en el iMin

Fecha: 9 de octubre de 2026.

UmiPOS Estación está instalado y abierto en el iMin D3, Android 11.
La instalación usa ADB inalámbrico en `192.168.1.10:5555`.
La pantalla muestra el acceso por PIN, con la identidad UMI y los controles propios.

## Instalación comprobada

- Repositorio de origen: `/home/juan/Projects/umiconsulting/umi`, árbol de trabajo con el diseño integrado.
- Los 140 archivos de la revisión N27 conservan sus huellas.
- APK ARM64, variante `profile`, versión `0.1.0`, contrato `2.27.0`.
- API conservada: `http://192.168.1.9:4001`. El terminal alcanza el puerto por Wi-Fi.
- Firma igual a la del APK anterior. Actualización mediante `adb install -r`.
- Fecha de primera instalación conservada: `2026-10-05 18:48:18`.
- Hash del APK instalado igual al del artefacto compilado.
- Estado `readyForAuthentication`; cero marcadores de caída fatal en el proceso observado.
- La actualización conserva los datos del paquete. No se ejecuta desinstalación ni borrado de datos.

El APK anterior y la evidencia detallada están en el directorio privado indicado al final.
La compilación usa el manifiesto profile para la API HTTP de desarrollo existente.
El manifiesto de producción permanece igual.

El APK anterior contiene el cliente Ed25519 y no contiene el literal Dart de keystore.
Esta observación sostiene la decisión de conservar el backend de identidad predeterminado.
El dispositivo conserva su registro y muestra PIN, sin pedir una nueva vinculación.

## Herramientas y fundamento

| Herramienta         | Versión                  | Uso                                                              |
| ------------------- | ------------------------ | ---------------------------------------------------------------- |
| ADB                 | 37.0.0, protocolo 1.0.41 | Actualización del paquete por la conexión inalámbrica existente. |
| Flutter / Dart      | 3.47.5 / 3.13.4          | Compilación del cliente nativo con los archivos revisados.       |
| JDK                 | 17.0.20.1                | Compilación Android instalada.                                   |
| Android build-tools | 36.0.0                   | Comprobación de firma, manifiesto, permisos y arquitectura.      |

Fuentes primarias: [procedimiento del proyecto](../development/UMIPOS_ANDROID_INSTALL.md), APK anterior, APK nuevo y observación del terminal.
ADB y el SDK ya están instalados. La conexión existente no necesita un nuevo emparejamiento ni una herramienta propia.
El SDK incluye una segunda copia de ADB como alternativa; no fue necesaria.

La comprobación cubre instalación y acceso. No introduce un PIN ni ejecuta ventas, pagos o impresión física.
Para abrir la comanda, introduce tu PIN habitual en el terminal.

APK SHA-256: `31d9925c40f2cf30c1396432cc92b92e6a2b8122fa9c9c17af6677eac13d08e9`.

Evidencia local privada: `/home/juan/Projects/umiconsulting/umi/apps/umi-pos/.estacion-runtime/imin-install-20261009T172150Z`.
