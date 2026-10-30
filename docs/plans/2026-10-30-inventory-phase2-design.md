# Fase 2: recetas y ventas

La fase 2 conecta las recetas con el descuento de ingredientes al vender productos existentes.
El usuario autorizó continuar por fases y dejar el PR #232 pendiente de aprobación.

## Comportamiento

- Guardar una receta de producto o variante conecta esa receta con las ventas siguientes.
- Guardar una receta de artículo conserva su uso para preparación. No crea una conexión con ventas.
- Una receta existente sin conexión se conecta cuando el propietario la guarda de nuevo.
- Si ya hay una receta activa para el mismo producto o variante, el propietario debe editarla. Crear otra no retira la anterior.
- Crear una receta después de retirar la anterior continúa su número de versión.
- Si el producto o variante ya tiene otra configuración de inventario, guardar devuelve un conflicto explicable.
- La pantalla permite cancelar o confirmar el reemplazo exacto de esa configuración. No se reemplaza de forma silenciosa.
- La confirmación contiene el identificador y la versión de la configuración encontrada. Un cambio posterior invalida la confirmación.
- Actualizar una receta conserva su versión anterior y registra una nueva versión de la conexión.
- Retirar una receta desactiva únicamente las conexiones que la usan. Conserva las recetas y los movimientos anteriores.
- Las ventas posteriores siguen la regla actual: variante específica, después receta del producto. Sin configuración válida, caja rechaza la venta con inventario.
- Una devolución usa el consumo de la venta original, aunque la receta cambie después.
- Editar el precio o nombre de un producto conserva su receta. El campo vacío heredado de artículo no desactiva una receta.
- Cambiar una receta por un artículo desde el editor de producto se rechaza con un mensaje útil. El propietario debe retirar primero la receta.
- El selector de recetas incluye productos existentes y todas sus variantes activas, aunque nunca hayan tenido una receta.

## Implementación

Se usan los comandos administrativos y las tablas actuales. No se agrega otro sistema de inventario.
La receta y su conexión se guardan en una transacción. El bloqueo de la fila del producto coordina receta y catálogo.
El catálogo ya bloquea esa fila durante una modificación. Los escritores de receta toman ese bloqueo antes de bloquear la receta.
Las versiones anteriores de conexiones conservan el identificador que guardaron las reservas y ventas.

El contrato agrega `replaceSalesMapping: { mappingId, expectedVersion }` como parámetro opcional de creación y actualización.
El error `INVENTORY_RECIPE_MAPPING_CONFLICT` lleva `details.mappingId`, `details.mappingVersion` y `details.mappingType`.
Una confirmación obsoleta devuelve conflicto y conserva todos los datos anteriores.
Crear sobre una receta activa devuelve `INVENTORY_RECIPE_TARGET_INVALID`, con `details.reason=ACTIVE_RECIPE_EXISTS` y `details.recipeId`.
El contrato agrega una consulta paginada `GET /api/merchants/:merchantId/recipe-targets` en el módulo existente.
La consulta usa la autorización de lectura de recetas y el aislamiento por negocio.
El precio del producto más el ajuste de variante se calcula de forma exacta.
Si el resultado es negativo o supera el entero seguro, `priceMinor` es `null`; el selector conserva el producto sin calcular su margen.

## Límites

- No hay activación masiva de recetas antiguas ni cambios en producción.
- La preparación directa, las plantillas, las fotos de compras y los pronósticos continúan en fases posteriores.
- El PR de esta fase apunta a `fix/inventory-phase1` mientras el PR #232 siga pendiente.
- La aprobación del PR y la integración siguen separadas del desarrollo.

## Restricciones globales

- Trabajar solo en `/private/tmp/umi-inventory-phase2-20261030`, rama `feat/inventory-phase2-recipes`.
- No modificar el checkout original, la fase 1 ni su vista de prueba en los puertos 4022 y 4023.
- No integrar PRs, activar auto-merge, modificar producción ni enviar avisos.
- El backend conserva la autoridad; las cantidades usan enteros seguros, escala y unidad explícitas.
- Conservar permisos, aislamiento por negocio, idempotencia y control de versión.
- Usar español sencillo en la interfaz. Las pruebas de interfaz requieren clics reales en Chromium.
- Las pruebas usan PostgreSQL local en 127.0.0.1:55435, base `umi_inventory_phase2`.
- Ejecutar tareas de contrato, lint y tipos de forma secuencial para evitar carreras al reconstruir `dist`.

## Evidencia del diseño

Hecho del código: `createRecipe` no crea la conexión que consulta `reserveInventory`.
Hecho del código: `updateRecipe` modifica la conexión anterior y `retireRecipe` la deja activa.
Hecho del código: `CatalogDialog` envía `inventoryItemId: null` incluso cuando solo cambia el precio.
Hecho del código: el selector usa costos y omite variantes sin conexiones previas.
Inferencia específica de Umi: una transacción y el bloqueo existente del producto son suficientes para coordinar estos escritores.
No se requiere una migración ni un nuevo servicio.

## Verificación

Probar creación, actualización, retiro, reemplazo confirmado y confirmación obsoleta contra PostgreSQL real.
Probar una venta completa por el servicio de checkout y su devolución después de cambiar la receta.
Comprobar reintentos, cantidades exactas, prioridad de variantes y ventas con inventario insuficiente.
Comprobar selección, guardado, cancelación del reemplazo y edición de precio mediante clics en Chromium.
Ejecutar las verificaciones locales del PR y revisar sus resultados de CI sin integrar el PR.

## Hallazgos de la prueba completa

La prueba detectó que una reserva podía acumular la receta anterior y la nueva. Se conservará únicamente la receta capturada.
También detectó que una venta con autorización para saldo negativo perdía esa autorización al confirmar el inventario.
La corrección usará una migración nueva de la función de confirmación. Conservará los controles del permiso y la relación con el comando.
La devolución registra una intención de reposición. La reposición explícita y autorizada debe usar las cantidades de la venta original.
