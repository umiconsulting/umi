# [MD-A07] Límites de programación, capacidad y cambios de reglas

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Pendiente de decisión.
No tiene número de issue asignado.

## Decisión necesaria

Definir anticipación, horizonte, corte de cancelación, capacidad si aplica y efecto de cambiar reglas con reservas vigentes.

**Resultado requerido:** Matriz de reglas configurables y valores del piloto, con políticas de frontera y cambios aprobadas.

**Historias bloqueadas directamente:** MD-H20, MD-H22, MD-H23, MD-H24.

Esta es una decisión de producto/técnica, no una historia implementada. Su documentación acompaña al primer PR funcional que la use. No requiere un PR documental independiente.

## Criterios de aceptación

- [ ] **MD-A07-CA01:** El corte de cancelación directa nunca queda después de liberar a preparación.
- [ ] **MD-A07-CA02:** Aclara si existe capacidad por hora y qué ocurre con dos reservas simultáneas.
- [ ] **MD-A07-CA03:** Cambiar calendario o reglas no mueve silenciosamente una hora prometida.

## Tareas

### MD-A07-T01 · Contrastar el comportamiento vigente

- [ ] Revisar fuentes, operación y consumidores relacionados con esta decisión; registrar hechos y restricciones.

**Termina cuando:** Evidencia fechada que diferencia hechos de propuestas.

### MD-A07-T02 · Resolver la decisión con los responsables

- [ ] Definir anticipación, horizonte, corte de cancelación, capacidad si aplica y efecto de cambiar reglas con reservas vigentes.

**Termina cuando:** Matriz de reglas configurables y valores del piloto, con políticas de frontera y cambios aprobadas.

### MD-A07-T03 · Convertir el resultado en ejemplos verificables

- [ ] Registrar los escenarios de aceptación indicados y actualizar las historias afectadas; conservar el resultado junto al primer PR funcional que lo use.

**Termina cuando:** No quedan valores implícitos; las historias afectadas enlazan la decisión resuelta.

## Cierre

Registrar responsable, fecha, resultado y ejemplos aprobados. Actualizar las historias afectadas. Investigar o proponer una opción no equivale a que el usuario la haya elegido.

