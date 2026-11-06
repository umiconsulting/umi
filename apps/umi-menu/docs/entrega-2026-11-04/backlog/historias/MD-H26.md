# [MD-H26] Elegir una fecha de recogida y seguir el pedido programado

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente que programa**, quiero **elegir una hora compatible y conocer mi límite de cancelación** para **planear mi recogida con información clara**.

**Fase:** D · **Entregas del plan:** P17.
**Reglas de origen:** D02, D05, D06, D11, D14, D18, D19.
**Áreas de referencia:** frontend_menu, horarios, ordenes. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H17, MD-H20, MD-H21, MD-H22, MD-H23, MD-H24, MD-H25.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Modificar hora de una reserva ya aceptada sin nueva decisión de producto.

## Criterios de aceptación

- [ ] **MD-H26-CA01:** El cliente puede elegir inmediato o programado cuando la sucursal y el carrito lo permiten.
- [ ] **MD-H26-CA02:** Las fechas/horas provienen del servidor y se revalidan al confirmar.
- [ ] **MD-H26-CA03:** Confirmación y seguimiento muestran recogida, zona horaria comprensible, pago en negocio y corte de cancelación.
- [ ] **MD-H26-CA04:** El estado recibido sigue pendiente; aceptado se presenta como reserva hasta liberación.
- [ ] **MD-H26-CA05:** Un carrito incompatible, horario ya no válido o límite vencido ofrece una respuesta concreta sin cambiar silenciosamente la modalidad.

## Tareas

### MD-H26-T01 · Integrar elección de modalidad y horarios

- [ ] Consumir elegibilidad y slots del carrito conservando el diseño aprobado.

**Termina cuando:** No se hardcodean siete días ni horarios de Bruma.

### MD-H26-T02 · Mostrar confirmación de compromiso

- [ ] Presentar contacto, fecha/hora, total y corte antes del envío.

**Termina cuando:** El cliente puede corregir datos y horario.

### MD-H26-T03 · Conectar reserva idempotente

- [ ] Enviar la selección y tratar conflicto de horario/stock/precio con revisión visible.

**Termina cuando:** Reintento recupera la misma reserva.

### MD-H26-T04 · Mostrar seguimiento y cancelación temporal

- [ ] Usar acciones/fechas del servidor para reservar, preparar y cancelar/solicitar.

**Termina cuando:** No cambia autorización por el reloj local del cliente.

### MD-H26-T05 · Recorrer casos completos en móvil/escritorio

- [ ] Probar otro día, carrito mixto, cierre, cambio de hora disponible y cancelación de borde.

**Termina cuando:** Cliente, POS y KDS muestran fecha y estado coherentes.

## Validación en staging

Programar para otro día con producto elegible; aceptar, cancelar dentro del corte y repetir con una reserva que llega a preparación.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

