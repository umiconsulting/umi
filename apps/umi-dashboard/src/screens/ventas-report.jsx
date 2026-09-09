import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useSalesSummary } from '@/data.jsx';
import { formatOperationMoney } from './operations-format.js';
import Recibos from './recibos.jsx';

// Reportes → Ventas — the commercial cockpit, from the real sales aggregate
// (/operations/reports/sales). Resumen (KPI cards + chart + mixes) and a working Tabla
// dinámica (group by producto/categoría, sortable), all reconciled to the same committed
// sales. Read-only. A third view, Recibos, re-homes the receipt/print-custody list here
// (ADR 2026-09-08): print custody is a facet of the sale, not its own nav destination.

const RANGES = [
  { id: 'today', label: msg`Hoy` },
  { id: 'yesterday', label: msg`Ayer` },
  { id: 'last_7_days', label: msg`7 días` },
  { id: 'last_30_days', label: msg`30 días` },
];
const METHOD_LABEL = { cash: msg`Efectivo`, manual_terminal: msg`Terminal manual` };
const METHOD_COLOR = { cash: 'var(--success)', manual_terminal: 'var(--merchant-brand)' };

/** A boxed KPI tile: label, big mono value, and an optional delta or meta line. */
function Kpi({ label, value, delta, deltaTone, meta }) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: '14px 16px',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div className="eyebrow">{label}</div>
      <div
        className="figures"
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          fontSize: 24,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: 'var(--ink-3)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        {delta ? (
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: deltaTone }}>
            {delta}
          </span>
        ) : null}
        {meta ? <span>{meta}</span> : null}
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
    <section
      style={{
        border: '1px solid var(--line)',
        borderRadius: 14,
        background: 'var(--surface)',
        padding: '16px 18px',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        {bucket === 'hour' ? <Trans>Venta por hora</Trans> : <Trans>Venta por día</Trans>}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 6,
          height: 150,
          overflowX: 'auto',
          borderBottom: '1px solid var(--line)',
          paddingBottom: 2,
        }}
        role="img"
        aria-label={t`Serie de ventas del periodo`}
      >
        {series.map((p, i) => (
          <div
            key={p.label}
            style={{
              flex: '1 0 22px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div
                title={`${p.label} · ${formatOperationMoney(p.amountMinorUnits, currency)}`}
                style={{
                  width: '100%',
                  height: `${Math.max((p.amountMinorUnits / max) * 100, 2)}%`,
                  minHeight: 2,
                  borderRadius: '5px 5px 0 0',
                  background:
                    i === peak
                      ? 'var(--merchant-brand)'
                      : 'color-mix(in srgb, var(--merchant-brand) 22%, transparent)',
                }}
              />
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--ink-3)',
                whiteSpace: 'nowrap',
              }}
            >
              {bucket === 'day' ? p.label.slice(5) : p.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PaymentMix({ paymentMix, currency }) {
  const { i18n } = useLingui();
  const total = paymentMix.reduce((s, p) => s + p.amountMinorUnits, 0) || 1;
  return (
    <section
      style={{
        border: '1px solid var(--line)',
        borderRadius: 14,
        background: 'var(--surface)',
        padding: '16px 18px',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        <Trans>Método de pago</Trans>
      </div>
      <div
        style={{
          display: 'flex',
          height: 12,
          borderRadius: 6,
          overflow: 'hidden',
          marginBottom: 14,
        }}
      >
        {paymentMix.map((p) => (
          <div
            key={p.method}
            style={{
              width: `${(p.amountMinorUnits / total) * 100}%`,
              background: METHOD_COLOR[p.method] || 'var(--ink-3)',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {paymentMix.map((p) => (
          <div
            key={p.method}
            style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5 }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: METHOD_COLOR[p.method] || 'var(--ink-3)',
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1 }}>{i18n._(METHOD_LABEL[p.method] || p.method)}</span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--ink-3)',
                width: 46,
                textAlign: 'right',
              }}
            >
              {Math.round((p.amountMinorUnits / total) * 100)}%
            </span>
            <span
              className="figures"
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                width: 110,
                textAlign: 'right',
              }}
            >
              {formatOperationMoney(p.amountMinorUnits, currency)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The pivot: group by producto or categoría (both from productMix), sortable columns. */
function Pivot({ productMix, byOperator, byHour, currency }) {
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
  // Denominator only — never shown. Guards the % column against divide-by-zero on an empty
  // period; the Total row itself shows the real net (0), not this 1-minor-unit placeholder.
  const pctDenom = totalNet || 1;
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const mul = sort.dir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) =>
    sort.col === 'key'
      ? mul * String(a.key).localeCompare(b.key, 'es')
      : mul * (a[sort.col] - b[sort.col]),
  );
  const th = (col, node, alignRight) => {
    const active = sort.col === col;
    return (
      <th
        onClick={() =>
          setSort((s) =>
            s.col === col
              ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
              : { col, dir: col === 'key' ? 'asc' : 'desc' },
          )
        }
        style={{
          padding: '9px 12px',
          textAlign: alignRight ? 'right' : 'left',
          fontWeight: 600,
          cursor: 'pointer',
          userSelect: 'none',
          color: active ? 'var(--ink-1)' : 'var(--ink-3)',
          whiteSpace: 'nowrap',
        }}
      >
        {node} {active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
      </th>
    );
  };
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
  return (
    <section
      style={{
        border: '1px solid var(--line)',
        borderRadius: 14,
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
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
        <span className="eyebrow">
          <Trans>Agrupar por</Trans>
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={'btn btn-sm ' + (groupBy === g.id ? 'btn-primary' : 'btn-secondary')}
              aria-pressed={groupBy === g.id}
              onClick={() => setGroupBy(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 480 }}>
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--line)',
                fontSize: 10.5,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {th('key', keyLabel, false)}
              {groupBy === 'producto' ? (
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: 'var(--ink-3)',
                  }}
                >
                  <Trans>Categoría</Trans>
                </th>
              ) : null}
              {th('units', <Trans>Unidades</Trans>, true)}
              {th('net', <Trans>Venta neta</Trans>, true)}
              <th
                style={{
                  padding: '9px 12px',
                  textAlign: 'right',
                  fontWeight: 600,
                  color: 'var(--ink-3)',
                }}
              >
                <Trans>% del total</Trans>
              </th>
            </tr>
          </thead>
          <tbody style={{ fontFamily: 'var(--font-mono)' }}>
            {sorted.map((r) => (
              <tr key={r.key} style={{ borderTop: '1px solid var(--line-soft)' }}>
                <td
                  style={{
                    padding: '9px 12px',
                    fontFamily: 'var(--font-sans, inherit)',
                    fontWeight: 500,
                  }}
                >
                  {r.key}
                </td>
                {groupBy === 'producto' ? (
                  <td
                    style={{
                      padding: '9px 12px',
                      color: 'var(--ink-3)',
                      fontFamily: 'var(--font-sans, inherit)',
                    }}
                  >
                    {r.sub || '—'}
                  </td>
                ) : null}
                <td style={{ padding: '9px 12px', textAlign: 'right' }}>{r.units}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                  {formatOperationMoney(r.net, currency)}
                </td>
                <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                  {Math.round((r.net / pctDenom) * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr
              style={{
                borderTop: '2px solid var(--line-strong)',
                fontWeight: 700,
                background: 'var(--surface-2)',
              }}
            >
              <td style={{ padding: '9px 12px' }}>
                <Trans>Total</Trans>
              </td>
              {groupBy === 'producto' ? <td /> : null}
              <td
                style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}
              >
                {totalUnits}
              </td>
              <td
                style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}
              >
                {formatOperationMoney(totalNet, currency)}
              </td>
              <td
                style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}
              >
                100%
              </td>
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
  const { data, loading, loaded, error } = useSalesSummary(range, 0);

  const totals = data?.totals;
  const currency = data?.currency || 'MXN';
  const net = totals?.netSalesMinorUnits ?? 0;
  const prior = totals?.priorNetSalesMinorUnits ?? null;
  const delta = prior && prior > 0 ? (net - prior) / prior : null;
  const deltaTone =
    delta == null ? 'var(--ink-3)' : delta >= 0 ? 'var(--success)' : 'var(--danger)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* The date range drives the sales aggregate, not the receipt list; hide it in
            Recibos, which carries its own view of committed receipts. */}
        {view !== 'recibos' ? (
          <div
            className="tabbar"
            role="group"
            aria-label={t`Rango de fechas`}
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
          >
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={'btn btn-sm ' + (range === r.id ? 'btn-primary' : 'btn-secondary')}
                aria-pressed={range === r.id}
                onClick={() => setRange(r.id)}
              >
                {i18n._(r.label)}
              </button>
            ))}
          </div>
        ) : null}
        <div
          role="group"
          aria-label={t`Vista`}
          style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}
        >
          <button
            type="button"
            className={'btn btn-sm ' + (view === 'resumen' ? 'btn-primary' : 'btn-secondary')}
            aria-pressed={view === 'resumen'}
            onClick={() => setView('resumen')}
          >
            <Trans>Resumen</Trans>
          </button>
          <button
            type="button"
            className={'btn btn-sm ' + (view === 'pivot' ? 'btn-primary' : 'btn-secondary')}
            aria-pressed={view === 'pivot'}
            onClick={() => setView('pivot')}
          >
            <Trans>Tabla dinámica</Trans>
          </button>
          <button
            type="button"
            className={'btn btn-sm ' + (view === 'recibos' ? 'btn-primary' : 'btn-secondary')}
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
        <div className="alert danger">
          <span className="strip" />
          <div className="body">
            <div className="sub">
              <Trans>No se pudo cargar el reporte de ventas.</Trans>
            </div>
          </div>
        </div>
      ) : loading && !loaded ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '24px 4px' }}>
          <Trans>Cargando ventas…</Trans>
        </div>
      ) : view === 'pivot' ? (
        // An empty period is NOT a dead end: the report still renders, just zeroed — the
        // KPIs show 0 and the table shows its columns with a 0 total, so the owner always
        // sees the shape of the report instead of a bare "no sales" message.
        <Pivot
          productMix={data?.productMix || []}
          byOperator={data?.byOperator || []}
          byHour={data?.byHour || []}
          currency={currency}
        />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 12,
            }}
          >
            <Kpi
              label={<Trans>Ventas netas</Trans>}
              value={formatOperationMoney(net, currency)}
              delta={
                delta == null
                  ? null
                  : `${delta >= 0 ? '+' : '−'}${Math.abs(delta * 100).toFixed(1)}%`
              }
              deltaTone={deltaTone}
              meta={<Trans>vs. período anterior</Trans>}
            />
            <Kpi
              label={<Trans>Órdenes</Trans>}
              value={totals?.orders ?? 0}
              meta={<Trans>en el periodo</Trans>}
            />
            <Kpi
              label={<Trans>Ticket promedio</Trans>}
              value={formatOperationMoney(totals?.averageTicketMinorUnits ?? 0, currency)}
              meta={<Trans>por orden</Trans>}
            />
            <Kpi
              label={<Trans>Ítems vendidos</Trans>}
              value={totals?.itemsSold ?? 0}
              meta={<Trans>en el periodo</Trans>}
            />
            <Kpi
              label={<Trans>Descuentos</Trans>}
              value={formatOperationMoney(totals?.discountMinorUnits ?? 0, currency)}
              meta={<Trans>en el periodo</Trans>}
            />
            <Kpi
              label={<Trans>Propinas</Trans>}
              value={formatOperationMoney(totals?.tipsMinorUnits ?? 0, currency)}
              meta={<Trans>en el periodo</Trans>}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
              gap: 16,
            }}
            className="ventas-grid"
          >
            <SeriesChart series={data?.series || []} bucket={data?.bucket} currency={currency} />
            <PaymentMix paymentMix={data?.paymentMix || []} currency={currency} />
          </div>

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
