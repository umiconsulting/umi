# Plan: la operación integrada

_Plan · 2026-10-07 · de "el POS funciona" a "el paquete trabaja solo"_

**Estado:** **F1–F6 construidas.** F1–F4 y F6 están verificadas; de F5 está verificada la
parte que es código —el fallo del cajón visible en el momento— y quedan la dirección
reservada y la prueba de 9100, que son trabajo de sitio. Rama `feat/pos-fired-order-contract`.
Ver §8.2.1.
**Alcance:** el paquete físico de ONCA (till iMin, dos tablets, impresora, red TP-Link),
su operación real, y lo que la plataforma necesita para sostenerla.
**Cómo leerlo:** §1 y §2 son el estado; §3 es la investigación que lo sostiene; §4 razona;
§5–§7 son el modelo; §8 es lo que se construye, en orden. Si sólo tienes cinco minutos,
lee §1, §4 y §8.

---

## 1. Contexto: dónde estamos

### 1.1 Lo que ya funciona, verificado en el fierro

El paquete dejó de ser una caja de hardware. Hoy, verificado en la tablet real y no en un
test:

| Pieza                     | Estado                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| La tablet se enrola       | Sí. Enrolada y `active`, con credencial y llave del keystore                                                      |
| Login de operador por PIN | Sí. Identifica al operador y carga **sus** permisos                                                               |
| El KDS                    | Sí. Vive dentro del POS, pestaña _Cocina_, con _Comandas_ y _Preparación_                                         |
| El menú                   | Sí, y presentable: 3 categorías con color, 51 productos, **variantes** Caliente/Frío/Nube, nota, cantidad y curso |
| El carrito                | Sí: tipo de orden (Comer aquí / Para llevar), cliente, totales, fecha operativa                                   |
| Permisos por rol          | Sí, y se ven trabajando: a un rol sin `catalog.read` el catálogo se le bloquea                                    |
| Cambiar de operador       | **Arreglado hoy.** Antes bloqueaba el turno y caía al PIN                                                         |

### 1.2 Lo que existe del lado servidor y todavía no tiene puerta

La feature de **disparar a cocina sin cobrar** está construida de punta a punta menos el
botón: la migración que le da columna y permiso, el contrato, la ruta y su controlador, el
servicio, el repositorio y las pruebas. Lo que falta es la superficie en el POS — y por eso
no se ha podido probar end-to-end: sin botón no hay forma de ejecutarla en el dispositivo, y
desde fuera no se puede, porque el `installationId` vive cifrado con el keystore.

### 1.3 Los entornos

| Entorno             | Base                    | Esquema     | Migraciones aplicadas |
| ------------------- | ----------------------- | ----------- | --------------------- |
| Local (`umi_local`) | 4003                    | build-v3-79 | 001–004               |
| Staging             | `umi_staging` en el VPS | build-v3-79 | 001–004               |
| Producción          | Supabase                | build-v3-79 | 001 y 003             |

Producción **no** tiene la 004: es la última parada y la feature no está viva. Y quedó
demostrado que mergear a `main` no despliega si el cambio no toca código de app — el
workflow está filtrado por rutas — así que una migración nunca entra sola.

### 1.4 Dónde vive el trabajo

`feat/pos-fired-order-contract`, empujada, **sin PR**: tiene la feature de disparo a medias
(falta el botón) y el arreglo del cambio de operador, que sí está completo. La rama del
worktree de builds quedó limpia; `main` y `staging` están al día y sincronizadas entre sí.

---

## 2. Auditoría: el punto exacto en el que estamos

### 2.1 Lo que la sesión de comisión encontró

Ocho hallazgos, todos con evidencia reproducible, en orden de gravedad:

| #   | Hallazgo                                                | Evidencia                                                                                                                      | Estado                                             |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 1   | Cambiar de operador bloqueaba el turno                  | `_reauthIfSessionLost` trataba `PERMISSION_DENIED` como sesión perdida; se reprodujo **con un rol que tenía los 145 permisos** | **Arreglado y verificado**                         |
| 2   | El API no distinguía sesión muerta de hueco de rol      | `authorize` devolvía un booleano; ambos casos daban 403                                                                        | **Arreglado** (devuelve los permisos de la sesión) |
| 3   | El log de rechazos no decía la ruta                     | Once `403 code=PERMISSION_DENIED` sin URL; el comentario afirmaba que la ruta estaba                                           | **Arreglado**                                      |
| 4   | Un cocinero aterriza en el catálogo con error rojo      | Captura: banner "No fue posible completar la acción de venta de forma segura"                                                  | **Arreglado** (F1)                                 |
| 5   | Un mesero, igual — y su rol no puede crear venta        | Captura con _Mesero 1_                                                                                                         | **Arreglado** (F1)                                 |
| 6   | Las siete pestañas se muestran a todos los roles        | Captura: Comanda, Caja, Ventas, Mesas, Cocina, Pedidos, Ajustes                                                                | **Arreglado** (F1)                                 |
| 7   | Un rechazo de permiso pinta "Conexión inestable"        | El controlador cuenta un 403 legítimo como fallo de red                                                                        | **Arreglado**                                      |
| 8   | Overflow de 137 px en el carrito con el teclado abierto | Franja de debug en la captura                                                                                                  | **Arreglado**                                      |

Y un hallazgo de infraestructura que no es de la app: **`offline/replay/begin` se llama al
arrancar**, así que un rol sin `offline.replay` no puede abrir el turno. Es una dependencia
de arranque disfrazada de permiso "offline".

### 2.2 Los primitivos que ya existen

El catálogo tiene **145 permisos**, y la auditoría de la sesión anterior mostró que para los
cuatro roles de café que ONCA necesita **ya existen casi todos**: barista 4/4, cocina 4/4,
cajero 21/21 — y el único que faltaba, el del mesero, ya no falta porque el disparo se
implementó como `order.fire`.

Los grupos con sustancia son: `cart` (1), `checkout` (6), `cash` (15), `sale` (14),
`loyalty` (9), `customer` (9), `kitchen` (11), `inventory` (30), `hardware` (14),
`offline` (3), `order` (1, el nuevo).

Eso importa: **el sistema no está corto de primitivos; está corto de composición.** Los
permisos existen, los roles de café son configurables por el dueño, y lo que falta es que la
superficie respete lo que el rol permite.

### 2.3 Un hueco de plataforma que apareció al buscar el otro

Buscando dónde probar el disparo contra una base, salió algo más grande: **el job de CI que
corre las suites de integración construye el esquema con `00_run.sh` y nunca aplica las
migraciones.** Post-corte, "build prístino" dejó de ser el esquema que la app espera — cada
feature que agrega una columna llega como archivo en `migrations/`, y el código se escribe
contra el resultado.

Estuvo invisible hasta que dejó de estarlo: la 004 agrega `pos_cart.fired_order_id`, el
repositorio del carrito lo referencia en cuanto el archivo existe en el árbol, y **seis
pruebas de `pos-offline` más cada sentencia del preflight SQL fallaron** con "la columna no
existe" contra un build que jamás había aplicado el archivo.

Medido, no supuesto: base nueva **sin** migraciones → 6 fallos y preflight rojo. Base nueva
**con** las cuatro → **231 pruebas en 28 archivos, todas verdes**. Y un detalle que costó una
hora: los fallos que quedaban después eran **contaminación de mis propias repeticiones** —la
suite de `table-state` no limpia `ended_at` en su upsert, así que correrla muchas veces en la
misma base viola `operator_session_end_ck`—, no la migración. Ese es el tipo de falsa alarma
que el propio comentario del test advierte.

**Arreglado**: el job aplica las migraciones una vez, antes de los instrumentos. El paso que
las aplica dos veces sigue abajo, y ahora prueba además el caso que importa: que un archivo
ya aplicado sea inofensivo al repetirse.

### 2.4 La topología real del paquete

```
        [ Internet ]
             │
        [ Archer C50 ]  ← la red del paquete; hoy se llama TP-Link_AE61
         ┌───┼────────────┬──────────────┐
     iMin D3-504     Tab A11        Tab A9+      Epson TM-T20III
     (caja + cajón)  (comandera)    (KDS)         (recibos y pulso del cajón)
```

Ningún aparato es independiente: todos hablan con el API por el WAN, y la impresora —que es
también el camino del cajón— es lo único que vive enteramente en la LAN.

---

## 3. Research

### 3.1 La competencia, y qué hace distinto

Ya está investigada con fuentes primarias; el resumen operativo:

| Vendor                                | Tipo de dispositivo                       | Mandar a cocina sin cobrar                                     | Cómo recorta el tablero                       |
| ------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| **Parrot** (el sistema que ONCA dejó) | Principal / Secundario, lo elige un admin | Tipo de orden "Comer aquí" → _Enviar a cocina_                 | Áreas de cocina asignadas a una salida        |
| **SoftRestaurant**                    | Comandero Móvil Android                   | "levantar las comandas desde la mesa y enviarlas a producción" | —                                             |
| **Fudo**                              | App móvil con mapa de mesas               | Sección KDS + tickets de comandas                              | —                                             |
| **Square**                            | Device codes: Prep o Expeditor            | Open tickets, habilitados **por modo**                         | Prep ve sólo lo suyo; ruteo por POS de origen |
| **Toast**                             | Primary Mode del dispositivo              | Table Service / Quick Order mode                               | Prep station por dispositivo                  |

La conclusión transversal, y es la que gobierna §7: **el rol del aparato es una propiedad
administrada por el servidor; el login sólo dice quién; y las capacidades se acotan por
permiso.** Nuestro propio ADR de kiosco ya lo había concluido y esta sesión lo volvió a
confirmar por el camino caro.

Y una segunda, que es específica de este cliente: **Parrot resolvía la resiliencia con un
"POS principal" como maestro en la red local**, con los secundarios sincronizando contra su
IP. ONCA ya vivía así, con su gente ya entrenada en ese modelo.

### 3.2 Nuestra documentación interna

No hay que inventar casi nada; hay que **conectar**. Lo pertinente, en orden de utilidad
para este plan:

| Documento                                                                          | Para qué sirve aquí                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `docs/research/2026-09-06-restaurant-pos-kds-feature-inventory-research.md`        | El inventario de funcionalidad con fuentes; distingue "quick service" de "servicio de mesa" |
| `docs/research/2026-09-06-pos-kiosk-and-device-role-boundaries-research.md`        | El modelo de dos capas, con Toast y Square citados                                          |
| `docs/research/2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md` | La matriz por capacidad, con Fudo, SoftRestaurant y Clover                                  |
| `docs/research/2026-09-05-pos-cashier-kitchen-action-volume-research.md`           | Qué acciones existen y con qué frecuencia                                                   |
| `docs/research/2026-09-18-inventory-operator-evidence.md`                          | Evidencia de operador para inventario                                                       |
| `docs/product/UMIPOS_CASOS_DE_USO_Y_ROLES.md`                                      | Los casos de uso por rol que ya escribimos                                                  |
| `docs/product/UMIPOS_KDS_OPERATIONAL_MODEL.md`                                     | El modelo operativo del KDS                                                                 |
| `docs/product/UMIPOS_OFFLINE_COMMAND_POLICY.md`                                    | Qué se puede y qué no offline                                                               |
| `docs/architecture/2026-09-13-pos-channel-attribution-adr.md`                      | El seam de `origin_order_id` que el disparo reutiliza                                       |
| `docs/architecture/2026-10-07-pos-fired-order-adr.md`                              | La decisión de disparo, y su §3.2                                                           |
| `docs/pilot/ONCA_MENU_TO_UMI_MAPPING.md` · `ONCA_OFFLINE_FIRST_DESIGN.md`          | El mapeo del menú y el diseño offline-first de este cliente                                 |

### 3.3 Ingeniería académica y de factores humanos

Lo que aplica, sin adornos:

- **La ley de Fitts y la banda alcanzable.** Ya está en
  `2026-09-05-pos-ux-design-principles.md`: en una terminal fija la banda cómoda es la parte
  baja y las dos esquinas inferiores; en una comandera es el arco del pulgar. La consecuencia
  de diseño es que **la acción primaria va en la banda alcanzable y la rara en el borde**.
- **Reducir toques por orden es la métrica que manda.** La industria del café lo dice en sus
  propios términos: el flujo de trabajo "abarca todo, desde cómo se mueven los baristas
  detrás de la barra hasta la posición de herramientas y ingredientes"
  ([Perfect Daily Grind](https://perfectdailygrind.com/2026/02/why-coffee-shops-should-reevaluate-barista-workflow/)),
  y la automatización existe para sacar de en medio las tareas repetitivas. Cada toque que le
  quitamos a un pedido es tiempo de barra devuelto.
- **Teoría de colas aplicada a la barra:** lo que importa no es el promedio sino la
  **variabilidad de llegada**. Nuestros datos de ONCA (§3.5) muestran una llegada en pico de
  ~20 órdenes por hora: el sistema tiene que ser rápido en el peor minuto, no en el promedio.
- **El "bump" como evento, no como pantalla.** La literatura de cocina profesional y los
  propios contratos de los vendors tratan el avance de un ticket como un evento con
  identidad, que es exactamente lo que nuestro `order_event` con `sequence` ya modela.

### 3.4 Casos de éxito de negocio

- **Casa Elena** —referido por el propio material de Parrot— empezó con una cafetería y hoy
  tiene un restaurante de servicio completo. Es el caso de negocio de este mismo paquete:
  un café que crece a restaurante, con el mismo sistema.
- **La forma del producto en los líderes**: Toast fusiona POS + handheld + kiosco + KDS en
  un binario y vende "modos"; Square separa el KDS en otra app. **Los dos llegaron al mismo
  lugar por caminos opuestos, y los dos terminaron recortando por dispositivo.**
- **La lección comercial**: lo que retiene a un café no es el POS, es **la lealtad y la
  caja**. Es lo que Umi ya vende; el POS es la puerta que hace que el resto se use.

### 3.5 La operación real: las acciones físicas de este café

Esto es lo más valioso del research, y no viene de un artículo: viene de la base del POS que
ONCA usaba, recuperada del dispositivo. **121 órdenes, 82 eventos de cajón, 3 cierres**, entre
el 1 y el 5 de octubre.

**Cuándo trabajan.** Llegadas por hora: 08h:1, 09h:5, 10h:14, **11h:20, 12h:20, 13h:20**,
14h:17, 15h:9, 16h:4, 17h:4, 18h:3, 19h:4. Un pico de media mañana, no de tarde.

**Dónde entregan.** `Pedido` 112, `Llevar` 7, **`Jardín` 2**. El destino es parte de la
orden, y hay un jardín.

**Cómo cobran.** Efectivo 57, tarjeta 41, transferencia 3 — y **20 órdenes sin método**: se
quedaron pendientes. El efectivo seguía siendo la mayoría.

**Qué se cancela.** De 17 cancelaciones, **16 tienen por razón "prueba"** ("prueba", "Prueba",
"Prueba 2", "PRUEB 2"). Sólo una es real ("Cambio"). La operación real casi no cancelaba:
lo que ensucia el historial son las pruebas del personal.

**El cajón.** 82 eventos en tres días: 75 con señal enviada, **7 con "falló señal"**, todas
el 2 de octubre entre 09:13 y 09:51. El cajón estuvo caído 38 minutos en plena mañana. Y las
razones que la gente escribe son un mapa de la operación real: `Cobro en efectivo #N`,
`Retiro #N`, `abrir`, **`Comanda`**, `cierre`, `Feria` — y basura tipeada: `J`, `j`, `Fgf`,
`F`, `G`, `T`, `X`, `dd`, `Y`.

**Dos señales que valen sola una decisión cada una:**

1. **`Comanda` como razón de apertura del cajón.** El pulso del cajón y la comanda salen por
   el mismo puerto de la impresora. La operación lo usaba como una sola acción física.
2. **`drinks_ready` tiene 27 filas y `pizzas_ready` tiene CERO.** El "listo" sólo se usó para
   bebidas; la estación de pizzas nunca marcó nada. O nadie las marcaba, o la pantalla de
   pizzas no se usaba.

**Lo que se retira del cajón.** `Renta` $1,000 (dos veces), `COMIDA` $450, `Tort` $29. Es
dinero que sale y que alguien tiene que justificar.

---

## 4. Razonamiento integral

Juntando §2 y §3, salen cinco conclusiones. Cada una tiene su consecuencia en §7.

**1. Lo que falta no son permisos, es composición.** El catálogo tiene 145 primitivos y
cuatro roles bastan para la operación. El problema es que la superficie no escucha al rol:
un cocinero ve siete pestañas y aterriza en una pantalla que le va a fallar. **La primera
inversión es que la app se vea como el rol que entró.**

**2. La operación real es más chica y más específica que la teoría.** El café sirve de 8 a 7,
con el pico entre 11 y 14; entrega en el mostrador, siete veces para llevar y dos al jardín;
cobra sobre todo en efectivo con tarjeta muy cerca; y casi no cancela. Cada generalidad que
construyamos para "el restaurante promedio" es complejidad que este cliente no usa.

**3. El hardware es frágil y hay que tratarlo así.** Siete fallos de señal de cajón en una
mañana, y la comanda compartiendo el mismo puerto. **La impresora es el punto único de falla
de que salga dinero del cajón y de que salga la comanda** — por eso su dirección reservada
importa más que cualquier otra de la red, y por eso el modo de fallo tiene que ser visible
para el cajero en el momento, no un log.

**4. El cliente ya vivía un modelo que nosotros no tenemos.** Parrot tenía un POS principal
como maestro local. Nosotros dependemos del WAN para todo menos imprimir. No vamos a
construir un maestro local ahora, pero **sí tenemos que decir en voz alta qué se pierde**, y
qué operación de papel lo sustituye mientras tanto.

**5. La disciplina de datos del cliente es la de un negocio en pruebas.** Dieciséis de
diecisiete cancelaciones dicen "prueba". Cualquier métrica que construyamos sobre ese
histórico miente. Es un argumento directo para el principio que ya aplicamos: los datos de
prueba no entran a producción, y una cancelación pide una razón tipada, no texto libre.

---

## 5. Spec-based: cómo se arma desde los primitivos

La regla que ya usamos y que este plan confirma: **los primitivos primero, los roles después,
los usuarios al final.** El orden no es ceremonia — es que un rol sin primitivo que lo
sostenga es una promesa vacía, y un usuario sin rol no hace nada.

### 5.1 Los tres ejes que hay que separar

| Eje                   | Qué responde                    | Dónde vive                  | Estado                                                  |
| --------------------- | ------------------------------- | --------------------------- | ------------------------------------------------------- |
| **Permiso**           | ¿Puede esta persona hacer esto? | sesión del operador (SQL)   | Existe y funciona                                       |
| **Forma de la orden** | ¿Cobramos ahora o después?      | la orden (tipo de orden)    | A medias: `order.fire` existe, el tipo en el carrito no |
| **Rol del aparato**   | ¿Qué superficie muestra?        | el registro del dispositivo | Existe como etiqueta, **nadie lo lee**                  |

Los tres son ortogonales, y confundirlos es lo que produjo los bugs de esta semana.

### 5.2 Los roles de ONCA, compuestos desde los primitivos

```
cocina   = kitchen.read + kitchen.prepare + kitchen.ready + kitchen.priority
barista  = igual que cocina (hoy; la diferencia por estación es del aparato, no del rol)
cajero   = cart.write + checkout.commit + order.fire + cash.*  + sale.* + loyalty.* + customer.* + hardware.*
mesero   = cart.write + order.fire + customer.search/read/attach + loyalty.read
```

Las cuatro ya existen en la base local, con sus operadores y PIN.

### 5.3 Lo que falta es un primitivo de orden, no de cocina

`order.fire` ya está. Lo que sigue en el eje de la forma es **el tipo de orden en el carrito**
(`Comer aquí` / `Para llevar` / `Domicilio`), que es lo que decide si el flujo pide cobro
antes o después — y es exactamente lo que la UI ya muestra en la barra superior sin que el
servidor lo sepa.

---

## 6. Capas de integración

La cadena completa, de abajo hacia arriba, con la costura de cada salto:

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1 · RED          Archer C50 · la LAN del paquete · reservas por MAC  │
├──────────────────────────────────────────────────────────────────────┤
│ 2 · APARATO      merchant.device · kind · mobility · estación        │  ← el rol del aparato vive aquí
├──────────────────────────────────────────────────────────────────────┤
│ 3 · SUPERFICIE   qué pestaña se muestra, según permiso + aparato      │  ← el hueco de esta semana
├──────────────────────────────────────────────────────────────────────┤
│ 4 · SESIÓN       runtime.operator_session · permisos congelados      │
├──────────────────────────────────────────────────────────────────────┤
│ 5 · ORDEN        tipo de orden · pos_cart · fired_order_id           │  ← el disparo
├──────────────────────────────────────────────────────────────────────┤
│ 6 · COCINA       customer_order → cocina, por estación y curso       │
├──────────────────────────────────────────────────────────────────────┤
│ 7 · DINERO       checkout · turno de caja · lealtad                  │
└──────────────────────────────────────────────────────────────────────┘
```

Las tres costuras que importan y hoy están flojas:

- **2→3**: el rol del aparato no influye en la superficie.
- **3→4**: la superficie se ofrece completa y el permiso la niega puertas adentro, en vez de
  no ofrecerla. Es lo que produce el banner rojo.
- **5→6**: el disparo existe; la superficie para disparar no.

---

## 7. Lógica y arquitectura: las decisiones

**D1 — La superficie se deriva del rol, y el aparato la acota.** Una pestaña se ofrece sólo
si el operador tiene el permiso que la sostiene. Un cocinero ve _Cocina_; si su rol no puede
vender, no ve _Comanda_ ni _Caja_, y **no se le pide crear una venta al entrar**. Es la
primera decisión porque es la que más gente toca a diario.

**D2 — Una negación nunca cierra sesión.** Ya está arreglado: 401 para "no hay sesión viva",
403 para "tu rol no puede". Se generaliza a toda superficie nueva.

**D3 — El disparo es una acción de la orden, no de la cocina.** Ya está. Lo que se agrega es
su puerta: un botón en la banda alcanzable, sólo si el rol tiene `order.fire`, y un estado
visible de "ya se mandó".

**D4 — El carrito se congela al disparar.** El carrito acepta **agregar** líneas y sigue
negando la edición de lo que la cocina ya tiene; la segunda ronda existe y es una comanda que
crece (ver §8.2.1 F6).

**D5 — El tipo de orden es un dato de la orden, no un permiso.** `Comer aquí` y `Para llevar`
ya se ven en la UI; el servidor tiene que saberlo para decidir el flujo y para los reportes.

**D6 — Lo que el aparato es, lo dice el servidor.** `kind` ya existe y nadie lo lee. El
primer uso es honesto y barato: que el POS no ofrezca la superficie de venta en un aparato
marcado como KDS, aunque el operador pueda vender. Es la mitad del modelo de dos capas, y la
otra mitad ya funciona.

**D7 — No construimos un maestro local todavía.** Se documenta lo que se pierde y el
procedimiento de papel, y se deja como decisión explícita para cuando el volumen lo pida.

---

## 8. Ingeniería e implementación

### 8.1 La regla de decisión

Toda decisión de diseño se juzga por tres cosas, **en este orden**:

1. **Experiencia del usuario** — la persona de pie frente al aparato, con las manos ocupadas.
2. **Experiencia del agente** — el bot y el asistente que operan sobre el mismo modelo.
3. **Experiencia del desarrollador** — quien lo mantiene.

Si una decisión mejora dos y empeora la primera, se descarta. Ejemplo reciente: separar la
columna del disparo de la de origen mejora la del desarrollador (menos ambigüedad) **y**
evita que la barra prepare dos veces, que es del usuario.

### 8.2 Las fases, en orden de valor

| Fase                                     | Qué entrega                                                                                     | Por qué ahora                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **F1 · La app se ve como el rol**        | Pestañas filtradas, superficie de aterrizaje, sin pedir venta a quien no vende, sin banner rojo | Es lo que hoy hace que un turno se vea roto. D1–D2                     |
| **F2 · El botón de disparar**            | `Enviar a cocina` en la banda alcanzable, con estado visible                                    | Cierra el end-to-end de la feature que ya está construida              |
| **F3 · El tipo de orden en el servidor** | `Comer aquí` / `Para llevar` como dato de la orden                                              | Lo que la UI ya muestra, y sin eso ni el flujo ni los reportes cuadran |
| **F4 · El aparato declara lo que es**    | El POS no ofrece venta en un aparato KDS                                                        | La mitad que falta del modelo de dos capas                             |
| **F5 · La impresora, de primera clase**  | Dirección reservada, prueba de 9100, y el fallo del cajón visible en el momento                 | Los 7 fallos de señal del 2 de octubre                                 |
| **F6 · La segunda ronda**                | Artículos agregados después del disparo                                                         | Levanta D4, con diseño propio                                          |

### 8.2.1 Progreso

**F1 · La app se ve como el rol — construida y verificada (2026-10-07).**

La superficie se deriva del rol y el aparato la acota (D1), y una negación nunca cierra
sesión (D2, ya estaba). Lo que cambió:

- La pestaña lleva el permiso que la sostiene: `cart.write` para `Comanda` y `Pedidos`,
  `cash.shift.read` para `Caja`, `sale.lifecycle` para `Ventas` y `Mesas`, y
  `kitchen.read`/`kitchen.prepare` para `Cocina`. Un rol sin el permiso no ve la pestaña
  (hallazgo 6: las siete se mostraban a todos y la mayoría no hacía nada al tocarla).
- El aterrizaje sigue al rol. El vendedor aterriza en `Comanda`. El cocinero aterriza en
  `Cocina`, que el shell monta como su propio cuerpo bajo la barra de pestañas.
  Cualquier otra composición aterriza en una portada con las pestañas que sí tiene.
- Un rol sin `cart.write` ya no abre el catálogo, ni el ciclo de venta detrás de él, ni el
  `offline/replay/begin` del arranque. Esas llamadas producían el 403 que el shell pintaba
  como banner rojo (hallazgos 4, 5 y 7) y la dependencia de arranque disfrazada de permiso
  offline (§2.1).

Evidencia: `apps/umi-pos/test/role_surface_test.dart` monta el mismo `CatalogSurface` que
la app monta y comprueba los dos casos —un vendedor ve `Comanda`, `Caja` y `Ventas`; un
cocinero aterriza en el tablero y no ve `Comanda` ni `Caja`—; y
`apps/umi-pos/test/operator_permissions_test.dart` fija la composición de superficies y el
aterrizaje. La suite completa de UmiPOS pasa (**463 pruebas, todas verdes**) y
`flutter analyze` queda limpio.

**F2 · El botón de disparar — construida y verificada (2026-10-07).**

`Enviar a cocina` vive en el panel del carrito, junto a las acciones de la orden, y sólo
aparece con `order.fire` (D3). Manda la comanda sin cobrar, muestra la referencia que el
operador lee al cocinero, y deja el carrito marcado: el botón se vuelve el estado "Enviada a
cocina" y los controles de línea y el vaciado se apagan, porque el servidor congela el
carrito al disparar (D4). El cobro sigue vivo: liquida el pedido disparado en su lugar.

Lo que hizo falta en la plataforma: el carrito ahora lleva `firedOrderId` en su vista
(`Cart`, contrato **2.24.0**). Sin eso, "ya se mandó" sería memoria del cliente y no un hecho
de la vista — un reinicio ofrecería un segundo disparo que el servidor contesta
`already_fired`.

Evidencia: `apps/umi-pos/test/cart_test.dart` (el disparo manda el carrito, lo relee y lo
marca; un disparo rechazado conserva el carrito y reporta el código),
`apps/umi-pos/test/role_surface_test.dart` (el botón existe, se toca y se vuelve el marcador)
y `apps/umi-api/src/modules/pos-cart/pos-cart.repository.spec.ts` (la vista lee
`fired_order_id`). Suites: UmiPOS **466 pruebas** y `@umi/api` **1740 pruebas**, todas
verdes; el contrato se regeneró a 2.24.0 y `generate:check` pasa; `flutter analyze` y
`tsc --noEmit` quedan limpios.

**F3 · El tipo de orden en el servidor — construida y verificada (2026-10-07).**

La UI ya mostraba `Comer aquí` / `Para llevar` en la barra superior, pero el servidor no lo
sabía: el disparo y el cobro escribían `fulfillment_type = 'dine_in'` como constante, así que
**toda venta para llevar llegaba a la orden y a los reportes como comida en el local**. El
tipo de orden es ahora un dato del carrito (D5): la migración `005` agrega
`pos_cart.fulfillment_type` con valor por omisión `dine_in` y un CHECK que sólo admite
`dine_in` o `takeout` — los dos tipos que este cliente usa, sin `Domicilio` (§9). La ruta
`POST /cart/fulfillment` (permiso `cart.write`) fija el dato, y el disparo y el cobro lo
leen del carrito en vez de asumirlo.

Evidencia de la migración, contra una base recién construida en este equipo: se aplicó sobre
una tabla **con una fila** y la fila existente quedó en `dine_in`; una **segunda aplicación**
no hace nada (`column already exists, skipping`); el CHECK acepta `takeout` y **rechaza**
`delivery` (`pos_cart_fulfillment_type_check`). Evidencia del resto:
`apps/umi-pos/test/role_surface_test.dart` (la elección de la barra superior llega al
carrito), `apps/umi-pos/test/cart_test.dart` (el tipo es un dato del carrito, se fija una
vez) y `apps/umi-api/src/modules/pos-cart/pos-cart.repository.spec.ts` (la vista lee
`fulfillment_type`; el dato se fija sólo mientras el carrito no está disparado). Suites:
UmiPOS **468 pruebas** y `@umi/api` **1745 pruebas**, todas verdes; el contrato se regeneró a
**2.25.0** y `generate:check` pasa; `flutter analyze` y `tsc --noEmit` quedan limpios.

**F4 · El aparato declara lo que es — construida y verificada (2026-10-07).**

El registro del aparato ya decía `type: pos_terminal | kds`, y nadie lo leía. Ahora la
superficie lo lee (D6): un aparato que el dueño marcó como KDS muestra **Cocina**, no la caja,
**aunque el operador pueda vender**. El aparato no decide por su cuenta — el servidor dice qué
es, y el cliente presenta. Es la mitad que faltaba del modelo de dos capas; la otra mitad
(`order.fire`) ya estaba.

Evidencia: `apps/umi-pos/test/operator_permissions_test.dart` fija la decisión —el mismo
operador vendedor ve la venta en el till y no la ve en el KDS— y
`apps/umi-pos/test/role_surface_test.dart` monta el shell con un aparato realmente enrolado
como KDS (el mismo camino que la app: `initialize` + PIN) y comprueba que no ve `Comanda` ni
`Caja` aunque su rol las sostenga. La suite de UmiPOS pasa (**470 pruebas, todas verdes**) y
`flutter analyze` queda limpio.

**F5 · La impresora, de primera clase — la parte de código, construida y verificada (2026-10-07).**

El hallazgo era que el pulso del cajón y la comanda salen por el mismo puerto, y que un fallo
del cajón quedaba en un log. Ya no: al cerrar una venta, el POS corre el hardware y **mira si
el cajón respondió**; si no, el recibo que el cajero está viendo lleva el aviso —"El cajón no
respondió. La operación quedó registrada; ábrelo a mano y avisa al encargado"— la misma frase
que el centro de caja ya usa para el mismo hecho. El dinero está bien en ambos casos; lo que
falla es la señal que abre el cajón, y el cajero no tiene otra forma de enterarse.

El resto de F5 es trabajo de sitio, no de código: la **dirección reservada** del paquete (una
reserva DHCP por MAC en el Archer C50) y la **prueba de 9100** sobre la Epson real. La
superficie que las ejecuta ya existe (el alta de la impresora con host y puerto 9100, y la
"Ejecutar prueba" que despacha `printer_test_page`); lo que falta es el fierro.

**Hallazgo del 2026-10-07, con el fierro en la mano.** La Epson **no tiene Ethernet**: es la
variante **USB + serial**, y el puerto que la foto leyó como RJ45 es el **DK** del cajón
(RJ12, mismo formato y más angosto; el aparato lo dice). Importa porque UmiPOS imprime **sólo
por TCP** —los adaptadores arman un transporte de red, y los transportes `Usb…` y `Serial…`
del runtime están declarados y **sin implementar**—, así que una impresora colgada por USB se
ve pero no se maneja: ni recibo, ni pulso del cajón. La impresora llega a la LAN con un
**puente serial → Ethernet** (TCP crudo, puerto 9100) sobre su DB9, o se cambia por la
variante Ethernet del T20III. El cajón no cambia: sigue en el DK. Queda corregido en
`docs/pilot/UMIPOS_SITE_DEVICE_INVENTORY.md` §2.4.

**Y el banco de trabajo la dejó verificada (2026-10-07).** Con la impresora en un PC por USB:
se anuncia como **`04b8:0e27` Seiko Epson TM-T20IIIL** —variante latinoamericana, no la
`TM-T20III` que decía la etiqueta— y se presenta con **una sola interfaz USB de clase
impresora** (bulk OUT `0x01`), que el kernel enlaza como `/dev/usb/lp0`. Se identifica por el
cable con `GS I 'C'` → `_TM-T20IIIL`; responde estado con `DLE EOT` (`16 16 12 12`: en línea,
tapa cerrada, sin errores, papel presente). **Los bytes que arma la app imprimen y cortan**
—incluido el acento en CP850—, y **48 caracteres caben exactos** en el ancho de papel: 80 mm,
fuente A, 48 columnas. Eso cierra dos incógnitas del plan: el **ancho de papel** y el **juego
de caracteres**, que ya eran correctos. El panel de la app trae `receiptWidthColumns: 42`; son
seis columnas conservadoras, y conviene poner 48 al registrar esta impresora.

Evidencia: `apps/umi-pos/test/checkout_test.dart` (un cajón que no respondió deja el aviso en
la venta completada) y `apps/umi-pos/test/hardware_service_test.dart` (el servicio reporta
`drawerAnswered` junto con los resultados del hardware). La suite de UmiPOS pasa (**471
pruebas, todas verdes**) y `flutter analyze` queda limpio.

**F6 · La segunda ronda — construida y verificada (2026-10-07).**

Levanta la congelación de D4 sin reintroducir el defecto que la congelación evitaba. El
carrito disparado **acepta líneas nuevas**; las que ya tiene la cocina siguen negando la
edición. Disparar otra vez manda **sólo lo que la cocina no tiene** y lo agrega a la orden y
al ticket que el carrito ya posee — una comanda que crece, no una segunda comanda.

La decisión que hace falta es la fusión. `identity_key` junta dos cafés iguales en una línea
con cantidad 2, y eso es correcto mientras la línea es local: dejaría de serlo en cuanto la
línea ya está en el ticket, porque un segundo café se sumaría a la línea que la barra ya
preparó y la cantidad extra se cobraría sin llegar a la cocina — el mismo defecto, un nivel
más abajo. La migración `006` agrega `pos_cart_line.fired_at` y mueve la unicidad a un índice
parcial sobre las líneas **no enviadas**, así que un producto idéntico agregado después del
disparo es una línea nueva. La vista del carrito lleva `fired` por línea, y la segunda ronda
reutiliza la pieza que faltaba: `appendOrderItems` (líneas + evento `order_upserted`) y
`appendKitchenItems` (los artículos que faltan en el ticket, más un `order_updated`).

Evidencia de la migración, contra una base recién construida en este equipo: la fila de un
carrito ya disparado quedó marcada por el relleno; una **segunda aplicación** no hace nada; dos
líneas no enviadas con la misma `identity_key` chocan contra el índice parcial nuevo
(`pos_cart_line_unfired_identity_uidx`); y una línea enviada junto a una idéntica sin enviar
conviven —la segunda ronda—. Evidencia del resto:
`apps/umi-api/src/modules/pos-cart/pos-cart.repository.spec.ts` (el segundo disparo agrega a
la orden que el carrito ya posee y marca las líneas enviadas; sin nada nuevo responde
`already_fired`), `apps/umi-pos/test/cart_test.dart` (un carrito con una línea nueva manda
sólo esa) y `apps/umi-pos/test/role_surface_test.dart` (la línea enviada se marca y el botón
vuelve). Suites: UmiPOS **473 pruebas** y `@umi/api` **1750 pruebas**, todas verdes; el
contrato se regeneró a **2.26.0** y `generate:check` pasa; `flutter analyze` y `tsc --noEmit`
quedan limpios.

**Hallazgos 7 y 8 de §2.1 — arreglados (2026-10-07).**

El **7** era de clasificación: el arranque del catálogo contaba _cualquier_ error como fallo
de red, así que un 403 legítimo —el servidor contestó— pintaba "Conexión inestable". Ahora
usa el mismo vocabulario estrecho que el tablero de cocina: sólo `transport` y `timeout`
significan "no hubo respuesta"; lo demás llegó y contestó.

El **8** era de alto: con el teclado abierto, el carrito y el mensaje del catálogo desbordaban
su columna y dejaban la franja de debug encima de la venta. El panel del carrito y el mensaje
ruedan cuando el alto no alcanza, y las acciones quedan accesibles al desplazar.

Evidencia: `apps/umi-pos/test/cart_layout_test.dart` reproduce el hallazgo 8 —pantalla de
teléfono con el teclado arriba y un carrito de seis líneas— y comprueba que no hay overflow y
que el botón de enviar sigue alcanzable. La suite de UmiPOS pasa (**474 pruebas, todas
verdes**) y `flutter analyze` queda limpio.

**La cancelación pide razón tipada — construida y verificada (2026-10-07).**

La regla estaba escrita dos veces —§4 conclusión 5 y §8.3— y sin construir: el POS pedía la
razón en **texto libre**. La evidencia de §3.5 dice qué produce eso: de 17 cancelaciones, 16
decían "prueba". Ahora la razón es una elección de cuatro (`customer_changed`,
`operator_mistake`, `duplicate`, `other`) y la nota del operador es opcional y **nunca la
única** constancia. El contrato exige el código, la migración `007` agrega
`pos_cart.cancellation_reason_code` —sin relleno, porque el texto viejo no se puede
clasificar sin adivinar— y el diálogo no deja cancelar hasta que hay una razón elegida.

Evidencia: `packages/contract/test/pos-sale-cancel.test.mjs` (el texto libre solo no es una
razón, y un código inventado tampoco), `apps/umi-pos/test/sale_lifecycle_test.dart` (el
diálogo no cancela sin razón; el código viaja y una nota vacía queda nula) y
`apps/umi-api/src/modules/pos-sale/pos-sale.service.spec.ts`. La migración se aplicó sobre la
base local **poblada**: la segunda aplicación no hace nada y el CHECK rechaza `porque`.
Suites: UmiPOS **477 pruebas**, `@umi/api` **1753 pruebas** y contrato **83 pruebas**, todas
verdes; el contrato quedó en **2.27.0** y `generate:check` pasa.

### 8.3 Las reglas de ingeniería

- **Un seam, un test.** El arreglo del turno entró con dos pruebas que fijan la distinción
  401/403; el disparo con tres. Cada costura nueva lleva la suya.
- **La evidencia va en el log o no existe.** Se agregó la ruta al rechazo y el diagnóstico
  dejó de ser adivinanza. Aplica a lo que siga.
- **Ninguna superficie se ofrece sin el primitivo que la sostiene.** Es la misma regla que
  we aplicamos a las rutas que exigen un controlador vivo.
- **Los datos de prueba no entran a producción, y una cancelación pide razón tipada.** Es la
  lección de las 16 cancelaciones "prueba".
- **El aparato no decide lo que puede hacer.** El servidor autoriza; el cliente presenta.

### 8.3.1 El vocabulario del negocio es configuración, no modelo

Ya estaba decidido y hay que aplicarlo: la sección del catálogo en el esquema se llama
literalmente **`COMMERCE (generic — no "menu")`** (`20_merchant.sql`), y el análisis de
integración lo desarrolla separando **autoridad** (el dueño del negocio), **sistema de
registro** (el API/DB de Umi, siempre) e **interfaz** (el dashboard, el POS, una
sincronización externa — todos por el mismo API).

La app que ONCA usaba **no** hizo eso: sus tablas se llaman `drinks_ready`, `pizzas_ready`,
`drink_note`, `pizza_note`. Son columnas por oficio, y por eso un negocio distinto no cabe
en ese esquema. Es la firma de haber crecido a golpes de caso particular, y **no es el modelo
que estamos construyendo**: el nuestro enruta por estación y por curso, y la palabra "pizza"
sólo existe donde debe — en la configuración de ONCA.

**Auditoría del 2026-10-07, tras esta observación.** Se buscó vocabulario de oficio en el
código y el esquema de la plataforma. Resultado: en el esquema **no hay ninguna columna,
tabla o enum de dominio** — las apariciones son comentarios explicativos y los datos de la
migración de ONCA, que son su configuración. En el código aparecieron **tres fugas reales, y
las tres se corrigieron**:

| Fuga                                                                 | Dónde                       | Corrección                                                                                                                                                        |
| -------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El rol `STAFF` se mostraba como **"Barista"** a _todos_ los negocios | `screens/staff.jsx`         | pasa a **"Personal"** (`msgid` que ya existía y traduce "Staff")                                                                                                  |
| El reporte de ventas agrupaba por **"Barista"**                      | `screens/ventas-report.jsx` | la dimensión pasa a **"Operador"**, que es la palabra que la propia app usa (`runtime.operator_session`, el PIN de operador)                                      |
| `'barista'` en la lista de roles compatibles del API                 | `staff.service.ts`          | eliminada: **no correspondía a ningún rol** de `umi.role`, y el mecanismo correcto es un `merchant.role` — que es exactamente lo que son los cuatro roles de ONCA |

La regla, entonces: **si un negocio cambiaría esa palabra, no va en el esquema ni en el
código; va en su configuración.** Y el corolario práctico: cuando un café pide "un rol
barista", la respuesta es crearle un rol de café, no enseñarle al producto la palabra
"barista".

### 8.4 Cómo sabremos que funcionó

Métricas que este plan puede mover y que se miden con lo que ya tenemos:

| Métrica                               | Hoy                      | Objetivo                           |
| ------------------------------------- | ------------------------ | ---------------------------------- |
| Toques por orden de mostrador         | por medir en Umi         | ≤ el flujo de Parrot               |
| Órdenes por hora en el pico           | 20 (legacy)              | sostenerlo sin degradar            |
| Fallos de señal de cajón              | 7 en una mañana (legacy) | 0, y visibles al instante si pasan |
| Cancelaciones con razón tipada        | 1 de 17                  | 17 de 17                           |
| Turnos que arrancan al primer intento | no medido                | 100%                               |

---

## 9. Riesgos y lo que NO haremos

**Riesgos.**

1. **El paquete depende del WAN** para todo menos imprimir. Un corte deja la cocina ciega.
2. **La impresora es punto único de falla** del cajón y de la comanda.
3. **La tablet está en modo debug** con depuración inalámbrica: hay que apagarla al terminar.
4. **La 004 no está en producción**, y no debe estarlo hasta que la feature esté viva.

**Lo que este plan no va a hacer.**

- No construye un maestro local ni un POS principal al estilo Parrot.
- No construye perfiles de dispositivo con nombre (los "modes" de Square) hasta que un café
  necesite más de tres superficies.
- No agrega tipos de orden que este cliente no usa — sin `Domicilio` ni agregadores hasta que
  los pida.
- No convierte el carrito de un mostrador en una cuenta abierta por defecto.

---

## 10. La siguiente acción

**Las seis fases están construidas** (§8.2.1): la app se ve como el rol, el cocinero dispara
la comanda, el servidor sabe si la orden es para llevar, un aparato KDS no ofrece la caja, un
cajón que no responde lo dice en el recibo, y una línea agregada después del disparo llega a
la cocina como segunda ronda.

Lo que queda no es código: el trabajo de sitio de F5 —la reserva DHCP por MAC en el Archer
C50 y la prueba de 9100 sobre la Epson real— y el apagado de la depuración inalámbrica de las
tablets (§9). El siguiente paso es la verificación en el fierro: probar los cuatro roles de
ONCA en la tablet, el primer disparo real visto en el KDS, y una segunda ronda.
