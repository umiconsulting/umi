# [MD-H09] Configurar el plazo de aceptación en Dashboard

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **administrador del negocio**, quiero **establecer cuánto tiempo puede esperar una recogida** para **evitar pedidos pendientes sin atención indefinida**.

**Fase:** B · **Entregas del plan:** P06D.
**Reglas de origen:** D03, D07, D18, D19.
**Áreas de referencia:** dashboard, configuracion, horarios. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H05, MD-H08, MD-A13.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Reglas de programación y de horarios fuera de atención.

## Criterios de aceptación

- [ ] **MD-H09-CA01:** El plazo se edita en Menú digital con su unidad y alcance visibles.
- [ ] **MD-H09-CA02:** Valores fuera de los límites aprobados se rechazan en UI y servidor.
- [ ] **MD-H09-CA03:** El cambio respeta la política acordada para pedidos ya pendientes.
- [ ] **MD-H09-CA04:** La sucursal debe tener un valor operativo válido antes de activar recogida inmediata.
- [ ] **MD-H09-CA05:** Guardar y recargar muestra el valor confirmado por la API.

## Tareas

### MD-H09-T01 · Exponer lectura y edición del plazo

- [ ] Consumir el contrato de MD-H08 y delimitar el ajuste respecto a horarios y recepción.

**Termina cuando:** Respuesta indica valor y alcance efectivo.

### MD-H09-T02 · Añadir el control a Dashboard

- [ ] Mostrar unidad, límites y efecto sobre pendientes de acuerdo con MD-A13.

**Termina cuando:** Texto describe la política real sin un valor universal inventado.

### MD-H09-T03 · Validar activación y permisos

- [ ] Impedir configuración inválida y proteger edición por negocio/sucursal.

**Termina cuando:** Servidor rechaza límites inválidos aunque se manipule el formulario.

### MD-H09-T04 · Aplicar el cambio a pedidos según política

- [ ] Conservar o recalcular los plazos existentes solo como determine MD-A13.

**Termina cuando:** Cambio de ajuste no deja pedidos sin fecha de vencimiento.

### MD-H09-T05 · Probar configuración y vencimiento

- [ ] Guardar un valor válido y otro inválido; crear pedidos antes/después del cambio.

**Termina cuando:** Fechas de vencimiento y UI coinciden con la regla aprobada.

## Validación en staging

Cambiar el plazo con un pedido pendiente y crear otro; comprobar fechas efectivas y vencimiento de ambos según la política acordada.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

