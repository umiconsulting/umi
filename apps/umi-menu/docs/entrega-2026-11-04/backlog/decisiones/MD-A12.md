# [MD-A12] Protección de acceso público y datos de contacto

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Pendiente de decisión.
No tiene número de issue asignado.

## Decisión necesaria

Definir límites de abuso, credenciales y caducidad/rotación, cacheado privado y retención de contacto.

**Resultado requerido:** Política mínima de acceso, límites y retención con escenarios de prueba aprobada.

**Historias bloqueadas directamente:** MD-H07, MD-H10, MD-H16, MD-H18, MD-H27.

Esta es una decisión de producto/técnica, no una historia implementada. Su documentación acompaña al primer PR funcional que la use. No requiere un PR documental independiente.

## Criterios de aceptación

- [ ] **MD-A12-CA01:** Número, teléfono o correo no autorizan a consultar pedidos ni historial.
- [ ] **MD-A12-CA02:** Define efecto de revocar QR y de expirar un enlace sin inventar identidad verificada.
- [ ] **MD-A12-CA03:** No requiere OTP ni usa credenciales de administración en el cliente público.

## Tareas

### MD-A12-T01 · Contrastar el comportamiento vigente

- [ ] Revisar fuentes, operación y consumidores relacionados con esta decisión; registrar hechos y restricciones.

**Termina cuando:** Evidencia fechada que diferencia hechos de propuestas.

### MD-A12-T02 · Resolver la decisión con los responsables

- [ ] Definir límites de abuso, credenciales y caducidad/rotación, cacheado privado y retención de contacto.

**Termina cuando:** Política mínima de acceso, límites y retención con escenarios de prueba aprobada.

### MD-A12-T03 · Convertir el resultado en ejemplos verificables

- [ ] Registrar los escenarios de aceptación indicados y actualizar las historias afectadas; conservar el resultado junto al primer PR funcional que lo use.

**Termina cuando:** No quedan valores implícitos; las historias afectadas enlazan la decisión resuelta.

## Cierre

Registrar responsable, fecha, resultado y ejemplos aprobados. Actualizar las historias afectadas. Investigar o proponer una opción no equivale a que el usuario la haya elegido.

