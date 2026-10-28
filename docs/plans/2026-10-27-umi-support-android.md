# Plan de implementación de Umi Support

> Ejecución: completar cada tarea y verificar sus resultados antes de instalar en Caja.

**Objetivo:** construir el ayudante local que el propietario solicitó para la autorización ADB de UmiPOS.
**Arquitectura:** aplicación Android independiente, validador puro Java y adaptador de Accesibilidad con acciones limitadas.
**Tecnología:** Java 17, Android SDK 36, Gradle 9.1.0, AGP 9.0.1 y JUnit 4.13.2.
**Diseño:** `docs/architecture/2026-10-27-umi-support-android.md`.

## Restricciones globales

- Aplicación `co.umiconsulting.umi_support`, nombre Umi Support y versión 1.0.1, código 2.
- Android mínimo 11, API 30. Sólo SystemUI firmado por la plataforma y red UmiPOS/BSSID autorizado.
- Sin red, root, cambios financieros, cambios de ADB ni actualización de firmware.
- La política empieza pausada hasta la aceptación del propietario.
- La firma del APK queda fuera del repositorio. No publicar material privado.

## Tarea 1: validador y control de acciones

Archivos: `tools/umi-support-android/app/src/main/java/co/umiconsulting/umi_support/{DialogSnapshot,TrustedDialog,RecoveryEngine}.java`.
Pruebas: los archivos `*Test.java` del mismo paquete en `app/src/test/java`.

- [x] Crear las pruebas antes de implementar la política.
- [x] Ejecutar `./gradlew :app:testDebugUnitTest` y observar el fallo de la aceptación autorizada.
- [x] Implementar `TrustedDialog.nextAction(DialogSnapshot, boolean)` con resultado `NONE`, `CHECK_ALWAYS` o `ALLOW`.
- [x] Implementar `RecoveryEngine.tick(Ui,long,boolean)` con dos lecturas, límite temporal y límite de acciones por ventana.
- [x] Comprobar que otra red, otro paquete, controles duplicados o un cambio entre lecturas producen cero clics.
- [x] Ejecutar de nuevo las pruebas. Exigir cero fallos.

## Tarea 2: servicio y aplicación

Archivos: manifiesto, recursos, `MainActivity.java`, `SupportPreferences.java` y `SupportAccessibilityService.java` dentro de la aplicación.

- [x] Declarar un servicio protegido por `android.permission.BIND_ACCESSIBILITY_SERVICE` y filtrado a SystemUI.
- [x] Cargar los recursos de SystemUI sólo si coincide la firma de plataforma.
- [x] Consultar `getRootInActiveWindow()` y rechazar árboles truncados, controles ausentes o duplicados.
- [x] Volver a validar la pantalla inmediatamente antes de `ACTION_CLICK`.
- [x] Ejecutar reintentos acotados desde `onServiceConnected` y desde los eventos de SystemUI.
- [x] Añadir aceptación local, acceso a ajustes de Accesibilidad, pausa y estado verificable.
- [x] Conservar la aceptación en almacenamiento protegido del dispositivo, con copia de seguridad desactivada.
- [x] Ejecutar `./gradlew :app:testDebugUnitTest :app:lintDebug`.

## Tarea 3: APK y entrega

Archivos: README de la herramienta, informe y evidencia en `docs/reports`.

- [x] Ensamblar un APK release firmado con un almacén externo y permiso 600.
- [x] Ejecutar `apksigner verify --verbose --print-certs` y conservar sólo datos públicos de la firma.
- [x] Inspeccionar el manifiesto: sin INTERNET, sin WRITE_SECURE_SETTINGS, sin gestos ni superposición.
- [x] Revisar el diff y comprobar que `apps/umi-pos/pubspec.lock` conserva su hash inicial.
- [x] Guardar el APK, SHA-256, resultados de pruebas y limitaciones de la prueba física.
- [x] Actualizar la bitácora de ONCA y presentar el resultado antes de pedir instalación, activación y reinicio.

## Prueba física completada

- [x] Instalar el APK y activar Accesibilidad por decisión del propietario.
- [x] Registrar el primer fallo real de reconocimiento del botón.
- [x] Reproducirlo con el diálogo capturado y observar dos pruebas rojas.
- [x] Corregir sólo la etiqueta Material, con 48 pruebas y Lint aprobados.
- [x] Instalar 1.0.1 y verificar la aceptación del diálogo abierto.
- [x] Reiniciar y observar boot_count 7 → 8, nuevo endpoint y ADB automático.
- [x] Ejecutar el doctor y restaurar UmiPOS al frente.
- [x] Guardar evidencia y actualizar la bitácora.
