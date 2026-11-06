# [MD-H29] Marcar listo solo cuando terminan todas las estaciones

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente y personal**, quiero **ver el estado global correcto del pedido** para **entregar o recoger cuando cocina y barra han terminado**.

**Fase:** B · **Entregas del plan:** P06, P09, P13.
**Reglas de origen:** D10, D16, D18, D19.
**Áreas de referencia:** kds, ordenes, pos. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H08.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Nueva cola de KDS o indicadores permanentes adicionales de origen.

## Criterios de aceptación

- [ ] **MD-H29-CA01:** Cada estación recibe solo sus productos según el enrutamiento existente.
- [ ] **MD-H29-CA02:** Terminar barra sin terminar cocina mantiene el pedido agregado en preparación.
- [ ] **MD-H29-CA03:** La última estación pendiente completa el estado global una sola vez.
- [ ] **MD-H29-CA04:** Cancelaciones autorizadas ajustan el agregado según la verdad comercial; eventos atrasados no reviven líneas canceladas.
- [ ] **MD-H29-CA05:** Se conservan modalidad y detalle, sin nueva insignia permanente de origen en KDS.

## Tareas

### MD-H29-T01 · Contrastar y reutilizar agregado existente

- [ ] Verificar cómo KDS deriva estado comercial y resolver solo las brechas del canal nuevo.

**Termina cuando:** No se crea una segunda autoridad de listo.

### MD-H29-T02 · Conservar proyección por estación

- [ ] Comprobar variantes, modificadores y rutas del pedido aceptado.

**Termina cuando:** Barra y cocina ven sus productos correctos.

### MD-H29-T03 · Coordinar actualización global única

- [ ] Actualizar orden/evento al terminar todos los elementos requeridos según estados vigentes.

**Termina cuando:** No se emite listo por completar una sola estación.

### MD-H29-T04 · Integrar cancelación y eventos tardíos

- [ ] Usar estados/versiones canónicos para no contar ni reactivar trabajo cancelado.

**Termina cuando:** Un evento retrasado no contradice una cancelación.

### MD-H29-T05 · Probar varias estaciones y dispositivos

- [ ] Ejecutar finalización parcial, final simultáneo, duplicado y línea cancelada.

**Termina cuando:** Una transición global válida y lectura consistente en POS/seguimiento.

## Validación en staging

Enviar alimento y bebida, terminar barra primero y comprobar que sigue en preparación; terminar cocina y verificar un único listo.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

