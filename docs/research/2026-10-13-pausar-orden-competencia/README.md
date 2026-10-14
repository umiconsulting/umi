# Pausar una orden: cómo lo hace la competencia

Fecha: 2026-10-13. Alcance: **pausar una orden o derivados** — qué significa en Toast, Square, Clover, Lightspeed, GoTab, SpotOn, Soft Restaurant, Fudo y Parrot; qué se ve en pantalla; y qué de eso aplica a UMI.

Etiquetas: **hecho documentado** (primera fuente del proveedor), **lectura de captura** (lo que muestra la imagen), **inferencia**, **NO VERIFICADO**.

## 0. "Pausar" son tres cosas distintas

| Acción                                  | Qué pausa                                              | Cómo se reanuda                                            | Quién lo tiene                                   |
| --------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------ |
| **A. Hold por partida o por curso**     | El platillo ya capturado no se dispara a cocina        | Se selecciona y se "fira", o se dispara el curso siguiente | Toast, Square, Clover, Lightspeed, GoTab, SpotOn |
| **B. Cuenta abierta / ticket guardado** | La cuenta entera; el operador hace otra cosa y vuelve  | Se elige la cuenta en la lista de cuentas abiertas         | Toast, Square, Clover, Soft Restaurant, Fudo     |
| **C. Venta suspendida**                 | La venta se aparta con un nombre y se recupera después | Se busca por nombre en "ventas suspendidas"                | UMI (heredado), Square (saved carts), Clover     |

**La distinción que importa:** A y B no compiten. En los sistemas revisados existe B, y en ninguno B **bloquea la caja**: mientras una cuenta está abierta se puede tomar otra, porque el carrito es sólo la vista de la cuenta seleccionada y no un candado del terminal.

## 1. Toast — Send / Stay / Hold

**Hecho documentado.** Toast separa las tres acciones dentro de la misma cuenta ([artículo oficial](https://support.toasttab.com/en/article/Differences-Between-the-Send-Stay-and-Hold-Buttons), actualizado 2026-09-17):

- **Send** — manda a cocina o barra los artículos seleccionados y regresa a la pantalla de mesas.
- **Stay** — manda los artículos seleccionados y **te deja en la cuenta** para seguir agregando; los no seleccionados quedan automáticamente en hold.
- **Hold** — los artículos ya están en la cuenta pero **no se disparan** hasta que alguien los seleccione y los envíe. Es la razón de ser del botón: capturar todo lo que el cliente ya pidió sin comprometer el tiempo de la cocina.

Detalles que valen para UMI:

- El mapa de mesas usa **color como señal de pausa**: rojo cuando la cuenta tiene artículos en hold, amarillo cuando todo está enviado y la cuenta sigue abierta.
- **El inventario se descuenta al poner en hold**, no al disparar; se devuelve si el artículo se anula.
- En el KDS, los tickets retenidos se pueden mostrar en expo y en preparación, o sólo en expo (Toast Web → Kitchen → Pacing → Held Tickets).
- La API lo nombra sin ambigüedad: `HOLD` es "un empleado pausó la selección para que no aparezca en el KDS" ([Toast API](https://toastprereleasemenus.redoc.ly/orders/operation/ordersOrderGuidChecksCheckGuidSelectionsPost/)).
- Toast también tiene **Schedule**: pausa por tiempo (pedido programado para más tarde), la tercera variante de "no lo mandes ahora".

**Lectura de captura** — `assets/toast-send-stay-hold.png`: los tres botones viven en una sola fila bajo la cuenta (Hold / Stay / Send), los artículos ya enviados se marcan "Sent 9:53 AM" y el artículo en captura queda seleccionado en azul. La cuenta se abandona con "All checks" arriba a la derecha, nunca con un "guardar y salir".

## 2. Square — Open Tickets y hold/fire por curso

**Hecho documentado.** Square resuelve B con **Open Tickets**: crear, editar y guardar una orden para cobrarla después ([artículo oficial](https://squareup.com/help/us/en/article/5337-use-open-tickets-with-square)).

- Un ticket abierto se ve **desde cualquier dispositivo** con la misma cuenta.
- Nombre y nota del ticket son editables; se guarda con `X → Save ticket`.
- Se pueden dividir y unir tickets abiertos.

**Lectura de captura** — `assets/square-tickets-list.jpg`: la lista de tickets es un panel lateral con contadores por tipo ("todos 2 · mostrador 1 · mesas 1") y cada renglón trae **duración y total** ("カウンター 4 — 29 min — ¥1,485"). Ese detalle es el que le falta a nuestra lista de cuentas: el tiempo que lleva abierta.

**Hecho documentado** — para A, Square tiene coursing con hold/fire en el KDS ([artículo oficial](https://squareup.com/help/us/en/article/7748-coursing-with-square-kds)).

**Lectura de captura** — `assets/square-kds-coursing-settings.png`: el ajuste se ofrece como **"Show fired and held courses"** vs **"Only show fired courses"**, es decir, el retenido puede ser invisible o visible según la estación. `assets/square-course-cards-fire-hold.png` muestra las tarjetas: _Course 1_ con etiqueta roja **Fire**, _Course 2_ con etiqueta azul **Hold**.

## 3. Clover

- **Hecho documentado** — Clover Dining asigna artículos a cursos y los retiene, con una acción de disparar el curso siguiente desde handheld o terminal.
- **Hecho documentado** — Clover Avrio (guía de SilverWare): los artículos en hold se marcan con un **badge en el ícono de reloj**; al dispararlos pasan a amarillo y el badge se mueve al ícono de flama ([guía](https://support.silverwarepos.com/hc/en-us/articles/13194050863771--KB1251-SilverWare-Clover-USER-SUPPORT-GUIDE-v1-0)). Es representación por ícono con estado, sin texto.
- **Lectura de captura** — `assets/clover-on-hold.png`: sección rotulada **ON HOLD** dentro del pedido, con `Undo` y `Finalize` como salidas. El pedido conserva `Diner / Check (2) / Pay` al pie: el contador de cuentas es parte de la barra fija.
- **Cuidado con el homónimo:** en el dashboard de Clover, "On hold" en la lista de órdenes es un **estado de pago** (autorización sin capturar), no de cocina ([docs.clover.com](https://docs.clover.com/dev/docs/authorizing-and-verifying-orders)). Es el mismo error de vocabulario que ya nos pasó: una palabra para dos cosas.

## 4. Lightspeed

- **Hecho documentado** — modo curso con panel flotante _Course 1 / Course 2 / **Fire course**_; el artículo se manda con "Send – N items" y el curso se dispara aparte ([Firing a course](https://resto-support.lightspeedhq.com/hc/en-us/articles/360020992054-Firing-a-course)). En K-Series el botón aparece como _Fire course 2_, en naranja, junto a _Pay_.
- **Inferencia** — Lightspeed y Toast coinciden en el vocabulario: **Send** = mandar ahora, **Fire** = liberar lo retenido. Vale la pena que UMI use esas dos palabras y nada más.

## 5. GoTab — la mejor referencia visual de hold por curso

**Hecho documentado y lectura de captura** — `assets/gotab-orders-on-hold.png` ([artículo](https://success.gotab.io/knowledge/full-service-pos-coursing)):

- La cuenta muestra una sección **"Orders On Hold"** con un renglón por curso, cada uno con **temporizador** (Salads 02:20, Entree 05:40), un botón azul **Fire** y **Edit**.
- Abajo, **"Previously Ordered"** lista lo que ya se disparó, sin temporizador.
- La propia guía explica para qué sirve _Edit_: cambiar la temperatura de una hamburguesa **antes de que se dispare**.

Este es el patrón más cercano a lo que a UMI le falta: la cuenta abierta se divide en "ya se mandó" y "todavía no", y cada bloque se libera cuando el operador decide.

## 6. SpotOn

- **Hecho documentado** — los comandos de la orden exponen _Change Course_ y _Autocourse_ también desde el handheld; _Kitchen Release Mode_ (2026) define **cuándo disparan a cocina** los pedidos programados ([novedades](https://express-updates.spoton.com/announcements/product-updates-weeks-07-01-26-07-31-26)).
- **Hecho documentado** — pausar por canal de venta existe y es de un clic: se pausa y reanuda SpotOn Order, DoorDash y Uber Eats desde el POS ([novedades](https://express-updates.spoton.com/announcements/product-updates-weeks-09-01-26-09-30-26)). Es "pausar" de otro tipo: disponibilidad, no cuenta.

## 7. México y LatAm

- **Soft Restaurant** — botón **"CUENTA EN ESPERA"** en el módulo Servicio Rápido; el turno **no se puede cerrar con cuentas abiertas**, así que el sistema empuja a resolverlas antes de cortar. **Lectura de captura:** `assets/softrestaurant-cuenta-en-espera.png` ([artículo](https://softrestaurant.zohodesk.com/portal/es/kb/articles/no-se-puede-cerrar-el-turno-porque-existen-cuentas-abiertas)). En su módulo de comedor la lista de pendientes llega a mostrar 44 cuentas abiertas a la vez.
- **Fudo** — la cuenta vive dentro de su área: pestañas **Mostrador, Mesas y Delivery** sobre el mismo mapa. Una mesa abierta no impide cobrar en mostrador porque son listas distintas. **Lectura de captura:** `assets/fudo-mapa-mesas.png` ([ficha](https://www.getapp.com.mx/software/2053876/fudo)).
- **Parrot** — **NO VERIFICADO**: no encontré en su centro de ayuda una función explícita de pausar/hold. Sí documenta _Transferir artículos_ entre órdenes activas y tipos de orden ([parrotsoftware](https://soporte.parrotsoftware.com.mx/es_MX/tipo-de-orden-pos/transferir-articulos)).

## 8. Qué significa para UMI

**Corrección importante.** Buena parte de A **ya está construida**, y el nombre del estado ya existe: se llama _enviada a cocina_. El botón de la comanda dice **"Enviar a cocina"** ([fireOrderAction](../../../apps/umi-pos/lib/core/localization/app_localizations_es.dart:2202)) y cada renglón del carrito lleva el sello ([catalog_surface.dart:4473](../../../apps/umi-pos/lib/features/catalog/catalog_surface.dart:4473)):

| Renglón                   | Qué significa                             | Equivalente en el mercado   |
| ------------------------- | ----------------------------------------- | --------------------------- |
| **"Enviada"**             | La cocina ya tiene el platillo            | Toast `SENT`, Square `Fire` |
| **"Pendiente de enviar"** | Está capturado y no existe para la cocina | Toast `HOLD`                |

Del lado de la cocina el patrón de cursos también está: el ticket se parte en cursos con líneas **fired** y **held** ([kitchen_board_controller.dart:207](../../../apps/umi-pos/lib/features/kitchen/kitchen_board_controller.dart:207)), y `fire_course` avanza un _watermark_ que sólo puede ir hacia adelante ([pos-kitchen.ts:91](../../../packages/contract/src/pos-kitchen.ts:91)) — que es el "Fire course" de Toast y el botón _Fire_ de GoTab.

Es decir: el "hold" de Toast es **nuestro estado por defecto**, no una función que falte. En Toast todo lo que se captura va a cocina salvo que se retenga; en UMI nada va a cocina hasta que se toca "Enviar a cocina". Con un renglón irregular: cuando un carrito ya tiene order disparada y se agrega una segunda ronda, esas líneas nuevas llegan sin enviar y el botón las manda.

Lo que **sí** falta, y es lo único que pedía el paso 1:

- `Guardar y salir` sólo aparece **al editar una cuenta** recogida de la lista ([catalog_surface.dart:551](../../../apps/umi-pos/lib/features/catalog/catalog_surface.dart:551)): es exactamente el "put it back" de la industria.
- Un guardia de **una sola cuenta activa por operador**: quien ya tiene una cuenta abierta no puede tomar otra, y el carrito queda ocupado por la cuenta guardada ([pos-cart.repository.ts:459](../../../apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts:459), código `CART_ACCOUNT_BUSY`).
- Existe un "Suspender venta / Ventas suspendidas" heredado ([sale_surface.dart](../../../apps/umi-pos/lib/features/sale/sale_surface.dart)), con su propio vocabulario, distinto del modelo de cuentas.
- El sello del renglón es texto chico del mismo color que el resto, así que "pendiente de enviar" se pierde de vista. Toast pinta la mesa de rojo, GoTab pone temporizadores y Clover un badge en el ícono.

| Pregunta                               | Lo que hace el mercado               | UMI hoy                                     |
| -------------------------------------- | ------------------------------------ | ------------------------------------------- |
| ¿Cómo sé qué ya está en cocina?        | Renglón marcado (SENT / Fire)        | Renglón marcado ("Enviada")                 |
| ¿Cómo pauso una partida?               | Botón Hold                           | Nada se envía hasta tocar "Enviar a cocina" |
| ¿Pausa por curso en cocina?            | Fire course / Orders On Hold         | Cursos fired/held y `fire_course`           |
| ¿Una cuenta abierta impide tomar otra? | No, nunca                            | Sí, por operador                            |
| ¿Cómo se vuelve a una cuenta?          | Lista con contador, duración y total | Lista de cuentas, sin duración              |
| ¿Se ve de lejos lo pendiente?          | Color y badges                       | No, sólo texto                              |

**Recomendación en dos pasos, en este orden:**

1. **Quitar el candado de una sola cuenta activa** y dejar que el carrito sea sólo la cuenta seleccionada. Conservar el bloqueo únicamente cuando _otra persona_ tiene la cuenta activa (eso sí es un conflicto real) y cuando la mesa ya tiene cuenta abierta. Con eso, "Nueva cuenta" no toca la anterior y `Guardar y salir` deja de tener sentido en el carrito nuevo.
2. **Hacer visible lo que ya existe**, sin función nueva: que "Pendiente de enviar" salte a la vista (punto o badge, no texto gris) y que la cuenta muestre cuántas partidas faltan de enviar, como el contador de Clover o el temporizador de GoTab.

Vocabulario propuesto, calcado de Toast, Lightspeed y Square: **Enviar** (mandar ahora), **Retener** (no disparar todavía) y **Cuentas abiertas** (la lista). Nada de "guardar y salir".

## Fuentes

| #   | Fuente                                                                                                                                                              | Uso                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | [Toast — Send, Stay and Hold](https://support.toasttab.com/en/article/Differences-Between-the-Send-Stay-and-Hold-Buttons)                                           | Semántica A              |
| 2   | [Toast — Server Item Firing](https://support.toasttab.com/en/article/Using-Server-Item-Firing)                                                                      | Hold como retención real |
| 3   | [Toast — Course Firing Options](https://support.toasttab.com/en/article/Course-Firing-Options)                                                                      | Hold por curso           |
| 4   | [Toast API — HOLD](https://toastprereleasemenus.redoc.ly/orders/operation/ordersOrderGuidChecksCheckGuidSelectionsPost/)                                            | Definición formal        |
| 5   | [Square — Open Tickets](https://squareup.com/help/us/en/article/5337-use-open-tickets-with-square)                                                                  | Semántica B              |
| 6   | [Square — Coursing with KDS](https://squareup.com/help/us/en/article/7748-coursing-with-square-kds)                                                                 | Hold/fire y su ajuste    |
| 7   | [Square — Split and merge open tickets](https://squareup.com/help/us/en/article/8439-split-and-merge-open-tickets)                                                  | Límites de B             |
| 8   | [GoTab — POS Coursing](https://success.gotab.io/knowledge/full-service-pos-coursing)                                                                                | Patrón visual de A       |
| 9   | [Clover — authorizing and verifying orders](https://docs.clover.com/dev/docs/authorizing-and-verifying-orders)                                                      | Homónimo "On hold"       |
| 10  | [SilverWare — Clover hold and fire](https://support.silverwarepos.com/hc/en-us/articles/13194050863771--KB1251-SilverWare-Clover-USER-SUPPORT-GUIDE-v1-0)           | Estados por ícono        |
| 11  | [Lightspeed — firing a course](https://resto-support.lightspeedhq.com/hc/en-us/articles/360020992054-Firing-a-course)                                               | Vocabulario Fire         |
| 12  | [SpotOn — Kitchen Release Mode](https://express-updates.spoton.com/announcements/product-updates-weeks-07-01-26-07-31-26)                                           | Pausa programada         |
| 13  | [Soft Restaurant — cuentas abiertas y turno](https://softrestaurant.zohodesk.com/portal/es/kb/articles/no-se-puede-cerrar-el-turno-porque-existen-cuentas-abiertas) | B en México              |
| 14  | [Fudo — ficha de producto](https://www.getapp.com.mx/software/2053876/fudo)                                                                                         | Áreas separadas          |

## Capturas

| Archivo                                      | Qué muestra                                             |
| -------------------------------------------- | ------------------------------------------------------- |
| `assets/toast-send-stay-hold.png`            | Hold / Stay / Send en la cuenta y los envíos marcados   |
| `assets/toast-kds-course-pacing-held.png`    | El KDS del expediter con cursos disparados y retenidos  |
| `assets/square-tickets-list.jpg`             | Lista de tickets abiertos con duración y total          |
| `assets/square-course-cards-fire-hold.png`   | Tarjetas de curso con etiqueta Fire y Hold              |
| `assets/square-kds-coursing-settings.png`    | Ajuste "show fired and held" vs "only fired"            |
| `assets/clover-on-hold.png`                  | Sección ON HOLD con Undo/Finalize y contador de cuentas |
| `assets/gotab-orders-on-hold.png`            | Orders On Hold con temporizador, Fire y Edit por curso  |
| `assets/softrestaurant-cuenta-en-espera.png` | Botón CUENTA EN ESPERA en Servicio Rápido               |
| `assets/fudo-mapa-mesas.png`                 | Mapa de mesas con Mostrador / Mesas / Delivery          |

Capturas descargadas el 2026-10-13 desde las páginas de las fuentes anteriores. Dos imágenes no se pudieron bajar (el sitio bloquea la descarga directa) y se citan por URL: el disparo por curso de Lightspeed y el hold/fire de Clover Avrio.
