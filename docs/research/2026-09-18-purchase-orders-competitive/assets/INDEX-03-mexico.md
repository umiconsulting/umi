# Assets index - lane 3, Mexico and Latin America

- Date: 2026-09-18
- Lane: 3 of 5
- Section file: `../sections/03-mexico-latam.md`

All eight captures are rendered pages in the CDP Chromium (Chrome 151,
`--disable-features=LocalNetworkAccessChecks`) that the UX harness owns, attached
over the DevTools Protocol at `127.0.0.1:9333`. The viewport is 1366 x 900 CSS px.
The capture is a viewport screenshot unless the note says otherwise. Every file
name carries the `mx-` prefix.

The images are **not committed** in bulk. The `.gitignore` entry at the repository
root excludes a bulk harvest; this index records the source URL and the capture
route so each image is reproducible.

| File                                        | Product        | Source URL                                                                                       | Device class                                     | What it shows                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mx-softrestaurant-precio-inventarios.png`  | SoftRestaurant | <https://softrestaurant.com/soft-restaurant-precio>                                              | Desktop web, vendor marketing                    | The Soft Restaurant 12 feature table, "Nuevo" tab, with the line "Importación de compras por XML con vinculación automática de insumos" and its green check                                                                                                                                                    |
| `mx-softrestaurant-compras-cfdi.png`        | SoftRestaurant | <https://softrestaurant.zohodesk.com/portal/es/kb/articles/manual-de-usuario-compras-desde-cfdi> | Desktop web, help article (product image inside) | The "Compras desde CFDI" screen: the invoice-line table (Nombre presentación, Cantidad, Almacén, Costo unitario, Desct. %, Importe, Impuesto, Importe c/Impuesto, Orden), the match checkboxes, the toolbar (Importar cfdi, Guardar, Deshacer, Editar, Cancelar compra), "Cuenta contable" and "Folio factura" |
| `mx-fudo-gastos-y-compras.png`              | Fudo           | <https://soporte.fu.do/es/articles/11730876-registro-de-gastos-y-compras-en-fudo>                | Desktop web, help article (product image inside) | The article that defines a purchase as a _gasto_, with the "Sección 'Gastos'" nav and a screenshot of the Fudo "Nuevo gasto" form and its "Estado del pago" column                                                                                                                                             |
| `mx-polotab-inventarios-ordenes-compra.png` | PoloTab        | <https://www.polotab.com/inventarios>                                                            | Desktop web, vendor marketing                    | The Inventarios FAQ block with the open question "¿Genera órdenes de compra y transferencias entre sucursales?"                                                                                                                                                                                                |
| `mx-revo-ordenes-de-compra.png`             | Revo XEF       | <https://support.revo.works/es/articles/27>                                                      | Desktop web, help article                        | The "Compras" tutorial: the module order "1. PROVEEDORES, 2. ÓRDENES DE COMPRA, 3. PRODUCTOS, 4. UNIDADES", the cycle sentence, and the module-enable dialog                                                                                                                                                   |
| `mx-wansoft-orden-compra-sugerida.png`      | Wansoft        | <https://wansoftpos.com/blogpdv/orden-de-compra-sugerida>                                        | Desktop web, vendor blog (product image inside)  | The "Generar una orden de compra" form with the "Agregar orden de compra sugerida" button and the Cant / Producto / Presentación / Existencia / UM / Cant. solicitada columns                                                                                                                                  |
| `mx-loyverse-po-article-es.png`             | Loyverse       | <https://help.loyverse.com/es/help/how-purchase-orders-and-suppliers>                            | Desktop web, help article                        | The Spanish article "Cómo Trabajar con Órdenes de Compra y Proveedores" and its walkthrough video poster                                                                                                                                                                                                       |
| `mx-loyverse-autofill-po-es.png`            | Loyverse       | <https://help.loyverse.com/es/help/autofill-items-purchase-order>                                | Desktop web, help article                        | The Spanish article "Autorelleno de los artículos en la Orden de Compra", where the quantity formula is stated                                                                                                                                                                                                 |

## Capture routes that failed

| Host                          | Route                                      | Result                                                                                                                                   |
| ----------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `softrestaurant.com.mx`       | Playwright Chromium `goto`                 | `ERR_SSL_PROTOCOL_ERROR` - the page could not be captured                                                                                |
| `softrestaurant.zohodesk.com` | `curl` on the help article                 | HTTP 200, and the body is in the JSON field `answer`, not `body`; the article page is a React shell                                      |
| `www.polotab.com/inventarios` | scroll to the feature carousel             | The feature cards sit in a JavaScript carousel; four captures landed on the hero, the stats block, and the FAQ. The FAQ capture was kept |
| `help.loyverse.com`           | `r.jina.ai`                                | Cloudflare challenge; the CDP Chromium rendered the page                                                                                 |
| `soporte.fu.do`               | `/es/articles/<id>` with a `body` selector | The Intercom article body is server-rendered inside the page; `curl` then strip tags works, the DOM selector does not                    |

## YouTube

No YouTube frame was used as evidence in this lane. The two video URLs that the
help centres embed are:

- Loyverse, "Cómo Trabajar con Órdenes de Compra y Proveedores en Loyverse", on the
  article `mx-loyverse-po-article-es.png`.
- Wansoft, "Orden de compra sugerida", referenced by the blog article.

A frame was not taken because the rendered article and the vendor text carried the
same claim, and the eight-image budget was full.
