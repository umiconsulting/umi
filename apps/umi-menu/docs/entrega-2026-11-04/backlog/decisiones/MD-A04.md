# [MD-A04] Permisos y día operativo al cancelar

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Pendiente de decisión.
No tiene número de issue asignado.

## Decisión necesaria

Resolver quién puede cancelar en cada estado y cómo se aplican autorización específica, versión y día operativo del producto vigente.

**Resultado requerido:** Matriz de actor, estado, acción, autorización y efectos de cancelación aprobada.

**Historias bloqueadas directamente:** MD-H11, MD-H12, MD-H23.

Esta es una decisión de producto/técnica, no una historia implementada. Su documentación acompaña al primer PR funcional que la use. No requiere un PR documental independiente.

## Criterios de aceptación

- [ ] **MD-A04-CA01:** Respeta order.void_after_preparation.approve y no amplía permisos por etiqueta digital.
- [ ] **MD-A04-CA02:** Distingue pedido no cobrado de venta cobrada o entregada.
- [ ] **MD-A04-CA03:** Incluye versión cambiada mientras se autoriza y pedido de día operativo anterior.

## Tareas

### MD-A04-T01 · Contrastar el comportamiento vigente

- [ ] Revisar fuentes, operación y consumidores relacionados con esta decisión; registrar hechos y restricciones.

**Termina cuando:** Evidencia fechada que diferencia hechos de propuestas.

### MD-A04-T02 · Resolver la decisión con los responsables

- [ ] Resolver quién puede cancelar en cada estado y cómo se aplican autorización específica, versión y día operativo del producto vigente.

**Termina cuando:** Matriz de actor, estado, acción, autorización y efectos de cancelación aprobada.

### MD-A04-T03 · Convertir el resultado en ejemplos verificables

- [ ] Registrar los escenarios de aceptación indicados y actualizar las historias afectadas; conservar el resultado junto al primer PR funcional que lo use.

**Termina cuando:** No quedan valores implícitos; las historias afectadas enlazan la decisión resuelta.

## Cierre

Registrar responsable, fecha, resultado y ejemplos aprobados. Actualizar las historias afectadas. Investigar o proponer una opción no equivale a que el usuario la haya elegido.

