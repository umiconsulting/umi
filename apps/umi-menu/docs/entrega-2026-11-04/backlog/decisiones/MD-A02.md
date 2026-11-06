# [MD-A02] Inventario y efectos de cierre del pedido

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Pendiente de decisión.
No tiene número de issue asignado.

## Decisión necesaria

Determinar reserva/descuento y liberación por crear, aceptar, rechazar, vencer, cancelar, preparar y no recoger.

**Resultado requerido:** Tabla de efectos por transición, integración con inventario existente y ejemplo de concurrencia aprobados.

**Historias bloqueadas directamente:** MD-H07, MD-H08, MD-H11, MD-H12, MD-H14, MD-H16, MD-H21, MD-H23.

Esta es una decisión de producto/técnica, no una historia implementada. Su documentación acompaña al primer PR funcional que la use. No requiere un PR documental independiente.

## Criterios de aceptación

- [ ] **MD-A02-CA01:** Distingue preparado de no preparado y no restaura automáticamente producto consumido.
- [ ] **MD-A02-CA02:** Explica qué ocurre con programados y falta de stock antes/después de aceptar.
- [ ] **MD-A02-CA03:** Incluye un ejemplo de reintento que no duplica reserva ni descuento.

## Tareas

### MD-A02-T01 · Contrastar el comportamiento vigente

- [ ] Revisar fuentes, operación y consumidores relacionados con esta decisión; registrar hechos y restricciones.

**Termina cuando:** Evidencia fechada que diferencia hechos de propuestas.

### MD-A02-T02 · Resolver la decisión con los responsables

- [ ] Determinar reserva/descuento y liberación por crear, aceptar, rechazar, vencer, cancelar, preparar y no recoger.

**Termina cuando:** Tabla de efectos por transición, integración con inventario existente y ejemplo de concurrencia aprobados.

### MD-A02-T03 · Convertir el resultado en ejemplos verificables

- [ ] Registrar los escenarios de aceptación indicados y actualizar las historias afectadas; conservar el resultado junto al primer PR funcional que lo use.

**Termina cuando:** No quedan valores implícitos; las historias afectadas enlazan la decisión resuelta.

## Cierre

Registrar responsable, fecha, resultado y ejemplos aprobados. Actualizar las historias afectadas. Investigar o proponer una opción no equivale a que el usuario la haya elegido.

