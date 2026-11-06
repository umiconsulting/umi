# [MD-H33] Distinguir pedidos digitales en historial y reportes

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **administrador del negocio**, quiero **consultar el origen de los pedidos y ventas del menú** para **distinguirlos de los pedidos presenciales sin confundir la modalidad**.

**Fase:** E · **Entregas del plan:** P09, P19.
**Reglas de origen:** D08, D09, D10, D17, D18, D19.
**Áreas de referencia:** ordenes, checkout, dashboard, reportes. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H14, MD-H16, MD-A03.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Un sistema nuevo de analítica, campañas, atribución de marketing o una nueva insignia permanente en KDS.

## Criterios de aceptación

- [ ] **MD-H33-CA01:** El historial y detalle distinguen origen digital/presencial y modalidad mesa/recogida como campos separados.
- [ ] **MD-H33-CA02:** Una venta cobrada en POS conserva el origen del pedido digital; los pedidos presenciales mantienen su atribución.
- [ ] **MD-H33-CA03:** El reporte por canal usa la fuente canónica de ventas cobradas; un pendiente, rechazo o pedido no recogido sin cobro no se suma como ingreso.
- [ ] **MD-H33-CA04:** Los filtros y totales respetan negocio, sucursal y periodo. El total por origen reconcilia con el reporte de ventas existente, incluidas sus devoluciones y ajustes.
- [ ] **MD-H33-CA05:** La interfaz conserva el diseño vigente y no añade una insignia permanente de origen en KDS.

## Tareas

### MD-H33-T01 · Contrastar atribución y consultas actuales

- [ ] Revisar source, fulfillment_type, vínculo de checkout y proyección de ventas en orders y dashboard-operations; contrastar el ADR histórico con el código vigente.

**Termina cuando:** Se identifica la fuente canónica sin equiparar pedido recibido con venta cobrada.

### MD-H33-T02 · Preservar origen en lecturas de historial

- [ ] Extender solo las lecturas y contratos necesarios para exponer y filtrar el origen digital, manteniendo los permisos y la modalidad separada.

**Termina cuando:** La UI y una solicitud directa devuelven únicamente pedidos del alcance permitido.

### MD-H33-T03 · Conectar origen al reporte de ventas

- [ ] Usar la atribución conservada por MD-H14 en el agregado existente; cubrir ajustes y devoluciones con su semántica actual.

**Termina cuando:** Los importes por canal reconcilian con ventas cobradas y no cuentan pendientes como ingresos.

### MD-H33-T04 · Mostrar origen y filtros en Dashboard

- [ ] Actualizar Pedidos y Reportes con sus componentes vigentes; corregir textos antiguos que limitan la atribución a WhatsApp si ya no describen el comportamiento.

**Termina cuando:** Origen y modalidad son legibles en detalle y filtros sin rediseñar las pantallas.

### MD-H33-T05 · Probar historial y conciliación por canal

- [ ] Añadir casos digital/presencial, pendiente/cobrado, devolución y sucursal ajena; recorrer Dashboard con la API real de staging.

**Termina cuando:** Resultados sin duplicación y evidencia de aislamiento y conciliación.

## Validación en staging

Crear un pedido presencial y pedidos de mesa/recogida digitales, cobrar los casos previstos y dejar uno sin cobro. Verificar origen en detalle e historial y reconciliar ingresos por canal con ventas; repetir con una devolución y otra sucursal.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

