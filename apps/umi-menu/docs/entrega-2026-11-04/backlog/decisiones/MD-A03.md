# [MD-A03] Correspondencia entre pedido, preparación, cuenta y cobro

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Pendiente de decisión.
No tiene número de issue asignado.

## Decisión necesaria

Elegir cómo representar aceptación/reserva sin romper estados, contratos y adopción de cuenta existentes.

**Resultado requerido:** Mapa de estados/contratos y de identificadores comerciales aprobado con compatibilidad de clientes.

**Historias bloqueadas directamente:** MD-H07, MD-H08, MD-H14, MD-H16, MD-H21, MD-H33.

Esta es una decisión de producto/técnica, no una historia implementada. Su documentación acompaña al primer PR funcional que la use. No requiere un PR documental independiente.

## Criterios de aceptación

- [ ] **MD-A03-CA01:** Distingue estado comercial, solicitud de cancelación, preparación y pago.
- [ ] **MD-A03-CA02:** Mesa/POS actuales conservan su comportamiento y un pedido digital se cobra sin duplicar orden.
- [ ] **MD-A03-CA03:** Incluye un ejemplo de aceptación inmediata y otro de reserva programada.

## Tareas

### MD-A03-T01 · Contrastar el comportamiento vigente

- [ ] Revisar fuentes, operación y consumidores relacionados con esta decisión; registrar hechos y restricciones.

**Termina cuando:** Evidencia fechada que diferencia hechos de propuestas.

### MD-A03-T02 · Resolver la decisión con los responsables

- [ ] Elegir cómo representar aceptación/reserva sin romper estados, contratos y adopción de cuenta existentes.

**Termina cuando:** Mapa de estados/contratos y de identificadores comerciales aprobado con compatibilidad de clientes.

### MD-A03-T03 · Convertir el resultado en ejemplos verificables

- [ ] Registrar los escenarios de aceptación indicados y actualizar las historias afectadas; conservar el resultado junto al primer PR funcional que lo use.

**Termina cuando:** No quedan valores implícitos; las historias afectadas enlazan la decisión resuelta.

## Cierre

Registrar responsable, fecha, resultado y ejemplos aprobados. Actualizar las historias afectadas. Investigar o proponer una opción no equivale a que el usuario la haya elegido.

