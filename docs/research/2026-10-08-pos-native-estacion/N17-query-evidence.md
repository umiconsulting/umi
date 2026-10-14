# N17 · Búsqueda de historial y respuestas obsoletas

Consulta: **2026-10-08**. Investigación primaria del agente de fondo; código leído en el fork `design/pos-estacion-native`, base `e32885c` y árbol de trabajo observado durante N17. No ejecuté consultas contra una base, pruebas de la aplicación ni ventanas. **HD** = hecho documentado; **TR** = tradeoff respaldado; **IN** = propuesta/inferencia; **UNVERIFIED** = no comprobado.

**Decisión IN:** ampliar la búsqueda al nombre guardado en las líneas de la venta; mantener la última intención de búsqueda mediante una identidad o generación de solicitud; expresar carga, ausencia de ventas y ausencia de coincidencias como estados distintos. No requiere Material, Cupertino ni otra biblioteca UI.

## Instrumentos y alcance

| Instrumento | Versión, licencia y mantenimiento comprobados | Costo y límite |
| --- | --- | --- |
| PostgreSQL | Manual **17**; licencia [PostgreSQL](https://www.postgresql.org/about/licence/). La [política del propietario](https://www.postgresql.org/support/versioning/) fecha el primer lanzamiento **2024-09-26** y soporte hasta **2029-11-08**. | HD: operadores ya disponibles. UNVERIFIED: versión menor, collation, índices y aislamiento efectivos del servidor. No asumí que la versión publicada actualmente coincide con la instalación. |
| Flutter / Dart SDK | **Flutter 3.47.5 stable / Dart 3.13.4**, manifiesto local; revisión Flutter `6a19cca56475dbfba1478ee68d7bd0c2ef891da1`, fecha de commit **2026-09-17**. Licencias BSD de tres cláusulas leídas en ambos SDK. | HD: ya instalados en `/home/juan/.local/opt/flutter`. IN: usar identidad/generación en el controlador existente, sin paquete nuevo. La web Dart consultada anuncia **3.13.5**, distinta del SDK local. |
| Carbon, IBM | Guías propias de diseño: Empty states actualizado **2026-08-11**; Loading **2026-09-28**. El código Carbon tiene [Apache 2.0](https://github.com/carbon-design-system/carbon/blob/main/LICENSE). | Sólo referencia conceptual y paráfrasis; ninguna dependencia, recurso o componente adoptado. La licencia del repositorio de código no se atribuye automáticamente a todo el sitio. No es evidencia experimental de un POS. |
| Herramientas de lectura | `rg`, lector web; curl **8.22.0** (licencia curl) y Python **3.14.7** (PSF), biblioteca estándar. | Herramientas ya disponibles; curl recuperó HTML público y Python extrajo texto. Sin instalación ni navegador. |

HD: método aplicado conforme a [research](../../../.agents/skills/research/SKILL.md), [doctrina](../../agents/tool-and-research-doctrine.md) y [playbook](../2026-09-16-research-channels-playbook.md). Peldaños usados: documentación oficial, política de soporte/licencias y fuente del SDK/proyecto. No necesité afirmaciones de foros para estas tres brechas.

## 1. Qué busca realmente el historial

HD local: [_historyLabel](../../../apps/umi-pos/lib/features/sale/sale_surface.dart:715) usa la etiqueta explícita; si falta, deriva el título de `cart.items[].productName`. [history](../../../apps/umi-api/src/modules/pos-sale/pos-sale.repository.ts:270) buscaba etiqueta, cliente y recibo, pero no esas líneas. El [snapshot del carrito](../../../apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts:817) devuelve **`l.product_name`**, guardado en `merchant.pos_cart_line`, no el nombre actual del catálogo. Esto explica una brecha del código leído; no sustituye una reproducción con datos reales.

HD: PostgreSQL 17 define `ILIKE` como comparación sin distinguir mayúsculas según la locale activa. `%` acepta una secuencia y `_` un carácter; una búsqueda de fragmento necesita `%` a ambos lados. Los comodines literales necesitan escape; estos operadores no admiten collations no deterministas en esta versión. [Manual 17, Pattern Matching](https://www.postgresql.org/docs/17/functions-matching.html), página sin fecha individual visible, consultada 2026-10-08.

IN: ampliar el `OR` con una subconsulta correlacionada, preservando los filtros exteriores de comercio, ubicación y estado. Fragmento de propuesta, **no ejecutado**:

```sql
OR EXISTS (
  SELECT 1
  FROM merchant.pos_cart_line l
  WHERE l.merchant_id = c.merchant_id
    AND l.cart_id = c.id
    AND l.product_name ILIKE '%' || $4 || '%'
)
```

HD/TR: `EXISTS` sólo decide si existe alguna fila, admite correlación y evita multiplicar la fila padre por varias líneas coincidentes. `SELECT 1` es una convención, sin prueba aquí de que sea más rápido que `SELECT *`. [Manual 17, EXISTS](https://www.postgresql.org/docs/17/functions-subquery.html#FUNCTIONS-SUBQUERY-EXISTS), s/f individual, consulta 2026-10-08.

IN/TR: buscar la copia histórica conserva la relación con el título mostrado aunque después se renombre el producto. Añadir catálogo actual cambiaría ese contrato. El fragmento conserva los comodines actuales: parametrizar evita interpolación SQL, pero no convierte `%` o `_` en texto literal. Definir esa política aparte. **UNVERIFIED:** búsqueda sin acentos (`cafe`/`café`) y rendimiento; `ILIKE` no garantiza equivalencia de acentos. No propongo índices nuevos sin medir.

## 2. Consistencia de lectura: distinta de ordenar respuestas

HD: `READ COMMITTED` es el valor por defecto de PostgreSQL. Cada `SELECT` ordinario obtiene su snapshot al comenzar; dos consultas sucesivas pueden ver commits distintos, incluso dentro de una transacción. `REPEATABLE READ` comparte el snapshot desde la primera sentencia no transaccional; la documentación excluye conflictos de serialización para transacciones sólo de lectura en ese nivel. [Manual 17, Transaction Isolation](https://www.postgresql.org/docs/17/transaction-iso.html), s/f individual, consulta 2026-10-08.

HD local: [runWithMerchant](../../../apps/umi-api/src/shared/database/pg.service.ts:399) usa `BEGIN`, configura contexto RLS y hace `COMMIT`, sin fijar ahí aislamiento. El historial selecciona IDs y después obtiene cada snapshot mediante consultas adicionales. **UNVERIFIED:** configuración de la conexión/servidor; `BEGIN` por sí solo no permite certificar el nivel efectivo.

IN/TR: bajo `READ COMMITTED`, selección y expansión podrían observar versiones diferentes si hay escrituras concurrentes. Si N17 necesita una página de un único instante, considerar una consulta única o una transacción de lectura con snapshot estable, conservando RLS. Esta decisión requiere medir costo y definir frescura. Ningún nivel de aislamiento corrige que A llegue después de B al cliente. Son problemas separados.

## 3. La solicitud vigente tiene identidad

HD local: [loadHistory](../../../apps/umi-pos/lib/features/sale/sale_lifecycle_controller.dart:321) actualizaba filtros y cursor antes de llamar `_loadHistoryPage`; éste retornaba si `_historyLoading` era verdadero. IN: con A pendiente, B puede cambiar los campos de filtro y no consultar; A termina publicando datos de una intención anterior.

HD: la fuente local de [`FutureBuilder`](https://github.com/flutter/flutter/blob/6a19cca56475dbfba1478ee68d7bd0c2ef891da1/packages/flutter/lib/src/widgets/async.dart#L595), SDK fijado arriba, crea una identidad de callbacks, comprueba su vigencia antes de publicar éxito/error e invalida esa identidad al sustituir el Future o disponer el State. Es evidencia primaria del mecanismo en `widgets`, no recomendación de copiar un componente visual. [API FutureBuilder](https://api.flutter.dev/flutter/widgets/FutureBuilder-class.html), s/f individual: distingue espera, datos y error; crear el Future durante `build` puede reiniciar la tarea.

IN: adaptar ese principio al controlador:

1. Cada **intención nueva** captura consulta y ámbito inmutables, incrementa generación y reinicia paginación. Si hay debounce, invalidar la anterior al recibir la intención, no sólo al enviar la petición.
2. Sólo la generación vigente modifica resultados, cursor, error y carga. Comprobar también `catch` y `finally`: un `finally` viejo no debe apagar la carga nueva.
3. `loadMore` pertenece a la misma consulta/generación; serializar sus páginas y descartar una página cuyo ámbito cambió. No extender este patrón sin análisis a cobros o mutaciones.
4. Al disponer el controlador, invalidar solicitudes y cancelar temporizadores. Si se usa `State`, comprobar ciclo de vida; `mounted` sólo indica que sigue montado, no cuál búsqueda es vigente. [State.mounted](https://api.flutter.dev/flutter/widgets/State/mounted.html), s/f, consulta 2026-10-08.

HD/TR: [`Timer.cancel`](https://api.dart.dev/dart-async/Timer/cancel.html) evita que el temporizador vuelva a invocar su callback; no documenta cancelar un Future HTTP que ya arrancó. IN: descartar callbacks basta para coherencia visual, aunque las solicitudes antiguas sigan consumiendo red/servidor. Debounce puede reducirlas; su duración es una decisión a medir, no una constante validada por estas fuentes.

## 4. Tres estados visibles, una recuperación clara

HD: [IBM/Carbon Empty states](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states), **2026-08-11**, diferencia ausencia de datos, ausencia de resultados tras una acción y problemas del sistema. Para no coincidencias propone ajustar términos/filtros. [Loading](https://www.carbondesignsystem.com/building-blocks/core/components/loading/guidelines), **2026-09-28**, explica el estado en curso como respuesta a una operación aún pendiente. Son recomendaciones del diseñador propietario; **no prueban tiempos, errores ni satisfacción de cajeros**.

IN: mensajes y condiciones propuestos para N17:

| Estado real | Contenido propuesto | Condición |
| --- | --- | --- |
| Consulta vigente pendiente | «Buscando ventas…» | No mostrar vacío porque una lista inicial esté vacía. Si se conservan resultados anteriores, identificarlos como anteriores mientras se actualizan. |
| Consulta completada sin búsqueda ni filtro restringente, cero ventas | «Aún no hay ventas en esta ubicación.» | No generalizar a toda la cuenta ni inferir ausencia global desde una página posterior vacía. |
| Consulta completada con términos/filtros, cero coincidencias | «No hay ventas que coincidan con esta búsqueda.» + «Limpiar búsqueda» o acción de filtros pertinente | Mantener texto y filtros editables; limpiar debe invalidar solicitudes anteriores. |
| Consulta fallida | «No se pudo cargar el historial.» + «Reintentar» | Conservar consulta para reintentar; no traducir fallo como cero ventas. |

IN: el indicador debe acompañar la sección afectada, sin bloquear la escritura. Proporcionar texto/semántica propia; no hay componente Carbon importado. No heredar de la guía una espera universal de tres segundos para el POS.

## Validación pendiente y rutas fallidas

IN: evidencia necesaria antes de puntuar esta corrección: venta sin etiqueta encontrada por nombre guardado; varias líneas coincidentes sin duplicados; A lenta/B rápida; error de A después del éxito de B; `finally` de A mientras B sigue pendiente; búsqueda nueva mientras carga; filtro/ámbito cambiado mientras llega otra página; disposición con petición pendiente; estados de carga/vacío/sin coincidencias/fallo. **UNVERIFIED:** esas comprobaciones no se ejecutaron en esta investigación, ni existe aquí prueba de usabilidad con operadores.

| Ruta | Resultado y recuperación |
| --- | --- |
| `apps/umi-pos/lib/features/history` | No existe. `rg --files` encontró historial en `features/sale`. |
| `apps/umi-api/src/platform/postgres*` | El glob falló. Inventario encontró `shared/database/pg.service.ts`. |
| Carbon `/components/loading/usage` | Lector web devolvió error interno; búsqueda primaria encontró `/guidelines`. |
| Carbon `/guidelines` vía lector web | Timeout. **curl -L** recuperó HTML; extracción estándar verificó fecha y contenido en `/tmp/N17-carbon-loading.html`. La página v10 oficial también abrió, pero es una edición anterior fechada **2025-08-19**; no mezclé sus versiones con la actual. |

Límite final: esta nota sustenta decisiones de consulta y estado, no certifica compatibilidad del servidor, eficacia en caja ni una puntuación 10.0. Sólo se creó este Markdown; no se modificó aplicación, datos ni repo original.
