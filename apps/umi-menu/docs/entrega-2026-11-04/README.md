# Entrega del menú digital de Umi

Fecha de corte: **4 de noviembre de 2026**. Este paquete reúne el contexto, las decisiones, la investigación y los archivos locales necesarios para continuar el proyecto.

El producto permitirá consultar el menú y pedir desde una mesa o para recoger. Umi Dashboard administrará la configuración. UmiPOS atenderá y cobrará los pedidos. Los KDS prepararán los productos.

**Estado real:** existe un prototipo visual e interactivo publicado. La integración de este nuevo flujo con la API, POS, KDS y correo sigue pendiente. El prototipo simula esas operaciones.

**Referencia visual aprobada:** [Menú digital en Stageshow](https://umi-stageshow.pages.dev/?app=menu). El usuario confirmó esta dirección el 3 de noviembre. Las capturas de esa revisión están incluidas.

## Empieza aquí

1. Lee [contexto y decisiones](docs/01-contexto-y-decisiones.md).
2. Revisa [flujos y reglas](docs/02-flujos-y-reglas.md).
3. Abre la copia del prototipo con [la guía local](docs/07-ejecucion-local.md).
4. Lee [research y evidencia](docs/03-research-y-evidencia.md) y [arquitectura](docs/04-arquitectura-e-integracion.md).
5. Continúa con [el plan general](docs/05-plan-general.md) y [las decisiones pendientes](docs/06-pendientes-y-validacion.md).
6. Abre [las historias y tareas](backlog/README.md), [su guía para GitHub](docs/10-historias-y-tareas-github.md) y [el mapa técnico y de pruebas](docs/11-mapa-tecnico-y-pruebas.md).
7. Si usas Codex, sigue [la guía de skills y contexto](docs/08-codex-y-skills.md).
8. Consulta [el inventario](docs/09-inventario-y-procedencia.md) antes de mover archivos.

## Contenido

| Ruta | Contenido |
| --- | --- |
| `docs/` | Documentación consolidada vigente para esta entrega. |
| `backlog/` | 33 historias, 13 decisiones pendientes y 205 tareas, con criterios, dependencias y escenarios de staging. Markdown para GitHub Issues y tablas CSV. |
| `fuentes/umipos-redesign/` | Código del visor, POS, Dashboard, componentes BoardUI y escenas del personal. |
| `fuentes/umi-menu-preview/` | Menú HTML/CSS, imágenes, fuentes y recorrido Stageshow. |
| `preview/` | Copia compilada del prototipo local, lista para servir por HTTP. |
| `skills/` | Copias de skills usadas y skills de apoyo, con recursos disponibles. |
| `referencias/` | Documentos históricos y fuentes del repositorio. Conservan su contexto original. |
| `evidencia/` | Capturas, informes históricos y validaciones de esta entrega. |
| `scripts/` | Instalación opcional de skills, generación y validación del backlog y verificación de integridad. |
| `inventario-origen.json` | Archivo de origen y SHA-256 de cada copia recibida. |
| `SHA256SUMS` | Integridad del paquete terminado. |

El código real de Umi se obtiene de **https://github.com/umiconsulting/umi**. Este paquete no sustituye ese repositorio.

## Qué está decidido

- Pago en el negocio.
- Mesa por QR: envío a preparación y aviso al personal, sin aceptación previa.
- Recogida: aceptación del personal antes de preparar.
- Programación por sucursal y producto; aceptación y liberación a preparación son pasos distintos.
- Nombre, teléfono y correo para recoger; sin código SMS ni cuenta obligatoria.
- Correo y seguimiento web como canales iniciales.
- Cambios del producto mediante **PRs atómicos hacia `staging`**, con pruebas allí antes de promover a `main`.
- Trabajo local antes del PR. La documentación acompaña el cambio funcional.
- Historias y tareas en **GitHub Issues**, según la aclaración del usuario del 4 de noviembre.

## Qué sigue

La primera entrega funcional propuesta es [MD-H01](backlog/historias/MD-H01.md): persistir y consultar la configuración del menú por negocio y sucursal, después de resolver [MD-A01](backlog/decisiones/MD-A01.md).

Las historias y tareas están preparadas para revisión y posterior publicación en GitHub. Cada historia identifica el resultado, las tareas, los criterios de aceptación, las dependencias y la comprobación en staging. No se crearon issues ni PRs. Preparar el backlog no autoriza ejecutar todas sus tareas.

Esta es la **versión 2 de la entrega**: añade el backlog y actualiza las guías. Conserva las fuentes, skills, capturas y compilación de la primera versión. Consulta la [validación del backlog](evidencia/validacion-backlog.md).

## Cómo interpretar las fuentes

La conversación y las decisiones consolidadas prevalecen sobre propuestas históricas. Los documentos originales incluyen referencias descartadas: menú v5, tipografías anteriores y un PR documental P00.

El plan actual usa menú v6 con su CSS del redesign. P00 quedó descartado por el usuario. Los nombres y valores de Bruma son ejemplos.

La auditoría del VPS es del **1 de noviembre**. La revisión local del repositorio es del **4 de noviembre**, sin `fetch`. Ninguna acredita el estado actual de producción.

Para compartir, entrega el ZIP completo y este README. No hacen falta las credenciales personales de quien creó el prototipo.
