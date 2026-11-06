# [MD-H08] Aceptar, rechazar o vencer una recogida desde el backend

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **personal autorizado**, quiero **resolver los pedidos pendientes de forma consistente** para **preparar solo lo que el negocio acepta**.

**Fase:** B · **Entregas del plan:** P06.
**Reglas de origen:** D03, D15, D18, D19.
**Áreas de referencia:** ordenes, kds, jobs, permisos. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H07, MD-A02, MD-A03, MD-A13.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Recogida programada e interfaz de atención.

## Criterios de aceptación

- [ ] **MD-H08-CA01:** Aceptar un pendiente válido cambia el estado y produce una sola proyección a KDS.
- [ ] **MD-H08-CA02:** Rechazar exige un motivo y evita preparación; vencer el plazo produce cierre sin KDS.
- [ ] **MD-H08-CA03:** Dos aceptaciones simultáneas y aceptación contra vencimiento producen un solo resultado válido.
- [ ] **MD-H08-CA04:** Un cierre o aceptación repetidos devuelven un resultado coherente y no repiten efectos de inventario.
- [ ] **MD-H08-CA05:** Una caída entre persistencia y entrega a KDS se recupera sin perder el pedido ni crear otra comanda.

## Tareas

### MD-H08-T01 · Implementar transiciones autorizadas

- [ ] Definir comandos de aceptar y rechazar con precondición de estado/versión y motivo.

**Termina cuando:** Transiciones inválidas o actores ajenos se rechazan.

### MD-H08-T02 · Coordinar aceptación y proyección

- [ ] Usar mecanismos existentes para registrar aceptación y recuperar el envío único a cocina.

**Termina cuando:** No hay ventana que deje un aceptado perdido o un pendiente en cocina.

### MD-H08-T03 · Implementar vencimiento recuperable

- [ ] Usar el plazo persistido y un trabajo recuperable que compruebe el estado antes de cerrar.

**Termina cuando:** Reinicio o ejecución tardía no acepta ni prepara un vencido.

### MD-H08-T04 · Aplicar efectos comerciales e inventario

- [ ] Ejecutar las reglas aprobadas de rechazo/vencimiento/aceptación sin alterar otros canales.

**Termina cuando:** Efectos auditables y únicos por transición.

### MD-H08-T05 · Probar carreras y recuperación

- [ ] Ejecutar aceptación doble, aceptar/vencer y fallo de proyección con PostgreSQL y mecanismos reales.

**Termina cuando:** Un único resultado comercial y proyección coherente después del reintento.

## Validación en staging

Aceptar un pendiente, rechazar otro y dejar vencer un tercero; repetir acciones y comprobar que solo el aceptado llega una vez al KDS.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

