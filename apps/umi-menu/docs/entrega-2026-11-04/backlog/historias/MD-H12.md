# [MD-H12] Solicitar y resolver cancelación de un pedido aceptado

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente y personal autorizado**, quiero **solicitar y resolver una cancelación con el estado real del pedido** para **evitar detener preparación sin autorización**.

**Fase:** B · **Entregas del plan:** P08.
**Reglas de origen:** D14, D18, D19.
**Áreas de referencia:** cancelacion, ordenes, permisos, kds. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H08, MD-H10, MD-H11, MD-A02, MD-A04.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Reembolsos o edición silenciosa de líneas ya enviadas.

## Criterios de aceptación

- [ ] **MD-H12-CA01:** Una solicitud de cancelación queda separada del estado comercial y no detiene automáticamente preparación.
- [ ] **MD-H12-CA02:** El personal autorizado puede aprobar o rechazar la solicitud y dejar un motivo.
- [ ] **MD-H12-CA03:** Después de iniciar preparación se exige la autorización vigente; no se amplían permisos por ser un pedido digital.
- [ ] **MD-H12-CA04:** Una aprobación válida actualiza comercio, POS y estaciones; rechazo conserva el pedido activo.
- [ ] **MD-H12-CA05:** Reintento, cambio de versión, día operativo y pedido ya cobrado/entregado siguen reglas aprobadas, sin una autorización reutilizable.

## Tareas

### MD-H12-T01 · Persistir la solicitud separada del pedido

- [ ] Definir una solicitud activa y su resolución, con identidad del pedido y trazabilidad.

**Termina cuando:** Pedir cancelación no cambia el estado a cancelado.

### MD-H12-T02 · Implementar resolución con permisos existentes

- [ ] Integrar autorización ligada a operación/versión y día operativo cuando aplique MD-A04.

**Termina cuando:** Un cajero sin permiso no anula preparación mediante el nuevo canal.

### MD-H12-T03 · Coordinar resultado con KDS e inventario

- [ ] Al aprobar, usar cancelación canónica y efectos aprobados; registrar preparación iniciada.

**Termina cuando:** Las estaciones afectadas dejan de preparar y no se restaura stock incorrectamente.

### MD-H12-T04 · Exponer solicitud y respuesta al seguimiento

- [ ] Mostrar pendiente de respuesta, aprobación o rechazo con la acción permitida vigente.

**Termina cuando:** La UI no anuncia cancelación antes de confirmación.

### MD-H12-T05 · Probar autorización, carreras y recuperación

- [ ] Cubrir resolución doble, pedido cambiado, día cerrado y caída al notificar estaciones.

**Termina cuando:** Resolución única, permisos intactos y estado consistente después de recuperar.

## Validación en staging

Solicitar cancelar un preparado, rechazar desde un rol sin permiso y aprobar con la autorización válida; comprobar cliente, POS y estaciones.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

