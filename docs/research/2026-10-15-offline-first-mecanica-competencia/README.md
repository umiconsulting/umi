# Offline-first: la mecánica interna de siete POS (US y MX)

- Date: 2026-10-15
- Question: **no qué funciones dicen tener, sino dónde vive la copia de trabajo, cómo se
  confirma una escritura, qué identidad usa la cola y qué se niegan a hacer sin conexión** —
  para siete productos: Toast, Square, Lightspeed, Odoo (US) y PoloTab, Fudo, Soft Restaurant
  (MX).
- Decision it informs: el diseño del order path offline-first de UmiPOS
  (`docs/pilot/UMIPOS_OFFLINE_FIRST_ORDER_PATH_DESIGN.md`).
- Trigger: medido en producción, una acción en la caja cuesta un viaje de ida y vuelta a la
  API en Boston más otro a Postgres en Ohio; el dueño reporta que la caja "se siente lenta" y
  que casi toda la interacción depende de que la llamada a la API tenga éxito.

**Sobre este documento.** Es la segunda pasada. La primera
([`2026-10-14-pos-latencia-hub-local`](../2026-10-14-pos-latencia-hub-local/README.md))
estableció _dónde corre el order path_ y comparó Toast, Square, Clover, Lightspeed, Soft
Restaurant, 2POS y Parrot. Esta pasada **no re-litiga eso**: entra a la mecánica —la cola, la
identidad, la reconciliación, los límites— y añade en profundidad los tres productos que
faltaban: **Odoo, PoloTab y Fudo**. La matriz de funciones sigue en
[`2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md`](../2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md).

Labels: **Documented fact**, **Source-backed tradeoff**, **Inference**, **UNVERIFIED**.

## 1. Answer

**Inference, sobre hechos documentados.** Los siete no resuelven el mismo problema. Caben en
tres arquetipos, y lo que decide cuál adoptas no es el tamaño del cliente sino **cuántos
dispositivos tienen que estar de acuerdo en el mismo pedido**:

| Arquetipo                 | Quién                                                       | Dónde vive la copia de trabajo                     | Qué se pierde sin conexión                                         |
| ------------------------- | ----------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| **A. Nube sin offline**   | Fudo                                                        | El servidor, y solo el servidor                    | Todo                                                               |
| **B. Cola en el aparato** | Square, Odoo, (Shopify, SumUp, Zettle)                      | La memoria del aparato, sembrada mientras hubo red | Lo que otro aparato necesite ver; lo que un tercero deba autorizar |
| **C. Nodo local**         | Toast, Lightspeed, Soft Restaurant, PoloTab, (Parrot, 2POS) | Un aparato designado dentro del local              | Lo que dependa de la nube o del procesador de pagos                |

**Inference.** La frontera entre B y C es exactamente la pregunta que importa para Umi: **si dos
pantallas del mismo local tienen que ver el mismo pedido en vivo, el arquetipo B no basta y
ningún proveedor lo finge.** Toast lo escribe sin adornos: sin conexión, los pedidos tomados en
un aparato no aparecen en otro, salvo en el KDS, que sí está en la red local. Lightspeed lo
resuelve con un _active device_ que guarda y reenvía. Soft Restaurant lo resuelve con una
estación principal. PoloTab lo resuelve con el router que él mismo vende. Umi —caja, KDS y
comandera sobre las mismas cuentas— es del segundo tipo.

## 2. La rejilla de mecánica

| Producto                 | Copia de trabajo al arrancar                                                                                                                                                                      | Identidad de la cola / unidad de sincronización                                                                      | Confirmación de la escritura offline                                                                                                 | Qué rechaza sin conexión                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Toast** (US)           | El **local hub**: un dispositivo elegible (no handheld, **Ethernet**, en la red del restaurante, activo en los últimos 3 min), elegido solo por Toast. Un hub por red; dos subredes no se hablan. | No publicada. La unidad es el aparato → hub → nube.                                                                  | El hub retransmite a los demás aparatos y a la nube; la nube confirma después.                                                       | Iniciar/cerrar sesión, compartir pedidos entre POS que no sean KDS, horarios, informes, tarjetas regalo, lealtad, EMV, resync. |
| **Square** (US)          | La memoria del aparato.                                                                                                                                                                           | Por pago, cifrado en el aparato; el SDK expone `processingMode` (`AUTO_DETECT` mira red local y salud del servidor). | Se sube al reconectar; el cobro queda _pending_ en el historial del aparato.                                                         | Tarjeta con chip (contactless no), tarjetas regalo, lealtad; y el riesgo del rechazo es del comerciante.                       |
| **Lightspeed K** (US/CA) | El **active device**: menú, modificadores, descuentos y precios en local; el pasivo le manda sus datos.                                                                                           | Aparato → active device → nube. Los pedidos se guardan "en el Active Device(s)".                                     | El active device registra toda la actividad y la envía al volver la conexión.                                                        | Pagos integrados, back office en vivo, menú nuevo, alérgenos, gift cards, lealtad, integraciones.                              |
| **Odoo** (US/EU)         | El navegador: la sesión se abre **online** y precarga productos, precios, clientes y categorías a **IndexedDB** + Service Worker.                                                                 | El pedido, con `uuid` propio, subido en lote por `pos.order.sync_from_ui`.                                           | Se encola localmente y se empuja al reconectar; en versiones con bug, pagos reprocesados o líneas resucitadas.                       | **Abrir una sesión nueva**; el resto del ERP; lo que un módulo de pago necesite autorizar en línea.                            |
| **PoloTab** (MX)         | Los equipos del paquete, unidos por **el router y repetidor que PoloTab vende**: POS, impresora y cajón siguen operando.                                                                          | No publicada.                                                                                                        | La venta y la comanda se guardan en el equipo y se sincronizan al volver el internet.                                                | Delivery y **PoloPay** (cobro con tarjeta).                                                                                    |
| **Fudo** (AR/MX)         | **Ninguna.** Cuenta en la nube, se entra por navegador, sin instalación.                                                                                                                          | n/a                                                                                                                  | n/a                                                                                                                                  | Todo. Su FAQ: la conexión a internet es indispensable; la impresora va USB o serial al aparato que sí tiene red.               |
| **Soft Restaurant** (MX) | En CLOUD: **estación principal** y secundarias — las secundarias mandan sus ventas a la principal y ésta a la nube. En desktop 11/12: un **equipo servidor** en la sucursal.                      | Estación secundaria → principal → nube; en desktop, estación → servidor de la sucursal.                              | Sincronización constante hacia la nube; un distribuidor de CLOUD anuncia hasta **2 días** sin internet con sincronización posterior. | Lo que dependa de la nube (reportes del administrador, delivery, add-ons).                                                     |

### 2.1 Toast — el hub no es un servidor, es un retransmisor

**Documented fact.** Toast describe el _local hub device_ como "el punto de conexión … entre
todos los dispositivos en la red local del restaurante", que "retransmite actualizaciones de un
dispositivo a los demás dispositivos y a la nube"
([Offline mode with local sync](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html)).
Su lista de requisitos del hub es la parte que más enseña, porque son decisiones de diseño
disfrazadas de soporte:

- el hub tiene que ser **cableado** —el handheld nunca puede serlo—;
- lo elige Toast, no el comerciante;
- **un solo hub por red**, y dos subredes no comparten información;
- un handheld conectado directo a la nube queda **fuera** de la conversación local.

**Documented fact.** La misma guía lista lo que Toast **no** hace offline: iniciar sesión,
compartir pedidos entre POS que no sean KDS y —lo más filoso— recomienda que cada empleado
**tome y actualice pedidos en un solo aparato** mientras esté offline. Es la admisión de que
compartir escrituras concurrentes entre pantallas sin nube no lo resuelven.

**Documented fact.** En offline _sin_ local sync los aparatos ni se ven entre ellos: los
pedidos tomados en una terminal no aparecerán en las otras, y el paso a offline ocurre unos 40
segundos después de perder conectividad
([Offline payments overview](https://doc.toasttab.com/doc/platformguide/platformOfflinePaymentsOverview.html)).

### 2.2 Odoo — IndexedDB, y la deuda de hacerlo a mano

**Documented fact.** Odoo POS es una SPA: hace falta conexión a internet para **iniciar** el
punto de venta, pero sigue operativo tras una desconexión completa
([README del módulo](https://github.com/odoo/odoo/blob/20.0/addons/point_of_sale/README.md)).
La mecánica, según la respuesta aceptada del foro de Odoo: al abrir la sesión online se
precargan productos, clientes y precios a **IndexedDB**; los pedidos creados offline quedan
como **unsynced** y se empujan al backend al volver la red
([foro Odoo](https://www.odoo.com/forum/help-1/what-s-the-mechanism-of-pos-offline-283217)).

**Documented fact — y es la parte útil para nosotros.** La lista de bugs abiertos de Odoo es un
catálogo de los modos de fallo de este arquetipo, y todos son de reconciliación:

- IndexedDB y el servidor entran en conflicto al recargar, porque se cargan en distinto orden
  que `sync_from_ui`, y hace falta lógica de merge para no perder líneas
  ([issue #189836](https://github.com/odoo/odoo/issues/189836));
- `process_saved_payments` **no era idempotente** y duplicaba pagos
  ([PR 273504](https://mergebot.odoo.com/odoo/odoo/pull/273504));
- una línea recargada podía resucitar enviando el update vivo y el _unlink_ pendiente a la vez
  ([PR 285827](https://mergebot.odoo.com/odoo/odoo/pull/285827));
- un registro offline podía borrarse de IndexedDB demasiado pronto cuando un pedido pagado aún
  no estaba sincronizado ([PR 265620](https://mergebot.odoo.com/odoo/odoo/pull/265620)).

**Inference.** Odoo demuestra que la parte difícil no es guardar en local: es **reconciliar**.
La cola hay que diseñarla como log idempotente con identidad propia, o se paga en producción.

### 2.3 PoloTab — el arquetipo C vendido como hardware

**Documented fact.** PoloTab responde a "¿mi equipo funciona sin internet?" con el router:
gracias al router y repetidor de PoloTab, POS, impresora y cajón de dinero siguen operando sin
internet; delivery y PoloPay sí requieren conexión
([soporte PoloTab](https://www.polotab.com/soporte/mi-equipo-funciona-sin-internet)).

**Documented fact.** Su página de hardware dice que las impresoras de red van al "repetidor de
PoloTab o al router", y pide que todos los equipos estén en la red PoloTab para seguir
operando aunque falle el internet
([cómo se conecta el hardware](https://www.polotab.com/soporte/como-se-conecta-el-hardware)).

**Inference.** PoloTab es el competidor mexicano que más se parece al problema de Umi, y su
respuesta es **topológica**: el paquete incluye la red. No le pide al comerciante configurar
nada; vende el router como parte del sistema. La copia de trabajo vive en los equipos de _su_
red.

### 2.4 Fudo — el arquetipo A, sin matices

**Documented fact.** Su FAQ responde que "por el momento es indispensable contar con una
conexión a Internet para poder usar el sistema", y su centro de ayuda lo repite al explicar el
alta de cuenta
([FAQ](https://fu.do/es/preguntas-frecuentes/),
[¿Se necesita Internet?](https://soporte.fu.do/es/articles/11731008-se-necesita-internet-para-poder-usar-el-sistema)).

**Documented fact.** En el cobro vinculado de su terminal: si pierde la conexión, el cobro no
podrá procesarse y verás un mensaje de error
([modo vinculado MX](https://soporte.fu.do/es/articles/15019239-terminal-de-fudo-mx-como-usar-el-modo-vinculado-para-cobrar-desde-la-web)).

**Inference.** Fudo compite por producto y precio, no por continuidad: es la prueba de que el
offline no es obligatorio para vender POS en LatAm, y de que quien lo resuelve tiene un
argumento que el otro no puede copiar sin rehacer su arquitectura.

### 2.5 Soft Restaurant — el arquetipo C escrito en la ficha técnica

**Documented fact.** La ficha de CLOUD describe la **estación principal / secundarias**: al
habilitar ese modo las estaciones secundarias envían toda la información de las ventas a la
estación principal y ésta a su vez envía toda la información a la nube, con sincronización
constante para los reportes web
([ficha técnica CLOUD](https://softrestaurant.com/docs?download=206:ficha-tecnica-soft-restaurant-cloud)).

**Documented fact.** Un distribuidor autorizado describe la variante Android con 4G integrada
como capaz de trabajar sin internet por 2 días, sincronizando todos los datos registrados al
reconectar ([Doctor Pyme](https://softrestaurant.doctorpyme.mx/)). Es un **tercero**, y se cita
como tal.

**Inference.** Soft Restaurant y PoloTab son el mismo diseño con veinte años de diferencia: un
nodo en el local, estaciones que le hablan, y la nube como destino de sincronización.

### 2.6 Square y Lightspeed — lo que se copia y lo que no

**Documented fact.** El SDK móvil de Square pone **límites explícitos**: hay un tope por
transacción y un tope del total que el aparato puede guardar offline; pasarse devuelve
`USAGE_ERROR` / `offlineTransactionAmountExceeded`; y el modo `AUTO_DETECT` revisa el estado de
la conexión de red local y el desempeño de los servidores de Square para enrutar el pago
([offline payments, Android](https://developer.squareup.com/docs/mobile-payments-sdk/android/offline-payments)).
La ventana es de 24 h (Reader/Stand) o 72 h desde el primer pago offline (Register/Terminal), y
**el riesgo del rechazo es del comerciante**
([guía de preparación](https://assets.ctfassets.net/2d5q1td6cyxq/4rtVe6rP0Gs7fuKTgNV1Wh/1fc12b306941811bee0245b1d880aa49/Square_Offline_Payments_Preparation_Guide_GB.pdf)).

**Documented fact.** Lightspeed nombra los dos roles que nosotros vamos a necesitar: **active** y
**passive**. Sin internet, los dispositivos pasivos pueden seguir mandando datos a los activos,
pero los activos no pueden reenviarlos a la nube; el activo mantiene una versión local en caché
de los datos esenciales y registra toda la actividad hasta que vuelve la conexión
([Offline POS functionality](https://k-series-support.lightspeedhq.com/hc/en-us/articles/53028167251867-Offline-POS-functionality)).

**Source-backed tradeoff.** Los dos publican la misma asimetría: **lo local se degrada en
autoridad, no en disponibilidad**. Lo que necesita la firma de un tercero —un pago de tarjeta,
una tarjeta regalo, un saldo de lealtad— sale de la lista de lo permitido, y el producto lo dice
en pantalla en vez de fallar en silencio.

## 3. Lo que los siete tienen en común

1. **La copia de trabajo se siembra online.** Nadie resuelve arrancar en frío sin red. Odoo lo
   dice explícito: la sesión se abre online. Umi ya tiene el equivalente en el handshake de
   enrolamiento y la política de offline firmada.
2. **La unidad de sincronización es el pedido, con identidad propia.** Odoo usa `uuid`; Soft
   Restaurant y Lightspeed hablan de pedido o venta, nunca de "línea". Es la identidad la que
   hace idempotente el reenvío.
3. **La cola se drena al reconectar, sin intervención.** Los siete lo anuncian como automático.
4. **Hay una frontera explícita de lo prohibido offline**, y siempre incluye: identidad y
   sesión, dinero autorizado por un tercero, y configuración.
5. **El estado se anuncia en pantalla.** Toast tiene banner y diálogo de qué puedes hacer;
   Square pone una barra roja. Ninguno deja al cajero adivinando.

## 4. Lo que difiere, y por qué

**Inference.** La variable que ordena la tabla es **cuántos aparatos deben coincidir en un mismo
pedido en vivo**:

| Escenario                                        | Arquetipo suficiente   | Ejemplos                                             |
| ------------------------------------------------ | ---------------------- | ---------------------------------------------------- |
| Un aparato, sus ventas, su cola                  | B — cola en el aparato | Square, Odoo retail, SumUp, Zettle                   |
| Varios aparatos, cada uno con su cuenta          | B, con reglas          | Toast handheld en eventos                            |
| Varios aparatos sobre **la misma cuenta y mesa** | **C — nodo local**     | Umi, Lightspeed, Toast FOH, Soft Restaurant, PoloTab |

**Inference.** No es una preferencia de ingeniería: es el número de escritores. Dos cajas que
escriben la misma cuenta sin un punto de serialización producen exactamente los bugs que Odoo
arrastra (pagos duplicados, líneas resucitadas). El nodo local no es la copia de seguridad: es
**el punto único de serialización dentro del local**.

## 5. Modos de fallo documentados en el campo

- **Pagos duplicados / no idempotentes** — Odoo, [PR 273504](https://mergebot.odoo.com/odoo/odoo/pull/273504).
- **Dos fuentes de verdad que se pisan** — Odoo, [issue #189836](https://github.com/odoo/odoo/issues/189836).
- **Una línea que revive tras el _unlink_** — Odoo, [PR 285827](https://mergebot.odoo.com/odoo/odoo/pull/285827).
- **Aparatos con estados distintos y sin avisar** — reportado por operadores de Toast: el
  sistema no indica que está offline durante los primeros minutos, y se nota cuando hay cuentas
  cerradas en un handheld que siguen abiertas en los demás aparatos
  ([r/ToastPOS](https://www.reddit.com/r/ToastPOS/comments/1sa1mws/devices_not_synching_properly_customers_leaving/)).
- **Reiniciar el router durante el offline** borra el camino de los tickets al KDS hasta que
  vuelva la red local (Toast, guía del hub).

## 6. Qué implica para Umi

**Inference.** Umi ya eligió el lado que no se puede evitar: caja, KDS y comandera comparten
cuentas y mesas, así que el arquetipo B no le alcanza y el arquetipo C es el destino. Lo que
falta no es la idea; es la lista de piezas, y este documento deja claro cuáles:

1. **Un nodo local designado**, con la copia de trabajo — Lightspeed lo llama _active device_,
   Toast _local hub_, Soft Restaurant _estación principal_, PoloTab _el router_. En el paquete
   de Umi el candidato físico ya está: el iMin cableado y siempre encendido.
2. **Identidad de comando para la cola**, con idempotencia real en el servidor — la lección de
   los bugs de Odoo.
3. **Una frontera explícita de lo prohibido offline**, que Umi ya tiene escrita en
   `docs/product/UMIPOS_OFFLINE_COMMAND_POLICY.md`.
4. **Un banner de estado y un diálogo de qué se puede hacer** — el patrón que Toast y Square
   venden como parte del producto.
5. **Serialización por cuenta**: una cuenta, un escritor a la vez. Es lo que Toast recomienda en
   prosa ("cada empleado, un solo aparato") y lo que el nodo local hace por construcción.

El diseño y el plan por etapas están en
[`docs/pilot/UMIPOS_OFFLINE_FIRST_ORDER_PATH_DESIGN.md`](../../pilot/UMIPOS_OFFLINE_FIRST_ORDER_PATH_DESIGN.md).

## 7. Route log

| Ruta                                                         | Resultado                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `doc.toasttab.com` (platform guide)                          | Acceso completo. Hub local, operaciones disponibles y no disponibles.                                                     |
| `support.toasttab.com`                                       | Acceso completo. Offline mode, checklist, resync.                                                                         |
| `k-series-support.lightspeedhq.com`                          | Acceso completo. Artículo de offline con active/passive.                                                                  |
| `squareup.com/help`, `developer.squareup.com`                | Acceso completo. Límites por transacción y totales, ventanas, `AUTO_DETECT`.                                              |
| `github.com/odoo/odoo`, `mergebot.odoo.com`, foro de Odoo    | Acceso completo. `sync_from_ui`, IndexedDB, y la lista de bugs de reconciliación.                                         |
| `www.odoo.com/documentation/19.0/.../offline_mode.html`      | **Falló**: timeout en dos intentos. El modo offline _general_ de Odoo no es el del POS (su propia doc de POS los separa). |
| `polotab.com` (soporte)                                      | Acceso completo al centro de soporte. El blog devolvió error de acceso y se descartó.                                     |
| `fu.do`, `soporte.fu.do`                                     | Acceso completo. La FAQ y los artículos de terminal dicen lo contrario de "offline".                                      |
| `softrestaurant.com/docs`, `softrestaurant.zohodesk.com`     | Acceso completo a la ficha técnica de CLOUD y a la KB.                                                                    |
| `softrestaurant.doctorpyme.mx` (distribuidor)                | Acceso completo, **tercero**: se usa solo para el dato de 2 días, etiquetado como tal.                                    |
| Comparativas de terceros (posdata, scrampi, comparasoftware) | Leídas como contexto, **no** como evidencia.                                                                              |

## 8. Fuentes

**Toast** — [Offline mode with local sync](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html) ·
[Offline payments overview](https://doc.toasttab.com/doc/platformguide/platformOfflinePaymentsOverview.html) ·
[Use Toast in Offline Mode](https://support.toasttab.com/en/article/Using-Toast-in-Offline-Mode)

**Lightspeed** — [Offline POS functionality (K-Series)](https://k-series-support.lightspeedhq.com/hc/en-us/articles/53028167251867-Offline-POS-functionality)

**Square** — [Process offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode) ·
[View offline payments](https://squareup.com/help/us/en/article/8551-view-offline-payments) ·
[Mobile Payments SDK — offline payments](https://developer.squareup.com/docs/mobile-payments-sdk/android/offline-payments)

**Odoo** — [point_of_sale README](https://github.com/odoo/odoo/blob/20.0/addons/point_of_sale/README.md) ·
[mecanismo del modo offline (foro)](https://www.odoo.com/forum/help-1/what-s-the-mechanism-of-pos-offline-283217) ·
[issue #189836](https://github.com/odoo/odoo/issues/189836) ·
[PR 273504](https://mergebot.odoo.com/odoo/odoo/pull/273504)

**PoloTab** — [¿Mi equipo funciona sin internet?](https://www.polotab.com/soporte/mi-equipo-funciona-sin-internet) ·
[¿Cómo se conecta el hardware?](https://www.polotab.com/soporte/como-se-conecta-el-hardware)

**Fudo** — [Preguntas frecuentes](https://fu.do/es/preguntas-frecuentes/) ·
[¿Se necesita Internet para usar el sistema?](https://soporte.fu.do/es/articles/11731008-se-necesita-internet-para-poder-usar-el-sistema) ·
[Terminal MX: modo vinculado](https://soporte.fu.do/es/articles/15019239-terminal-de-fudo-mx-como-usar-el-modo-vinculado-para-cobrar-desde-la-web)

**Soft Restaurant** — [Ficha técnica CLOUD](https://softrestaurant.com/docs?download=206:ficha-tecnica-soft-restaurant-cloud) ·
[Sincronización de sucursales (Enterprise)](https://softrestaurant.zohodesk.com/portal/es/kb/articles/sincronizaci%C3%B3n-de-sucursales-con-la-central-en-soft-restaurant-enterprise) ·
[Doctor Pyme (distribuidor)](https://softrestaurant.doctorpyme.mx/)

**Pasadas previas que este documento no repite** — [Latencia y hub local (2026-10-14)](../2026-10-14-pos-latencia-hub-local/README.md) ·
[Matriz de funciones: Fudo, Soft Restaurant, Clover (2026-09-15)](../2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md)
