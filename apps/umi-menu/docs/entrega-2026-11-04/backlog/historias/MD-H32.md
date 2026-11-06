# [MD-H32] Promover lo validado a main y activar el piloto controlado

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **responsable de lanzamiento**, quiero **promover la versión probada y activar una sucursal** para **publicar el menú con una operación preparada**.

**Fase:** E · **Entregas del plan:** P19.
**Reglas de origen:** D18, D19.
**Áreas de referencia:** despliegue, operacion. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H31, MD-A09, MD-A10, MD-A11.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Autorizar ahora la publicación o convertir cada tarea de desarrollo en PR directo a main.

## Criterios de aceptación

- [ ] **MD-H32-CA01:** La promoción identifica la revisión validada en staging y no incluye cambios de desarrollo sin esa validación.
- [ ] **MD-H32-CA02:** La ruta de promoción/release respeta el procedimiento vigente y no sustituye PRs de desarrollo a staging.
- [ ] **MD-H32-CA03:** Negocio, sucursal, catálogo, horarios, contacto y reglas reales del piloto sustituyen los ejemplos de Bruma.
- [ ] **MD-H32-CA04:** Se verifica la revisión desplegada, los enlaces/QR y la operación de atención tras activar.
- [ ] **MD-H32-CA05:** Existe responsable, observación y procedimiento de pausa o reversión que preserva pedidos; la activación no ocurre solo por cerrar otro issue.

## Tareas

### MD-H32-T01 · Preparar la promoción identificada

- [ ] Relacionar revisiones, PRs atómicos y evidencia de MD-H31 con el cambio de release a main.

**Termina cuando:** No se incluyen commits ajenos sin revisar y validar.

### MD-H32-T02 · Confirmar configuración operativa del piloto

- [ ] Cargar valores autorizados de negocio/sucursal, productos, horarios y remitente con los accesos del equipo.

**Termina cuando:** No se usan tiempos, precios o contactos ficticios.

### MD-H32-T03 · Promover mediante el flujo de release vigente

- [ ] Ejecutar la promoción cuando esté autorizada e inspeccionar CI/despliegue de la revisión resultante.

**Termina cuando:** El runtime corresponde a la revisión aprobada, no solo al PR.

### MD-H32-T04 · Activar y comprobar el recorrido del piloto

- [ ] Habilitar únicamente las modalidades listas y realizar la comprobación controlada acordada.

**Termina cuando:** El responsable puede recibir, preparar, cobrar y resolver incidencias.

### MD-H32-T05 · Registrar observación y reversión

- [ ] Comprobar alertas, seguimiento y pausa; documentar resultados posteriores al despliegue.

**Termina cuando:** Pilotaje trazable y recuperación que conserva órdenes y pagos.

## Validación de la promoción y del piloto

Usar la evidencia aprobada de MD-H31 como condición de entrada. Tras main, comprobar la revisión del runtime y el piloto con su responsable.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] MD-H31 aprobada, con revisión de staging, criterios y evidencia identificados.
- [ ] Promoción a **main** autorizada mediante el procedimiento de release vigente, sin cambios de desarrollo nuevos.
- [ ] Verificar CI y runtime de la revisión promovida; activar el piloto acordado.
- [ ] Vincular issue, promoción, comprobaciones posteriores y responsables de observación y reversión.
- [ ] Cerrar esta historia después de comprobar la promoción y el piloto; la validación previa de staging por sí sola no la completa.

