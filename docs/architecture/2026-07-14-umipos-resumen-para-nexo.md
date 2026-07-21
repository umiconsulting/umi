# UmiPOS — Resumen para el equipo de NEXO

**Fecha:** 2026-07-14
**Documento completo:** [`2026-07-14-umipos-analisis-integracion.md`](./2026-07-14-umipos-analisis-integracion.md)

Analizamos la plataforma de Umi para responder cómo se integra NEXO. La respuesta corta es que **la pregunta cambia**, y creemos que el cambio es una buena noticia: **hay mucho menos que integrar y mucho más que construir.**

---

## 1. NEXO es un producto de Umi, no un sistema externo

Va a llamarse **UmiPOS**. Esto no es una nota organizacional: cambia el diseño.

Si UmiPOS fuera un SaaS separado, habría que construir sincronización de catálogos, replicación de ventas, reconciliación del wallet, webhooks, deduplicación y manejo de entrega fuera de orden. **Nada de eso hace falta.** Todos esos problemas existen *únicamente* porque habría dos bases de datos.

**UmiPOS es un cliente del API de Umi**, igual que ya lo son el KDS y el dashboard. Escribe la orden directo. Y ahí está el argumento decisivo:

> **La pantalla de cocina (KDS) no lee una tabla propia: lee una proyección derivada de la orden y su diario de eventos.** No existe código de integración entre el bot de WhatsApp y la cocina — la orden aparece porque ambos miran los mismos datos.
>
> Si el POS escribe la orden ahí, **aparece en el KDS y en el dashboard sin una sola línea de código de integración.**
>
> Si el POS escribe en su propia base, hay que construir —y mantener para siempre— una replicación que produzca ese mismo resultado. Y va a divergir.

Esto además es un principio fundacional de la arquitectura de Umi, no una preferencia: *"un solo backend es dueño de los datos; todo lo demás es un cliente delgado."*

---

## 2. La arquitectura de Umi **ya reservó el asiento del POS**

Esto es lo más importante que tienen que saber antes de diseñar nada. El modelo de dominio de Umi tiene una sección dedicada al POS, y dice que un POS es simultáneamente **un canal de órdenes, un escritor de pagos y devoluciones, una interfaz de autoría de menú, y un actor de lealtad** (escaneo de tarjeta en la caja).

Y concluye algo que conviene leer con cuidado: las tablas de **pago**, **devolución** y **canal** existen en el modelo, **sin escritor**, *precisamente porque se asumió que el POS iba a llegar*.

El POS aparece con nombre propio en cada capa:

| Capa | Ya existe en el modelo |
|---|---|
| **Orden** | `customer_order.source` incluye `'pos'` |
| **Dispositivo** | `device.kind` incluye `'pos_terminal'` |
| **Sesión** | `session.app` incluye `'pos'` |
| **Canal** | el catálogo de canales incluye `'pos'` |
| **Integración** | `integration.provider` incluye `'umi_pos'` |
| **Menú** | `business.menu_source` contempla que el POS sea la fuente |
| **Producto de venta** | el catálogo de productos contempla `'pos'` |

**No hay que negociar una arquitectura de integración. Hay que ocupar el espacio que el modelo ya reservó y terminar de construirlo.**

---

## 3. El "wallet" no es lo que dice el brief — corríjanlo ya

El brief lo describe como *"un wallet relacionado con los productos vendidos"*. **No tiene ninguna relación con productos vendidos.** Son **dos contadores independientes** en una tarjeta de lealtad:

- **Sellos:** +1 cada vez que el staff escanea al cliente. Máximo uno al día. A los N sellos (default 10) hay recompensa. **No es proporcional al gasto.**
- **Saldo (monedero):** valor almacenado en centavos MXN, con ledger append-only.

**Ninguno de los dos referencia una orden, un producto o un pago.** Un sello no lleva `order_id` ni monto. Una recarga no lleva referencia de pago — **el staff teclea el monto a mano** y el efectivo se cobra fuera del sistema.

Dos invariantes del modelo que hay que respetar sí o sí:

- **La tarjeta es identidad pura.** No hay columna de saldo ni de conteo de visitas: el saldo es `SUM(ledger)` y las visitas son `COUNT(visitas)`. **Nunca cachear un total.**
- **Los ledgers de dinero son append-only.** Una devolución es una fila nueva con delta negativo, **nunca** un `UPDATE`.

---

## 4. Lo que Umi ya tiene (no lo reconstruyan)

| Ya existe en el modelo | Nota |
|---|---|
| **Multi-tenant con RLS** | Aislamiento a nivel de base de datos. |
| **Negocios y sucursales** | Con horarios y estaciones de cocina. |
| **Clientes e identidad** | Grafo de identidad federada, con normalización de teléfono consciente de México. Una sola puerta de entrada. |
| **Catálogo** | Productos, categorías, grupos de opción, modificadores, disponibilidad por sucursal. |
| **Órdenes + cocina** | Diario de eventos append-only, idempotencia por llave única. |
| **Dispositivos enrolados** | Ver punto 6. |
| **Lealtad** | Sellos + saldo, con pases de Google/Apple Wallet. |
| **Entitlements** | Qué producto tiene contratado cada café. |

De los 10 módulos del brief de NEXO, **4 ya existen** (organizaciones, sucursales, clientes, catálogo). **No los reconstruyan para después sincronizarlos.**

---

## 5. Lo que falta (esto es el trabajo real)

Esto es lo que hay que dimensionar. **Nada de esta lista existe hoy** — pero fíjense bien en la columna de estado, porque **«no existe todavía» y «no va a existir» son cosas muy distintas**, y confundirlas lleva a construir cosas por duplicado:

| Estado | Significa |
|---|---|
| ✅ **DECIDIDO** | Ya está en el modelo o la planeación de Umi; falta implementarlo. **Es una dependencia, no una decisión de ustedes.** **No lo construyan en paralelo.** |
| ⚠️ **DIFERIDO** | El modelo lo dejó fuera **a propósito**, esperando un disparador — y el POS puede ser ese disparador. **Hay que decidir.** |
| ❌ **FALTANTE** | No está en la planeación. **El proyecto POS lo decide y lo construye.** |

| Falta | Estado | Nota |
|---|---|---|
| **`POST /orders`** | ✅ **DECIDIDO** | Ninguna ruta crea órdenes hoy. El POS estrena ese camino, y ya está contemplado. |
| **Escritor de pagos y devoluciones** | ✅ **DECIDIDO** | Las tablas existen **sin escritor, esperando al POS**. |
| **`pos` en el catálogo de productos** | ✅ **DECIDIDO** | El modelo lo exige; el DDL aún no lo tiene. **Sin esto UmiPOS no se puede contratar ni facturar.** Barato. Va primero. |
| **La proyección de tickets de cocina** | ✅ **DECIDIDO** | **Es la pieza que hace realidad la promesa del punto 1** ("aparece en el KDS gratis"). |
| **Enganche venta ↔ lealtad** | ✅ **DECIDIDO** | Ver punto 7. **Es lo de mayor valor.** |
| **Métricas y tracing** | ✅ **DECIDIDO** | ⚠️ **Importante: NO construyan telemetría propia.** Umi ya decidió que la telemetría **sale de la base de datos y se va a OpenTelemetry** (Collector → Tempo/Prometheus/Loki). Falta cablearlo. **El POS emite señales OTel como todo lo demás.** |
| **Contrato tipado de las rutas del POS** | ✅ **DECIDIDO** | Umi usa `@umi/contract` (rutas + esquemas zod), no OpenAPI. El POS **extiende** ese contrato; no inventa uno. |
| **Inventario** | ⚠️ **DIFERIDO** | El modelo lo dejó fuera **a propósito**, con una regla explícita: modelarlo cuando aparezca un escritor real — **y el POS podría serlo.** Decisión de alcance (pregunta 3). |
| **Auditoría de venta/dispositivo** | ⚠️ **DIFERIDO** | El modelo excluyó los eventos de dispositivo por considerarlos telemetría. **Para un POS, "quién cobró y en qué aparato" es un hecho de negocio (y legal), no telemetría.** Hay que reabrir esa decisión. |
| **Impuestos, propina, descuentos, redondeo** | ❌ **FALTANTE** | **Son producto, no ingeniería.** Bloquean la aritmética de la venta. |
| **Caja: apertura, corte, arqueo** | ❌ **FALTANTE** | Modelo nuevo completo. |
| **Procesador de pagos** | ❌ **FALTANTE** | **No hay Stripe, Conekta, MercadoPago, Clip ni OpenPay.** La única integración de comercio existente sincroniza catálogo, **no cobra**. Si el POS va a **procesar** pagos (pregunta 1), es **greenfield completo**. |
| **Impresión** (ticket, comanda, cajón) | ❌ **FALTANTE** | **Cero precedente.** Nadie en Umi ha impreso nunca nada. |
| **Modo offline** | ❌ **FALTANTE** | **Cero precedente.** Ningún cliente de Umi persiste datos localmente salvo su credencial. |
| **Expiración/rotación del token de dispositivo** | ❌ **FALTANTE** | El token del KDS no expira. **Un POS no puede heredar eso.** |
| **Versionado de API** | ❌ **FALTANTE** | Importa porque POS y KDS viven **en campo** y no se actualizan a voluntad. |
| **Entorno de pruebas no-productivo** | ❌ **FALTANTE** | El backend de Umi despliega directo a producción al hacer merge. **No hay un backend ni una base de datos fuera de producción.** Un POS **cobra dinero real** y necesita poder ensayar el cobro sin moverlo. |

**Conclusión: UmiPOS no "se integra con el módulo de ventas de Umi". UmiPOS *es* el módulo de ventas.**

---

## 6. El POS es un dispositivo dado de alta, no una página web

La idea de multi-pantalla es buena, pero **un POS accesible desde cualquier navegador es inaceptable.** Significa que un empleado puede abrir caja, registrar ventas y mover saldo **desde su casa**. Es el vector de fraude interno más común en restaurantes, y es el tipo de incidente que destruye la reputación de un proveedor de POS.

**Multi-pantalla ≠ multi-acceso.** Separamos por superficie:

- **POS** (cobra) → **solo dispositivo enrolado**. Terminal Android whitelabel. Flutter.
- **KDS** (cocina) → dispositivo enrolado. Flutter (migra desde Swift).
- **Dashboard** (catálogo, reportes, corte) → web, sesión de usuario. **No cobra.**

Un empleado puede *ver* el reporte de ventas desde su casa. **No puede cobrar desde su casa.**

**Y esto ya está en el modelo:** el dispositivo es un principal de primera clase (`device.kind` incluye `pos_terminal`). El flujo ya funciona con el KDS: el dueño genera un PIN de 6 dígitos desde el dashboard → el dispositivo lo captura → el dueño aprueba → el dispositivo recibe un token que el servidor guarda **solo hasheado** → el dueño puede revocarlo en un segundo y el aparato borra su credencial sola.

**El POS no inventa un modelo de seguridad. Reusa este**, endureciéndolo en tres puntos: expiración y rotación del token, un solo predicado de alcance de sucursal, y auditoría de quién cobró en qué aparato.

Nota relacionada: **no existe autenticación máquina-a-máquina en Umi** (no hay API keys ni bearer tokens). Eso es deliberado, y confirma el camino: la credencial del POS es la del **aparato enrolado**, no una llave portátil que se puede copiar.

---

## 7. Por qué este proyecto importa más de lo que parece

Hoy la lealtad de Umi **está ciega**. Un sello no sabe qué compró el cliente. Una recarga no sabe qué se pagó. El staff teclea los montos a mano.

**El POS es lo que cierra el circuito.** Cuando exista, por primera vez se podrá:
- estampar un sello **con `order_id`** → sabemos qué compró el cliente;
- ligar el ledger de dinero a una venta real;
- habilitar **recompensas por gasto** — el modelo **ya las tiene diseñadas**, solo les faltaba saber cuánto gastó el cliente;
- darle a la IA de Umi el dato que le falta: **el historial de compra real.**

Umi le promete a las cafeterías que va a conocer a sus clientes. **Hoy está adivinando.** El POS es lo que convierte esa promesa en un hecho.

---

## 8. Stack

El stack es el de Umi. Un stack distinto implica un backend distinto → una base distinta → los problemas de sincronización del punto 1.

- **Backend:** NestJS + Fastify + Postgres (SQL a mano, sin ORM) + BullMQ. **UmiPOS es un módulo dentro del API (`modules/pos/`), no un servicio nuevo ni un esquema nuevo.** (En este modelo el esquema marca *autoría*; el dominio vive en el código.)
- **Base de datos:** **Umi ya tiene su Postgres** (multi-tenant, con RLS). **UmiPOS no levanta una base separada:** escribe en la base de Umi, en las mismas tablas que ya leen el KDS y el dashboard. *Cuando decimos "el POS no tiene base de datos", queremos decir que **no debe haber una segunda base** — no que no exista ninguna.*
- **Cliente POS:** **Flutter** (Android whitelabel; macOS/iOS para pruebas).
- **KDS:** migra de Swift a Flutter y **comparte la base con el POS** (auth de dispositivo, cola offline, capa HTTP). Escribirla dos veces sería tirar dinero.
- **Dashboard:** React/Vite, sin cambios.
- **Contrato:** el POS **extiende** `@umi/contract` (rutas tipadas + esquemas zod).
- **Infraestructura:** sin cambios. El POS no agrega infraestructura.

**Reglas del modelo que el POS debe respetar:** dinero siempre en **centavos enteros** (nunca float) · ledgers **append-only** · **"derive, don't cache"** (no escribir totales) · **RLS por negocio** · una orden y su evento de apertura en la **misma transacción** (si falta el evento, la orden es invisible en cocina).

---

## 9. Lo que necesitamos decidir antes de programar

| # | Pregunta | Quién |
|---|---|---|
| 1 | **¿UmiPOS *procesa* pagos (terminal/adquirente) o solo *registra* el medio de pago cobrado aparte?** Son dos productos y dos ámbitos regulatorios distintos. | Dueño |
| 2 | **¿Reglas de impuesto, propina, descuento y redondeo?** **Ninguna existe hoy.** Es producto, no ingeniería. | Producto |
| 3 | ¿Inventario en fase 1? **Recomendamos que no.** | Dueño |
| 4 | ¿"Agenda" aplica a una cafetería? Parece venir de otro modelo de negocio. **Recomendamos sacarlo.** | Producto |
| 5 | Cuando el dashboard y el POS discrepen sobre el catálogo, **¿cuál gana?** (el modelo ya contempla que el POS autore menú; falta la dirección de conflicto) | Producto |
| 6 | ¿Qué hardware exactamente? (terminal, impresora, cajón, lector) | Dueño |

---

## 10. Primer hito propuesto

**Una orden creada por el POS aparece en la pantalla de cocina sin una sola línea de código de integración.**

Si eso funciona, la arquitectura es correcta y todo lo demás es trabajo. **Si hace falta escribir código de sincronización para lograrlo, algo se diseñó mal.**

**Piloto:** una cafetería, una sucursal, un dispositivo, efectivo únicamente, sin inventario.

**Criterios de aceptación:** cero ventas duplicadas y cero ventas perdidas tras cortar la red a propósito 20 veces · el corte de caja cuadra con el efectivo físico tres días seguidos · revocar el dispositivo lo deja sin cobrar en menos de un request · **un sello ganado en el POS trae `order_id`**.
