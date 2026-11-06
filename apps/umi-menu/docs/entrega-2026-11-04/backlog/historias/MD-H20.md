# [MD-H20] Calcular horarios compatibles para el carrito

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente que programa**, quiero **ver solo horas en las que todos mis productos se pueden recoger** para **hacer un pedido que el negocio pueda cumplir**.

**Fase:** D · **Entregas del plan:** P14.
**Reglas de origen:** D05, D06, D18, D19.
**Áreas de referencia:** horarios, catalogo, contratos. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H02, MD-H04, MD-A05, MD-A06, MD-A07.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Reserva, liberación a KDS y UI de selección.

## Criterios de aceptación

- [ ] **MD-H20-CA01:** El servidor calcula horas válidas según sucursal, zona horaria, aperturas, cierres y excepciones.
- [ ] **MD-H20-CA02:** Aplica la anticipación más exigente y el horizonte más corto del carrito, según las reglas aprobadas.
- [ ] **MD-H20-CA03:** La duración considera cantidades y mezcla de productos conforme MD-A05, sin tomar 20 minutos como regla fija.
- [ ] **MD-H20-CA04:** Un carrito no compatible recibe una explicación; no se cambia silenciosamente a recogida inmediata.
- [ ] **MD-H20-CA05:** La opción fuera de horario y capacidad de slots solo opera como determinen MD-A06 y MD-A07.

## Tareas

### MD-H20-T01 · Definir reglas de programación canónicas

- [ ] Representar anticipación, horizonte, elegibilidad y límite de cancelación por producto/sucursal.

**Termina cuando:** Contrato y persistencia necesarios revisados según las decisiones aprobadas.

### MD-H20-T02 · Reutilizar calendario y zona horaria

- [ ] Aplicar horario regular, excepciones y cruces de medianoche de la sucursal.

**Termina cuando:** No se usa la zona del navegador como autoridad.

### MD-H20-T03 · Calcular compatibilidad del carrito

- [ ] Aplicar cantidades, preparación, horizontes y capacidad definida por MD-A05/07.

**Termina cuando:** Una hora ofrecida satisface todos los productos.

### MD-H20-T04 · Exponer consulta de horarios y motivos

- [ ] Devolver horas elegibles y razones cuando no existan; volver a validar al reservar.

**Termina cuando:** No se promete disponibilidad permanente por una consulta anterior.

### MD-H20-T05 · Probar calendario y carritos mixtos

- [ ] Usar reloj controlado, cierres, medianoche, cantidades y mezcla elegible/no elegible.

**Termina cuando:** Resultados esperados documentados para cada regla aprobada.

## Validación en staging

Consultar horas para productos con distintas anticipaciones y un cierre excepcional; comprobar las horas y razones en zona horaria de la sucursal.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

