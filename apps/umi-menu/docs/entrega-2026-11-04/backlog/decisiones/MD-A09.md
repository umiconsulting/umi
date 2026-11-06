# [MD-A09] Remitente, respuestas y fallos de correo

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Pendiente de decisión.
No tiene número de issue asignado.

## Decisión necesaria

Definir identidad del remitente por negocio, dominio autorizado, reply-to, responsable de respuestas y tratamiento de rebotes/reintentos.

**Resultado requerido:** Configuración operativa sin secretos, política de envío y destinatarios autorizados de prueba aprobados.

**Historias bloqueadas directamente:** MD-H18, MD-H19, MD-H32.

Esta es una decisión de producto/técnica, no una historia implementada. Su documentación acompaña al primer PR funcional que la use. No requiere un PR documental independiente.

## Criterios de aceptación

- [ ] **MD-A09-CA01:** Distingue SMTP configurado, aceptación del proveedor y entrega.
- [ ] **MD-A09-CA02:** Define cómo se identifica el negocio y cómo responde el cliente.
- [ ] **MD-A09-CA03:** Incluye tratamiento de fallo sin cancelar el pedido ni usar WhatsApp como dependencia.

## Tareas

### MD-A09-T01 · Contrastar el comportamiento vigente

- [ ] Revisar fuentes, operación y consumidores relacionados con esta decisión; registrar hechos y restricciones.

**Termina cuando:** Evidencia fechada que diferencia hechos de propuestas.

### MD-A09-T02 · Resolver la decisión con los responsables

- [ ] Definir identidad del remitente por negocio, dominio autorizado, reply-to, responsable de respuestas y tratamiento de rebotes/reintentos.

**Termina cuando:** Configuración operativa sin secretos, política de envío y destinatarios autorizados de prueba aprobados.

### MD-A09-T03 · Convertir el resultado en ejemplos verificables

- [ ] Registrar los escenarios de aceptación indicados y actualizar las historias afectadas; conservar el resultado junto al primer PR funcional que lo use.

**Termina cuando:** No quedan valores implícitos; las historias afectadas enlazan la decisión resuelta.

## Cierre

Registrar responsable, fecha, resultado y ejemplos aprobados. Actualizar las historias afectadas. Investigar o proponer una opción no equivale a que el usuario la haya elegido.

