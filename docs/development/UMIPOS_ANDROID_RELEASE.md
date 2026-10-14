# Release de Android para UmiPOS

## Entornos

Usa `--flavor development`, `--flavor staging` o `--flavor production` en Android.
Cada variante usa su propio proyecto Firebase. El complemento Google Services
lee `apps/umi-pos/android/app/src/<variante>/google-services.json` para staging y
producción. Desarrollo conserva el archivo de la raíz del módulo Android.
Gradle detiene la compilación si `UMIPOS_ENVIRONMENT` no coincide con la variante.
También detiene staging y producción si falta su archivo Firebase o su ID de proyecto.

El cliente exige el mismo entorno que devuelve `/health/release` en la API.
Por ello, una instalación que usa `https://api.umiconsulting.co` debe usar
`UMIPOS_ENVIRONMENT=production`. La API y el cliente deben salir de una revisión
compatible antes de instalar el APK.

## Firma

Configura estas variables en la terminal que compila. Guarda el archivo de llave
fuera del repositorio y respáldalo en un lugar seguro:

```text
UMIPOS_ANDROID_KEYSTORE_PATH=/ruta/absoluta/fuera/del/repositorio/umi-pos-release.jks
UMIPOS_ANDROID_KEY_ALIAS=umi-pos-release
UMIPOS_ANDROID_KEYSTORE_PASSWORD=<contraseña del almacén>
UMIPOS_ANDROID_KEY_PASSWORD=<contraseña de la llave>
```

La variante `release` exige las cuatro variables. Gradle rechaza una llave que
esté dentro del repositorio. La variante `release` nunca usa la llave de depuración.
Los builds `debug` y `profile` conservan su firma de desarrollo.

El build 129 instalado en las tres terminales tiene firma de depuración. Android
rechaza `adb install -r` si el APK nuevo usa otra firma. Antes de desinstalarlo,
verifica que el diario sin conexión esté vacío. Después de instalar el APK nuevo,
registra cada terminal de nuevo en producción.

## Compilación y verificación

Compila sólo desde una revisión identificada y con el árbol limpio. El contrato
del APK debe corresponder al de la API desplegada. Este ejemplo muestra el
contrato `2.39.0` del código de 2026-10-14; no uses ese valor con una API anterior.

```sh
cd apps/umi-pos
test -z "$(git status --porcelain)"
release_commit="$(git rev-parse HEAD)"
release_timestamp="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
flutter build apk --release --flavor production --target-platform android-arm64 \
  --build-name 0.1.0 --build-number 130 \
  -PumiposApplicationId=co.umiconsulting.umi_pos.estacion \
  --dart-define=UMIPOS_ENVIRONMENT=production \
  --dart-define=UMIPOS_API_BASE_URL=https://api.umiconsulting.co \
  --dart-define=UMIPOS_DEVICE_KEY=keystore \
  --dart-define=UMIPOS_CONTRACT_VERSION=2.39.0 \
  --dart-define=UMIPOS_RELEASE_VERSION=0.1.0 \
  --dart-define=UMIPOS_RELEASE_GIT_COMMIT="$release_commit" \
  --dart-define=UMIPOS_RELEASE_BUILD_TIMESTAMP="$release_timestamp" \
  --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION=1 \
  --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled \
  --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=false \
  --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=false
```

El archivo esperado es `build/app/outputs/flutter-apk/app-production-release.apk`.
Antes de instalarlo, compara `/health/release` con la identidad del build.
Verifica la firma, el paquete y el número de versión:

```sh
apksigner verify --print-certs build/app/outputs/flutter-apk/app-production-release.apk
aapt2 dump badging build/app/outputs/flutter-apk/app-production-release.apk
sha256sum build/app/outputs/flutter-apk/app-production-release.apk
```

El procedimiento usa Flutter 3.47.5, Gradle 9.1.0 y Google Services 4.5.0.
La [guía oficial de Flutter](https://docs.flutter.dev/deployment/android) recomienda
una llave privada para firmar `release`. La [guía oficial de Firebase](https://firebase.google.com/docs/projects/multiprojects)
recomienda un archivo Android por variante. La [guía de Android sobre actualizaciones](https://developer.android.com/google/play/app-updates)
explica por qué un cambio de firma exige reinstalar la aplicación.
