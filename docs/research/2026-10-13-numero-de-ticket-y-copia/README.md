# El número de orden, el número de ticket y el número de impresión

Fecha: 2026-10-13. Autor: agente Codex, a pedido del dueño.

**Pregunta.** ¿La ley en México o la competencia exigen un número de ticket aparte del
número de orden? ¿Y hace falta un número de impresión?

Etiquetas: **hecho documentado**, **tradeoff respaldado por fuente**, **inferencia**, **NO
VERIFICADO**.

## 1. Respuesta corta

| Pregunta                                        | Ley en México                                                                                                       | Competencia                                                                                                                                                          | Recomendación                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| ¿Se necesita un número visible?                 | Sí. El comprobante simplificado de un equipo de registro fiscal debe llevar **el número de folio** (CFF art. 29-B). | Todos imprimen uno: número de cuenta, de ticket o de orden. Es lo que la gente dice y teclea.                                                                        | Sí. Uno visible y consecutivo.                                               |
| ¿Hacen falta **dos** series (orden y ticket)?   | No. La ley pide **un** folio por comprobante, no dos series.                                                        | Nadie imprime dos. Square, Toast, Lightspeed, Odoo y Soft Restaurant imprimen uno solo.                                                                              | Se puede mantener el par actual o colapsarlo a uno. Decisión del dueño.      |
| ¿Se necesita número de **impresión** (COPIA n)? | No lo exige. La práctica fiscal vieja numeraba el folio en original y copia, y decía quién se queda con cada papel. | Sí se marca la reimpresión: Square lo tiene en su API, Lightspeed imprime "copia de cliente" o "de comercio", los terminales bancarios imprimen "Duplicate Receipt". | Sí, y ya lo tenemos: original limpio y `COPIA n` en la reimpresión.          |
| ¿La llave interna (UUID)?                       | No se imprime. El folio fiscal del CFDI es otra cosa (lo asigna el SAT o el PAC).                                   | No se imprime en ninguna de las revisadas.                                                                                                                           | Se queda como llave, en el código de barras y en la base, nunca en el texto. |

## 2. Lo que dice la ley en México

### 2.1 El folio del comprobante simplificado

**Hecho documentado.** El Código Fiscal de la Federación, artículo 29-B (comprobantes
fiscales simplificados de operaciones con el público en general), pide: cuando el
contribuyente usa máquinas registradoras de comprobación fiscal o equipos o sistemas
electrónicos de registro fiscal, el comprobante debe llevar los requisitos del artículo
29-A, fracciones I y III, **el número de folio**, y **el número de registro de la máquina,
equipo o sistema** y, cuando proceda, el logotipo fiscal. Fuente: texto del CFF publicado
por el SAT,
<https://wwwmat.sat.gob.mx/cs/Satellite?blobcol=urldata&blobkey=id&blobtable=MungoBlobs&blobwhere=1461172505848&ssbinary=true>
y la reforma en el DOF,
<https://sidof.segob.gob.mx/notas/docFuente/5226398> (rung 1).

**Inferencia.** Ese "número de registro de la máquina" solo aplica a equipos aprobados y
registrados ante el SAT como de comprobación fiscal. El POS de UMI no es ese tipo de
equipo: hoy el camino es CFDI con un proveedor autorizado. Conviene confirmarlo con el
contador antes de darlo por cerrado, porque cambiaría una línea del papel.

### 2.2 El número de operación para la factura global

**Hecho documentado.** La regla 2.7.1.21 de la Resolución Miscelánea Fiscal (hoy publicada
como 2.7.1.24) permite elaborar un CFDI diario, semanal o mensual de las operaciones con
el público en general, y exige que conste "el número de folio o de operación de los
comprobantes de operaciones con el público en general que se hubieran emitido". Fuente:
<https://wwwmat.sat.gob.mx/articulo/90959/regla-2.7.1.24> (rung 1).

**Inferencia.** Es el requisito que hace necesario que **cada recibo entregado al público
tenga un número identificable en los registros del comercio**, porque ese número es el que
va a la factura global. Puede ser el folio del recibo o el número de operación; lo que no
puede es no existir.

### 2.3 Original y copia

**Hecho documentado.** La regla que rigió los comprobantes impresos pedía "comprobantes
impresos en original y copia, debiendo contener impreso el número de folio en forma
consecutiva previamente a su utilización", y el criterio publicado por el SAT precisaba
que "la copia se entregará al interesado y los originales se conservarán por el
contribuyente que los expide". Fuente: regla vigente en su momento, reproducida en
<https://sidof.segob.gob.mx/notas/docFuente/5466834> y en el precedente
<https://sjf2.scjn.gob.mx/detalle/ejecutoria/30734> (rung 1 y 7).

**Tradeoff respaldado por fuente.** La convención mexicana clásica es **copia para el
cliente, original para el comercio** (porque el original es el respaldo contable). Nuestro
papel hace lo contrario: la primera impresión sale limpia y las siguientes dicen `COPIA`.
Con un POS la lógica del talonario preimpreso ya no aplica —el respaldo del comercio vive
en la base y en la factura global—, pero conviene que el contador lo sepa y que el dueño
elija: si algún día piden el papel, la convención contraria a la del SAT se explica sola.

### 2.4 Entregar el comprobante es obligación del restaurante

**Hecho documentado.** PROFECO recuerda a los restaurantes que "deben ... entregar un
comprobante de compra o ticket" al momento del consumo, y que el comprobante es necesario
para interponer una queja. Fuentes:
<https://www.gob.mx/profeco/prensa/profeco-recuerda-a-restaurantes-exhibir-claramente-sus-precios?idiom=es-MX>
y
<https://www.gob.mx/profeco/prensa/profeco-recuerda-a-las-y-los-consumidores-la-importancia-de-pedir-y-guardar-tickets-de-compra?idiom=es-MX>
(rung 1).

**Inferencia.** La obligación es entregar el comprobante. No exige numerarlo, ni que sea
fiscal: por eso el papel que hoy damos (nota de venta con folio) cumple esa parte, y la
parte fiscal se resuelve con la factura global o con la factura que pida el cliente.

### 2.5 Lo que la ley NO pide

- **NO VERIFICADO / sin fuente que lo exija.** No hay requisito de imprimir dos series
  consecutivas (orden y ticket) en el mismo papel.
- **No** hay requisito de numerar las reimpresiones. Sí hay, en cambio, obligación de
  conservar los registros y de poder identificar cada operación ante una revisión.
- **No** se imprime el folio fiscal (UUID) del CFDI en la nota de venta; ese número vive en
  el CFDI y en su código de barras o QR.

## 3. Lo que hace la competencia

- **Hecho documentado, Square.** Su API de recibos tiene un campo explícito para
  "identify the receipt as a reprint rather than an original receipt"
  (<https://developer.squareup.com/reference/square/objects/ReceiptOptions>). En el POS, el
  ticket impreso lleva un nombre de cliente o un **order number**, y "the ticket number
  will be automatically assigned"; la reimpresión se busca por **receipt number**
  (<https://squareup.com/help/us/en/article/6139-print-receipts>). Un número operativo y un
  número de documento, con la reimpresión marcada por el sistema.
- **Hecho documentado, Lightspeed.** El menú de acciones del recibo ofrece "Print customer
  copy" y "Print merchant copy"; y en la reimpresión "el documento indica si es copia de
  cliente o copia de comercio"
  (<https://k-series-support.lightspeedhq.com/hc/en-us/articles/17102250160923-Managing-and-refunding-receipts>,
  <https://k-series-support.lightspeedhq.com/hc/en-us/articles/19678535506331-About-WEB-SRM-Quebec>).
- **Hecho documentado, terminales bancarias (Ingenico/Fiserv).** El duplicado "is not an
  exact copy of either a customer or merchant receipt and has Duplicate Receipt printed on
  it"
  (<https://uk.clover.com/content/dam/firstdata/clover-uk/en/pdf/card-machines/Ingenico-iwl2200-user-guide.pdf>).
- **Hecho documentado, Deal POS.** Etiqueta configurable de copia para las reimpresiones
  (<https://support.dealpos.com/en/articles/4773789-add-copy-label-on-the-reprinted-customer-invoice>).
- **Hecho documentado, Soft Restaurant (México).** La reimpresión se hace por **folio de la
  cuenta** ("Ventas → Reimprimir folios de cuentas pagadas", filtrando por fecha o número
  de folio) y "todas las reimpresiones quedan registradas en la Bitácora del Sistema para
  fines de auditoría, indicando qué usuario realizó la acción"
  (<https://www.techblog.mx/blog/2026-01-14-softrestaurant11-reimprimir-cuenta>). Su
  autofactura permite mostrar en la factura "el folio de la cuenta o el folio único de
  facturación"
  (<https://sr-autofactura-prod.s3.us-east-1.amazonaws.com/descargas/manuales/CAP.MNL.Manual_usuario_Autofactura.V1.0.pdf>).
  O sea: numeran la cuenta, con eso buscan y reimprimen, y la auditoría queda en el sistema.
- **Hecho documentado, Odoo.** El pedido lleva un solo `pos_reference` con la forma
  `Order 00001-001-0001`, etiquetado "Receipt Number" (citado con archivo y líneas en
  `docs/research/2026-09-16-receipt-vs-sale-enterprise-systems.md`).
- **Hecho documentado, Toast.** El número de la cuenta puede imprimirse grande en el
  encabezado del recibo ("Show Large Order Number in Receipt Header")
  (<https://support.toasttab.com/en/article/Customizing-Receipts-Advanced-Configuration>).
- **Hecho documentado, Clover.** La copia de comercio no incluye el número de mesa u orden
  por omisión: hay una petición abierta pidiéndolo
  (<https://clover.uservoice.com/forums/963884-restaurant/suggestions/49972752-include-table-order-number-and-items-sold-on-merch>).
  Es el contraejemplo: donde falta el número, el operador tiene que reimprimir para saber
  de qué venta se trata.

**Inferencia.** La industria usa **un** número visible por documento, imprime la
reimpresión como copia, y guarda la llave interna sin imprimirla. Nadie imprime dos series
consecutivas.

## 4. Lo que UMI imprime hoy

`apps/umi-pos/lib/features/hardware/thermal_printer_adapter.dart` arma el papel así:

| Línea                                    | De dónde sale                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `COPIA` o `COPIA n` (sólo reimpresión)   | `receipt['copyIndex']`, contado de los trabajos de impresión del recibo (líneas ~180-198) |
| Logo, comercio, sucursal, caja           | `merchantLogo`, `merchantName`, `locationName`, `registerName`                            |
| `Orden NNN` (negritas, centrado)         | `receipt['orderNumber']`, el número que la gente dice (líneas ~241-252)                   |
| `Ticket NNNN` (sólo si es un número)     | `receipt['receiptNumber']`, el consecutivo del documento (líneas ~254-266)                |
| Fecha operativa, partidas, totales, pago | El resto del `receipt`                                                                    |

**Hecho documentado.** El papel de hoy ya trae los tres datos que pregunta el dueño: orden,
ticket y copia. Y ya rechaza imprimir el UUID: si el `receiptNumber` es un `POS-<uuid>`
viejo, la línea de ticket no se imprime (comentario en la línea ~254 y `_shortTicketFolio`).

### 4.1 Cuándo cambia el número de ticket y cuándo no

El ticket nace **una sola vez, al cobrar**, y sale del contador
`merchant.receipt_counter` (comercio + sucursal + **día operativo**), migración
`docs/migration/build-v3/migrations/022_receipt_folio.sql`. El número de orden que va arriba
es otra cosa: es el `account_number` de la cuenta
(`apps/umi-api/src/modules/pos-hardware/pos-hardware.repository.ts:1282`), y ese no cambia
nunca para la misma cuenta.

| Situación                                 | Número de orden | Número de ticket                                                                                      |
| ----------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| Cuenta abierta, todavía sin cobrar        | Ya existe       | Todavía no existe                                                                                     |
| Cobro normal                              | Igual           | Nuevo, del contador del día                                                                           |
| Reimprimir la misma venta                 | Igual           | **Igual**, con `COPIA n`                                                                              |
| Pago con dos métodos (efectivo + tarjeta) | Igual           | Uno solo                                                                                              |
| Reintento del mismo cobro                 | Igual           | Igual: el sobre de comandos guarda el resultado por llave (`integrity.service.ts`)                    |
| Cuenta de ayer cobrada hoy                | La de ayer      | **De la serie de hoy**: el día lo decide el turno que cobra                                           |
| Reembolso o anulación después de la venta | Igual           | **Otro documento**: `EX-n` del mismo contador con prefijo propio (`pos-exception.repository.ts:1032`) |
| Factura (CFDI)                            | Igual           | No cambia: el folio fiscal es del CFDI                                                                |
| Cuenta nueva                              | Nuevo           | Nuevo, al cobrarla                                                                                    |

**Hecho documentado.** Un cobro parcial que deje saldo no existe: si los pagos no cubren el
total, el cobro se rechaza con `REMAINING_BALANCE`
(`apps/umi-api/src/modules/pos-checkout/pos-checkout.service.ts:1128`). Por eso hoy no puede
haber dos tickets para una cuenta cobrada una sola vez.

**Inferencia.** Si algún día se habilita cobrar en dos exhibiciones (un anticipo y luego la
liquidación) o pagar una cuenta por cobrar días después, ahí hay que decidir: un ticket por
cada cobro parcial —dos folios, una sola orden— o un ticket al final. La ley no lo impide;
es una decisión de operación, y conviene tomarla antes de construirla, no después.

## 5. Recomendación

1. **Conservar los tres datos, con el peso visual que ya tienen**: `Orden NNN` grande —es
   lo que el cliente y el personal dicen—, `Ticket NNNN` pequeño —es el folio del documento
   que la regla fiscal pide y con el que la caja y el panel cuentan—, y `COPIA n` sólo en
   la reimpresión.
2. **No agregar una tercera serie.** Si el dueño prefiere un solo número en el papel, el
   candidato es dejar `Orden NNN` y llevar el folio del recibo sólo en la base; el costo es
   perder el número con el que hoy se busca y se reimprime en el panel. La comparación de
   la industria favorece cualquiera de las dos, pero no las dos series sin necesidad.
3. **Escribir en el reporte de ticket que la reimpresión se numera y además queda
   registrada** (el POS ya cuenta los trabajos de impresión, y la API los guarda). Es la
   mitad de auditoría que Soft Restaurant resuelve en su bitácora.
4. **Confirmar con el contador dos cosas**: si el comercio va a emitir factura global y con
   qué número de operación la va a armar, y si algún día usará equipo de registro fiscal
   autorizado (sólo entonces se imprime el número de registro del equipo).

## 6. Qué NO se verificó

- **NO VERIFICADO.** No se consultó a un contador ni al SAT sobre el caso concreto de este
  comercio. Todo lo de arriba son textos publicados (CFF, RMF, PROFECO) más inferencias
  marcadas como tales.
- **NO VERIFICADO.** No se probó ningún POS de la competencia; lo de la sección 3 sale de
  documentación de proveedor, de su API pública y de sus foros.
- **NO VERIFICADO.** No se confirmó si la versión vigente de la RMF conserva la regla con
  el número 2.7.1.21 o ya es 2.7.1.24; ambas aparecen en el portal del SAT y el texto es el
  mismo.

## 7. El código de impresión y el QR

El dueño preguntó también por estas dos cosas que el papel lleva hoy.

### 7.1 Lo que imprime hoy el ticket

**Hecho documentado.** En
`apps/umi-pos/lib/features/hardware/thermal_printer_adapter.dart`:

- Una línea `Impresión <ocho caracteres>` al pie, que es el identificador del **trabajo de
  impresión** (`impressionId`, la fila de `merchant.hardware_print_job`), no de la venta.
  Nace en `apps/umi-api/src/modules/pos-hardware/pos-hardware.repository.ts:1199`.
- Un **QR** con la cadena propia de UMI:
  `UMI1|R=<uuid>|T=<folio>|D=<fecha>|C=<moneda>|A=<total>`, armada por
  `apps/umi-api/src/shared/receipts/receipt-barcode.ts`. Se imprime como QR si la impresora
  declara `printer.qr`; si no, la cadena sale **como texto**.
- La impresora configurada hoy es una Epson TM-T20IIIL que sí declara
  `printer.receipt,printer.image,printer.qr,printer.cut,printer.test_page`
  (`merchant.hardware_device`), así que el QR sale dibujado.

**Hecho documentado.** El archivo que arma la cadena lo dice sin adornos: “Nothing consumes
this yet: the till prints it and the thermal adapter draws it, and the screen's own bars are
still decorative”. Es decir: hoy el QR no lo lee nadie, ni la app ni el dashboard.

### 7.2 ¿Los exige la ley?

- **No** en una nota de venta. PROFECO pide entregar el comprobante, nada más.
- **Sí** en la representación impresa de un **CFDI**: debe llevar el código de barras
  conforme al rubro I.D del Anexo 20 o el número de folio fiscal, y la leyenda “Este
  documento es una representación impresa de un CFDI”
  (<https://www.sat.gob.mx/minisitio/Factura/solicita_requisitos.htm>). Ese QR lo genera el
  CFDI con su PAC, no nuestra nota de venta.

### 7.3 ¿Para qué sirven en la industria?

Siempre para algo concreto:

- **Autofactura, en México.** Soft Restaurant trae “Activar código QR de facturación en el
  ticket de venta” como ajuste del formato de ticket
  (<https://softrestaurant.zohodesk.com/portal/es/kb/articles/10-activar-c%C3%B3digo-qr-de-facturaci%C3%B3n-en-el-ticket-de-venta>);
  su módulo Auto Factura manda al cliente a una plataforma web “con un código único, con el
  cual podrá facturar”
  (<https://softrestaurant.com/docs?download=177%3A23-ft-soft-restaurant-autofactura>).
- **Pago desde la mesa.** Square: el cliente paga escaneando el QR del ticket impreso
  (<https://squareup.com/help/us/en/article/8456-checkout-with-scan-to-pay>).
- **Reabrir la cuenta del invitado.** Toast puede imprimir un código de barras con el que se
  busca y se reabre la cuenta (citado en
  `docs/research/2026-10-12-identificacion-de-tickets-legible.md`, sección 4).
- **Contraejemplo.** Square no permite imprimir códigos en el recibo por ahora y su propia
  comunidad lo pide para no teclear el número
  (<https://community.squareup.com/t5/Questions-How-To/Print-a-barcode-on-a-receipt/m-p/58228>).
  Es decir: el código se quiere cuando ahorra teclear algo, no por decorar.

### 7.4 Decisión (2026-10-13, implementada)

El dueño decidió, sobre esta investigación: **fuera el QR y fuera la línea de impresión; el
papel cierra con "Gracias por su visita" centrado.** Queda hecho en
`apps/umi-pos/lib/features/hardware/thermal_printer_adapter.dart`:

- El QR ya no se dibuja, y tampoco se imprime la cadena como texto en una cabeza sin
  `printer.qr` (ese respaldo también se quitó). La expresión `UMI1|…` sigue viva en la API y
  en el `safe_document` del trabajo de impresión, que es donde servirá el día que exista
  lector o portal.
- La línea `Impresión <id>` salió del papel. El `impressionId` se queda en
  `merchant.hardware_print_job`, que es donde soporte lo busca.
- El último renglón del papel es `Gracias por su visita` (centrado), y su par en inglés para
  un recibo en inglés.
- **La propina tiene renglón siempre** (0.00 cuando no hay), para que quien deja una la
  encuentre y quien no, vea que no se agregó nada. El total ya la incluye: el cobro suma
  `subtotal + propina` (`checkout-calculator.ts`), así que el papel se puede sumar a mano.
- **El impuesto lee cero mientras el desglose esté pendiente** (dueño, 2026-10-13). El dato
  real se queda en `merchant.receipt_snapshot` y en el libro, que es lo que leerán los
  reportes y la factura. Razón medida para no mostrar la cifra hoy: los recibos del piloto no
  coinciden entre sí — uno imprime subtotal 550.00 con 75.86 dentro y el mismo total, y otro
  imprime 77.58 más 12.42 — así que una cifra en el papel sería una cifra que la caja no puede
  sostener. La pantalla del recibo dice lo mismo que el papel, con las mismas dos reglas.

**Hecho documentado, y el mismo cambio de paso.** El encabezado imprimía dos veces el nombre
porque el comercio y su única sucursal se llaman igual ("ONCA", la única sucursal publicada
en `merchant.location`). Ahora la sucursal se imprime sólo cuando dice algo distinto del
nombre del comercio, que es el caso para el que se agregó esa línea.

### 7.5 Lo que falta y conviene: los datos del negocio en el papel

**Hecho documentado.** El comercio no tiene hoy ni RFC, ni dirección, ni teléfono: en
`merchant.merchant` sólo hay `name`, `legal_name` y `city`, y `merchant.location` sólo tiene
nombre y zona horaria. Por eso el ticket no puede mostrar más que el nombre.

**Hecho documentado.** La norma mexicana sí espera más: los requisitos del comprobante
(artículo 29-A, fracción I del CFF) incluyen el nombre o razón social, el **domicilio
fiscal** y la clave del RFC de quien lo expide, y precisan que un contribuyente con varios
locales debe señalar **el domicilio del establecimiento** donde se expide. La lista clásica
de documentos válidos como comprobante pide lo mismo: nombre, RFC, domicilio fiscal, número
de folio, lugar y fecha, e importe total
(<https://dof.gob.mx/nota_detalle_popup.php?codigo=5218388>).

**Inferencia.** Vale la pena, y es un frente propio, no un detalle del QR: agregar el RFC y
el nombre legal al comercio y la dirección y el teléfono a la sucursal, poder editarlos en
Ajustes del dashboard, llevarlos en el `printPayload` e imprimirlos bajo el nombre. Con eso
el ticket sirve para pedir una factura y para identificar la sucursal, que es lo que hace
cualquier POS mexicano. Hoy no se puede imprimir lo que no se guarda.

### 7.6 Recomendación original (se conserva por el razonamiento)

| Pieza                        | Veredicto                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Impresión <id>` en el papel | Sacarlo de la cara del cliente. El identificador de la impresión queda en la base y en el log, que es donde sirve.                                             |
| QR con la cadena `UMI1\|…`   | Sacarlo del papel **hoy**: no tiene lector. Volverlo a poner cuando tenga destino.                                                                             |
| Cadena `UMI1\|…` en la base  | Conservarla. Está versionada, lleva folio, fecha, moneda y total en unidades menores: es el punto de partida del lector o del portal de autofactura.           |
| QR de autofactura            | Sólo cuando el comercio encienda autofactura, y entonces con **URL del portal** más el folio, no con la cadena interna: el cliente lo escanea con su teléfono. |

**Inferencia.** Un código que no lleva a nada es peor que no imprimir código: ocupa papel,
gasta tinta térmica y enseña al cliente una promesa que la app no cumple. La decisión no se
pierde: el día que exista lector o portal, la cadena ya está lista.
