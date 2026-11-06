# [MD-H14] Cobrar y entregar el pedido existente desde UmiPOS

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cajero**, quiero **cobrar y entregar la recogida que llegó del menú** para **registrar una sola venta sobre el pedido correcto**.

**Fase:** B · **Entregas del plan:** P09.
**Reglas de origen:** D02, D17, D18, D19.
**Áreas de referencia:** pos, checkout, inventario. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H13, MD-H29, MD-A02, MD-A03.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Métodos de pago nuevos y cambios generales del checkout.

## Criterios de aceptación

- [ ] **MD-H14-CA01:** Adoptar y cobrar el pedido conserva el identificador comercial, origen digital, modalidad, líneas, opciones y total vigentes; cobrar en POS no cambia el origen a presencial.
- [ ] **MD-H14-CA02:** Cobro usa los métodos y permisos existentes; el menú no añade un pago en línea.
- [ ] **MD-H14-CA03:** Entrega y pago son hechos separados según el flujo aprobado y no crean otra orden.
- [ ] **MD-H14-CA04:** Reintentar cobro o recuperar la sesión no duplica pagos ni preparación.
- [ ] **MD-H14-CA05:** Marcar no recogido no registra ingreso ni inventario de una venta cobrada; sigue la política operativa aprobada.

## Tareas

### MD-H14-T01 · Mapear pedido digital a cuenta existente

- [ ] Revisar adopción en pos-cart y checkout según MD-A03, preservando el vínculo comercial, origen y modalidad hasta la venta comprometida.

**Termina cuando:** No se crea un nuevo pedido al abrir la cuenta.

### MD-H14-T02 · Conservar ajustes y validaciones de cobro

- [ ] Usar total canónico y mecanismos actuales de pago/permisos, con conflictos visibles.

**Termina cuando:** Cuenta modificada no se cobra con un total obsoleto.

### MD-H14-T03 · Registrar entrega y no recogido

- [ ] Definir acciones compatibles con el ciclo aprobado y sus efectos de inventario.

**Termina cuando:** No recogido no genera un pago ficticio.

### MD-H14-T04 · Proteger reintento y reconexión

- [ ] Recuperar el resultado comercial de pagos/entrega ante timeout.

**Termina cuando:** Un resultado desconocido no dispara un segundo cobro.

### MD-H14-T05 · Probar cobro real del flujo en entorno de prueba

- [ ] Ejecutar adopción, pago, entrega y recuperación con POS nativo; añadir prueba de stock separada.

**Termina cuando:** Un pedido, pago correcto, estaciones sin reproyección y efectos de stock comprobados sin mocks que los oculten.

## Validación en staging

Completar un pedido de barra+cocina, cobrarlo en caja, reconectar POS y verificar que existe una sola orden y un solo pago.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

