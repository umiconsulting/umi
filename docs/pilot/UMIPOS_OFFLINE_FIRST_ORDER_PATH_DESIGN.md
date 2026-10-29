# UmiPOS offline-first: el order path deja de esperar la nube

Status: `DESIGN + PLAN. FIRST WRITE-PATH SLICE LANDED (see §9); STAGE 1 NOT STARTED.`
Scope: `apps/umi-pos` (la copia de trabajo y el camino de escritura) y `apps/umi-api`
(contrato de comandos). No cubre dinero offline, que ya tiene su propia política.
Last updated: 2026-10-15.

## 1. El problema, dicho en código

**Hecho medido (2026-10-14, caja de producción).** Un viaje de ida y vuelta caja → API (Boston)
cuesta 96–100 ms estables en el iMin, más ~30–45 ms API → Postgres (Ohio). El piso de una acción
es **130–200 ms antes de que la app haga algo**. Ver
[`docs/research/2026-10-14-pos-latencia-hub-local`](../research/2026-10-14-pos-latencia-hub-local/README.md).

**Documented fact — de dónde sale el "siempre hay retraso".** No es una pantalla lenta; es que
**casi toda la interacción tiene la forma "espera la respuesta, luego píntate"**:

| Hecho en el código                                                                                                                                  | Dónde                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Toda mutación del carrito pasa por un solo embudo que primero deja el estado en `loading`, espera la red, y sólo entonces publica el carrito nuevo. | `apps/umi-pos/lib/features/cart/cart_controller.dart:740` (`_mutation`)         |
| ~**100** puntos de llamada a repositorio dentro de `features/`, todos `await`, todos en el camino de un tap.                                        | `rg -o 'await _?[a-zA-Z]*repository\.[a-zA-Z]+\('` sobre `features/`            |
| El catálogo se cachea **en memoria y por versión**, no en disco: al reiniciar la app no queda copia.                                                | `apps/umi-pos/lib/features/catalog/catalog_repository.dart:15` (`CatalogCache`) |
| El único almacenamiento persistente es `shared_preferences` + `flutter_secure_storage`; **no hay base local**.                                      | `apps/umi-pos/pubspec.yaml`, `lib/core/storage/storage.dart`                    |
| Cada escritura de carrito es un _compare-and-swap_: el servidor rechaza si `row.version !== expectedVersion`.                                       | `apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts:485, 650, 1266`       |

**Inference.** La causa no es Flutter ni las consultas: es que **el cliente no tiene copia de
trabajo y no tiene derecho a escribir**. Sin copia, cada lectura espera la red; sin derecho a
escribir, cada acción espera la red. Las dos cosas se arreglan en el cliente y en el contrato,
en ese orden.

## 2. Lo que exige un order path offline-first

**Inference, sobre los siete productos de la
[investigación de mecánica](../research/2026-10-15-offline-first-mecanica-competencia/README.md).**
Son cinco piezas. Ésta es la distancia de Umi a cada una:

| #   | Pieza                                       | Qué es                                                                                                                               | Qué tiene Umi hoy                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Copia de trabajo durable**                | Menú, precios, impuestos, modificadores, salón, cuentas abiertas, política, en disco, sembrada online y refrescada en segundo plano. | **Nada.** El `CatalogCache` es en memoria (`catalog_repository.dart:15`); no hay base local.                                                                                                                                                                                                                                                       |
| 2   | **Motor de orden local**                    | Preciar una línea, componer una cuenta, asignar mesa, calcular totales **sin servidor**.                                             | **Nada.** `price()`, `appendOrderItems` y `writeOrder` viven en `apps/umi-api/src/modules/pos-cart/` y `src/shared/orders/`.                                                                                                                                                                                                                       |
| 3   | **Log de comandos con identidad propia**    | Cada intención con id de cliente, ordenadas, idempotentes al reenvío.                                                                | **Parcial, y sólo para dinero.** `features/offline/offline_journal.dart` + `replay_engine.dart` existen y son durables, pero cubren el checkout de efectivo de `UMIPOS_OFFLINE_COMMAND_POLICY.md`, no las acciones del pedido.                                                                                                                     |
| 4   | **Autoridad de escritura y reconciliación** | Quién gana cuando dos aparatos tocan la misma cuenta, y cómo converge.                                                               | **La regla existe, el offline no la usa.** El servidor ya modela un dueño por cuenta: `operatorSessionId` + `CART_ACCOUNT_BUSY` cuando otro aparato la tiene (`pos-cart.repository.ts:484-498`). Es exactamente la serialización que Toast recomienda en prosa. Lo que falta es que el cliente pueda escribir **sin** esperar el CAS de `version`. |
| 5   | **Transporte dentro del local**             | La LAN como camino alterno cuando la WAN no está.                                                                                    | **Nada en la app.** La LAN existe en el hardware (Archer C50, iMin cableado, Epson) y el iMin **puede** ser el nodo, pero ningún aparato le habla a otro.                                                                                                                                                                                          |

## 3. La forma objetivo

**Inference.** Copiar a Toast y a Lightspeed, con el hardware que ya está en el paquete:

```
                 ┌──────────── WAN (hoy: el único camino) ────────────┐
                 │                                                     │
   nube ── API umi-api ── Postgres                                    │
                 ▲                                                     │
                 │ sync (siempre disponible, no en el camino del tap)  │
                 │                                                     │
  ┌──────────────┴──────────────────────────────────────────────┐     │
  │ NODO LOCAL — iMin D3, cableado, siempre encendido           │     │
  │ · copia de trabajo autoritativa del local                    │     │
  │ · punto único de serialización por cuenta                    │     │
  │ · sella y drena el log de comandos hacia la nube             │     │
  └──────┬────────────────────────────┬─────────────────────────┘     │
         │ LAN (Umi-<SITE>, Archer)   │                               │
         │                            │                               │
   comandera (A11)                KDS (A9+)                            │
   copia de lectura               copia de lectura                    │
   escribe al nodo                lee del nodo                         │
```

**Inference.** Lo que cambia para el cajero, que es lo que el dueño reporta: un tap ya no
espera la WAN. En el camino feliz la WAN **sigue existiendo y sigue siendo autoritativa**, sólo
sale del camino del tap. Esto es lo que hace PoloTab vendiendo el router y lo que hace
Lightspeed: el _active device_ habla con la nube cuando puede, y con los demás aparatos siempre.

## 4. El modelo de escritura: de CAS a log de comandos

Ésta es la parte que no se puede evitar y la que más se parece a la deuda de Odoo.

**Documented fact.** Hoy el servidor es un CAS: el cliente manda `expectedVersion` y el servidor
rechaza si no coincide (`pos-cart.repository.ts:485, 650`). Un cliente offline no puede conocer
`version`, así que este contrato **por construcción** impide escribir sin conexión.

**Inference — el cambio de contrato.** Cada mutación se convierte en un **comando**:

```
{ commandId, cartId, deviceId, operatorSessionId, seq, issuedAt, kind, payload }
```

con cuatro reglas:

1. **Idempotencia por `commandId`.** Reenviar un comando ya aplicado devuelve el mismo resultado,
   no lo aplica dos veces. Es la lección literal de Odoo (`process_saved_payments` duplicaba
   pagos, PR 273504) y es la razón por la que Umi ya usa `idempotencyKey` en el journal.
2. **Orden por `(deviceId, seq)`.** Monótono por aparato. El servidor aplica en orden; un hueco
   se espera, no se salta.
3. **Serialización por cuenta, no por versión.** El dueño de la cuenta sigue siendo
   `operatorSessionId`; el aparato que no es dueño recibe `CART_ACCOUNT_BUSY` — la regla ya
   existe y se queda. Un solo escritor por cuenta a la vez es lo que hace seguro el log.
4. **`expectedVersion` sobrevive como _excepción de negocio_, no como paso diario.** Se sigue
   exigiendo en lo que sí necesita autoridad en vivo: elevación de gerente, cancelar una línea
   ya preparada, todo lo que toca dinero autorizado por un tercero.

**Documented fact — el riesgo real.** La reconciliación es donde Odoo ha pagado: IndexedDB
contra servidor ([issue #189836](https://github.com/odoo/odoo/issues/189836)), líneas
resucitadas ([PR 285827](https://mergebot.odoo.com/odoo/odoo/pull/285827)), registros borrados
antes de sincronizar ([PR 265620](https://mergebot.odoo.com/odoo/odoo/pull/265620)).

**Inference.** Por eso el log se escribe **antes** de pintar, con la misma disciplina que el
journal de efectivo ya tiene: un comando se anota durable, se aplica en local, se pinta con
marca de pendiente, y sólo se marca oficial cuando el servidor lo confirma. Nada se considera
oficial por haberlo pintado.

### 4.1 Las tres capas de estado en el cliente

```
  ┌───────────────────────────────────────────────┐
  │ ESTADO PINTADO  =  base (servidor)  ⊕  comandos pendientes │
  └───────────────────────────────────────────────┘
         ▲                     ▲
         │                     └─ log local, durable, ordenado, marcado por comando
         └─ última copia confirmada por el servidor (working set)
```

**Inference.** Ésta es la pieza que convierte "espera la respuesta y luego píntate" en "píntate
y confirma después", sin tocar la verdad del servidor: la base sólo avanza cuando el servidor
la confirma; los pendientes se re-aplican encima. Si un comando se rechaza, se cae del log y la
base manda — que es el comportamiento de hoy, sólo que ya sin haber hecho esperar al cajero.

## 5. Las tres capas de "funciona sin internet" y hasta dónde llega Umi

**Inference.** El mercado vende "offline" como una sola palabra y son tres cosas distintas.
Conviene fijar cuál se promete:

| Capa                                   | Promesa                                                                                     | Costo                                           | Quién la tiene                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| **1. Lee sin red**                     | La pantalla abre con lo último que se sabe; el catálogo, el salón y las cuentas no esperan. | Bajo: copia durable + refresco en segundo plano | Odoo (dentro de una sesión), todos          |
| **2. Escribe sin red, en un aparato**  | Se toma el pedido, se imprime y se cobra en efectivo; el KDS se cae.                        | Medio: log de comandos + motor de precio local  | Square, Odoo, SumUp                         |
| **3. Escribe sin red, entre aparatos** | La comandera manda a la caja y la comanda llega al KDS sin WAN.                             | Alto: el nodo local y su ciclo de vida          | Toast, Lightspeed, Soft Restaurant, PoloTab |

**Inference.** Umi necesita la 1 para que se sienta rápido —y es la que ataca el problema que el
dueño reportó—, la 2 para vender cuando la WAN cae, y la 3 para que el KDS no se muera, que es
la promesa que ONCA quiere cumplir (`ONCA_OFFLINE_FIRST_DESIGN.md` §5-6). La 1 y la 2 son
software; la 3 es software más la decisión de que el iMin tenga el rol de nodo.

## 6. Plan por etapas

Cada etapa cierra con una prueba que se puede correr, no con una sensación.

### Etapa 0 — Medir antes de mover (1 semana, sin cambios de producto)

Un contador por acción: del tap a la pintura local, y del tap a la confirmación del servidor, con
la acción etiquetada. Se corre en el iMin real, sobre la red real del café.

**Criterio de salida:** una tabla de P50/P95 por acción (abrir cuenta, agregar línea, cambiar
cantidad, mover mesa, mandar a cocina, cobrar) que diga cuáles pesan y cuánto. Sin esto el
programa no es falsable.

### Etapa 1 — La copia de trabajo durable

Un almacén local versionado en el aparato con: catálogo (producto, variante, modificador,
precio, tasa de impuesto), salón y mesas, cuentas abiertas, registro de hardware y la política
firmada. Se siembra al abrir sesión con red y se refresca en segundo plano.

**Cambio en la app:** las lecturas del carrito y del catálogo devuelven la copia local de
inmediato y disparan el refresco; el refresco nunca vacía lo que ya se tiene.

**Decisión abierta (§7.1):** motor de almacenamiento.

**Criterio de salida:** con el uplink desconectado, la app abre el salón, la lista de cuentas y el
catálogo completo desde disco, sin spinner para datos que ya tenía. Ninguna pantalla empeora su
contenido por estar sin red.

### Etapa 2 — Escritura local-first para las acciones sin dinero

Abrir cuenta, agregar/quitar/modificar línea, renombrar, mover de mesa, mandar a cocina. Cada
una: comando con id de cliente → log durable → aplicar al working set → pintar con marca de
pendiente → empujar en orden.

**Cambio de contrato:** el log de comandos de §4 en `apps/umi-api`, con idempotencia por
`commandId` y aplicación ordenada por `(deviceId, seq)`.

**Criterio de salida:** con el uplink cortado, se toma una cuenta completa de cuatro líneas, se
imprime y se ve en pantalla; al volver la red, el servidor converge, la venta coincide línea por
línea con lo pintado, y **ningún** comando reenviado se aplica dos veces (prueba de reenvío
duplicado, espejo de la que ya existe para el journal de efectivo).

**Ya empezada, en la forma más pequeña que sirve.** Ver §9.

### Etapa 3 — El nodo local

El iMin cableado sirve la copia de trabajo a la comandera y al KDS por la LAN; cuando la nube no
está, los demás aparatos escriben al nodo. Es el rol _active_ de Lightspeed.

**Criterio de salida:** el drill de `ONCA_OFFLINE_FIRST_DESIGN.md` §7 pasa con el uplink
desconectado, incluido el paso 5 —hoy el KDS no muestra nada— y el paso 6.

### Etapa 4 — El banner y los límites honestos

El banner de estado con el estado real de `ConnectivityController`, y un diálogo de qué se puede
hacer, como Toast. Los estados ya existen (`PosConnectivity`); falta la superficie.

**Criterio de salida:** un cajero que nunca vio la app puede decir si está offline, qué sigue
funcionando y qué no, sin llamar a soporte.

## 7. Decisiones que necesitan al dueño

### 7.1 ¿Dónde vive la copia de trabajo en la v1?

- **A (recomendada).** Cada aparato tiene su copia para leer; el iMin es la autoridad para
  escribir cuando no hay nube. Es la forma Toast/Lightspeed y la única que resuelve la capa 3.
- **B.** Sólo el iMin tiene copia; los demás aparatos son clientes del nodo incluso con WAN.
  Más simple y más rápido, pero la comandera depende del iMin aunque haya internet.

### 7.2 Motor de almacenamiento local

- **A (recomendada).** Instantánea JSON versionada y escrita de forma atómica en el directorio de
  la app (`path_provider`). El menú de un café son decenas a cientos de productos; entra en
  memoria y se escribe completa. Cero dependencias nuevas y encaja con el cacheo por versión que
  ya existe (`CatalogPartition`).
- **B.** SQLite (`sqflite`/`drift`). Escala a menús enormes y a consultas, a cambio de una
  dependencia nueva, migraciones y más superficie que probar. Se justifica cuando el working set
  deje de caber cómodamente en memoria.

### 7.3 ¿El KDS tiene que sobrevivir a una caída de la WAN?

Es la pregunta cara. Tres respuestas, en orden de costo: aceptar la caída (hoy); respaldo en
papel con procedimiento; nodo local (etapa 3). Está planteada con más detalle en
`ONCA_OFFLINE_FIRST_DESIGN.md` §6.2 y **no** está resuelta.

### 7.4 Frescura del precio y del impuesto bajo offline

El motor local preciará con la última instantánea. El precedente de Umi ya admite frescura
acotada (la política de efectivo offline acota catálogo, precios e impuestos), así que la
decisión es de **cota**, no de principio: cuántas horas de antigüedad tolera una comanda.

## 8. Lo que no se hace

1. **No se convierte al cliente en la autoridad del precio** sin instantánea firmada y cota de
   frescura. El motor local preciará con una copia; esa copia tiene que venir del servidor y
   llevar su edad.
2. **No se hace offline la tarjeta, la transferencia ni el saldo de un tercero.** Los siete
   productos que lo intentaron lo acotan, lo vencen o lo prohíben, y Umi ya lo prohíbe en
   `UMIPOS_OFFLINE_COMMAND_POLICY.md`.
3. **No se pinta como oficial lo que sólo está pendiente.** Es el bug de Odoo y es el reporte
   de los operadores de Toast: cuentas cerradas en un handheld que siguen abiertas en los demás.
4. **No se empieza por el KDS.** Es el más caro y el más visible; la etapa 1 sola ya quita el
   retraso que el dueño reportó.

## 9. Lo que ya está en el código (2026-10-15)

Se adelantó la mitad barata de la etapa 2, porque no necesita ninguna decisión de §7: **el tap
ya no espera a Boston**. El cambio es de cliente y no toca el contrato del servidor.

| Pieza                            | Dónde                                                 | Qué hace                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Predicción de carrito            | `apps/umi-pos/lib/features/cart/cart_optimism.dart`   | Precia una línea, recalcula totales, quita y reescala líneas, renombra la cuenta. Es una transcripción deliberada de la aritmética del servidor —precio **bruto**, impuesto extraído de dentro— con la nota de que las dos tienen que cambiar juntas.                                                                              |
| Embudo con predicción            | `apps/umi-pos/lib/features/cart/cart_controller.dart` | `_mutation` acepta un `predict`: cuando el llamador puede decir qué pasa después, el carrito se pinta **ya** y la respuesta del servidor lo reemplaza al llegar. Cuando no puede, se comporta exactamente como antes. Una escritura rechazada **deshace lo pintado**: nunca queda en pantalla una línea que el servidor no aceptó. |
| Escritor único con nombre propio | `cart_controller.dart` (`_inFlight`, `isWriting`)     | Antes "hay una escritura en vuelo" se decía `phase == loading`, y eso griseaba la pantalla en cada tap. Ahora tiene su propio nombre, y es lo que impide que dos taps compitan por el mismo `expectedVersion`. La superficie pasó a preguntar `isWriting`.                                                                         |
| Precio provisional en el tap     | `catalog_surface.dart`                                | Las dos rutas de un solo toque —la tarjeta de la categoría y el código de barras— pasan un `ProvisionalLine` construido del detalle que ya está en pantalla. Un producto con variantes u opciones **no** se predice: ahí el operador eligió algo, y una elección que la caja no puede costear todavía se espera.                   |

**Verificación.** `flutter analyze` limpio sobre todo el app, y la suite completa del POS en
verde con **1006** pruebas: las 996 que ya existían más 10 nuevas en
`apps/umi-pos/test/cart_optimism_test.dart`, que fijan el precio predicho contra la fórmula del
servidor, el orden "pinta y luego confirma", que un rechazo devuelve la pantalla al último
estado verdadero, que un producto sin precio conserva el comportamiento anterior, y que una
segunda escritura se rechaza mientras la primera está en el aire.

**Lo que esto todavía no es.** No hay copia durable (§6 etapa 1): al reiniciar la app no queda
carrito, catálogo ni salón en disco. No hay cola (§4): si la red cae, la escritura falla y el
carrito vuelve a su último estado verdadero — la caja deja de vender, que es exactamente lo que
la etapa 2 tiene que cambiar. Y `fire`, `assignAccountTable`, `setFulfillment` y `open` siguen
esperando la red, porque ninguno tiene todavía una predicción que sea exacta.
