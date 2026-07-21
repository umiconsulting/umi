# UmiPOS (NEXO) — Análisis técnico y funcional de integración con la plataforma Umi

**Fecha:** 2026-07-14
**Estado:** Análisis y propuesta. No se modificó código de producción, no se crearon endpoints, no se tocó la base de datos.
**Base del análisis:** el modelo de dominio aceptado de Umi ([`2026-07-05-platform-domain-model-synthesis.md`](./2026-07-05-platform-domain-model-synthesis.md), _Accepted target_) y su realización física en `docs/migration/build-v3/`. **Todas las referencias de esquema en este documento son al modelo v3**, que es la arquitectura de la plataforma.

**Convención de etiquetas:**

| Etiqueta                           | Significado                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[CONFIRMADO]**                   | Verificado leyendo el modelo o el código. Se cita archivo y línea.                                                                                                                                   |
| **[PROPUESTA]**                    | Diseño recomendado. No existe todavía.                                                                                                                                                               |
| **[HUECO]** (**H-n**)              | Algo que falta hoy. **Cada hueco lleva estado** — ✅ decidido · ⚠️ diferido a propósito · ❌ fuera de la planeación — porque _«todavía no»_ y _«nunca»_ no son lo mismo. Tabla completa en **§5.2**. |
| **[DECISIÓN PENDIENTE]** (**Q-n**) | Requiere que una persona decida. Se indica quién. Tabla en **§17**.                                                                                                                                  |
| **R-n** / **S-n**                  | Riesgo (**§16**) · Requisito de seguridad (**§13.1**).                                                                                                                                               |

---

## 0. Encuadre — premisas corregidas antes de responder

El prompt original de análisis parte de tres premisas que, si se aceptan, generan meses de trabajo innecesario y un sistema peor. Este documento las corrige antes de contestar, porque **la mitad de las preguntas del prompt solo tienen sentido si las premisas son verdaderas, y no lo son.**

### 0.1 «NEXO es un sistema externo que se integra con esta plataforma» → **FALSO**

**NEXO es un producto de Umi.** Va a llamarse UmiPOS. No es un SaaS par que negocia un contrato de integración con Umi: es **un cliente más del backend de Umi**, exactamente como ya lo son el KDS y el dashboard.

Esto no es una preferencia organizacional, tiene consecuencias arquitectónicas duras. Si NEXO fuera un sistema externo, habría que diseñar:

- sincronización bidireccional de catálogos entre dos bases de datos,
- replicación de ventas de NEXO hacia Umi,
- reconciliación periódica del wallet entre dos fuentes de verdad,
- webhooks, reintentos, entrega fuera de orden, deduplicación,
- una matriz de propiedad de datos entre dos compañías,
- versionado de contratos entre dos equipos con ciclos de release distintos.

**Nada de eso debe existir.** Todos esos son problemas que aparecen _únicamente_ porque hay dos bases de datos. Con un solo backend y una sola base, el POS hace `POST /orders` y terminó.

Esto además es un principio fundacional de Umi, no una opinión de este documento. El modelo aceptado lo enuncia así: _**"a single backend owns all data; everything else is a thin client"**_ (synthesis §5a). Una segunda base de datos de ventas contradice la arquitectura de la plataforma.

La sección 10 compara explícitamente las dos arquitecturas y cuantifica la diferencia en riesgo.

### 0.2 «El POS es multi-pantalla: móvil, tablet, web, desde cualquier lugar» → **PARCIALMENTE FALSO, y la parte falsa es peligrosa**

La intuición de multi-pantalla es buena. La conclusión de «se accede desde una página web desde cualquier lugar» es inaceptable para un sistema que **cobra dinero**.

Un POS accesible desde cualquier navegador, en cualquier dispositivo, con solo usuario y contraseña, significa que un empleado puede abrir caja, registrar ventas, aplicar descuentos y mover saldo **desde su casa, desde su teléfono personal, a las 3 de la mañana**. Ese es el vector de fraude interno más común en retail y restaurantes, y es exactamente el tipo de incidente que destruye la reputación de un proveedor de POS ante sus clientes. Umi le está pidiendo a una cafetería que confíe su caja registradora a nuestro software.

**Multi-pantalla ≠ multi-acceso.** Lo correcto es separar _superficies_ con _permisos distintos_:

| Superficie                                                    | Dispositivo                                           | Autenticación                                   | ¿Puede cobrar? |
| ------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- | -------------- |
| **POS** (cobro, apertura/cierre de caja)                      | Terminal Android whitelabel / tablet **dada de alta** | Token de dispositivo enrolado + PIN de empleado | **Sí**         |
| **KDS** (cocina)                                              | Tablet **dada de alta**                               | Token de dispositivo enrolado                   | No             |
| **Dashboard** (back-office: catálogo, reportes, corte, altas) | Cualquiera, web                                       | Sesión de usuario                               | **No**         |
| **Cliente** (wallet, pases, gift cards)                       | Teléfono del cliente                                  | Sesión de cliente / pase                        | No             |

Un empleado puede _ver_ el reporte de ventas desde su casa en el dashboard. **No puede cobrar desde su casa.**

Y esto tampoco es una invención de este documento: **el modelo de Umi ya distingue el dispositivo como un principal de primera clase.** `tenant.device` tiene `kind CHECK (kind in ('kds','pos_terminal'))` (`build-v3/20_tenant.sql:468`) y `runtime.session.app CHECK (app in ('kds','dashboard','pos'))` (`build-v3/30_runtime.sql:22`). **El POS ya está modelado como un aparato que se da de alta, no como una URL.** La sección 6.3 documenta el flujo completo, que ya funciona para el KDS.

### 0.3 «NEXO trae su propio stack» → **NO**

El stack es el de Umi. Un stack distinto implica un backend distinto → una base distinta → los seis problemas de sincronización de arriba.

| Capa            | Stack Umi **[CONFIRMADO]**                                                                               | Qué implica para UmiPOS                                                                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend         | NestJS 11 + Fastify 5, `pg` (SQL a mano, sin ORM), BullMQ, zod/class-validator                           | UmiPOS **no levanta un backend nuevo**. Es un módulo dentro del backend existente: `apps/umi-api/src/modules/pos/`.                                                                                                                                          |
| Base de datos   | **Umi ya tiene su Postgres**: 3 esquemas por autoría (`umi` / `tenant` / `runtime`), con RLS por negocio | UmiPOS **no levanta una base de datos separada**: escribe en la base de Umi, en las mismas tablas que ya leen el KDS y el dashboard. _(Aclaración, porque se presta a confusión: no es que "no haya base de datos" — es que **no debe haber una segunda**.)_ |
| Cliente POS     | —                                                                                                        | **Flutter** (Android whitelabel; macOS/iOS para pruebas).                                                                                                                                                                                                    |
| Cliente KDS     | Swift/SwiftUI nativo iPad                                                                                | **Migrar a Flutter** y compartir con el POS: auth de dispositivo, cola offline, capa HTTP, design system.                                                                                                                                                    |
| Dashboard       | React 18 + Vite                                                                                          | Se le agregan pantallas de POS (catálogo, corte de caja, reportes). Sigue siendo web.                                                                                                                                                                        |
| Contrato        | `@umi/contract` (zod + rutas tipadas)                                                                    | El POS **extiende** el contrato existente.                                                                                                                                                                                                                   |
| Infraestructura | GitHub Actions → GHCR → VPS; frontends en Vercel                                                         | Sin cambios. El POS no agrega infraestructura.                                                                                                                                                                                                               |

**La decisión de migrar el KDS a Flutter es correcta y es más valiosa de lo que parecía**, porque el POS y el KDS comparten el 80% de su naturaleza: los dos son dispositivos enrolados, de sesión larga, que hablan con el mismo API, viven en la barra de una cafetería y necesitan comportarse bien sin red. Escribir esa base dos veces (Swift + Flutter) sería tirar dinero.

**[DECISIÓN PENDIENTE — dueño]** Confirmar que el KDS migra a Flutter _antes o durante_ el POS, para que el POS herede la base compartida y no al revés.

### 0.4 La arquitectura de Umi **ya reservó el asiento del POS**

Esta es la corrección más importante, y hay que entenderla antes de leer el resto: **el POS no llega a negociar su lugar en la arquitectura de Umi. El POS es el producto por el cual varias piezas de esa arquitectura existen.**

El modelo de dominio aceptado tiene una sección dedicada al tema — **§5a, "Authority ≠ system-of-record — the menu, and POS as a product"**:

> **"POS as a product (the literal accounting).** A Umi POS is a likely near-future product; seating it now converts several speculative `∅writer` question-marks into load-bearing facts:
>
> - It joins the catalog: `subscription_item.product_key` gains **`pos`**.
> - It is simultaneously an **order channel**, a **payment/refund writer**, a **menu-authoring interface**, and a **loyalty actor** (card scan at the register).
> - Under the merge rule, this **promotes `channel`, `payment`, `refund` from `∅writer` to load-bearing** — the second real order channel (beside WhatsApp), the first real payment writer. **The multi-channel/payment structure the prior docs called 'anticipatory' is now _earned_.**"

Léase con cuidado la última frase. **Las tablas `payment`, `refund` y `channel` dejaron de ser especulativas precisamente porque se asumió que el POS iba a llegar.** Existen en el modelo esperándolo.

Y el POS aparece, con nombre propio, en cada capa del modelo:

| Capa                | Evidencia **[CONFIRMADO]**                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Orden**           | `tenant.customer_order.source CHECK (source in ('whatsapp','pos','web','dashboard'))` — `build-v3/20_tenant.sql:403`                          |
| **Dispositivo**     | `tenant.device.kind CHECK (kind in ('kds','pos_terminal'))` — `:468`                                                                          |
| **Sesión**          | `runtime.session.app CHECK (app in ('kds','dashboard','pos'))` — `build-v3/30_runtime.sql:22`                                                 |
| **Canal**           | `umi.channel_type` siembra `('pos', 'Point of Sale')` — `build-v3/10_umi.sql:307`                                                             |
| **Integración**     | `tenant.integration.provider` incluye **`'umi_pos'`**, con el comentario _"Umi's own POS is just provider='umi_pos'"_ — `20_tenant.sql:86,99` |
| **Catálogo / menú** | `tenant.business.menu_source CHECK ('dashboard','pos_sync')` — `:38-39`                                                                       |

**No hay que negociar una arquitectura de integración. Hay que ocupar el espacio que el modelo ya reservó y terminar de construirlo.**

La única pieza que el modelo **pide y todavía no tiene** es la entrada de `pos` en el catálogo de productos que se le vende a cada café — la synthesis §5a la exige explícitamente (_"`subscription_item.product_key` gains `pos`"_), pero el CHECK de `umi.feature.module` sigue siendo `('cash','dashboard','conversaflow','kds')` (`build-v3/10_umi.sql:112-113`). **Sin eso, UmiPOS no se puede contratar, activar ni facturar.** Es el hueco **H-4**, y es barato de cerrar.

### 0.5 La conversación correcta

Con las premisas corregidas, la pregunta **no es** «¿cómo integramos el POS con Umi?».

Es: **«el POS es el módulo de comercio que Umi todavía no ha construido, el modelo ya lo tiene asentado, y sin él la promesa central de Umi no se sostiene».**

**[CONFIRMADO]** El modelo de Umi tiene lealtad, órdenes por WhatsApp, cocina y dashboard. Tiene las tablas `tenant.payment` y `tenant.refund` — **y todavía no tienen un escritor.** No hay impuestos, ni propina, ni descuentos, ni caja, ni inventario. _(El estado exacto de cada faltante —decidido, diferido a propósito, o fuera de la planeación— está en §5.2, y la distinción importa: no es lo mismo «todavía no» que «nunca».)_

Y la consecuencia más cara: **la lealtad de Umi está ciega.** Un sello no referencia una orden. Una recarga de saldo no referencia un pago. El staff teclea el monto a mano. Umi le da a la cafetería una tarjeta de sellos que **no sabe qué compró el cliente.**

Por eso la integración «tiene que ocurrir sí o sí»: **el POS es lo que cierra el circuito.** Es lo que convierte a Umi de «una app de sellos + un bot» en una plataforma que sabe qué se vendió, a quién, cuándo y por cuánto. Todo lo demás que Umi promete —recomendaciones, recompensas por gasto, analítica real, IA que conoce al cliente— depende de un dato que hoy no se captura.

---

## 1. Resumen ejecutivo

### 1.1 Viabilidad

**La integración es viable y el camino ya está trazado**, siempre que se acepte que UmiPOS es un cliente del API de Umi y no un sistema separado (§0.1), y que el cobro ocurre en dispositivos dados de alta (§0.2).

El modelo ya contiene al POS en cada capa donde debería estar (tabla en §0.4). El trabajo no es diseñar una integración: es **escribir el módulo que el modelo está esperando.**

### 1.2 Los cinco hechos que definen el alcance

1. **[CONFIRMADO] Hoy no existe ningún endpoint que cree una orden.** Hay 28 rutas `POST` en todo `umi-api` y **ninguna crea una orden** (verificado, ruta por ruta). El único `INSERT` de órdenes del monorepo lo invocan dos herramientas del LLM del bot de WhatsApp. **El POS estrena ese camino de escritura.**

2. **[CONFIRMADO] No existe autenticación máquina-a-máquina — y es deliberado.** No hay API keys, ni bearer tokens, ni tokens de servicio, ni mTLS. Las únicas credenciales no-humanas son el **token de dispositivo** (KDS) y las firmas HMAC de webhook. **Esto no es un hueco: es una postura, y hay que mantenerla.** Confirma §0.2: el camino correcto para el POS no es inventar una API key portátil (que se copia y se filtra), es reusar el token de dispositivo enrolado.

3. **[CONFIRMADO] No existe comercio** — pero **no todo lo que falta tiene el mismo estatus**, y la diferencia importa (§5.2):
   - ✅ `tenant.payment` y `tenant.refund` **existen en el modelo, esperando escritor** — y el modelo dice que ese escritor **es el POS**.
   - ⚠️ **Inventario** está fuera **a propósito**, esperando un disparador que el POS podría ser.
   - ❌ **Impuestos, propina, descuentos, caja, corte e impresión no están en la planeación.** Ahí no hay nada: hay que decidirlos y construirlos.

   **El POS no se integra con el módulo de ventas: el POS _es_ el módulo de ventas.**

4. **[CONFIRMADO] El wallet no es lo que NEXO cree.** No tiene ninguna relación con productos vendidos. La sección 3 existe específicamente para corregir esto, porque es el malentendido más caro del brief.

5. **[CONFIRMADO] La lealtad y la venta están desconectadas por diseño, y el POS es lo que las une.** Ningún sello lleva `order_id`; ningún movimiento de saldo lleva referencia a una venta. La sección 12.3 propone el enganche, que es la pieza de mayor valor de todo el proyecto.

### 1.3 Recomendación en una frase

**Construir UmiPOS como un módulo de `umi-api` (`apps/umi-api/src/modules/pos/`) sobre el modelo v3, más un cliente Flutter en dispositivo enrolado, escribiendo en las mismas tablas que ya leen el KDS y el dashboard — y no construir absolutamente nada de sincronización, replicación ni reconciliación, porque con una sola fuente de verdad ninguna de esas cosas es necesaria.**

El argumento decisivo, en concreto:

> **El KDS no lee una tabla propia: lee una proyección derivada de `tenant.customer_order` + `tenant.order_event`.** No existe código de integración entre el bot de WhatsApp y la cocina — la orden aparece porque ambos miran los mismos datos.
>
> Si el POS escribe la orden ahí, **aparece en el KDS y en el dashboard sin una sola línea de código de integración.**
>
> Si el POS escribe en su propia base, hay que construir —y mantener para siempre— una replicación que produzca ese mismo resultado, y que va a divergir.

Esa es toda la decisión.

---

## 2. Arquitectura

### 2.1 El modelo, en una imagen

La plataforma parte por **autoría**: ¿de quién es este hecho? (synthesis §2)

```
┌──────────────────────────────────────────────────────────────────────┐
│  umi.*        EL NEGOCIO DE UMI                                      │
│               user · role · user_role        (identidad de operador) │
│               feature · plan · subscription  (qué tiene contratado)  │
│               channel_type · prospect                                │
├──────────────────────────────────────────────────────────────────────┤
│  tenant.*     EL NEGOCIO DEL RESTAURANTE            [RLS por negocio]│
│                                                                      │
│   ORG        business ─→ branch ─→ station                           │
│                                                                      │
│   DEMANDA    contact ─→ customer          (grafo de identidad)       │
│   (externa)  conversation · message                                  │
│              customer_order ─→ order_item ─→ order_event      ⭐     │
│              payment · refund                                 ⭐⭐   │
│              loyalty_card · loyalty_visit · loyalty_stored_value_    │
│                ledger · loyalty_reward · loyalty_gift_card · pass ⭐ │
│                                                                      │
│   SUMINISTRO product · product_category · option_group · modifier    │
│   (interna)  staff · device(kds|pos_terminal) · integration          │
├──────────────────────────────────────────────────────────────────────┤
│  runtime.*    LA MAQUINARIA         [sellado; solo el worker]        │
│               session · pairing · outbox_event · inbound_event       │
│               idempotency_key · dead_letter                          │
└──────────────────────────────────────────────────────────────────────┘

⭐  = el POS se SUMA como escritor (ya hay otros: el bot, el módulo de lealtad).
⭐⭐ = existe en el modelo y NO tiene NINGÚN escritor todavía.
      El POS es el primero. Es, literalmente, para lo que se modelaron.
```

Regla clave que evita el error más común (synthesis §7): **el esquema es la frontera de _autoría_, no la de dominio.** El dominio (cash / kds / conversaflow / **pos**) vive **en el código**, en `modules/<dominio>/`. Por eso UmiPOS es `modules/pos/` y **no** un esquema `pos.*`.

### 2.2 Clientes

```
   POS (Flutter, Android whitelabel) ──┐  token de dispositivo
   dispositivo ENROLADO                │  + PIN de empleado
   cola offline + replay idempotente   │
                                       │
   KDS (Flutter, migrado de Swift) ────┤  token de dispositivo
   dispositivo ENROLADO                │
                                       ▼
   Dashboard (React) ─────────────▶ ┌──────────────────────────┐
   sesión de usuario · NO cobra     │  umi-api                 │
                                    │  ├── modules/pos/  ← NUEVO
   WhatsApp (Twilio) ────────────▶  │  ├── modules/kds/        │
                                    │  ├── modules/cash/       │
                                    │  └── modules/conversations
                                    └────────────┬─────────────┘
                                                 ▼
                                        UNA base · UNA orden
```

---

## 3. Definición exacta del «wallet» — corrección al equipo de NEXO **[CONFIRMADO]**

El brief de NEXO dice: _«un "wallet" relacionado con los productos vendidos por cada cafetería»_.

**Eso es incorrecto en los dos extremos: ni es un wallet único, ni tiene relación con los productos vendidos.**

### 3.1 Qué es realmente

Son **dos contadores independientes** que cuelgan de la misma tarjeta de lealtad (`tenant.loyalty_card`), más dos instrumentos accesorios. En el modelo v3 los nombres por fin dicen la verdad:

| Concepto                     | Tabla (v3)                                                                                              | Unidad                   | Qué lo incrementa                                                                         | Qué lo decrementa    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------- | -------------------- |
| **(a) Sellos / visitas**     | `tenant.loyalty_visit` — _"One row per stamp"_ (`20_tenant.sql:65`)                                     | conteo, **sin moneda**   | **+1 por escaneo del staff.** Siempre 1, nunca proporcional al gasto. Máximo uno por día. | canje de recompensa  |
| **(b) Saldo / monedero**     | `tenant.loyalty_stored_value_ledger` — _"MONEY (Saldo). balance = SUM(delta). Append-only."_ (`:32-49`) | **centavos MXN enteros** | recarga, canje de gift card                                                               | compra con saldo     |
| (c) Gift cards               | `tenant.loyalty_gift_card` + su ledger                                                                  | centavos MXN             | emisión                                                                                   | canje → acredita (b) |
| (d) Recompensa de cumpleaños | `tenant.loyalty_reward` (`type='birthday'`)                                                             | no es saldo              | —                                                                                         | —                    |

Dos invariantes del modelo que el POS debe respetar:

- **`loyalty_card` es identidad, nada más.** _"IDENTITY ONLY. No cached balance or visit count"_ (`20_tenant.sql:188-189`). El saldo es `SUM(ledger.delta)` y las visitas son `COUNT(loyalty_visit)`. **Nunca se cachea un total.** Un POS que escriba una columna de saldo está rompiendo el modelo.
- **Los ledgers de dinero son append-only**, con trigger (`tenant.tg_append_only`). **Nunca se actualiza ni se borra una fila de dinero.** Una devolución es una fila nueva con delta negativo.

### 3.2 La trampa de nombres (por si tocan el esquema viejo)

> El modelo v3 renombró la tabla del monedero a `loyalty_stored_value_ledger` con el comentario _**"Was misnamed card_ledger"**_, precisamente porque el nombre anterior engañaba: **guardaba dinero, no puntos.**
> Si en algún momento se topan con una tabla llamada `points_ledger`, **no son puntos: son centavos.** Es el error más caro que se puede cometer la primera semana.

### 3.3 La relación con productos vendidos: **NINGUNA. Cero.**

Esta es la corrección central:

- **[CONFIRMADO]** `tenant.loyalty_visit` **no tiene `order_id`, ni monto, ni producto.** Un sello significa literalmente _"un humano con teléfono se paró frente a un humano con iPad"_.
- **[CONFIRMADO]** Un movimiento de saldo **no referencia una venta ni un pago.** El monto **lo teclea el staff en un formulario**; el efectivo o la tarjeta se cobran **fuera del sistema**, en la caja. La plataforma no se entera de que hubo un pago.
- **[CONFIRMADO]** La regla de recompensa se mide en **visitas, no en dinero gastado** (`loyalty_reward.visits_required`, default 10). El modelo v3 **ya anticipa** un tipo `'spend_cashback'` con `spend_required` (`20_tenant.sql:72-74`) — **pero no tiene forma de saber cuánto gastó nadie.** Está esperando al POS.

### 3.4 Lo que esto significa para el POS

**El gancho que NEXO busca no existe todavía, y construirlo es la razón de ser del proyecto.**

Cuando el POS exista, por primera vez se podrá: estampar un sello **con `order_id`**; ligar el ledger de dinero a una venta real; habilitar recompensas por gasto (hoy imposibles); y darle a la IA de Umi el historial de compra que le falta.

El modelo ya dejó los ganchos preparados: `tenant.loyalty_visit.source` tiene un CHECK (`'scan','manual','migration'`) y el ledger de dinero tiene `external_ref`. **Falta el `order_id` y el valor `'pos'` en el CHECK.** Ver 12.3 y el hueco **H-5**.

---

## 4. Modelo de datos relevante **[CONFIRMADO]**

### 4.1 La orden — `tenant.customer_order`

Es la tabla central del POS. Del modelo v3 (`20_tenant.sql:397+`):

- **`source`** — `CHECK (source in ('whatsapp','pos','web','dashboard'))`. **`'pos'` ya es un valor válido y está esperando su primer escritor.**
- **`business_id`** — la llave de tenant en todo el modelo v3. **No es `tenant_id`.**
- **`branch_id`** — la sucursal.
- **Dinero en `bigint` centavos.** Regla del modelo: _"money = `bigint` centavos"_ (`10_umi.sql:6-16`). **Nunca float, nunca pesos.**
- **`tenant.order_item`** — lleva `station_id` (ruteo a cocina) y **snapshot de nombre y precio unitario**: una línea de orden es una foto del momento, no un puntero vivo al catálogo.
- **`tenant.order_event`** — el diario append-only del ciclo de vida.

> ### ⚠️ La trampa número uno para quien escriba el endpoint del POS
>
> **El estado de cocina NO es una columna de la orden.** Se **deriva** del último `order_event` con `kitchen_status`. Una transición **agrega un evento**; no muta una columna.
>
> **Consecuencia:** si insertas la orden y olvidas el `order_event` de apertura, la orden existe en la base y **es invisible en la cocina y en el dashboard.** Silenciosamente. La orden y su evento de apertura se escriben **en la misma transacción**, o no se escriben.

### 4.2 Pago — `tenant.payment` / `tenant.refund`

**[CONFIRMADO]** Existen en el modelo (`20_tenant.sql:438,450`), con `method CHECK ('cash','card','stored_value','gift_card')` y moneda. **No tienen escritor.**

El modelo aceptado dice exactamente por qué existen: el POS es _"the first real payment writer"_ (synthesis §5a). **Están esperando a este proyecto.**

**[DECISIÓN PENDIENTE — dueño, y es la más importante del proyecto]** ¿UmiPOS **procesa** pagos (integra una terminal / adquirente) o solo **registra** el medio de pago que se cobró aparte? Son dos productos, dos ámbitos regulatorios y dos esfuerzos completamente distintos. Ver **Q-01**.

### 4.3 Catálogo — existe, y el POS es un autor legítimo

**[CONFIRMADO]** El modelo v3 tiene catálogo completo (`20_tenant.sql:294-342`): `product`, `product_category`, `product_option_group`, `product_modifier`, `product_branch_availability`. La sección se titula, literalmente, `-- COMMERCE (generic — no "menu")`.

Y resuelve por adelantado una pregunta que el POS iba a levantar. El modelo separa tres cosas que se confunden todo el tiempo (synthesis §5a):

| Capa                                              | Para el menú                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Autoridad** (quién puede decidir)               | **el dueño del negocio.** Prueba de primer principio: _sin ningún software y sin ningún proveedor, ¿quién puede crear/cambiar/retirar este hecho?_ → lo escribiría en un pizarrón. |
| **Sistema de registro** (quién guarda el maestro) | **el API/DB de Umi.** Siempre.                                                                                                                                                     |
| **Interfaz** (qué lo escribe)                     | el editor del dashboard · una sincronización externa · **el POS** — todos a través del mismo API.                                                                                  |

Es decir: **el POS es una interfaz de autoría de menú legítima y prevista** (synthesis §5a lo llama _"a menu-authoring interface"_), y `tenant.business.menu_source` es el ajuste **por negocio** que decide quién manda cuando hay conflicto.

**[DECISIÓN PENDIENTE Q-05]** No es _"¿puede el POS editar el menú?"_ (sí puede, está en el modelo). Es: **¿cuál es la dirección de resolución de conflicto por cada tenant?** — es decir, el valor de `menu_source`.

### 4.4 Inventario — deliberadamente ausente, y el POS es el disparador

**[CONFIRMADO]** No existe inventario en el modelo. **Y es a propósito.** La synthesis §5 identifica la **espina de suministro** (proveedores, procurement, inventario) como un **universo conocido-faltante**, con una regla explícita:

> _"**Flag, do not invent** (no writer exists): the supply spine is a **known-missing universe**, to be modeled only when a real writer/feature appears — not frozen into speculative DDL now."_

**El POS podría ser precisamente ese "real writer".** Por eso la pregunta de si inventario entra al alcance no es una omisión: **es exactamente la condición que el modelo nombró como disparador.**

**[DECISIÓN PENDIENTE Q-03]** ¿Inventario en fase 1? **Recomendación: no.** Una cafetería puede operar un POS sin inventario, y meterlo en la fase 1 duplica el alcance de un proyecto que ya es grande. Modelarlo cuando el POS esté vendiendo, que es cuando el modelo dice que hay que modelarlo.

### 4.5 Clientes e identidad — el POS entra por la espina de demanda

El modelo separa dos tipos de humano que entran **por puertas opuestas** (synthesis §3):

|                 | **Cliente** (demanda)                           | **Staff / dueño** (suministro)        |
| --------------- | ----------------------------------------------- | ------------------------------------- |
| Entra por       | **adquisición** — se le alcanza por un canal    | **alta** — se le contrata             |
| Su identidad es | **recolectada y resuelta** (grafo de identidad) | **asignada y autenticada** (un login) |
| Modelo          | `tenant.contact` → `tenant.customer`            | `umi.user` + `umi.user_role`          |

**Para el POS:** cuando el cajero identifique a un cliente (escaneando su QR o capturando su teléfono), entra por **el resolvedor de identidad** — no crea `contact` ni `customer` por su cuenta. El teléfono es un **identificador federado** (`(issuer, subject)`): el POS es un `channel` más (`umi.channel_type` ya siembra `'pos'`), igual que WhatsApp.

**[CONFIRMADO]** El cliente es **por-negocio**. El mismo humano en dos cafeterías son dos filas. No hay identidad global entre tenants, y eso es una decisión explícita del modelo, no un descuido.

### 4.6 Sucursales — el POS simplifica el problema

**Para el POS esto se simplifica radicalmente, y es una ventaja grande:** un POS **está físicamente en una sucursal.** El `branch_id` no se infiere ni se pregunta — **viene del dispositivo enrolado.** Esto elimina de un plumazo toda la clase de bugs de resolución de sucursal que sí afecta a las órdenes de WhatsApp (donde hay que preguntarle al cliente de qué sucursal quiere).

### 4.7 Aislamiento — RLS por negocio

El modelo v3 aísla por `business_id`, con RLS forzado y un GUC de negocio (`umi.current_business`), fail-closed. Las tablas de dinero, además, tienen triggers append-only.

**[PROPUESTA]** El módulo POS **debe correr bajo RLS con el principal del dispositivo.** El POS _tiene_ un principal (el aparato enrolado), así que no hay ninguna razón para que escriba por un camino que evada RLS. Esta es una de las decisiones de diseño más importantes del proyecto (ver **S-4**).

---

## 5. API y eventos **[CONFIRMADO]**

### 5.1 Superficie actual

~90 rutas en `umi-api` (NestJS + Fastify). Módulos: `auth`, `tenants`, `staff`, `hours`, `voice`, `customers`, `cash`, `kds`, `conversations`, `leads`, `health`.

**Hecho de bootstrap que importa:** **no hay guard global.** La autenticación es _opt-in por controlador_ vía `@UseGuards`. **Un endpoint nuevo sin guard queda abierto al mundo.** El módulo POS debe declarar sus guards explícitamente, siempre.

### 5.2 Lo que falta — **la lista de trabajo, con estado**

> **⚠️ Cómo leer esta tabla — importa mucho.**
> «No existe hoy» y «no va a existir nunca» son cosas **muy distintas**, y confundirlas lleva a decisiones caras (por ejemplo: construir telemetría propia en el POS creyendo que Umi nunca la va a tener, cuando ya está decidida). Por eso cada hueco lleva **estado explícito**:
>
> | Estado                          | Significa                                                                                                                                                    |
> | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | ✅ **DECIDIDO**                 | Ya está en el modelo o en la planeación de Umi. Falta implementarlo. **Es una dependencia, no una decisión.** No lo construyas por tu cuenta ni en paralelo. |
> | ⚠️ **DIFERIDO A PROPÓSITO**     | El modelo lo dejó fuera **con una regla explícita**, esperando un disparador. **El POS puede ser ese disparador** → hay que decidir.                         |
> | ❌ **NO ESTÁ EN LA PLANEACIÓN** | Hueco real. **El proyecto POS lo tiene que decidir y construir.**                                                                                            |

| #        | Qué falta                                                                                                                                                                                                                                                                                                                                                      | Estado                                                                                                                                                                                                                                                                                                                                | Nota                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H-1**  | **`POST /orders`** — ninguna ruta crea órdenes hoy                                                                                                                                                                                                                                                                                                             | ✅ **DECIDIDO** — el plan lo contempla como endpoint de escritura de producto                                                                                                                                                                                                                                                         | El trabajo #1 del POS.                                                                                                                                         |
| **H-2**  | **Escritor de `payment` / `refund`**                                                                                                                                                                                                                                                                                                                           | ✅ **DECIDIDO** — synthesis §5a: el POS es _"the first real payment writer"_                                                                                                                                                                                                                                                          | Las tablas existen esperándolo.                                                                                                                                |
| **H-3**  | **La proyección de tickets de cocina sobre el modelo v3**                                                                                                                                                                                                                                                                                                      | ✅ **DECIDIDO** — es un pendiente conocido del modelo                                                                                                                                                                                                                                                                                 | **Es lo que hace que la orden del POS aparezca en cocina.** Sostiene el argumento central de §1.3. Hay que autorizarla sobre `customer_order` + `order_event`. |
| **H-4**  | **`pos` en el catálogo de features** — el CHECK de `umi.feature.module` es `('cash','dashboard','conversaflow','kds')` (`build-v3/10_umi.sql:112-113`)                                                                                                                                                                                                         | ✅ **DECIDIDO** — synthesis §5a lo exige (_"`product_key` gains `pos`"_); falta aterrizarlo en el DDL                                                                                                                                                                                                                                 | **Sin esto UmiPOS no se puede contratar, activar ni facturar.** Barato. Hacerlo primero.                                                                       |
| **H-5**  | **`order_id` en `loyalty_visit` y en el ledger de dinero**, + `'pos'` en `loyalty_visit.source`                                                                                                                                                                                                                                                                | ✅ **DECIDIDO** — synthesis §5a nombra al POS como _"a loyalty actor (card scan at the register)"_, y el modelo ya tiene `loyalty_reward.type='spend_cashback'` esperando                                                                                                                                                             | El enganche venta ↔ lealtad. **La pieza de mayor valor del proyecto.**                                                                                         |
| **H-6**  | **Impuesto, propina, descuento, redondeo**                                                                                                                                                                                                                                                                                                                     | ❌ **NO ESTÁ EN LA PLANEACIÓN**                                                                                                                                                                                                                                                                                                       | Son **producto**, no ingeniería. Bloquean la aritmética de la venta. **Q-02**.                                                                                 |
| **H-7**  | **Caja: apertura, corte, arqueo**                                                                                                                                                                                                                                                                                                                              | ❌ **NO ESTÁ EN LA PLANEACIÓN**                                                                                                                                                                                                                                                                                                       | Modelo nuevo completo.                                                                                                                                         |
| **H-8**  | **`pos` en `PRODUCT_KEYS` de `@umi/contract`** — hoy es `['cash','conversaflow','kds','dashboard']`                                                                                                                                                                                                                                                            | ✅ **DECIDIDO** (mismo que H-4)                                                                                                                                                                                                                                                                                                       | Necesario para `@RequireProduct('pos')`.                                                                                                                       |
| **H-9**  | **Esquemas y rutas del POS en `@umi/contract`** (orden, pago, catálogo)                                                                                                                                                                                                                                                                                        | ✅ **DECIDIDO** — el contrato tipado es el mecanismo elegido de Umi                                                                                                                                                                                                                                                                   | El POS **extiende** el contrato. No inventa uno nuevo.                                                                                                         |
| **H-10** | **Expiración y rotación del token de dispositivo**                                                                                                                                                                                                                                                                                                             | ❌ **NO ESTÁ EN LA PLANEACIÓN**                                                                                                                                                                                                                                                                                                       | El token del KDS no expira. Un POS **no puede** heredar eso. **S-1**.                                                                                          |
| **H-11** | **Auditoría de dispositivo/venta** (quién cobró, en qué aparato, cuándo)                                                                                                                                                                                                                                                                                       | ⚠️ **DIFERIDO A PROPÓSITO** — `runtime.device_event` está **deliberadamente fuera** del modelo v3 (`30_runtime.sql:7`), por considerarse telemetría                                                                                                                                                                                   | **Hay que reabrir esa decisión para el POS** (**Q-10**). Ver la nota de abajo: no es un descuido, es una exclusión razonada que el POS invalida.               |
| **H-12** | **Impresión** (ticket, comanda, cajón) **y cola offline** en el cliente                                                                                                                                                                                                                                                                                        | ❌ **NO ESTÁ EN LA PLANEACIÓN**                                                                                                                                                                                                                                                                                                       | **Cero precedente.** Nadie en Umi ha impreso nunca nada, y ningún cliente persiste datos localmente. Ver §6.4.                                                 |
| **H-13** | **Integración con un procesador de pagos.** No hay Stripe, Conekta, MercadoPago, Clip ni OpenPay. La única integración de comercio (Zettle) es **sincronización de catálogo únicamente** — sin cobros, sin webhooks.                                                                                                                                           | ❌ **NO ESTÁ EN LA PLANEACIÓN** _(depende de **Q-01**)_                                                                                                                                                                                                                                                                               | Si la respuesta a Q-01 es «el POS procesa pagos», **es greenfield completo.**                                                                                  |
| **H-14** | **Versionado de API** (no hay prefijo global ni `/v1`)                                                                                                                                                                                                                                                                                                         | ❌ **NO ESTÁ EN LA PLANEACIÓN**                                                                                                                                                                                                                                                                                                       | Importa porque POS y KDS viven **en campo** y no se actualizan a voluntad. **R-07**.                                                                           |
| **H-15** | **Métricas y tracing.** Hoy el API solo emite logs JSON a stdout.                                                                                                                                                                                                                                                                                              | ✅ **DECIDIDO** — la telemetría **sale de Postgres y se va a OpenTelemetry** (Collector → **Tempo** trazas / **Prometheus** métricas / **Loki** logs). Está en el modelo (`2026-07-02-codd-enterprise-model.md:162-192`) y v3 ya **elimina el esquema `observability`** por esa razón (`99_verify.sql:31-32`). **Falta el cableado.** | **⚠️ NEXO: no construyan telemetría propia.** El destino ya está elegido; el POS emite señales OTel como todo lo demás. Ver §14.                               |
| **H-16** | **Entorno de pruebas no-productivo.** El backend despliega con `on: push: branches: [main]` (`.github/workflows/umi-api-deploy.yml:5-7`) — **un merge va directo al VPS de producción.** Los frontends sí reciben previews de Vercel por PR, **pero apuntan al API de producción**, así que **no existe un backend ni una base de datos fuera de producción.** | ❌ **NO ESTÁ EN LA PLANEACIÓN**                                                                                                                                                                                                                                                                                                       | **Un POS cobra dinero real y necesita ensayar el cobro sin moverlo.** **R-15**.                                                                                |
| **H-17** | **Rate limiting distribuido** — hoy es en memoria del proceso                                                                                                                                                                                                                                                                                                  | ❌ **NO ESTÁ EN LA PLANEACIÓN** _(reconocido en el código como pendiente)_                                                                                                                                                                                                                                                            | No sobrevive un reinicio ni escala horizontalmente. **S-8**. Redis ya está desplegado.                                                                         |

> ### La exclusión que el POS obliga a reabrir (**H-11**)
>
> El modelo v3 deja **fuera a propósito** la tabla de eventos de dispositivo, junto con trazas y spans (`30_runtime.sql:7`). La lógica es coherente: **eso es telemetría, y la telemetría se va a OTel** (H-15).
>
> **Pero para un POS, "quién cobró, en qué aparato, a qué hora, y qué se reintentó" no es telemetría: es un hecho de negocio, y probablemente legal.** No se puede resolver una disputa de caja consultando Tempo con retención de 7 días.
>
> **[DECISIÓN PENDIENTE — arquitecto]** El rastro de auditoría del POS es un **hecho del negocio del restaurante** (→ vive en `tenant.*`, con retención, consultable desde el dashboard), **no** una señal de observabilidad. Recomiendo tratarlo así y no reciclar la exclusión de `device_event` sin discutirla.

### 5.3 Eventos

Existe un **outbox transaccional** sólido (`runtime.outbox_event`, relay en el worker, claim con `SKIP LOCKED`, backoff, dead-letter) y colas BullMQ.

**[PROPUESTA]** El POS **no necesita webhooks salientes en la fase 1.** No hay a quién notificar: todos los consumidores (KDS, dashboard) leen la misma base. El outbox se usa más adelante si se quiere avisar al cliente por WhatsApp que su orden del POS está lista — y para eso **la ruta de notificación de estado ya existe y ya funciona.**

---

## 6. Autenticación y autorización

### 6.1 La postura

**Cobrar dinero requiere estar frente a un dispositivo que el dueño dio de alta y puede revocar.** Todo lo demás se deriva de ahí.

### 6.2 La pila de guards

```
AuthGuard          → credencial (cookie de usuario · o token de dispositivo)
  ↓
TenantAccessGuard  → membresía real en el negocio
  ↓
EntitlementGuard   → @RequireProduct('pos')   ← requiere cerrar H-4 y H-8
  ↓
RolesGuard         → @Roles(...)
```

**[PROPUESTA]** El POS reusa esta pila tal cual, agregando `@RequireProduct('pos')`.

### 6.3 El precedente de dispositivo enrolado — **la pieza que sostiene §0.2**

El flujo del KDS ya existe y está bien diseñado (modelado sobre RFC 8628 + NIST SP 800-63B):

```
1. El DUEÑO genera un PIN de 6 dígitos desde el dashboard
   → aleatorio sin sesgo, guardado como sha256(salt + ':' + pin), TTL 10 min
   → el PIN en claro se muestra UNA sola vez

2. El DISPOSITIVO captura el PIN            (límite antifuerza-bruta por IP)

3. El DUEÑO aprueba la solicitud en el dashboard

4. El DISPOSITIVO recibe su credencial
   → token de 256 bits · el servidor guarda SOLO sha256(token)
   → se devuelve UNA vez y nunca más
   → dos filas: tenant.device (registro duradero) + runtime.session (la credencial)

5. El DISPOSITIVO guarda el token en almacenamiento seguro del sistema operativo
   → lo presenta en cada request, en un header

6. REVOCACIÓN: el dueño pulsa "revocar"
   → la sesión se desactiva y el device se archiva
   → en el siguiente request el aparato recibe 403 y BORRA su credencial local
```

**Esto es exactamente lo que el POS necesita, y es exactamente lo que un POS web abierto no puede dar:** el dueño de la cafetería controla, desde su dashboard, **qué aparatos físicos pueden cobrar**, y puede matar cualquiera en un segundo.

**Qué reusar:** el flujo completo, el hash del token en reposo, la revocación perezosa con borrado de credencial en el cliente, y el modelo de dos filas (registro + sesión).

**Qué endurecer para el POS.** _(Estos son los requisitos de §13.1 que el KDS no cumple; la lista completa de S-1 a S-9 está allá.)_

| #       | Diferencia con el KDS                                              | Por qué el POS no puede heredarla                                                                           |
| ------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **S-1** | El token del KDS **no expira ni rota**.                            | Un POS robado con un token inmortal es una caja registradora robada. **Expiración + rotación.** (**H-10**)  |
| **S-3** | El alcance de sucursal del KDS está codificado en más de un lugar. | El POS debe tener **un solo predicado de alcance**, aplicado a **lectura y escritura**.                     |
| **S-4** | Las órdenes hoy se escriben por un camino que evade RLS.           | El POS **sí** tiene principal. **Debe correr bajo RLS.**                                                    |
| **S-5** | No hay auditoría de dispositivo.                                   | Un POS **necesita** rastro: quién cobró, en qué aparato, cuándo. Requisito de negocio. (**H-11**, **Q-10**) |
| **S-7** | No hay PIN de empleado.                                            | Hay que saber **quién** cobró. El dispositivo autoriza; el PIN identifica.                                  |

### 6.4 El cliente — lo que un POS necesita y un KDS no

| Capacidad              | KDS hoy                                            | POS                                                         |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Persistencia local     | **Ninguna.** Lo único que guarda es su credencial. | **Cola de escritura obligatoria.**                          |
| Comportamiento sin red | Pantalla vacía. Aceptable.                         | **Inaceptable.** Un POS sin red **tiene que poder cobrar**. |
| Impresión              | No existe.                                         | Ticket, comanda, cajón. **Cero precedente.**                |
| Fallos de mutación     | Se revierten en silencio.                          | **Un POS que pierde una venta en silencio es inaceptable.** |

---

## 7. Reglas de negocio

| Dominio                    | Regla del modelo                                                | Nota para el POS                                       |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| **Dinero**                 | **Todo en `bigint` centavos.** Nunca float.                     | El POS suma centavos por línea; no redondea el total.  |
| **Ledgers**                | **Append-only, con trigger.** `balance = SUM(delta)`.           | Una devolución es un delta negativo, **no** un UPDATE. |
| **Cachés**                 | **"Derive, don't cache."** `loyalty_card` es identidad pura.    | El POS **no escribe totales**.                         |
| **Ciclo de vida de orden** | Se **agrega un evento**; no se muta un estado.                  | Orden + evento de apertura, **misma transacción**.     |
| **Idempotencia**           | Llave única por negocio en las escrituras de dinero y de orden. | **Es la base de la cola offline.** Ver 12.2.           |
| **Sellos**                 | +1 por escaneo, máximo uno al día. Recompensa a los N.          | El POS agrega `order_id` al sello (**H-5**).           |
| **Aislamiento**            | RLS por `business_id`, fail-closed.                             | El POS corre **bajo** RLS (**S-4**).                   |

**[HUECO H-6]** Las reglas que el POS necesita y **el modelo no tiene**: impuesto, propina, descuento, redondeo, apertura/cierre de caja, arqueo, anulación (void) vs. devolución (refund), y política de precio (¿el precio se congela al agregar la línea o al cobrar?). **Ninguna existe. Son producto, no ingeniería.** Ver **Q-02**.

---

## 8. Matriz de propiedad de datos **[PROPUESTA]**

Con una sola base, esta matriz **no describe una frontera entre dos sistemas** — describe **qué módulo puede escribir qué**. Es disciplina interna, y es mucho más fácil de sostener que un contrato entre compañías.

| Entidad                              | Autor                                                    | Lectores                    |
| ------------------------------------ | -------------------------------------------------------- | --------------------------- |
| `tenant.business`, `branch`          | Dashboard (dueño)                                        | todos                       |
| `tenant.product` (catálogo)          | Dashboard · **POS** · sync externa — según `menu_source` | POS, bot                    |
| `tenant.contact` / `customer`        | **El resolvedor de identidad — única puerta**            | todos                       |
| **`tenant.customer_order`** ⭐       | **POS** · bot de WhatsApp                                | KDS, dashboard, analítica   |
| `tenant.order_item`                  | mismo autor que la orden (misma transacción)             | KDS, dashboard              |
| `tenant.order_event`                 | POS, KDS, bot                                            | KDS (proyección), dashboard |
| **`tenant.payment` / `refund`** ⭐   | **POS** (primer escritor)                                | dashboard, analítica        |
| `tenant.loyalty_stored_value_ledger` | módulo `cash` del API                                    | dashboard                   |
| `tenant.loyalty_visit`               | módulo `cash` (escaneo) · **+ POS** (con `order_id`)     | dashboard                   |
| `tenant.device` / `runtime.session`  | Dashboard (el dueño aprueba)                             | —                           |

**La regla que hace que todo funcione: un dato tiene exactamente un autor.** El día que dos módulos escriban el estado de una orden por caminos distintos, volvemos al problema que §0.1 evitaba — solo que ahora dentro de la misma base.

---

## 9. Mapeo con NEXO

_(Los estados son los mismos de §5.2: **YA EXISTE** · ✅ **DECIDIDO** (falta implementarlo) · ⚠️ **DIFERIDO a propósito** · ❌ **NO ESTÁ EN LA PLANEACIÓN**.)_

| Módulo NEXO                        | Estado en Umi                                                                                 | Veredicto                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Organizaciones / cafeterías        | **YA EXISTE** — `tenant.business`                                                             | **Se disuelve.** Ya es multi-tenant con RLS.                               |
| Sucursales                         | **YA EXISTE** — `tenant.branch`                                                               | **Se disuelve.**                                                           |
| Productos y variantes              | **YA EXISTE** — `product` + `option_group` + `modifier` + disponibilidad por sucursal         | **Se conserva.** El catálogo ya está modelado.                             |
| Clientes                           | **YA EXISTE** — `contact` + `customer` + grafo de identidad                                   | **Se disuelve.** No traer un modelo propio de clientes.                    |
| Wallet                             | **YA EXISTE**, pero **no es lo que el brief cree**                                            | Ver §3.                                                                    |
| **Ventas**                         | ✅ **DECIDIDO** — `customer_order` existe y `source='pos'` **espera escritor**                | **El corazón del proyecto.**                                               |
| **Punto de venta**                 | ✅ **DECIDIDO** — el modelo asienta al POS (§0.4)                                             | **Construir.** `modules/pos/` + cliente Flutter.                           |
| Reportes de venta                  | ✅ **DECIDIDO** — trivial una vez que existan las ventas                                      | **Extender** el dashboard.                                                 |
| **Inventario**                     | ⚠️ **DIFERIDO a propósito** (§4.4) — el modelo espera un escritor real, y el POS podría serlo | **Decisión de alcance (Q-03).** Recomendado: fuera de fase 1.              |
| **Caja** (apertura, corte, arqueo) | ❌ **NO ESTÁ EN LA PLANEACIÓN**                                                               | **Construir desde cero.**                                                  |
| **Agenda**                         | ❌ **NO ESTÁ EN LA PLANEACIÓN**                                                               | **[Q-04]** Parece venir de otro modelo de negocio. **Recomiendo sacarlo.** |

**De los 10 módulos que NEXO planea: 4 ya existen y no deben reconstruirse · 3 hay que construirlos (POS, caja, reportes de venta) · 1 es el corazón (ventas) · 1 debería salir del alcance (agenda) · 1 es decisión de alcance (inventario).**

Este es, por sí solo, el argumento más fuerte contra la arquitectura de dos sistemas: **NEXO estaría reconstruyendo negocios, sucursales, clientes y catálogo que ya existen, ya tienen RLS y ya tienen resolución de identidad — para después sincronizarlos.**

---

## 10. Arquitecturas comparadas

### Opción A — Dos plataformas que se sincronizan (lo que asume el brief)

|               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A favor**   | Despliegue independiente. NEXO podría venderse sin Umi.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **En contra** | **Dos fuentes de verdad por cada entidad compartida.** Hay que construir y mantener: sync de catálogo, replicación de ventas, reconciliación del wallet, deduplicación, entrega fuera de orden, reintentos, versionado entre equipos. **Cada uno de los diez riesgos que el brief pide analizar (duplicación de ventas, divergencia del wallet, diferencias de producto, conflictos de sucursal, pérdida de eventos, entrega fuera de orden…) existe _únicamente_ en esta opción.** |
| **Y lo peor** | **El KDS no se entera.** La orden del POS no llega a cocina hasta que la replicación la traiga. El dashboard muestra números distintos según a quién le preguntes. La cafetería lo nota el primer día.                                                                                                                                                                                                                                                                              |
| **Además**    | Contradice el principio fundacional de Umi: _"a single backend owns all data; everything else is a thin client."_                                                                                                                                                                                                                                                                                                                                                                   |
| **Veredicto** | ❌ **Rechazada.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Opción B — UmiPOS como módulo del API de Umi **[RECOMENDADA]**

|               |                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A favor**   | **Una fuente de verdad.** Cero sync, cero reconciliación, cero deduplicación. **Los diez riesgos de integración del brief simplemente no existen.** Una orden del POS aparece en el KDS y el dashboard **sin código de integración**. Reusa RLS, entitlements, identidad, sucursales, horarios y el modelo de dispositivo enrolado. Un despliegue, un esquema. |
| **En contra** | Repositorio y ciclo de release compartidos. UmiPOS no se vende aislado (**[Q-09]** — si la respuesta es "no queremos venderlo aislado", esto no es un costo).                                                                                                                                                                                                  |
| **Veredicto** | ✅ **Recomendada.** Es, además, **la que el modelo ya asume** (§0.4).                                                                                                                                                                                                                                                                                          |

### Opción C — POS con base local

|               |                                                            |
| ------------- | ---------------------------------------------------------- |
| **Veredicto** | ✅ **No es alternativa a B: es un requisito DENTRO de B.** |

> ### La distinción que hay que tener clarísima
>
> **Una cola offline en el dispositivo NO es "el POS tiene su propia base de datos".**
>
> Una **cola** guarda _intenciones aún no confirmadas_ y las reproduce con una llave de idempotencia. Nunca responde preguntas, nunca la consulta otro sistema, nunca es la verdad de nada. **Se vacía.**
>
> Una **segunda base** _es_ autoridad, _es_ consultada, **diverge**, y hay que reconciliarla para siempre.
>
> **La primera es Opción B. La segunda es Opción A.** Es la diferencia entre el éxito y dos años de reconciliación.

---

## 11. Arquitectura recomendada **[PROPUESTA]**

```
apps/umi-api/src/modules/pos/          ← NUEVO módulo (NO un servicio nuevo, NO un esquema nuevo)
├── pos.controller.ts                  ← rutas de dispositivo (crear orden, cobrar)
├── pos-dashboard.controller.ts        ← rutas de dueño (corte de caja, reportes)
├── pos.service.ts                     ← reglas: impuesto, propina, descuento, redondeo
├── pos.repository.ts                  ← SQL; REUSA los repositorios de orden y de cocina
└── dto/pos-contract.ts                ← contrato congelado

apps/umi-pos/                          ← NUEVO cliente Flutter (Android whitelabel)
apps/umi-kds/                          ← MIGRA a Flutter, comparte la base con el POS
packages/device-client/                ← Dart compartido: pairing, token, cola offline
packages/contract/                     ← se EXTIENDE con rutas y esquemas del POS
```

**Principios, en orden de importancia:**

1. **Una sola fuente de verdad.** El POS escribe en `tenant.customer_order`, la base de Umi. **No se levanta una segunda base de datos** (la cola offline del dispositivo _no_ es una base — ver §10, Opción C).
2. **El POS es un dispositivo, no un usuario.** Se da de alta, se aprueba, se revoca.
3. **Una escritura, todos los consumidores.** Orden + `order_event` en la misma transacción → el KDS y el dashboard la ven sin código adicional.
4. **Idempotencia desde el primer commit, no como parche.** La cola offline depende de esto.
5. **Un solo predicado de alcance** (negocio + sucursal), en lectura **y** escritura.
6. **El POS corre bajo RLS.** Tiene principal; no hay excusa.
7. **El cliente Flutter se comparte entre POS y KDS.**
8. **Nada de webhooks, sync ni reconciliación.** Si alguien propone construir cualquiera de esas tres, es señal de que se coló la Opción A.
9. **Derive, don't cache.** El POS no escribe totales ni saldos; los ledgers son append-only.

### Esfuerzo aproximado por componente

Sin fechas — no hay evidencia para estimarlas. Tallas relativas, excluyendo lo que ya existe:

| Componente                                                                     | Talla                                  |
| ------------------------------------------------------------------------------ | -------------------------------------- |
| `pos` en el catálogo de productos + entitlement (**H-4**, **H-8**)             | **XS**                                 |
| Pairing de dispositivo POS (reusa el del KDS; el costo es endurecerlo)         | **S**                                  |
| Proyección de tickets de cocina sobre el modelo v3 (**H-3**)                   | **S**                                  |
| `POST /orders` (**H-1**)                                                       | **M**                                  |
| Contrato del POS en `@umi/contract` (**H-9**)                                  | **M**                                  |
| Pago / tender (**H-2**) — _depende de Q-01_                                    | **L**                                  |
| Impuesto / propina / descuento / redondeo (**H-6**) — _bloqueado por producto_ | **M**                                  |
| Caja: apertura, corte, arqueo (**H-7**)                                        | **L**                                  |
| **Enganche venta ↔ lealtad (H-5)** — _el de mayor valor_                       | **M**                                  |
| Cliente Flutter POS                                                            | **XL**                                 |
| Cola offline + replay idempotente                                              | **L**                                  |
| Impresión                                                                      | **L**                                  |
| Migración del KDS a Flutter                                                    | **L**                                  |
| Reportes de venta en el dashboard                                              | **M**                                  |
| Inventario                                                                     | **XL** — _recomendado fuera de fase 1_ |

---

## 12. Contratos propuestos **[PROPUESTA — no implementados]**

> Conforme a las restricciones del encargo: **esto es diseño, no código.** No se creó ningún endpoint.

### 12.1 Crear una venta

```
POST /api/pos/orders
Header: x-umi-device-token: <token del dispositivo enrolado>
Header: x-umi-staff-pin:    <PIN del empleado que cobra>   ← quién cobró (auditoría)

{
  "client_transaction_id": "pos:<device_id>:<ulid>",   ← ⭐ LLAVE DE IDEMPOTENCIA
  "items": [
    { "product_id": "uuid", "option": "Grande", "quantity": 2,
      "unit_price_cents": 4500, "notes": "sin azúcar" }
  ],
  "customer": { "qr_payload": "..." } | { "phone": "+52..." } | null,
  "totals":   { "subtotal_cents": 9000, "tax_cents": 0, "tip_cents": 0,
                "discount_cents": 0, "total_cents": 9000 },
  "payments": [ { "method": "cash|card|stored_value|gift_card",
                  "amount_cents": 9000 } ],
  "placed_at": "2026-07-14T18:22:01Z"     ← hora del DISPOSITIVO (importa offline)
}

→ 201 { "order_id": "...", "folio": 1234,
        "loyalty": { "stamp_earned": true, "balance_cents": 15050 } }
→ 200 (mismo cuerpo) si el client_transaction_id ya existía  ← REPLAY, no error
```

**Notas de diseño que importan:**

- **`client_transaction_id`** se apoya en la llave única de idempotencia que el modelo ya define para las órdenes. **Un reintento devuelve 200 con la misma orden, no un error y no una orden duplicada.** Esto resuelve **por diseño** el riesgo «duplicación de ventas» que el brief pide analizar.
- **`branch_id` NO va en el body.** Viene del dispositivo. **Un POS no puede cobrar en una sucursal donde no está.**
- **La orden y su `order_event` de apertura se escriben en la misma transacción**, o la orden es invisible (§4.1).
- **`placed_at` es la hora del dispositivo** (para ventas encoladas offline); la hora del servidor se guarda aparte. Las dos se conservan.
- **El PIN del empleado es para auditoría, no para autorización.** El dispositivo autoriza; el PIN identifica.
- **Los montos van en centavos enteros.** Sin excepción.

### 12.2 Reproducción offline

```
El POS pierde red
  → guarda la venta en su cola local con su client_transaction_id YA asignado
  → sigue cobrando (efectivo sí; tarjeta depende de Q-01)
  → al volver la red, reproduce la cola EN ORDEN
  → cada POST devuelve 201 (nueva) o 200 (ya existía) — las dos son ÉXITO
  → la venta se borra de la cola SOLO tras un 2xx
```

**Esto funciona porque el servidor es idempotente por diseño.** No hace falta un protocolo nuevo. El caso delicado es el **timeout**: el POS no sabe si el servidor recibió la venta. Con `client_transaction_id`, **reintentar es seguro por construcción.** Sin él, es duplicación de ventas garantizada.

### 12.3 Enganche con lealtad — **lo que hace que todo esto valga la pena**

```
POST /api/pos/orders  con  customer.qr_payload
   ↓ dentro de la MISMA transacción:
   1. INSERT tenant.customer_order              (la venta, source='pos')
   2. INSERT tenant.order_item
   3. INSERT tenant.order_event                 (para que aparezca en cocina)
   4. INSERT tenant.payment                     ⭐ primer escritor de pago
   5. INSERT tenant.loyalty_visit               ⭐ CON order_id  ← hoy imposible
   6. INSERT tenant.loyalty_stored_value_ledger ⭐ CON order_id  ← si pagó con saldo
```

**Los pasos 4, 5 y 6 son la razón de ser del proyecto.** Requieren cerrar **H-5**: agregar `order_id` a `loyalty_visit` y al ledger de dinero, y `'pos'` al CHECK de `loyalty_visit.source`. **Dos columnas y un valor de enum** — y a cambio, Umi deja de estar ciega.

Con eso desbloqueado, la recompensa por gasto (`loyalty_reward.type='spend_cashback'`, **que el modelo ya tiene**) pasa de imposible a trivial.

### 12.4 Otras rutas

| Ruta                                            | Propósito                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/pos/catalog`                          | Menú de la sucursal del dispositivo. **Cacheable en el aparato** — el POS debe poder vender sin red. |
| `POST /api/pos/orders/:id/void`                 | Anular antes del cierre (≠ devolución).                                                              |
| `POST /api/pos/orders/:id/refund`               | Devolución después del cierre → `tenant.refund`.                                                     |
| `POST /api/pos/shifts/open` · `/close`          | Apertura y corte de caja (**H-7**).                                                                  |
| `GET /api/tenants/:id/pos/reports/z`            | Corte Z para el dueño (dashboard, sesión de usuario).                                                |
| `POST /api/tenants/:id/pos/devices/pairing-pin` | **Reusa el flujo del KDS**, con `kind='pos_terminal'`.                                               |

---

## 13. Seguridad y privacidad

### 13.1 Requisitos del POS (más estrictos que los del KDS)

| #       | Requisito                                                                  | Acción                                                       |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **S-1** | Token de dispositivo con **expiración y rotación**                         | Construir.                                                   |
| **S-2** | **Revocación** desde el dashboard                                          | ✅ Ya existe. Reusar.                                        |
| **S-3** | **Un solo predicado de alcance** (negocio + sucursal), lectura y escritura | Construir bien desde el día uno.                             |
| **S-4** | El POS corre **bajo RLS**                                                  | Construir. El POS tiene principal.                           |
| **S-5** | **Auditoría**: quién cobró, en qué aparato, cuándo                         | Construir. Requisito de negocio.                             |
| **S-6** | **Idempotencia** en toda escritura de dinero                               | Obligatorio antes de que el POS cobre.                       |
| **S-7** | **PIN de empleado** para atribuir la venta                                 | Construir.                                                   |
| **S-8** | Rate limiting distribuido                                                  | Migrar el limitador a Redis (ya desplegado).                 |
| **S-9** | **Sin credenciales portátiles**                                            | ✅ Ya es así. **Mantenerlo: no crear API keys para el POS.** |

### 13.2 Privacidad

El POS va a capturar, por primera vez, **el historial de compra de personas identificadas.** Es un salto material en sensibilidad de datos.

- **[DECISIÓN PENDIENTE Q-06 — legal]** ¿Aviso de privacidad actualizado? En México aplica la LFPDPPP. **Un historial de compra ligado a un teléfono es dato personal.**
- **[PROPUESTA]** La lealtad debe ser **opt-in explícito** en el POS. El cajero **no debe poder ligar una venta a un cliente** sin que el cliente presente su QR o dé su teléfono.
- El modelo ya sella columnas sensibles a nivel de RLS (credenciales, tokens). **Ese patrón debe extenderse a lo que capture el POS.**

---

## 14. Observabilidad

### 14.1 El destino ya está decidido — **[CONFIRMADO]**

**⚠️ Esta sección existe para evitar una decisión cara: que el POS construya su propia telemetría en paralelo.**

**La telemetría de Umi sale de Postgres y se va a OpenTelemetry.** No es una idea suelta: está en el modelo (`2026-07-02-codd-enterprise-model.md:162-192`, _"Telemetry — LEAVES the database entirely → OpenTelemetry"_), la arquitectura aceptada lo incorpora (synthesis §7), y el modelo v3 **ya eliminó el esquema `observability`** precisamente por eso (`build-v3/99_verify.sql:31-32`).

```
   umi-api ──▶ OTel SDK ──▶ Collector ──┬──▶ Tempo       (trazas)
                                        ├──▶ Prometheus  (métricas)
                                        └──▶ Loki        (logs)
```

| Capacidad | Hoy                                                | Destino                |
| --------- | -------------------------------------------------- | ---------------------- |
| Logging   | Logs JSON a `stdout`, con `requestId` por petición | → Loki, vía OTel       |
| Métricas  | —                                                  | → Prometheus, vía OTel |
| Trazas    | —                                                  | → Tempo, vía OTel      |
| Health    | `GET /health` (base + Redis)                       | sin cambios            |

**Lo que falta es el cableado del SDK (H-15), no la decisión.** **El POS emite señales OTel como todo lo demás. No construye nada aparte.**

### 14.2 Lo que el POS agrega **[PROPUESTA]**

Un POS no se puede operar a ciegas. Cuando una cafetería llame diciendo «se me perdió una venta», tiene que haber forma de responder.

**Y ojo con la frontera (ver H-11):** las señales de abajo son **telemetría** y van a OTel. **El rastro de auditoría de la venta —quién cobró, en qué aparato, a qué hora— NO es telemetría: es un hecho de negocio y vive en la base**, con retención y consultable desde el dashboard. No se resuelve una disputa de caja consultando trazas con retención de días.

**Mínimo no negociable antes del piloto:**

1. **Métricas de negocio**, no de infraestructura: ventas por minuto · tasa de fallo de `POST /orders` · **profundidad de la cola offline por dispositivo** · latencia p95 del cobro · **tasa de replay idempotente** (si sube, algo anda mal con la red del local).
2. **Rastro de auditoría por venta**: dispositivo, empleado, hora del dispositivo, hora del servidor, reintentos.
3. **Alerta sobre la cola offline**: un dispositivo con la cola creciendo es un local que está vendiendo a ciegas.

---

## 15. Plan de pruebas

### 15.1 Lo que hay hoy **[CONFIRMADO]**

El API tiene una suite amplia de pruebas unitarias (44 archivos, **mockeadas, sin base de datos**) que corre en cada PR, más gates de contrato y de tokens de diseño.

**Lo que no existe** (los tres ❌ **FALTANTE**):

- **Un entorno no-productivo** (**H-16**). El backend despliega con `on: push: branches: [main]` — **un merge va directo al VPS de producción**. Los frontends tienen previews de Vercel, pero **apuntan al API de producción**: no hay un backend ni una base de datos fuera de prod.
- **Suite E2E.**
- **Gate de cobertura.**

**Para un producto que cobra dinero, eso no alcanza** (**R-15**). Y hay una razón técnica, no solo de prudencia: **los tres riesgos que de verdad importan —idempotencia, aislamiento entre negocios, y alcance de sucursal— solo se pueden probar contra una base de datos real.** Un test mockeado los daría por buenos sin haberlos verificado nunca. El POS necesita un backend y una base donde ensayar un cobro **sin mover dinero real**.

### 15.2 Lo que el POS necesita **[PROPUESTA]**

| Nivel                   | Qué probar                                                                                              | Por qué                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Unitario**            | Aritmética de dinero (impuesto, propina, descuento, redondeo) en **centavos enteros**, nunca float      | Un centavo de deriva × miles de ventas = una discrepancia de caja. |
| **Idempotencia**        | Reproducir el mismo `client_transaction_id` N veces → **exactamente una orden**                         | Es la defensa principal contra duplicación de ventas.              |
| **Concurrencia**        | Dos POS de la misma sucursal cobrando a la vez; dos cobros de saldo concurrentes sobre la misma tarjeta | Evita saldos negativos y sellos dobles.                            |
| **Offline**             | Cortar la red, cobrar 20 ventas, restaurar la red → **20 órdenes, ni una más, ni una menos**            | El escenario más probable en una cafetería real.                   |
| **Aislamiento**         | Un token de dispositivo del negocio A **no puede** escribir en el negocio B                             | Debe fallar en la base (RLS), no solo en el código.                |
| **Alcance de sucursal** | Un POS de la sucursal 1 no ve ni toca órdenes de la sucursal 2                                          | —                                                                  |
| **Integración**         | **Orden del POS → aparece en el KDS sin código de integración**                                         | **Es la prueba que valida la arquitectura entera.**                |
| **Revocación**          | Revocar el dispositivo → el POS deja de cobrar y borra su credencial                                    | Es la promesa de seguridad al dueño.                               |

---

## 16. Registro de riesgos

Severidad = probabilidad × impacto. **Fase**: 0 = antes de programar · 1 = fase 1 · 2 = posterior.

| ID       | Riesgo                                                                                                                                                      | Prob.                   | Impacto     | Sev.        | Mitigación                                                                                                                                                               | Dueño               | Fase  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ----- |
| **R-01** | **Duplicación de ventas** por reintento de red o doble tap.                                                                                                 | Alta                    | **Crítico** | 🔴          | `client_transaction_id` obligatorio + llave única de idempotencia. Un reintento devuelve 200, no crea nada.                                                              | Backend             | 1     |
| **R-02** | **Escritura de dinero no idempotente** → un POS que reintenta **cobra dos veces**.                                                                          | Alta                    | **Crítico** | 🔴          | Llave de idempotencia provista por el cliente en toda escritura de dinero, **antes** de que el POS toque saldo.                                                          | Backend             | **0** |
| **R-03** | **Pérdida de ventas offline**: el POS cobra sin red y la venta nunca llega.                                                                                 | Alta                    | Alto        | 🟠          | Cola local persistente + replay idempotente + **alerta de profundidad de cola**. Nunca borrar de la cola sin 2xx.                                                        | Cliente             | 1     |
| **R-04** | **Fuga entre negocios** si el POS escribe por un camino que evade RLS.                                                                                      | Media                   | **Crítico** | 🔴          | El módulo POS corre **bajo RLS** con el principal del dispositivo (**S-4**). Prueba de aislamiento en CI.                                                                | Backend + seguridad | **0** |
| **R-05** | **Dispositivo robado** con token sin expiración.                                                                                                            | Media                   | Alto        | 🟠          | Expiración + rotación (**S-1**). Revocación desde el dashboard (ya existe).                                                                                              | Backend + cliente   | 1     |
| **R-06** | **Conflicto de sucursal**: un dispositivo ve o toca órdenes de otra sucursal.                                                                               | Media                   | Alto        | 🟠          | **Un solo predicado de alcance** (**S-3**), en lectura y escritura.                                                                                                      | Backend             | 1     |
| **R-07** | **Sin versionado de API.** Un cambio incompatible rompe POS y KDS **en campo**, que no se actualizan a voluntad.                                            | Media                   | Alto        | 🟠          | Congelar el contrato del POS, versionarlo, **nunca romper un cliente desplegado**.                                                                                       | Backend             | 1     |
| **R-08** | **La orden del POS no llega a cocina** porque falta la proyección de tickets sobre el modelo v3 (**H-3**), o porque se olvidó el `order_event` de apertura. | **Alta**                | Alto        | 🟠          | Cerrar **H-3** temprano. Test de integración obligatorio: POS → KDS.                                                                                                     | Backend             | **0** |
| **R-09** | **UmiPOS no se puede contratar ni facturar** porque `pos` no está en el catálogo de productos (**H-4**, **H-8**).                                           | **Alta**                | Medio       | 🟡          | Cerrar H-4 + H-8. Es barato y hay que hacerlo primero.                                                                                                                   | Backend             | **0** |
| **R-10** | **Alcance descontrolado**: inventario + agenda + POS-web arrastran el proyecto meses.                                                                       | **Alta**                | Alto        | 🟠          | **Fase 1 = vender y cobrar.** Inventario y agenda fuera. **POS web abierto: rechazado por diseño.**                                                                      | Producto + dueño    | **0** |
| **R-11** | **Reglas de negocio inexistentes** (impuesto, propina, descuento, redondeo) bloquean la aritmética de la venta.                                             | Alta                    | Alto        | 🟠          | Producto las define **antes** de programar el cálculo (**Q-02**).                                                                                                        | Producto            | **0** |
| **R-12** | **Divergencia del wallet** — el riesgo estrella del brief de NEXO.                                                                                          | **Baja** (con Opción B) | Alto        | 🟢 **Bajo** | **Desaparece por construcción con una sola base.** Con la Opción A sería 🔴 crítico.                                                                                     | —                   | —     |
| **R-13** | **Pérdida de eventos / entrega fuera de orden** — otro riesgo estrella del brief.                                                                           | **Baja** (con Opción B) | Medio       | 🟢 **Bajo** | **No existe sin sincronización.** El KDS lee la misma base.                                                                                                              | —                   | —     |
| **R-14** | **Diferencias de producto / conflictos de sucursal entre sistemas** — del brief.                                                                            | **Nula** (con Opción B) | —           | 🟢 **Nulo** | Un solo catálogo, un solo árbol de sucursales.                                                                                                                           | —                   | —     |
| **R-15** | **No hay backend ni base fuera de producción** (**H-16**) — y el POS cobra dinero real.                                                                     | Alta                    | Alto        | 🟠          | Levantar un entorno no-productivo **antes** del piloto. Las pruebas de idempotencia/aislamiento/alcance **solo se pueden verificar contra una base real**, no mockeadas. | DevOps              | **0** |
| **R-16** | **Operar a ciegas**: el cableado de telemetría (**H-15**) todavía no existe, así que una venta perdida es indemostrable.                                    | Alta                    | Alto        | 🟠          | Métricas de negocio + auditoría por venta antes del piloto (§14.2). **El destino ya está decidido (OTel); falta conectarlo.**                                            | Backend + DevOps    | **0** |
| **R-17** | **Rastro de auditoría tratado como telemetría** (**H-11**): si el "quién cobró" se va a OTel con retención corta, una disputa de caja es irresoluble.       | Media                   | Alto        | 🟠          | Decidir que la auditoría de venta es un **hecho de negocio** y vive en `tenant.*` (**Q-10**).                                                                            | Arquitecto          | **0** |

> **Obsérvense R-12, R-13 y R-14.** Tres de los riesgos que el brief de NEXO pide analizar en profundidad **valen 🟢 bajo o nulo con la arquitectura recomendada, y 🔴 crítico con la que el brief asume.** Esa es exactamente la diferencia entre las dos opciones, medida en riesgo.

---

## 17. Preguntas abiertas

| ID       | Pregunta                                                                                                                                                                                                                                                  | Categoría            | Quién responde          | Bloquea                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------- | ---------------------------------------------------------- |
| **Q-01** | **¿UmiPOS _procesa_ pagos (terminal/adquirente) o solo _registra_ el medio de pago cobrado aparte?** Dos productos, dos ámbitos regulatorios, dos esfuerzos. **La más importante del proyecto.**                                                          | **Negocio + legal**  | **Dueño**               | Todo el diseño de pagos (**H-2**, **H-13**).               |
| **Q-02** | **¿Reglas de impuesto, propina, descuento y redondeo?** **Ninguna existe.** Es producto, no ingeniería.                                                                                                                                                   | **Producto**         | Producto + contabilidad | La aritmética de la venta (**H-6**, **R-11**).             |
| **Q-03** | **¿Inventario en fase 1?** El modelo lo dejó fuera **a propósito**, esperando un escritor real — y el POS podría serlo. **Recomendado: no.**                                                                                                              | Producto             | **Dueño**               | Alcance (**R-10**).                                        |
| **Q-04** | **¿"Agenda" aplica a una cafetería?** Parece venir de otro modelo de negocio. **Recomiendo sacarlo.**                                                                                                                                                     | Producto             | Producto                | Alcance (**R-10**).                                        |
| **Q-05** | **¿Cuál es el `menu_source` por tenant** — quién gana cuando el dashboard y el POS discrepan sobre el catálogo? _(Que el POS pueda autorizar menú ya está en el modelo; lo que falta es la dirección de conflicto.)_                                      | Producto             | Producto + dueño        | Autoría de catálogo (§4.3).                                |
| **Q-06** | ¿Aviso de privacidad (LFPDPPP) para historial de compra ligado a persona identificada?                                                                                                                                                                    | **Legal**            | Dueño + legal           | Piloto (§13.2).                                            |
| **Q-07** | ¿Qué hardware exactamente? (terminal Android whitelabel: ¿cuál? ¿impresora integrada? ¿cajón? ¿lector?)                                                                                                                                                   | Infraestructura      | **Dueño**               | Cliente Flutter, impresión (**H-12**).                     |
| **Q-08** | ¿El KDS migra a Flutter **antes** del POS (para que el POS herede la base compartida) o en paralelo?                                                                                                                                                      | Arquitectura         | Arquitecto              | Secuencia (§0.3).                                          |
| **Q-09** | ¿UmiPOS se venderá alguna vez **sin** Umi? Si no, la Opción B no tiene costo alguno.                                                                                                                                                                      | **Negocio**          | **Dueño**               | Nada, pero cambia el análisis si la respuesta es sí (§10). |
| **Q-10** | **¿El rastro de auditoría de la venta es un hecho de negocio (→ vive en `tenant.*`) o telemetría (→ se va a OTel)?** El modelo excluyó `device_event` por considerarlo telemetría; **para un POS eso no se sostiene.** **Recomendado: hecho de negocio.** | Arquitectura + legal | Arquitecto              | Auditoría (**H-11**, **R-17**).                            |

---

## 18. Próximos pasos y orden de implementación **[PROPUESTA]**

### Fase 0 — Antes de escribir el módulo POS

1. **[R-10 / Q-03 / Q-04]** Congelar el alcance de la fase 1: **vender y cobrar.** Inventario y agenda fuera. **POS web abierto: rechazado por diseño.**
2. **[Q-01 / Q-02]** Producto y dueño definen: ¿procesamos pagos? ¿reglas de impuesto, propina, descuento, redondeo?
3. **[H-4 / H-8 / R-09]** Dar de alta `pos` en el catálogo de productos y en `@umi/contract`. **Es barato y sin esto UmiPOS no se puede contratar.**
4. **[H-3 / R-08]** Cerrar la proyección de tickets de cocina sobre el modelo v3. **Es lo que sostiene el argumento central de toda la arquitectura.**
5. **[R-02]** Idempotencia con llave del cliente en toda escritura de dinero.
6. **[R-04]** Definir el camino de escritura del POS **bajo RLS**, con el principal del dispositivo.
7. **[R-15 / H-16]** Levantar un **entorno no-productivo** (backend + base). Un POS cobra dinero real; **no se ensaya en producción.**
8. **[R-16 / H-15]** Conectar el cableado de telemetría (**el destino ya está decidido: OTel**) + definir la auditoría por venta.
9. **[R-17 / Q-10]** Decidir que el rastro de auditoría de la venta es un **hecho de negocio**, no telemetría.

### Fase 1 — El esqueleto que prueba la arquitectura

10. Pairing de dispositivo POS (`kind='pos_terminal'`), reusando el flujo del KDS y **endureciéndolo** (expiración + rotación).
11. **`POST /api/pos/orders`** — orden + líneas + `order_event`, idempotente, bajo RLS, con alcance de sucursal por dispositivo.
12. Contrato del POS en `@umi/contract`.
13. **La prueba que valida todo:** una orden creada por el POS **aparece en el KDS sin una sola línea de código de integración.** Si esto funciona, la arquitectura es correcta y todo lo demás es trabajo. Si hace falta escribir código de sincronización, algo se diseñó mal.

### Fase 2 — Que sea un POS de verdad

14. Cliente Flutter + cola offline + replay idempotente.
15. Pagos / tender → **primer escritor de `tenant.payment`**.
16. Impresión (ticket, comanda, cajón).
17. Caja: apertura, corte, arqueo.
18. Migrar el KDS a Flutter sobre la base compartida.

### Fase 3 — Lo que hace que Umi valga más que la suma de sus partes

19. **Enganche venta ↔ lealtad (H-5)**: `order_id` en el sello y en el ledger de dinero.
20. **Recompensas por gasto** (`spend_cashback`) — el modelo ya las tiene; solo les faltaba saber cuánto gastó el cliente.
21. Reportes de venta en el dashboard.
22. La IA de Umi, por primera vez, con historial de compra real.

### Prueba piloto sugerida

**Una cafetería, una sucursal, un dispositivo, efectivo únicamente, sin inventario.**

**Criterios de aceptación:**

- 100% de las ventas del POS aparecen en el KDS sin intervención.
- **Cero** ventas duplicadas tras cortar la red a propósito 20 veces.
- **Cero** ventas perdidas tras cortar la red a propósito 20 veces.
- El corte de caja del POS cuadra con el efectivo físico al cierre, **tres días seguidos**.
- Revocar el dispositivo desde el dashboard lo deja sin poder cobrar, en menos de un request.
- **Un sello ganado en el POS trae `order_id`** — y es la primera vez en la historia de Umi que un sello sabe qué compró el cliente.

---

## Apéndice A — Restricciones cumplidas

No se modificó código de producción · no se instalaron dependencias · no se crearon endpoints · no se implementaron webhooks · no se cambió la base de datos · no se expusieron secretos · este documento solo investiga, documenta y propone.

## Apéndice B — Resumen para el equipo de NEXO

Ver documento separado: [`2026-07-14-umipos-resumen-para-nexo.md`](./2026-07-14-umipos-resumen-para-nexo.md)
