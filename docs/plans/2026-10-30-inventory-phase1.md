# Fase 1: inventario confiable

## Alcance aprobado

Corregir cantidades, unidades, conteos y permisos entre el backend, el dashboard y UmiPOS.
Esta fase conserva los flujos actuales. Los pronósticos, el calendario de compras y los avisos pertenecen a fases posteriores.
La base es `origin/main` en `da664d424dcde754a6f24c6cc84cfb2c056aad1f`.
La rama de trabajo es `fix/inventory-phase1`. La entrega requiere revisión mediante PR; no incluye merge ni despliegue.

## Restricciones

- El backend conserva la autoridad sobre el inventario.
- Las cantidades del contrato son enteros seguros con escala y unidad explícitas.
- Las conversiones deben ser exactas. Una cantidad incompatible se rechaza antes de registrar movimientos.
- Cada corrección debe tener una prueba que reproduzca el fallo antes del cambio.
- Los movimientos conservan su aislamiento por merchant, autorización, control de versión e idempotencia.
- Las verificaciones usan datos locales. No se modifica producción ni se envían avisos.
- Los cambios locales del checkout original permanecen fuera de esta rama.

## Tareas

### 1. Cantidades y recetas del dashboard

Propietario: pantallas y modelos de inventario del dashboard.

- Reproducir el ajuste de 2.5 a 3.25 unidades con escala 2: el movimiento debe aumentar 75 unidades internas.
- Cubrir disminuciones, cero, coma decimal, precisión excesiva y existencia actualizada al abrir el ajuste.
- Conservar la cantidad y la conversión al abrir, editar y guardar una receta existente.
- Reutilizar los modelos existentes y probar las interacciones con clics en Chromium.

### 2. Conteos del backend

Propietario: `pos-inventory`, su contrato y sus pruebas.

- Reproducir el bloqueo de un conteo cuando cambia el inventario durante la sesión.
- Conservar el rechazo de una conciliación obsoleta.
- Proporcionar una recuperación explícita y autorizada que permita volver a contar sin sobrescribir movimientos posteriores.
- Verificar atomicidad, concurrencia, permisos y reintentos.
- Coordinar cualquier cambio del contrato antes de modificar los clientes.

### 3. Lectura y permisos de UmiPOS

Propietario: controlador y superficie de inventario del POS.

- Reproducir el acceso de un operador que tiene `inventory.read` pero carece de `inventory.history.read`.
- Permitir la consulta autorizada del inventario y conservar la restricción del historial.
- Mostrar los errores reales de lectura y conservar los flujos de ajuste y aprobación.
- Verificar pruebas de Flutter y la superficie nativa cuando cambie su interacción.

### 4. Escalas de compras y recepciones

Propietario: repositorio y pruebas de `procurement`.

- Reproducir una orden y una recepción con escalas distintas para una misma cantidad física.
- Normalizar a la escala del artículo antes de comparar pendientes o registrar movimientos.
- Rechazar unidades incompatibles y conversiones no exactas antes de cualquier escritura.
- Verificar recepciones parciales, límites de recepción, costos e idempotencia en PostgreSQL.

### 5. Revisión y entrega

- Revisar el alcance y la calidad de cada corrección.
- Ejecutar pruebas, compilación, tipos y verificaciones de PR aplicables.
- Ejecutar las verificaciones de interfaz afectadas y conservar evidencia de sus límites.
- Actualizar contra la rama de destino si cambia durante el trabajo.
- Entregar el PR y el resumen de validación. La integración requiere una decisión posterior.

### 6. Textos y formulario de artículos

El usuario solicita términos sencillos y muestra campos y botones desalineados durante la prueba local.

- Sustituir «Par» y explicaciones sobre la API o la escala interna por lenguaje cotidiano.
- Mostrar y capturar la cantidad mínima y la cantidad objetivo en la unidad del artículo, con conversión exacta al contrato.
- Presentar las conversiones como equivalencias entre cantidades y unidades.
- Alinear los controles y evitar solapamientos en escritorio y móvil.
- Verificar guardado, reapertura y cantidades existentes con clics reales.

## Criterio de cierre

Las regresiones reproducidas pasan con la corrección. Las pruebas existentes de los módulos afectados permanecen verdes.
Los flujos visibles modificados tienen evidencia de ejecución. Toda limitación pendiente se informa antes de integrar.

## Pendiente para el siguiente PR: productos existentes y consumo

El editor permite crear una receta para un producto o variante existente.
La creación actual no inserta `inventory_catalog_mapping`; el checkout depende de ese vínculo.
Completar la conexión entre receta y consumo requiere una prueba de venta completa, con actualización y retiro de receta.
Este paso debe quedar listo antes de pronósticos. No se da por implementado en esta fase.
Fuentes: `InventoryAuthoringRepository.createRecipe` y `PosCheckoutRepository.negativeStockApprovalRequired`.

## Solicitudes añadidas para las siguientes fases

Estas solicitudes se registran durante la implementación de la fase 1. Su implementación va en PRs posteriores.

### Plantilla e importación de artículos

- Descargar una plantilla Excel o CSV con ejemplo y campos documentados.
- Identificar cada artículo por referencia estable dentro del negocio.
- Incluir nombre, tipo, unidad y escala; definir después los campos opcionales de reposición y proveedor.
- Mostrar una vista previa por fila con nuevos artículos, actualizaciones, duplicados y errores.
- Confirmar el lote antes de guardar; conservar un resultado descargable y permitir reintentos sin duplicar registros.
- Registrar las existencias iniciales mediante movimientos autorizados, con almacén explícito; no modificar directamente los saldos.

### Plantilla e importación de recetas

- Una fila por ingrediente, agrupada por producto o variante existente y receta.
- Campos: referencia del producto, variante opcional, rendimiento y unidad de rendimiento, referencia del ingrediente, cantidad y unidad.
- Validar referencias, unidades, precisión, conversiones exactas y consistencia del rendimiento entre filas.
- Mostrar si cada receta se creará o actualizará. Rechazar recetas incompletas y preservar versiones e historial.
- Guardar cada receta completa de forma atómica. La confirmación debe describir las recetas aceptadas y las rechazadas.
- Completar primero el vínculo entre receta y descuento al vender; probar una venta después de importar.

### Fotos de tickets y recibos en compras

- Mantener XML CFDI y agregar fotos desde cámara/archivo. PDF es una extensión propuesta que requiere validación del formato.
- Asociar el comprobante al negocio, compra y recepción, con vista previa y descarga autorizada.
- El contrato y el backend ya contemplan source=photo y artifactBase64; la pantalla actual acepta solo XML.
- Completar el flujo de consulta del archivo y captura manual de conceptos; subir una foto por sí solo no registra existencias.
- Evaluar lectura automática como etapa adicional; el usuario confirma artículos, cantidades, unidades y precios antes de registrar movimientos.
- Validar tamaño y contenido del archivo, acceso por negocio, duplicados y auditoría.

Fuentes locales: `SupplierInvoiceUploadRequest`, `ProcurementService.uploadSupplierInvoice` y `invoice-inbox.jsx`.

### Flujo de captura de costo observado durante la revisión

El botón que decía «Poner costo» abre `/inventory/costos` sin conservar el artículo seleccionado.
La fase 1 cambia su nombre a «Ver costos» para describir la acción real.
Esa pantalla muestra costos y márgenes. El costo actual procede de recepciones de compra.
Se propone conectar la acción con una recepción que ya tenga el artículo seleccionado y regresar a la lista al guardar.
Esta mejora queda pendiente para el flujo de compras; no se implementa en la fase 1.

### Preparar directamente desde una receta

La pestaña Preparación del dashboard muestra sugerencias y permite imprimir etiquetas. No registra una preparación.
El POS y el backend ya registran preparaciones de artículos con receta: descuentan ingredientes y suman el artículo producido.
Agregar una acción «Preparar» en el dashboard requiere elegir la cantidad, revisar ingredientes y confirmar el movimiento.
La acción debe estar disponible aunque el artículo no tenga una cantidad objetivo.

Antes de ampliar las sugerencias, revisar su cálculo con una prueba de demanda creciente.
Actualmente `prepList` usa `par - onHand - forecastUsage`, lo que reduce la cantidad sugerida cuando aumenta el consumo previsto.
Este cálculo básico también debe distinguirse del futuro pronóstico según los días de compra del negocio.
