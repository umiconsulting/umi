# La cuenta vacía: qué hace la competencia con ella

Fecha: 2026-10-13. Autor: agente Codex, a pedido del dueño.

**Pregunta que responde este documento.** En el till, "Nueva cuenta" y "Vaciar cuenta" se
sienten la misma cosa, y con una cuenta sin productos "Nueva cuenta" deja registros que
nadie pidió: solo se acumulan si se spaméa el botón. ¿Cómo resuelve eso la competencia, y
también los POS mexicanos?

Etiquetas: **hecho documentado** (primera fuente del proveedor), **lectura de captura** (lo
que muestra la imagen), **inferencia**, **NO VERIFICADO**.

## 0. La respuesta corta

Tres cosas son ciertas en casi todos los sistemas revisados.

1. **Una cuenta sin artículos no se guarda.** La regla es explícita en los que publican su
   manual, y no aparece ningún sistema que conserve una cuenta vacía como registro.
2. **Guardar y vaciar son dos acciones distintas, y la diferencia es el dinero.** Guardar
   conserva lo que ya se pidió para cobrarlo después; vaciar borra artículos sin cobrar.
   Ninguno de los revisados las junta en un solo botón.
3. **La cuenta vacía que sobrevive es un defecto conocido, no un diseño.** Hay proveedores
   con un artículo dedicado a cerrarla, y comunidades quejándose del mismo desorden que
   vimos en `merchant.pos_cart` (cuentas 71 a 77, ocho registros en 25 segundos).

## 1. Toast (EE. UU.)

- **Hecho documentado.** Una cuenta de Toast sin artículos no tiene nada que mandar, así que
  los botones de envío no se dibujan hasta que existe al menos un artículo
  ([Manage Orders With Toast POS](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens)).
- **Hecho documentado.** La cuenta tiene estados `open → paid → closed`, y una cuenta cerrada
  se puede purgar del equipo ([Tracking the order state](https://doc.toasttab.com/doc/platformguide/adminOrderStates.html)).
- **Hecho documentado.** Toast separa **Send**, **Stay** y **Hold**: la misma cuenta se sigue
  trabajando mientras se abre otra, y apartar no es borrar
  ([Start and Send an Order](https://support.toasttab.com/en/article/Starting-Sending-an-Order)).
- **Lectura de captura / testimonio.** En la comunidad de Toast hay operadores con cuentas en
  cero que ensucian los reportes: "an order can exist without any checks or items on it due to
  abandoned checks" ([Toast Community](https://community.toasttab.com/t5/restaurant-operations/any-idea-how-to-eliminate-the-0-00-open-checks/m-p/16674)).

## 2. Square (EE. UU.)

- **Hecho documentado.** Un _open ticket_ se crea a propósito y con nombre: `Checkout >
Tickets > New Ticket`, se escribe el nombre, se guarda, y **después** se agregan artículos
  ([Create and edit open tickets](https://squareup.com/help/us/en/article/5337-use-open-tickets-with-square)).
- **Hecho documentado.** Square limpia sola: los tickets abiertos más de 180 días se quitan de
  la cuenta, y el ticket tiene un límite de 500 artículos.
- **Hecho documentado.** Vaciar es una acción con nombre propio: al anular un ticket abierto se
  quitan sus artículos y se cierra en el acto
  ([Comp and void open tickets](https://my.squareup.com/help/us/en/article/5814-get-started-with-comp-and-void)).

## 3. Clover (EE. UU.)

- **Hecho documentado.** El estado de la orden lo pone Clover automáticamente: pasa a `open` y
  `locked` "when a line item is added to the order or a payment is taken"
  ([Clover Orders API](https://docs.clover.com/dev/reference/ordercreateorder)).
  Es decir: la orden empieza a existir cuando llega el primer artículo.
- **Hecho documentado.** Cerrar una orden sin artículos es una acción explícita del menú de la
  orden, no un efecto secundario ([Order Details](https://bypassmobile.zendesk.com/hc/en-us/articles/360030987572-Order-Details)).

## 4. Loyverse (internacional, con manual en español)

- **Hecho documentado.** La regla más clara de todas: "Tickets with no items will not be
  saved" ([How to Split an Open Ticket](https://help.loyverse.com/help/how-split-open-ticket-loyverse-pos)).
  Un ticket sin artículos se descarta; no se convierte en registro.
- **Lectura de captura.** La lista de tickets abiertos muestra nombre, importe, tiempo y
  empleado, y los tickets vivos tienen tiempo y dinero
  (`assets/loyverse-tickets-abiertos.jpg`).
- **Inferencia.** Loyverse no necesita una acción "cerrar cuenta vacía" porque nunca crea una.

## 5. SpotOn (EE. UU.)

- **Hecho documentado.** SpotOn publica un procedimiento para **cerrar una cuenta vacía** y
  explica para qué sirve: "This helps keep your order list clean and prevents unused checks
  from remaining open"
  ([Close an Empty Check (No Items)](https://spotonteam.atlassian.net/wiki/spaces/SK/pages/839352356/Close+an+Empty+Check+No+Items+SpotOn+Restaurant+FOH)).
  Es la evidencia de que la cuenta vacía sobreviviente es un desorden conocido en la industria.
- **Hecho documentado.** Otra casa corrigió el mismo defecto en sus notas de versión: una
  versión anterior podía crear "a new empty check" al dividir una cuenta
  ([Heartland POS, notas 5.36](https://heartlandpos.my.site.com/lightningcommunity/sfc/servlet.shepherd/document/download/0692M00000TJHAhQAP?operationContext=S1)).

## 6. México

### 6.1 Soft Restaurant (National Soft)

- **Hecho documentado.** El turno no se puede cerrar con cuentas abiertas: el sistema lo
  rechaza y pide resolverlas una por una
  ([No se puede cerrar el turno porque existen cuentas abiertas](https://softrestaurant.zohodesk.com/portal/es/kb/articles/no-se-puede-cerrar-el-turno-porque-existen-cuentas-abiertas)).
  La captura del artículo muestra el módulo Comedor con ocho cuentas pendientes y un contador
  de 44 cuentas abiertas (`assets/soft-restaurant-cuentas-abiertas.png`). Una cuenta vacía o
  mal cerrada es, para ellos, dinero que no cuadra al final del día.
- **Hecho documentado.** La cuenta se abre a propósito: "Botón Abrir cuenta libre: Permite al
  usuario abrir una cuenta nueva para realizar el proceso de captura"
  ([Manual Soft Restaurant Móvil](https://es.scribd.com/document/401081002/manual-de-usuario-soft-restaurant-movil-v-1-0-20160613-1-pdf)).
  La cuenta nace con mesa o con nombre del cliente, no en blanco.
- **Hecho documentado.** La cuenta reabierta "pasa al estado Abierta", es decir el estado de la
  cuenta es dato de primera clase
  ([Manual Soft Restaurant 10](https://es.scribd.com/document/497557901/Manual-de-Usuario-Soft-Restaurant-10)).

### 6.2 FoodSoft

- **Hecho documentado.** La segunda cuenta de la misma mesa se pregunta antes de existir:
  aparece el mensaje "Ya existe una Orden Registrada en esta Mesa, ¿Desea Crear una nueva
  Cuenta?" ([Manual del Módulo de Mesas, v14.5](https://foodsoft.com.mx/wp-content/uploads/2023/03/Manual-Mesas-FoodSoft-version-14-5.pdf)).
  La regla es por mesa y con confirmación: no se acumulan cuentas calladas.

### 6.3 Parrot

- **Hecho documentado.** Al cerrar caja, "Si hay órdenes abiertas, el sistema las lista para
  revisión manual" ([Cómo operar cajas](https://soporte.parrotsoftware.com.mx/cajas-pos/como-operar-cajas)).
  La cuenta abierta es una decisión que una persona resuelve, no basura que se ignora.
- **Hecho documentado.** La operación empieza por abrir la caja cada mañana
  ([Apertura de caja](https://soporte.parrotsoftware.com.mx/es_MX/apertura-de-caja)).

### 6.4 eleventa

- **Hecho documentado.** Su función de apartar son los "tickets en espera", y existen para
  manejar varias ventas a la vez
  ([Manual eleventa](https://es.scribd.com/document/295172732/Manual-Eleventa-Punto-de-Venta-3-20-07)).
  Un ticket en espera tiene contenido; el manual no describe apartar una venta vacía.

### 6.5 kiu-r e infocaja

- **Hecho documentado.** En kiu-r la cuenta se abre al sentar al grupo y nace con el número de
  personas ya puesto ([Manejar la fila](https://docs.kiu-r.com/es/guides/waitlist/managing-the-queue/)):
  la silla es la identidad, así que la cuenta no puede estar vacía de sentido.
- **Hecho documentado.** infocaja admite tres cuentas en la misma mesa, y siempre con un
  producto capturado ([Manual de infocaja](https://infocaja.com.mx/ManualInfocaja.pdf)).

## 7. El defecto que otros ya escribieron

- **Testimonio (foro del proveedor).** Un operador de SambaPOS describe exactamente lo que
  sentimos en el till: con un ticket abierto y sin artículos no se puede volver al menú
  principal, y la única salida es cerrar el ticket
  ([SambaClub Forum](https://forum.sambapos.com/t/how-to-automatically-close-ticket-after-cancelling-last-item/7039)).
- **Inferencia.** La industria no resolvió esto con un botón más, sino con una regla: la cuenta
  sin artículos no es un registro. Cuando además quieren conservar el flujo, la vuelven invisible
  (Toast, Loyverse) o la cierran con una acción explícita (SpotOn).

## 8. Lo que UMI hace ahora, y qué cambió

| Acción del till                      | Qué hace                                                                                     | Cuándo aparece                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `Nueva cuenta` (barra superior)      | Guarda la cuenta que tiene algo (líneas, mesa, nombre u orden disparada) y abre la siguiente | Siempre; se apaga cuando la cuenta en pantalla está vacía |
| `Vaciar cuenta` (menú de la comanda) | Borra los productos y conserva la cuenta y su folio                                          | Sólo con productos en la comanda                          |
| Cuenta vacía + `Nueva cuenta`        | No escribe nada: la cuenta se queda y la pantalla se limpia                                  | —                                                         |

**El cambio del 2026-10-13** (reporte:
`docs/reports/2026-10-13-cuenta-vacia-no-se-guarda.md`):

1. El till no pide una cuenta nueva cuando la que tiene no tiene nada: el control se apaga y su
   explicación dice por qué.
2. La API cierra la cuenta vacía en vez de guardarla (`suspendAccount` la deja `cancelled` /
   `abandoned` con motivo). Esto cubre las otras puertas: abrir una mesa, retomar otra cuenta y
   salir del turno.
3. Es la misma regla que el till ya escribía para el turno que se abandona con la orden vacía
   (`prepareForOperatorExit`), y la que el manual de Loyverse publica.

**Inferencia sobre la duda del dueño.** "Nueva cuenta" no borra una cuenta en blanco: antes la
**guardaba**, que es peor. Con la regla nueva no la guarda ni la borra; la cuenta en blanco es el
borrador de trabajo del operador y vive mientras la use.

## 9. Lo que queda a decisión del dueño

- **Un solo botón con dos salidas.** La alternativa a los dos controles de hoy es que `Nueva
cuenta`, cuando hay productos sin cobrar, pregunte "¿guardar la cuenta o descartar los
  productos?" y que `Vaciar cuenta` desaparezca del menú. Es más parecido a Toast (Send/Stay/Hold)
  y a Square (Save ticket / Void ticket): una decisión, en el momento en que importa.
- **Estado apagado vs. oculto.** Hoy el control de la barra se apaga con su explicación y el
  botón del espacio Cuentas se oculta. Se puede unificar en cualquiera de las dos formas.

## 10. Qué NO se verificó

- **NO VERIFICADO.** No se probó ningún POS de la competencia con licencia propia; todo lo de
  arriba sale de su documentación, sus capturas oficiales y sus foros.
- **NO VERIFICADO.** El comportamiento de FoodSoft y de Soft Restaurant se leyó en sus manuales y
  su base de conocimiento, no en una instalación.
- **NO VERIFICADO.** El suite de integración de `umi-api` para `pos-cart` (necesita la base
  build-v3 con los roles de harness, que no existe en esta máquina). El caso que codificaba la
  regla vieja se actualizó y no se ejecutó.
