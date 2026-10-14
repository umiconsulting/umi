# KDS: más espacio, filtros estables y categorías más gruesas

Fecha: 2026-10-13. Seguimiento del ciclo 94. Build final **0.1.0+96**, instalado y verificado en las tres terminales.

> **Seguimiento 0.1.0+98:** se retiró únicamente el selector Preparación/Comandas. Los filtros de estación y jornada siguen disponibles; el build 97 los había quitado por una interpretación equivocada y queda reemplazado por el 98. La pantalla real de A9 y la evidencia final están al final de este reporte; lo anterior documenta el corte visual 96.

## Cambio

El título y Comandas/Preparación comparten la primera fila con sonido y Actualizar.
Las estaciones, los filtros de fecha y Sin estación comparten la segunda fila cuando hay ancho suficiente.
Se conserva el recuento de Anteriores y su ícono de historial.
La explicación de ese recuento queda en su tooltip; ya no ocupa un renglón completo.

En pantallas estrechas, Comandas/Preparación usa un selector desplegable existente.
Los filtros se acomodan en más filas cuando necesitan espacio. Con texto al 200%, su área permite desplazamiento.
La altura de los controles táctiles se mantiene en al menos 48 píxeles lógicos.
Sin estación sigue accesible desde ambas vistas y conserva el permiso `kitchen.read`.
No cambian los pedidos, permisos, acciones de preparación, transporte, API ni base. No hay migración.

La sección del POS y su navegación se llaman **KDS**. **Todos** reemplaza a Expo.
La estación configurada como Cocina conserva su nombre.
Sin estación explica que productos y categorías se asignan desde Cocina en la consola de administración.
El texto también explica actualizar la bandeja y revisar la fecha antes de aplicar las rutas.

Los filtros se alinean al inicio y ocupan el ancho disponible, incluso cuando la estación queda vacía.
Los contadores reservan espacio según el total del tablero. Cambiar de estación no mueve los botones.
El ícono de Anteriores mantiene su espacio con recuento cero.

Las categorías del menú usan peso **700**, redondeado desde 600 × 1.15 = 690.
La subida nominal es 16.7%. La categoría seleccionada ya usaba 700.
Se usa el archivo Bold existente; el ancho del rótulo se mide con ese mismo peso.

El carrito deja de mostrar el resumen «En cola · 0 productos listos» y su botón de consulta.
Se retira tanto del panel ancho como de la hoja del carrito móvil.
La consulta de estado para avisos sonoros al mesero conserva su lógica y deja de reconstruir el carrito por ese resumen.

## Herramientas y decisión

Se aplicó la [skill research](../../.agents/skills/research/SKILL.md).
La [investigación](../research/2026-10-13-kds-encabezado-compacto.md) contiene fuentes oficiales y versiones verificadas.
Flutter 3.47.5 y Dart 3.13.4 proporcionan `LayoutBuilder`, widgets y pruebas de geometría.
Se reutilizan `PosHeader`, `PosTabs`, `PosSelect`, `PosTooltip` y los filtros del KDS.
La disposición local es propia porque pertenece a esta pantalla; no necesita una biblioteca adicional ni cambiar componentes globales.
ADB 37.0.0 permite capturas y clics reales. Prettier 3.9.4 formatea este reporte.
`flutter gen-l10n`, del mismo SDK, regenera las traducciones desde ARB, según la [guía oficial](https://docs.flutter.dev/ui/internationalization).
Se usa `FontWeight.w700`, descrito en la [referencia de Flutter](https://api.flutter.dev/flutter/dart-ui/FontWeight-class.html).

## Pruebas

`flutter analyze`: sin hallazgos. Pruebas focalizadas: **149 aprobadas**.
Incluyen KDS, estado de cocina, roles, catálogo y distribución de la comanda.
Suite completa POS: **938 pruebas aprobadas**.

Tres pruebas nuevas verifican la altura de las dos filas a 1096 y 1280 píxeles lógicos.
También comprueban objetivos táctiles, cambio de vista, fechas y acceso a Sin estación a 360 píxeles con texto al 200%.
La prueba de trabajo anterior ahora espera su explicación en el tooltip y mantiene las verificaciones de filtrado.
El resto de las pruebas de permisos, comandos, avisos, actualización y preparación conserva su premisa.
Dos pruebas nuevas comparan los rectángulos de todos los filtros a 1096 y 520 píxeles.
Pasan de 12 comandas en Todos a Cocina vacía, después Barra y finalmente Todos.
Comprueban que cada control conserva su posición y tamaño, incluidos contadores de dos dígitos y Anteriores.
Las pruebas de estaciones ahora esperan Todos en lugar de Expo.
Las pruebas de navegación y permisos ahora esperan KDS en lugar de Cocina.

Registros: [KDS](evidence/2026-10-13-kds-encabezado-compacto/focused.log),
[analizador](evidence/2026-10-13-kds-encabezado-compacto/analyze.log),
[suite POS](evidence/2026-10-13-kds-encabezado-compacto/suite.log).

## Evidencia Android

El build 95 se instaló en las tres terminales y dejó estas mediciones nativas:

| Terminal          | Primera comanda antes | Primera comanda después | Espacio recuperado |
| ----------------- | --------------------: | ----------------------: | -----------------: |
| A9, 1920 × 1200   |            y = 509 px |              y = 251 px |         **258 px** |
| iMin, 1920 × 1080 |            y = 458 px |              y = 221 px |         **237 px** |

Se midió el borde de la primera comanda en capturas completas, con Pillow 12.3.0, sin editar las imágenes.
La comparación mantuvo orientación y escala.
[A9 antes](evidence/2026-10-13-kds-encabezado-compacto/a9-before-tickets.png),
[A9 después](evidence/2026-10-13-kds-encabezado-compacto/a9-after-tickets.png),
[iMin antes](evidence/2026-10-13-kds-encabezado-compacto/imin-before.png),
[iMin después](evidence/2026-10-13-kds-encabezado-compacto/imin-after.png),
[mediciones](evidence/2026-10-13-kds-encabezado-compacto/geometry.json).

La A11 conserva filtros accesibles en varias filas por su ancho menor.
El build 96 añade los nombres, las categorías y la corrección de posición solicitados durante esta verificación.
Sus capturas conservan y = 251 px en A9 y y = 221 px en iMin para la primera comanda.
[Medición del build 96](evidence/2026-10-13-kds-encabezado-compacto/geometry96.json).

Se pulsó Todos → Cocina vacía en A9. Los filtros conservaron su posición y tamaño visible.
[Todos](evidence/2026-10-13-kds-encabezado-compacto/a9-todos96.png),
[Cocina vacía](evidence/2026-10-13-kds-encabezado-compacto/a9-cocina-vacia96.png),
[Barra](evidence/2026-10-13-kds-encabezado-compacto/a9-barra96.png).
Se abrió [Sin estación](evidence/2026-10-13-kds-encabezado-compacto/a9-sin-estacion96.png) y se comprobó la instrucción de administración.

La iMin muestra la misma Cuenta 150 y Mesa 3, con el resumen retirado y las categorías más gruesas:
[antes](evidence/2026-10-13-kds-encabezado-compacto/imin-menu-before96.png),
[después](evidence/2026-10-13-kds-encabezado-compacto/imin-menu-after96.png).
También se comprobó [KDS en iMin](evidence/2026-10-13-kds-encabezado-compacto/imin-kds96.png),
[KDS en A11](evidence/2026-10-13-kds-encabezado-compacto/a11-kds96.png)
y el [menú móvil](evidence/2026-10-13-kds-encabezado-compacto/a11-menu96.png).
En A11 se comprobó el menú vacío; no se abrió otra cuenta enviada para verificar la hoja móvil con productos.

El [registro final de instalación](evidence/2026-10-13-kds-encabezado-compacto/installed-builds.json)
confirma versión 96 y el mismo SHA-256 del APK local e instalado en cada terminal:
`2ebc3fe8e04db4ed44663a2b4ea162e4d61036cd62da706c1d1d5499de2163ee`.
El APK profile Android ARM64 mide 43.5 MB. [Log de compilación](evidence/2026-10-13-kds-encabezado-compacto/build.log).

La [consulta de lectura](evidence/2026-10-13-kds-encabezado-compacto/verification.sql)
confirma las tres comandas activas 118, 141 y 150 en Barra, sin modificar sus estados.
[Filas de la base](evidence/2026-10-13-kds-encabezado-compacto/database.txt).
Comando usado:

```sh
docker exec -i umi-bv3-pg psql -U postgres -d umi_local < docs/reports/evidence/2026-10-13-kds-encabezado-compacto/verification.sql
```

El [log de API](evidence/2026-10-13-kds-encabezado-compacto/api-requests.jsonl)
contiene lecturas KDS y Sin estación. No hay mutaciones KDS en este recorrido visual.
Preparación respondió 200 para Admin y 403 para Barista.
Las filas de sesión confirman que Barista carece de `inventory.read`, requerido por esa API.
Se registra esa limitación existente; este ajuste visual conserva los permisos.
El [recorrido final de 96](evidence/2026-10-13-kds-encabezado-compacto/api-requests96.jsonl)
registró 189 lecturas KDS, todas GET 200, sin comandos de preparación ni cambios de cuenta.

## Límites

En 360 píxeles con texto al 200%, Sin estación puede requerir desplazar los filtros. Sigue accesible y tiene prueba.
No se vuelve a verificar audio físico, cambio de día, acciones comerciales ni el dashboard en este ajuste visual.
El entorno conserva una API en 4001 y la base `umi_local`.
El APK de desarrollo usa ADB reverse; no acredita conexión directa por LAN.

## Compilación final

El APK final usa el mismo entorno local del ciclo previo. Se conserva `0.1.0+96` para las tres terminales.
La petición de retirar el resumen del carrito llegó durante la compilación inicial de 96.
Se recompiló antes de instalarlo. Sólo el APK final se distribuye.

```sh
cd apps/umi-pos
/home/juan/.local/opt/flutter/bin/flutter build apk --profile --target-platform android-arm64 --build-name 0.1.0 --build-number 96 -PumiposApplicationId=co.umiconsulting.umi_pos.estacion --dart-define=UMIPOS_ENVIRONMENT=development --dart-define=UMIPOS_API_BASE_URL=http://127.0.0.1:4001 --dart-define=UMIPOS_DEVICE_KEY= --dart-define=UMIPOS_CONTRACT_VERSION=2.34.0 --dart-define=UMIPOS_RELEASE_VERSION=0.1.0 --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION=1 --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=true --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=false
```

Por cada serial: `adb -s <serial> reverse tcp:4001 tcp:4001` y `adb -s <serial> install -r build/app/outputs/flutter-apk/app-profile.apk`.

## Corrección de filtros: sólo comandas (build 98)

El selector **Preparación/Comandas** se eliminó y el KDS abre directamente en las comandas. Se mantienen los dos filtros independientes que ya existían: estación (**Todos / Barra / Cocina**) y jornada (**Hoy / Anteriores / Todos**). Quitar esos filtros en el build 97 fue una interpretación incorrecta de “deshaz los dos filtros”; la aclaración del dueño fue que se refería exclusivamente al selector Preparación/Comandas. El build 98 restaura ambos controles y su comportamiento. El botón **Sin estación** permanece como acción de revisión, sujeto al permiso actual.

Las pruebas de cabecera verifican que no existe el selector de preparación, que el KDS abre con Hoy y permite Anteriores, que los filtros de estación siguen operativos y que el diseño compacto aguanta texto al 200%. Las pruebas del tablero conservan el filtrado por jornada y estación; sólo se retiraron las expectativas visuales de la pestaña Preparación. La cobertura independiente del controlador de inventario se conserva.

Flutter **3.47.5**, Dart **3.13.4**, ADB **37.0.0**. `flutter analyze`: sin hallazgos. Suite completa `flutter test`: **934 pruebas aprobadas**. APK profile `0.1.0+98`, SHA-256 `68467ac9e708c4911fae650db0ca013941a1eee418d78793fb3e809991d6c50b`, instalado en iMin `192.168.1.10:5555`, A9 KDS `192.168.1.14:35559` y A11 POS `192.168.1.13:38333`; los tres paquetes reportaron `versionCode=98` (registros en `evidence/2026-10-13-kds-solo-comandas/installed-build98.txt`). El build 97 fue un paso intermedio y está reemplazado.

La [captura real de A9](evidence/2026-10-13-kds-solo-comandas/a9-build98.png) confirma que Cuenta 173 se ve en la vista de comandas, junto con los filtros de estación **Todos / Barra / Cocina** y de jornada **Hoy / Anteriores / Todos**; no hay selector Preparación/Comandas. No se probó una acción sobre la cuenta antigua: este cambio conserva su visibilidad y no altera sus estados ni las reglas de transición/cierre del servidor.
