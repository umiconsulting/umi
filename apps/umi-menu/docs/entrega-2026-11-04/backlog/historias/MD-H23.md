# [MD-H23] Cancelar un programado aceptado dentro de su límite

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente que programa**, quiero **cancelar directamente antes del corte y de la liberación** para **retirar mi reserva cuando todavía está permitido**.

**Fase:** D · **Entregas del plan:** P08, P14.
**Reglas de origen:** D14, D15, D18, D19.
**Áreas de referencia:** cancelacion, ordenes, jobs. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H11, MD-H12, MD-H21, MD-H22, MD-A02, MD-A04, MD-A07.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Penalizaciones automáticas y cancelación pública de una venta cobrada.

## Criterios de aceptación

- [ ] **MD-H23-CA01:** La cancelación directa exige simultáneamente hora anterior al corte y ausencia de liberación a preparación.
- [ ] **MD-H23-CA02:** Después del corte o de liberar, la acción es solicitar cancelación al personal.
- [ ] **MD-H23-CA03:** El seguimiento expone una fecha/hora concreta en la zona horaria correcta.
- [ ] **MD-H23-CA04:** Cancelación y liberación concurrentes producen un solo resultado válido, sin reaparición del cancelado en KDS.
- [ ] **MD-H23-CA05:** Reintentos y jobs antiguos no repiten efectos de inventario ni reviven la reserva.

## Tareas

### MD-H23-T01 · Definir predicado y límite persistido

- [ ] Aplicar estado y tiempo del servidor; fijar el límite según reglas del carrito.

**Termina cuando:** El corte nunca es posterior a la liberación habilitada.

### MD-H23-T02 · Integrar cancelación directa de reserva

- [ ] Extender la transición canónica con efectos de inventario y vencimiento de trabajos asociados.

**Termina cuando:** El trabajo residual verifica el estado y no libera el cancelado.

### MD-H23-T03 · Aplicar solicitud después del límite

- [ ] Reutilizar MD-H12 cuando la cancelación directa ya no procede.

**Termina cuando:** La solicitud conserva activo el pedido hasta resolución.

### MD-H23-T04 · Exponer límite y acciones al cliente

- [ ] Devolver fecha concreta y acción permitida en seguimiento y confirmación.

**Termina cuando:** El navegador no calcula una autorización distinta del servidor.

### MD-H23-T05 · Probar fronteras y carreras

- [ ] Cubrir justo antes/en/después del corte, cancelación/liberación y job atrasado.

**Termina cuando:** Resultados de borde aprobados y cero pedidos cancelados que reaparecen.

## Validación en staging

Cancelar una reserva antes del corte y ejecutar después su job antiguo; repetir el caso al liberar y comprobar la acción que ganó.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

