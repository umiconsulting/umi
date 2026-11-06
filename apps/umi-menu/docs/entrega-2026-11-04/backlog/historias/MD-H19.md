# [MD-H19] Validar remitente y entrega del correo del piloto

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **responsable de operación**, quiero **comprobar el envío con la configuración real del negocio** para **activar avisos con un remitente y respuesta utilizables**.

**Fase:** E · **Entregas del plan:** P13.
**Reglas de origen:** D13, D18, D19.
**Áreas de referencia:** correo, operacion. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H18, MD-A09, MD-A11.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Un nuevo proveedor de mensajería o un PR solo para activar un ajuste no versionado.

## Criterios de aceptación

- [ ] **MD-H19-CA01:** Se identifica remitente, dominio y dirección de respuesta autorizados para el piloto sin poner credenciales en Git.
- [ ] **MD-H19-CA02:** Se verifica envío a destinatarios de prueba autorizados y se registra qué evidencia acredita aceptación o entrega.
- [ ] **MD-H19-CA03:** Una respuesta del cliente llega al responsable definido; un rebote o fallo tiene un procedimiento de atención.
- [ ] **MD-H19-CA04:** Seguimiento web continúa disponible cuando el aviso falla.
- [ ] **MD-H19-CA05:** La activación de avisos queda registrada por entorno; configurar Brevo no se presenta como prueba de entrega.

## Tareas

### MD-H19-T01 · Preparar configuración de remitente por entorno

- [ ] Usar MD-A09 para remitente, reply-to y secretos en el mecanismo del equipo.

**Termina cuando:** Configuración trazable sin valores secretos en issue/PR.

### MD-H19-T02 · Verificar dominio y receptor autorizado

- [ ] Comprobar requisitos del proveedor y acordar destinatarios de prueba.

**Termina cuando:** Remitente válido y destinatarios autorizados registrados sin exponer secretos.

### MD-H19-T03 · Ejecutar envío y respuesta controlados

- [ ] Enviar avisos de un pedido sintético y responder al negocio.

**Termina cuando:** Evidencia real distingue aceptado/entregado y confirma recepción de la respuesta.

### MD-H19-T04 · Ensayar fallo y atención

- [ ] Probar el fallo que permita el entorno y documentar rebotes, reintento y escalación.

**Termina cuando:** El responsable puede identificar el problema y el pedido sigue consultable.

### MD-H19-T05 · Registrar habilitación del piloto

- [ ] Adjuntar resultados, entorno y responsable; preparar desactivación de avisos preservando pedidos.

**Termina cuando:** Criterios de MD-A09 satisfechos antes de activar mensajes al público.

## Validación en staging

Completar el ensayo con remitente y receptores autorizados, usando pedidos sintéticos de staging; registrar evidencia de envío, respuesta y fallo.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Registrar revisión, entorno, escenarios y resultados; un caso omitido no equivale a aprobado.
- [ ] Vincular la evidencia al issue; cerrar solo al satisfacer todos sus criterios y la validación de staging.
- [ ] Si se encuentra un defecto, resolverlo en un PR atómico a **staging** y repetir los casos afectados.
- [ ] No crear un PR documental para registrar una comprobación sin cambio de código.
- [ ] La promoción a **main** corresponde a MD-H32, tras la validación integral.

