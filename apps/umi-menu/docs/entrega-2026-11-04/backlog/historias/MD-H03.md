# [MD-H03] Pedir variantes válidas desde el QR de mesa

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente en mesa**, quiero **elegir una variante y sus opciones** para **recibir el producto correcto con el precio correcto**.

**Fase:** A · **Entregas del plan:** P03.
**Reglas de origen:** D01, D04, D18, D19.
**Áreas de referencia:** table_order, catalogo, contratos, kds. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: no hay dependencia funcional previa en este backlog; revisar staging e instrucciones vigentes.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Recogida, aceptación nueva y cambios de diseño.

## Criterios de aceptación

- [ ] **MD-H03-CA01:** Una variante válida del producto de la mesa puede enviarse y sustituye el rechazo actual VARIANT_NOT_AVAILABLE para ese caso.
- [ ] **MD-H03-CA02:** El servidor calcula precio y valida opciones obligatorias, límites y combinaciones.
- [ ] **MD-H03-CA03:** Una variante de otro producto o negocio se rechaza, incluso si el cliente modifica la solicitud.
- [ ] **MD-H03-CA04:** POS y KDS conservan la identidad de la variante y los modificadores.
- [ ] **MD-H03-CA05:** Reintentar el mismo envío produce un pedido; los productos sin variantes mantienen su comportamiento.

## Tareas

### MD-H03-T01 · Extender el contrato público de mesa

- [ ] Revisar table-order y representar la selección de variante sin romper clientes de productos simples.

**Termina cuando:** Contrato y consumidores compatibles; limitación anterior actualizada.

### MD-H03-T02 · Resolver variante y precio en servidor

- [ ] Consultar la variante canónica dentro del negocio/sucursal y validar que pertenece al producto.

**Termina cuando:** Precio independiente de los importes enviados por el navegador.

### MD-H03-T03 · Validar modificadores y disponibilidad

- [ ] Aplicar grupos obligatorios, máximos y disponibilidad a la combinación elegida.

**Termina cuando:** Se rechazan selección incompleta y combinación no permitida.

### MD-H03-T04 · Conservar opciones hasta POS y KDS

- [ ] Transmitir la selección por el escritor/proyector existente y el contrato de lectura.

**Termina cuando:** La variante y extras aparecen en el mismo pedido comercial y sus estaciones.

### MD-H03-T05 · Ampliar integración de mesa

- [ ] Añadir casos válidos, inválidos y repetidos a la suite HTTP/PostgreSQL de mesa.

**Termina cuando:** Pasan variante, aislamiento, total, idempotencia y regresión de producto simple.

## Validación en staging

Usar un QR de prueba para pedir una variante con un extra; comprobar el total y su detalle en POS y en la estación.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

