# [MD-H11] Cancelar directamente una recogida pendiente

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente que recoge**, quiero **cancelar mientras el negocio no acepta** para **retirar el pedido antes de que empiece la preparación**.

**Fase:** B · **Entregas del plan:** P08.
**Reglas de origen:** D14, D18, D19.
**Áreas de referencia:** ordenes, cancelacion, inventario. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H08, MD-H10, MD-A02, MD-A04.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Cancelación de programados aceptados y solicitud de cancelación tras aceptar.

## Criterios de aceptación

- [ ] **MD-H11-CA01:** La credencial del pedido permite cancelar una recogida pendiente, según permisos públicos limitados.
- [ ] **MD-H11-CA02:** Cancelar un pendiente evita toda proyección posterior y ejecuta la política de inventario aprobada una sola vez.
- [ ] **MD-H11-CA03:** Cancelar y aceptar simultáneamente deja un único resultado; si ganó la aceptación se informa la acción permitida vigente.
- [ ] **MD-H11-CA04:** Repetir la cancelación devuelve el estado existente sin duplicar efectos.
- [ ] **MD-H11-CA05:** No se aplican cargos automáticos ni se permite cancelar otro pedido.

## Tareas

### MD-H11-T01 · Implementar comando público acotado

- [ ] Usar la credencial de seguimiento y una transición condicionada al estado pendiente.

**Termina cuando:** No permite cambios arbitrarios de estado o pedido.

### MD-H11-T02 · Serializar cancelación con aceptación/vencimiento

- [ ] Aplicar control transaccional con las transiciones de MD-H08.

**Termina cuando:** No existe pedido cancelado que se proyecte después.

### MD-H11-T03 · Aplicar efectos y evento de cancelación

- [ ] Registrar motivo/origen y liberar lo definido por inventario sin cargo automático.

**Termina cuando:** Efecto único y auditable.

### MD-H11-T04 · Actualizar acciones del seguimiento

- [ ] Devolver el estado y la acción vigente si el pedido cambió durante la solicitud.

**Termina cuando:** El cliente no ve una cancelación confirmada cuando ganó aceptación.

### MD-H11-T05 · Probar concurrencia e idempotencia

- [ ] Cubrir cancelar/aceptar, cancelar/vencer, repetición y acceso cruzado con PostgreSQL.

**Termina cuando:** Un resultado comercial válido y cero proyecciones de un cancelado.

## Validación en staging

Lanzar cancelación y aceptación concurrentes sobre un pendiente; comprobar el resultado final desde cliente, POS y KDS.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

