# ADR: Reportes se organiza por trabajo, no por tipo de documento

- Fecha: 2026-09-08
- Estado: Propuesto.
- Relación: **enmienda** el ADR
  [`2026-09-07-ventas-vs-caja-y-turnos-frontera-de-modulo-adr.md`](2026-09-07-ventas-vs-caja-y-turnos-frontera-de-modulo-adr.md).
  Ese ADR sigue vigente en su frontera (Reportes = lente comercial; Caja y turnos = lente de
  custodia) y en su regla de "un solo número de ingreso". Este ADR **revisa solo su punto 2**:
  la sub-estructura interna de Reportes deja de ser tres pestañas hermanas
  (Ventas · Recibos · Reembolsos).

## Decisión

Organizar Reportes **por trabajo del dueño**, no por tipo de documento:

1. **Ventas es la lista única de ventas** (la superficie de "operar"). Trae la búsqueda al
   frente (monto, últimos 4 de tarjeta, hora, número de recibo, operador) y un **detalle de
   fila** que hace, sobre la misma venta: estado de impresión + reimprimir/reenviar, reembolso,
   y CFDI.
2. **Recibos deja de ser una entrada de navegación.** La custodia de impresión pasa a ser una
   columna y un filtro de estado sobre la venta. La reimpresión vive en el detalle. La pantalla
   `recibos.jsx` se retira; su lógica se re-hoga en `ventas-report.jsx`.
3. **Reembolsos pasa a analítica de prevención de pérdidas** (patrones de reembolso/void por
   operador y por hora). El reembolso individual se muestra sobre su venta.
4. **CFDI es una pista de backend aparte.** El frontend solo muestra el estado de CFDI, el botón
   "Convertir en factura" y el QR de autofacturación.

## Base de la decisión

Investigación de esta sesión, en dos frentes:

- **Escaneo competitivo** de cómo manejan los recibos Toast, Square, Lightspeed, Clover y
  Shopify.
- **Trabajos por hacer (JTBD)** del dueño de café/restaurante/retail, con foco en México.

## Contexto

El ADR previo dejó Reportes con un menú anidado de tres vistas hermanas —Ventas, Recibos,
Reembolsos— donde Recibos hoy es **custodia de impresión** (`recibos.jsx`: cuántos recibos se
imprimieron, en cola, o fallaron, más una COPIA controlada) y Reembolsos es una lista cruda de
reembolsos/voids.

El problema: las tres vistas son **tres lentes de una sola venta**, partidas por **tipo de
documento**. Eso obliga al usuario a pre-clasificar una pregunta que es sobre una sola venta
("un cliente quiere facturar la venta de $340 del martes: ¿eso está en Ventas o en Recibos?").
La respuesta es "en las dos". Partir por documento cruza los dos trabajos reales del dueño en
lugar de servir a cada uno.

## Cómo lo hacen los líderes (escaneo competitivo)

- **Casi nadie tiene una pantalla llamada "Recibos".** El recibo es una **acción sobre la
  transacción/orden/cuenta**, no una lista de primer nivel. Toast = "Find Checks";
  Square = "Transactions"; Clover = "Transactions"; Shopify = "Orders". Solo Lightspeed
  K-Series nombra una pantalla "Receipts". Mantener tres destinos separados es, entonces, la
  desviación — no lo que hace la industria.
- **Búsqueda casi universal:** fecha/rango, **monto**, **últimos 4 de tarjeta**, cliente,
  número de recibo/cuenta. Además, un **código de barras en el ticket** para recuperar la venta
  al escanear.
- **El reembolso es dirigido por la transacción, no por el recibo:** se localiza la venta y se
  reembolsa. Que el reembolso emita su propio recibo es inconsistente entre productos
  (Lightspeed K y Shopify: sí; Square: no; Toast/Clover: ambiguo).
- **Ninguno hace CFDI de México.** Lightspeed y Shopify fiscalizan solo la UE (TSE de Alemania,
  FDM de Bélgica, NF525 de Francia, IVA por ítem de España). Los jugadores de EUA no fiscalizan.
  Este es el hueco abierto.
- **La mejor auditoría por recibo es de Lightspeed K-Series** (un Journal de eventos + un
  registro de cada impresión). Toast aporta la auditoría de void/refund con **quién y quién
  aprobó**.

## Qué quiere el dueño (JTBD, en orden)

1. **Convertir un ticket pasado en factura (CFDI), rápido** — el momento "¿me facturas?", a
   veces horas o días después. Es el trabajo #1 en México, y ningún competidor lo cubre.
2. **Producir prueba para ganar una disputa/contracargo** — recibo con ítems y hora, dentro de
   una ventana corta (~7 días).
3. **Hacer el corte del día** — efectivo/tarjeta/delivery/voids/reembolsos/propinas que cuadren
   con el cajón y el depósito.
4. **Reimprimir/reenviar, y reembolsar contra la venta original.**
5. **Detectar robo del empleado** — reembolsos/voids/descuentos marcados por operador y hora.
6. **Alimentar contabilidad/impuestos** — exportable, con ítems y con impuesto separado.
7. **Encontrar una venta en segundos** — por monto, últimos 4, hora, ítem, mesa y **quién la
   cobró**. Es el habilitador de todos los demás.
8. **Marketing con el recibo** — real pero sobrevalorado; el dueño lo pone último, y la captura
   de correo genera rechazo por privacidad.

## Modelo conceptual: por trabajo, no por documento

Una sola venta, dos trabajos distintos:

- **Operar sobre una venta** (encontrar, recibo, reembolso, factura): pertenece a **la venta**.
  Es por venta y sensible al tiempo (cliente en el mostrador).
- **Analizar patrones** (corte del día; patrones de reembolso/void por operador = señal de
  robo): pertenece a **reportes**.

El modelo viejo parte por documento (Ventas/Recibos/Reembolsos) y cruza ambos trabajos. El
modelo nuevo parte por trabajo: Ventas sirve "operar"; Reembolsos-analítica sirve "analizar".

## Qué se reutiliza y qué es nuevo

Se reutiliza:

- Los dominios `sales`, `receipts`, `refunds_voids` de `dashboard-operations` (las listas).
- `ReceiptReprintDialog` y `ReceiptStatusLabel`, que ya viven en `operations-workspace.jsx`.
- El modelo de lectura agregado de ventas (`salesSummary`) ya construido en el ADR previo, y la
  regla de "una sola fuente de la venta".

Es nuevo:

- La **búsqueda multi-campo** al frente de Ventas.
- El **panel de detalle de la venta** (ítems, método de pago + últimos 4, cajero, estado de
  impresión + reimprimir/reenviar, línea de tiempo). Depende de un **endpoint de detalle de
  venta**: hoy `useOperationsData('receipts')` solo trae referencia, fecha, estado, monto y
  moneda.
- La **superficie de reembolso desde el detalle**, que además hace visible el reembolso
  (hoy es append-only en `pos_sale_exception` y no toca `customer_order`/`kitchen_order`/
  `receipt`, por lo que es invisible en el dashboard).
- El **re-enfoque de Reembolsos** de lista cruda a analítica de prevención de pérdidas.
- Toda la **pista CFDI**: PAC (timbrado), captura de RFC/CP/Régimen/Uso, XML, QR de
  autofacturación y **factura global** (plazo de 24 h por RMF 2026). Se copia el patrón de las
  herramientas de facturación mexicanas (PoloTab/Alegra), no el de los jugadores de EUA.

## Consecuencias

Positivas:

- Alinea Reportes con lo que hace la industria; quita la desviación de tres destinos.
- Sirve los dos trabajos reales del dueño (operar vs analizar) en lugar de cruzarlos.
- Pone la búsqueda al frente — la carencia #1 de hoy.
- Corrige la invisibilidad del reembolso al mostrarlo sobre su venta.
- Abre el diferenciador CFDI, que ningún competidor cubre.

Costos y riesgos:

- El detalle de la venta necesita un **endpoint de backend** nuevo (Fase 1–2).
- CFDI es un **proyecto de backend** con PAC; no es una edición de frontend (Fase 3).
- Hay que migrar rutas sin romper enlaces: `reportes/recibos` se redirige a `reportes` (Ventas).
- Se retira `recibos.jsx` como pantalla; su lógica se mueve, no se pierde.
- Reembolsos cambia de lista a analítica — trabajo nuevo, no solo un movimiento de código.

## Alternativas consideradas

1. **Enriquecer en el lugar** (mantener las tres vistas hermanas y añadir búsqueda/detalle/CFDI
   a cada una) — rechazada: mantiene tres caminos de código y el problema de "¿cuál lente?"; es
   la opción más bespoke y la menos alineada con la industria.
2. **Lista única pura** (colapsar todo a una sola lista de transacciones; Reembolsos solo como
   filtro) — rechazada: pierde la vista dedicada de patrones de reembolso (prevención de
   pérdidas), que es un trabajo distinto real.
3. **Partir por trabajo** (elegida): Ventas como lista de "operar" + Reembolsos como analítica.

## Plan por fases

- **Fase 0 — movimiento de IA (solo frontend, reversible):** `module-registry.js` (quitar
  Recibos del menú), `app.jsx` (redirigir la ruta `reportes/recibos`), `reportes.jsx` (quitar la
  rama `receipts`), re-hogar la custodia de impresión en `ventas-report.jsx`.
- **Fase 1 — panel de detalle de la venta** (necesita el endpoint de detalle de venta).
- **Fase 2 — reembolso desde el detalle + analítica de Reembolsos.**
- **Fase 3 — CFDI** (pista de backend aparte, con PAC).

## Referencias

- ADR previo (frontera de módulo y fuente única de la venta):
  `docs/architecture/2026-09-07-ventas-vs-caja-y-turnos-frontera-de-modulo-adr.md`.
- Código: `apps/umi-dashboard/src/screens/recibos.jsx` (custodia de impresión),
  `reportes.jsx` (dispatcher, líneas 10-23), `app.jsx` (ruta `reportes/recibos`, línea 268),
  `lib/module-registry.js` (menú anidado), `operations-workspace.jsx`
  (`ReceiptReprintDialog`/`ReceiptStatusLabel`), `ventas-report.jsx`.
- Investigación de esta sesión: escaneo competitivo (Toast, Square, Lightspeed, Clover,
  Shopify) y JTBD del dueño, con la sección México ticket vs CFDI/factura (CFDI 4.0, factura
  global con RFC genérico `XAXX010101000`, plazo de 24 h por RMF 2026, QR de autofacturación).
- Bug relacionado (que este ADR ayuda a cerrar): reembolso append-only invisible en el
  dashboard (`pos_sale_exception`).
