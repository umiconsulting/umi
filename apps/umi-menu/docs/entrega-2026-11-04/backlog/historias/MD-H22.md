# [MD-H22] Liberar un programado a preparación a la hora correcta

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **personal de cocina y barra**, quiero **recibir el pedido aceptado cuando corresponde prepararlo** para **cumplir la recogida sin preparar demasiado pronto**.

**Fase:** D · **Entregas del plan:** P14.
**Reglas de origen:** D15, D18, D19.
**Áreas de referencia:** jobs, ordenes, kds. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H21, MD-A05, MD-A07.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Rediseño de colas generales o promesas de preparación sin calendario aprobado.

## Criterios de aceptación

- [ ] **MD-H22-CA01:** Un programado aceptado llega a las estaciones cuando se alcanza la hora de liberación válida.
- [ ] **MD-H22-CA02:** Pendiente, cancelado, rechazado y vencido nunca se liberan por un trabajo atrasado.
- [ ] **MD-H22-CA03:** Reejecutar el trabajo o tener dos workers produce una sola proyección.
- [ ] **MD-H22-CA04:** Una caída antes/después de proyectar se recupera con una política explícita para trabajo atrasado.
- [ ] **MD-H22-CA05:** La liberación registra sus tiempos reales y permite detectar retrasos sin adelantar pedidos.

## Tareas

### MD-H22-T01 · Elegir mecanismo durable existente

- [ ] Revisar jobs/BullMQ/schedulers y seleccionar el dueño del trabajo de liberación, sin crear infraestructura innecesaria.

**Termina cuando:** Diseño especifica reejecución, reloj y recuperación de trabajo atrasado.

### MD-H22-T02 · Programar trabajos desde reserva aceptada

- [ ] Crear trabajo identificable por pedido/versión y hora calculada.

**Termina cuando:** El job no se crea como sustituto de una reserva persistida.

### MD-H22-T03 · Validar estado y liberar una vez

- [ ] Comprobar hora/estado dentro de la coordinación transaccional y usar proyector existente.

**Termina cuando:** Una carrera con cierre no deja una comanda inválida.

### MD-H22-T04 · Recuperar fallos y observar retrasos

- [ ] Registrar ejecución, proyección y retraso; recuperar sin repetición comercial.

**Termina cuando:** El responsable distingue pendiente de trabajo y fallo terminal.

### MD-H22-T05 · Probar workers concurrentes y reloj

- [ ] Ejecutar antes/en/después de la hora, con duplicados y caídas alrededor de la proyección.

**Termina cuando:** Una sola preparación y ningún pedido terminal liberado.

## Validación en staging

Aceptar un programado sintético, adelantar el reloj de prueba y ejecutar/repetir el worker; comprobar una proyección en las estaciones correctas.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

