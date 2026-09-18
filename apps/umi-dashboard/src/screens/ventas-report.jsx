import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { useSalesSummary, useSalesInsight } from '@/data.jsx';
import { formatOperationMoney } from './operations-format.js';
import Recibos from './recibos.jsx';

// Reportes → Ventas. Archetype: Board.
//
// The masthead owns the page name, so this screen does not write it again. Below
// the masthead the screen holds a view row, then the numbers:
//
//   1. Ventas netas is the ONE lead figure. Five supporting facts sit in a lower
//      layer, under one divider.
//   2. The chart, the mixes and the pivot follow in that order of use.
//
// The screen uses three type sizes: 40 for the lead figure, then 13.5 and 11.5.
// The old screen showed six KPI cards of equal weight. Equal weight is not a
// hierarchy, and the audit measured it as fault F5.
//
// Colour is a language here. The mixes use ONE hue in four steps, because a
// status colour must never carry a category, and green stays for status alone. A
// measured fall takes the danger tone, because a fall is the value that needs an
// eye. Every mix row carries its name and its number, so the colour is never the
// only signal.
//
// Read-only, and reconciled to the same committed sales as Recibos (ADR
// 2026-09-08).

const RANGES = [
  { id: 'today', label: msg`Hoy` },
  { id: 'yesterday', label: msg`Ayer` },
  { id: 'last_7_days', label: msg`7 días` },
  { id: 'last_30_days', label: msg`30 días` },
];
const METHOD_LABEL = { cash: msg`Efectivo`, manual_terminal: msg`Terminal manual` };
const CHANNEL_LABEL = {
  walk_in: msg`Mostrador`,
  whatsapp: msg`WhatsApp`,
  web: msg`Web`,
  aggregator: msg`Reparto`,
};

/**
 * One hue in four steps. A category is not a status, so it may not borrow a
 * status colour. The first step is the merchant brand; the rest are ink, so the
 * scale survives greyscale.
 */
const TONES = ['var(--merchant-brand)', 'var(--ink-2)', 'var(--ink-4)', 'var(--line-strong)'];

/** A work panel. One surface, one job, and no second box inside it. */
function Panel({ title, children, style }) {
  return (
    <section
      className="surface"
      style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, ...style }}
    >
      {title ? (
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{title}</div>
      ) : null}
      {children}
    </section>
  );
}

/** One supporting fact: a quiet label over one figure. */
function Fact({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{label}</div>
      <div
        className="figures"
        style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)', marginTop: 4 }}
      >
        {value}
      </div>
    </div>
  );
}

function SeriesChart({ series, bucket, currency }) {
  const { t } = useLingui();
  if (!series.length) return null;
  const max = Math.max(...series.map((p) => p.amountMinorUnits), 1);
  const peak = series.reduce(
    (b, p, i) => (p.amountMinorUnits > series[b].amountMinorUnits ? i : b),
    0,
  );
  return (
    <Panel title={bucket === 'hour' ? <Trans>Venta por hora</Trans> : <Trans>Venta por día</Trans>}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          height: 160,
          overflowX: 'auto',
          borderBottom: '1px solid var(--line)',
          paddingBottom: 4,
        }}
        role="img"
        aria-label={t`Serie de ventas del periodo`}
      >
        {series.map((p, i) => (
          <div
            key={p.label}
            style={{
              flex: '1 0 24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div
                title={`${p.label} · ${formatOperationMoney(p.amountMinorUnits, currency)}`}
                style={{
                  width: '100%',
                  height: `${Math.max((p.amountMinorUnits / max) * 100, 2)}%`,
                  minHeight: 2,
                  borderRadius: '4px 4px 0 0',
                  background:
                    i === peak ? TONES[0] : `color-mix(in srgb, ${TONES[0]} 30%, var(--surface))`,
                }}
              />
            </div>
            <div
              className="figures"
              style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}
            >
              {bucket === 'day' ? p.label.slice(5) : p.label}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** A mix: one proportion bar, then one row for each part. */
function Mix({ title, parts, labelOf, currency }) {
  const { i18n } = useLingui();
  // No parts means no mix. A title over an empty bar is a box that holds nothing.
  // The figures and the table already carry the zeroed shape of the period.
  if (!parts.length) return null;
  const total = parts.reduce((s, p) => s + p.amountMinorUnits, 0) || 1;
  return (
    <Panel title={title}>
      <div style={{ display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden' }}>
        {parts.map((p, i) => (
          <div
            key={p.key}
            style={{
              width: `${(p.amountMinorUnits / total) * 100}%`,
              background: TONES[i % TONES.length],
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {parts.map((p, i) => (
          <div
            key={p.key}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: TONES[i % TONES.length],
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>{i18n._(labelOf(p))}</span>
            <span
              className="figures"
              style={{ color: 'var(--ink-3)', width: 40, textAlign: 'right' }}
            >
              {Math.round((p.amountMinorUnits / total) * 100)}%
            </span>
            <span className="figures" style={{ fontWeight: 600, width: 104, textAlign: 'right' }}>
              {formatOperationMoney(p.amountMinorUnits, currency)}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// Committed revenue by origin channel. Until the POS links WhatsApp orders, every
// sale is walk_in. One bar would then misreport the mix. Show an honest "coming"
// state instead of a fake split (ADR 2026-09-13-pos-channel-attribution, section
// 6). Revenue is frozen in receipt_snapshot, so it reconciles to net sales.
function ChannelMix({ channelMix, currency }) {
  const attributed = channelMix.some((c) => c.channel !== 'walk_in');
  if (!attributed) {
    return (
      <Panel title={<Trans>Canal de venta</Trans>}>
        <div style={{ color: 'var(--ink-2)', fontSize: 13.5, maxWidth: '70ch' }}>
          <Trans>
            La atribución por canal se activa cuando el punto de venta enlaza los pedidos de
            WhatsApp. Mientras tanto, las ventas cuentan como mostrador.
          </Trans>
        </div>
      </Panel>
    );
  }
  return (
    <Mix
      title={<Trans>Canal de venta</Trans>}
      parts={channelMix.map((c) => ({ ...c, key: c.channel }))}
      labelOf={(p) => CHANNEL_LABEL[p.channel] || p.channel}
      currency={currency}
    />
  );
}

/** The pivot: group by producto, categoría, barista or hour. Sortable columns. */
function Pivot({ productMix, byOperator, byHour, currency }) {
  const { t } = useLingui();
  const [groupBy, setGroupBy] = useState('producto');
  const [sort, setSort] = useState({ col: 'net', dir: 'desc' });

  const rows =
    groupBy === 'producto'
      ? productMix.map((p) => ({
          key: p.productName,
          sub: p.category,
          units: p.units,
          net: p.netMinorUnits,
        }))
      : groupBy === 'categoria'
        ? Object.values(
            productMix.reduce((acc, p) => {
              const k = p.category || '—';
              acc[k] = acc[k] || { key: k, sub: null, units: 0, net: 0 };
              acc[k].units += p.units;
              acc[k].net += p.netMinorUnits;
              return acc;
            }, {}),
          )
        : groupBy === 'barista'
          ? byOperator.map((r) => ({ key: r.key, sub: null, units: r.units, net: r.netMinorUnits }))
          : byHour.map((r) => ({ key: r.key, sub: null, units: r.units, net: r.netMinorUnits }));
  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  // Denominator only — never shown. Guards the % column against divide-by-zero on
  // an empty period; the Total row itself shows the real net (0), not this
  // 1-minor-unit placeholder.
  const pctDenom = totalNet || 1;
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const mul = sort.dir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) =>
    sort.col === 'key'
      ? mul * String(a.key).localeCompare(b.key, 'es')
      : mul * (a[sort.col] - b[sort.col]),
  );
  const GROUPS = [
    { id: 'producto', label: <Trans>Producto</Trans> },
    { id: 'categoria', label: <Trans>Categoría</Trans> },
    { id: 'barista', label: <Trans>Barista</Trans> },
    { id: 'hora', label: <Trans>Hora</Trans> },
  ];
  const keyLabel =
    groupBy === 'producto' ? (
      <Trans>Producto</Trans>
    ) : groupBy === 'categoria' ? (
      <Trans>Categoría</Trans>
    ) : groupBy === 'barista' ? (
      <Trans>Barista</Trans>
    ) : (
      <Trans>Hora</Trans>
    );

  const headStyle = {
    padding: '12px 12px',
    fontWeight: 600,
    color: 'var(--ink-3)',
    fontSize: 11.5,
    whiteSpace: 'nowrap',
  };
  // The head is a real button, so the sort is reachable from the keyboard. The
  // button inherits the reset, so the head keeps its plain look.
  const th = (col, node, alignRight, ariaSort) => {
    const active = sort.col === col;
    return (
      <th
        aria-sort={ariaSort}
        style={{
          ...headStyle,
          textAlign: alignRight ? 'right' : 'left',
          color: active ? 'var(--ink-1)' : 'var(--ink-3)',
        }}
      >
        <button
          type="button"
          className="focusable"
          onClick={() =>
            setSort((s) =>
              s.col === col
                ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                : { col, dir: col === 'key' ? 'asc' : 'desc' },
            )
          }
          style={{ ...headStyle, padding: 0, textAlign: 'inherit', color: 'inherit' }}
        >
          {node} {active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
        </button>
      </th>
    );
  };

  return (
    <section className="surface" style={{ overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--line)',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          <Trans>Agrupar por</Trans>
        </span>
        <div className="seg" role="group" aria-label={t`Agrupar por`}>
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={groupBy === g.id ? 'on' : ''}
              aria-pressed={groupBy === g.id}
              onClick={() => setGroupBy(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13.5,
            minWidth: 480,
          }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line-strong)' }}>
              {th(
                'key',
                keyLabel,
                false,
                sort.col === 'key' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
              )}
              {groupBy === 'producto' ? (
                <th style={{ ...headStyle, textAlign: 'left' }}>
                  <Trans>Categoría</Trans>
                </th>
              ) : null}
              {th(
                'units',
                <Trans>Unidades</Trans>,
                true,
                sort.col === 'units' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
              )}
              {th(
                'net',
                <Trans>Venta neta</Trans>,
                true,
                sort.col === 'net' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
              )}
              <th style={{ ...headStyle, textAlign: 'right' }}>
                <Trans>% del total</Trans>
              </th>
            </tr>
          </thead>
          <tbody className="figures">
            {sorted.map((r) => (
              <tr key={r.key} style={{ borderTop: '1px solid var(--line-soft)' }}>
                <td style={{ padding: '12px 12px', fontWeight: 600 }}>{r.key}</td>
                {groupBy === 'producto' ? (
                  <td style={{ padding: '12px 12px', color: 'var(--ink-3)' }}>{r.sub || '—'}</td>
                ) : null}
                <td style={{ padding: '12px 12px', textAlign: 'right' }}>{r.units}</td>
                <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                  {formatOperationMoney(r.net, currency)}
                </td>
                <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                  {Math.round((r.net / pctDenom) * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr
              style={{
                borderTop: '1px solid var(--line-strong)',
                fontWeight: 600,
                background: 'var(--canvas-2)',
              }}
            >
              <td style={{ padding: '12px 12px' }}>
                <Trans>Total</Trans>
              </td>
              {groupBy === 'producto' ? <td /> : null}
              <td style={{ padding: '12px 12px', textAlign: 'right' }}>{totalUnits}</td>
              <td style={{ padding: '12px 12px', textAlign: 'right' }}>
                {formatOperationMoney(totalNet, currency)}
              </td>
              <td style={{ padding: '12px 12px', textAlign: 'right' }}>100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

export default function VentasReport() {
  const { t, i18n } = useLingui();
  const [range, setRange] = useState('today');
  const [view, setView] = useState('resumen');
  const [refresh, setRefresh] = useState(0);
  const { data, loading, loaded, error } = useSalesSummary(range, refresh);
  // Optional AI narrative over the same range. Fail-safe: hidden until it returns text.
  const insight = useSalesInsight(range, refresh);

  const totals = data?.totals;
  const currency = data?.currency || 'MXN';
  const net = totals?.netSalesMinorUnits ?? 0;
  const prior = totals?.priorNetSalesMinorUnits ?? null;
  const delta = prior && prior > 0 ? (net - prior) / prior : null;
  // The chart and the mixes draw only when the period holds something to draw.
  const hasSeries = (data?.series || []).length > 0;
  const hasMix = (data?.paymentMix || []).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* The view row. A segmented control carries the mode, and it does not use
          the primary button: the screen has one primary action at most, and a
          selected segment is a state and not a call to action. */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* The range drives the aggregate and not the receipt list; hide it in
            Recibos, which carries its own view of committed receipts. */}
        {view !== 'recibos' ? (
          <div className="seg" role="group" aria-label={t`Rango de fechas`}>
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={range === r.id ? 'on' : ''}
                aria-pressed={range === r.id}
                onClick={() => setRange(r.id)}
              >
                {i18n._(r.label)}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="seg" role="group" aria-label={t`Vista`}>
          <button
            type="button"
            className={view === 'resumen' ? 'on' : ''}
            aria-pressed={view === 'resumen'}
            onClick={() => setView('resumen')}
          >
            <Trans>Resumen</Trans>
          </button>
          <button
            type="button"
            className={view === 'pivot' ? 'on' : ''}
            aria-pressed={view === 'pivot'}
            onClick={() => setView('pivot')}
          >
            <Trans>Tabla dinámica</Trans>
          </button>
          <button
            type="button"
            className={view === 'recibos' ? 'on' : ''}
            aria-pressed={view === 'recibos'}
            onClick={() => setView('recibos')}
          >
            <Trans>Recibos</Trans>
          </button>
        </div>
      </div>

      {view === 'recibos' ? (
        <Recibos />
      ) : error ? (
        <div
          className="surface"
          style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px' }}
        >
          <I.AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--ink-2)' }}>
            <Trans>No se pudo cargar el reporte de ventas.</Trans>
          </span>
          {/* A failure names itself and offers the way back. A dead end is not a
              finished state. */}
          <button
            className="btn btn-secondary btn-sm focusable"
            onClick={() => setRefresh((r) => r + 1)}
          >
            <I.Refresh size={13} /> <Trans>Reintentar</Trans>
          </button>
        </div>
      ) : loading && !loaded ? (
        // The loading state holds the shape of the coming content, so the page
        // does not jump when the numbers arrive. It never claims a fact first.
        <div
          className="surface"
          style={{ padding: 24 }}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">
            <Trans>Cargando ventas…</Trans>
          </span>
          <div
            aria-hidden="true"
            style={{ height: 12, width: 120, background: 'var(--canvas-2)', borderRadius: 4 }}
          />
          <div
            aria-hidden="true"
            style={{
              height: 40,
              width: 220,
              background: 'var(--canvas-2)',
              borderRadius: 4,
              marginTop: 12,
            }}
          />
          <div
            aria-hidden="true"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 16,
              marginTop: 24,
              paddingTop: 16,
              borderTop: '1px solid var(--line-soft)',
            }}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i}>
                <div
                  style={{
                    height: 12,
                    width: '60%',
                    background: 'var(--canvas-2)',
                    borderRadius: 4,
                  }}
                />
                <div
                  style={{
                    height: 16,
                    width: '40%',
                    background: 'var(--canvas-2)',
                    borderRadius: 4,
                    marginTop: 8,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : view === 'pivot' ? (
        // An empty period is NOT a dead end: the report still renders, just zeroed —
        // the lead figure shows 0 and the table shows its columns with a 0 total, so
        // the owner always sees the shape of the report instead of a bare "no sales"
        // message.
        <Pivot
          productMix={data?.productMix || []}
          byOperator={data?.byOperator || []}
          byHour={data?.byHour || []}
          currency={currency}
        />
      ) : (
        <>
          {/* The lead figure, then the facts that support it, inside ONE surface. */}
          <section className="surface">
            <div style={{ padding: 24 }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                <Trans>Ventas netas</Trans>
              </div>
              <div
                className="figures"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 600,
                  fontSize: 40,
                  lineHeight: 1,
                  letterSpacing: 0,
                  color: 'var(--ink-1)',
                  marginTop: 8,
                }}
              >
                {formatOperationMoney(net, currency)}
              </div>
              {delta != null ? (
                <div
                  style={{
                    fontSize: 13.5,
                    color: delta < 0 ? 'var(--danger)' : 'var(--ink-2)',
                    marginTop: 8,
                  }}
                >
                  {delta >= 0 ? '↑ ' : '↓ '}
                  {Math.abs(delta * 100).toFixed(1)}% · <Trans>vs. período anterior</Trans>
                </div>
              ) : null}
            </div>

            <div
              className="surface-divide"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 16,
                padding: '16px 24px',
              }}
            >
              <Fact label={<Trans>Órdenes</Trans>} value={totals?.orders ?? 0} />
              <Fact
                label={<Trans>Ticket promedio</Trans>}
                value={formatOperationMoney(totals?.averageTicketMinorUnits ?? 0, currency)}
              />
              <Fact label={<Trans>Ítems vendidos</Trans>} value={totals?.itemsSold ?? 0} />
              <Fact
                label={<Trans>Descuentos</Trans>}
                value={formatOperationMoney(totals?.discountMinorUnits ?? 0, currency)}
              />
              <Fact
                label={<Trans>Propinas</Trans>}
                value={formatOperationMoney(totals?.tipsMinorUnits ?? 0, currency)}
              />
            </div>
          </section>

          {/* The answer in words, over the same range. Fail-safe: it renders only
              when the model returned a grounded sentence. */}
          {insight.data?.narrative ? (
            <Panel title={<Trans>Resumen del periodo</Trans>}>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                {insight.data.narrative}
              </p>
            </Panel>
          ) : null}

          {/* One column when only one of the two graphics has data, so the other
              half of the row never stands empty. */}
          {hasSeries || hasMix ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  hasSeries && hasMix ? 'minmax(0, 1.6fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
                gap: 24,
              }}
              className="ventas-grid"
            >
              <SeriesChart series={data?.series || []} bucket={data?.bucket} currency={currency} />
              <Mix
                title={<Trans>Método de pago</Trans>}
                parts={(data?.paymentMix || []).map((p) => ({ ...p, key: p.method }))}
                labelOf={(p) => METHOD_LABEL[p.method] || p.method}
                currency={currency}
              />
            </div>
          ) : null}

          <ChannelMix channelMix={data?.channelMix || []} currency={currency} />

          <Pivot
            productMix={data?.productMix || []}
            byOperator={data?.byOperator || []}
            byHour={data?.byHour || []}
            currency={currency}
          />
        </>
      )}
    </div>
  );
}
