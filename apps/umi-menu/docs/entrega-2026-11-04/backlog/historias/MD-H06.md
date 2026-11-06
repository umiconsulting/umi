# [MD-H06] Organizar productos y categorías del menú desde Dashboard

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **responsable del catálogo**, quiero **editar visibilidad, modalidades, orden y destacados** para **presentar el menú sin mantener un catálogo duplicado**.

**Fase:** A · **Entregas del plan:** P05.
**Reglas de origen:** D07, D18, D19.
**Áreas de referencia:** dashboard, catalogo, contratos. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H02, MD-H04, MD-H05.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Crear un segundo sistema de catálogo o editor de precios.

## Criterios de aceptación

- [ ] **MD-H06-CA01:** La edición parte de productos y categorías existentes y permite visibilidad/modalidades digitales.
- [ ] **MD-H06-CA02:** El orden y los destacados se guardan con alcance definido y se reflejan en el catálogo público.
- [ ] **MD-H06-CA03:** Un producto oculto no reaparece por estar marcado como destacado.
- [ ] **MD-H06-CA04:** Cambiar precios o variantes usa la edición canónica, sin formularios duplicados inconsistentes.
- [ ] **MD-H06-CA05:** Las listas y formularios siguen el diseño vigente y funcionan en móvil.

## Tareas

### MD-H06-T01 · Añadir edición de reglas digitales al catálogo

- [ ] Conectar visibilidad/modalidades de MD-H02 en la edición existente.

**Termina cuando:** Un mismo producto conserva una sola fuente de precio y opciones.

### MD-H06-T02 · Persistir orden y destacados

- [ ] Definir contrato y almacenamiento de orden/categorías/destacados necesarios para la pantalla.

**Termina cuando:** Orden reproducible tras recargar y por alcance aprobado.

### MD-H06-T03 · Aplicar orden en la lectura pública

- [ ] Extender MD-H04 para devolver orden y destacados sin omitir reglas de visibilidad.

**Termina cuando:** Oculto nunca aparece por su marca de destacado.

### MD-H06-T04 · Conectar la pantalla de contenido

- [ ] Permitir seleccionar y reordenar con el patrón de controles existente; enlazar a edición canónica.

**Termina cuando:** Operación accesible sin depender solo de arrastre.

### MD-H06-T05 · Validar cambios de contenido

- [ ] Probar guardar/reabrir, permisos, producto eliminado u oculto y vista pública.

**Termina cuando:** UI y API coinciden en categorías y orden.

## Validación en staging

Reordenar una categoría, destacar un producto y luego ocultarlo; comprobar que el público refleja las tres operaciones sin duplicados.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

