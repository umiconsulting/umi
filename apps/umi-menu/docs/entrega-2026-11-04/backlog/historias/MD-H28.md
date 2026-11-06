# [MD-H28] Controlar admisión cuando no hay atención disponible

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **responsable de operación**, quiero **pausar nuevas solicitudes cuando la sucursal no pueda atenderlas** para **evitar pedidos que quedan abandonados**.

**Fase:** B · **Entregas del plan:** P06, P11, P12.
**Reglas de origen:** D03, D04, D07, D18, D19.
**Áreas de referencia:** dispositivos, horarios, ordenes. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H01, MD-H07, MD-A08.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Asumir presencia humana a partir de un dispositivo autenticado o añadir biometría.

## Criterios de aceptación

- [ ] **MD-H28-CA01:** La política distingue cierre previsto, pausa manual y falta de atención durante horario de servicio.
- [ ] **MD-H28-CA02:** La señal de disponibilidad es la aprobada en MD-A08; last_seen_at no se interpreta por sí solo como personal disponible.
- [ ] **MD-H28-CA03:** La admisión inmediata se aplica en servidor y afecta solo al canal/sucursal definidos.
- [ ] **MD-H28-CA04:** Menú y seguimiento siguen disponibles; pedidos aceptados no se cancelan por la pausa.
- [ ] **MD-H28-CA05:** Recuperar disponibilidad usa una regla explícita y observable, sin oscilación o reanudación accidental.

## Tareas

### MD-H28-T01 · Implementar la señal acordada

- [ ] Revisar sesiones/dispositivos y construir solo la condición definida por MD-A08.

**Termina cuando:** Se puede distinguir el caso operativo con evidencia.

### MD-H28-T02 · Resolver disponibilidad efectiva

- [ ] Combinar horario, pausa manual y señal operativa con precedencia aprobada.

**Termina cuando:** Estado efectivo y motivo son legibles por los consumidores.

### MD-H28-T03 · Aplicar admisión a entradas públicas

- [ ] Integrar el guard de canal/sucursal en mesa y recogida sin cerrar consulta o seguimiento.

**Termina cuando:** La solicitud directa tampoco evade una pausa aplicable.

### MD-H28-T04 · Añadir recuperación y observación

- [ ] Definir reactivación conforme a política y registrar incidentes operativos sin borrar pedidos.

**Termina cuando:** El responsable conoce motivo y momento de pausa/reactivación.

### MD-H28-T05 · Probar caída y recuperación

- [ ] Simular condición de indisponibilidad, cierre y reconexión usando fuentes reales de prueba.

**Termina cuando:** Sin nuevos pedidos indebidos; pedidos aceptados intactos.

## Validación en staging

Durante horario abierto, simular la condición aprobada de falta de atención; comprobar pausa solo del canal, consulta disponible y recuperación definida. Enviar solicitudes directas de mesa y recogida para comprobar la aplicación de la política sin depender de la UI.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

