# [MD-H25] Atender reservas programadas desde UmiPOS

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **personal del negocio**, quiero **ver y aceptar reservas futuras con su hora** para **organizar su atención sin enviarlas antes a cocina**.

**Fase:** D · **Entregas del plan:** P16.
**Reglas de origen:** D05, D15, D18, D19.
**Áreas de referencia:** pos, ordenes, horarios. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H13, MD-H21, MD-H22, MD-H23.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Reprogramar reservas sin política aprobada.

## Criterios de aceptación

- [ ] **MD-H25-CA01:** La bandeja distingue pendientes programados, reservas aceptadas y pedidos ya en preparación.
- [ ] **MD-H25-CA02:** Cada reserva muestra fecha/hora de recogida y la información necesaria para evaluar capacidad.
- [ ] **MD-H25-CA03:** Aceptar reserva no muestra preparación ni crea comanda temprana.
- [ ] **MD-H25-CA04:** Cancelaciones y liberaciones actualizan la bandeja tras reconectar sin duplicados.
- [ ] **MD-H25-CA05:** Los controles conservan el diseño vigente y usan permisos/contratos canónicos.

## Tareas

### MD-H25-T01 · Añadir lectura de reservas a la bandeja

- [ ] Consumir fechas/estado del backend y distinguir día/modalidad operativa.

**Termina cuando:** Programados no se mezclan con pendientes inmediatos sin identificación.

### MD-H25-T02 · Mostrar detalle de tiempo y preparación

- [ ] Presentar hora prometida, productos, opciones y advertencias reales de capacidad.

**Termina cuando:** El personal puede revisar el compromiso antes de aceptar.

### MD-H25-T03 · Conectar aceptación y rechazo de reserva

- [ ] Usar comandos de MD-H21 y explicar el estado reservado.

**Termina cuando:** Aceptar no ofrece falso estado de cocina.

### MD-H25-T04 · Actualizar cancelación y liberación

- [ ] Recuperar eventos/lecturas tras desconexión y mantener un único pedido.

**Termina cuando:** Transiciones de MD-H22/H23 aparecen en el lugar correcto.

### MD-H25-T05 · Validar POS nativo con reloj de prueba

- [ ] Recorrer reserva, aceptación, corte y liberación con dos sesiones.

**Termina cuando:** Misma hora y estado en POS y KDS sin envío anticipado.

## Validación en staging

Aceptar una reserva desde POS, reiniciar la sesión y llegar a la hora de liberar; comprobar el cambio de bandeja y una sola comanda.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

