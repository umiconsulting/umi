import { useMemo, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { HubTabs } from '@/shell.jsx';
import { useInventoryCosting } from '@/data.jsx';
import { formatMoney, formatNumber } from '@/lib/format.js';
import { localeTag } from '@/lib/i18n.js';
import { useMerchant } from '@/lib/merchant-context.jsx';
import MenuEngineeringTab from './menu-engineering.jsx';
import UsageVarianceTab from './variance.jsx';
import {
  DEFAULT_RANGE_DAYS,
  RANGE_CHOICES,
  basisPointsToPercent,
  dayMargin,
  filterPlates,
  forecastCounts,
  formatBusinessDate,
  plateComponents,
  plateMargin,
  scaledToNumber,
  sortForecast,
  splitPlates,
  summarizeDays,
  uncostedItemsOf,
} from './costing-model.js';

/**
 * Costos y márgenes — workstream E steps 5 and 6, and the sentence the workstream's
 * acceptance is written as: "A plate shows its cost, its margin, and the stock it
 * consumed."
 *
 * THE ONE RULE THIS SCREEN IS BUILT AROUND. D47: the day read once reported cost 0 and
 * a 100 percent margin for a café that had no recipes, because a zero stood in for an
 * unknown. A screen that renders `0`, or `—`, or a grey "0 %" in that place repeats the
 * defect one layer up, where it is worse, because it looks like good news. So:
 *
 *   · a plate or a day the server did not fully price shows a NAMED STATE, never a
 *     number: "Sin costo", and which items have no price and why;
 *   · the period's cost and margin are withheld unless EVERY trading day in the window
 *     is costed, and the count of the ones that are not is on screen;
 *   · a forecast row with no cost basis shows "sin costo base" rather than a $0.00
 *     value, and a row nothing consumed shows "sin consumo" rather than "0 días".
 *
 * The arithmetic behind those decisions is in `costing-model.js`, where it is tested
 * without a browser. This file decides what a person sees.
 */

/** The unit each quantity carries, in the café's language. */
const UNIT_LABEL = {
  unit: msg`pza`,
  gram: msg`g`,
  kilogram: msg`kg`,
  milliliter: msg`ml`,
  liter: msg`L`,
  portion: msg`porción`,
  package: msg`paquete`,
  box: msg`caja`,
};

/**
 * Why a plate has no cost. Each one is a different repair, so each one gets its own
 * sentence rather than a shared "error".
 */
const DEFECT_LABEL = {
  no_inventory_mapping: msg`Nadie registró qué consume este platillo`,
  no_recipe_components: msg`La receta existe pero no tiene componentes`,
  no_cost_basis: msg`Su insumo nunca se ha recibido, así que no hay precio`,
  non_stock_mapping: msg`No se lleva en inventario, así que su costo no se calcula`,
  unit_conversion_not_exact: msg`La receta no se convierte en unidades completas del insumo`,
};
const DEFECT_FIX = {
  no_inventory_mapping: msg`Crea la receta o la asignación de inventario del producto.`,
  no_recipe_components: msg`Agrega los insumos y sus cantidades a la receta.`,
  no_cost_basis: msg`Registra una recepción de compra de ese insumo.`,
  non_stock_mapping: msg`No hay nada que arreglar: este producto no se cuenta en inventario.`,
  unit_conversion_not_exact: msg`Ajusta la cantidad para que dé unidades completas del insumo.`,
};

const PLATE_VIEWS = [
  { id: 'costed', label: msg`Con costo` },
  { id: 'uncosted', label: msg`Sin costo` },
  { id: 'all', label: msg`Todos` },
];

/**
 * The second level of the screen. The costing report came first; the usage
 * variance (§9.3) and the four menu classes (§9.5) join it in Phase 4, and the
 * window picker above them is shared, so all three read the same period.
 */
const TABS = [
  { id: 'costing', label: msg`Costo` },
  { id: 'variance', label: msg`Variación` },
  { id: 'menu', label: msg`Ingeniería de menú` },
];

const TONE = {
  complete: 'active',
  incomplete: 'susp',
  not_costed: 'neutral',
};

function Chip({ tone = 'neutral', children }) {
  return (
    <span className={`badge badge-${tone}`} style={{ textTransform: 'none', letterSpacing: 0 }}>
      {children}
    </span>
  );
}

/**
 * The state a number is in when the server did not price it. A chip with a reason, not
 * a dash and not a zero: a dash reads as "small", and a zero reads as "free".
 */
function NotCosted({ children, title }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 9px',
        borderRadius: 'var(--r-pill)',
        background: 'var(--warning-soft)',
        color: 'var(--warning)',
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function Figures({ children, size = 15, tone }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        fontSize: size,
        fontVariantNumeric: 'tabular-nums',
        color: tone,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function Section({ eyebrow, meta, children }) {
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div className="eyebrow">{eyebrow}</div>
        {meta ? <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{meta}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One KPI. `absent` is the state where the number exists but is not known. */
function Stat({ label, value, absent, note, tone }) {
  return (
    <div
      className="card"
      style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div className="eyebrow">{label}</div>
      <div style={{ minHeight: 26, display: 'flex', alignItems: 'center' }}>
        {absent ? (
          <NotCosted>{absent}</NotCosted>
        ) : (
          <Figures size={22} tone={tone}>
            {value}
          </Figures>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', minHeight: 16 }}>{note}</div>
    </div>
  );
}

/**
 * The window every section is read over. It is NOT a date picker: the business date
 * belongs to the café's timezone, so the lengths are handed to the API and the API
 * echoes back the window it used, which the section headers then show.
 */
function RangePicker({ value, onChange }) {
  const { i18n } = useLingui();
  return (
    <div
      role="group"
      aria-label={i18n._(msg`Periodo`)}
      style={{
        display: 'inline-flex',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-pill)',
        overflow: 'hidden',
        background: 'var(--surface)',
      }}
    >
      {RANGE_CHOICES.map((days) => {
        const active = days === value;
        return (
          <button
            key={days}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(days)}
            className="focusable"
            style={{
              border: 0,
              background: active ? 'var(--merchant-brand)' : 'transparent',
              color: active ? '#fff' : 'var(--ink-2)',
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: 600,
              padding: '7px 14px',
              cursor: 'pointer',
            }}
          >
            {i18n._(msg`${days} días`)}
          </button>
        );
      })}
    </div>
  );
}

export default function InventoryCostingScreen() {
  const { t, i18n } = useLingui();
  const [range, setRange] = useState(DEFAULT_RANGE_DAYS);
  const [tab, setTab] = useState('costing');
  const [view, setView] = useState('costed');
  const [query, setQuery] = useState('');
  const [openPlate, setOpenPlate] = useState(null);
  const { capabilities } = useMerchant();

  const tabs = TABS.map((item) => ({ ...item, label: i18n._(item.label) }));

  const { data, loading, error, loaded } = useInventoryCosting(range);

  const summary = useMemo(() => summarizeDays(data.days), [data.days]);
  const groups = useMemo(() => splitPlates(data.plates), [data.plates]);
  const plateTable = useMemo(
    () => filterPlates(data.plates, { view, query }),
    [data.plates, view, query],
  );
  const forecast = useMemo(() => sortForecast(data.forecast), [data.forecast]);
  const forecastSummary = useMemo(() => forecastCounts(data.forecast), [data.forecast]);

  const tag = localeTag(i18n.locale);
  const dayLabel = (iso) =>
    formatBusinessDate(iso, tag, { weekday: 'short', day: 'numeric', month: 'short' }) ?? iso;
  const shortDate = (iso) =>
    formatBusinessDate(iso, tag, { day: 'numeric', month: 'short' }) ?? iso;
  const quantity = (value, scale) =>
    value == null ? null : formatNumber(value, { maximumFractionDigits: scale ?? 3 });
  const unitOf = (unit) => (UNIT_LABEL[unit] ? i18n._(UNIT_LABEL[unit]) : unit);
  const percentOf = (basisPoints) => {
    const percent = basisPointsToPercent(basisPoints);
    return percent == null ? null : `${formatNumber(percent, { maximumFractionDigits: 1 })} %`;
  };

  // The plate whose components are open. Read from the CURRENT payload rather than held
  // as an object, so a re-read (a range change) cannot leave a stale cost on screen.
  const selected = openPlate
    ? (data.plates.find(
        (plate) =>
          plate.productId === openPlate.productId && plate.variantId === openPlate.variantId,
      ) ?? null)
    : null;

  if (loading && !loaded) {
    return (
      <div className="fade-up" role="status" style={{ padding: 24, color: 'var(--ink-3)' }}>
        <Trans>Cargando el costo de lo que vendiste…</Trans>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fade-up card" style={{ padding: 20 }}>
        <div className="eyebrow">
          <Trans>Costos y márgenes</Trans>
        </div>
        <p style={{ margin: '8px 0 0', color: 'var(--ink-2)' }}>{error}</p>
      </div>
    );
  }

  const window = data.window;
  // ⚠️ THE BRANCH IS PART OF THE ANSWER. Two of the four reads are location-scoped, so a
  // "no sales in this period" here means "none AT THIS BRANCH" — and an owner looking at
  // the wrong branch would otherwise read a real zero as an empty business. The console
  // already puts the branch in its switcher; naming it here is what makes the zero
  // attributable. Verified live: Kalala's 38 sales are all at Chapultepec, so this screen
  // on Congreso truthfully shows none.
  const branchName = capabilities?.selectedLocation?.name ?? null;
  // `t` rather than a bare literal: a fallback written inside the template expression
  // never reaches the extractor, so it would ship in Spanish to an English operator.
  const branchWords = branchName ?? t`Todas las sucursales`;
  const windowWords = window
    ? i18n._(
        msg`${branchWords} · Del ${shortDate(window.from)} al ${shortDate(window.to)} · ${window.days} días`,
      )
    : null;

  // The costing panels live outside the return so the tab switch below stays one
  // readable expression. Their indentation is the fragment's own, and nothing in
  // them changed when the two new tabs arrived.
  const costingPanels = (
    <>
      {/* ── A day's numbers ─────────────────────────────────────────────────── */}
      <Section
        eyebrow={<Trans>Los números del día</Trans>}
        meta={
          summary.uncostedDays > 0 ? (
            <Trans>
              {summary.uncostedDays} de {summary.days} días con venta no tienen costo
            </Trans>
          ) : (
            <Trans>{summary.days} días con venta en el periodo</Trans>
          )
        }
      >
        <div className="grid grid-4" style={{ gap: 12 }}>
          <Stat
            label={<Trans>Venta neta</Trans>}
            value={formatMoney(summary.revenueMinor)}
            note={<Trans>Sin impuestos, tal como la mide el margen</Trans>}
          />
          <Stat
            label={<Trans>Costo de lo vendido</Trans>}
            value={formatMoney(summary.costMinor)}
            absent={summary.costMinor == null ? t`Sin costo` : null}
            note={
              summary.costMinor == null ? (
                <Trans>Faltan {summary.uncostedDays} días por costear</Trans>
              ) : (
                <Trans>Lo que costó lo que salió de la cocina</Trans>
              )
            }
          />
          <Stat
            label={<Trans>Margen</Trans>}
            value={formatMoney(summary.marginMinor)}
            absent={summary.marginMinor == null ? t`Sin margen` : null}
            note={
              summary.marginMinor == null ? (
                <Trans>No se publica un margen que no está completo</Trans>
              ) : (
                (percentOf(summary.marginBasisPoints) ?? '')
              )
            }
          />
          <Stat
            label={<Trans>Platillos vendidos</Trans>}
            value={formatNumber(summary.platesSold)}
            note={<Trans>{summary.salesCount} tickets</Trans>}
          />
        </div>

        {summary.uncostedDays > 0 ? (
          <div
            className="card"
            style={{
              padding: '13px 16px',
              borderColor: 'var(--warning)',
              display: 'grid',
              gap: 6,
            }}
          >
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              <Trans>
                Estas ventas no bajaron nada del inventario porque nadie registró qué consumen. Su
                costo es desconocido, no cero, así que el costo y el margen del periodo no se
                publican.
              </Trans>
            </div>
            {summary.uncostedProducts.length > 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                <Trans>
                  {summary.salesLinesWithoutMapping} líneas de venta sin receta ·{' '}
                  {summary.uncostedProducts.map((product) => product.productName).join(', ')}
                </Trans>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                <Trans>{summary.salesLinesWithoutMapping} líneas de venta sin receta</Trans>
              </div>
            )}
          </div>
        ) : null}

        {data.partial.includes('days') ? null : summary.days === 0 ? (
          <div className="card" style={{ padding: 18, color: 'var(--ink-2)' }}>
            {branchName ? (
              <Trans>No hay ventas registradas en {branchName} en este periodo.</Trans>
            ) : (
              <Trans>No hay ventas registradas en este periodo.</Trans>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th scope="col" style={CELL_HEAD}>
                    <Trans>Día</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Venta neta</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Costo</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Margen</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Margen %</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Tickets</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Platillos</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...data.days]
                  .sort((a, b) => (a.businessDate < b.businessDate ? 1 : -1))
                  .map((day) => {
                    const margin = dayMargin(day);
                    const percent = margin ? percentOf(margin.marginBasisPoints) : null;
                    const why =
                      day.uncostedProducts?.length > 0
                        ? i18n._(
                            msg`Sin receta: ${day.uncostedProducts
                              .map((product) => product.productName)
                              .join(', ')}`,
                          )
                        : null;
                    return (
                      <tr key={day.businessDate} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={CELL}>{dayLabel(day.businessDate)}</td>
                        <td style={{ ...CELL, textAlign: 'right' }}>
                          <Figures>{formatMoney(day.revenueMinor)}</Figures>
                        </td>
                        <td style={{ ...CELL, textAlign: 'right' }}>
                          {day.costMinor == null ? (
                            <NotCosted title={why}>
                              <Trans>Sin costo</Trans>
                            </NotCosted>
                          ) : (
                            <Figures>{formatMoney(day.costMinor)}</Figures>
                          )}
                        </td>
                        <td style={{ ...CELL, textAlign: 'right' }}>
                          {margin == null ? (
                            <span style={{ color: 'var(--ink-3)' }}>·</span>
                          ) : (
                            <Figures>{formatMoney(margin.marginMinor)}</Figures>
                          )}
                        </td>
                        <td style={{ ...CELL, textAlign: 'right' }}>
                          {percent == null ? (
                            <span style={{ color: 'var(--ink-3)' }}>·</span>
                          ) : (
                            <Figures>{percent}</Figures>
                          )}
                        </td>
                        <td style={{ ...CELL, textAlign: 'right' }}>
                          <Figures>{formatNumber(day.salesCount)}</Figures>
                        </td>
                        <td style={{ ...CELL, textAlign: 'right' }}>
                          <Figures>{formatNumber(day.platesSold)}</Figures>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── What one plate costs ────────────────────────────────────────────── */}
      <Section
        eyebrow={<Trans>Costo por platillo</Trans>}
        meta={
          <Trans>
            {groups.counts.all} platillos · {groups.counts.uncosted + groups.counts.notCosted} sin
            costo
          </Trans>
        }
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div
            role="group"
            aria-label={t`Vista de platillos`}
            style={{
              display: 'inline-flex',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-pill)',
              overflow: 'hidden',
              background: 'var(--surface)',
            }}
          >
            {PLATE_VIEWS.map((option) => {
              const count =
                option.id === 'costed'
                  ? groups.counts.costed
                  : option.id === 'uncosted'
                    ? groups.counts.uncosted + groups.counts.notCosted
                    : groups.counts.all;
              const active = option.id === view;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setView(option.id)}
                  className="focusable"
                  style={{
                    border: 0,
                    background: active ? 'var(--merchant-brand)' : 'transparent',
                    color: active ? '#fff' : 'var(--ink-2)',
                    fontFamily: 'inherit',
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: '7px 14px',
                    cursor: 'pointer',
                  }}
                >
                  {i18n._(option.label)} ({count})
                </button>
              );
            })}
          </div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t`Buscar un platillo`}
            aria-label={t`Buscar un platillo`}
            className="focusable"
            style={{
              flex: '1 1 180px',
              maxWidth: 280,
              padding: '7px 12px',
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              fontFamily: 'inherit',
              fontSize: 12.5,
            }}
          />
        </div>

        {data.partial.includes('plates') ? null : plateTable.rows.length === 0 ? (
          <div className="card" style={{ padding: 18, color: 'var(--ink-2)' }}>
            {query ? (
              <Trans>Ningún platillo coincide con esa búsqueda.</Trans>
            ) : view === 'costed' ? (
              <Trans>
                Ningún platillo tiene costo todavía. Mientras un insumo no se reciba, su precio se
                desconoce, y con él el de todos los platillos que lo usan.
              </Trans>
            ) : (
              <Trans>Todos los platillos del catálogo tienen costo.</Trans>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th scope="col" style={CELL_HEAD}>
                    <Trans>Platillo</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Precio</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Costo</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Margen</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Margen %</Trans>
                  </th>
                  <th scope="col" style={CELL_HEAD}>
                    <Trans>Estado</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {plateTable.rows.map((plate) => {
                  const margin = plateMargin(plate);
                  const percent = margin ? percentOf(margin.marginBasisPoints) : null;
                  const open =
                    selected?.productId === plate.productId &&
                    selected?.variantId === plate.variantId;
                  const missing = uncostedItemsOf(plate);
                  return (
                    <tr
                      key={`${plate.productId}:${plate.variantId ?? ''}`}
                      style={{
                        borderBottom: '1px solid var(--line)',
                        background: open ? 'var(--canvas-2)' : undefined,
                      }}
                    >
                      <td style={CELL}>
                        <button
                          type="button"
                          className="focusable"
                          aria-expanded={open}
                          onClick={() =>
                            setOpenPlate(
                              open
                                ? null
                                : { productId: plate.productId, variantId: plate.variantId },
                            )
                          }
                          style={{
                            border: 0,
                            background: 'transparent',
                            padding: 0,
                            font: 'inherit',
                            color: 'inherit',
                            textAlign: 'left',
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                        >
                          {plate.productName}
                          {plate.variantName ? (
                            <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>
                              {' '}
                              · {plate.variantName}
                            </span>
                          ) : null}
                        </button>
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>
                        <Figures>{formatMoney(plate.priceMinor)}</Figures>
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>
                        {plate.costMinor == null ? (
                          <NotCosted
                            title={
                              missing.length > 0
                                ? i18n._(
                                    msg`Sin precio: ${missing
                                      .map((item) => item.displayName)
                                      .join(', ')}`,
                                  )
                                : i18n._(DEFECT_LABEL[plate.defects[0]] ?? msg`Sin costo`)
                            }
                          >
                            <Trans>Sin costo</Trans>
                          </NotCosted>
                        ) : (
                          <Figures>{formatMoney(plate.costMinor)}</Figures>
                        )}
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>
                        {margin == null ? (
                          <span style={{ color: 'var(--ink-3)' }}>·</span>
                        ) : (
                          <Figures>{formatMoney(margin.marginMinor)}</Figures>
                        )}
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>
                        {percent == null ? (
                          <span style={{ color: 'var(--ink-3)' }}>·</span>
                        ) : (
                          <Figures>{percent}</Figures>
                        )}
                      </td>
                      <td style={CELL}>
                        <Chip tone={TONE[plate.state]}>
                          {plate.state === 'complete' ? (
                            <Trans>Completo</Trans>
                          ) : plate.state === 'incomplete' ? (
                            <Trans>Falta un precio</Trans>
                          ) : (
                            <Trans>Sin receta</Trans>
                          )}
                        </Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {selected ? (
          <PlateDetail
            plate={selected}
            window={window}
            quantity={quantity}
            unitOf={unitOf}
            percentOf={percentOf}
            shortDate={shortDate}
          />
        ) : null}
      </Section>

      {/* ── What is about to run out ────────────────────────────────────────── */}
      <Section
        eyebrow={<Trans>Se está acabando</Trans>}
        meta={
          <Trans>
            {forecastSummary.below} bajo el mínimo · {forecastSummary.noHistory} sin consumo
            registrado
          </Trans>
        }
      >
        {data.partial.includes('basis') && forecast.length === 0 ? null : forecast.length === 0 ? (
          <div className="card" style={{ padding: 18, color: 'var(--ink-2)' }}>
            <Trans>No hay insumos con existencia registrada.</Trans>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th scope="col" style={CELL_HEAD}>
                    <Trans>Insumo</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Existencia</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Usado</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Por día</Trans>
                  </th>
                  <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    <Trans>Alcanza</Trans>
                  </th>
                  <th scope="col" style={CELL_HEAD}>
                    <Trans>Estado</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {forecast.map((item) => (
                  <tr key={item.inventoryItemId} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={CELL}>
                      <div style={{ fontWeight: 600 }}>{item.displayName}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {item.publicReference}
                      </div>
                    </td>
                    <td style={{ ...CELL, textAlign: 'right' }}>
                      <Figures>
                        {quantity(scaledToNumber(item.onHand), item.quantityScale)}{' '}
                        {unitOf(item.baseUnit)}
                      </Figures>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {item.onHandValueMinor == null ? (
                          <Trans>sin costo base</Trans>
                        ) : (
                          formatMoney(item.onHandValueMinor)
                        )}
                      </div>
                    </td>
                    <td style={{ ...CELL, textAlign: 'right' }}>
                      <Figures>
                        {quantity(scaledToNumber(item.consumedQuantity), item.quantityScale)}{' '}
                        {unitOf(item.baseUnit)}
                      </Figures>
                    </td>
                    <td style={{ ...CELL, textAlign: 'right' }}>
                      {item.dailyRateQuantity == null ? (
                        <span style={{ color: 'var(--ink-3)' }}>
                          <Trans>sin consumo</Trans>
                        </span>
                      ) : (
                        <Figures>
                          {quantity(scaledToNumber(item.dailyRateQuantity), item.quantityScale)}{' '}
                          {unitOf(item.baseUnit)}
                        </Figures>
                      )}
                    </td>
                    <td style={{ ...CELL, textAlign: 'right' }}>
                      {item.daysOfCover == null ? (
                        <span style={{ color: 'var(--ink-3)' }}>·</span>
                      ) : (
                        <Figures>
                          <Plural value={item.daysOfCover} one="# día" other="# días" />
                        </Figures>
                      )}
                    </td>
                    <td style={CELL}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {item.belowThreshold ? (
                          <Chip tone="susp">
                            <Trans>Bajo el mínimo</Trans>
                          </Chip>
                        ) : null}
                        {item.insufficientHistory ? (
                          <span
                            title={i18n._(
                              msg`Sólo hay ${item.daysWithConsumption} días de consumo en ${data.window?.days ?? 28}.`,
                            )}
                          >
                            <Chip tone="trial">
                              <Trans>Historial corto</Trans>
                            </Chip>
                          </span>
                        ) : null}
                        {!item.belowThreshold && !item.insufficientHistory ? (
                          <Chip tone="neutral">
                            <Trans>Sin alerta</Trans>
                          </Chip>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          <Trans>
            El ritmo divide entre los días en que el insumo realmente se usó, no entre todo el
            periodo: un insumo que empezó a usarse hace cuatro días no tiene 28 días de historia.
          </Trans>
        </div>
      </Section>

      {/* ── Where the cost comes from ───────────────────────────────────────── */}
      <Section
        eyebrow={<Trans>De dónde sale el costo</Trans>}
        meta={
          <Trans>
            {data.basis.length} insumos ·{' '}
            {data.basis.filter((item) => item.unitCostMinor == null).length} sin recepciones
          </Trans>
        }
      >
        {data.partial.includes('basis') ? (
          <div className="card" style={{ padding: 18, color: 'var(--ink-2)' }}>
            <Trans>No se pudo leer la base del costo.</Trans>
          </div>
        ) : data.basis.length === 0 ? (
          <div className="card" style={{ padding: 18, color: 'var(--ink-2)' }}>
            <Trans>Este negocio no tiene insumos en inventario todavía.</Trans>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              <Trans>
                El costo de un insumo es el promedio ponderado de lo que realmente se pagó al
                recibirlo, no lo que se pidió. Un insumo sin recepciones no tiene precio, y por eso
                no aparece como cero.
              </Trans>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)' }}>
                    <th scope="col" style={CELL_HEAD}>
                      <Trans>Insumo</Trans>
                    </th>
                    <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                      <Trans>Costo unitario</Trans>
                    </th>
                    <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                      <Trans>Recepciones</Trans>
                    </th>
                    <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                      <Trans>Del más barato al más caro</Trans>
                    </th>
                    <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                      <Trans>Recibido</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.basis.map((item) => (
                    <tr
                      key={item.inventoryItemId}
                      style={{ borderBottom: '1px solid var(--line)' }}
                    >
                      <td style={CELL}>
                        <div>{item.displayName}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {item.publicReference}
                        </div>
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>
                        {item.unitCostMinor == null ? (
                          <NotCosted>
                            <Trans>Sin precio</Trans>
                          </NotCosted>
                        ) : (
                          <Figures>
                            {formatMoney(item.unitCostMinor)}
                            <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>
                              {' / '}
                              {item.baseUnit}
                            </span>
                          </Figures>
                        )}
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>
                        <Figures>{formatNumber(item.receiptLineCount)}</Figures>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {item.receiptCount === 1 ? (
                            <Trans>{item.receiptCount} compra</Trans>
                          ) : (
                            <Trans>{item.receiptCount} compras</Trans>
                          )}
                        </div>
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>
                        {item.lowestUnitCostMinor == null || item.highestUnitCostMinor == null ? (
                          <span style={{ color: 'var(--ink-3)' }}>·</span>
                        ) : item.lowestUnitCostMinor === item.highestUnitCostMinor ? (
                          <Figures>{formatMoney(item.lowestUnitCostMinor)}</Figures>
                        ) : (
                          <Figures>
                            {formatMoney(item.lowestUnitCostMinor)}
                            <span style={{ color: 'var(--ink-3)' }}> – </span>
                            {formatMoney(item.highestUnitCostMinor)}
                          </Figures>
                        )}
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>
                        <Figures>
                          {quantity(scaledToNumber(item.receivedQuantity), item.quantityScale)}{' '}
                          {unitOf(item.baseUnit)}
                        </Figures>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </>
  );

  return (
    <div className="fade-up" style={{ display: 'grid', gap: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
          {windowWords ?? <Trans>Sin periodo</Trans>}
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      {data.partial.length > 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            color: 'var(--warning)',
          }}
        >
          <Trans>
            No se pudieron leer todas las cifras de este periodo. Falta: {data.partial.join(', ')}.
          </Trans>
        </div>
      ) : null}

      <HubTabs tabs={tabs} active={tab} onChange={setTab} ariaLabel={t`Costos y márgenes`} />

      {tab === 'variance' ? (
        <UsageVarianceTab period={data.window} />
      ) : tab === 'menu' ? (
        <MenuEngineeringTab period={data.window} />
      ) : (
        costingPanels
      )}
    </div>
  );
}

const CELL = { padding: '9px 10px', verticalAlign: 'top' };
const CELL_HEAD = {
  padding: '0 10px 8px',
  textAlign: 'left',
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--ink-3)',
};

/**
 * One plate, opened: what it costs, what it is made of, and what left the shelf because
 * of it. The two component groups are kept apart on purpose — `modifier_component` rows
 * are stock a SALE consumed that the base recipe does not name, so their quantity is
 * zero per plate and their money is in the day's cost of goods. Adding them to the
 * recipe cost would double-count them; hiding them would hide real consumption.
 */
function PlateDetail({ plate, window, quantity, unitOf, percentOf, shortDate }) {
  const { t, i18n } = useLingui();
  const margin = plateMargin(plate);
  const percent = margin ? percentOf(margin.marginBasisPoints) : null;
  const parts = plateComponents(plate);
  const missing = uncostedItemsOf(plate);

  return (
    <div
      className="card"
      style={{ padding: 18, display: 'grid', gap: 14, borderColor: 'var(--line-strong)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="eyebrow">
            <Trans>Costo del platillo</Trans>
          </div>
          <h2 className="h-section" style={{ marginTop: 4 }}>
            {plate.productName}
            {plate.variantName ? ` · ${plate.variantName}` : ''}
          </h2>
        </div>
        {window ? (
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            {i18n._(msg`Consumo del ${shortDate(window.from)} al ${shortDate(window.to)}`)}
          </div>
        ) : null}
      </div>

      <div className="grid grid-4" style={{ gap: 12 }}>
        <Stat label={<Trans>Precio</Trans>} value={formatMoney(plate.priceMinor)} />
        <Stat
          label={<Trans>Costo</Trans>}
          value={formatMoney(plate.costMinor)}
          absent={plate.costMinor == null ? t`Sin costo` : null}
        />
        <Stat
          label={<Trans>Margen</Trans>}
          value={formatMoney(margin?.marginMinor ?? null)}
          absent={margin == null ? t`Sin margen` : null}
        />
        <Stat
          label={<Trans>Margen %</Trans>}
          value={percent}
          absent={percent == null ? t`Sin margen` : null}
        />
      </div>

      {plate.costMinor == null ? (
        <div
          style={{
            border: '1px solid var(--warning)',
            borderRadius: 10,
            padding: '12px 14px',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
            {missing.length > 0 ? (
              /* `<Plural>` and not a ternary: a literal written inside a JSX expression
                 never reaches the extractor, so `insumo`/`insumos` shipped in Spanish to
                 an English operator — the same defect as a hardcoded string, wearing a
                 translation's clothes. Caught by reading the rendered card, not the code. */
              <Plural
                value={missing.length}
                one="Este platillo no se puede costear. Falta el precio de # insumo:"
                other="Este platillo no se puede costear. Falta el precio de # insumos:"
              />
            ) : (
              <Trans>
                Este platillo no se puede costear todavía. La razón está abajo, y no se muestra un
                margen que no se puede calcular.
              </Trans>
            )}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            {missing.map((item) => (
              <li key={item.inventoryItemId} style={{ fontSize: 12.5 }}>
                <b>{item.displayName}</b>
                <span style={{ color: 'var(--ink-3)' }}> · {item.publicReference}</span>
                <div style={{ color: 'var(--ink-2)' }}>
                  {i18n._(DEFECT_LABEL[item.defect] ?? msg`Sin costo`)}
                </div>
                <div style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>
                  {i18n._(DEFECT_FIX[item.defect] ?? msg`Registra su precio.`)}
                </div>
              </li>
            ))}
          </ul>
          {missing.length === 0
            ? (plate.defects ?? []).map((defect) => (
                <div key={defect} style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                  {i18n._(DEFECT_LABEL[defect] ?? msg`Sin costo`)} —{' '}
                  {i18n._(DEFECT_FIX[defect] ?? msg`Registra su precio.`)}
                </div>
              ))
            : null}
        </div>
      ) : null}

      {parts.recipe.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th scope="col" style={CELL_HEAD}>
                  <Trans>Insumo</Trans>
                </th>
                <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                  <Trans>Por platillo</Trans>
                </th>
                <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                  <Trans>Costo unitario</Trans>
                </th>
                <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                  <Trans>Costo de la línea</Trans>
                </th>
                <th scope="col" style={{ ...CELL_HEAD, textAlign: 'right' }}>
                  <Trans>Consumido en el periodo</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {parts.recipe.map((component) => (
                <tr
                  key={`${component.inventoryItemId}:${component.source}`}
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <td style={CELL}>
                    <div>{component.displayName}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      {component.publicReference}
                    </div>
                  </td>
                  <td style={{ ...CELL, textAlign: 'right' }}>
                    {quantity(scaledToNumber(component.quantity), component.quantity.scale)}{' '}
                    {unitOf(component.quantity.unit)}
                  </td>
                  <td style={{ ...CELL, textAlign: 'right' }}>
                    {component.unitCostMinor == null ? (
                      <NotCosted>
                        <Trans>Sin precio</Trans>
                      </NotCosted>
                    ) : (
                      <Figures>
                        {formatMoney(component.unitCostMinor)}
                        <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>
                          {' / '}
                          {unitOf(component.quantity.unit)}
                        </span>
                      </Figures>
                    )}
                  </td>
                  <td style={{ ...CELL, textAlign: 'right' }}>
                    {component.lineCostMinor == null ? (
                      <span style={{ color: 'var(--ink-3)' }}>·</span>
                    ) : (
                      <Figures>{formatMoney(component.lineCostMinor)}</Figures>
                    )}
                  </td>
                  <td style={{ ...CELL, textAlign: 'right' }}>
                    <Figures>
                      {quantity(
                        scaledToNumber(component.consumedQuantity),
                        component.consumedQuantity.scale,
                      )}{' '}
                      {unitOf(component.consumedQuantity.unit)}
                    </Figures>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {parts.fromSales.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="eyebrow">
            <Trans>Consumido por las ventas, fuera de la receta</Trans>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            <Trans>
              Estas porciones extra no son parte del costo de la receta; su dinero está en el costo
              del día.
            </Trans>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <tbody>
              {parts.fromSales.map((component) => (
                <tr
                  key={component.inventoryItemId}
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <td style={CELL}>{component.displayName}</td>
                  <td style={{ ...CELL, textAlign: 'right' }}>
                    <Figures>
                      {quantity(
                        scaledToNumber(component.consumedQuantity),
                        component.consumedQuantity.scale,
                      )}{' '}
                      {unitOf(component.consumedQuantity.unit)}
                    </Figures>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
