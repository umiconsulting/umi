# Historias y tareas en GitHub

El usuario confirmó que el seguimiento se hace en **GitHub**. Esta instrucción sustituye las referencias vigentes a Azure Boards en la entrega.

Repositorio comprobado: **https://github.com/umiconsulting/umi**. GitHub Issues está habilitado. Durante esta preparación se consultó el repositorio; no se crearon issues ni PRs.

## Backlog entregado

Consulta [el índice del backlog](../backlog/README.md). Contiene una historia por archivo, decisiones pendientes, tareas y criterios de aceptación.

- `MD-Hxx`: historia con resultado funcional u operativo verificable.
- `MD-Axx`: decisión pendiente que bloquea una o más historias.
- `MD-Hxx-Txx` o `MD-Axx-Txx`: tarea concreta y condición de terminación.
- `MD-Hxx-CAxx`: criterio de aceptación de una historia.
- `Pxx`: correspondencia con la entrega del plan general.
- `Dxx`: decisión de producto ya registrada.

Los identificadores son locales. No representan números `#` de GitHub. Los campos `github_issue` están vacíos hasta que se publiquen los elementos.

## Granularidad y atomicidad

Una historia entrega un comportamiento. Sus tareas permanecen dentro del mismo issue como checklist. No es necesario crear un issue o PR por cada tarea.

Por ejemplo, “Registrar una recogida pendiente” incluye contrato, persistencia, validación y ausencia de proyección anticipada. Separar esas piezas en PRs incompatibles rompería el resultado.

“Aceptar una recogida”, “atenderla en POS” y “cobrar el pedido existente” son historias distintas. Cada una tiene un resultado y comprobaciones propias.

La propuesta usa un PR por historia de código cuando cabe con claridad. Si una historia requiere dividirse, cada subentrega debe tener comportamiento demostrable, compatibilidad y un diff propio. Mantén el objetivo del issue y actualiza sus dependencias.

Las decisiones y las verificaciones operativas pueden no requerir código. Registra su resultado en el issue y conserva la documentación con el PR funcional correspondiente. No restaures P00 ni fabriques PRs documentales para cada decisión.

## Publicación en Issues

1. Revisa la granularidad y los criterios de los archivos antes de publicarlos.
2. Busca en GitHub si ya existe un issue equivalente. Estos borradores no fueron cotejados contra todos los issues existentes.
3. Conserva el ID local en el título, por ejemplo `[MD-H01] Persistir la configuración del menú por negocio y sucursal`.
4. Usa el Markdown de la historia como cuerpo y sus tareas como checklist.
5. Crea primero las decisiones y los predecesores necesarios para enlazarlos.
6. Sustituye las referencias de dependencia por números y enlaces reales; conserva también el ID local.
7. Registra número y URL de cada issue en `backlog.json`.
8. Usa las etiquetas y el proyecto de GitHub que el equipo confirme. No se crearon etiquetas, proyectos, responsables ni fechas ficticias.

Los enlaces relativos del Markdown sirven dentro del paquete. Al publicar, reemplázalos por la ubicación compartida de la documentación o por su ruta versionada en el PR funcional correspondiente; una ruta local no será navegable desde GitHub.

Un issue padre de “Menú digital” puede agrupar el trabajo mediante una lista de enlaces. No hace falta duplicar toda la especificación en cada tarea.

Los CSV incluidos sirven para revisar, ordenar o adaptar la carga. GitHub no se presenta aquí como importador automático de esos CSV.

## Dependencias y disponibilidad del trabajo

El índice muestra el orden topológico: un orden que siempre coloca una dependencia antes de la historia que la necesita. Los números de historia se mantienen estables y no indican orden de ejecución.

La primera entrega recomendada es **MD-H01**, después de **MD-A01**. El soporte de variantes de **MD-H03** puede prepararse de forma independiente si su base y entorno están listos.

Una historia con decisiones pendientes puede investigarse y precisarse. No se implementan supuestos de negocio como si fueran decisiones aprobadas.

Las primeras historias del frontend incluyen una URL de revisión conectada a staging para sus comprobaciones. MD-H30 consolida la publicación estable después de disponer de mesa y seguimiento privado; no sustituye las pruebas de las entregas anteriores.

Cada historia hereda el cierre de las decisiones de sus dependencias. “Ninguna decisión directa” no significa que todas sus dependencias estén listas.

## Flujo de desarrollo y cierre

**Trabajo local → PR atómico a staging → pruebas en staging → promoción a main.**

1. Actualiza la referencia de staging y revisa las instrucciones del módulo.
2. Crea una rama o worktree para la historia.
3. Implementa el comportamiento con contratos y migraciones compatibles.
4. Ejecuta las comprobaciones locales pertinentes y revisa el diff contra staging.
5. Abre el PR con base **staging** cuando sus dependencias estén integradas y validadas allí.
6. Vincula el issue en el PR. Usa una referencia sin cierre automático mientras falte validación en staging.
7. Tras integrar, verifica el commit del merge y el despliegue correspondiente.
8. Ejecuta el escenario de staging de la historia y registra la evidencia.
9. Cierra la historia de implementación cuando sus criterios y validación en staging estén completos.
10. Promueve la revisión validada a main en el paso de release. MD-H31 y MD-H32 cubren la validación integral y el piloto.

No usar `Fixes` o `Closes` para dar por terminada una historia antes de su validación. La semántica de cierre automático depende de la rama predeterminada y del flujo del repositorio; una referencia simple evita confundir merge con validación.

Para este proyecto, `PR_BASE_REF` debe ser `origin/staging`. La skill histórica `pr-gates` usa `origin/main` si no se especifica base. La instrucción explícita del usuario prevalece.

## Qué debe contener un PR

- Problema concreto y comportamiento resultante.
- Issue y criterios que satisface.
- Cambios acoplados necesarios, sin trabajo ajeno.
- Evidencia local y CI pertinente, con resultados reales.
- Compatibilidad de contratos, clientes y migración.
- Pasos de validación en staging y condición para considerar el issue completo.
- Cómo pausar o revertir sin perder pedidos existentes.

La [guía técnica](11-mapa-tecnico-y-pruebas.md) identifica fuentes y pruebas actuales. No fija firmas, SQL o rutas nuevas antes de resolver las decisiones pendientes.

## Estado de esta entrega

Se generó y revisó el backlog local. El diseño, los prototipos y la compilación no cambiaron. No se ejecutaron las tareas de implementación, las pruebas del producto real ni la promoción a main.

Los documentos históricos del repositorio conservan menciones a Azure Boards para mantener su procedencia. Para este trabajo, usa GitHub Issues según la instrucción del usuario.
