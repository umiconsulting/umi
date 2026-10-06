import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useOperationsData } from '@/data.jsx';
import { formatOperationMoney, formatOperationDate } from './operations-format.js';

// Reportes → Reembolsos — the loss-prevention lens (ADR 2026-09-08). Money back and voids are
// register acts done with the customer present; here the owner reviews them for patterns — the
// "Por operador" breakdown surfaces refunds/voids concentrated on one person or booked without
// a manager approval — then the register below shows who, why, how much and who authorized.
// Read-only. Each row cross-links, by receipt number, to the original sale.

const TYPE_LABEL = {
  void: msg`Anulación`,
  partial_refund: msg`Reembolso parcial`,
  refund: msg`Reembolso total`,
};
function typeOf(f) {
  const t = f?.exceptionType;
  return t === 'void' ? 'void' : t === 'partial_refund' ? 'partial_refund' : 'refund';
}

const FILTERS = [
  { id: 'all', label: msg`Todos` },
  { id: 'refund', label: msg`Reembolsos` },
  { id: 'partial_refund', label: msg`Parciales` },
  { id: 'void', label: msg`Anulaciones` },
];

/** A boxed KPI tile: label, big mono value, optional meta line. */
function Kpi({ label, value, tone, meta }) {
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
          color: tone || 'var(--ink-1)',
        }}
      >
        {value}
      </div>
      {meta ? <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{meta}</div> : null}
    </div>
  );
}

function TypePill({ type }) {
  const { i18n } = useLingui();
  const label = i18n._(TYPE_LABEL[type]);
  const isVoid = type === 'void';
  return (
    <span
      className="sub-pill"
      style={{
        background: isVoid
          ? 'color-mix(in srgb, var(--danger) 16%, transparent)'
          : 'color-mix(in srgb, var(--warning) 16%, transparent)',
        color: isVoid ? 'var(--danger)' : 'var(--warning)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export default function Reembolsos() {
  const { t, i18n } = useLingui();
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' });
  // 50 is the operations query's max page; loss-prevention aggregates read better over the
  // whole page than over the default 20. Beyond a page, a period aggregate endpoint is the
  // proper next step (see ADR 2026-09-08).
  const state = useOperationsData('refunds_voids', 0, 0, false, 50);
  const items = state.data?.items || [];
  const currency = items.find((i) => i.currency)?.currency ?? null;

  const total = items.reduce((sum, i) => sum + (i.amountMinorUnits ?? 0), 0);
  const voids = items.filter((i) => typeOf(i.facts) === 'void').length;
  const partials = items.filter((i) => typeOf(i.facts) === 'partial_refund').length;
  const fullRefunds = items.filter((i) => typeOf(i.facts) === 'refund').length;
  const approved = items.filter((i) => i.facts?.approved).length;

  // Loss-prevention lens: refunds/voids concentrated on one operator, or booked without a
  // manager approval, are the classic theft signal. Aggregated over the loaded view.
  const byOperator = Object.values(
    items.reduce((acc, i) => {
      const key = i.facts?.operator || t`Sin operador`;
      acc[key] = acc[key] || { key, count: 0, amount: 0, approved: 0 };
      acc[key].count += 1;
      acc[key].amount += i.amountMinorUnits ?? 0;
      if (i.facts?.approved) acc[key].approved += 1;
      return acc;
    }, {}),
  ).sort((a, b) => b.amount - a.amount);

  const filtered = filter === 'all' ? items : items.filter((i) => typeOf(i.facts) === filter);
  const mul = sort.dir === 'asc' ? 1 : -1;
  const sorted = [...filtered].sort((a, b) =>
    sort.col === 'amount'
      ? mul * ((a.amountMinorUnits ?? 0) - (b.amountMinorUnits ?? 0))
      : mul * String(a.occurredAt || '').localeCompare(String(b.occurredAt || '')),
  );

  const th = (col, node, alignRight) => {
    const active = sort.col === col;
    return (
      <th
        onClick={() =>
          setSort((s) =>
            s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' },
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        <Kpi
          label={<Trans>Devuelto</Trans>}
          value={formatOperationMoney(total, currency)}
          tone={total ? 'var(--danger)' : undefined}
          meta={<Trans>en esta vista</Trans>}
        />
        <Kpi label={<Trans>Reembolsos</Trans>} value={fullRefunds} meta={<Trans>totales</Trans>} />
        <Kpi label={<Trans>Parciales</Trans>} value={partials} meta={<Trans>reembolsos</Trans>} />
        <Kpi
          label={<Trans>Anulaciones</Trans>}
          value={voids}
          meta={<Trans>ventas anuladas</Trans>}
        />
        <Kpi
          label={<Trans>Con aprobación</Trans>}
          value={approved}
          meta={<Trans>de gerente</Trans>}
        />
      </div>

      {state.loading && !state.loaded ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '24px 4px' }}>
          <Trans>Cargando movimientos…</Trans>
        </div>
      ) : !items.length ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '24px 4px' }}>
          <Trans>Sin reembolsos ni anulaciones en esta vista.</Trans>
        </div>
      ) : (
        <>
          {byOperator.length ? (
            <section
              style={{
                border: '1px solid var(--line)',
                borderRadius: 14,
                background: 'var(--surface)',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <span className="eyebrow">
                  <Trans>Por operador</Trans>
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 12.5,
                    minWidth: 420,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: '1px solid var(--line)',
                        fontSize: 10.5,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--ink-3)',
                      }}
                    >
                      <th style={{ padding: '9px 12px', textAlign: 'left', fontWeight: 600 }}>
                        <Trans>Operador</Trans>
                      </th>
                      <th style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>
                        <Trans>Movimientos</Trans>
                      </th>
                      <th style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>
                        <Trans>Con aprobación</Trans>
                      </th>
                      <th style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>
                        <Trans>Monto</Trans>
                      </th>
                    </tr>
                  </thead>
                  <tbody style={{ fontFamily: 'var(--font-mono)' }}>
                    {byOperator.map((r) => (
                      <tr key={r.key} style={{ borderTop: '1px solid var(--line-soft)' }}>
                        <td
                          style={{ padding: '9px 12px', fontFamily: 'var(--font-sans, inherit)' }}
                        >
                          {r.key}
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'right' }}>{r.count}</td>
                        <td
                          style={{
                            padding: '9px 12px',
                            textAlign: 'right',
                            color: r.approved < r.count ? 'var(--warning)' : 'var(--ink-2)',
                          }}
                        >
                          {r.approved}/{r.count}
                        </td>
                        <td
                          style={{
                            padding: '9px 12px',
                            textAlign: 'right',
                            color: 'var(--danger)',
                            fontWeight: 600,
                          }}
                        >
                          −{formatOperationMoney(r.amount, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <div
            role="group"
            aria-label={t`Filtrar por tipo`}
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={'btn btn-sm ' + (filter === f.id ? 'btn-primary' : 'btn-secondary')}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {i18n._(f.label)}
              </button>
            ))}
          </div>

          <section
            style={{
              border: '1px solid var(--line)',
              borderRadius: 14,
              background: 'var(--surface)',
              overflow: 'hidden',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 620 }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid var(--line)',
                      fontSize: 10.5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    <th
                      style={{
                        padding: '9px 12px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: 'var(--ink-3)',
                      }}
                    >
                      <Trans>Tipo</Trans>
                    </th>
                    <th
                      style={{
                        padding: '9px 12px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: 'var(--ink-3)',
                      }}
                    >
                      <Trans>Recibo original</Trans>
                    </th>
                    <th
                      style={{
                        padding: '9px 12px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: 'var(--ink-3)',
                      }}
                    >
                      <Trans>Operador</Trans>
                    </th>
                    <th
                      style={{
                        padding: '9px 12px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: 'var(--ink-3)',
                      }}
                    >
                      <Trans>Motivo</Trans>
                    </th>
                    <th
                      style={{
                        padding: '9px 12px',
                        textAlign: 'center',
                        fontWeight: 600,
                        color: 'var(--ink-3)',
                      }}
                    >
                      <Trans>Aprobación</Trans>
                    </th>
                    {th('date', <Trans>Fecha</Trans>, false)}
                    {th('amount', <Trans>Monto</Trans>, true)}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => {
                    const f = item.facts || {};
                    const reason = f.reasonCode ? String(f.reasonCode).replaceAll('_', ' ') : '—';
                    return (
                      <tr key={item.id} style={{ borderTop: '1px solid var(--line-soft)' }}>
                        <td style={{ padding: '9px 12px' }}>
                          <TypePill type={typeOf(f)} />
                        </td>
                        <td
                          style={{
                            padding: '9px 12px',
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--ink-2)',
                          }}
                        >
                          {f.originalReceipt || '—'}
                        </td>
                        <td style={{ padding: '9px 12px' }}>{f.operator || '—'}</td>
                        <td style={{ padding: '9px 12px', color: 'var(--ink-2)' }}>{reason}</td>
                        <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                          {f.approved ? (
                            <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                              <Trans>Sí</Trans>
                            </span>
                          ) : (
                            <span style={{ color: 'var(--ink-3)' }}>—</span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: '9px 12px',
                            color: 'var(--ink-3)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatOperationDate(item.occurredAt)}
                        </td>
                        <td
                          style={{
                            padding: '9px 12px',
                            textAlign: 'right',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 600,
                            color: 'var(--danger)',
                          }}
                        >
                          −{formatOperationMoney(item.amountMinorUnits, item.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: 0, maxWidth: '64ch' }}>
            <Trans>
              Los reembolsos y las anulaciones se hacen en la caja, con el cliente presente. Aquí
              los revisas: quién, por qué y quién autorizó.
            </Trans>
          </p>
        </>
      )}
    </div>
  );
}
