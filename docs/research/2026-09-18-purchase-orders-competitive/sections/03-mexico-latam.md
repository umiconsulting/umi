# Purchase orders in the Mexico and Latin America products

- Date: 2026-09-18
- Lane: 3 of 5 in the purchase-order pass
- Question: in the products a Mexican cafe actually compares Umi against, does an
  "orden de compra" exist, where does it live, and how far does it travel?
- Decision this informs: the purchase-order surface that Umi builds in the
  dashboard.
- Evidence window: vendor help centres, vendor product pages, vendor APIs, the
  Apple review feed, and YouTube, read on 2026-09-18.
- Captures: eight, in `../assets/`. The index is
  [assets/INDEX-03-mexico.md](../assets/INDEX-03-mexico.md).

## The priority list, and the count

Eight groups, in the order the requester gave them: SoftRestaurant (National Soft),
Fudo, Parrot Software, PoloTab, the other National Soft products, Revo and Wansoft,
Loyverse, and the invoicing-first group (Bsale, Alegra, Bind ERP, Aspel/Siigo).

## Labels

- **Documented fact** - the vendor wrote it, and the URL is given.
- **Source-backed tradeoff** - the vendor wrote it, and it trades one thing for another.
- **Inference** - my reading, with the evidence that supports it.
- A question the evidence does not settle reads **not verified**.

## What this pass changes since the prior file

Prior file: [2026-09-17-inventory-kitchen-systems-deep-dive.md](../2026-09-17-inventory-kitchen-systems-deep-dive.md) §7.

1. **PoloTab changed.** The prior pass calls PoloTab procurement "partial - stock
   entry, not an order-to-receipt chain". On 2026-09-18 the PoloTab Inventarios
   page advertises auto-generated purchase orders. See §4 below.
2. **SoftRestaurant has a live source now.** The prior pass used archived PDFs
   (2012-2021). The live pricing page and a Zoho Desk article carry the wording
   today. See §1 below.
3. **Fudo did not change.** No purchase-order object exists. Purchases are
   expenses. This pass adds the supplier-invoice surface and the reviews.

---

## 1. SoftRestaurant (National Soft, Mexico)

**The object exists: "Órdenes de compra".** The live page
<https://softrestaurant.com/soft-restaurant-precio> lists, under the "Inventarios"
tab of the Soft Restaurant 12 feature table, verbatim: _"Catálogo de productos /
Catálogo de insumos / Catálogo de proveedores / Costeo de recetas / Insumos
elaborados / Recetas / **Órdenes de compra** / Control de almacenes / Pedidos y
traspasos entre almacenes / Envío de compras por email / **Generación de órdenes de
compra por email**"_. **Documented fact**, that page, fetched 2026-09-18. Capture:
`mx-softrestaurant-precio-inventarios.png`.

The same page lists one capability as new in version 12, verbatim: _"**Importación
de compras por XML con vinculación automática de insumos**"_. **Documented fact**,
the same page.

| Question                                         | Answer                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Object exists?                                   | **Yes** - "Órdenes de compra". **Documented fact**                                                                                                                  |
| Surface                                          | The Windows/desktop back office. The menu path is `Almacén`. Not the POS terminal                                                                                   |
| Generated or hand-made?                          | The public page promises generation of orders "por email". Generation from min/max stock comes from the prior pass and is **not verified** on a live page this pass |
| CFDI/XML import?                                 | **Yes** - a separate object, "Compras desde CFDI". See below                                                                                                        |
| Statuses, in Spanish                             | **Not verified.** No status list is published                                                                                                                       |
| Ordered price vs invoiced price, and cost update | The invoice import writes the XML price fields. See below. An ordered-vs-invoiced comparison is **not verified**                                                    |
| Accounting link                                  | **Yes** - the CFDI screen holds a "Cuenta contable" field, and the ERP module is the documented hand-off                                                            |

**The supplier-invoice side is documented, and it is the strongest of the eight.**
Article "MANUAL DE USUARIO COMPRAS DESDE CFDI",
<https://softrestaurant.zohodesk.com/portal/es/kb/articles/manual-de-usuario-compras-desde-cfdi>,
fetched 2026-09-18. Capture: `mx-softrestaurant-compras-cfdi.png`. Verbatim:

- The route: _"Desde el menú principal, haga clic en la opción Almacén. Selecciona
  Compras desde CFDI del submenú desplegable."_
- The import: _"Importar CFDI ... se abrirá una ventana emergente para buscar el
  archivo XML de tu factura."_
- The item link: _"Soft Restaurant® asociará automáticamente cada producto de la
  factura cuando la descripción de la presentación del insumo coincida con la
  Descripción del producto en factura."_
- The supplier link: _"el proveedor se asignará automáticamente en la compra cuando
  en el catálogo de proveedores se encuentre registrado el RFC del emisor de la
  factura."_
- The price and tax fields, imported from the XML: _"el archivo también añadirá en
  automática la Cantidad, Costo Unitario, Desct. %, Importe, el porcentaje del
  impuesto e importe del impuesto, así como el importe con impuestos."_
- The payable: after the save, the screen offers a payment to the supplier with
  _"Folio de la compra. Folio de la factura. Proveedor. ... Saldo. ... Abono. Saldo
  actual."_

**The documented trap, and it is the important one.** The automatic link is an
exact string match. Verbatim: _"Soft Restaurant® valida la descripción completa de
la presentación, incluyendo espacios. Es por ello que esta presentación no fue
asociada automáticamente."_ The article then asks the operator to fix the line by
hand. **Source-backed tradeoff** - exact matching is fast when the supplier
catalogue matches, and silent when it does not.

**The accounting boundary.** Article "MÓDULO DE INTEGRACIÓN ERP Y PSM",
<https://softrestaurant.zohodesk.com/portal/es/kb/articles/m%C3%B3dulo-de-integraci%C3%B3n-erp-y-psm>.
Verbatim: _"Al realizar las compras en el ERP se generan de manera natural las
pólizas de egresos y la gestión de saldos a proveedores (si se trata de CXP o
cuentas por pagar)."_ **Documented fact.** So SoftRestaurant hands the ledger to the
ERP when the shop has one.

**Warning - the vendor's own web estate is partly broken.** `softrestaurant.com.mx`
answers `ERR_SSL_PROTOCOL_ERROR`, and `ayuda.`, `soporte.` and `conocimiento.` at
that domain do not resolve. The live brand is `softrestaurant.com`. **Documented
fact**, four routes tried; the log is at the end of this file. This matches the
prior pass note that the public documentation is thin.

## 2. Fudo (Argentina and Mexico)

**No "orden de compra" object exists.** The help centre is at
<https://soporte.fu.do/es/>. Its full article list holds "Proveedores", "Cuentas
corrientes de proveedores", "Reporte de Compras" and "Reporte de Gastos", and no
article with "orden de compra" in the title. **Documented fact** - the article
index, read 2026-09-18. Capture: `mx-fudo-gastos-y-compras.png`.

The purchase is an **expense**, and the vendor says so, verbatim: _"En un
restaurante, bar o cafetería, todos los días se compran ingredientes, bebidas,
productos de limpieza y otros insumos necesarios para que el negocio funcione. A
estas compras las llamamos **gastos**."_ **Documented fact**, article "Registro de
gastos y compras en Fudo",
<https://soporte.fu.do/es/articles/11730876-registro-de-gastos-y-compras-en-fudo>.

| Question                                         | Answer                                                                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Object exists?                                   | **No.** Purchases are expenses with a goods detail                                                                                                                                                                       |
| Surface                                          | The web back office ("sistema Fudo, sección Gastos"), not the POS                                                                                                                                                        |
| Generated or hand-made?                          | Hand-made. No min/max generation. **Documented fact** by absence                                                                                                                                                         |
| CFDI/XML import?                                 | **No CFDI.** There is "Recepción IA" ("¿Cómo importar facturas mediante foto o PDF con IA?") for a photo or PDF, and a "Sección 'Documentos Recibidos' (ARG): Gestión de facturas de proveedores" that is Argentina-only |
| Statuses, in Spanish                             | The expense carries "Estados de Gastos". A purchase-order status set does not exist                                                                                                                                      |
| Ordered price vs invoiced price, and cost update | **Not verified** as a comparison. The expense can carry a goods detail                                                                                                                                                   |
| Accounting link                                  | Supplier current accounts ("Cuentas corrientes de proveedores") and a "Reporte de Compras"                                                                                                                               |

**Operator voice (App Store Mexico, app id 1137158486, 3.13 average from 31
ratings, read 2026-09-18).** Verbatim: _"La web y la app son útiles para gestionar
mi cafetería... agiliza pedidos, stock y facturación, y su soporte es excelente"_
(5 stars). And: _"Necesita más ampliación del sistema en una estructura comercial
menos tecnicismos & más facilidades interactivas"_ (5 stars). And: _"Para el
restaurante no hace bien las facturas... Te venden el Fudo y no explican que la app
no factura bien las retenciones de isr"_ (1 star).

## 3. Parrot Software (Mexico)

**No purchase-order object is documented.** The support centre is Helpjuice at
<https://soporte.parrotsoftware.com.mx/es_MX>. Its "inventarios" category holds
"Carga de plantilla de insumos", "Completar plantilla de insumos" and "Receta de
artículo". A search for "orden de compra" returns only POS order-type articles.
**Documented fact** by absence - the category and the help centre search, read
2026-09-18.

| Question                                         | Answer                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Object exists?                                   | **Not verified.** No article and no product-page claim was found                    |
| Surface                                          | The inventory feature lives in the "portal-administrador" (web back office)         |
| Generated or hand-made?                          | Evidence covers recipe and insumo templates, not replenishment                      |
| CFDI/XML import?                                 | **Not verified**                                                                    |
| Statuses, in Spanish                             | **Not verified**                                                                    |
| Ordered price vs invoiced price, and cost update | **Not verified**                                                                    |
| Accounting link                                  | Parrot's public content covers menu, KDS and POS. A fiscal link is **not verified** |

**Inference.** Parrot sells a POS with recipe-level inventory. The absence of a
purchase-order article, while it documents insumo templates, is consistent with a
product that stops at consumption and does not close the order-to-receipt loop.

## 4. PoloTab (Mexico)

**The object exists, and the vendor now advertises automatic generation.** The page
<https://www.polotab.com/inventarios> lists four inventory features. Verbatim:
_"Recetas dinámicas ... Costeo inteligente ... Transferencias ... **Órdenes de
compra**. **Genera órdenes automáticamente y evita quiebres.**"_ The FAQ on the same
page asks _"¿Genera órdenes de compra y transferencias entre sucursales?"_
**Documented fact**, fetched 2026-09-18. Capture:
`mx-polotab-inventarios-ordenes-compra.png`.

| Question                                         | Answer                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Object exists?                                   | **Yes** - "Órdenes de compra"                                                                                             |
| Surface                                          | The admin portal. PoloTab is a web-first product; the support portal is `polotab.com/soporte`                             |
| Generated or hand-made?                          | The page says generation is automatic ("Genera órdenes automáticamente"). The input is not stated                         |
| CFDI/XML import?                                 | **Not verified.** The module list names "Facturación" and "Facturación global", not a supplier-CFDI import                |
| Statuses, in Spanish                             | **Not verified**                                                                                                          |
| Ordered price vs invoiced price, and cost update | "Costeo inteligente" and "Costos de tus productos" are documented. A price comparison is **not verified**                 |
| Accounting link                                  | "Facturación" and "auto facturación a clientes" are documented for sales. A supplier-side fiscal link is **not verified** |

PoloTab documents one receiving warning: a support article asks _"¿Por qué no me
cuadra el inventario o el ingreso no se refleja bien?"_ The word _ingreso_ is the
receiving step. **Documented fact**, PoloTab support, Inventarios category.

## 5. National Soft, the other products

**On The Minute**, the National Soft canteen product, does **not** document a
purchase order. Its user manual (version 4.5, PDF linked from
<https://www.ontheminute.com.mx/documentacion/manuales>) holds no "orden de compra"
and no supplier-to-stock chain. Its "Registrar entrada" and "Registrar salida" are
student attendance, not merchandise. **Documented fact** - the manual text, read
2026-09-18.

**Warning - the National Soft web estate is partly broken.** `nationalsoft.com.mx`
serves a Joomla page with third-party casino links; `/softrestaurant` answers HTTP
403; `academia.nationalsoft.mx` and `softfacturas.com.mx` do not resolve.
**Documented fact**, the route log at the end of this file.

**Inference.** SoftRestaurant is the only National Soft product with a documented
procurement chain. The rest of the catalogue is a separate product line with its
own and weaker public evidence.

## 6. Revo and Wansoft, the other Mexican and Iberian POS

### Revo XEF

**The object exists, with partial receipts.** Article "Compras",
<https://support.revo.works/es/articles/27>. Verbatim: _"La **gestión de compras**
de Revo XEF te ayuda a completar el ciclo de Inventario, desde que haces una orden
de compra hasta que la recibes, añades al stock y vendes o usas para cocinar."_
The module menu is "1. PROVEEDORES, 2. ÓRDENES DE COMPRA, 3. PRODUCTOS, 4.
UNIDADES". The enable dialog says, verbatim: _"Este módulo te permite gestionar tus
órdenes de compra. Crea distribuidores, asigna productos y precios de coste, y
recibe productos en tus almacenes de forma flexible, ya sea parcial o total."_
**Documented fact**, fetched 2026-09-18. Capture:
`mx-revo-ordenes-de-compra.png`.

So Revo: order object yes, supplier price of cost yes, partial or total receipt
yes. CFDI import and statuses: **not verified**.

### Wansoft (now by Clip)

**The suggestion exists; the help centre does not document the order.** Wansoft's
own blog, <https://wansoftpos.com/blogpdv/orden-de-compra-sugerida> (2021-02-05),
says verbatim: _"Una orden de compra sugerida se realiza con base en ciertos
criterios, como lo son el **punto de reorden** o estadísticas guardadas en tu
sistema. En Wansoft tenemos la opción de sugerencia."_ **Documented fact**,
fetched 2026-09-18. Capture: `mx-wansoft-orden-compra-sugerida.png`.

The Wansoft help centre, <https://soporte.wansoft.net/hc/es-419>, documents a full
inventory configuration ("Alta de un proveedor", "Creación de un almacén",
"Creación de una presentación", unidades de medida) and no "orden de compra"
article. **Documented fact** by absence.

## 7. Loyverse (Spanish LatAm)

**Loyverse has the best-documented purchase order of the eight, and it is a paid
tier of the web Back Office.** Article "Cómo Trabajar con Órdenes de Compra y
Proveedores",
<https://help.loyverse.com/es/help/how-purchase-orders-and-suppliers>. Verbatim:
_"Las órdenes de compra forman parte de la **Gestión avanzada de inventario** y
requieren una suscripción activa."_ Capture: `mx-loyverse-po-article-es.png`.

| Question                                         | Answer                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Object exists?                                   | **Yes** - "Órdenes de compra", with a "Proveedores" list                                                                                                                                                                                    |
| Surface                                          | The web Back Office, "Gestión de inventario → Órdenes de compra". Not the POS                                                                                                                                                               |
| Generated or hand-made?                          | Both. Hand-made, or by **autofill** from low stock                                                                                                                                                                                          |
| CFDI/XML import?                                 | **No CFDI.** A CSV import of items exists, not an XML import                                                                                                                                                                                |
| Statuses, in Spanish                             | **Borrador, Pendiente, Recibido parcialmente, Cerrado.** **Documented fact**, the same article's status table                                                                                                                               |
| Ordered price vs invoiced price, and cost update | No ordered-vs-invoiced comparison. On receipt the average cost updates: _"los niveles de existencias y el **coste medio** de cada artículo se actualizarán automáticamente en función del precio de suministro especificado en el pedido."_ |
| Accounting link                                  | **No.** Loyverse is a POS with a Back Office. No fiscal hand-off is documented                                                                                                                                                              |

**The autofill formula is the clearest replenishment rule in the whole pass.**
Article "Autorelleno de los artículos en la Orden de Compra",
<https://help.loyverse.com/es/help/autofill-items-purchase-order>. Verbatim:
_"Cantidad = **Stock óptimo** - En stock - Stock entrante"_, and _"la cantidad de
artículos no recibidos de otras órdenes de compra en estado 'Pendiente', 'Recibido
parcialmente' y órdenes de transferencia en estado 'En tránsito'"_. The two inputs
are "Inventario bajo" and "Stock óptimo". Capture:
`mx-loyverse-autofill-po-es.png`. Two more documented facts: the low-stock email
runs daily at 10:00, and landed costs ("costes adicionales") are apportioned at
receipt, including a partial receipt.

**Operator voice (App Store Mexico, app id 1070865387, 4.37 average from 342
ratings).** Verbatim: _"Es buena la app pero no se van quitando las cosas del
inventario cuando haces ventas"_ (4 stars). And: _"Me parecía excelente, pero hace
dos semanas al hacer las ventas ya no está descontando los productos en el
inventario"_ (4 stars). The complaints are about stock deduction, not the order.

## 8. Bsale, Alegra, Bind ERP, Aspel/Siigo - the invoicing-first group

These products a Mexican cafe may already run beside or instead of a POS. The four
split cleanly into "reference only" and "real purchase module".

### Bsale - reference only

Article "Agregar Documento de Referencia / Orden de Compra",
<https://ayuda.bsale.io/support/solutions/articles/151000212409-agregar-documento-de-referencia-orden-de-compra>.
The "orden de compra" is a **tipo de documento de referencia** that the operator
attaches to a sales document. **Documented fact**, fetched 2026-09-18. So Bsale
holds the OC number as a reference field, not as an inventory object.

### Alegra - informational only

Article "Órdenes de Compra a Proveedores",
<https://ayuda.alegra.com/int/%C3%B3rdenes-de-compra-a-proveedores>. Verbatim:
_"Este es un documento de control que **no genera movimientos de tu inventario, ni
de las cuentas contables** de compras o cuentas por pagar, es de carácter
informativo e indica las cantidades solicitadas y pendientes por recibir."_ The
route is "Gastos > Órdenes de compra > Nueva orden de compra". **Documented fact**,
fetched 2026-09-18. A second article documents a free-text "Referencia" field that
_"no forma parte del CFDI"_. **Source-backed tradeoff** - Alegra keeps the order
apart from the ledger on purpose.

### Bind ERP - a real purchase module

Article "Pantalla Órdenes de Compra",
<https://ayuda.bind.com.mx/hc/es/articles/360001715933-pantalla-%C3%B3rdenes-de-compra>.
Verbatim: _"El módulo de Órdenes de Compra tiene como finalidad replicar en la
plataforma Bind todos los pedidos realizados a proveedores... - Crear Órdenes de
compra - **Verificar recepciones de material**... - Descargar archivos... .pdf -
Exportar un respaldo... .csv"_. The route is "compras → Ordenes de compra".
**Documented fact**, fetched 2026-09-18.

### Aspel (now Siigo) - a real purchase module, documentary first

Article "Elaborar orden de compra",
<https://siigonubeportaldeclientes.aspel.com.mx/elaborar-orden-de-compra/>.
Verbatim: _"Elaborar una orden de compra te permite formalizar la solicitud de
productos o servicios a un proveedor antes de realizar la adquisición."_ The route
is "+ Crear → Proveedores → Orden de compra", or "Compras y gastos → Documentos de
compras y gastos → Nuevo documento compra / gasto – Orden de compra".
**Documented fact**, fetched 2026-09-18. `aspel.com.mx` now redirects to
`siigo.com/mx`.

---

## The comparison grid

"OC" means the product's own word for the purchase-order document.

| #   | Product                       | OC object                                                    | Surface                         | Starts from                                                                      | Supplier CFDI/XML import and auto-link                                                                    | Statuses in Spanish                                     | Ordered vs invoiced price, and cost                                  | Accounting link                                            |
| --- | ----------------------------- | ------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | SoftRestaurant                | **Yes**, "Órdenes de compra"                                 | Desktop back office (`Almacén`) | Min/max generation is **not verified** this pass; email generation is documented | **Yes** - "Importación de compras por XML con vinculación automática de insumos"; exact-description match | **Not verified**                                        | XML price fields are imported. Ordered-vs-invoiced: **not verified** | **Yes** - "Cuenta contable" field, plus the ERP/PSM module |
| 2   | Fudo                          | **No** - a purchase is a _gasto_                             | Web back office                 | Hand-made                                                                        | **No CFDI**; "Recepción IA" reads a photo or PDF; supplier-invoice docs are Argentina-only                | "Estados de Gastos"                                     | **Not verified**                                                     | Cuentas corrientes de proveedores                          |
| 3   | Parrot                        | **Not verified**                                             | Admin portal                    | **Not verified**                                                                 | **Not verified**                                                                                          | **Not verified**                                        | **Not verified**                                                     | **Not verified**                                           |
| 4   | PoloTab                       | **Yes** - "Órdenes de compra"                                | Admin portal                    | Automatic ("Genera órdenes automáticamente")                                     | **Not verified**                                                                                          | **Not verified**                                        | Product costing is documented; comparison **not verified**           | Sales fiscal only; supplier side **not verified**          |
| 5   | On The Minute (National Soft) | **No**                                                       | Desktop                         | Hand-made                                                                        | **No**                                                                                                    | **Not verified**                                        | **Not verified**                                                     | **Not verified**                                           |
| 6a  | Revo XEF                      | **Yes** - "ÓRDENES DE COMPRA"                                | Back office or Revo STOCK       | **Not verified**                                                                 | **Not verified**                                                                                          | **Not verified**                                        | Supplier "precios de coste" and partial/total receipt                | **Not verified**                                           |
| 6b  | Wansoft                       | The suggestion is documented; the object is **not verified** | Back office                     | **Punto de reorden**                                                             | **Not verified**                                                                                          | **Not verified**                                        | **Not verified**                                                     | **Not verified**                                           |
| 7   | Loyverse                      | **Yes** - "Órdenes de compra"                                | Back Office (paid tier)         | Hand-made or autofill from low stock                                             | **No CFDI**; CSV item import only                                                                         | **Borrador, Pendiente, Recibido parcialmente, Cerrado** | Average cost updates at receipt; comparison **not verified**         | **No**                                                     |
| 8a  | Bsale                         | **No** - a reference document                                | Web                             | Hand-made                                                                        | **Not verified**                                                                                          | **Not verified**                                        | **Not verified**                                                     | Invoicing-first                                            |
| 8b  | Alegra                        | **Yes**, but informational                                   | Web                             | Hand-made                                                                        | **No** - the reference is not part of the CFDI                                                            | **Not verified**                                        | **No** inventory movement                                            | Explicitly no ledger movement                              |
| 8c  | Bind ERP                      | **Yes**                                                      | Web                             | **Not verified**                                                                 | **Not verified**                                                                                          | **Not verified**                                        | Receipt verification is documented                                   | ERP                                                        |
| 8d  | Aspel/Siigo                   | **Yes**                                                      | Web                             | Hand-made                                                                        | **Not verified**                                                                                          | **Not verified**                                        | Document of compras y gastos                                         | ERP                                                        |

## Where the sources disagree

1. **PoloTab against the prior Umi pass.** The prior pass records PoloTab
   procurement as "partial". The vendor now advertises automatic purchase-order
   generation. The vendor page is newer. **Documented fact** on both sides.
2. **SoftRestaurant against itself.** The marketing page sells a full procurement
   chain. The ERP article says the shop that owns an ERP should do the purchases
   **in the ERP** and leave SoftRestaurant as the point of sale: _"la idea general
   de la integración es que SoftRestaurant® utilice solo las funciones de punto de
   venta y las funciones administrativas sean realizadas en el ERP"_. **Documented
   fact.** The procurement depth is real for the shop with no ERP, and a duplicate
   for the shop with one.
3. **Alegra against Bind.** Both are invoicing-first. Alegra states its order moves
   no inventory and no payable. Bind ships a receipt-verification screen. The word
   "orden de compra" means two different things in the two products. **Source-backed
   tradeoff.**

## The shared pattern, and the Umi gap

**Inference, with the evidence above.** Across eight groups:

- **The object is real for five:** SoftRestaurant, PoloTab, Revo, Loyverse, Bind.
- **The order lives in the web back office every time.** No product puts the
  purchase order on the POS terminal. That answers the placement question the
  requester asked: the POS is the wrong surface for this object, and the market
  agrees.
- **Only one product reads the supplier CFDI/XML into stock: SoftRestaurant.** For
  a Mexican cafe, this is the capability that keeps the ingredient price current,
  and it is the one the market leaves open.
- **Only one product states the replenishment formula: Loyverse** (`Stock óptimo -
En stock - Stock entrante`). Wansoft names the reorder point. SoftRestaurant's
  min/max rule is from the prior pass and is **not verified** here.
- **The minimum viable state set is Loyverse's four:** Borrador, Pendiente,
  Recibido parcialmente, Cerrado. Umi's schema already holds all five of its own
  states (`received`, `draft`, `sent`, `cancelled`, `partially_received`), which is
  a superset.

**The gap for Umi.** Umi's server already models the whole chain, and no screen
creates the order (see [2026-09-18-purchase-orders-gap.md](../2026-09-18-purchase-orders-gap.md)).
The Mexico and LatAm market shows three design constraints for the screen:

1. Put it in the web dashboard, never in the POS.
2. Start it from the shortage. The Loyverse formula and the Wansoft reorder point
   are the two documented precedents.
3. Read the supplier CFDI/XML into the receipt, and update the item cost from it.
   SoftRestaurant is the only regional competitor that does this, and it is the
   capability the specialist products (lane 2) also treat as the close of the loop.

**Runner-up to reject.** A pure "informational order" model, as Alegra ships it, is
the runner-up. It is the smaller build. Reject it because it does not update the
item cost, and the cost is the number the recipe module depends on. The SoftRestaurant
receipt path is the model to take.

## Operator voices in Spanish

| Product                                      | Source                      | Verbatim                                                                                                             | Sense                                                          |
| -------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Fudo                                         | App Store MX, id 1137158486 | _"agiliza pedidos, stock y facturación, y su soporte es excelente"_                                                  | Stock and billing flow well                                    |
| Fudo                                         | App Store MX, id 1137158486 | _"Necesita más ampliación del sistema en una estructura comercial menos tecnicismos & más facilidades interactivas"_ | The product is too technical and needs more business structure |
| Fudo                                         | App Store MX, id 1137158486 | _"la app no factura bien las retenciones de isr"_                                                                    | The Mexico tax case is weak                                    |
| Loyverse                                     | App Store MX, id 1070865387 | _"no se van quitando las cosas del inventario cuando haces ventas"_                                                  | Stock deduction fails on sale                                  |
| SoftRestaurant, PoloTab, Revo, Wansoft, Bind | -                           | No purchase-order review was found in Spanish on a review site                                                       | **Not verified** - G2, Capterra and GetApp answer 403          |

## Route-failure log

| Host                                                       | Route                            | Result                                                                          |
| ---------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| `softrestaurant.com.mx`                                    | `curl`, then Playwright Chromium | `ERR_SSL_PROTOCOL_ERROR` / curl exit 000                                        |
| `www.softrestaurant.com.mx`                                | `curl -L`                        | HTTP 301 to `softrestaurant.com.mx`, then 000                                   |
| `ayuda.softrestaurant.com.mx`, `soporte.`, `conocimiento.` | `curl`                           | DNS failure, curl 000                                                           |
| `academia.nationalsoft.mx`, `softfacturas.com.mx`          | `curl`                           | DNS failure, curl 000                                                           |
| `nationalsoft.com.mx/softrestaurant`                       | `curl`                           | HTTP 403                                                                        |
| `nationalsoft.com.mx`                                      | `curl`                           | HTTP 200, a Joomla page with casino spam links                                  |
| `ayuda.fudo.app`, `soporte.fudo.app`, `help.fudo.app`      | `curl`                           | DNS failure, curl 000                                                           |
| `fudo.app/ayuda`                                           | `curl`, then `r.jina.ai`         | JS redirect to `/lander`; jina returns a Cloudflare challenge                   |
| `soporte.fu.do/api/v2/help_center`                         | `/articles/search.json`          | HTTP 404 - Intercom, not Zendesk (`x-intercom-version` header)                  |
| `help.loyverse.com/api/v2/help_center`                     | `/es/articles/search.json`       | HTTP 404 - not Zendesk                                                          |
| `help.loyverse.com`                                        | `r.jina.ai`                      | Cloudflare "Just a moment..." challenge. Rendered fine in Chromium              |
| `parrotsoftware.zendesk.com/api/v2/help_center`            | `/es/articles/search.json`       | `count` is null for four queries; not the live API                              |
| `parrotsoftware.com.mx` blog                               | `curl`, then `r.jina.ai`         | Empty body; jina hits a Cloudflare challenge                                    |
| `soporte.wansoft.net/api/v2/help_center`                   | `/es-419/articles/search.json`   | `count` is null; the HTML search page answers                                   |
| `bind.com.mx`                                              | `curl`                           | LiteSpeed bot verification                                                      |
| `bind.com.mx/company-acquisition`                          | not applicable                   | -                                                                               |
| `web.archive.org` CDX for `softrestaurant.com.mx`          | `/cdx/search/cdx`                | HTTP 200, empty result set                                                      |
| G2, Capterra, Trustpilot, GetApp                           | -                                | HTTP 403 (known block, per `channels.md`)                                       |
| `duckduckgo.com`                                           | `curl`                           | Bot challenge. Chromium over CDP works, and it is the discovery route used here |

## What is not verified, and what to do next

1. **SoftRestaurant's min/max generation wording.** The prior pass asserts it; this
   pass could not find it on a live page. Find it in the SR12 user manual or the
   Academia portal (`academia.softrestaurant.com`, which resolved).
2. **Order statuses for SoftRestaurant, PoloTab, Revo and Parrot.** Only Loyverse
   publishes a status table.
3. **A PoloTab order screen.** The capture is the Inventarios page and its FAQ. The
   feature cards are inside a JavaScript carousel and did not photograph this pass.
4. **A screenshot of the SoftRestaurant "Órdenes de compra" editor.** The capture is
   the "Compras desde CFDI" screen. The order editor itself is **not verified**.
5. **A Spanish purchase-order review.** The review sites are blocked. The vendor
   community, a Facebook group, or a YouTube walkthrough is the next route.
