# [MD-H31] Certificar los flujos completos en staging

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **responsable de validación**, quiero **probar mesa, recogida y programación en staging** para **tener evidencia antes de promover a main**.

**Fase:** E · **Entregas del plan:** P19.
**Reglas de origen:** D18, D19.
**Áreas de referencia:** operacion, pos, kds, frontend_menu. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H14, MD-H16, MD-H17, MD-H18, MD-H19, MD-H23, MD-H24, MD-H25, MD-H26, MD-H27, MD-H28, MD-H29, MD-H30, MD-H33, MD-A11.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Un PR documental P00 o una promoción automática a main.

## Criterios de aceptación

- [ ] **MD-H31-CA01:** La revisión desplegada y las versiones de clientes y esquema quedan identificadas.
- [ ] **MD-H31-CA02:** Los tres flujos completos funcionan con datos sintéticos: creación, preparación, seguimiento, cobro y entrega.
- [ ] **MD-H31-CA03:** Se prueban rechazo, vencimiento, cancelaciones, varias estaciones, reintento, caída y fallo de correo.
- [ ] **MD-H31-CA04:** La evidencia usa navegador y POS/KDS nativos, no la maqueta React como sustituto.
- [ ] **MD-H31-CA05:** Los defectos bloqueantes se resuelven mediante PRs atómicos a staging y se repiten los casos afectados antes de recomendar promoción.

## Tareas

### MD-H31-T01 · Preparar datos y matriz de staging

- [ ] Identificar negocio/sucursal sintéticos, roles, productos, calendario y revisiones de API/POS/esquema.

**Termina cuando:** Matriz ejecutable ligada a los criterios del backlog.

### MD-H31-T02 · Ejecutar recorridos de mesa e inmediato

- [ ] Crear pedidos y comprobar aviso, aceptación según modalidad, estaciones, seguimiento, pago y entrega.

**Termina cuando:** Un pedido comercial por envío y cobro correcto.

### MD-H31-T03 · Ejecutar programación y cancelaciones

- [ ] Probar calendario, reserva, corte, liberación y carreras con reloj controlado donde sea posible.

**Termina cuando:** Ninguna preparación anticipada ni reaparición de cancelados.

### MD-H31-T04 · Ensayar fallos y recuperación

- [ ] Probar indisponibilidad, reintento, correo fallido, reconexión y reversión compatible.

**Termina cuando:** Pedidos existentes preservados y fallos observables.

### MD-H31-T05 · Registrar resultados y cerrar defectos

- [ ] Adjuntar resultados por criterio, abrir referencias de defectos que correspondan y repetir el caso tras el PR a staging.

**Termina cuando:** Recomendación de promoción basada en evidencia completa; faltantes figuran como no validados.

## Validación en staging

Este issue es la validación integral en staging. No se cierra con pruebas locales ni con screenshots del prototipo. Contrastar pedidos digitales y presenciales en historial y reportes, comprobando que solo las ventas cobradas aportan ingreso.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Registrar revisión, entorno, escenarios y resultados; un caso omitido no equivale a aprobado.
- [ ] Vincular la evidencia al issue; cerrar solo al satisfacer todos sus criterios y la validación de staging.
- [ ] Si se encuentra un defecto, resolverlo en un PR atómico a **staging** y repetir los casos afectados.
- [ ] No crear un PR documental para registrar una comprobación sin cambio de código.
- [ ] La promoción a **main** corresponde a MD-H32, tras la validación integral.

