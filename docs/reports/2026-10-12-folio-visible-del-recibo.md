# El ticket lleva un folio que una persona lee

Fecha: 2026-10-12. Decisión: [ADR 2026-10-12](../architecture/2026-10-12-folio-visible-del-recibo-adr.md).
Investigación: [Identificación legible de tickets y recibos](../research/2026-10-12-identificacion-de-tickets-legible.md).

La observación del dueño era exacta: el identificador que se imprime en el ticket y sale en
los recibos era `POS-` más el UUID del intento de pago. Sirve como llave, no como etiqueta.
Ahora el papel y la pantalla llevan un folio corto, y el UUID se queda en la máquina.

## Qué cambió

| Pieza                                                                                             | Dónde                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| La tabla del contador por comercio, sucursal y día operativo, con RLS forzado y una sola política | `docs/migration/build-v3/migrations/022_receipt_folio.sql` (incluido por `80_pos_table_accounts.sql`) |
| Las dos restricciones únicas, acotadas al alcance real del folio                                  | el mismo archivo                                                                                      |
| La emisión del folio, en la misma transacción del cobro                                           | `allocateReceiptFolio`, en `apps/umi-api/src/shared/receipts/receipt-folio.ts`                        |
| El recibo emitido en los eventos, el resultado y la venta                                         | `pos-checkout.service.ts`, `pos-checkout.repository.ts`                                               |
| El folio del recibo derivado, con prefijo                                                         | `pos-exception.repository.ts` (`EX-0042`)                                                             |
| `Ticket {folio}` en el papel                                                                      | `thermal_printer_adapter.dart`                                                                        |
| El folio en la pantalla, con caída a letra pequeña para un `POS-<uuid>`                           | `receipt_document.dart`                                                                               |
| `qrValue` con la llave y el contexto, por primera vez                                             | `receipt-barcode.ts` + `pos-hardware.repository.ts`                                                   |
| La guarda de la forma                                                                             | `99_verify.sql`, bloque `build-v3-022`                                                                |

La cadena de la impresora imprime ahora `Ticket 0042` donde antes imprimía el UUID, y el
código de barras deja de estar vacío:

```
              UMIPOS LOCAL
             Sucursal Centro
Ticket 0042
Fecha operativa: 2026-10-12  20:16:03
```

## El defecto que la comprobación encontró

El primer borrador formateaba el folio en SQL con `lpad(last_number::text, 4, '0')`. **`lpad`
trunca** cuando el valor ya es más ancho que el objetivo:

```
select lpad('10000',4,'0');        -> 1000     (¡colisiona con el ticket 1000 del día!)
select to_char(10000,'FM0000');    -> ####     (la otra opción no existe)
```

El ticket número 10 000 de un día habría chocado con el 1000 y el cobro habría muerto en la
restricción única, con el dinero ya capturado. El relleno vive ahora en TypeScript
(`padStart`, que solo rellena), y `receipt-folio.spec.ts` sostiene el límite.

## Comprobaciones

Herramientas: PostgreSQL 17.10 (contenedor local `umi-bv3-pg`, puerto 4003), psql 18.6,
Vitest 2.1.9, Node 24.21.0, ESLint y Prettier del repositorio.

| Comprobación                                                                                      | Resultado                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cadena completa en base nueva: `bash docs/migration/build-v3/00_run.sh umi_folio_verify_20261012` | `build-v3 applied`, `build-v3 verify: OK` (146 tablas en `merchant`)                                                                                                                                                              |
| Las restricciones, por DEFINICIÓN                                                                 | `receipt_snapshot_number_scope_uq` y `pos_exception_receipt_number_scope_uq`: `UNIQUE (merchant_id, location_id, business_date, receipt_number)`; las viejas ya no existen                                                        |
| La guarda puede fallar                                                                            | Con la restricción vieja restaurada a mano, `99_verify` lanza `build-v3-022: merchant.receipt_snapshot carries no scoped unique on its receipt number`; volver a aplicar 022 la repara y la verificación vuelve a `OK`            |
| Reaplicación (la que mide CI)                                                                     | Tres aplicaciones seguidas de 022: sin error, políticas `321 → 321`, una sola política en `receipt_counter`                                                                                                                       |
| Concurrencia                                                                                      | 20 asignaciones en paralelo para el mismo comercio, sucursal y día: 20 folios distintos, `0001`…`0020`                                                                                                                            |
| Alcance                                                                                           | Misma sucursal y día continúa (`0021`); otra sucursal el mismo día empieza en `0001`; el día siguiente empieza en `0001`                                                                                                          |
| Crecimiento                                                                                       | Con el contador en 9999, el siguiente folio es `10000` (después de la corrección)                                                                                                                                                 |
| Cobro real, extremo a extremo                                                                     | `pos-offline.integration.ts` (7 pruebas), `point-card-refund.integration.ts` (3) y `cash-seals.integration.ts` (8): 18 pruebas en verde sobre la base nueva                                                                       |
| En la base                                                                                        | `receipt_number` = `0001`, `0002`, `0003` con el mismo valor dentro de la instantánea congelada; contador en `last_number=3`; `offline_provisional_mapping.official_receipt_number` = `0001`; el recibo de devolución = `EX-0001` |
| Pruebas unitarias de la API                                                                       | 1849 en verde, 29 omitidas, 0 fallos                                                                                                                                                                                              |
| Tipos                                                                                             | Limpio en los archivos de este cambio. Quedan dos errores previos en `pos-hardware.repository.spec.ts`:70 y :95                                                                                                                   |
| ESLint                                                                                            | Limpio en los archivos de este cambio. Quedan tres errores previos en archivos de otras sesiones                                                                                                                                  |
| Prettier                                                                                          | Limpio en los archivos de este cambio                                                                                                                                                                                             |
| `umi_local`                                                                                       | La migración está aplicada en la base que usan la app y el till locales; `99_verify` responde `OK`                                                                                                                                |

## Sin verificar aquí

**No hay SDK de Flutter en esta máquina** (`which flutter` no existe; tampoco hay un SDK en
el disco), así que los cambios del till están escritos y **no ejecutados**:

- `thermal_printer_adapter.dart`, `receipt_document.dart`, los dos `.arb` y los tres archivos
  generados de localización.
- La prueba nueva `test/receipt_ticket_folio_test.dart`.

Los comandos que los prueban, en una máquina con Flutter 3.44.6:

```sh
cd apps/umi-pos && flutter gen-l10n && flutter analyze && flutter test
```

`flutter gen-l10n` importa: el getter `receiptTicketLabel` se añadió a mano en los tres
archivos generados, con la forma exacta que produce el generador, pero nadie lo regeneró.

## Nota sobre una prueba ajena

`apps/umi-api/src/modules/pos-checkout/checkout-pending-round.spec.ts` (archivo sin
comprometer de otra sesión) ya fallaba antes de este cambio: su cliente falso no respondía la
consulta de contexto de `syncCartOrderContext`, que rechaza con `CART_CONTEXT_NOT_FOUND`
setenta líneas antes de cualquier código de este cambio. Se completó el doble para que la
prueba pase y cubra el camino del folio.
