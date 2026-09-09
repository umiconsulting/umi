import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useOperationsData, useCashShiftDetail } from '@/data.jsx';
import { formatOperationMoney, formatOperationDate } from './operations-format.js';

// Caja y turnos — the cash-custody view: a pulse over the shifts, a triage list, and the
// reconciliation drill-down for the selected shift (cash-math, denominations, ledger,
// separation of duties, trazabilidad) from /operations/cash-shifts/:id. Read-only:
// cash movement stays POS-only; the owner reviews and governs.

const CLOSED = 'closed';
const OPEN = new Set(['open', 'opening']);
const ATTENTION = new Set(['reconciliation_required', 'counting', 'closing', 'handoff_pending']);

const STATUS_LABEL = {
  opening: msg`Abriendo`,
  open: msg`Abierto`,
  suspended: msg`Suspendido`,
  handoff_pending: msg`Traspaso`,
  counting: msg`En arqueo`,
  reconciliation_required: msg`Conciliación`,
  closing: msg`Cerrando`,
  closed: msg`Cerrado`,
  blocked: msg`Bloqueado`,
  recovered: msg`Recuperado`,
};
const ENTRY_LABEL = {
  opening_float: msg`Fondo de apertura`,
  cash_sale: msg`Venta en efectivo`,
  paid_in: msg`Ingreso a caja`,
  paid_out: msg`Retiro de caja`,
  safe_drop: msg`Retiro a caja fuerte`,
  cash_refund: msg`Reembolso en efectivo`,
  drawer_correction: msg`Corrección de caja`,
  handoff_transfer: msg`Traspaso de turno`,
  count_observation: msg`Arqueo`,
};

function variance(f) {
  const e = f?.expectedCashMinorUnits;
  const c = f?.countedCashMinorUnits;
  return e == null || c == null ? null : c - e;
}
function toneOf(v, tolerance = 0) {
  if (v == null) return null;
  if (v === 0) return 'var(--success)';
  if (Math.abs(v) <= tolerance) return 'var(--warning)';
  return v < 0 ? 'var(--danger)' : 'var(--warning)';
}
function signedMoney(v, currency) {
  return `${v < 0 ? '−' : '+'}${formatOperationMoney(Math.abs(v), currency)}`;
}

/** A boxed pulse tile: label over a big mono figure. */
function Stat({ label, value, tone }) {
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
    </div>
  );
}

function StatusPill({ status }) {
  const { i18n } = useLingui();
  const label = STATUS_LABEL[status] ? i18n._(STATUS_LABEL[status]) : status;
  const attn = ATTENTION.has(status);
  const closed = status === CLOSED;
  return (
    <span
      className="sub-pill"
      style={{
        background: closed
          ? 'var(--surface-2)'
          : attn
            ? 'color-mix(in srgb, var(--warning) 16%, transparent)'
            : 'color-mix(in srgb, var(--merchant-brand) 14%, transparent)',
        color: closed ? 'var(--ink-3)' : attn ? 'var(--warning)' : 'var(--merchant-brand)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function DenominationTable({ title, rows, currency }) {
  if (!rows || !rows.length) return null;
  const total = rows.reduce((sum, r) => sum + r.valueMinorUnits, 0);
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      <div className="eyebrow" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, fontFamily: 'var(--font-mono)' }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: i ? '1px solid var(--line-soft)' : 'none' }}>
              <td style={{ padding: '7px 12px' }}>{r.label}</td>
              <td style={{ padding: '7px 12px', textAlign: 'right', color: 'var(--ink-3)' }}>
                {r.count == null ? '—' : `×${r.count}`}
              </td>
              <td style={{ padding: '7px 12px', textAlign: 'right' }}>
                {formatOperationMoney(r.valueMinorUnits, currency)}
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid var(--line)', fontWeight: 600 }}>
            <td style={{ padding: '7px 12px' }}>
              <Trans>Total</Trans>
            </td>
            <td />
            <td style={{ padding: '7px 12px', textAlign: 'right' }}>
              {formatOperationMoney(total, currency)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Duty({ label, role }) {
  return (
    <div style={{ minWidth: 130 }}>
      <div className="eyebrow">{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{role?.name || '—'}</div>
      {role?.at ? (
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{formatOperationDate(role.at)}</div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          <Trans>pendiente</Trans>
        </div>
      )}
    </div>
  );
}

function ShiftDetail({ shiftId }) {
  const { i18n } = useLingui();
  const { data: d, loading, loaded } = useCashShiftDetail(shiftId, 0);
  if (!shiftId) return null;
  if (loading && !loaded)
    return (
      <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: 20 }}>
        <Trans>Cargando turno…</Trans>
      </div>
    );
  if (!d) return null;

  const m = d.math;
  const vTone = toneOf(m.varianceMinorUnits, m.toleranceMinorUnits);
  const terms = [
    { label: <Trans>Fondo de apertura</Trans>, value: formatOperationMoney(m.openingMinorUnits, d.currency), op: null },
    { label: <Trans>Ventas en efectivo</Trans>, value: formatOperationMoney(m.cashSalesMinorUnits, d.currency), op: '+' },
  ];
  if (m.paidInMinorUnits > 0)
    terms.push({ label: <Trans>Ingresos</Trans>, value: formatOperationMoney(m.paidInMinorUnits, d.currency), op: '+' });
  if (m.paidOutMinorUnits > 0)
    terms.push({ label: <Trans>Retiros</Trans>, value: formatOperationMoney(m.paidOutMinorUnits, d.currency), op: '−' });
  if (m.safeDropMinorUnits > 0)
    terms.push({ label: <Trans>Caja fuerte</Trans>, value: formatOperationMoney(m.safeDropMinorUnits, d.currency), op: '−' });
  if (m.refundsMinorUnits > 0)
    terms.push({ label: <Trans>Reembolsos</Trans>, value: formatOperationMoney(m.refundsMinorUnits, d.currency), op: '−' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 22 }}>
            {d.register || <Trans>Turno</Trans>}
          </h3>
          <StatusPill status={d.status} />
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
          {d.businessDate}
          {d.openedAt ? ` · ${formatOperationDate(d.openedAt)}` : ''}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', marginTop: 14 }}>
          <Duty label={<Trans>Abrió</Trans>} role={d.roles.opened} />
          <Duty label={<Trans>Contó</Trans>} role={d.roles.counted} />
          <Duty label={<Trans>Aprobó</Trans>} role={d.roles.approved} />
        </div>
      </div>

      {/* cash-math strip */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          <Trans>La cuenta del turno</Trans>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 8 }}>
          {terms.map((term, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {term.op ? (
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink-3)' }}>{term.op}</span>
              ) : null}
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 9, padding: '9px 13px', minWidth: 96 }}>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>{term.label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 15 }}>{term.value}</div>
              </div>
            </div>
          ))}
          <span style={{ alignSelf: 'center', fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink-3)' }}>=</span>
          <div style={{ background: 'color-mix(in srgb, var(--merchant-brand) 12%, transparent)', borderRadius: 9, padding: '9px 13px', minWidth: 110 }}>
            <div style={{ fontSize: 11, color: 'var(--merchant-brand)', marginBottom: 4 }}>
              <Trans>Efectivo esperado</Trans>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 16 }}>
              {formatOperationMoney(m.expectedMinorUnits, d.currency)}
            </div>
          </div>
          <span style={{ alignSelf: 'center', fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--ink-3)' }}>vs</span>
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line-strong)', borderRadius: 9, padding: '9px 13px', minWidth: 110 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
              <Trans>Efectivo contado</Trans>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 16 }}>
              {m.countedMinorUnits == null ? <Trans>Pendiente</Trans> : formatOperationMoney(m.countedMinorUnits, d.currency)}
            </div>
          </div>
          <span style={{ alignSelf: 'center', fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-3)' }}>→</span>
          <div style={{ borderRadius: 9, padding: '9px 13px', minWidth: 120, background: vTone ? `color-mix(in srgb, ${vTone} 14%, transparent)` : 'var(--surface-2)' }}>
            <div style={{ fontSize: 11, color: vTone || 'var(--ink-3)', marginBottom: 4 }}>
              <Trans>Diferencia</Trans>
            </div>
            <div className="figures" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 18, color: vTone || 'var(--ink-1)' }}>
              {m.varianceMinorUnits == null ? '—' : signedMoney(m.varianceMinorUnits, d.currency)}
            </div>
          </div>
        </div>
      </div>

      {(d.openingDenominations.length || d.countDenominations) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <DenominationTable title={<Trans>Denominaciones de apertura</Trans>} rows={d.openingDenominations} currency={d.currency} />
          <DenominationTable title={<Trans>Denominaciones del arqueo</Trans>} rows={d.countDenominations} currency={d.currency} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 20 }} className="cash-detail-grid">
        {/* ledger */}
        <section>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            <Trans>Libro de caja del turno</Trans>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {d.ledger.length ? (
              d.ledger.map((line, i) => {
                const neutral = line.type === 'count_observation' || line.type === 'opening_float';
                const color = neutral ? 'var(--ink-3)' : line.amountMinorUnits < 0 ? 'var(--danger)' : 'var(--success)';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 2px', borderBottom: '1px solid var(--line-soft)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5 }}>{ENTRY_LABEL[line.type] ? i18n._(ENTRY_LABEL[line.type]) : line.type}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                        {formatOperationDate(line.occurredAt)}
                        {line.receiptNumber ? ` · ${line.receiptNumber}` : ''}
                        {line.reasonCode ? ` · ${line.reasonCode}` : ''}
                        {line.note ? ` · ${line.note}` : ''}
                      </div>
                    </div>
                    <div className="figures" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13.5, color, whiteSpace: 'nowrap' }}>
                      {neutral ? formatOperationMoney(line.amountMinorUnits, d.currency) : signedMoney(line.amountMinorUnits, d.currency)}
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '10px 2px' }}>
                <Trans>Sin movimientos en el turno.</Trans>
              </div>
            )}
          </div>
        </section>

        {/* trazabilidad + counts */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              <Trans>Arqueos</Trans>
            </div>
            {d.counts.length ? (
              d.counts.map((c) => (
                <div key={c.attempt} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 2px', fontSize: 13, borderBottom: '1px solid var(--line-soft)' }}>
                  <span style={{ color: 'var(--ink-3)' }}>
                    <Trans>Intento {c.attempt}</Trans> · {c.state.replaceAll('_', ' ')}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {formatOperationMoney(c.countedMinorUnits, d.currency)}
                  </span>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                <Trans>Sin arqueos todavía.</Trans>
              </div>
            )}
          </section>
          <section>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              <Trans>Trazabilidad del turno</Trans>
            </div>
            {d.traza.map((t, i) => (
              <div key={i} style={{ padding: '7px 2px', borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ fontSize: 13 }}>{t.text}</div>
                {t.at ? <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{formatOperationDate(t.at)}</div> : null}
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

export default function CajaTurnos() {
  const { t } = useLingui();
  const state = useOperationsData('cash_shifts', 0, 0, false);
  const items = (state.data?.items || []).filter((it) => it.facts);
  const [selected, setSelected] = useState(null);
  // Derive the effective selection during render (no effect): the clicked shift when it is
  // still in the list, otherwise the first shift that needs attention, otherwise the first.
  const effectiveSelected =
    selected && items.some((s) => s.id === selected)
      ? selected
      : (items.find((s) => ATTENTION.has(s.status)) || items[0])?.id || null;

  const currency = items.find((s) => s.currency)?.currency ?? null;
  const active = items.filter((s) => s.status !== CLOSED);
  const openCount = items.filter((s) => OPEN.has(s.status)).length;
  const expected = active.reduce((sum, s) => sum + (s.facts?.expectedCashMinorUnits ?? 0), 0);
  const attention = items.filter((s) => ATTENTION.has(s.status)).length;
  const closed = items.filter((s) => s.status === CLOSED);
  const net = closed.reduce((sum, s) => sum + (variance(s.facts) ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Stat label={<Trans>Cajas abiertas</Trans>} value={openCount} />
        <Stat label={<Trans>Efectivo esperado en caja</Trans>} value={formatOperationMoney(expected, currency)} />
        <Stat label={<Trans>Requieren atención</Trans>} value={attention} tone={attention ? 'var(--warning)' : undefined} />
        <Stat
          label={<Trans>Diferencia neta</Trans>}
          value={closed.length ? signedMoney(net, currency) : '—'}
          tone={net < 0 ? 'var(--danger)' : net > 0 ? 'var(--warning)' : undefined}
        />
      </div>

      {state.loading && !state.loaded ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '20px 4px' }}>
          <Trans>Cargando turnos…</Trans>
        </div>
      ) : !items.length ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '20px 4px' }}>
          <Trans>No hay turnos de caja en esta vista.</Trans>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)', gap: 20 }} className="caja-grid">
          <aside
            role="listbox"
            aria-label={t`Turnos de caja`}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, alignContent: 'start' }}
          >
            {items.map((s) => {
              const v = variance(s.facts);
              const vt = toneOf(v);
              const isSel = s.id === effectiveSelected;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => setSelected(s.id)}
                  className="card"
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    display: 'grid',
                    gap: 7,
                    cursor: 'pointer',
                    border: isSel ? '1px solid var(--merchant-brand)' : '1px solid var(--line)',
                    boxShadow: isSel ? '0 0 0 1px var(--merchant-brand)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{s.facts?.register || s.title}</span>
                    <StatusPill status={s.status} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--ink-3)' }}>
                    <span>{s.facts?.operator || '—'}</span>
                    <span className="figures" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: vt || 'var(--ink-3)' }}>
                      {v == null ? '—' : signedMoney(v, s.currency)}
                    </span>
                  </div>
                </button>
              );
            })}
          </aside>
          <section className="card" style={{ padding: '20px 22px' }}>
            <ShiftDetail shiftId={effectiveSelected} />
          </section>
        </div>
      )}
    </div>
  );
}
