# ADR: el recibo lleva un folio visible, y el UUID se queda en la máquina

- Fecha: 2026-10-12
- Estado: **Aceptado e implementado** el 2026-10-12. La verificación del lado del till
  (Dart) queda pendiente: la máquina que escribió esto no tiene el SDK de Flutter. La
  evidencia está en `docs/reports/2026-10-12-folio-visible-del-recibo.md`.
- Relación: resuelve la pregunta abierta de
  `docs/migration/build-v3/ORDER_MODEL.md` («Not built, deliberately»: la numeración de
  recibos es una política del comercio). Lleva la evidencia en
  `docs/research/2026-10-12-identificacion-de-tickets-legible.md`.
- No cambia la frontera del ADR de atribución de canal ni la del ADR de CFDI. Declara,
  eso sí, que el folio del recibo y el folio del CFDI son folios distintos.

## Decisión

1. **Dos identificadores.** El UUID sigue siendo la llave primaria de
   `merchant.receipt_snapshot` y no se imprime. El folio visible se imprime, se dicta y
   se busca.
2. **El folio es un consecutivo** por comercio, sucursal y fecha operativa.
3. **El folio se emite al confirmar el cobro**, no al abrir la cuenta. La venta es el
   hecho comercial y el recibo es el documento que lo memorializa; el folio pertenece al
   recibo y nace cuando el recibo existe.
4. **El folio se emite con una fila de contador**
   (`INSERT … ON CONFLICT … DO UPDATE … RETURNING`) dentro de la misma transacción que
   escribe el recibo. No con una secuencia.
5. **El alcance de unicidad de `receipt_number` cambia** de
   `(merchant_id, receipt_number)` a
   `(merchant_id, location_id, business_date, receipt_number)`.
6. **El papel imprime el folio**, no el UUID: `TICKET 0042` en lugar de
   `Receipt POS-ed247436-…`.
7. **El UUID vive dentro del código de barras**, y el código lleva llave y contexto.
8. **Un documento derivado es otro recibo.** Una devolución lleva su propio folio del
   mismo contador, con un prefijo que lo distingue.

## Base de la decisión

| Frente              | Hallazgo                                                                                                                                                                                                   | Fuente                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Modelo del sector   | El recibo es un documento «separate from, but linked to» la transacción. No es la venta ni el carrito.                                                                                                     | `docs/research/2026-09-06-receipt-vs-sale-enterprise-systems.md` §11 (ARTS ODM) |
| Práctica del sector | El número corto y legible es un elemento de primera clase. Toast imprime el número de orden a 32 puntos y un código de barras para reabrir la cuenta; Odoo etiqueta `pos_reference` como «Receipt Number». | Toast Support, Odoo `pos_order.py` (en el documento de investigación)           |
| Norma mexicana      | El CFDI global debe llevar «el folio o número de operación de cada recibo al público».                                                                                                                     | RMF 2026 regla 2.7.1.21, DOF 28-12-2025                                         |
| Generación segura   | Una secuencia de PostgreSQL no se reinicia y no puede ser continua. El patrón atómico bajo concurrencia es el contador con `ON CONFLICT DO UPDATE`.                                                        | `postgresql.org/docs/18`                                                        |
| Código de barras    | El SAT imprime una expresión, no una llave: URL, folio fiscal, RFC emisor, RFC receptor, total y ocho caracteres del sello.                                                                                | Anexo 20 v4.0, especificación técnica del QR                                    |

## Contexto

Hoy el número del recibo se construye en
`apps/umi-api/src/modules/pos-checkout/pos-checkout.service.ts:986` como `POS-` más el
UUID del intento de pago. Ese texto se congela en `merchant.receipt_snapshot.receipt_number`,
se imprime centrado en `thermal_printer_adapter.dart:142`, se dibuja en el código de
barras y es el texto por el que busca el POS.

Un UUID es la herramienta correcta para una llave y la incorrecta para una etiqueta. No se
dicta, no se teclea sin error, no se ordena, no cabe en una línea y no dice día, sucursal
ni caja. Además se aparta de la práctica del sector y de la regla 2.7.1.21.

**El folio de la cuenta abierta no se reusa.** `merchant.pos_cart.account_number` es un
`generated always as identity` con índice único global, sin alcance por comercio
(`docs/migration/build-v3/migrations/021_pos_account_metadata.sql:2`). La tabla es
compartida, así que ese número crece con el volumen de la plataforma, no con el del café.
Sirve como referencia operativa interna; no sirve como folio impreso.

## Alternativas consideradas

| Opción                             | Forma          | Resultado                                                                                        |
| ---------------------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| A. Consecutivo por sucursal y día  | `Ticket 0042`  | **Elegida.** La más corta y la más natural. Exige contador y el cambio de restricción.           |
| B. Consecutivo por caja y día      | `Caja 2 · 015` | Descartada. Más números que reconciliar. Es estable sin conexión, y ese mérito no compensa.      |
| C. Único por comercio con la fecha | `261012-0042`  | Reserva. Único sin tocar la restricción, y más largo.                                            |
| D. UUID acortado en Base32         | `POS-7F3K9QX2` | Descartada como folio. No es consecutivo y no dice antigüedad. Sirve como identificador técnico. |
| E. Reusar el folio de la cuenta    | `Ticket 109`   | Descartada. La secuencia es global de la plataforma.                                             |

## Consecuencias

**A favor.**

- El folio se dice por teléfono, se teclea sin error y ordena las ventas del día.
- Cumple la regla 2.7.1.21 y coincide con Toast y con Odoo.
- Es el único identificador que sobrevive sin red, sin batería y sin equipo.

**En contra, y aceptado.**

- Una tabla de contador nueva y un cambio de restricción.
- El papel impreso sin conexión no puede llevar el folio final. Conserva su `PROV-…`, y
  el folio oficial aparece cuando el servidor confirma la venta.
- Una cuenta que se abre y nunca se cobra no gasta folio, pero una venta anulada sí lo
  gasta: el contador tiene huecos. Es el comportamiento documentado de un contador.
- La venta sin conexión solo se resuelve con un resolutor: la caja que imprimió el papel,
  por su diario local, o el servidor, por
  `merchant.offline_provisional_mapping`.

**Sin cambio.**

- El UUID sigue siendo la llave primaria y el enlace entre tablas.
- El recibo es inmutable; el cambio aplica a los recibos nuevos. Los anteriores conservan
  `POS-<uuid>` y las dos formas conviven porque el campo es texto libre.
- Ninguna consulta busca un recibo por el número solo: la búsqueda usa `ILIKE`
  (`pos-sale.repository.ts:297`) y la impresión busca por identificador
  (`pos-hardware.repository.ts:1196`). El cambio de alcance no rompe una lectura.

## Implementación

| Pieza                                                             | Dónde                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| El contador, su alcance y sus permisos                            | `docs/migration/build-v3/migrations/022_receipt_folio.sql`, incluido por `80_pos_table_accounts.sql`                      |
| El cambio de alcance de las dos restricciones únicas              | el mismo archivo, por DEFINICIÓN y no por nombre                                                                          |
| La emisión del folio dentro de la transacción del cobro           | `allocateReceiptFolio` en `apps/umi-api/src/shared/receipts/receipt-folio.ts`, llamada desde `pos-checkout.repository.ts` |
| El recibo emitido, con el folio, en los eventos y en el resultado | `pos-checkout.service.ts`                                                                                                 |
| El folio del recibo derivado, con prefijo                         | `allocateReceiptFolio` en `pos-exception.repository.ts` (`EX-0042`)                                                       |
| `Ticket {folio}` en la cabeza de la impresora                     | `thermal_printer_adapter.dart`                                                                                            |
| El folio en la pantalla del recibo                                | `receipt_document.dart`, con la caída a letra pequeña para un `POS-<uuid>`                                                |
| `qrValue` con la llave y el contexto                              | `apps/umi-api/src/shared/receipts/receipt-barcode.ts`, usado en `pos-hardware.repository.ts`                              |
| La guarda de la forma                                             | `99_verify.sql`, bloque `build-v3-022`                                                                                    |

## Puntos abiertos

1. **Ancho del consecutivo.** `0042`, y crece sin truncar. Decidido con la medición que
   encontró el defecto de `lpad` (ver el informe).
2. **Prefijo de una devolución.** `EX-0042`. Decidido.
3. **Contenido del código de barras.** Forma 2: la llave más contexto
   (`UMI1|R=…|T=…|D=…|C=…|A=…`). Decidido.
4. **Folio del recibo contra folio del CFDI.** No coinciden. Decidido.
5. **Un recibo sin cuenta de POS.** Sin decidir. **No verificado:** cuántos recibos nacen
   hoy sin una cuenta de POS.
6. **El código de barras de la pantalla sigue siendo decorativo.** Imprimir un símbolo real
   en la pantalla necesita una dependencia (`barcode` 2.2.9, Apache-2.0); la impresora ya
   dibuja el QR sin ninguna.
7. **Nadie consume todavía el `qrValue`.** El till lo imprime; falta un lector que resuelva
   el folio o la llave escaneados.
