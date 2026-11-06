# [MD-H15] Consultar y armar el carrito con el diseño final

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente**, quiero **navegar el menú real y personalizar productos** para **revisar mi pedido en celular o escritorio**.

**Fase:** C · **Entregas del plan:** P10.
**Reglas de origen:** D01, D18, D19.
**Áreas de referencia:** frontend_menu, catalogo. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H04, MD-H06, MD-A10.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Envío de pedidos, correos y rediseño general.

## Criterios de aceptación

- [ ] **MD-H15-CA01:** El catálogo, detalle y carrito conservan la dirección v6 y menu-redesign.css aprobada.
- [ ] **MD-H15-CA02:** Negocio, sucursal, categorías, imágenes, productos, precios y opciones vienen de la API.
- [ ] **MD-H15-CA03:** Buscar y filtrar categorías funciona sin perder selección del carrito; opciones obligatorias son visibles.
- [ ] **MD-H15-CA04:** Carrito muestra cantidades, extras, indicaciones y total provisional; el servidor validará el envío.
- [ ] **MD-H15-CA05:** Carga, catálogo vacío, agotado, oculto y recepción pausada tienen estados claros, accesibles y adaptables.

## Tareas

### MD-H15-T01 · Integrar el frontend en la ubicación acordada

- [ ] Crear la superficie pública según MD-A10 y reutilizar el diseño local sin copiar el visor de marketing como producto. Preparar una URL de revisión vinculada a la API de staging para probar este PR, antes de la publicación estable de MD-H30.

**Termina cuando:** Ruta local conectada y configuración de API por entorno.

### MD-H15-T02 · Conectar catálogo y navegación

- [ ] Renderizar identidad, categorías, búsqueda, destacados y disponibilidad del contrato público. Incorporar en Dashboard el enlace de vista previa de la sucursal, usando esa misma identidad.

**Termina cuando:** Sin datos fijos de Bruma; la vista previa abre el catálogo de la sucursal seleccionada y refleja su pausa.

### MD-H15-T03 · Conectar variantes y modificadores

- [ ] Mostrar opciones canónicas, reglas obligatorias, extras e indicaciones con precio provisional.

**Termina cuando:** Selecciones inválidas se explican antes de agregar.

### MD-H15-T04 · Implementar carrito y estados de red

- [ ] Mantener líneas/cantidades y revisión del total; distinguir vacío, agotado, error y pausa.

**Termina cuando:** Error de carga no se muestra como catálogo vacío ni como pedido enviado.

### MD-H15-T05 · Comparar visual e interacción

- [ ] Probar móvil/escritorio, teclado, nombres largos y cambio de opciones usando capturas aprobadas.

**Termina cuando:** Catálogo, producto y carrito conservan composición y controles; recursos y licencias incluidos.

## Validación en staging

Abrir catálogo real de prueba a 390 y 1440 px, elegir variante/extras y ajustar carrito. Comparar capturas con la referencia entregada. Desde Dashboard, abrir la vista previa de la sucursal correcta y comprobar que una pausa permite consultar pero no enviar.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

