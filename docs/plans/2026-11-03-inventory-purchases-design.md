# Compras manuales y comprobantes opcionales

## Alcance aprobado

El propietario registra compras con fecha, artículos, cantidades y costos.
Puede adjuntar una foto, usar el XML existente o guardar sin comprobante.
El usuario aprobó continuar desde la última `staging`.
La entrega usa `feat/inventory-purchase-entry`, basada en `origin/staging`.
Los commits son atómicos. Un solo PR entra en `staging` y queda abierto para aprobación.

## Pantalla

Compras ofrece `Registrar compra` y conserva `Subir factura XML`.
El formulario incluye fecha de compra, lugar donde entra el inventario y filas de artículos.
Cada fila tiene artículo, cantidad, unidad del artículo y costo por unidad.
El proveedor, la referencia, la nota y la foto son opcionales.
El formulario permite agregar y quitar filas. Rechaza artículos repetidos.
Muestra el importe por fila y el total antes de confirmar.
`Revisar compra` precede a `Guardar compra`. `Cancelar` antes de guardar no escribe nada.
Al guardar, la compra aparece en la lista y las existencias y costos se actualizan.
Una compra registrada conserva sus datos y su comprobante.

Una foto sirve como comprobante. El propietario captura y revisa los datos.
El formulario muestra la foto antes de guardar y permite quitarla.
Los comprobantes guardados se consultan con `Ver comprobante`.
Los textos usan español sencillo y Lingui. El formulario funciona en móvil y con teclado.

El flujo XML conserva su interpretación y cotejo actuales.
Después de revisar los artículos, el propietario puede registrar la compra directamente.
La opción actual de recibir contra un pedido existente también sigue disponible.
La compra directa recibe todas las líneas revisadas del XML; una línea sin artículo bloquea la operación completa.

## Modelo y escritura

Se reutilizan ProcurementService/Repository, el diario de comandos y el libro de inventario.
Se agrega `inventory.purchase.record` para una compra capturada manualmente.
Se agrega `inventory.invoice.receive_direct` para recibir una factura ya capturada y cotejada.
Ambos requieren `inventory.invoice.approve` y el contexto administrativo del dashboard.
Se conservan los controles de negocio, sucursal, permisos y disponibilidad de artículos.

Una transacción crea la evidencia de la compra y un pedido interno de origen `direct_purchase`.
Luego ejecuta el envío y la recepción con los métodos existentes del repositorio.
El propietario no tiene que crear ese pedido. Este recorrido no envía mensajes al proveedor.
El saldo final en tránsito queda igual que antes; la existencia aumenta una sola vez.
Las líneas recibidas conservan el vínculo con la factura para calcular los costos actuales.
Una excepción revierte factura, pedido, recepción y movimientos de esa operación.

Una migración nueva agrega `purchase_order.origin`, con valor inicial `order`.
Permite `supplier_id` nulo únicamente cuando el origen es `direct_purchase`.
El comando normal de pedido sigue exigiendo un proveedor activo.
Los contratos de lectura permiten proveedor nulo. Las consultas usan un left join con alcance de negocio.
La ausencia se muestra como `Sin proveedor`; no crea una empresa ficticia.
Los archivos de migración ya aplicados permanecen intactos.

La fecha seleccionada se guarda en `supplier_invoice.issued_on` como fecha de compra.
La fecha de captura y el día operativo de la recepción conservan sus reglas actuales.
Esto registra la fecha del documento sin reescribir movimientos históricos.

## Contratos

`RecordInventoryPurchaseRequest` contiene `commandId`, `idempotencyKey`, `locationId`, `inventoryLocationId`,
`issuedOn`, `currency`, `supplierId` opcional/nulo, `folio` opcional/nulo y `note` opcional/nulo.
Contiene `lines`, con `inventoryItemId`, `quantity` y `unitCostMinor`.
Puede incluir `artifactBase64`. El servidor determina `manual` o `photo` por la presencia del comprobante.
El servidor obtiene los nombres de artículos; el cliente no decide la identidad mediante nombres.
El total se calcula con `extendedLineTotalMinor` y `receiptTotalMinor`.
Los impuestos manuales quedan en cero; el costo capturado es el costo declarado para inventario.

`ReceiveSupplierInvoiceDirectRequest` contiene identidades, factura, sucursal, destino y nota opcional.
El servidor carga y bloquea la factura. Usa todas sus líneas, cantidades y precios guardados.
Rechaza facturas vacías, sin cotejar, ya registradas o de otro negocio/sucursal.
Ambos comandos responden con `commandId`, `supplierInvoice` y `correlationId`.

Un GET de contexto devuelve sucursal, moneda, fecha actual del negocio y destinos activos de inventario.
No llama a `inventory.overview`, porque ese recorrido puede vencer reservaciones.
Los artículos y proveedores se leen mediante sus páginas existentes, con negocio explícito y catálogos completos.
Un fallo de lectura impide revisar una compra con referencias incompletas.

`SupplierInvoice` agrega `hasArtifact` como metadato, sin incluir bytes en listas o resultados del diario.
Un GET de comprobante devuelve tipo permitido y base64, bajo autenticación y alcance del negocio.
Una factura ajena o sin comprobante responde sin revelar datos de otro negocio.

## Límites y exactitud

- Máximo 100 artículos por compra; todos activos y distintos.
- Cantidad positiva, en la unidad base y con la escala exacta del artículo, hasta seis decimales.
- Costos no negativos en centavos enteros seguros. Los importes escritos admiten hasta dos decimales con punto.
- Se rechazan comas, exponentes, pérdida de precisión y desbordamientos.
- El total de una línea usa el redondeo monetario existente de mitades hacia arriba.
- La foto original admite JPEG, PNG o WebP, hasta 12 MiB.
- El navegador conserva archivos pequeños o ajusta los grandes con las APIs de imagen existentes del navegador.
- La imagen final pesa como máximo 700 KiB y debe seguir legible en la vista previa.
- El JSON administrativo completo, codificado en UTF-8, ocupa como máximo 1 MiB.
- Se conserva el límite HTTP global de 1 MiB; no se amplía el endpoint compartido.
- Se valida el tipo por sus bytes en el servidor. SVG, PDF, HTML y tipos desconocidos se rechazan.
- Si no cabe una foto legible, se pide otra foto y se permite continuar sin adjuntarla.

## Reintentos y contexto

Antes de enviar se conserva un único intento por negocio en sessionStorage.
El intento incluye negocio, sucursal, destino, contenido e identidades exactas.
Una falla de almacenamiento bloquea el envío.
Un resultado desconocido conserva el intento y permite repetir solamente la misma solicitud.
Un resultado exitoso no se vuelve a enviar.
Cerrar, recargar o cambiar de negocio no convierte una respuesta perdida en una compra nueva.
Los resultados se guardan para el negocio original; no actualizan listas del negocio nuevo.
Una solicitud en curso puede terminar. Los cambios de contexto detienen las operaciones que todavía no comenzaron.
Las pestañas tienen diarios independientes. Al terminar se elimina la foto temporal del intento.

## Verificación

Contratos, migración y repositorio se prueban con entradas reales y PostgreSQL aislado.
Se verifica compra sin proveedor ni comprobante, compra con foto y recepción directa de XML cotejado.
Se comparan existencias, tránsito, líneas de recepción, costos y número de movimientos antes y después.
Los reintentos y solicitudes concurrentes crean una sola recepción.
Se prueba rollback completo ante un artículo inválido y el rechazo de referencias de otro negocio.
Una prueba HTTP real comprueba el límite de 1 MiB y la consulta privada del comprobante.
El navegador comprueba captura, cancelación, revisión, guardado, recuperación, foto legible, móvil y teclado.
El resto del plan general conserva días de compra, pronóstico y avisos para fases posteriores.

## Fuentes y decisiones

La investigación usa código del repositorio y documentación oficial instalada.
Ver [investigación](../research/2026-11-03-inventory-purchase-entry-research.md).
Se elige un pedido interno con proveedor opcional para conservar la recepción y el cálculo de costos existentes.
Se ajusta la foto antes de enviarla para conservar el límite HTTP actual.
La foto ajustada viaja en el mismo comando de compra para guardar todos los hechos en una transacción.
No se agrega un proveedor, servicio de almacenamiento ni extractor de texto externo.
