# Inventario y procedencia

## Archivos locales necesarios incluidos

| Origen en la computadora original | Copia en esta entrega | Estado |
| --- | --- | --- |
| `/Users/moon/Documents/umipos-redesign` | `fuentes/umipos-redesign` | Prototipo local, sin repositorio Git propio observado. Incluye visor y componentes necesarios. |
| `/Users/moon/Documents/umi-menu-preview` | `fuentes/umi-menu-preview` | Prototipo local y documentos del menú. Incluye el contenido oculto necesario. |
| `umipos-redesign/dist` | `preview` | Compilación existente para revisar sin npm. |
| `/private/tmp/umi-menu-plan-20261101/docs/plans/2026-11-01-menu-digital-design.md` | `referencias/historicas/plan-original-con-auditoria-vps-2026-11-01.md` | Borrador con auditoría histórica y P00 descartado. |
| `/private/tmp/umi-menu-final-design-20261103` | `evidencia/visual-2026-11-03` | Capturas e informe de la revisión pública. |
| `umipos-redesign/shots` | `evidencia/prototipo-2026-11-02` | Tres informes seleccionados; no se copia todo el archivo de capturas del POS. |
| Skills de `.agents/skills` y `.codex/skills` | `skills` | Copias completas de las skills seleccionadas, sin dependencias instaladas. |
| Documentos relevantes de `/Users/moon/Documents/umi` | `referencias/umi` | Copias para investigación, reglas y antecedentes. |

`inventario-origen.json` enumera cada archivo copiado, su origen, tamaño y SHA-256. Esa lista permite distinguir fuentes copiadas de documentos nuevos de esta entrega.

## Documentación y backlog añadidos en la versión 2

| Ruta | Contenido y edición |
| --- | --- |
| `backlog/backlog.json` | Fuente editable: 33 historias, 13 decisiones y 205 tareas, con IDs locales estables. |
| `backlog/historias/`, `backlog/decisiones/` | Cuerpos Markdown para GitHub Issues; generados desde el JSON. |
| `backlog/README.md`, `mapa-entregas.md` | Índice, orden de dependencias y correspondencia Pxx. |
| `backlog/historias.csv`, `tareas.csv` | Tablas de revisión; no son un importador de GitHub. |
| `docs/10-historias-y-tareas-github.md` | Seguimiento, publicación y cierre en GitHub; PRs atómicos a staging. |
| `docs/11-mapa-tecnico-y-pruebas.md` | Puntos de entrada del código, comandos y límites de las pruebas existentes. |
| `scripts/generar-backlog.py` | Regenera Markdown y CSV desde el JSON; no llama a GitHub. |
| `scripts/validar-backlog.py` | Comprueba IDs, dependencias, cobertura, exportaciones y enlaces locales de la documentación vigente. |
| `evidencia/validacion-backlog.md` | Resultado y alcance de la revisión de esta ampliación. |

Estos archivos son nuevos, no copias de `inventario-origen.json`. Están incluidos en `SHA256SUMS`. La versión 2 conserva sin cambios las fuentes, skills y recursos copiados en la primera entrega.

## Fuentes que se deben editar

| Necesidad | Archivo o área |
| --- | --- |
| Cambiar el menú del cliente | `fuentes/umi-menu-preview/.superpowers/brainstorm/18629-1793487079/content/menu-v6.html` |
| Ajustar el estilo aprobado | `.../content/menu-redesign.css` |
| Cambiar escenas del menú | `fuentes/umi-menu-preview/flow/examples/umi-flow/` |
| Cambiar capítulos y explicaciones | `fuentes/umi-menu-preview/flow/playground/flow-data.ts` |
| Cambiar controles del visor | `fuentes/umipos-redesign/src/DigitalMenuShow.tsx`, `PreviewChoices.tsx`, `DevicePreview.tsx` |
| Cambiar integración visual del personal | `fuentes/umipos-redesign/src/MenuStaffPreview.tsx` y componentes existentes del POS/Dashboard/KDS. |

Las versiones v1–v5 y escenas anteriores se conservan como historial. No son la referencia final. No edites la copia compilada para implementar cambios permanentes.

## Archivos generados y estructura

`build:menu` genera `fuentes/umipos-redesign/public/menu-digital/`. Esa carpeta se omitió del árbol de fuentes. Los recursos y adaptadores de origen sí están incluidos.

La compilación entregada está en `preview/`. Conserva la versión local existente antes de reconstruir la copia de validación. No es una garantía de que el enlace público siga sin cambios después de la revisión fechada.

Las capturas del 3 de noviembre conservan el diseño visto por el usuario. El [informe de research](03-research-y-evidencia.md) detalla las comparaciones de archivos públicos.

## Recursos visuales y licencias

- Fotografías del menú: directorio `content/` indicado arriba y recursos del recorrido. Sus identificadores de Unsplash están en `fuentes/umi-menu-preview/README.md`.
- Fotografías del POS de ejemplo: créditos en `fuentes/umipos-redesign/public/products/SOURCES.txt`.
- Fuentes del menú: archivos IBM Plex Sans y Bricolage Grotesque, con licencias OFL en `content/` y en `public/fonts/` del visor.
- Fuentes del Dashboard: Inter Tight y Source Sans 3 con sus licencias en `public/fonts/`.
- Stageshow: licencia en `fuentes/umipos-redesign/LICENSE` y en `skills/usadas/stageshow/LICENSE`.
- Créditos de Unslop, BoardUI y activos del prototipo: `fuentes/umipos-redesign/NOTICE.md`.

Los avisos originales de Stageshow mencionan algunos ejemplos de su distribución completa. El proyecto adaptado solo incluye los ejemplos que conserva. La skill completa está en `skills/usadas/stageshow`.

## Material que permanece en Git o fuera del alcance

El código de API, Dashboard real, POS Flutter, migraciones y contratos se obtiene de `https://github.com/umiconsulting/umi`. No se duplica el monorepo dentro del ZIP.

Existía trabajo paralelo en `/private/tmp/umi-redesign-parity-20261102`, con cambios Flutter, pruebas e informes. No se modificó ni se empaquetó. No es un requisito para ejecutar el menú de demostración. La coordinación de la integración visual del POS debe revisar ese trabajo con su responsable.

El checkout principal también tenía cambios ajenos, incluido `apps/umi-studios` y documentos de otros proyectos. Se preservaron y quedaron fuera del paquete.

El research de ConversaFlow incluido era local y aparecía sin seguimiento en el checkout principal. Se conserva como antecedente relevante; no se convierte en alcance del menú.

## Exclusiones del paquete

- `node_modules`, `.git`, `.vite`, `.wrangler` y cachés.
- Archivos `.env`, tokens, sesiones y estado de servidores locales.
- Credenciales de GitHub, Cloudflare, Codex, VPS y SMTP.
- Bases de datos, pedidos reales y datos de clientes.
- Capturas extensas de otros flujos y compilaciones duplicadas innecesarias.

El prototipo contiene PIN y credenciales **ficticios y públicos** para sus escenas. Están identificados en su README y no dan acceso al producto real.

## Comprobar integridad

Desde la raíz de la entrega:

```sh
python3 scripts/verificar-paquete.py
```

La verificación usa `SHA256SUMS`. Si modificas los archivos después de recibirlos, su hash cambiará. Conserva una copia del ZIP original para comparar.

## Estado de las pruebas de entrega

La [validación de esta entrega](../evidencia/validacion-entrega.md) registra los comandos ejecutados y sus límites. Esa validación se refiere a portabilidad del prototipo y documentos; no a la integración comercial pendiente.

La [validación del backlog](../evidencia/validacion-backlog.md) registra las comprobaciones de la versión 2. No se repitieron builds o recorridos del prototipo porque sus fuentes y compilación permanecen idénticas.

## Documentos originales y enlaces

Los documentos en `referencias/` y los README originales conservan sus rutas y su redacción. Algunos enlaces requieren el clon completo de Umi o ejemplos no incluidos en el proyecto adaptado.

Para navegar la entrega, empieza por el README y los documentos numerados de `docs/`. Sus enlaces locales se comprueban al empaquetar. Un documento histórico no reemplaza las instrucciones actuales de un repositorio o servicio.
