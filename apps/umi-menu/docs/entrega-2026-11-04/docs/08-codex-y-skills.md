# Continuar con Codex y las skills

## Qué recibe la otra persona

El paquete incluye instrucciones, recursos y scripts de las skills disponibles en la computadora de origen. Son copias fechadas, no instalaciones activas ni credenciales de servicios.

Abre esta carpeta como workspace para revisar la entrega. Para implementar, abre el worktree de Umi y conserva esta carpeta como referencia.

## Skills usadas

| Skill | Papel en este proyecto | Copia incluida |
| --- | --- | --- |
| `stageshow` | Escenas, cursor, marcos, pausa, repetición y revisión del recorrido. | [SKILL.md](../skills/usadas/stageshow/SKILL.md) |
| `boardui` | Controles reales y reglas de tokens del visor y Dashboard. | [SKILL.md](../skills/usadas/boardui/SKILL.md) |
| `unslop` | Textos y pulido visual sobre el diseño elegido. | [SKILL.md](../skills/usadas/unslop/SKILL.md) |
| `brainstorming` | Exploración inicial y revisión del diseño y requisitos. | [SKILL.md](../skills/usadas/brainstorming/SKILL.md) |
| `writing-plans` | Organización del plan y sus dependencias. | [SKILL.md](../skills/usadas/writing-plans/SKILL.md) |
| `systematic-debugging` | Investigación de fallos del prototipo. | [SKILL.md](../skills/usadas/systematic-debugging/SKILL.md) |
| `verification-before-completion` | Evidencia antes de afirmar que un cambio o revisión funciona. | [SKILL.md](../skills/usadas/verification-before-completion/SKILL.md) |
| `research` | Contraste de código, fuentes y límites de lo observado. Skill del repositorio Umi. | [SKILL.md](../skills/repositorio/research/SKILL.md) |
| `openai-docs` | Documentación oficial para las instrucciones de skills de esta entrega. | [SKILL.md](../skills/usadas/openai-docs/SKILL.md) |

La lista describe uso documentado en la conversación y en esta entrega. No afirma que cada skill se aplicó a cada archivo.

## Skills de apoyo incluidas

`skills/apoyo/` contiene `using-superpowers`, `using-git-worktrees`, `executing-plans`, `test-driven-development`, `requesting-code-review`, `receiving-code-review`, `subagent-driven-development` y `finishing-a-development-branch`.

Se incluyen para la continuidad. No son prueba de implementación ni obligación de usar subagentes en toda tarea. Aplica cada skill a su caso.

La skill `research` del repositorio sí solicita un agente en segundo plano. En esta entrega se usó para el contraste local del plan.

## Instalación opcional

La [documentación oficial de Codex](https://developers.openai.com/codex/skills/), consultada el 4 de noviembre, indica:

- Una skill es una carpeta con `SKILL.md` y, opcionalmente, scripts y referencias.
- Codex descubre skills en `.agents/skills` del repositorio y en `$HOME/.agents/skills` del usuario.
- Codex detecta cambios automáticamente. Si una skill no aparece, reinicia Codex.
- Dos skills con el mismo nombre no se fusionan; pueden aparecer ambas.

Para instalar solo las tres skills visuales en tu cuenta, desde esta entrega:

```sh
python3 scripts/instalar-skills.py --dest "$HOME/.agents/skills" stageshow boardui unslop
```

El script rechaza destinos existentes. No sobrescribe una versión instalada. Si ya tienes una skill, compárala o usa esa instalación.

Para instalar skills adicionales, usa sus nombres después de `--dest`. El script admite las de `usadas` y `apoyo`. `research` debe consultarse en la versión vigente del repositorio; no se instala globalmente con este script.

`openai-docs` puede venir integrada en Codex. Comprueba si ya existe antes de copiarla. No necesitas ejecutar scripts de una skill para leerla.

Para una instalación dentro del repositorio, utiliza su `.agents/skills` y respeta sus reglas de cambios. No publiques estas copias automáticamente: los cambios versionados también siguen PR atómico a staging y pruebas antes de main.

## Herramientas y componentes

- Stageshow no requiere un conector para abrir este prototipo. El kit está copiado dentro de las fuentes.
- BoardUI ya tiene componentes instalados en `fuentes/umipos-redesign/components/`.
- No hace falta descargar plantillas Pro para compilar lo incluido.
- Si necesitas nuevos componentes, consulta el catálogo de la skill y el registro oficial. La skill describe el MCP opcional de BoardUI.
- Las conexiones GitHub, Cloudflare y VPS no se transfieren al instalar una skill.
- No copies `auth.json`, configuración personal de Codex o claves del autor.

## Instrucciones del repositorio que debes conocer

Lee primero el `AGENTS.md` vigente de Umi. La copia de [referencia](../referencias/umi/AGENTS.md) conserva una regla histórica de Azure Boards. Para este proyecto, el usuario confirmó **GitHub Issues**; esa instrucción explícita prevalece. No pidas credenciales de Azure para continuar el menú digital.

Se consultaron `to-tickets` y `pr-gates` como referencias al preparar el backlog; no se ejecutó su flujo de publicación o PR. `to-tickets` tiene invocación automática deshabilitada. La base histórica por defecto de `pr-gates` es main: para este proyecto usa explícitamente `PR_BASE_REF=origin/staging`. Consulta las versiones vigentes del repositorio al necesitarlas; no se añaden como skills instaladas de esta entrega.

La regla solicita `product-feature-review` para trabajo de funcionalidades. Esa skill no se encontró por archivo o nombre en los directorios locales revisados. El responsable debe proporcionar su versión o localizarla antes de una tarea que dependa de ella. No se inventa una copia equivalente en este paquete.

El playbook de verificación y las reglas de investigación están incluidos bajo `referencias/umi/docs/`. Lee las versiones vigentes al trabajar en el repositorio.

## Mensaje inicial para pegar en Codex

```text
Vamos a continuar el menú digital de Umi a partir de esta entrega.

Lee README.md, AGENTS.md, docs/01 a docs/11 y backlog/README.md. Revisa primero el contexto,
las decisiones, los flujos y la evidencia. Distingue prototipo de integración real.

El diseño final es el menú v6 con menu-redesign.css del Stageshow publicado,
con capturas del 3 de noviembre. Conserva esa dirección visual.
Los archivos locales están en fuentes/umipos-redesign y fuentes/umi-menu-preview.

Usa las skills pertinentes de docs/08-codex-y-skills.md. Al implementar en Umi,
lee las instrucciones vigentes del repositorio y actualiza staging.

Todos los PRs deben ser atómicos y apuntar a staging. Prueba en staging antes
de promover a main. No abras un PR documental P00 ni envíes desarrollo a main.
La documentación acompaña al cambio funcional.

Las historias y tareas ya están en backlog/. Conserva sus IDs, dependencias,
criterios y escenarios de staging. Usa GitHub Issues; la instrucción del usuario
sustituye las referencias históricas a Azure Boards para este proyecto.

Continúa con la historia o tarea que te solicite. Resuelve sus decisiones pendientes
antes de implementar supuestos de negocio. No ejecutes todo el backlog ni publiques
issues por el mero hecho de recibir este paquete. Si se solicita publicarlos,
comprueba primero si existen y registra sus números y URLs reales.
```

Añade al mensaje la historia o tarea concreta que la persona quiera trabajar. La primera entrega recomendada es MD-H01, previa resolución de MD-A01.

## Licencias y créditos

Stageshow conserva MIT y sus avisos. Unslop es de Damir Sokolovsky, bajo CC BY 4.0; conserva su atribución. BoardUI conserva su skill y los avisos de componentes instalados.

Las copias de skills de proceso conservan sus archivos tal como estaban disponibles. No se les asigna una licencia nueva. Revisa los avisos del autor si las distribuyes fuera del equipo.
