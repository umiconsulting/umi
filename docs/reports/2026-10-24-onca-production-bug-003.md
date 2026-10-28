# ONCA producción · error 003 · salida de efectivo bloqueada

**Fecha:** 24 de octubre de 2026. **Zona local:** `America/Mazatlan` (UTC−7).
**Prioridad:** alta para el cierre de caja. **Estado:** corregido y verificado
en producción.

## Reporte

El personal intentó registrar una salida de efectivo desde **Caja**. El POS
mostró:

> No se completó la operación. Intenta de nuevo o solicita ayuda.

La pantalla de Caja conservaba datos de las 13:20 mientras la caja ya tenía 20
movimientos del libro. [La captura inicial](./evidence/2026-10-24-onca-production-003/01-cash-error-before-fix.png)
muestra el mensaje y el estado atrasado.

## Causa comprobada

El log de la iMin registró:

```text
[umipos] cash op refused: INTERNAL_ERROR (AppException) details=null
```

La API registró las solicitudes de las 15:59 y 16:01 con `500` y
`detail=SHIFT_NOT_OPEN`. La consulta de producción mostró que el turno estaba
abierto con versión 20. La tablet todavía tenía la versión 14.

La consulta del movimiento exigía el dispositivo, el operador, el estado y la
versión en una sola condición. Cuando la versión no coincidía, no encontraba la
fila y lanzaba un `Error` no tipado. El filtro global lo publicaba como `500
INTERNAL_ERROR`, en lugar de informar un conflicto de versión recuperable.

## Corrección

La revisión `8a8ec541`:

1. Lee y bloquea el turno por su identidad, sin ocultar la versión vigente.
2. Devuelve `OPTIMISTIC_VERSION_CONFLICT` con las versiones esperada y vigente
   cuando el cambio ya ocurrió.
3. Devuelve rechazos tipados para turno cerrado, dispositivo distinto, operador
   distinto y moneda distinta.
4. Hace que el POS reciba el conflicto, actualice el Centro de caja y conserve
   el importe y el motivo del movimiento para el siguiente intento.

## Despliegue

| Elemento                          | Valor                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Revisión                          | `8a8ec541`                                                                        |
| Imagen API                        | `ghcr.io/umiconsulting/umi-api:onca-8a8ec541`                                     |
| Imagen SHA-256                    | `sha256:b171d9ac1e451a39469a27080642362e0127ab93f9191fe439693e0c4efa218c`         |
| Identidad publicada               | `1.0.0-onca.8a8ec541`; commit completo `8a8ec541d6d5c4ed8225512fa0ee7b872f0823f4` |
| Salud                             | `/health/ready` respondió `200`                                                   |
| Contrato                          | `2.44.0`                                                                          |
| Esquema esperado                  | `build-v3-79`                                                                     |
| POS instalado en iMin             | 330                                                                               |
| Barra                             | 330                                                                               |
| Mesero                            | 330                                                                               |
| POS instalado en tablet de prueba | 329                                                                               |

La imagen anterior
`ghcr.io/umiconsulting/umi-api:onca-6d54a4e3` permanece en el VPS. El respaldo
de configuración es `.env.before-onca-8a8ec541-20261024T231755Z`.

## Verificación con hardware

Después de instalar el build 329, el Centro de caja leyó la versión actual y
mostró **MXN 3,657.00 esperados**, secuencia 20.
[Estado actualizado](./evidence/2026-10-24-onca-production-003/02-cash-refreshed-build329.png).

Se registró una salida controlada:

| Prueba                         | Resultado                                                              |
| ------------------------------ | ---------------------------------------------------------------------- |
| Salida de MXN 1.00             | HTTP 201; comando `62f4a629-c10a-441d-96de-407cc5c9f605`; secuencia 21 |
| Entrada de reversa de MXN 1.00 | HTTP 201; comando `49678a7f-9c85-43cd-9ecc-a9e419f23eaa`; secuencia 22 |
| Efectivo esperado final        | MXN 3,657.00, igual al estado anterior                                 |

[Salida registrada](./evidence/2026-10-24-onca-production-003/03-paid-out-1.png) y
[saldo restaurado](./evidence/2026-10-24-onca-production-003/04-cash-restored.png).
El libro conserva ambas entradas con los motivos `prueba` y
`reversa_prueba`.

## Pruebas de código

| Comprobación                              | Resultado                                                         |
| ----------------------------------------- | ----------------------------------------------------------------- |
| Prueba API de versión atrasada            | Conflicto `409` con `shiftVersion` 20 y `expectedShiftVersion` 14 |
| Prueba POS de recarga de caja             | Actualiza al estado del servidor y conserva el conflicto visible  |
| `flutter analyze`                         | Sin hallazgos                                                     |
| Suite completa del POS                    | 1,151 pruebas aprobadas                                           |
| Suite API (`pnpm --filter @umi/api test`) | 2,093 pruebas aprobadas; 29 omitidas                              |
| TypeScript API                            | Sin errores                                                       |

## Rollback

En el VPS:

```sh
cd /home/juan/umi/apps/umi-api
cp .env.before-onca-8a8ec541-20261024T231755Z .env
docker compose up -d --no-build
```

Para el POS, reinstalar el APK 328 respaldado. La copia está en
`/home/juan/Downloads/UmiPOS-production-build328-tablet-test.apk`.

## Pendiente

El APK 330 quedó instalado en Caja, Barra y Mesero e incluye la corrección de
caja de la 329. Cocina continúa fuera de línea y deberá actualizarse cuando
vuelva a conectarse. Las revisiones de código y la migración de datos no
requieren cambios de esquema.
