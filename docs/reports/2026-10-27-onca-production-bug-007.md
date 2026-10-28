# ONCA, puesta a punto de terminales y firma

## Resultado

Las cuatro terminales usan el APK 333 con una llave de release privada. La
rotación de Android conservó los datos de la aplicación y terminó la transición
desde la llave de depuración.

La configuración de las terminales quedó así:

| Terminal   | Modo   | Acceso comprobado |
| ---------- | ------ | ----------------- |
| Caja iMin  | UmiPOS | Cajero ONCA       |
| Barra A9+  | UmiKDS | Barista           |
| Cocina A9+ | UmiKDS | Cocinero 1        |
| Mesero A11 | UmiPOS | Mesero 1          |

## Correcciones operativas

1. Caja tenía una sesión de Cajero en otro registro. El Dashboard cerró esa
   sesión y el acceso volvió a funcionar.
2. Cocina no tenía una identidad. Se creó una solicitud UmiPOS, se aprobó y
   después se cambió el dispositivo a UmiKDS.
3. Mesero estaba configurado por error como UmiKDS. Se cambió a UmiPOS.
4. Barra conservó su estación Barra.

## Firma

La llave privada nueva usa RSA de 4,096 bits. Está fuera del repositorio en:

```text
/home/juan/.local/share/umi-pos-signing/umi-pos-release.jks
```

La contraseña está en Secret Service con el servicio
`umipos-android-release`, cuenta `juan` y etiqueta
`UmiPOS Android production signing`.

Certificado:

```text
SHA-256 14:97:5F:2C:37:4E:03:B1:55:AB:36:3E:17:D4:A7:9D:4A:B3:2B:88:8A:B3:81:BE:DC:32:64:93:4C:B5:C0:51
```

Archivos de recuperación:

| Archivo               | Uso                                        |
| --------------------- | ------------------------------------------ |
| `umi-pos-release.jks` | Llave privada de producción                |
| `umi-pos-release.pem` | Certificado público                        |
| `umi-pos-lineage.bin` | Prueba de rotación desde la llave anterior |

El script `scripts/build-umipos-android-release.sh` obtiene la contraseña de
Secret Service. La build normal usa sólo la llave privada nueva.

APK final:
`/home/juan/Downloads/UmiPOS-1.0.0-production-release-build333-final.apk`

SHA-256:
`9fb8b5f94ec40dfcf8e667f1090958f9d5793d3b4a6e85981eb89729a0bf3f84`

## Corrección del Dashboard

La pantalla de Equipo ocultaba a las personas con acceso desactivado. El
mensaje de confirmación decía que el acceso se podía devolver desde la misma
pantalla, pero no existía una acción para hacerlo.

La corrección conserva esas personas en la lista. Una persona inactiva muestra
la acción **Restaurar acceso**. La prueba de regresión cubre el filtro general y
el filtro por rol.

La corrección está integrada en `main` mediante el PR 226 y desplegada en
Cloudflare Pages. El PR 227 completó las traducciones y también está desplegado.

## Verificación

| Prueba                                         | Resultado                                                |
| ---------------------------------------------- | -------------------------------------------------------- |
| APK instalado en las cuatro terminales         | `versionCode=333`                                        |
| Certificado instalado en las cuatro terminales | La llave nueva de release                                |
| Barra                                          | KDS cargó con la estación Barra                          |
| Cocina                                         | KDS cargó con la estación Cocina de pizzas               |
| Mesero                                         | POS cargó la carta y las acciones de pedido              |
| Dashboard                                      | Suite completa: 381 pruebas aprobadas                    |
| Script de build                                | Sintaxis válida                                          |
| Producción Dashboard                           | `Restaurar acceso` presente en los catálogos desplegados |

## Acceso remoto: recuperación y límite del reinicio

Actualización: 27 de octubre de 2026, después del segundo reinicio controlado.

Caja está conectada por Tailscale en `100.64.178.95:43761`.
El puerto es dinámico. El receptor recibió el endpoint y reconectó ADB.
El diagnóstico completo terminó con código 0 en las cuatro terminales.
Todas usan UmiPOS 333 y KeepADB 1.8.38.
Después del reinicio, el propietario entró con su PIN en la tablet.
La lectura de la pantalla confirmó la carta de ONCA y «Nube En línea».

Una desconexión del transporte ADB se recuperó sola en 10.04 segundos.
Esa prueba no demuestra recuperación después de un reinicio.

### Primer reinicio: orden de apagado guardada

El contador de arranques cambió de 4 a 5.
Tailscale volvió, pero ADB no regresó durante 210 segundos.
KeepADB conservaba una orden explícita de apagado.
El registro persistente muestra:

```text
2026-10-26T18:21:53-07:00 user_action source=app outcome=disable
2026-10-27T11:03:27-07:00 boot_completed keepAlive=true
2026-10-27T11:03:27-07:00 boot_recovery outcome=skipped persisted_intent_off
```

El registro anterior permite corregir la hipótesis del reporte original.
Una orden de apagado en KeepADB explica que su servicio no recuperara ADB.
El registro no identifica a la persona que emitió esa orden.

El propietario activó la depuración desde KeepADB.
El registro cambió a `lastIntentOff=false`.
También aceptó «Permitir siempre en esta red» para `UmiPOS`.
La consulta de Android mostró la red en su almacén de autorización.

### Segundo reinicio: autorización de Android

El contador cambió de 5 a 6.
KeepADB inició durante el arranque e intentó activar la depuración.
Android volvió a mostrar la solicitud de permiso para `UmiPOS`.
La opción «Permitir siempre» apareció sin marcar.
El propietario confirmó esa pantalla.
ADB no regresó durante la ventana de 210 segundos.

El registro de Android muestra:

```text
10-27 11:21:52.227 E AdbDebuggingManager: Expected keyStore, but got tag=null
10-27 11:21:52.228 E AdbDebuggingManager: Expected keyStore, but got tag=null
10-27 11:22:38.343 I KeepADBService: Auto-enabling Wireless Debugging (Wi-Fi connected)
10-27 11:23:39.077 I KeepADBService: Automatic re-enable paused after a readback mismatch (#496)
```

El propietario aceptó el permiso de nuevo.
Caja publicó el puerto 43761 y el receptor recuperó ADB.
La lectura posterior confirmó `adb_wifi_enabled=1`, `boot_count=6` y el servicio activo.
El almacén serializado volvió a contener la red autorizada.

La recuperación automática después de reiniciar Caja sigue sin aprobar.
El diagnóstico verde describe la conectividad actual.
No demuestra persistencia del permiso durante el próximo reinicio.

### Configuración comprobada

- Tailscale es la VPN siempre activa.
- KeepADB y Tailscale están excluidos del ahorro de batería.
- KeepADB tiene `WRITE_SECURE_SETTINGS` y `RECEIVE_BOOT_COMPLETED`.
- «Mantener siempre activo» y la notificación persistente están habilitados.
- El webhook es `http://100.109.51.39:47123/keepadb`.
- El receptor está habilitado y activo. El usuario juan tiene `Linger=yes`.

La opción **Transmission Mode** no aparece en el firmware de esta D3.
El propietario lo confirmó. La lectura de la pantalla de Batería también lo confirmó.
No se aplicó un ajuste desconocido en su lugar.

La causa inmediata del segundo bloqueo es la solicitud de autorización de Android.
El error al leer `keyStore` es compatible con el código AOSP 11 consultado.
El origen exacto dentro del firmware iMin requiere una revisión del fabricante.
No se instaló firmware, no se activó root y no se fijó el puerto ADB.

### Procedimiento mientras exista este límite

1. Abre KeepADB después de reiniciar.
2. Activa la depuración inalámbrica si está apagada.
3. Marca «Permitir siempre en esta red» para la red `UmiPOS` conocida.
4. Pulsa **Permitir**.
5. Espera el nuevo webhook.
6. Ejecuta el diagnóstico completo de la flota.

Mantén el puerto dinámico y usa la dirección de Tailscale.
No confundas un estado Tailscale en línea con una conexión ADB.

Evidencia: [diagnóstico final](./evidence/2026-10-27-onca-support/doctor-final.json).
Fuentes y límites: [análisis de KeepADB y Android](../research/2026-10-27-onca-keepadb-boot-recovery.md).

## Comprobación del APK canónico, 27 de octubre

La última build de producción identificada en el repositorio y sus artefactos es 333.
El APK final es `/home/juan/Downloads/UmiPOS-1.0.0-production-release-build333-final.apk`.
La revisión de Downloads no encontró un APK UmiPOS con un número mayor.
Los APK intermedios y de transición de firma quedaron excluidos.

Se usaron `apksigner` y `aapt2` de Android Build Tools 36.0.0.
Se comparó el SHA-256 del APK instalado con el archivo canónico en cada tablet.

| Tablet | Build | Mismo APK canónico | Firma            | Depurable |
| ------ | ----: | ------------------ | ---------------- | --------- |
| Caja   |   333 | Sí                 | Release esperada | No        |
| Barra  |   333 | Sí                 | Release esperada | No        |
| Cocina |   333 | Sí                 | Release esperada | No        |
| Mesero |   333 | Sí                 | Release esperada | No        |

SHA-256 del APK:
`9fb8b5f94ec40dfcf8e667f1090958f9d5793d3b4a6e85981eb89729a0bf3f84`.

SHA-256 del certificado:
`14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051`.

Las cuatro instalaciones ya coincidían. La revisión no requirió reinstalar el APK.
Evidencia: [verificación de build](./evidence/2026-10-27-onca-support/latest-build-final.json).

## Nueva evidencia de firmware y alternativa local

El actualizador ofrece `1.0.6.4.23_241120`, publicado el 22 de noviembre de 2024.
Sus notas sólo indican «Optimization system» y «Minor bug fixes».
No se confirmó que ese paquete ni otra versión del fabricante incluya la corrección de ADB.

Se identificó el parche oficial AOSP `c113a129072f`, bug `236299256`.
El parche corrige la lectura del archivo que conserva las redes Wi-Fi autorizadas.
Su descripción coincide con el fallo observado. La inclusión en la OTA sigue sin verificar.

También se evaluó una alternativa sin actualizar Android.
Un ayudante local de Accesibilidad podría confirmar sólo el diálogo ADB de `UmiPOS`
y del BSSID conocido después de arrancar.
Requiere una activación inicial del servicio en la tablet.
La propuesta no está construida ni probada; no se declaró resuelta la recuperación.

No se instaló firmware ni se activó Accesibilidad durante esta investigación.
Detalles y fuentes: [investigación de KeepADB y Android](../research/2026-10-27-onca-keepadb-boot-recovery.md).
Evidencia: [revisión OTA](./evidence/2026-10-27-onca-support/ota-review.json).

## Avance anterior: Umi Support construido antes de la instalación

Se creó un APK firmado de Umi Support 1.0.0 con 45 pruebas aprobadas.
La instalación y la prueba de reinicio siguen pendientes.
La recuperación automática de Caja continúa **NO VERIFICADA**.
Consulta la [entrega y evidencia de Umi Support](./2026-10-27-umi-support-android.md).

## Validación posterior: Umi Support 1.0.1 instalado

Umi Support 1.0.1, código 2, quedó instalado y activo en Caja.
La primera prueba de 1.0.0 falló por la etiqueta Material «PERMITIR».
La corrección conserva la comparación literal de la red autorizada.
El reinicio de la versión corregida pasó de boot_count 7 a 8 y recuperó ADB automáticamente.
KeepADB publicó el puerto nuevo y el receptor abrió el transporte sin introducir el endpoint.
El doctor final terminó con código 0 en las cuatro tablets, todas con UmiPOS build 333.
No se instaló firmware ni se modificaron pagos.

Informe: [Umi Support instalado y probado](./2026-10-27-umi-support-android.md).
