# ADR: Separar Ventas/Reportes de Caja y turnos, con una sola fuente de ingresos

- Fecha: 2026-09-07
- Estado: Propuesto (decisión de frontera de módulo). Los **dos prototipos de interfaz
  están completos y funcionan al 100%** como demo con datos de ejemplo (cada control hace
  algo real; sin botones muertos): *Reportes* (rango de fechas que recalcula todo,
  comparación con Δ, búsqueda que filtra, multi-sucursal con roll-up, tabla dinámica con
  agrupar-por/orden, Propinas real) y *Caja y turnos* (multi-sucursal, pulse calculado,
  aprobar diferencia y nota como cambios de estado reales, denominaciones, ordenar por
  diferencia). Falta el trabajo de producto: el modelo de lectura agregado de ventas en la
  API y el recableado del ingreso del Overview (ver "Es nuevo").
- Actualización 2026-09-07: la **frontera de módulo ya está implementada en el dashboard
  real** y compila en verde. Se creó el módulo `reportes` (`src/screens/reportes.jsx`, ruta
  `/reportes`, entrada en `module-registry.js` y `MODULE_ORDER`, título en `shell.jsx`) con
  las pestañas Ventas/Recibos/Reembolsos, que reutilizan las vistas editoriales que ya
  existían (`SalesView`, `ReceiptsView`, `RefundsView` en `operations-workspace.jsx`) — sin
  SQL nuevo. La pantalla "Caja y turnos" (`src/screens/cash-shifts.jsx`) quedó en
  `cash_shifts` + `registers`. Los permisos se separaron: `reportes` pide `sale.lifecycle` +
  `sale.exception.read`; `cash-shifts` pide `cash.shift.read`. `SalesView` ya trae un resumen
  con KPIs reales (Vendido, Ticket promedio, Con descuento) desde los datos existentes.
  Pendiente sigue siendo el modelo de lectura agregado (mezcla de producto, franjas, tabla
  dinámica) y el recableado del ingreso del Overview.
- Actualización 2026-09-07 (2): se implementó el **modelo de lectura agregado de ventas** de
  extremo a extremo. Backend: endpoint `GET …/operations/reports/sales` con contrato
  `ReportsSalesQuery`/`ReportsSalesSummary` (`packages/contract/src/reports.ts`), repositorio
  `salesSummary()` (RLS-scoped, ventana por fecha comercial con zona horaria del comercio,
  reconcilia a `netSalesMinorUnits`), servicio y controlador. Agrega ventas netas, órdenes,
  ticket, ítems, descuentos, delta vs. período anterior, **mezcla de pago** (efectivo /
  terminal manual — el POS aún no captura tarjeta/monedero), **mezcla de producto** (unidades
  + venta neta por producto/categoría, sin margen porque la línea no lleva costo) y una
  **serie por hora o por día**. Frontend: `src/screens/ventas-report.jsx` (selector de rango
  Hoy/Ayer/7d/30d, KPIs con delta, gráfico de serie, mezcla de pago y tabla de productos)
  montado en la pestaña Ventas de Reportes vía `useSalesSummary` en `data.jsx`. Contract,
  API (tsc) y dashboard (vite) compilan en verde. Pendiente: dimensiones de la tabla dinámica
  por barista/hora, el detalle del turno (denominaciones, trazabilidad, aprobar) y el
  recableado del ingreso del Overview.
- Actualización 2026-09-07 (3): se implementó el **detalle del turno de caja** de extremo a
  extremo (read-only, respetando "el efectivo es solo-POS"). Backend: endpoint
  `GET …/operations/cash-shifts/:shiftId` con contrato `CashShiftDetail`
  (`packages/contract/src/reports.ts`) y repositorio `cashShiftDetail()` que arma, desde el
  esquema existente, los roles (abrió/contó/aprobó vía `cash_shift` + `cash_count_attempt` +
  `cash_variance_resolution`), la cuenta del turno (fondo + ventas efectivo + ingresos −
  retiros − caja fuerte − reembolsos = esperado vs contado → diferencia, con tolerancia de
  `cash_shift_policy`), las **denominaciones** de apertura y arqueo, el **libro** completo
  (`cash_ledger_entry` con enlace a recibo/venta y motivo/nota de `cash_movement`), los
  arqueos y una **trazabilidad** sintetizada (apertura, arqueos, custodia de
  `cash_shift_custody_event`, resolución). Frontend: `src/screens/caja-turnos.jsx` (pulse
  calculado + lista de turnos con chip de diferencia + panel de detalle con la cuenta del
  turno, denominaciones, libro, separación de funciones y trazabilidad) montado en la
  pestaña Turnos de caja vía `useCashShiftDetail`. Contract/API `tsc` y dashboard `vite`
  compilan; ESLint 0 errores; i18n `compile --strict` (44 strings traducidos). Pendiente:
  dimensiones barista/hora en la tabla dinámica de Ventas, mezcla de pago completa
  (wallet/gift_card viven en otra tabla), rentabilidad/COGS (vía recetas), la acción de
  aprobar (comando administrativo con PIN, si se decide romper el read-only) y el recableado
  del ingreso del Overview.
- Actualización 2026-09-07 (4): navegación y diseño alineados al prototipo, y brechas de
  dato cerradas donde el POS ya captura.
  - **Menú anidado (no pestañas):** el sidebar ahora expande *Reportes* → Ventas · Recibos ·
    Reembolsos y *Caja y turnos* → Turnos de caja · Registros, cada uno con su sub-ruta
    (`module-registry.js` `children`, `shell.jsx` render anidado + `activeFull`, `app.jsx`
    sub-rutas). Se quitaron los `HubTabs`.
  - **Ventas = cockpit del prototipo:** tarjetas KPI en caja, alternador Resumen / Tabla
    dinámica, y una **tabla dinámica real** con agrupar-por **Producto · Categoría · Barista ·
    Hora** y orden por columna. El endpoint agrega ahora `byOperator`, `byHour`, `tipsMinorUnits`
    y una **mezcla de pago completa** (cash + manual_terminal de `pos_tender_fact`, wallet +
    gift_card de `customer_value_tender_allocation` por `sale_id`). KPI de Propinas desde
    `receipt.snapshot->'tip'`.
  - **Caja y turnos:** pulse en tarjetas y detalle (cuenta del turno, denominaciones, libro,
    separación de funciones, trazabilidad) desde `cashShiftDetail`.
  - **Acento del diseño:** las dos pantallas aplican el azul del prototipo (#0F5BFF) *scoped*
    vía `--merchant-brand` en el contenedor, sin tocar el tema global.
  - **Mapa CodeGraph (sync + trace):** `salesSummary` controller:36 → service:80 → repo;
    `cashShiftDetail` controller:46 → service:94 → repo; `useSalesSummary` (data.jsx:1100) →
    `VentasReport`; `useCashShiftDetail` (data.jsx:1113) → `ShiftDetail`; contratos en
    `packages/contract/src/reports.ts`.
  - Verificado: contract build, API `tsc`, dashboard `vite build` (135 módulos), ESLint 0
    errores, i18n `compile --strict`.
  - **Brechas reales que quedan (requieren captura nueva, no solo lectura):** tarjeta
    integrada (necesita pasarela de pagos — proyecto P0 aparte), conteo de comensales (el POS
    no lo captura) y margen/COGS por producto (la línea no lleva costo; requiere rollup por
    receta de inventario). Documentadas, no simuladas.
- Decisión: Separar la pantalla actual "Caja y turnos" en **dos módulos**: **Reportes** (la
  lente comercial; **Ventas** es su primera página, dentro de un menú anidado) y **Caja y
  turnos** (la lente de custodia de efectivo).
  Las dos leen la misma venta desde una sola fuente. El ingreso del negocio tiene **un
  solo número**, que sale del nuevo modelo de ventas, no del proxy de lealtad de hoy.
- Base de la decisión: investigación de industria con fuentes primarias
  (`docs/research/2026-09-06-cash-shift-management-owner-ux.md`,
  `docs/research/2026-09-06-receipt-vs-sale-enterprise-systems.md`) y una auditoría de
  deduplicación del código con CodeGraph (evidencia en "Auditoría de deduplicación").

## Contexto

La pantalla "Caja y turnos" es hoy un hub con cinco pestañas —Ventas, Recibos, Reembolsos,
Turnos de caja, Registros— que renderiza el mismo `DomainWorkspace` genérico
(`apps/umi-dashboard/src/screens/cash-shifts.jsx`). Ese hub mezcla **dos preocupaciones**:

- El **registro comercial** (Ventas, Recibos, Reembolsos): qué se vendió, en todos los
  métodos de pago.
- La **custodia de efectivo** (Turnos, Registros): el cajón físico, el fondo de apertura,
  el esperado contra el contado, la diferencia y los eventos que no son venta.

Pregunta que origina el ADR: ¿el reporte de ventas necesita su propio módulo, o es
redundante con Caja y turnos, dado que la venta ocurre físicamente en la caja? La auditoría
de brechas (`docs/research/2026-09-06-competitive-scan-and-gap-audit/`) añade el otro lado:
la analítica/reportes es la **única** capacidad ausente (○) de Umi frente a los cinco
competidores (●).

## Cómo lo hacen los líderes (fuentes primarias)

Ventas y caja son superficies **distintas** en todos los sistemas revisados. No es
redundancia; son lentes distintas de la misma venta:

- **PoloTab** (norte de diseño): "Venta" es un reporte bajo *Reportes*; "Caja" es una
  entrada bajo *Trazabilidad*. Son dos secciones de navegación distintas.
- **Toast**: un módulo *Reports*, pero con categorías separadas "Sales" y "Cash & Loss
  Management".
- **Square**: *Reports → Sales* aparte del reporte de *Cash Drawer Shift*.
- **Odoo**: *Reporting → Orders* aparte de *Sessions* (la caja/turno) aparte de
  *Accounting* (el asiento contable).
- **Lightspeed**: reportes de ventas aparte de *Fiscal → Cash drawer* aparte de *Financial
  Services*.
- **Clover**: *Reporting* aparte de *Sales activity → Cash log*.

## Modelo conceptual: una venta, tres lentes

Una sola venta se lee por tres lentes. Dos de ellas son las de este ADR:

- **Comercial (Ventas/Reportes)**: "¿cómo va el negocio?" Cubre **todos** los métodos
  (efectivo + tarjeta + monedero + delivery), mezcla de producto, franjas horarias,
  rentabilidad.
- **Custodia (Caja y turnos)**: "¿cuadra el efectivo y quién lo manejó?" Cubre **solo la
  porción de efectivo** más los eventos que no son venta (ingreso, retiro, retiro a caja
  fuerte, apertura sin venta).
- (Liquidación/Contabilidad: pagos con tarjeta, comisiones, asiento. Fuera del alcance.)

El traslape entre las dos lentes es **un solo número**: la venta en efectivo. Es un
**empalme**, no una duplicación.

## Auditoría de deduplicación (CodeGraph)

Se corrió una deduplicación antes de decidir. Hallazgos con evidencia:

1. **La analítica no existe.** CodeGraph no encuentra ningún símbolo `productMix`,
   `salesSummary`, `netSales`, `reporting`, `dayparts` ni `salesRollup` en el repo. El
   módulo Ventas/Reportes es **nuevo**: no duplica código existente. Confirma la brecha de
   la auditoría a nivel de código.

2. **Las listas de registro ya existen: reutilizar, no reescribir.**
   `apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts` ya
   define los dominios `sales` (:92), `receipts` (:105) y `refunds_voids` (:126). Alimentan
   hoy el hub "Caja y turnos" por el `DomainWorkspace` genérico. Son **listas crudas de
   transacciones**, no analítica. Regla: el módulo Ventas debe **re-hogar** esos dominios
   (mover las pestañas en la interfaz), no escribir SQL nuevo contra las mismas tablas.
   Reescribirlos sería la duplicación.

3. **El traslape Ventas↔Caja es de grano distinto, no duplicación.** El dominio `sales` lee
   `receipt_snapshot.grand_total` = la venta completa, todos los métodos (:95). El dominio
   `cash_shifts` suma **solo** la porción de efectivo desde `cash_ledger_entry`
   (`cash_received − change`) (:140). Misma fuente (`pos_committed_sale`), dos columnas, dos
   lentes. El **puente ya está en el esquema**: el dominio `sales` hace
   `LEFT JOIN cash_shift cs ON cs.id = s.cash_shift_id` (:99). La venta ya sabe su turno.

4. **La única duplicación real: el ingreso.** El Overview muestra "Ingresos del mes" desde
   `ov.revenueThisMonth` (`apps/umi-dashboard/src/screens/overview.jsx:24`), pero **ningún
   API calcula `revenueThisMonth`** (cero coincidencias en `apps/umi-api`). El único dinero
   que produce el backend del Overview son los **topups de lealtad**
   (`apps/umi-api/src/modules/cash/cash-read.service.ts:114-115`,
   `overview.jsx:332-333`). Es decir: hoy "Ingresos del mes" está vacío (`'–'`) o es un
   proxy de lealtad, no la venta real del POS. Cuando Ventas calcule el ingreso real, habría
   **dos números de ingreso en conflicto**. Esa es la duplicación a evitar.

## Decisión

1. **Dos módulos, no uno.** *Reportes* (comercial) y *Caja y turnos* (custodia). *Reportes*
   es un módulo con un menú desplegable anidado; su primera página (por defecto) es
   *Ventas*, con *Rentabilidad* y *Propinas* como hermanas. *Ventas* abre en un resumen
   escaneable (KPIs + gráfico + tabla) con la **tabla dinámica** a un clic (agrupar por
   producto/categoría/barista/hora, orden por columna, exportar/guardar).
2. **Re-hogar los registros de venta.** Recibos y Reembolsos pasan a *Reportes* (grupo
   «Registros de venta»). Turnos de caja y Registros quedan en *Caja y turnos*.
3. **Una sola fuente de la venta.** `merchant.pos_committed_sale` + `merchant.receipt_snapshot`.
   Ventas lee `grand_total` (todos los métodos); Caja lee la porción de efectivo de
   `merchant.cash_ledger_entry`.
4. **Un solo número de ingresos.** El nuevo modelo de lectura agregado de ventas es la
   fuente. El Overview consume **ese mismo** número. Se **retira** el proxy de lealtad como
   "ingreso" (la lealtad sigue como su propia métrica, con su propio nombre).
5. **Puente, no copia.** El cruce Recibo/Reembolso ↔ Turno usa
   `pos_committed_sale.cash_shift_id`, que ya existe. Se muestran enlaces en ambos sentidos.
6. **Reutilizar, no reconstruir.** Las listas de registro usan los dominios existentes de
   `dashboard-operations`. Solo se **añade** el modelo de lectura agregado (KPIs, mezcla de
   producto, franjas horarias, rentabilidad), que hoy no existe.

## Qué se reutiliza y qué es nuevo

Se reutiliza:

- Los dominios `sales`, `receipts`, `refunds_voids` de `dashboard-operations` (las listas).
- El puente `pos_committed_sale.cash_shift_id`.
- El módulo `cash_shifts` de `dashboard-operations` y el esquema `merchant.cash_*` para la
  custodia (el rediseño de Caja y turnos ya lo cubre).

Es nuevo:

- Un **modelo de lectura agregado de ventas** (rollups: ventas netas, ticket promedio,
  órdenes, mezcla por método, mezcla de producto, franjas horarias, rentabilidad/COGS,
  período contra período y año contra año, por sucursal y por cadena). No existe.
- El módulo de interfaz *Reportes* (con *Ventas* como página por defecto, una barra de
  filtros persistente —rango de fechas, comparación, sucursal— y una tabla dinámica con
  agrupar-por, orden por columna y exportación).
- El recableado del ingreso del Overview hacia el nuevo modelo, y el retiro del proxy.

## Consecuencias

Positivas:

- Cierra la brecha P0 de reportes/analítica (la única capacidad ausente frente a la
  competencia).
- Un solo número de ingresos. Se elimina el riesgo de dos verdades en conflicto.
- Frontera clara: la lente comercial y la lente de custodia dejan de mezclarse.
- Los registros de venta dejan de vivir dentro de un hub centrado en efectivo.

Costos y riesgos:

- Hay que construir el modelo de lectura agregado. Es trabajo nuevo, no un movimiento de
  código.
- Hay que migrar las pestañas (re-hogar Ventas/Recibos/Reembolsos) sin romper enlaces
  guardados ni rutas.
- Hay que retirar el proxy de ingreso del Overview y verificar que nada más lo consuma.
- El cruce inverso (venta → turno) ya existe; el directo (turno → ventas del turno) puede
  necesitar un índice sobre `pos_committed_sale.cash_shift_id`.

## Alternativas consideradas

1. **Un solo hub "Caja y turnos" con Ventas adentro** (estado actual) — rechazado: mezcla
   dos lentes, deja Ventas como lista cruda y no cierra la brecha de reportes.
2. **Duplicar las consultas de ventas en el módulo nuevo** — rechazado: duplica los
   dominios de `dashboard-operations` (hallazgo 2) y crea dos caminos de lectura.
3. **Dejar el ingreso del Overview como proxy de lealtad** — rechazado: crea dos números de
   ingreso en conflicto cuando llegue el real (hallazgo 4).

## Referencias

- Auditoría de deduplicación (via CodeGraph):
  `apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts`
  (`sales` :92, `:95` `grand_total`, `:99` `LEFT JOIN cash_shift`; `receipts` :105;
  `refunds_voids` :126; `cash_shifts` :136, `:140` porción de efectivo),
  `apps/umi-dashboard/src/screens/overview.jsx:24-25,332-333`,
  `apps/umi-api/src/modules/cash/cash-read.service.ts:114-115`.
- Esquema (fuente única de la venta): `docs/migration/build-v3/20_merchant.sql`
  (`pos_committed_sale`, `receipt_snapshot`), `docs/migration/build-v3/33_pos_cash.sql`
  (`cash_shift`, `cash_ledger_entry`).
- Industria (fuentes primarias): `docs/research/2026-09-06-cash-shift-management-owner-ux.md`,
  `docs/research/2026-09-06-receipt-vs-sale-enterprise-systems.md`,
  `docs/research/2026-09-06-competitive-scan-and-gap-audit/` (brecha de reportes;
  taxonomía de PoloTab: "Venta" en Reportes, "Caja" en Trazabilidad).
- Prototipos de interfaz (artefactos de esta sesión): módulo "Caja y turnos" (custodia) y
  módulo "Ventas y Reportes" (comercial), con datos de ejemplo de Kalala Chapultepec y el
  cruce recibo/turno.
