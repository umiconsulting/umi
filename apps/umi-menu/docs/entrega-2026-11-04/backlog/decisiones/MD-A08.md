# [MD-A08] Señal de atención disponible y pausa

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Pendiente de decisión.
No tiene número de issue asignado.

## Decisión necesaria

Determinar qué señal demuestra que el negocio puede atender; definir umbrales, alcance por modalidad y recuperación de pausa.

**Resultado requerido:** Política de detección y recuperación con fuentes observables y casos de prueba aprobada.

**Historias bloqueadas directamente:** MD-H28.

Esta es una decisión de producto/técnica, no una historia implementada. Su documentación acompaña al primer PR funcional que la use. No requiere un PR documental independiente.

## Criterios de aceptación

- [ ] **MD-A08-CA01:** last_seen_at o autenticación aislada no se toman como presencia humana.
- [ ] **MD-A08-CA02:** Distingue cierre, pausa manual y caída; especifica mesa e inmediato.
- [ ] **MD-A08-CA03:** La pausa preserva consultas, seguimiento y pedidos aceptados.

## Tareas

### MD-A08-T01 · Contrastar el comportamiento vigente

- [ ] Revisar fuentes, operación y consumidores relacionados con esta decisión; registrar hechos y restricciones.

**Termina cuando:** Evidencia fechada que diferencia hechos de propuestas.

### MD-A08-T02 · Resolver la decisión con los responsables

- [ ] Determinar qué señal demuestra que el negocio puede atender; definir umbrales, alcance por modalidad y recuperación de pausa.

**Termina cuando:** Política de detección y recuperación con fuentes observables y casos de prueba aprobada.

### MD-A08-T03 · Convertir el resultado en ejemplos verificables

- [ ] Registrar los escenarios de aceptación indicados y actualizar las historias afectadas; conservar el resultado junto al primer PR funcional que lo use.

**Termina cuando:** No quedan valores implícitos; las historias afectadas enlazan la decisión resuelta.

## Cierre

Registrar responsable, fecha, resultado y ejemplos aprobados. Actualizar las historias afectadas. Investigar o proponer una opción no equivale a que el usuario la haya elegido.

