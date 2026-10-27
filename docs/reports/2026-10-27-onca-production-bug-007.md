# ONCA, puesta a punto de terminales y firma

## Resultado

Las cuatro terminales usan el APK 333 con una llave de release privada. La
rotación de Android conservó los datos de la aplicación y terminó la transición
desde la llave de depuración.

La configuración de las terminales quedó así:

| Terminal | Modo | Acceso comprobado |
| --- | --- | --- |
| Caja iMin | UmiPOS | Cajero ONCA |
| Barra A9+ | UmiKDS | Barista |
| Cocina A9+ | UmiKDS | Cocinero 1 |
| Mesero A11 | UmiPOS | Mesero 1 |

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

| Archivo | Uso |
| --- | --- |
| `umi-pos-release.jks` | Llave privada de producción |
| `umi-pos-release.pem` | Certificado público |
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

| Prueba | Resultado |
| --- | --- |
| APK instalado en las cuatro terminales | `versionCode=333` |
| Certificado instalado en las cuatro terminales | La llave nueva de release |
| Barra | KDS cargó con la estación Barra |
| Cocina | KDS cargó con la estación Cocina de pizzas |
| Mesero | POS cargó la carta y las acciones de pedido |
| Dashboard | Suite completa: 381 pruebas aprobadas |
| Script de build | Sintaxis válida |
| Producción Dashboard | `Restaurar acceso` presente en los catálogos desplegados |

## Acceso remoto pendiente

Después de instalar la actualización, Caja dejó de publicar el puerto ADB. La
máquina conserva conectividad Tailscale, pero KeepADB informó el cierre del
puerto. La aplicación sigue instalada y la rotación se verificó antes de perder
ADB.

La documentación oficial de iMin confirma que la depuración USB se cierra
automáticamente cuando el dispositivo se reinicia:
<https://oss-sg.imin.sg/docs/en/DockingDebugging.html>.

KeepADB documenta que envía `DELETE` cuando el endpoint deja de comprobarse,
cuando se desactiva la sincronización o cuando cambia la URL:
<https://github.com/m00sfett/KeepADB/blob/master/docs/webhook-register.md>.

La secuencia observada es compatible con un reinicio de Caja:

1. ADB dejó de responder.
2. KeepADB envió `DELETE /keepadb` a las 18:21:52.
3. Tailscale también perdió el contacto directo.
4. Tailscale volvió a estar en línea después.
5. Ningún puerto ADB volvió a publicarse.

No se ejecutó ningún comando para desactivar ADB. La causa exacta requiere
revisar `Settings.Global.boot_count` en Caja cuando vuelva el acceso.

Para recuperar ADB, una persona debe abrir KeepADB en Caja y confirmar que
**Mantener siempre activo** está habilitado. El servicio del host reconectará el
puerto automáticamente cuando reciba el nuevo webhook.
