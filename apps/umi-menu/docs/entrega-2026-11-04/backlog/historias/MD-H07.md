# [MD-H07] Registrar una recogida pendiente sin enviarla a cocina

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente que recoge**, quiero **enviar mi carrito y recibir un número de pedido pendiente** para **saber que el negocio lo recibió sin darlo por aceptado**.

**Fase:** B · **Entregas del plan:** P06.
**Reglas de origen:** D02, D03, D08, D11, D18, D19.
**Áreas de referencia:** ordenes, table_order, contratos, inventario. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H01, MD-H02, MD-H03, MD-A02, MD-A03, MD-A12, MD-A13.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Pantalla pública, aceptación del personal y envío de correo.

## Criterios de aceptación

- [ ] **MD-H07-CA01:** El servidor valida alcance, recepción, visibilidad/modalidad de cada producto, contacto y total antes de registrar un pedido pendiente.
- [ ] **MD-H07-CA02:** El pendiente conserva nombre, teléfono y correo, origen digital y modalidad, sin asociar identidad por coincidencia de contacto.
- [ ] **MD-H07-CA03:** Crear o reintentar un pendiente no proyecta trabajo al KDS.
- [ ] **MD-H07-CA04:** La respuesta recupera el mismo pedido ante reintento y distingue resultado desconocido de rechazo definitivo.
- [ ] **MD-H07-CA05:** El plazo de aceptación y los efectos de inventario siguen MD-A02 y MD-A13; las rutas nuevas permanecen desactivadas hasta completar el flujo.

## Tareas

### MD-H07-T01 · Definir recepción y transacción de pendiente

- [ ] Concretar contrato, estado y campos necesarios según MD-A03; incluir idempotencia y plazo aplicable.

**Termina cuando:** Modelo compatible con el escritor y clientes actuales.

### MD-H07-T02 · Validar carrito y contacto

- [ ] Aplicar reglas digitales, cálculo canónico, formatos y límites; no crear identidad comercial por teléfono/correo.

**Termina cuando:** Error de validación no crea pedido ni reserva parcial.

### MD-H07-T03 · Persistir pedido sin proyección anticipada

- [ ] Introducir la condición de canal/estado que impide la proyección del pendiente sin cambiar mesa/POS existentes.

**Termina cuando:** Pedido pendiente guardado y cero trabajo de cocina para ese pedido.

### MD-H07-T04 · Aplicar inventario e idempotencia acordados

- [ ] Ejecutar la política aprobada dentro de la transacción y recuperar el resultado del envío repetido.

**Termina cuando:** Dos solicitudes equivalentes producen un pedido y un efecto de stock.

### MD-H07-T05 · Probar creación y regresiones con PostgreSQL

- [ ] Cubrir timeout/reintento, producto oculto o excluido de recogida mediante petición directa, recepción pausada, contacto mal formado, negocio ajeno y mesa/POS actuales.

**Termina cuando:** Pruebas demuestran persistencia y ausencia de KDS anticipado.

## Validación en staging

Enviar dos veces el mismo carrito de recogida; verificar un pedido pendiente, total canónico, contacto aislado y ninguna comanda. Ocultar o excluir de recogida un producto y verificar rechazo por la API directa, manteniendo su venta presencial.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

