# N24 · evidencia primaria de espacio e intención

Consulta local: 8 de octubre de 2026. Esta revisión parte de dos observaciones nativas: [G69](N22-decision.md) y [G71](N23-r2-editor-geometry.json). La ruta del caso G69 se contrasta también mediante la decisión N22. La investigación artística y multilingüe anterior sigue en el [reporte principal](../2026-10-08-pos-estacion.md); no se presenta esta lectura técnica como otro hilo de artistas encontrado.

| Fuente primaria | Fecha / procedencia | Lectura aplicada |
| --- | --- | --- |
| [W3C · Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) | Documento explicativo vivo de WCAG 2.2, consultado en la fecha indicada | Aumentar texto debe conservar contenido y función. Recortar el campo o esconder el verbo contradice la intención. |
| [W3C · Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Documento explicativo vivo; no se atribuye fecha editorial de la captura | La distribución puede cambiar para que controles y contenido sigan alcanzándose. El scroll vertical es una respuesta legítima al espacio escaso. |
| [Flutter · Scrollable.ensureVisible](https://api.flutter.dev/flutter/widgets/Scrollable/ensureVisible.html) | API oficial y SDK local fijado en `6a19cca56475dbfba1478ee68d7bd0c2ef891da1` | Revela el objeto en sus ancestros desplazables. Se invoca después del frame; la geometría se observa después de otro frame. |
| [GOV.UK · Button](https://design-system.service.gov.uk/components/button/) | Página primaria del equipo del sistema, consultada ahora | Texto de acción claro y una decisión primaria distinguible. Se aplica el criterio; no se incorpora su biblioteca o apariencia. |

Son criterios para contrastar un producto nativo, no una certificación WCAG web. La política de 440 px de área de trabajo y el umbral de comanda `208 × escala` son decisiones propias. Las pruebas comprueban sus casos concretos, sin atribuir esos valores al SDK o a W3C.

El método visual mantiene la comanda como documento, el azul UMI y el dibujo geométrico. Las acciones secundarias conservan su orden; Cobrar ocupa el ancho cuando tres verbos completos no caben. La cabecera puede salir de la región de lectura en una pantalla baja. El pedido sigue teniendo un disparador fijo. El total continúa junto a las acciones, aunque en el modo de espacio escaso ese bloque requiere desplazamiento.

La inspección adicional devuelve un límite: [G72](N24-toolbar-after-short-before-key-atspi.json) conserva el editor, pero no la intención de foco de Nueva venta cuando la cabecera cambia. La lectura de espacio no resuelve por sí sola la continuidad entre propietarios.
