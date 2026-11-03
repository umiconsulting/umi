# Task 3D — iconos y arranque con umi

Fecha: 2026-11-02. Rama: `feat/redesign-parity`.
Base de implementación: `ec0003bca6231dcad450462888d3fa2fb3a7ca14`.

## Cambio

Los iconos de Android, iOS, macOS, Windows y desarrollo web usan la palabra aprobada `umi`.
Android usa el mismo contorno en el icono adaptativo y en las pantallas de arranque anteriores y posteriores a Android 12.
iOS usa tres imágenes de arranque y el storyboard existente, con la imagen centrada.

La fuente única es `apps/umi-pos/assets/branding/umi-wordmark.svg`.
El exportador obtiene los contornos del TTF existente con CoreText.
Conserva el espaciado aprobado de `.u-logo`: −1px para 29px, equivalente a −1/29 em.
El resultado contiene tres glifos, 57 comandos y una caja de 1626.034483 × 747 unidades.
El SVG y los dos VectorDrawable usan los mismos comandos de contorno.

El color del contorno es `#172440`; la superficie es `#FFFEFA`.
Estos valores coinciden con el prototipo aprobado y `PosPalette`.
El archivo `assets/branding/README.md` documenta la fuente, su licencia SIL OFL 1.1, los tamaños y la generación.
Los iconos carecen de borde, máscara o sombra pintados.

SHA256 del TTF: `b3c5133bc53549fdac082b999117efd76f52c92ed6032895bc91e01aa14d93d2`.
SHA256 del SVG: `026ce9e7045e6b5537c475de9646149be0e297da7e8508e343ddbc7179a499a7`.

## Archivos

- `apps/umi-pos/assets/branding/`: fuente SVG y documento de desarrollo.
- `apps/umi-pos/tool/export_umi_wordmark.swift`: extracción directa del TTF, sin resolución por nombre ni fuente instalada.
- `apps/umi-pos/tool/generate_umi_branding.cjs`: 40 derivados; comparación reproducible mediante `--check`.
- `apps/umi-pos/tool/umi_branding_ico.py`: contenedor ICO mediante Pillow.
- `apps/umi-pos/tool/verify_umi_branding.py`: dimensiones, canales, contornos, zonas seguras, ICO y manifiestos.
- `apps/umi-pos/android/app/src/main/res/`: cinco PNG, dos vectores, icono adaptativo, color y recursos de arranque.
- `apps/umi-pos/ios/Runner/Assets.xcassets/`: quince PNG únicos de iconos y tres imágenes de arranque.
- `apps/umi-pos/ios/Runner/Base.lproj/LaunchScreen.storyboard`: superficie aprobada y tamaño lógico de imagen 288 × 288pt.
- `apps/umi-pos/macos/Runner/Assets.xcassets/AppIcon.appiconset/`: siete PNG.
- `apps/umi-pos/windows/runner/resources/app_icon.ico`: siete entradas, de 16 a 256px.
- `apps/umi-pos/web/`: cinco PNG y los colores del manifiesto de desarrollo.

Los identificadores, permisos, firmas y archivos de seguridad conservan sus bytes anteriores.
Los archivos Dart, las dependencias y la secuencia nativa de arranque conservan sus bytes anteriores.
Los recursos añaden la marca a las pantallas que el sistema ya utiliza.
El plan y el informe de datos que modificó root quedan fuera de este commit.

## Herramientas y fuentes

Herramientas medidas: Swift 6.3.2, Sharp 0.35.5, libvips 8.18.7, librsvg 2.63.2 y Pillow 12.2.0.
La validación usó aapt2 2.20-13193326 del SDK 36 y actool 27.2, bundle 25408.
La aplicación añade cero dependencias de runtime.

Referencias oficiales:

- [Android adaptive icons](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive).
- [Android splash screens](https://developer.android.com/develop/ui/views/launch/splash-screen).
- [Android VectorDrawable y SVG pathData](https://developer.android.com/reference/android/graphics/drawable/VectorDrawable).
- [Apple app icons](https://developer.apple.com/design/human-interface-guidelines/app-icons).
- [Apple launch screen](https://developer.apple.com/documentation/xcode/specifying-your-apps-launch-screen).
- [Microsoft app icons](https://learn.microsoft.com/en-us/windows/apps/design/style/iconography/app-icon-construction).
- [Sharp](https://sharp.pixelplumbing.com/) y [Pillow ICO](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html#ico).

Hecho documentado: Android reserva círculos seguros de 66dp para el icono adaptativo y de 192dp para el splash sin fondo de icono.
Inferencia de implementación: reducir el contorno conserva las tres letras y evita depender de una máscara específica.
La caja completa del contorno cabe dentro de cada círculo, incluidos sus extremos y el punto de la `i`.

## Verificación ejecutada

Desde la raíz del repositorio:

```sh
xcrun swift -module-cache-path /private/tmp/umi-brand-swift-module-cache apps/umi-pos/tool/export_umi_wordmark.swift
node apps/umi-pos/tool/generate_umi_branding.cjs /Users/moon/Documents/umipos-redesign/node_modules/sharp
node apps/umi-pos/tool/generate_umi_branding.cjs /Users/moon/Documents/umipos-redesign/node_modules/sharp --check
python3 apps/umi-pos/tool/verify_umi_branding.py
node --check apps/umi-pos/tool/generate_umi_branding.cjs
python3 -m py_compile apps/umi-pos/tool/verify_umi_branding.py apps/umi-pos/tool/umi_branding_ico.py
git diff --check
```

Resultados: 40 derivados coinciden byte por byte en `--check`.
La segunda extracción produjo el mismo SHA256 del SVG.
El verificador aprobó 35 PNG, siete entradas del ICO, ambos vectores y los manifiestos nativos y web.
Los iconos PNG son RGB opacos; las tres imágenes de arranque son RGBA con transparencia real.
Los catálogos existentes conservaron todos sus tamaños y referencias.
El verificador también comprobó la referencia del recurso Windows `Runner.rc`.

La caja del icono adaptativo tiene radio máximo 32.0899dp, menor que los 33dp seguros.
La caja del splash tiene radio máximo 92.4400dp, menor que los 96dp seguros.
Una prueba adicional renderizó ambos vectores desde sus XML reales a escala 4× mediante Sharp.
Cada píxel con alpha positivo quedó dentro del círculo seguro correspondiente.
Todos los píxeles de tinta de los PNG opacos quedaron dentro del círculo central del 80%.

La inspección visual del PNG de 1024px y de las máscaras circular y cuadrada redondeada mostró las tres letras completas.
Vista local de los recursos: `/private/tmp/umi-brand-validation/mask-preview.png`.
Esta vista es una composición de recursos, no una captura del producto.
El tamaño mínimo de 16px recibió una inspección local a tamaño real y ampliado.

### Android

```sh
/Users/moon/Library/Android/sdk/build-tools/36.0.0/aapt2 compile --dir apps/umi-pos/android/app/src/main/res -o /private/tmp/umi-brand-resources.zip
/Users/moon/Library/Android/sdk/build-tools/36.0.0/aapt2 link -o /private/tmp/umi-brand-validation/resources.apk -I /Users/moon/Library/Android/sdk/platforms/android-36/android.jar --manifest /private/tmp/umi-brand-validation/AndroidManifest.xml /private/tmp/umi-brand-resources.zip
/Users/moon/Library/Android/sdk/build-tools/36.0.0/aapt2 dump resources /private/tmp/umi-brand-validation/resources.apk
```

Compilación y enlace terminaron con código 0.
El manifiesto temporal copia el original y añade el namespace que aporta Gradle.
También resuelve `${applicationName}` como `android.app.Application` únicamente para el enlace aislado.
El primer enlace rechazó el placeholder sin resolver; el segundo enlace aprobó los recursos.
El manifiesto del producto conserva sus bytes anteriores.
El volcado confirmó el icono `anydpi-v26` y las propiedades del splash en `v31` y `night-v31`.
Los temas normales y los padres de los temas de arranque conservan sus valores anteriores.

### Apple

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun ibtool --compile /private/tmp/umi-brand-LaunchScreen.storyboardc --sdk iphoneos --minimum-deployment-target 15.0 apps/umi-pos/ios/Runner/Base.lproj/LaunchScreen.storyboard
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun actool --compile /private/tmp/umi-brand-validation/ios --platform iphoneos --minimum-deployment-target 15.0 --app-icon AppIcon --target-device iphone --target-device ipad --output-partial-info-plist /private/tmp/umi-brand-validation/ios-info.plist apps/umi-pos/ios/Runner/Assets.xcassets
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun actool --compile /private/tmp/umi-brand-validation/macos --platform macosx --minimum-deployment-target 10.15 --app-icon AppIcon --output-partial-info-plist /private/tmp/umi-brand-validation/macos-info.plist apps/umi-pos/macos/Runner/Assets.xcassets
```

Las tres compilaciones terminaron con código 0.
ibtool produjo dos NIB y el Info.plist del storyboard.
actool produjo `Assets.car` en ambas plataformas y `AppIcon.icns` para macOS.
El primer intento con xcrun sin `DEVELOPER_DIR` no encontró actool ni ibtool en las herramientas CLI seleccionadas.
La ruta explícita de Xcode resolvió ese problema sin cambiar la selección global.
Xcode emitió avisos de conexión con CoreSimulator dentro del sandbox, pero produjo los recursos compilados indicados.

## Límites y siguiente comprobación

Root conserva la instalación, los arranques en frío y la comparación del launcher real.
Este cambio no ejecutó aplicaciones, simuladores, fixtures ni operaciones de backend.
La compilación aislada de recursos no sustituye la compilación completa ni la observación del producto.
La apariencia real en Windows y macOS requiere sus plataformas respectivas.
La verificación del arranque real de iOS conserva los requisitos existentes de seguridad y firma.
No se ejecutó el analizador Dart porque el cambio no modifica archivos Dart.
La reproducción entre otras versiones de CoreText o librsvg no queda probada; el SVG versionado fija el contorno autorizado.
