# [MD-H17] Enviar y seguir una recogida inmediata desde el menú

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente que recoge**, quiero **confirmar mi carrito y contacto y seguir su aceptación** para **saber cuándo pasar al negocio**.

**Fase:** C · **Entregas del plan:** P12.
**Reglas de origen:** D02, D03, D11, D13, D14, D18, D19.
**Áreas de referencia:** frontend_menu, ordenes. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H09, MD-H10, MD-H11, MD-H12, MD-H13, MD-H15, MD-H28.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Programación y verificación de identidad por contacto.

## Criterios de aceptación

- [ ] **MD-H17-CA01:** El formulario pide nombre, teléfono y correo con validación y revisión, sin OTP ni registro obligatorio.
- [ ] **MD-H17-CA02:** Confirmar explica pago en negocio y espera de aceptación; una respuesta pendiente no se presenta como aceptada.
- [ ] **MD-H17-CA03:** El cliente puede abrir el enlace privado, recargar y recuperar el estado tras una desconexión.
- [ ] **MD-H17-CA04:** Cancelar pendiente y solicitar cancelación posterior reflejan las acciones que permite la API.
- [ ] **MD-H17-CA05:** Un cambio de precio/disponibilidad antes de enviar requiere revisión; reintento no duplica el pedido.

## Tareas

### MD-H17-T01 · Añadir correo y contacto al diseño aprobado

- [ ] Completar el formulario interactivo con nombre/teléfono/correo y revisión visible.

**Termina cuando:** Se conserva la composición del menú; no aparece OTP.

### MD-H17-T02 · Conectar envío idempotente

- [ ] Usar el contrato de pendiente y tratar validación, revisión de precio y resultado desconocido.

**Termina cuando:** Un doble clic o reintento no genera otro pedido.

### MD-H17-T03 · Conectar seguimiento privado

- [ ] Renderizar estados, líneas, total y acciones permitidas de la proyección pública.

**Termina cuando:** Recarga conserva acceso al pedido correcto aunque no llegue correo.

### MD-H17-T04 · Conectar cancelación y solicitud

- [ ] Confirmar acción y mostrar resolución real o espera del negocio.

**Termina cuando:** No se anuncia cancelación por una solicitud todavía pendiente.

### MD-H17-T05 · Recorrer el flujo en navegador y POS

- [ ] Probar correo inválido, corrección, pérdida de conexión, aceptación y cancelación en ambos formatos.

**Termina cuando:** Evidencia del mismo pedido desde cliente y personal.

## Validación en staging

Enviar una recogida con correo de prueba, abrir su enlace en otra pestaña y aceptar desde POS; verificar cambios y ausencia de duplicados.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

