# N18 · Texto aumentado en Flutter Linux

Investigación primaria consultada **2026-10-08**, después de N17 `5b2cb80`. **HD** = hecho documentado; **TR** = tradeoff respaldado; **IN** = decisión/inferencia; **NV** = no verificado. Lectura de SDK, fuentes propias, herramientas instaladas y fork; no abrí GUI, ejecuté el POS ni modifiqué aplicación, datos o preferencias globales.

**IN — dirección recomendada:** una preferencia real del POS «Sistema / Grande / Muy grande» puede ofrecer una mejora útil y verificable. «Sistema» conserva el escalador original; las otras opciones aplican mínimos 1.5 y 2.0 sin techo. El driver nativo existente permite accionar ese control y observar la ventana real. Esta evidencia probaría la función de la aplicación y su adaptación; el transporte de preferencias del escritorio y la curva Android seguirían requiriendo pruebas propias.

## Instrumentos disponibles

| Instrumento | Versión y licencia comprobadas | Uso, mantenimiento y costo |
| --- | --- | --- |
| Flutter / Dart / `flutter_driver` | **Flutter 3.47.5 stable, Dart 3.13.4**, SDK local `/home/juan/.local/opt/flutter`; revisión Flutter `6a19cca56475dbfba1478ee68d7bd0c2ef891da1`, commit **2026-09-17**. BSD de tres cláusulas del SDK; `flutter_driver` es paquete de ese árbol, sin versión independiente declarada en su pubspec leído. | HD: ya instalados. Fuentes fijadas y primitivas `widgets`/`painting` permiten mantener UI propia. [Flutter](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/LICENSE). No se propone añadir biblioteca UI. |
| Driver del repo + Dart VM Service | [pos-native-driver.mjs](../../../tools/ux-sweep/pos-native-driver.mjs:407), ejecutable con Node **24.21.0**, leído, no ejecutado. [Entrypoint de desarrollo](../../../apps/umi-pos/test_driver/driver_main.dart:1) ya habilita Flutter Driver. | HD: publica/accede a árbol semántico y renderizado, geometría y acciones reales; el script calcula origen y DPR. IN: instrumento adecuado para accionar la futura preferencia y recoger evidencia. NV: resultado de esa tarea N18. Licencia propia del script: no determinada aquí. |
| GTK / GLib-GSettings | **GTK 3.24.52**, **GLib 2.88.3**; `pkg-config` y paquetes locales. LGPL-2.1-or-later según metadatos instalados. `gsettings`, `gdbus` y `gtk-query-settings` disponibles. | HD: herramientas del host, sin instalación. `gtk-query-settings` no es un inspector del texto dibujado por Flutter. Docs web Gio consultadas corresponden a **2.91.0**, por eso contrasté el SDK/local. |
| D-Bus y captura del compositor | `dbus-run-session` **1.16.2**, AFL-2.1 o GPL-2.0-or-later; `grim` **1.5.0**, MIT; Hyprland **0.56.2**, BSD-3-Clause. Versiones/licencias en paquetes instalados. | HD: hay bus aislado y captura disponibles. TR: aislamiento de bus puede cambiar acceso a portales; una captura por sí sola no mide escala ni permite certificar legibilidad. |

HD: apliqué [research](../../../.agents/skills/research/SKILL.md), [doctrina](../../agents/tool-and-research-doctrine.md) y [playbook](../2026-09-16-research-channels-playbook.md). Peldaños usados: documentación oficial, fuente fijada del SDK, código del proyecto y experimentos originales. Esta nota no instala instrumentos ni ejecuta una inspección interactiva.

## 1. Cómo llega la escala de texto en Linux

HD: [`fl_settings_new`](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/engine/src/flutter/shell/platform/linux/fl_settings.cc#L57) intenta primero XDG Desktop Portal. Sólo si su inicialización devuelve false usa la implementación GNOME. El [portal del SDK](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/engine/src/flutter/shell/platform/linux/fl_settings_portal.cc#L51) lee **`org.gnome.desktop.interface` / `text-scaling-factor`**, tipo double, desde `org.freedesktop.portal.Settings`, y escucha `SettingChanged`. Si no obtuvo esa clave, devuelve **1.0**.

HD: [`FlGnomeSettings`](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/engine/src/flutter/shell/platform/linux/fl_gnome_settings.cc#L70) consulta la misma clave mediante GSettings y conecta su señal de cambio. [`FlSettingsHandler`](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/engine/src/flutter/shell/platform/linux/fl_settings_handler.cc#L36) envía la escala por [`flutter/settings`](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/engine/src/flutter/shell/platform/linux/fl_settings_channel.cc#L52). `PlatformDispatcher` actualiza configuración y notifica cambios; [`SystemTextScaler`](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/widgets/media_query.dart#L2473) obtiene cada tamaño mediante `scaleFontSize`.

HD/TR: el canal Linux leído no envía `configurationId`; [scaleFontSize](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/engine/src/flutter/lib/ui/platform_dispatcher.dart#L1549) usa multiplicación lineal cuando ese ID no existe. Esto describe esta ruta del SDK, sin afirmar que toda plataforma Flutter escala linealmente. [Android 14](https://developer.android.com/about/versions/14/features#non-linear-font-scaling) documenta una curva donde los tamaños grandes crecen menos y recomienda comprobar el máximo. Página viva: fecha individual no fijada, consultada 2026-10-08.

HD/TR: la [interfaz del portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html) es el contrato del transporte; la presencia de un portal no prueba que exporte todas las claves que pide Flutter. En el SDK, `fl_settings_portal_start` puede devolver true aunque fallen lecturas individuales. **IN:** un bus privado sin esa clave puede acabar en 1.0 sin usar el fallback GNOME. Registrar proveedor, valor recibido y salida observable antes de declarar que se probó escala del sistema.

HD: no encontré `GTK_TEXT_SCALE_FACTOR` en el código Linux del SDK ni en la [guía oficial GTK 3 de ejecución](https://docs.gtk.org/gtk3/running.html). **NV:** no existe evidencia aquí de que esa variable configure Flutter; no debe inventarse como interfaz. Cambiar DPR, dimensiones de ventana o zoom del compositor tampoco equivale por sí solo a aumentar el `TextScaler` de la aplicación.

## 2. Idoneidad de «Sistema / Grande / Muy grande»

HD: [`TextScaler.clamp`](https://api.flutter.dev/flutter/painting/TextScaler/clamp.html) limita **cada tamaño resultante** entre `minScaleFactor * fontSize` y `maxScaleFactor * fontSize`. El máximo predeterminado es infinito. La [implementación fijada](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/painting/text_scaler.dart#L117) consulta primero el escalador envuelto y después limita el resultado. Si mínimo y máximo coinciden, produce un escalador lineal. API sin fecha individual; versión determinada por SDK, no por su footer web «Flutter 0.0.0».

IN: contrato propuesto para una fuente base `f` y estrategia del sistema `S`:

| Elección | Tamaño efectivo propuesto | Consecuencia |
| --- | --- | --- |
| Sistema | `S.scale(f)` | Mantener el objeto/estrategia original, sin override. |
| Grande | `max(S.scale(f), 1.5*f)` | Piso, no multiplicación adicional de 1.5 sobre la preferencia del sistema. |
| Muy grande | `max(S.scale(f), 2*f)` | Piso, sin reducir un tamaño del sistema que ya lo supere. |

TR: envolver una estrategia no lineal conserva sus valores **por encima del piso**; modifica los que quedan por debajo. Por tanto, no afirmar «conserva intacta toda la curva no lineal». En una curva hipotética, base 12→22 permanece 22 con piso 1.5, mientras base 32→40 subiría a 48. Es una explicación aritmética, no una medición de Android.

HD/TR: la [migración oficial a TextScaler](https://docs.flutter.dev/release/breaking-changes/deprecate-textscalefactor), actualizada **2026-05-05**, explica que un scalar no representa la nueva estrategia y que el getter `textScaleFactor` es una estimación deprecada. IN: evitar `TextScaler.linear(system.textScaleFactor)` y evitar un techo 2.0 que pueda recortar una preferencia mayor. «Muy grande» no promete que todo texto mida exactamente el doble si el sistema ya solicita más.

HD: [`MediaQuery.withClampedTextScaling`](https://api.flutter.dev/flutter/widgets/MediaQuery/withClampedTextScaling.html) aplica ese clamp al escalador actual y exige estar debajo de un `MediaQuery`. HD local al iniciar N18: [`DisplayPreferences`](../../../apps/umi-pos/lib/core/theme/display_preferences.dart:12) persiste `display.v1`, tema/idioma/movimiento; [`PosApp`](../../../apps/umi-pos/lib/core/theme/pos_ui.dart:86) usa `WidgetsApp` y un builder con acceso a MediaQuery. **IN:** campo opcional aditivo, ausencia=Sistema, validar valores reconocidos y conservar errores de escritura actuales. Aplicar una sola vez por encima del Navigator para cubrir páginas y overlays, conservando otras propiedades del MediaQuery. No transformar importes ni estado monetario.

TR/IN: en un dispositivo compartido, esta preferencia puede beneficiar al siguiente operador o sorprenderlo. Explicar que afecta a esta aplicación/dispositivo, conservar una salida visible a «Sistema» y definir persistencia/ámbito. Una preferencia no justifica forzar texto pequeño para que una rejilla conserve su densidad.

## 3. Qué instrumento permite demostrarlo en la ventana real

IN: una vez implementado el control real, usar **el driver nativo existente** para elegir Grande/Muy grande desde Ajustes, abrir superficies y recoger render tree, semántica y captura de la ventana, con dimensiones/DPR constantes. Conservar baseline Sistema y repetir después de reiniciar para comprobar persistencia. Registrar tamaño base y `textScaler.scale(base)` de varios roles, no sólo el getter estimado. Accionar controles visibles evita presentar una inyección interna como si fuera una función del producto.

HD/TR: [Dart VM Service `evaluate`](https://github.com/dart-lang/sdk/blob/main/runtime/vm/service/service.md#evaluate) evalúa expresiones en el contexto de biblioteca, clase o instancia. El driver ya hace RPC al servicio. **IN/NV:** una inspección de sólo lectura puede consultar estrategia/tamaños de los objetos efectivos. Inyectar `_updateUserSettingsData` sería una técnica dependiente de implementación privada, aún no probada aquí; además recibe un JSON con varias preferencias y puede cambiar campos omitidos. No la recomiendo como evidencia principal de esta función ni como prueba del portal.

HD/TR: [GSettings memory backend](https://docs.gtk.org/gio/func.memory_settings_backend_new.html) no persiste cambios entre ejecuciones. IN: configurar una clave en otro proceso `gsettings` con backend memory no proporciona automáticamente ese valor al proceso Flutter. [dbus-run-session](https://dbus.freedesktop.org/doc/dbus-run-session.1.html) crea un bus de sesión privado, pero eso por sí solo no aisla toda configuración ni garantiza datos de portal. La combinación requeriría una prueba de proveedor real; no publiqué una receta no comprobada.

IN: evidencia mínima útil: Sistema→Grande→Muy grande→Sistema; etiquetas largas ES/EN; anchuras 390, 768 y 1280; navegación, foco, desplazamiento y acciones accesibles; nombres, variantes, cantidades e importes; búsqueda/filtros; diálogo, selector y recibo. Distinguir texto completo alcanzable de texto que sólo está en la semántica pero visualmente tapado. Esperar el guardado y una reconstrucción real antes de capturar.

NV: el driver en debug, imágenes, árbol y ausencia de overflow no certifican comodidad a distancia de caja, agudeza visual, rendimiento release, voz, IME, curvas Android o transporte GTK/portal. Una ventana Linux de 390px tampoco equivale a un teléfono físico. La prueba de una preferencia propia no cierra automáticamente la brecha de respetar cambios externos del sistema.

## 4. Legibilidad, densidad y continuidad artística

HD: [Flutter Accessibility](https://docs.flutter.dev/ui/accessibility), actualizado **2026-07-31**, pide que la UI siga legible y usable con texto y display muy aumentados. [W3C Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) explica aumento hasta 200% sin perder contenido/función; [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) distingue reorganizar contenido de exigir desplazamiento en dos ejes. WCAG 2.2 consultado es Recommendation **2024-12-12**. **TR:** usar esas condiciones como criterios de diseño; estas páginas no certifican un POS nativo ni prueban su velocidad.

HD: [IBM Type scale](https://www.ibm.com/design/language/typography/type-scale/), **2026-10-01** según HTML propio recuperado, relaciona tamaño e interlínea, propone subconjuntos de la escala por uso y reconoce el efecto de distancia de observación. **IN:** jerarquía consistente con pocos roles; aumentar altura/reflujo cuando crece texto antes de reducirlo. Los factores de cartelería de esa guía no se trasladan automáticamente a un terminal de café.

HD/TR: [Everett/Byrne, CHI **2004-04-24–29**](https://www.researchgate.net/publication/221514619_Unintended_effects_Varying_icon_spacing_changes_users%27_visual_search_strategy), manuscrito del autor revisado anteriormente y reabierto, muestra que más separación puede alterar búsqueda y estrategia. [Reppa/McDougall, **2015-01-17**](https://link.springer.com/article/10.3758/s13423-014-0794-z) encuentra beneficios del atractivo bajo condiciones concretas de búsqueda compleja. No fijan columnas, tamaño de fuente ni espaciado ideales para cajeros. **IN:** comparar tareas completas con productos iguales; una galería bella o una rejilla con menos tarjetas no demuestra mejor operación.

HD artístico: [Low-tech Magazine, **2018-09-24**](https://solar.lowtechmagazine.com/2018/09/how-to-build-a-low-tech-website/) explica identidad con tipografía y tratamiento propio de imágenes; [Progress, Nick Montfort, **2022**](https://thehtml.review/01/progress) permanece en la cadena de investigación previa por su relación con texto y cobertura de glifos. **IN:** conservar personalidad en títulos, signo y composición, mientras etiquetas/importes legibles organizan el trabajo. El crecimiento del texto debe revelar una jerarquía resistente; no justificar ocultar nombres para mantener una silueta decorativa. Estas obras inspiran mecanismos, no aportan ensayos de usabilidad del POS.

## Rutas fallidas y alcance final

| Ruta | Resultado y recuperación |
| --- | --- |
| Búsqueda `GTK_TEXT_SCALE_FACTOR` / `gtk-xft-dpi` en engine Linux | Sin coincidencias. Se rastreó FlSettings→portal/GSettings→canal→PlatformDispatcher. La ausencia local no es prueba universal sobre todos los programas GTK. |
| `apps/umi-pos/lib/app.dart`, `bootstrap/umi_pos_app.dart` | No existen. Inventario encontró preferencias y wrapper en `core/theme`. |
| `packages/flutter_driver/LICENSE` | No existe archivo propio ahí; licencia del SDK Flutter leída. |
| IBM Type scale vía lector web | Timeout; curl recuperó `/tmp/N18-ibm-type-scale.html` y extractor estándar obtuvo texto y fecha. |
| Metadatos `nodejs`, `xorg-xwd`, `python-atspi`, `python-pyatspi` | Esos nombres no constan como paquetes de pacman. Node sí está disponible y respondió 24.21.0. No inferí ausencia de herramientas sólo desde nombre de paquete. |

Sólo se añadió esta nota al fork. **NV:** control real, persistencia, reflujo y tareas nativas N18; pendientes de implementación/inspección del agente principal. Ningún hallazgo permite elevar por sí solo la puntuación a 10.0.
