# UmiPOS en Google Play

El flujo `umi-pos · Google Play internal` compila y firma el AAB de producción.
La opción `publish` envía el archivo al canal interno. El valor inicial es `false`.
El flujo usa el paquete `co.umiconsulting.umi_pos` y la API `https://api.umiconsulting.co`.
La distribución directa conserva el paquete `co.umiconsulting.umi_pos.estacion`.

## Configuración inicial

Google exige una primera carga desde Play Console antes de aceptar publicaciones mediante la API.
La API tampoco acepta los consentimientos legales de la primera publicación.
Consulta la [documentación de Edits](https://developers.google.com/android-publisher/edits).

1. Ejecuta el flujo con `publish=false`.
2. Descarga el artefacto `umipos-play-<build_number>` desde GitHub Actions.
3. Carga `UmiPOS.aab` en la versión interna de Play Console.
4. Completa la configuración de Play App Signing y la primera publicación interna.
5. Abre **Users and permissions** en Play Console.
6. Agrega `github-play-internal@umiconsulting-pos-prod.iam.gserviceaccount.com`.
7. Limita el acceso a UmiPOS.
8. Concede **View app information (read-only)** y **Release apps to testing tracks**.

El flujo conserva las listas actuales de testers.
La cuenta de servicio requiere permisos de pruebas; este flujo no publica en producción.
Consulta los [permisos de Play Console](https://support.google.com/googleplay/android-developer/answer/9844686).

El AAB usa la llave de carga existente. Google puede usar otra llave para firmar las instalaciones de Play.
Selecciona esa configuración durante la primera carga.
Consulta [Play App Signing](https://developer.android.com/studio/publish/app-signing).

## Configuración de GitHub

Los secretos del repositorio contienen la llave de carga y sus contraseñas:

| Secreto                            | Contenido                             |
| ---------------------------------- | ------------------------------------- |
| `UMIPOS_ANDROID_KEYSTORE_B64`      | Almacén de firma existente, en Base64 |
| `UMIPOS_ANDROID_KEYSTORE_PASSWORD` | Contraseña del almacén                |
| `UMIPOS_ANDROID_KEY_PASSWORD`      | Contraseña de la llave                |

La llave usa el alias `umi-pos-release`.
El script exige la huella documentada en [UMIPOS_ANDROID_RELEASE.md](UMIPOS_ANDROID_RELEASE.md).
El flujo elimina la copia temporal del almacén al terminar.

Estas variables seleccionan la identidad de publicación:

| Variable                      | Valor                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `UMIPOS_PLAY_SERVICE_ACCOUNT` | `github-play-internal@umiconsulting-pos-prod.iam.gserviceaccount.com`                            |
| `UMIPOS_PLAY_WIF_PROVIDER`    | `projects/754650387881/locations/global/workloadIdentityPools/github-play/providers/github-main` |

Workload Identity Federation entrega credenciales temporales al flujo.
La condición exige el ID del repositorio, el ID de la organización, `main` y este archivo de flujo.
La cuenta de servicio carece de roles sobre los datos del proyecto.
La conexión no requiere un archivo JSON con una llave privada de Google.
Consulta la [guía oficial de GitHub y Google](https://github.com/google-github-actions/auth#workload-identity-federation).

## Cada versión

Ejecuta desde `main`:

```sh
gh workflow run umi-pos-play-internal.yml \
  --repo umiconsulting/umi --ref main \
  -f version=0.1.0 \
  -f build_number=339 \
  -f publish=true \
  -f release_notes='Mejoras de pedidos, ventas y control de caja.'
```

Usa un `build_number` nuevo, mayor que los códigos anteriores.
Google rechaza los códigos repetidos. El límite es `2100000000`.
El número `339` es un ejemplo; verifica las cargas anteriores antes de usarlo.
Las notas usan `es-419` y aceptan hasta 500 caracteres.
La versión visible acepta `major.minor.patch`.

El flujo mantiene una sola ejecución de publicación a la vez.
Evita cambios simultáneos en Play Console durante la publicación mediante la API.
Un cambio desde Console puede descartar la edición de la API.
La versión aparece en pruebas internas después de que Google acepta la publicación.

Si una carga falla, revisa el estado en Play Console antes de repetirla.
Un AAB ya cargado necesita un código nuevo en el próximo intento.
Una app que continúa en borrador puede exigir completar la primera publicación desde Console.

## Herramientas y verificación

- Flutter `3.47.5` compila el AAB con las arquitecturas predeterminadas de Flutter.
- Bundletool `1.18.3` valida el archivo y comprueba el paquete, el código y el modo release.
- `jarsigner` verifica la firma. `keytool` obtiene la huella del certificado.
- `actionlint` `1.7.12` comprueba el flujo durante la verificación local.
- `google-github-actions/auth` `v3` entrega las credenciales después de la compilación.
- `r0adkll/upload-google-play` `v1.1.5` publica en `internal` con estado `completed`.

Los Actions usan revisiones completas. Bundletool exige su suma SHA-256.
El contrato se lee del archivo generado del repositorio.
Los indicadores de diagnóstico, simulación y bootstrap permanecen desactivados.
El flujo no instala una versión en las terminales existentes.

La herramienta de publicación evita mantener un cliente propio de la API de Play.
Su licencia es MIT. El Action de Google usa Apache-2.0.
Consulta [upload-google-play](https://github.com/r0adkll/upload-google-play),
[Bundletool](https://github.com/google/bundletool/releases/tag/1.18.3) y
[los límites de versionCode](https://developer.android.com/studio/publish/versioning).
