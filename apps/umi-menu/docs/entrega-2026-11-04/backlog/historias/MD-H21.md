# [MD-H21] Registrar y aceptar una recogida programada sin prepararla antes

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **personal del negocio**, quiero **aceptar una recogida futura como reserva** para **organizar la preparación para la hora prometida**.

**Fase:** D · **Entregas del plan:** P14.
**Reglas de origen:** D05, D15, D18, D19.
**Áreas de referencia:** ordenes, horarios, inventario. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H07, MD-H08, MD-H18, MD-H20, MD-A02, MD-A03, MD-A06, MD-A13.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Worker de liberación y cambio de hora posterior a la reserva.

## Criterios de aceptación

- [ ] **MD-H21-CA01:** Enviar un programado valida nuevamente la hora, el carrito y la capacidad acordada.
- [ ] **MD-H21-CA02:** El pedido guarda fecha de recogida, zona horaria y tiempos derivados necesarios para operar.
- [ ] **MD-H21-CA03:** Aceptar deja el pedido reservado sin proyección a KDS; rechazar/vencer aplica reglas de inventario aprobadas.
- [ ] **MD-H21-CA04:** Si se permiten envíos fuera de horario, el plazo de aceptación sigue MD-A06; si no, el servidor rechaza el caso.
- [ ] **MD-H21-CA05:** Reintentos y aceptación doble conservan una reserva; la recepción pública sigue desactivada hasta completar liberación y atención.

## Tareas

### MD-H21-T01 · Extender el contrato de pedido con horario

- [ ] Representar recogida y tiempos operativos sin confundir reserva con preparación comercial.

**Termina cuando:** Versiones de POS/Dashboard leen de forma compatible.

### MD-H21-T02 · Validar y reservar la hora transaccionalmente

- [ ] Revalidar calendario, reglas/capacidad e inventario al confirmar.

**Termina cuando:** Dos envíos concurrentes no exceden la política aprobada ni duplican reserva.

### MD-H21-T03 · Resolver aceptación de programados

- [ ] Separar la transición aceptado/reservado de la aceptación inmediata de MD-H08.

**Termina cuando:** Aceptación futura genera cero trabajo KDS temprano.

### MD-H21-T04 · Aplicar vencimiento y cierre de reserva

- [ ] Usar reglas dentro/fuera de horario y registrar el resultado terminal.

**Termina cuando:** Un reservado rechazado o vencido no podrá liberarse.

### MD-H21-T05 · Adaptar avisos a la reserva programada

- [ ] Emitir los eventos del pedido usando MD-H18 y mostrar fecha de recogida, límite y espera de aceptación cuando aplique.

**Termina cuando:** El correo de aceptación confirma la reserva y no afirma que cocina ya prepara.

### MD-H21-T06 · Probar persistencia y transiciones

- [ ] Cubrir horario cambiado, petición repetida, aceptación doble y aceptación fuera de atención.

**Termina cuando:** Reserva única con fechas coherentes y sin proyección anticipada.

## Validación en staging

Crear y aceptar un pedido futuro; reiniciar el worker/API y confirmar que permanece reservado con su hora y sin comanda.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

