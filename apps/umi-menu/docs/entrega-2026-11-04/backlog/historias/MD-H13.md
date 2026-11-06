# [MD-H13] Atender pendientes y cancelaciones desde UmiPOS

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **personal del negocio**, quiero **ver, escuchar y resolver pedidos del menú** para **atender a tiempo sin cambiar de aplicación**.

**Fase:** B · **Entregas del plan:** P09.
**Reglas de origen:** D03, D08, D09, D14, D18, D19.
**Áreas de referencia:** pos, ordenes, cancelacion. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H08, MD-H12.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Cobro y administración de programación.

## Criterios de aceptación

- [ ] **MD-H13-CA01:** Un nuevo pendiente aparece con contador y alerta sonora conforme a la operación del POS.
- [ ] **MD-H13-CA02:** El detalle muestra productos, variante/opciones, total, origen, modalidad, contacto y plazo aplicable.
- [ ] **MD-H13-CA03:** Aceptar/rechazar usan la API y muestran resultado real; rechazo exige motivo.
- [ ] **MD-H13-CA04:** Las solicitudes de cancelación se distinguen de pedidos cancelados y respetan autorizaciones.
- [ ] **MD-H13-CA05:** Reconexión y dos dispositivos no duplican pedidos ni aceptaciones; al cargar pedidos antiguos no se reproduce una tormenta de alertas.

## Tareas

### MD-H13-T01 · Integrar bandeja con datos reales

- [ ] Extender la superficie nativa de entrantes y lecturas por sucursal para pendientes y solicitudes.

**Termina cuando:** No depende de los fixtures React del recorrido.

### MD-H13-T02 · Añadir contador y aviso sonoro

- [ ] Usar identificador/versión de evento para avisar de nuevos pendientes sin repetir cada refresco.

**Termina cuando:** Un nuevo pedido genera aviso; reconectar no reproduce todos los antiguos.

### MD-H13-T03 · Conectar aceptar y rechazar

- [ ] Bloquear doble envío en UI, usar comandos idempotentes y presentar conflictos de estado.

**Termina cuando:** No se muestra aceptación local antes de respuesta canónica.

### MD-H13-T04 · Conectar resolución de cancelaciones

- [ ] Mostrar solicitud activa, motivo y autorización existente según estado.

**Termina cuando:** Una solicitud rechazada mantiene el pedido en su bandeja operativa.

### MD-H13-T05 · Verificar en POS nativo y dos sesiones

- [ ] Ampliar pruebas de entrantes y recorrer aceptación, rechazo, solicitud y reconexión.

**Termina cuando:** Evidencia nativa con estados coherentes en ambos dispositivos.

## Validación en staging

Con dos POS de prueba, enviar un pendiente, comprobar sonido/contador, aceptarlo desde uno y verificar actualización del otro sin duplicar KDS.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

