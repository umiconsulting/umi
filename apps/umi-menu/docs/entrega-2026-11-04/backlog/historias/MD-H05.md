# [MD-H05] Publicar y pausar el menú desde Dashboard

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **administrador del negocio**, quiero **controlar publicación, recepción y modalidades desde Menú digital** para **operar el canal por sucursal**.

**Fase:** A · **Entregas del plan:** P05.
**Reglas de origen:** D07, D18, D19.
**Áreas de referencia:** dashboard, configuracion, permisos. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H01, MD-H04.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Plazo de aceptación y reglas de programación.

## Criterios de aceptación

- [ ] **MD-H05-CA01:** Menú digital aparece en la navegación acordada junto al catálogo y conserva negocio/sucursal visibles.
- [ ] **MD-H05-CA02:** Publicación, recepción y modalidades usan controles independientes conectados a la API.
- [ ] **MD-H05-CA03:** Guardar muestra éxito solo tras confirmación del servidor y conserva errores de validación visibles.
- [ ] **MD-H05-CA04:** Cambiar sucursal carga su configuración y no guarda accidentalmente el formulario anterior.
- [ ] **MD-H05-CA05:** Los permisos se reflejan en UI y servidor; pausar no oculta ni cancela pedidos existentes.

## Tareas

### MD-H05-T01 · Integrar sección y alcance en Dashboard

- [ ] Añadir la entrada con los patrones existentes y contexto de negocio/sucursal visible.

**Termina cuando:** Navegación y permisos coherentes con el Dashboard vigente.

### MD-H05-T02 · Conectar lectura y edición de controles

- [ ] Usar el contrato de MD-H01 para publicación, recepción y modalidades.

**Termina cuando:** No quedan valores de Bruma ni estado local como autoridad.

### MD-H05-T03 · Resolver carga, error y guardado

- [ ] Mostrar respuesta real y conservar campos ante fallo; prevenir guardado sobre otra sucursal.

**Termina cuando:** Error de red no muestra éxito ni pierde silenciosamente cambios.

### MD-H05-T04 · Mostrar estado efectivo del canal

- [ ] Mostrar publicación, recepción y alcance persistidos, explicando la pausa sin simular una vista pública todavía inexistente.

**Termina cuando:** El Dashboard distingue menú oculto y recepción pausada; el enlace de vista previa se incorpora en MD-H15.

### MD-H05-T05 · Verificar en navegador real

- [ ] Recorrer publicación, pausa, cambio de sucursal y permisos en escritorio/móvil.

**Termina cuando:** Capturas y acciones reales muestran persistencia tras recargar.

## Validación en staging

Un administrador publica y pausa una sucursal; otro usuario sin permiso intenta editar. Verificar persistencia al recargar, catálogo consultable mediante la API pública y rechazo del cambio no autorizado.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

