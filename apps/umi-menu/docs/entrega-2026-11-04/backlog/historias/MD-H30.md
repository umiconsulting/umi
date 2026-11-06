# [MD-H30] Publicar una versión del menú para validación en staging

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **equipo de desarrollo**, quiero **tener una URL de staging con el menú conectado a su entorno** para **probar la integración antes de main**.

**Fase:** E · **Entregas del plan:** P19.
**Reglas de origen:** D18, D19.
**Áreas de referencia:** despliegue, frontend_menu, operacion. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H15, MD-H16, MD-H17, MD-A10.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Activar el piloto público o desplegar desarrollo directamente en main.

## Criterios de aceptación

- [ ] **MD-H30-CA01:** El build usa configuración explícita de staging y no apunta a datos o API de producción.
- [ ] **MD-H30-CA02:** Las rutas de negocio/mesa y seguimiento se resuelven en carga directa y recarga.
- [ ] **MD-H30-CA03:** Credenciales servidor no aparecen en el bundle; CORS/proxy y caché respetan rutas públicas y privadas.
- [ ] **MD-H30-CA04:** Las funciones incompletas quedan desactivadas por modalidad; una vista desplegada no implica piloto activo.
- [ ] **MD-H30-CA05:** Se documenta cómo volver a una versión compatible y pausar entradas preservando pedidos.

## Tareas

### MD-H30-T01 · Definir configuración por entorno

- [ ] Aplicar MD-A10 a rutas, host, API y mecanismo Cloudflare del producto.

**Termina cuando:** Staging y producción no se confunden con el proyecto de demo umi-stageshow.

### MD-H30-T02 · Integrar build y validación de recursos

- [ ] Añadir configuración versionada necesaria y comprobar carga de fotos/fuentes con licencias.

**Termina cuando:** Build reproducible y rutas internas correctas.

### MD-H30-T03 · Aplicar fronteras HTTP y de caché

- [ ] Configurar acceso a API y evitar cachear seguimiento privado como catálogo público.

**Termina cuando:** Recarga de ruta funciona y no revela datos de otro pedido.

### MD-H30-T04 · Preparar despliegue y reversión de staging

- [ ] Usar el pipeline existente o extensión acotada, con revisión identificable y funciones incompletas desactivadas.

**Termina cuando:** Se puede identificar qué revisión se prueba y cómo detener admisión.

### MD-H30-T05 · Verificar URL de staging

- [ ] Probar navegador, rutas directas, configuración y recursos sobre el despliegue de prueba.

**Termina cuando:** Evidencia de staging y ausencia de conexiones accidentales a producción.

## Validación en staging

Abrir URL de staging, recargar rutas de negocio/mesa/pedido y comprobar destinos de red, flags por modalidad y revisión desplegada.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

