# UmiPOS — El contrato como frontera entre repos (seam)

**Fecha:** 2026-07-20
**Serie:** [`2026-07-14-umipos-analisis-integracion.md`](./2026-07-14-umipos-analisis-integracion.md) · [`2026-07-14-umipos-resumen-para-nexo.md`](./2026-07-14-umipos-resumen-para-nexo.md)
**Estado:** PROPUESTA — frontera y mecanismo definidos; el cableado del emisor es un paso siguiente acotado.

---

## 0. Encuadre — qué cambió y qué NO

El cliente UmiPOS vive en **un repositorio aparte** (app Flutter) y **UmiPOS se vende únicamente con Umi**, nunca aislado. Eso confirma la arquitectura ya recomendada (Opción B, §10–11 del análisis) **sin cambios**:

- El **backend del POS es `apps/umi-api/src/modules/pos/`** en este repo, sobre la base de datos de Umi. Es el **único escritor** de la orden, el pago y el evento de cocina.
- El repo del otro dev es **un cliente** — como el KDS y el dashboard. **No tiene base de datos ni escribe la DB.** Llama al API.

Lo **único** que crea el repo separado es un problema de frontera que el monorepo no tenía: el contrato (`@umi/contract`) hoy se consume como paquete del workspace (TypeScript, `workspace:*`, `dist/`). **Un repo Flutter/Dart aparte no puede importarlo.** Este documento resuelve exactamente eso — sin reintroducir una segunda fuente de verdad.

> Este es el precio completo del repo separado: **un seam de contrato**, no una capa de sincronización. Si aparece «sync», «webhook» o «reconciliación» en el diseño del POS, se coló la Opción A (§10, rechazada).

---

## 1. El principio del seam

**Una sola fuente de verdad: `@umi/contract` (TypeScript + zod).** El cliente Dart **consume un artefacto GENERADO** a partir de esa fuente; **nunca teclea tipos a mano.**

La trampa a evitar: si alguien escribe en Dart un modelo que «refleja» la respuesta del servidor, ese modelo **ya es una segunda definición** y **divergirá** en el primer cambio de campo. La regla es la misma que la de los datos (§8): **un tipo, un autor.** El autor es el zod; Dart es _derivado_.

```
packages/contract/src/*.ts   (zod + rutas)   ← ÚNICA fuente, editable
        │  emit (build step)
        ▼
umi-contract-<semver>.json   (artefacto neutral, versionado)   ← publicado por tag
        │  codegen (en el repo POS)
        ▼
lib/umi_contract/*.dart      (modelos + rutas)   ← GENERADO, nunca a mano
```

---

## 2. Qué hay hoy en `@umi/contract`

| Módulo            | Contenido                                                                                | Dependencia  |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------ |
| `routes.ts`       | Constructores de path (`/api/tenants/:id/...`), byte-exactos a los controladores NestJS. | **Zero-dep** |
| `schemas.ts`      | Esquemas **zod** de request/response (`z.object`, `z.infer`).                            | zod v3       |
| `entitlements.ts` | Vocabulario de productos — **`pos` ya está en `PRODUCT_KEYS`** (este PR).                | **Zero-dep** |

Consumo actual: monorepo (`workspace:*` → `dist/`). Correcto para umi-api/dashboard; **inalcanzable para un repo Dart externo.**

---

## 3. El mecanismo — un artefacto neutral, versionado

Emitir desde `@umi/contract` un solo archivo, neutral al lenguaje:

**`umi-contract-<semver>.json`**

```jsonc
{
  "version": "1.0.0",
  // Convenciones globales — el generador Dart las aplica una vez, no por ruta.
  "conventions": {
    "contentType": "application/json",
    "error": "ErrorResponse",              // TODA respuesta 4xx/5xx usa este schema
    "idempotencyHeader": "Idempotency-Key" // requerido en toda ruta con idempotent:true
  },
  "routes": [
    {
      "name": "pos.orders.create",
      "method": "POST",
      "path": "/api/v1/pos/orders",        // el major va en el path (ver §4)
      "params": [],                        // path params, en orden
      "request": "CreateOrderRequest",     // nombre de schema (debe existir en schemas)
      "response": "OrderResponse",
      "auth": "device-token",              // public | cookie | device-token
      "idempotent": true,                  // → exige el header Idempotency-Key
      "successStatus": 201,
      "errors": [400, 401, 403, 409, 422]  // status esperables → el error schema
    }
    // …un registro por endpoint, con auth + idempotencia EXPLÍCITAS
  ],
  "schemas": {
    // JSON Schema por cada zod, generado con zod-to-json-schema
    "CreateOrderRequest": { "type": "object", "properties": { /* … */ }, "required": [ /* … */ ] }
  }
}
```

- **`schemas`**: se genera con [`zod-to-json-schema`](https://www.npmjs.com/package/zod-to-json-schema) (zod v3 → JSON Schema Draft-7). Cero trabajo manual; el zod sigue siendo la fuente.
- **`routes`**: cada endpoint declara **explícitamente** método, template de path (`{param}` interpolable), params, schemas de request/response, **auth, idempotencia, status de éxito y códigos de error**. Un cliente generado necesita todo eso — no solo el path — para llamar bien: sin `auth` no sabe qué credencial mandar; sin `idempotent`+header no puede reintentar una venta sin duplicarla; sin `errors`+`ErrorResponse` no puede tipar los fallos.
- **`conventions`**: lo que es global (content-type, schema de error único, nombre del header de idempotencia) se declara una vez, no por ruta.
- **Publicación**: el artefacto se sube como **asset de un GitHub Release** por tag (`contract-v1.0.0`). El repo POS **fija (pin)** una versión — no consume `main`.
- **Codegen en el repo POS**: [`quicktype`](https://quicktype.io) (JSON Schema → modelos Dart `json_serializable`) para los tipos + un generador que convierte `routes[]` en un cliente de rutas tipado (con auth e idempotencia). Ambos corren en el repo POS contra el artefacto fijado.

### Metadatos de ruta EXPLÍCITOS (no inferencia en runtime)

Los `routes[]` **no** se infieren llamando a los builders de `routes.ts` con placeholders (frágil: no expone método, auth, idempotencia ni errores, y rompe si un builder hace algo no trivial). En su lugar, cada ruta declara sus metadatos junto al builder — la misma fuente que hoy es byte-exacta a los controladores NestJS:

```ts
// packages/contract/src/routes.ts — metadatos declarativos por endpoint
export const routeMeta = [
  { name: 'pos.orders.create', method: 'POST', template: '/api/v1/pos/orders',
    params: [], request: 'CreateOrderRequest', response: 'OrderResponse',
    auth: 'device-token', idempotent: true, successStatus: 201, errors: [400,401,403,409,422] },
  // …
] as const;
```

### Emisor (`packages/contract/scripts/emit-contract.mjs`)

```js
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as schemas from '../dist/index.js';           // los zod ya compilados
import { routeMeta } from '../dist/routes.js';
import pkg from '../package.json' assert { type: 'json' };

// tag inyectado por CI (ver §4); debe coincidir EXACTO con package.json.version
const tagVersion = process.env.CONTRACT_VERSION ?? pkg.version;
if (tagVersion !== pkg.version) {
  throw new Error(`tag ${tagVersion} != package.json ${pkg.version}`);
}

const schemaJson = {};
for (const [name, val] of Object.entries(schemas)) {
  if (val?._def) schemaJson[name] = zodToJsonSchema(val, name);   // sólo ZodType
}

// VALIDAR: cada schema referenciado por una ruta (o por conventions) existe.
const referenced = new Set(['ErrorResponse']);
for (const r of routeMeta) { if (r.request) referenced.add(r.request); referenced.add(r.response); }
const missing = [...referenced].filter((n) => !(n in schemaJson));
if (missing.length) throw new Error(`schemas referenciados y ausentes: ${missing.join(', ')}`);

const manifest = {
  version: pkg.version,
  conventions: { contentType: 'application/json', error: 'ErrorResponse', idempotencyHeader: 'Idempotency-Key' },
  routes: routeMeta,
  schemas: schemaJson,
};
process.stdout.write(JSON.stringify(manifest, null, 2));
```

El emisor **falla el release** si el tag no coincide con `package.json.version` o si una ruta referencia un schema inexistente — el artefacto nunca sale inconsistente.

---

## 4. Versionado (H-11) — porque el POS vive en campo

El POS y el KDS **no se actualizan a voluntad** (están en mostradores). Por eso el contrato es **semver estricto**, y el major tiene que ser **explícito en el transporte** — no solo un número en un JSON.

**El major va en el path: `/api/v{major}/...`.** (Elegido sobre header `Accept: application/vnd.umi.v1+json` por ser trivial de enrutar en NestJS, visible en logs/tracing, y cacheable/inspeccionable sin parsear headers.) Reglas:

- Cada major es un **grupo de rutas montado explícitamente** en el servidor (`@Controller('api/v1/pos')`). Dos majors coexisten como dos grupos; el viejo no se toca al agregar el nuevo.
- **Versión ausente o no soportada → `404`** (path desconocido) o **`406 unsupported_contract_version`** con el rango soportado en el body. Nunca se "adivina" el major ni se cae a un default silencioso — un cliente viejo debe fallar ruidoso, no ejecutar semántica nueva.
- El servidor mantiene compatibilidad por **N majors** (deprecación anunciada con fecha, no borrado). Sunset de un major = quitar su grupo de rutas, no mutarlo.
- **Aditivo = minor** (campo opcional nuevo, endpoint nuevo dentro del mismo major); el cliente viejo sigue vivo sin recompilar. **Incompatible = major** (renombrar/quitar campo, endurecer un `required`, cambiar tipo o path).
- **Test que lo prueba:** un cliente fijado a `v1` que pega una ruta con semántica solo-`v2` recibe `404/406`, nunca comportamiento `v2`. Ese test vive en umi-api y bloquea el merge.

**Integridad del release (inmutable):**

- El emisor exige `CONTRACT_VERSION` (el tag) **== `package.json.version`**; si no, falla (ver §3).
- Un tag `contract-vX.Y.Z` **no se republica con contenido distinto**: el job de release rechaza si ya existe un asset para esa versión cuyo hash difiere del recién generado. Un artefacto fijado por un POS en campo **nunca** cambia bajo sus pies.

---

## 5. La frontera de propiedad de datos (§8) — el contrato que impide la Opción A

**El repo POS escribe CERO en la base de datos.** Solo llama endpoints. Aquí es donde `modules/pos/` es el único autor:

| Entidad                                          | Autor (escritor)                                | El repo POS                    |
| ------------------------------------------------ | ----------------------------------------------- | ------------------------------ |
| `tenant.customer_order` / `order_item`           | `modules/pos/` (vía `POST /orders`)             | lo **pide**, no lo escribe     |
| `tenant.order_event`                             | `modules/pos/` (misma transacción que la orden) | lo consume por proyección      |
| `tenant.payment` / `refund`                      | `modules/pos/` (writer del POS)                 | lo **pide**                    |
| `tenant.loyalty_visit` (+`order_id`) / `_ledger` | módulo `cash` del API                           | lo **dispara** vía endpoint    |
| catálogo (`tenant.product` …)                    | Dashboard · POS-como-autor según `menu_source`  | escribe **vía API**, no vía DB |

**Regla:** un dato tiene exactamente un autor, y el autor es un módulo del API — nunca el cliente. El cliente no tiene credenciales de base de datos; tiene un **token de dispositivo enrolado** y habla HTTP. Esa es, por construcción, la garantía de que no hay segunda fuente de verdad.

---

## 6. Reparto entre los dos repos

|                     | Repo `umi` (este)                                        | Repo UmiPOS (Flutter, otro dev)              |
| ------------------- | -------------------------------------------------------- | -------------------------------------------- |
| Fuente del contrato | `@umi/contract` (zod + rutas) — **edita aquí**           | consume el artefacto (pin)                   |
| Artefacto           | **emite y publica** `umi-contract-<semver>.json` por tag | descarga el asset fijado                     |
| Backend             | `modules/pos/` — endpoints + escritor                    | —                                            |
| Tipos Dart          | —                                                        | **genera** con quicktype/codegen (no a mano) |
| Auth de dispositivo | endpoints de pairing (precedente KDS)                    | device-side (captura PIN, guarda token)      |
| Base de datos       | única, de Umi                                            | **ninguna** (cola offline ≠ base, §10-C)     |

---

## 7. Próximos pasos (en orden)

1. **`pos` en `PRODUCT_KEYS` + `umi.feature`** — ✅ **hecho en este PR** (sin esto UmiPOS no se puede contratar/facturar; H-4/H-8).
2. **Cablear el emisor** — añadir `zod-to-json-schema` (devDep), el script `emit-contract.mjs` y `npm run emit`; un job de CI que publique el artefacto al crear un tag `contract-v*`.
3. **`POST /orders` + `CreateOrderRequest` (zod)** — al aterrizar (H-1), el primer artefacto **útil para el POS** sale solo del emisor; no hay trabajo extra de contrato.
4. **El repo POS integra el codegen** contra el primer artefacto versionado y valida el hito: _una orden creada por el POS aparece en el KDS sin una línea de código de integración._

**Lo que este documento fija hoy:** la frontera (§5) y el mecanismo (§3–4). Con eso, el otro dev puede empezar el cliente sabiendo que **nunca** va a teclear un tipo del servidor a mano ni tocar la base — y nosotros sabemos que el contrato es la única superficie que exponemos.
