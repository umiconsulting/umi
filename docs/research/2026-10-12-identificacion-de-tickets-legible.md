# Identificación legible de tickets y recibos

Fecha: 2026-10-12. Pregunta: el identificador que hoy se imprime en el ticket y sale
en los recibos es un UUID. Es práctico para la base de datos y poco práctico para una
persona. ¿Cómo debe identificarse un ticket?

Alcance: el recibo de una venta de UmiPOS (`merchant.receipt_snapshot`) y los
documentos que se derivan de él. No cubre la factura (CFDI), ni el folio de la cuenta
abierta, ni la comanda de cocina.

Etiquetas: **Hecho documentado**, **Tradeoff respaldado por fuente**, **Inferencia**,
**No verificado**. La ruta de cada hecho está en la tabla de la sección 2 o en la
sección 11.

## 1. Respuesta corta

Hoy el número del recibo es `POS-` más el UUID del intento de pago. Es una llave, no
un número. Conviene separar dos identificadores.

| Identificador  | Para quién                                    | Se imprime |
| -------------- | --------------------------------------------- | ---------- |
| Interno (UUID) | La base de datos y el código                  | No         |
| Folio visible  | La persona: cajero, cliente, gerente, auditor | Sí         |

**Decisión (2026-10-12).** Un folio corto y consecutivo por comercio, sucursal y día
operativo, **emitido al confirmar el cobro**. El UUID se queda como llave primaria y
como contenido del código de barras. El folio es lo que la persona lee, dice y teclea.
El recibo es un documento distinto de la orden y del carrito, así que el folio pertenece
al recibo y nace con él (sección 8). El folio es también el único identificador que
sobrevive sin red: el código de barras necesita quien lo resuelva (sección 9).

**Hecho documentado.** Esta decisión quedó abierta a propósito y el código la resolvió
por omisión con el UUID. `docs/migration/build-v3/ORDER_MODEL.md:366` dice que la
numeración de recibos es una política del comercio (¿por comercio?, ¿por día?, ¿por
sucursal?) y que decidirla antes de resolver la factura sería adivinar.

## 2. Dónde nace y por dónde viaja el identificador actual

| Paso             | Ruta                                                                                          | Hecho                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Nace             | `apps/umi-api/src/modules/pos-checkout/pos-checkout.service.ts:986`                           | El número es el prefijo `POS-` más el UUID del intento de pago (`payments[0].attempt.id`). |
| Se congela       | `apps/umi-api/src/modules/pos-checkout/pos-checkout.repository.ts:1358`                       | Escribe `receipt.receiptRef` en `merchant.receipt_snapshot.receipt_number`.                |
| Unicidad         | `docs/migration/build-v3/20_merchant.sql:1992` y `:1998`                                      | `receipt_number text not null` y `unique (merchant_id, receipt_number)`.                   |
| Devolución       | `apps/umi-api/src/modules/pos-exception/pos-exception.repository.ts:1024`                     | `EX-` más el UUID del recibo original.                                                     |
| Unicidad         | `docs/migration/build-v3/34_pos_exception.sql:217` y `:223`                                   | `receipt_number text not null` y `unique(merchant_id,receipt_number)`.                     |
| Semilla fiscal   | `apps/umi-api/src/modules/fiscal/fiscal.integration.ts:225`                                   | `F-` más los primeros 12 caracteres del UUID del recibo.                                   |
| Sin conexión     | `apps/umi-pos/lib/features/hardware/hardware_service.dart:1186`                               | `PROV-` más los primeros 8 caracteres del identificador provisional.                       |
| Se imprime       | `apps/umi-pos/lib/features/hardware/thermal_printer_adapter.dart:142`                         | La cabeza imprime `Receipt {receiptNumber}` centrado.                                      |
| Se muestra       | `apps/umi-pos/lib/shared/widgets/receipt_document.dart:342`                                   | La pantalla muestra `receipt.receiptRef` en letra pequeña.                                 |
| Código de barras | `apps/umi-pos/lib/shared/widgets/receipt_document.dart:446`                                   | Pinta barras a partir del mismo UUID.                                                      |
| Se busca         | `apps/umi-api/src/modules/pos-sale/pos-sale.repository.ts:297`                                | El buscador de ventas usa `receipt.receipt_number ILIKE '%…%'`.                            |
| Se lee de vuelta | `apps/umi-api/src/modules/pos-sale/pos-sale.repository.ts:482`                                | `receipt.receipt_number AS "receiptRef"`.                                                  |
| Caja y turnos    | `apps/umi-api/src/modules/pos-cash/pos-cash.repository.ts:1857`                               | `rc.receipt_number AS "receiptNumber"`.                                                    |
| Panel            | `apps/umi-dashboard/src/screens/recibos.jsx:171`, `caja-turnos.jsx:808`, `reembolsos.jsx:377` | El número se lista, se busca y se usa como referencia del recibo original.                 |
| Impresión        | `apps/umi-api/src/modules/pos-hardware/pos-hardware.repository.ts:1196`                       | `receipt_number` entra en el trabajo de impresión.                                         |

**Hecho documentado.** El contrato declaró el campo con un límite amplio y sin formato:
`receiptRef: z.string().min(1).max(100)` (`packages/contract/src/platform.ts:354`,
`pos-checkout.ts:498`, `pos-sale.ts:69`). El contrato no impide un folio corto.

El ticket de hoy imprime la referencia en una o dos líneas de letra pequeña:

```
              UMIPOS LOCAL
POS-ed247436-a329-4b41-b4ba-62a11365a18e
Fecha operativa: 2026-10-11  20:16:03.720
```

## 3. Por qué un UUID no sirve para una persona

**Inferencia.** Un UUID es la herramienta correcta para una llave y la herramienta
incorrecta para una etiqueta.

1. No se dicta. Nadie dice por teléfono «62a11365a18e».
2. No se ordena. No dice qué venta fue antes ni después.
3. No se teclea. Un error de un solo carácter no se detecta a simple vista.
4. No cabe. Ocupa dos líneas de papel y obliga a una letra de 11 puntos
   (`docs/reports/2026-10-11-imin-receipt-roll-and-format.md`).
5. No dice nada. No indica día, sucursal, caja ni turno.
6. Choca con la norma mexicana. La regla 2.7.1.21 de la RMF 2026 espera el folio o el
   número de operación de cada recibo al público (sección 4).

## 4. Cómo lo resuelve el mercado y la norma

**Hecho documentado, Toast.** El recibo puede mostrar el número de orden en letra grande,
de unos 32 puntos, en el encabezado; y con un lector de códigos el recibo puede llevar un
código de barras para buscar y reabrir la cuenta del invitado. Fuente:
<https://support.toasttab.com/en/article/Customizing-Receipts-Advanced-Configuration>
(«Show Large Order Number in Receipt Header» y «Enable Guest Receipt Barcodes», rung 1; la
página se leyó con el lector de texto `r.jina.ai`).

**Hecho documentado, Odoo POS.** El pedido lleva `pos_reference`, etiquetado «Receipt
Number», con la forma `Order 00001-001-0001`; el buscador rellena el número a 3 dígitos.
Fuente: `addons/point_of_sale/models/pos_order.py`, líneas 334 y 353-363,
<https://github.com/odoo/odoo/blob/17.0/addons/point_of_sale/models/pos_order.py>
(rung 3; las páginas de Odoo no entregan el texto al lector).

**Hecho documentado, Square y Stripe.** Los dos publican un `receipt_number` corto en el
objeto que cobra, aparte del identificador interno. Las referencias de primera mano están
citadas en `docs/research/2026-09-06-receipt-vs-sale-enterprise-systems.md`.

**Hecho documentado, México.** La regla 2.7.1.21 de la RMF 2026 pide que el CFDI global
lleve «el folio o número de operación de cada recibo al público». Fuente: DOF 28-12-2025,
<https://dof.gob.mx/2025/SHCP/SHCP_281225_01.pdf>, citada con su página en
`docs/research/2026-09-16-mexico-payments-and-fiscal.md:592`.

**Inferencia.** El mercado trata el número corto y legible como un elemento de primera
clase del recibo. El identificador interno no se imprime. En Toast, el número corto, el
código de barras y la llave interna son tres cosas distintas.

## 5. Opciones

| Opción                                    | Forma          | Ventajas                                                                              | Costos                                                                                                   |
| ----------------------------------------- | -------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A. Consecutivo por sucursal y día         | `Ticket 0042`  | Corto; el más fácil de decir; coincide con Toast y con Odoo; cumple la regla 2.7.1.21 | No es único en el tiempo por sí solo: exige un contador y ajustar el alcance de la restricción `unique`. |
| B. Consecutivo por caja y día             | `Caja 2 · 015` | Cada cajero confirma su propio cajón; es estable sin conexión                         | Más números que reconciliar; más trabajo para el gerente.                                                |
| C. Único por comercio con la fecha dentro | `261012-0042`  | Único por comercio sin tocar la restricción; ordenable                                | Más largo; repite la fecha que ya se imprime aparte.                                                     |
| D. UUID acortado en Base32                | `POS-7F3K9QX2` | No necesita contador; no hay colisiones; resuelve el caso sin conexión                | No es consecutivo; no dice antigüedad ni día; no es un folio.                                            |
| E. Reusar el folio de la cuenta           | `Ticket 109`   | Cero maquinaria nueva; el folio ya existe y ya es legible                             | Es una identidad global de la plataforma, no del comercio (sección 6).                                   |

## 6. La opción E no es tan barata como parece

**Hecho documentado.** La cuenta abierta ya tiene folio.
`docs/migration/build-v3/migrations/021_pos_account_metadata.sql:2` añade
`account_number bigint generated always as identity`, y la línea 3 crea
`pos_cart_account_number_uidx on merchant.pos_cart(account_number)`. La interfaz lo
muestra como `Cuenta 109`
(`apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts:1209`), y
`docs/reports/2026-10-12-account-metadata.md` ya lo describe como «una identidad global
con posibles saltos. Es una referencia operativa, no fiscal».

**Inferencia.** Esa identidad es una sola secuencia para toda la tabla, sin alcance por
comercio. `merchant.pos_cart` es una tabla compartida por los comercios y protegida por
políticas de fila. Por lo tanto el número que ve un café crece con el volumen de la
plataforma y no con el suyo: en un local con poco movimiento el primer ticket del día
puede ser `Cuenta 4812`. Sirve para una referencia interna; no sirve como folio impreso.

**Tradeoff respaldado por fuente.** La opción A conserva el número pequeño y paga con un
contador nuevo y con un cambio de restricción. La opción E es gratis y paga con números
grandes y sin relación con el día del café.

## 7. Recomendación y forma del cambio

**Recomendación (inferencia).** Opción A. Es la más corta y la más natural para una
persona. La fecha operativa ya se imprime, así que el folio solo necesita ser único
dentro de su alcance.

1. **Conservar el UUID.** Sigue siendo la llave primaria de `merchant.receipt_snapshot` y
   el enlace entre tablas. El UUID no se pierde.
2. **Escribir el folio en `receipt_number`** con la forma `0042`, para el alcance
   (comercio, sucursal, fecha operativa). El folio se emite al confirmar el cobro, no
   al abrir la cuenta (sección 8).
3. **Ajustar la restricción** a
   `unique (merchant_id, location_id, business_date, receipt_number)`.
   **Hecho documentado.** Ninguna consulta busca un recibo por el número solo: la
   búsqueda usa `ILIKE` (`pos-sale.repository.ts:297`) y la impresión busca por
   identificador (`pos-hardware.repository.ts:1196`). El cambio de alcance no rompe una
   lectura.
4. **Generar el folio con un contador**, no con una secuencia. **Hecho documentado.** Una
   secuencia de PostgreSQL no se reinicia cada día y no puede ser continua: «PostgreSQL
   sequence objects cannot be used to obtain "gapless" sequences»
   (<https://www.postgresql.org/docs/18/functions-sequence.html>, rung 1). El patrón
   documentado y atómico bajo concurrencia es una fila de contador con
   `INSERT … ON CONFLICT … DO UPDATE … RETURNING`: «ON CONFLICT DO UPDATE guarantees an
   atomic INSERT or UPDATE outcome … even under high concurrency»
   (<https://www.postgresql.org/docs/18/sql-insert.html>, rung 1).
5. **Imprimir el folio.** Cambiar `Receipt {uuid}` por `Ticket {folio}` en
   `thermal_printer_adapter.dart:142`.
6. **Extender el folio a los documentos derivados.** Una devolución es otro recibo, y
   por la misma razón lleva su propio folio del mismo contador. Decidir su forma:
   `EX-0042`, o `Ticket 0042 · Devolución`. El prefijo evita que dos documentos distintos
   se llamen igual.
7. **Buscar por folio.** El buscador ya acepta texto libre; solo cambia lo que contiene la
   columna.

El ticket quedaría así:

```
              UMIPOS LOCAL
             Sucursal Centro
  - - - - - - - - - - - - - - - - - - - -
TICKET 0042
Fecha operativa: 2026-10-12  20:16:03
Operador: Ana
  - - - - - - - - - - - - - - - - - - - -
```

**Opción de respaldo.** La opción C (`261012-0042`) cuando el comercio quiera unicidad sin
tocar la restricción. Su costo es un número más largo. La opción D queda descartada como
folio principal; sirve como identificador técnico si un día hace falta uno imprimible y
sin contador.

## 8. El caso sin conexión: la restricción que decide el diseño

Este es el punto que decide dónde se emite el folio.

**Hecho documentado.** La preparación de la cuenta es «Online only»: el servidor conserva
la autoridad de precios y de disponibilidad
(`docs/product/UMIPOS_OFFLINE_COMMAND_POLICY.md:11`). Por lo tanto una venta sin conexión
ocurre sobre una cuenta que ya existe en el servidor.

**Hecho documentado.** La fecha operativa es del servidor, nunca del cliente:
`pos_cart.business_date` es «Server-derived, never client-supplied: a café's day ends at
04:00, not midnight» (`docs/migration/build-v3/20_merchant.sql:1883`).

**Hecho documentado.** La fecha operativa del recibo puede diferir de la de la cuenta. Si
la venta se cobra dentro de un turno de caja, el día del turno manda:
`pos-checkout.repository.ts:1238` («a sale paid out of a shift belongs to that shift's
business day, whatever day the cart was born on»).

Con eso, hay dos formas de cerrar el caso sin conexión:

| Forma                                     | Cómo                                                                                                                            | Costo                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Folio al confirmar el cobro (elegido)** | El folio se emite junto con el recibo. Es el folio del día que manda.                                                           | La venta sin conexión no conoce su folio final. El papel provisional conserva `PROV-…`, y el folio oficial aparece después. |
| Folio al abrir la cuenta                  | El folio se emite cuando nace la cuenta, que ya es un acto en línea. El papel y la pantalla lo conocen antes de la desconexión. | El folio pertenece al día de la cuenta, no al día del turno que cobra. Se gasta un folio en una cuenta que nunca se cobra.  |

**Decidido (2026-10-12). El folio se emite al confirmar el cobro.** El recibo es un
documento distinto de la orden y del carrito: la venta es el hecho comercial y el recibo
es el documento que lo memorializa. Por eso el folio pertenece al recibo y nace cuando el
recibo existe. La decisión coincide con el modelo del sector, donde el recibo es un
documento «separate from, but linked to» la transacción
(`docs/research/2026-09-06-receipt-vs-sale-enterprise-systems.md`, sección 11). También
conserva la coherencia entre el folio y el día operativo que manda, porque el día del
turno es el del recibo, no el de la cuenta.

**Inferencia.** Con el folio al confirmar, el papel provisional necesita una llave que la
máquina pueda resolver. Esa llave es el código de barras, y es la mejora más barata que
acompaña a este cambio (sección 9).

**Costo aceptado.** El papel impreso sin conexión no puede llevar el folio final, porque
todavía no existe. Lleva su `PROV-…`, y el folio oficial aparece cuando el servidor
confirma la venta. El código de barras ayuda a encontrar ese papel **solo si hay quien lo
resuelva** (sección 9): la propia caja, con su diario local, o el servidor, con
`merchant.offline_provisional_mapping`.

## 9. El código de barras ya está previsto y sin usar

**Hecho documentado.** El contrato define el campo `qrValue` en el trabajo de impresión
(`packages/contract/src/pos-hardware.ts:351`) y la capacidad `printer.qr` (línea 26). El
adaptador de la impresora ya lo imprime cuando llega
(`thermal_printer_adapter.dart:221-226`, con `ThermalQrCommand` en la línea 33). El API
envía `null`: `pos-hardware.repository.ts:1271`.

**Hecho documentado.** El código de barras de la pantalla no es un código real. `_Bars`,
en `receipt_document.dart`, deriva el ancho de cada barra de `codeUnits` (`unit % 3 + 1`),
así que pinta un patrón decorativo que ningún lector puede decodificar.

**Corrección importante.** Un código que solo lleva el UUID es una llave, no un
documento. Sin un resolutor no dice nada. Sin conexión, el único resolutor disponible es
la caja que emitió el papel: su diario guarda el mapa de provisional a oficial
(`offline_journal.dart:122` y `:399`). Un segundo equipo, o un papel lejos de su caja, no
resuelven nada. **Inferencia:** el código de barras no reemplaza al folio; el folio es el
único identificador que sobrevive sin red, sin batería y sin equipo.

**Hecho documentado, el modelo del SAT.** La representación impresa de un CFDI debe
llevar un código de barras bidimensional QR, conforme al estándar ISO/IEC 18004 con
corrección de error de nivel mínimo M, impreso en un cuadrado de lados no menores a
2.75 cm. El código contiene, en secuencia, la URL del servicio de verificación y estos
datos: el folio fiscal (UUID), el RFC del emisor, el RFC del receptor, el total del
comprobante y los ocho últimos caracteres del sello digital del emisor. Fuente:
Especificación técnica del código de barras bidimensional, Anexo 20 versión 4.0,
publicado por el SAT
(<https://www.dof.gob.mx/nota_detalle_popup.php?codigo=5492254>, rung 1).

**Inferencia.** El SAT no imprime una llave desnuda: imprime una expresión. La llave
localiza el documento y el contexto (receptor, total, sello) permite leer el papel sin
consultar nada. Ese es el patrón que conviene copiar.

**Decisión abierta.** Qué lleva el código, entre tres formas:

1. Solo la llave: el UUID o el enlace al recibo. Es lo mínimo y necesita resolutor.
2. La llave más contexto, al estilo del SAT: folio, fecha operativa, sucursal y total.
   El papel se puede leer sin consultar nada.
3. La llave, el contexto y un fragmento de firma del equipo. **Inferencia:** es posible,
   porque el equipo ya tiene una llave ES256 de dispositivo
   (`apps/umi-pos/lib/core/security/tpm_device_key.dart`,
   `apps/umi-api/src/modules/devices/device-proof.ts`), pero es trabajo de diseño propio
   y no está en este cambio.

El campo del contrato admite 512 caracteres, así que las tres formas caben. Llenar
`qrValue` no necesita dependencia nueva. Un código real en pantalla sí: `barcode` 2.2.9,
licencia Apache-2.0, sin archivar, último envío al repositorio el 2025-01-25
(<https://pub.dev/packages/barcode>, <https://github.com/DavBfr/dart_barcode>).

## 10. Riesgos y decisiones abiertas

1. **Reimpresiones.** El folio no cambia. La copia ya imprime `COPIA` (campo `copy` del
   trabajo de impresión).
2. **Historial.** El recibo es inmutable y los informes leen la copia congelada. El cambio
   aplica a los recibos nuevos. Los anteriores conservan `POS-<uuid>`, y las dos formas
   conviven porque el campo es texto libre.
3. **Folio del recibo contra folio del CFDI.** Son documentos distintos. Decidir si deben
   coincidir. La semilla fiscal `F-…` (`fiscal.integration.ts:225`) no se imprime al
   cliente y no forma parte de este cambio.
4. **Ancho del consecutivo.** Decidir `0042` o `000042`, y el comportamiento al desbordar.
5. **Dígito verificador.** **Tradeoff respaldado por fuente.** Crockford Base32 admite un
   símbolo de control «modulo 37» y excluye cuatro letras que se confunden con otras
   (<https://www.crockford.com/base32.html>). Para un folio de cuatro dígitos, el símbolo
   agrega ruido a la lectura. **Inferencia:** no agregarlo al folio; confiar en la
   búsqueda y en el código de barras.
6. **Qué canal no tiene cuenta.** Un pedido que llega por otro canal puede no tener una
   cuenta de POS. Ese recibo necesita folio al confirmar. **No verificado:** cuántos
   recibos nacen hoy sin una cuenta de POS.
7. **Quién resuelve el código.** Un código de barras sin resolutor no sirve. Decidir si
   el papel debe leerse solo (forma 2 o 3 de la sección 9), o si basta con que la caja y
   el servidor lo resuelvan.

## 11. Fuentes

| Fuente                                                                                                                                                             | Rung | Uso                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------- |
| `docs/migration/build-v3/20_merchant.sql`, `34_pos_exception.sql`, `ORDER_MODEL.md`, `migrations/021_pos_account_metadata.sql`                                     | 3    | Esquema de `receipt_snapshot`, `pos_exception_receipt`, `pos_cart` y la identidad de la cuenta. |
| `apps/umi-api/src/modules/**`, `apps/umi-pos/lib/**`, `apps/umi-dashboard/src/screens/**`, `packages/contract/src/**`                                              | 3    | El recorrido completo del identificador.                                                        |
| `docs/product/UMIPOS_OFFLINE_COMMAND_POLICY.md`, `docs/reports/2026-10-12-account-metadata.md`, `docs/reports/2026-10-11-imin-receipt-roll-and-format.md`          | 3    | La política sin conexión, el folio de cuenta y el formato del papel.                            |
| <https://www.postgresql.org/docs/18/functions-sequence.html>                                                                                                       | 1    | La secuencia no es continua y no se reinicia.                                                   |
| <https://www.postgresql.org/docs/18/sql-insert.html>                                                                                                               | 1    | `ON CONFLICT DO UPDATE` es atómico bajo concurrencia.                                           |
| <https://support.toasttab.com/en/article/Customizing-Receipts-Advanced-Configuration>                                                                              | 1    | Número de orden grande y código de barras del recibo.                                           |
| <https://github.com/odoo/odoo/blob/17.0/addons/point_of_sale/models/pos_order.py>                                                                                  | 3    | `pos_reference` como «Receipt Number».                                                          |
| <https://dof.gob.mx/2025/SHCP/SHCP_281225_01.pdf> (regla 2.7.1.21 de la RMF 2026)                                                                                  | 1    | El folio o número de operación del recibo al público.                                           |
| <https://www.crockford.com/base32.html>                                                                                                                            | 7    | Alfabeto sin ambigüedad y símbolo de control módulo 37.                                         |
| <https://www.dof.gob.mx/nota_detalle_popup.php?codigo=5492254> (Anexo 20 v4.0, especificación técnica del QR)                                                      | 1    | El contenido del código de barras del CFDI: llave y contexto.                                   |
| `apps/umi-pos/lib/features/offline/offline_journal.dart`, `apps/umi-pos/lib/core/security/tpm_device_key.dart`, `apps/umi-api/src/modules/devices/device-proof.ts` | 3    | El resolutor local y la llave de dispositivo.                                                   |
| <https://pub.dev/packages/barcode>, <https://github.com/DavBfr/dart_barcode>                                                                                       | 2    | `barcode` 2.2.9, Apache-2.0, activo.                                                            |

### Rutas que fallaron

| Canal                                             | Resultado                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `www.crockford.com/base32.html` leído sin limpiar | El cuerpo no entrega el texto como prosa; hizo falta separar las etiquetas para leerlo. |
| Páginas de documentación de Odoo                  | No entregan el texto al lector; se usó el repositorio (rung 3).                         |
| `support.toasttab.com` desde `curl`               | Requirió el lector de texto `r.jina.ai`, que sí devolvió el artículo completo.          |
