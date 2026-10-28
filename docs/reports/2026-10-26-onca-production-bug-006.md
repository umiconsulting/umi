# ONCA, incidente de producción 006: UmiPOS no inicia

## Resultado

El APK 331 no era una build de producción. Era el artefacto
`app-production-profile.apk`, renombrado. Además, la aplicación no tenía una
identidad de release válida.

El APK 332 corrige el empaquetado y permite iniciar UmiPOS en las cuatro
tabletas. La actualización conserva los datos de la aplicación.

## Causa raíz

El registro de Android mostró esta secuencia en Caja:

```text
umi_pos.bootstrap phase=configurationInvalid category=configuration correlation=- clientContract=2.45.0 clientVersion=1.0.0 environment=production
```

El mensaje correspondía a `RELEASE_IDENTITY_INVALID`. La build 331 tenía la URL,
el entorno, la versión y el contrato correctos. No tenía un commit SHA-40 válido
ni una marca de tiempo de build.

La auditoría del archivo confirmó el segundo defecto:

| Comprobación               | Build 330                    | Build 331                    | Build 332                    |
| -------------------------- | ---------------------------- | ---------------------------- | ---------------------------- |
| Archivo de origen          | `app-production-release.apk` | `app-production-profile.apk` | `app-production-release.apk` |
| Tamaño                     | 24.5 MB                      | 37.5 MB                      | 24.5 MB                      |
| `libvmservice_snapshot.so` | No                           | Sí                           | No                           |
| `versionCode`              | 330                          | 331                          | 332                          |
| Firma instalada            | Llave histórica              | Llave histórica              | Llave histórica              |

La build 331 era una build `profile`. El nombre de descarga ocultó el artefacto
incorrecto.

## Corrección

El commit `65a85c31` conserva la categoría del fallo. También añade el código
técnico exacto al estado y al log de arranque.

`scripts/build-umipos-android-release.sh` fuerza la variante `release`. El
script rechaza un artefacto `profile`, una build depurable y una firma de
depuración sin una autorización explícita.

La build 332 se compiló desde ese commit con estos valores:

| Campo                    | Valor                                      |
| ------------------------ | ------------------------------------------ |
| Entorno                  | `production`                               |
| API                      | `https://api.umiconsulting.co`             |
| Contrato                 | `2.45.0`                                   |
| Versión                  | `1.0.0`                                    |
| Commit                   | `65a85c317266f43d14007145bc024477c706088c` |
| Marca de tiempo          | `2026-10-27T00:11:11.000Z`                 |
| Esquema de configuración | `1`                                        |

APK:
`/home/juan/Downloads/UmiPOS-1.0.0-production-release-build332.apk`

SHA-256:
`ccb3d37f23d6bf3e2c7541bea94ffc4b225ed9e1ed5e88c1f9824e01c213e94a`

## Verificación

| Terminal   | Instalación                  | Estado después del arranque                                      |
| ---------- | ---------------------------- | ---------------------------------------------------------------- |
| Caja iMin  | Build 332 instalada con `-r` | PIN válido; la API rechaza el segundo inicio de sesión de Cajero |
| Barra A9+  | Build 332 instalada con `-r` | Barista entra; KDS muestra cero comandas                         |
| Cocina A9+ | Build 332 instalada con `-r` | Pantalla de registro; falta confirmar el código del dispositivo  |
| Mesero A11 | Build 332 instalada con `-r` | PIN válido; KDS muestra cero comandas                            |

El incidente 007 corrigió el registro de Cocina, la sesión de Cajero, el modo de
Mesero y la firma de producción.

Las cuatro instalaciones informan `versionCode=332`. El manifiesto no tiene la
marca `DEBUGGABLE`.

Caja, Barra y Mesero conservaron su identidad de dispositivo. Por eso llegaron
a autenticación sin un registro nuevo.

## Riesgo de firma

La build 332 usa la llave histórica de depuración. Esa selección permite una
actualización sin desinstalar UmiPOS ni perder los datos.

La llave de depuración no es segura para producción. La migración exige una
llave de release privada y una reinstalación controlada. Antes de la migración,
Soporte debe confirmar que el diario sin conexión está vacío.

## Pendientes

1. Registrar Cocina con un código emitido por el administrador.
2. Cerrar la sesión anterior de Cajero y confirmar el acceso en Caja.
3. Migrar las terminales a una llave de release privada.

Estos tres pendientes quedaron cerrados en el incidente 007.
