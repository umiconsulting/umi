# [MD-H04] Consultar el catálogo público de una sucursal

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente**, quiero **consultar el menú publicado del negocio correcto** para **ver productos, precios y modalidades vigentes**.

**Fase:** A · **Entregas del plan:** P04.
**Reglas de origen:** D01, D07, D18, D19.
**Áreas de referencia:** table_order, catalogo, horarios, contratos. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H01, MD-H02, MD-H03, MD-A10.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Diseño del frontend y envío de pedidos nuevos.

## Criterios de aceptación

- [ ] **MD-H04-CA01:** La ruta pública resuelve una sola sucursal y devuelve solo los campos públicos acordados.
- [ ] **MD-H04-CA02:** Un menú no publicado no expone su catálogo; un menú publicado con recepción pausada sigue visible como consulta.
- [ ] **MD-H04-CA03:** Categorías, variantes, opciones, precios y disponibilidad proceden del catálogo canónico.
- [ ] **MD-H04-CA04:** La respuesta identifica negocio, sucursal, moneda, horario y modalidades sin exponer contactos de clientes o configuración privada.
- [ ] **MD-H04-CA05:** La política de caché no mezcla sucursales ni mantiene una admisión obsoleta al enviar un pedido.

## Tareas

### MD-H04-T01 · Definir identidad pública y DTO mínimo

- [ ] Aplicar MD-A10 para ruta/sucursal y fijar la respuesta pública separada del DTO administrativo.

**Termina cuando:** Lista de campos revisada y exclusión explícita de datos privados.

### MD-H04-T02 · Componer el catálogo canónico

- [ ] Unir categorías, productos, variantes y opciones con las reglas digitales vigentes.

**Termina cuando:** Sin precios o categorías paralelos al catálogo existente.

### MD-H04-T03 · Resolver publicación, pausa y horario

- [ ] Devolver el estado consultable y de admisión sin convertir una pausa en borrado del menú.

**Termina cuando:** Estados publicado, oculto, abierto y pausado distinguibles.

### MD-H04-T04 · Definir caché e invalidación por alcance

- [ ] Configurar lectura pública por sucursal y validar nuevamente al crear el pedido.

**Termina cuando:** Prueba de cambio de visibilidad no entrega el catálogo de otra sucursal.

### MD-H04-T05 · Probar el contrato público

- [ ] Ejecutar casos de publicación, filtros de modalidad, campos privados y aislamiento.

**Termina cuando:** Respuesta mínima y coherente con precio/opciones del escritor.

## Validación en staging

Abrir dos enlaces de sucursal; pausar solo uno y comprobar que ambos catálogos conservan su identidad y que solo cambia la admisión correspondiente.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

