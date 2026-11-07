# Capacidad actual de medición comercial de UMI

Fecha: 6 de noviembre de 2026.
Estado: auditoría estática para una entrevista de producto y negocio.

## Alcance y método

Esta revisión usa el código local como fuente primaria. No consulta datos de clientes ni el entorno de producción.
No verifica el despliegue, la interfaz en un navegador ni el resultado de una consulta real.
Los hallazgos describen el código inspeccionado. No prueban un efecto sobre las cifras reales de ONCA.

- Base local: commit `597f8ba6e3760343aa56a24bd53cca55606aab2e`, rama `release/onca-pilot-20261014`.
- El directorio contiene cambios previos. El commit identifica la base, no todo el contenido local.
- Corroboración sin `fetch`: `origin/main` apunta a `3f0afd46`; `origin/staging` apunta a `e68ed51e`.
- El repositorio de reportes, su servicio y el repositorio de clientes coinciden con ambas referencias remotas locales.
- La pantalla de ventas coincide con `origin/staging`. Contra `origin/main`, la diferencia es una línea añadida.
- Estas referencias no prueban qué versión está desplegada. El controlador de costos solo acredita una superficie local existente.
- Herramientas: ripgrep 15.2.0 y Git 2.56.0, ya instalados. La adopción requiere cero dependencias.
- Fuentes: código, contrato compartido, SQL de build-v3 y pruebas existentes. Corresponden al nivel de fuente primaria del repositorio.
- Ruta: pantalla de ventas → carga de datos → controlador → servicio → consultas → hechos comerciales.
- Skills: `research` y `product-feature-review`. La primera exige conservar los resultados en un archivo.
- No se ejecutaron pruebas. No se modificó código de producto.

**Hecho documentado:** existe una base de reportes comerciales y una narrativa opcional con IA.
**Inferencia:** la primera inversión debe fijar el significado de las métricas y completar las consultas reutilizables.
La evidencia actual no exige un servicio nuevo de analítica.

## Respuesta a las cinco preguntas

| Pregunta de ONCA                                       | Interfaz definida en código                                                             | Datos disponibles                                                                        | Trabajo pendiente                                                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| ¿Qué porcentaje de tickets incluye pan y café?         | No se encontró esta medida en el contrato ni en la pantalla de ventas revisada.         | Cada venta cerrada enlaza su cuenta, sus líneas y sus productos.                         | Definir conjuntos configurables de productos, denominador, devoluciones y conteo único por venta.                             |
| ¿Qué productos se compran en la misma visita?          | Existe mezcla por producto y categoría; no existe coocurrencia en el contrato revisado. | Se pueden agrupar productos por venta. Las cuentas de mesa conservan `table_visit_id`.   | Separar venta, cuenta, visita de mesa y visita de una persona. Definir la unidad de análisis.                                 |
| ¿Cuáles son las horas de mayor venta y de oportunidad? | Hay serie horaria y tabla por hora.                                                     | Se agregan importes y cantidades a partir del cierre de la venta.                        | Separar hora del pedido, hora del cobro y hora de sincronización. La oportunidad requiere una hipótesis y otros datos.        |
| ¿Cuántas piezas vendemos por ticket?                   | Se muestran órdenes e ítems vendidos. No se encontró su cociente como indicador.        | El agregado devuelve la suma de cantidades de las líneas y el número de ventas cerradas. | Definir unidades comerciales frente a piezas físicas. Calcular y explicar el cociente.                                        |
| ¿Cómo cambia el ticket por día, horario o temporada?   | Hay ticket promedio del período y ventas por hora o día.                                | Fechas, horas e importes permiten nuevos grupos.                                         | Añadir conteo de ventas por grupo, rangos flexibles y comparaciones equivalentes. La temporada requiere historial suficiente. |

Fuentes: [pantalla de ventas](../../apps/umi-dashboard/src/screens/ventas-report.jsx),
[carga de datos](../../apps/umi-dashboard/src/data.jsx#L573),
[contrato de reportes](../../packages/contract/src/reports.ts#L12),
[consultas de ventas](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts#L364).

La ausencia se limita a estas superficies inspeccionadas. No significa ausencia absoluta en todas las ramas o productos.

## Capacidad existente que se debe aprovechar

**Hechos documentados:**

1. La pantalla define rangos de hoy, ayer, siete días y treinta días.
2. La pantalla define ticket promedio, órdenes, ítems, descuentos, propinas y ventas del período anterior.
3. La tabla agrupa por producto, categoría, operador y hora.
4. La API aplica permisos de ventas y alcance de sucursal.
5. La narrativa opcional recibe cifras del mismo agregado. Un fallo del proveedor permite ocultar la narrativa.
6. El esquema enlaza una venta cerrada con una cuenta y un recibo único.
7. El recibo conserva los importes emitidos. Los reportes no necesitan precios actuales para reconstruir esos importes.

Fuentes: [rangos y agrupaciones](../../apps/umi-dashboard/src/screens/ventas-report.jsx#L31),
[indicadores](../../apps/umi-dashboard/src/screens/ventas-report.jsx#L665),
[permisos](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.service.ts#L218),
[narrativa](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.service.ts#L256),
[recibos y ventas](../migration/build-v3/20_merchant.sql#L1984).

**Límite:** la narrativa recibe montos, órdenes, ticket, propinas, descuentos, comparación y cinco productos destacados.
No recibe canastas completas ni una matriz de asociaciones. No puede responder la primera pregunta con ese insumo.
El texto del prompt pide limitarse a los datos. Esta revisión no evaluó el cumplimiento del modelo.

Fuente: [insumo y prompt de la narrativa](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.service.ts#L20).

## Hallazgos que cambian el plan

### 1. El ticket promedio actual incluye propina

**Hecho documentado:** el cálculo de checkout suma la propina al importe después del descuento.
Ese importe se conserva como `grandTotal` y luego como `receipt_snapshot.grand_total`.
El reporte calcula `averageTicketMinorUnits = sum(grand_total) / count(ventas cerradas)`.

Fuentes: [cálculo](../../apps/umi-api/src/modules/pos-checkout/checkout-calculator.ts#L173),
[recibo](../../apps/umi-api/src/modules/pos-checkout/pos-checkout.service.ts#L1640),
[persistencia](../../apps/umi-api/src/modules/pos-checkout/pos-checkout.repository.ts#L1669),
[promedio](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts#L540).

**Inferencia:** el indicador actual mide el importe cobrado por venta, con propina.
Una decisión sobre mezcla de productos puede requerir el importe de mercancía sin propina.
El plan debe resolver ese significado antes de prometer un aumento del ticket.

### 2. El agregado de ventas no resta devoluciones ni anulaciones posteriores

**Hecho documentado:** el agregado suma recibos de ventas cerradas. Sus consultas no unen `pos_sale_exception` ni sus líneas.
Los recibos originales permanecen inmutables. Las excepciones se consultan por separado en el detalle del recibo.
La información para compensar cantidades e importes existe en `pos_sale_exception_line`.

Fuentes: [agregado](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts#L424),
[excepciones en el detalle](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts#L312),
[cantidades e importes compensados](../../apps/umi-api/src/modules/pos-exception/pos-exception.repository.ts#L1716).

**Inferencia:** `netSalesMinorUnits` no representa por sí mismo ventas después de todas las devoluciones.
La etiqueta «Ventas netas» necesita una definición comercial explícita y una verificación con casos de excepción.
También se debe decidir si la devolución afecta la fecha original o la fecha de devolución, según la pregunta del reporte.

### 3. Los grupos de producto y hora usan otra base monetaria

**Hecho documentado:** producto, operador y hora suman cantidad por precio base, variante y modificadores.
La consulta no distribuye descuentos ni propinas entre esos grupos.
El contrato describe el importe por producto como mercancía antes de descuentos e identifica la ausencia de costo en esa fila.
El comentario del repositorio afirma conciliación de todas las vistas, pero las expresiones SQL usan bases distintas.

Fuentes: [producto](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts#L471),
[hora](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts#L501),
[significado del campo](../../packages/contract/src/reports.ts#L57),
[comentario de conciliación](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts#L360).

**Ejemplo derivado del código:** una venta de $100 con descuento de $10 y propina de $5 produce bases de $100 y $95.
Una devolución posterior tampoco entra en este agregado.
Este ejemplo prueba la diferencia de fórmulas. No describe una venta real de ONCA.

### 4. El período usa fecha comercial; «hoy» parte de fecha calendario

**Hecho documentado:** la consulta obtiene «hoy» desde la fecha local del negocio y filtra `receipt_snapshot.business_date`.
El checkout conserva reglas adicionales sobre el inicio del día comercial y el turno que recibió el dinero.
Una cuenta puede abrir un día y cerrar otro. Un pago parcial puede pertenecer a un turno previo.

Fuentes: [ventana del reporte](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts#L374),
[fecha de cierre](../../apps/umi-api/src/modules/pos-checkout/pos-checkout.repository.ts#L1517).

**Inferencia:** la coherencia entre fecha calendario y fecha comercial debe probarse con una jornada que cruza medianoche.
La configuración y el impacto real en ONCA quedan **NO VERIFICADOS**.

### 5. La hora del cierre no siempre es la hora de consumo

**Hecho documentado:** las agrupaciones horarias leen `pos_committed_sale.committed_at`, con la zona del negocio.
La ruta offline vuelve a ejecutar el checkout al sincronizar.
El diario conserva `client_created_at`, pero el agregado horario no lo usa.

Fuentes: [hora del reporte](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts#L501),
[replay de checkout](../../apps/umi-api/src/modules/pos-offline/pos-offline.service.ts#L714),
[hora del dispositivo](../../apps/umi-api/src/modules/pos-offline/pos-offline.repository.ts#L215),
[fecha de cierre por defecto](../migration/build-v3/20_merchant.sql#L2007).

**Inferencia:** una venta offline podría aparecer en la hora de sincronización al usar este agregado.
El plan debe distinguir el momento comercial, el momento del pago y el momento de aceptación del servidor.
La hora del dispositivo necesita reglas de confianza; su mera existencia no resuelve esa decisión.

### 6. Ya existen varias definiciones de «visita»

**Hecho documentado:** las cuentas de mesa conservan `table_visit_id`.
Las pruebas existentes describen una nueva cuenta en la misma visita después del cierre de una cuenta anterior.
Una nueva ocupación genera otra visita.
En clientes, `kpis` cuenta fechas comerciales distintas como `visit_days`.
El cliente de una orden puede ser nulo.

Fuentes: [identidad de mesa](../migration/build-v3/migrations/018_pos_table_accounts.sql#L1),
[escenario de continuidad](../../apps/umi-api/src/modules/pos-cart/table-accounts.integration.ts#L263),
[visita por día](../../apps/umi-api/src/modules/customers/customers.repository.ts#L519),
[orden anónima](../migration/build-v3/20_merchant.sql#L1084).

**Inferencia:** un día con dos visitas de la misma persona cuenta una sola vez en esa aproximación de clientes.
Una visita de mesa puede incluir varios recibos. Una visita de lealtad también tiene otro propósito.
Se debe elegir un término distinto para cada unidad. «Misma visita» no permite una fórmula universal todavía.

### 7. La categoría histórica depende del catálogo actual

**Hecho documentado:** el reporte toma el nombre del producto desde la línea, pero une su categoría desde el catálogo actual.
El resultado por producto está limitado a doscientas filas.

Fuente: [agrupación de productos](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts#L478).

**Inferencia:** una reclasificación puede cambiar una comparación histórica por categoría.
El plan debe elegir clasificación actual o clasificación a fecha de venta.
La lista de productos del reporte tampoco debe servir como insumo completo de una búsqueda de asociaciones.

## Conceptos por resolver en la entrevista

Estas definiciones son propuestas para el plan. No modifican el glosario canónico.

| Término             | Propuesta                                                    | Decisión abierta                                             |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Venta cerrada       | Un hecho `pos_committed_sale`.                               | Tratamiento de anulación completa y venta de importe cero.   |
| Ticket              | Recibo de una venta cerrada.                                 | Distinguirlo de comanda, cuenta y tramo de pago.             |
| Unidad comercial    | Una cantidad registrada en la línea.                         | Conversión de paquetes, combos, peso y piezas físicas.       |
| Canasta             | Conjunto de productos de la unidad elegida.                  | Agrupar por venta, visita de mesa o visita identificada.     |
| Ticket de mercancía | Importe de productos por ticket, con una política explícita. | Impuestos, descuentos, devoluciones y operaciones excluidas. |
| Visita identificada | Episodio definido para un cliente conocido.                  | Captura del episodio y cobertura de compras anónimas.        |
| Oportunidad         | Hipótesis de acción con fundamento y resultado por medir.    | Umbral de evidencia y quién puede ejecutarla.                |

Un pago dividido entre métodos no debe multiplicar el número de ventas.
Un reparto entre cuentas debe conservar su relación con la visita, cuando esa relación exista.
La auditoría encontró pagos parciales y visitas de mesa; no validó todo el flujo de división de cuentas.

## Fórmulas candidatas para una capacidad reutilizable

Son propuestas de producto, sujetas a la entrevista y la política de excepciones.

1. **Coocurrencia A y B:** tickets elegibles con algún producto de A y alguno de B / tickets elegibles.
2. **Adición de B a A:** tickets con A y B / tickets con A.
3. **Unidades por ticket:** suma de cantidades elegibles / tickets elegibles.
4. **Ticket por grupo:** suma de importes definidos / tickets elegibles del grupo.
5. **Asociación:** comparar la compra conjunta observada con la frecuencia individual de ambos conjuntos.

Cada resultado debe indicar período, sucursal, unidad, denominador, muestra y cobertura de datos.
Una misma venta cuenta una sola vez en cada condición, aunque contenga varias unidades o varios pagos.
El denominador cero requiere un resultado «sin datos» o «no calculable».
Los conjuntos A y B deben tratar su posible solapamiento para evitar asociaciones de un producto consigo mismo.

La compra conjunta no demuestra que una promoción aumentará ventas o margen.
Una hora con ventas bajas tampoco demuestra demanda desaprovechada.
Ese diagnóstico puede requerir horas abiertas, disponibilidad, capacidad, tráfico, campañas y costo de atender la demanda.

## Bases para ampliar el alcance

**Hecho documentado:** el controlador de costos ya ofrece bases de costo, platos, días, bajo inventario, variaciones y clasificación del menú.
Es una superficie existente que el plan puede evaluar antes de proponer un módulo de rentabilidad nuevo.
Esta auditoría no validó sus cálculos ni su cobertura real de datos.

Fuente: [controlador de costos](../../apps/umi-api/src/modules/inventory-costing/inventory-costing.controller.ts#L41).

**Hecho documentado:** clientes ya distingue datos anónimos, visitas por día, propinas atribuidas y dos rutas de devolución.
Eso ofrece un punto de partida para retención, con límites distintos del agregado de ventas.

Fuente: [criterios de clientes](../../apps/umi-api/src/modules/customers/customers.repository.ts#L519).

**Inferencia:** las capas siguientes pueden conectar medición, diagnóstico, acción, evaluación y acompañamiento comercial.
Antes deben compartir significados entre ventas, clientes, costos y caja.
La arquitectura existente asigna hechos y normalización a `umi-api`; el dashboard consume los contratos.

## Casos mínimos de aceptación para el futuro plan

- Un ticket con dos panes y dos cafés cuenta una sola vez para coocurrencia y cuatro unidades comerciales.
- Dos métodos de pago conservan un solo ticket y las mismas cantidades.
- Dos cuentas de una visita de mesa producen dos tickets y una visita, cuando ese es el objeto del reporte.
- Una devolución parcial cambia importes y cantidades según una política visible.
- Una propina altera el importe cobrado y conserva el ticket de mercancía definido.
- Un descuento conserva conciliación entre total y sus grupos cuando esos grupos se llaman ventas netas.
- Una venta offline conserva una atribución horaria explícita y no duplica ventas tras un reintento.
- Una jornada que cruza medianoche respeta el día comercial del negocio.
- Una reclasificación de catálogo mantiene la política histórica elegida.
- Un período sin ventas produce denominadores explícitos y no inventa oportunidades.
- Un reporte respeta negocio, sucursal y permisos del usuario.

## Límite de la conclusión

El código permite plantear las cinco respuestas como evolución de capacidades existentes.
El producto revisado no ofrece todavía las cinco respuestas completas con semántica común.
La siguiente decisión es comercial y de dominio: qué acción ayudará al dueño, bajo qué unidad y con qué prueba de resultado.
El despliegue actual, los datos disponibles, la cobertura histórica y la utilidad para otros clientes permanecen **NO VERIFICADOS**.
