# [MD-H02] Definir productos y modalidades visibles en el menú

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **responsable del catálogo**, quiero **elegir qué productos se ofrecen en mesa y para recoger** para **publicar solo lo que la sucursal puede atender**.

**Fase:** A · **Entregas del plan:** P02.
**Reglas de origen:** D01, D07, D18, D19.
**Áreas de referencia:** catalogo, configuracion, contratos. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H01.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Orden visual de categorías y programación por producto.

## Criterios de aceptación

- [ ] **MD-H02-CA01:** Visibilidad digital y modalidades permitidas se guardan sobre el catálogo existente, sin duplicar productos.
- [ ] **MD-H02-CA02:** La política rechaza productos ocultos o excluidos para una modalidad. Se comprueba en la entrada pública existente de mesa; MD-H07 integra y prueba la entrada de recogida.
- [ ] **MD-H02-CA03:** Cambiar la regla de un negocio no afecta otro; se respeta la sucursal según MD-A01.
- [ ] **MD-H02-CA04:** No se altera automáticamente su venta presencial ni las reglas de otro canal.
- [ ] **MD-H02-CA05:** Productos ya presentes en pedidos conservan su representación histórica.

## Tareas

### MD-H02-T01 · Modelar reglas digitales por producto

- [ ] Definir visibilidad y modalidades en el contrato del catálogo con el alcance aprobado.

**Termina cuando:** Reglas explícitas para producto existente y producto nuevo.

### MD-H02-T02 · Persistir reglas sin duplicar el catálogo

- [ ] Añadir lectura/escritura de reglas a los dueños actuales de producto y sucursal.

**Termina cuando:** Se conserva el ID canónico y no se crean precios paralelos.

### MD-H02-T03 · Aplicar reglas al validar pedidos públicos

- [ ] Aplicar la política en la entrada existente de mesa y dejarla reutilizable para la recogida de MD-H07.

**Termina cuando:** Una solicitud de mesa manipulada se rechaza; la política cubre también la modalidad de recogida en pruebas de dominio.

### MD-H02-T04 · Conservar canales y pedidos previos

- [ ] Limitar los cambios a admisión digital y mantener snapshots de pedidos ya creados.

**Termina cuando:** Venta presencial y pedido previo siguen válidos.

### MD-H02-T05 · Probar exclusiones y alcance

- [ ] Cubrir producto oculto, modalidad prohibida, sucursal ajena y modificación tras crear un pedido.

**Termina cuando:** Las pruebas demuestran rechazo y conservación del histórico.

## Validación en staging

Ocultar un producto para mesa o excluir esa modalidad; enviar una solicitud directa al endpoint existente y verificar rechazo. La venta presencial y otra sucursal conservan sus reglas. MD-H07 comprueba recogida cuando exista su API.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

