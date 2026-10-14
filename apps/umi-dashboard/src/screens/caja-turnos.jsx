import { useEffect, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  fetchCashPolicy,
  setCashPolicy,
  fetchCheckoutPolicy,
  setCheckoutPolicy,
  useOperationsData,
  useCashShiftDetail,
} from '@/data.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { formatOperationMoney, formatOperationDate } from './operations-format.js';
import { bankTransferDraft, prepareBankTransfer } from './bank-transfer-policy.js';
import {
  ATTENTION_STATUSES as ATTENTION,
  BUCKETS as BUCKET_IDS,
  CLOSED_STATUS as CLOSED,
  OPEN_STATUSES as OPEN,
  buildVarianceSeries,
  countBuckets,
  filterShifts,
  sortShifts,
  varianceOf as variance,
} from './caja-turnos-model.js';

// Caja y turnos — the cash-custody view: a pulse over the shifts, a triage list, and the
// reconciliation drill-down for the selected shift (cash-math, denominations, ledger,
// separation of duties, trazabilidad) from /operations/cash-shifts/:id. Read-only:
// cash movement stays POS-only; the owner reviews and governs.

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

function toneOf(v, tolerance = 0) {
  if (v == null) return null;
  if (v === 0) return 'var(--success)';
  if (Math.abs(v) <= tolerance) return 'var(--warning)';
  return v < 0 ? 'var(--danger)' : 'var(--warning)';
}

function CheckoutRules({ merchantId, locationId }) {
  const { t } = useLingui();
  const [policy, setPolicy] = useState(null);
  const [bankDraft, setBankDraft] = useState(bankTransferDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [bankError, setBankError] = useState(null);
  const [bankSaved, setBankSaved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!merchantId || !locationId) return undefined;
    fetchCheckoutPolicy(merchantId, locationId)
      .then((value) => {
        if (!cancelled) {
          setPolicy(value);
          setBankDraft(bankTransferDraft(value?.bankTransferDetails, value?.bankTransferEnabled));
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError(t`No se pudo leer la configuración de cobro.`);
      });
    return () => {
      cancelled = true;
    };
  }, [merchantId, locationId, t]);
  async function change(key, value) {
    if (!policy || saving) return;
    setSaving(true);
    setError(null);
    try {
      const changed = await setCheckoutPolicy(merchantId, locationId, {
        manualTerminalEnabled: policy.manualTerminalEnabled,
        mixedTenderEnabled: policy.mixedTenderEnabled,
        allowDineInWithoutTable: policy.allowDineInWithoutTable,
        bankTransferEnabled: policy.bankTransferEnabled,
        bankTransferDetails: policy.bankTransferDetails,
        [key]: value,
      });
      setPolicy(changed);
    } catch {
      setError(t`No se guardó el cambio. Se conserva la configuración anterior.`);
    } finally {
      setSaving(false);
    }
  }
  async function saveBankTransfer(event) {
    event.preventDefault();
    if (!policy || saving) return;
    const prepared = prepareBankTransfer(bankDraft);
    if (prepared.error) {
      const messages = {
        identity: t`Escribe el titular y el banco.`,
        length: t`El titular y el banco admiten hasta 120 caracteres.`,
        destination: t`Escribe una CLABE o un número de cuenta.`,
        clabe: t`La CLABE debe tener 18 dígitos.`,
        account: t`El número de cuenta debe tener entre 1 y 24 dígitos.`,
      };
      setBankError(messages[prepared.error]);
      return;
    }
    setSaving(true);
    setBankError(null);
    setBankSaved(false);
    try {
      const changed = await setCheckoutPolicy(merchantId, locationId, {
        manualTerminalEnabled: policy.manualTerminalEnabled,
        mixedTenderEnabled: policy.mixedTenderEnabled,
        allowDineInWithoutTable: policy.allowDineInWithoutTable,
        ...prepared,
      });
      setPolicy(changed);
      setBankDraft(bankTransferDraft(changed.bankTransferDetails, changed.bankTransferEnabled));
      setBankSaved(true);
    } catch {
      setBankError(t`No se guardaron los datos bancarios. Revisa los campos e inténtalo otra vez.`);
    } finally {
      setSaving(false);
    }
  }
  function editBank(key, value) {
    setBankDraft((current) => ({ ...current, [key]: value }));
    setBankError(null);
    setBankSaved(false);
  }
  return (
    <section style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 14 }}>
      <div className="eyebrow">
        <Trans>Reglas del cobro</Trans>
      </div>
      {[
        [
          'manualTerminalEnabled',
          t`Permitir tarjeta en terminal manual`,
          t`El cajero declara el resultado de la terminal externa. No activa ni sustituye una terminal integrada.`,
        ],
        [
          'mixedTenderEnabled',
          t`Permitir pagos mixtos`,
          t`Una cuenta puede combinar efectivo y tarjeta según los métodos habilitados.`,
        ],
        [
          'allowDineInWithoutTable',
          t`Permitir Comer aquí sin mesa`,
          t`La cuenta conserva Comer aquí sin asignar una mesa ficticia.`,
        ],
      ].map(([key, label, detail]) => (
        <label
          key={key}
          style={{ display: 'flex', gap: 10, minHeight: 'var(--control-min)', marginTop: 10 }}
        >
          <input
            type="checkbox"
            checked={policy?.[key] === true}
            disabled={!policy || saving}
            onChange={(event) => change(key, event.target.checked)}
          />
          <span>
            <span style={{ display: 'block', fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{detail}</span>
          </span>
        </label>
      ))}
      <form
        onSubmit={saveBankTransfer}
        style={{
          marginTop: 18,
          padding: 18,
          border: '1px solid var(--line-soft)',
          borderRadius: 14,
          background: 'var(--canvas-2)',
        }}
      >
        <div style={{ fontWeight: 650, fontSize: 15 }}>
          <Trans>Transferencia bancaria</Trans>
        </div>
        <p style={{ color: 'var(--ink-3)', fontSize: 12, margin: '6px 0 14px' }}>
          <Trans>
            Estos datos se mostrarán al cajero durante el cobro. Activa el método cuando los datos
            estén listos.
          </Trans>
        </p>
        <label style={{ display: 'flex', gap: 10, minHeight: 'var(--control-min)' }}>
          <input
            type="checkbox"
            checked={bankDraft.enabled}
            disabled={!policy || saving}
            onChange={(event) => editBank('enabled', event.target.checked)}
          />
          <span style={{ fontWeight: 600 }}>
            <Trans>Permitir transferencia bancaria</Trans>
          </span>
        </label>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          {[
            ['holderName', t`Titular de la cuenta`, 'text', 120],
            ['bankName', t`Banco`, 'text', 120],
            ['clabe', t`CLABE (18 dígitos)`, 'numeric', 32],
            ['accountNumber', t`Número de cuenta (opcional si hay CLABE)`, 'numeric', 32],
          ].map(([key, label, inputMode, maxLength]) => (
            <label className="field" key={key}>
              <span className="field-label">{label}</span>
              <input
                className="input"
                name={key}
                type="text"
                inputMode={inputMode}
                autoComplete="off"
                maxLength={maxLength}
                value={bankDraft[key]}
                disabled={!policy || saving}
                onChange={(event) => editBank(key, event.target.value)}
              />
            </label>
          ))}
        </div>
        <p style={{ color: 'var(--ink-3)', fontSize: 12, margin: '12px 0' }}>
          <Trans>Escribe la CLABE o el número de cuenta. Puedes guardar ambos.</Trans>
        </p>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <button className="btn btn-primary" type="submit" disabled={!policy || saving}>
            {saving ? t`Guardando…` : t`Guardar transferencia`}
          </button>
          {bankSaved ? (
            <span role="status" style={{ color: 'var(--success)', fontSize: 12 }}>
              <Trans>Transferencia guardada para esta sucursal.</Trans>
            </span>
          ) : null}
        </div>
        {bankError ? (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>
            {bankError}
          </p>
        ) : null}
      </form>
      {error ? (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
      {!policy && !error ? (
        <p>
          <Trans>No hay política de cobro para esta sucursal.</Trans>
        </p>
      ) : null}
    </section>
  );
}
function signedMoney(v, currency) {
  return `${v < 0 ? '−' : '+'}${formatOperationMoney(Math.abs(v), currency)}`;
}

/** A boxed pulse tile: label over a big mono figure. */
/**
 * A pulse figure. The label says what it counts, the value is the number, and the
 * note says the window it covers — a figure without its window is a rumour.
 */
function Kpi({ label, value, note, tone }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 0,
      }}
    >
      <div className="eyebrow">{label}</div>
      <div
        className="figures"
        style={{
          fontFamily: 'var(--font-body)',
          fontWeight: 600,
          // Small enough for "MX$1,205.00" to hold its column, big enough to lead
          // the card. The money columns are what the eye compares, not the size.
          fontSize: 22,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          color: tone || 'var(--ink-1)',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
      {note ? <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{note}</div> : null}
    </div>
  );
}

/**
 * Serie y tendencia. The back-office form of the difference: the same number the
 * till shows today, read across business days. A day above the line is money
 * left over; a day below is money missing. Bars are scaled to the worst day in
 * the window, so the shape stays readable when one day dominates.
 */
function VarianceTrend({ series, currency }) {
  if (!series.length) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
        <Trans>Sin turnos cerrados todavía. La tendencia aparece con el primer cierre.</Trans>
      </div>
    );
  }
  const max = Math.max(1, ...series.map((d) => Math.abs(d.varianceMinorUnits)));
  const half = 30;
  const worst = series.reduce((a, b) =>
    Math.abs(b.varianceMinorUnits) > Math.abs(a.varianceMinorUnits) ? b : a,
  );
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 24,
        alignItems: 'end',
      }}
    >
      <div style={{ position: 'relative' }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: half,
            height: 1,
            background: 'var(--line-strong)',
          }}
        />
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {series.map((d) => {
            const up = d.varianceMinorUnits > 0;
            const h = Math.max(2, Math.round((Math.abs(d.varianceMinorUnits) / max) * half));
            return (
              <div
                key={d.businessDate}
                title={`${d.businessDate} · ${signedMoney(d.varianceMinorUnits, currency)}`}
                style={{ width: 44, display: 'flex', flexDirection: 'column' }}
              >
                <div style={{ height: half, display: 'flex', alignItems: 'flex-end' }}>
                  {up ? (
                    <div
                      style={{
                        width: '100%',
                        height: h,
                        borderRadius: '4px 4px 0 0',
                        background: 'color-mix(in srgb, var(--warning) 55%, transparent)',
                      }}
                    />
                  ) : null}
                </div>
                <div style={{ height: half, display: 'flex', alignItems: 'flex-start' }}>
                  {!up ? (
                    <div
                      style={{
                        width: '100%',
                        height: h,
                        borderRadius: '0 0 4px 4px',
                        background: 'color-mix(in srgb, var(--danger) 55%, transparent)',
                      }}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
          {series.map((d) => (
            <div
              key={d.businessDate}
              className="figures"
              style={{
                width: 44,
                textAlign: 'center',
                fontSize: 10.5,
                fontFamily: 'var(--font-body)',
                color: 'var(--ink-3)',
              }}
            >
              {d.businessDate.slice(5)}
            </div>
          ))}
        </div>
      </div>
      <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        <div>
          {series.length === 1 ? (
            <Trans>1 día con cierre</Trans>
          ) : (
            <Trans>{series.length} días con cierre</Trans>
          )}
        </div>
        <div style={{ color: 'var(--ink-2)' }}>
          <Trans>
            Peor día {signedMoney(worst.varianceMinorUnits, currency)} el {worst.businessDate}
          </Trans>
        </div>
      </div>
    </div>
  );
}

const BUCKET_LABEL = {
  all: msg`Todas`,
  open: msg`Abiertas`,
  attention: msg`Requieren atención`,
  closed: msg`Cerradas`,
};

/**
 * Tabla filtrable. The back-office form of the shift list: every shift of the
 * window in one table, sorted by whatever the manager is hunting for. The
 * till shows one shift; this shows the day, the week, and the operator behind
 * each difference.
 */
function ShiftTable({ items, selectedId, onSelect }) {
  const { i18n } = useLingui();
  const [bucket, setBucket] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });

  const counts = countBuckets(items);
  const rows = sortShifts(filterShifts(items, { bucket, query }), sort);

  const toggle = (key) =>
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '');

  const th = (key, label, align) => (
    // The same 8 px the body cells carry, so a header label sits over its column
    // instead of drifting toward the numbers it names.
    <th scope="col" style={{ textAlign: align || 'left', whiteSpace: 'nowrap', padding: '0 8px' }}>
      <button
        type="button"
        onClick={() => toggle(key)}
        aria-label={i18n._(msg`Ordenar por esta columna`)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          minHeight: 'var(--control-min)',
          display: 'inline-flex',
          alignItems: 'center',
          font: 'inherit',
          color: sort.key === key ? 'var(--ink-1)' : 'inherit',
        }}
      >
        {label}
        {arrow(key)}
      </button>
    </th>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {BUCKET_IDS.map((id) => {
          const on = bucket === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setBucket(id)}
              aria-pressed={on}
              className="sub-pill"
              style={{
                minHeight: 'var(--control-min)',
                padding: '0 12px',
                cursor: 'pointer',
                border: `1px solid ${on ? 'var(--merchant-brand)' : 'var(--line)'}`,
                background: on
                  ? 'color-mix(in srgb, var(--merchant-brand) 12%, transparent)'
                  : 'var(--surface)',
                // The selected filter's LABEL is 12px text on a tint of its own
                // colour, so it takes the accent INK rather than the accent.
                color: on ? 'var(--accent-ink, var(--merchant-brand))' : 'var(--ink-2)',
                fontWeight: 600,
              }}
            >
              {i18n._(BUCKET_LABEL[id])} <span className="figures">{counts[id]}</span>
            </button>
          );
        })}
        <label
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 'var(--control-min)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-ctl)',
            padding: '0 10px',
            background: 'var(--surface)',
            minWidth: 200,
          }}
        >
          <span className="sr-only">
            <Trans>Buscar por caja u operador</Trans>
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={i18n._(msg`Buscar caja u operador`)}
            style={{ border: 0, outline: 'none', background: 'none', width: '100%', fontSize: 13 }}
          />
        </label>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr
              style={{
                textAlign: 'left',
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
              }}
            >
              <th scope="col" style={{ whiteSpace: 'nowrap', padding: '0 8px' }}>
                <Trans>Caja</Trans>
              </th>
              <th scope="col" style={{ padding: '0 8px' }}>
                <Trans>Operador</Trans>
              </th>
              {th('date', i18n._(msg`Fecha comercial`))}
              <th scope="col" style={{ padding: '0 8px' }}>
                <Trans>Estado</Trans>
              </th>
              {th('expected', i18n._(msg`Esperado`), 'right')}
              <th scope="col" style={{ textAlign: 'right', padding: '0 8px' }}>
                <Trans>Contado</Trans>
              </th>
              {th('variance', i18n._(msg`Diferencia`), 'right')}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const v = variance(s.facts);
              const isSel = s.id === selectedId;
              return (
                <tr
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  style={{
                    borderTop: '1px solid var(--line-soft)',
                    background: isSel
                      ? 'color-mix(in srgb, var(--merchant-brand) 8%, transparent)'
                      : undefined,
                    cursor: 'pointer',
                  }}
                >
                  <td style={{ padding: 0 }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(s.id);
                      }}
                      aria-pressed={isSel}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        minHeight: 'var(--control-min)',
                        padding: '0 8px',
                        fontWeight: 600,
                        boxShadow: isSel ? 'inset 2px 0 0 var(--merchant-brand)' : undefined,
                      }}
                    >
                      {s.facts?.register || s.title}
                    </button>
                  </td>
                  <td style={{ padding: '0 8px', color: 'var(--ink-2)' }}>
                    {s.facts?.operator || '—'}
                  </td>
                  <td
                    className="figures"
                    style={{
                      padding: '0 8px',
                      fontFamily: 'var(--font-body)',
                      color: 'var(--ink-2)',
                    }}
                  >
                    {s.facts?.businessDate || '—'}
                  </td>
                  <td style={{ padding: '0 8px' }}>
                    <StatusPill status={s.status} />
                  </td>
                  <td
                    className="figures"
                    style={{
                      padding: '0 8px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    {formatOperationMoney(s.facts?.expectedCashMinorUnits ?? 0, s.currency)}
                  </td>
                  <td
                    className="figures"
                    style={{
                      padding: '0 8px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-body)',
                      color: 'var(--ink-2)',
                    }}
                  >
                    {s.facts?.countedCashMinorUnits == null
                      ? '—'
                      : formatOperationMoney(s.facts.countedCashMinorUnits, s.currency)}
                  </td>
                  <td
                    className="figures"
                    style={{
                      padding: '0 8px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-body)',
                      fontWeight: 600,
                      color: toneOf(v) || 'var(--ink-3)',
                    }}
                  >
                    {v == null ? '—' : signedMoney(v, s.currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length ? (
          <div style={{ padding: '18px 2px', color: 'var(--ink-3)', fontSize: 13 }}>
            <Trans>Ningún turno coincide con el filtro.</Trans>
          </div>
        ) : null}
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
        // The pill's LABEL is 12px text on a tint of its own colour: it takes the
        // accent's ink, which is the darkened value on the light shell.
        color: closed
          ? 'var(--ink-3)'
          : attn
            ? 'var(--warning)'
            : 'var(--accent-ink, var(--merchant-brand))',
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
      <div
        className="eyebrow"
        style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}
      >
        {title}
      </div>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12.5,
          fontFamily: 'var(--font-body)',
        }}
      >
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
    {
      label: <Trans>Fondo de apertura</Trans>,
      value: formatOperationMoney(m.openingMinorUnits, d.currency),
      op: null,
    },
    {
      label: <Trans>Ventas en efectivo</Trans>,
      value: formatOperationMoney(m.cashSalesMinorUnits, d.currency),
      op: '+',
    },
  ];
  if (m.paidInMinorUnits > 0)
    terms.push({
      label: <Trans>Ingresos</Trans>,
      value: formatOperationMoney(m.paidInMinorUnits, d.currency),
      op: '+',
    });
  if (m.paidOutMinorUnits > 0)
    terms.push({
      label: <Trans>Retiros</Trans>,
      value: formatOperationMoney(m.paidOutMinorUnits, d.currency),
      op: '−',
    });
  if (m.safeDropMinorUnits > 0)
    terms.push({
      label: <Trans>Caja fuerte</Trans>,
      value: formatOperationMoney(m.safeDropMinorUnits, d.currency),
      op: '−',
    });
  if (m.refundsMinorUnits > 0)
    terms.push({
      label: <Trans>Reembolsos</Trans>,
      value: formatOperationMoney(m.refundsMinorUnits, d.currency),
      op: '−',
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
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
                <span
                  style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink-3)' }}
                >
                  {term.op}
                </span>
              ) : null}
              <div
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 9,
                  padding: '9px 13px',
                  minWidth: 96,
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
                  {term.label}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 15 }}>
                  {term.value}
                </div>
              </div>
            </div>
          ))}
          <span
            style={{
              alignSelf: 'center',
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              color: 'var(--ink-3)',
            }}
          >
            =
          </span>
          <div
            style={{
              background: 'color-mix(in srgb, var(--merchant-brand) 12%, transparent)',
              borderRadius: 9,
              padding: '9px 13px',
              minWidth: 110,
            }}
          >
            <div
              style={{
                fontSize: 11,
                // 11px text on a 12% tint of its own colour: the accent's ink.
                color: 'var(--accent-ink, var(--merchant-brand))',
                marginBottom: 4,
              }}
            >
              <Trans>Efectivo esperado</Trans>
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 16 }}>
              {formatOperationMoney(m.expectedMinorUnits, d.currency)}
            </div>
          </div>
          <span
            style={{
              alignSelf: 'center',
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              color: 'var(--ink-3)',
            }}
          >
            vs
          </span>
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--line-strong)',
              borderRadius: 9,
              padding: '9px 13px',
              minWidth: 110,
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
              <Trans>Efectivo contado</Trans>
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 16 }}>
              {m.countedMinorUnits == null ? (
                <Trans>Pendiente</Trans>
              ) : (
                formatOperationMoney(m.countedMinorUnits, d.currency)
              )}
            </div>
          </div>
          <span
            style={{
              alignSelf: 'center',
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              color: 'var(--ink-3)',
            }}
          >
            →
          </span>
          <div
            style={{
              borderRadius: 9,
              padding: '9px 13px',
              minWidth: 120,
              background: vTone
                ? `color-mix(in srgb, ${vTone} 14%, transparent)`
                : 'var(--surface-2)',
            }}
          >
            <div style={{ fontSize: 11, color: vTone || 'var(--ink-3)', marginBottom: 4 }}>
              <Trans>Diferencia</Trans>
            </div>
            <div
              className="figures"
              style={{
                fontFamily: 'var(--font-body)',
                fontWeight: 600,
                fontSize: 18,
                color: vTone || 'var(--ink-1)',
              }}
            >
              {m.varianceMinorUnits == null ? '—' : signedMoney(m.varianceMinorUnits, d.currency)}
            </div>
          </div>
        </div>
      </div>

      {(d.openingDenominations.length || d.countDenominations) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          <DenominationTable
            title={<Trans>Denominaciones de apertura</Trans>}
            rows={d.openingDenominations}
            currency={d.currency}
          />
          <DenominationTable
            title={<Trans>Denominaciones del arqueo</Trans>}
            rows={d.countDenominations}
            currency={d.currency}
          />
        </div>
      )}

      <div
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 20 }}
        className="cash-detail-grid"
      >
        {/* ledger */}
        <section>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            <Trans>Libro de caja del turno</Trans>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {d.ledger.length ? (
              d.ledger.map((line, i) => {
                const neutral = line.type === 'count_observation' || line.type === 'opening_float';
                const color = neutral
                  ? 'var(--ink-3)'
                  : line.amountMinorUnits < 0
                    ? 'var(--danger)'
                    : 'var(--success)';
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '9px 2px',
                      borderBottom: '1px solid var(--line-soft)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5 }}>
                        {ENTRY_LABEL[line.type] ? i18n._(ENTRY_LABEL[line.type]) : line.type}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                        {formatOperationDate(line.occurredAt)}
                        {line.receiptNumber ? ` · ${line.receiptNumber}` : ''}
                        {line.reasonCode ? ` · ${line.reasonCode}` : ''}
                        {line.note ? ` · ${line.note}` : ''}
                      </div>
                    </div>
                    <div
                      className="figures"
                      style={{
                        fontFamily: 'var(--font-body)',
                        fontWeight: 600,
                        fontSize: 13.5,
                        color,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {neutral
                        ? formatOperationMoney(line.amountMinorUnits, d.currency)
                        : signedMoney(line.amountMinorUnits, d.currency)}
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
                <div
                  key={c.attempt}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '7px 2px',
                    fontSize: 13,
                    borderBottom: '1px solid var(--line-soft)',
                  }}
                >
                  <span style={{ color: 'var(--ink-3)' }}>
                    <Trans>Intento {c.attempt}</Trans> · {c.state.replaceAll('_', ' ')}
                  </span>
                  <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>
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
              <div
                key={i}
                style={{ padding: '7px 2px', borderBottom: '1px solid var(--line-soft)' }}
              >
                <div style={{ fontSize: 13 }}>{t.text}</div>
                {t.at ? (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: 'var(--ink-3)',
                      // A moment inside the trace is an identifier, not money.
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {formatOperationDate(t.at)}
                  </div>
                ) : null}
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
  const ctx = useMerchant();
  const merchantId = ctx?.selectedMerchantId || ctx?.capabilities?.merchant?.id;
  const locationId = ctx?.selectedLocationId || ctx?.capabilities?.selectedLocation?.id || '';
  const state = useOperationsData('cash_shifts', 0, 0, false);
  const items = (state.data?.items || []).filter((it) => it.facts);
  const [selected, setSelected] = useState(null);

  // The drawer count rule of this location. It lives here because the owner reads
  // it beside the shifts: it decides what every count on the till will ask for.
  const [policy, setPolicy] = useState(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // No merchant or no location means no policy to read: the switch stays off
    // and disabled until the screen has a scope. Setting state here would be a
    // synchronous update inside an effect, which React reads as a cascade.
    if (!merchantId || !locationId) return undefined;
    fetchCashPolicy(merchantId, locationId)
      .then((value) => {
        if (!cancelled) setPolicy(value);
      })
      .catch(() => {
        if (!cancelled) setPolicy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [merchantId, locationId]);

  async function toggleBlindCount(next) {
    if (!merchantId || !locationId) return;
    setPolicySaving(true);
    setPolicyError(null);
    try {
      setPolicy(await setCashPolicy(merchantId, locationId, next));
    } catch {
      setPolicyError(t`No se guardó el conteo. Intenta de nuevo.`);
    } finally {
      setPolicySaving(false);
    }
  }
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

  // Serie y tendencia: the same difference the till shows today, grouped by business day
  // over the window the operations feed covers. The block says which window that is,
  // because a trend without its window is a claim the data cannot support.
  const series = buildVarianceSeries(items);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Pulse and trend: the day's custody at a glance, then the same number over time. */}
      <section className="card" style={{ padding: '18px 20px', display: 'grid', gap: 16 }}>
        {/* The title, and nothing else: no band, no rule, no sentence under it. */}
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 22 }}>
          <Trans>Turno actual</Trans>
        </h3>
        <div
          style={{
            display: 'grid',
            // Four equal figures on one row. An auto-fit grid broke this card
            // into two rows with an empty half, which read as missing data.
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 20,
          }}
          className="cash-pulse-grid"
        >
          <Kpi
            label={<Trans>Cajas abiertas</Trans>}
            value={openCount}
            note={<Trans>ahora mismo</Trans>}
          />
          <Kpi
            label={<Trans>Efectivo esperado</Trans>}
            value={formatOperationMoney(expected, currency)}
            note={<Trans>en las cajas abiertas</Trans>}
          />
          <Kpi
            label={<Trans>Requieren atención</Trans>}
            value={attention}
            note={<Trans>arqueo, traspaso o cierre</Trans>}
            tone={attention ? 'var(--warning)' : undefined}
          />
          <Kpi
            label={<Trans>Diferencia neta</Trans>}
            value={closed.length ? signedMoney(net, currency) : '—'}
            note={
              closed.length ? (
                <Trans>{closed.length} turnos cerrados</Trans>
              ) : (
                <Trans>sin cierres en la ventana</Trans>
              )
            }
            tone={net < 0 ? 'var(--danger)' : net > 0 ? 'var(--warning)' : undefined}
          />
        </div>

        {/* The rule every count on the till follows. It is a setting, so it reads
            as a row of its own instead of sitting under the figures as a fifth one. */}
        <div
          style={{
            borderTop: '1px solid var(--line-soft)',
            paddingTop: 14,
            display: 'flex',
            gap: 18,
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 280, flex: '1 1 320px' }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              <Trans>Regla del conteo</Trans>
            </div>
            {/* One switch, two coupled settings: a blind location counts the drawer
                by denomination without seeing the expected, and a visible one only
                asks the cashier for the total. The server writes both together. */}
            <label
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                // The row is the target (the checkbox itself is 13px), and the
                // two lines of copy under it measured 40px: four short of the
                // floor. `--control-min` is the same 44px every other control
                // takes.
                minHeight: 'var(--control-min)',
                cursor: policySaving ? 'progress' : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={policy?.blindCountRequired === true}
                disabled={!policy || policySaving}
                onChange={(event) => toggleBlindCount(event.target.checked)}
              />
              <span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  <Trans>Activar conteo ciego</Trans>
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12,
                    color: 'var(--ink-3)',
                    marginTop: 2,
                  }}
                >
                  <Trans>
                    Ciego: la caja cuenta por denominación sin ver el esperado. Visible: la caja
                    solo pide el total.
                  </Trans>
                </span>
              </span>
            </label>
            {policyError ? (
              <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>
                {policyError}
              </div>
            ) : null}
          </div>
          <div
            className="status-pill"
            style={{
              alignSelf: 'flex-start',
              whiteSpace: 'nowrap',
              color: policy ? 'var(--ink-1)' : 'var(--ink-3)',
            }}
          >
            {policy ? (policy.blindCountRequired ? t`Ciego` : t`Visible · total`) : t`Sin política`}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            <Trans>Diferencia neta por día comercial</Trans>
          </div>
          <VarianceTrend series={series} currency={currency} />
        </div>
        <CheckoutRules
          key={`${merchantId}:${locationId}`}
          merchantId={merchantId}
          locationId={locationId}
        />
      </section>

      {state.loading && !state.loaded ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '20px 4px' }}>
          <Trans>Cargando turnos…</Trans>
        </div>
      ) : !items.length ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '20px 4px' }}>
          <Trans>No hay turnos de caja en esta vista.</Trans>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)',
            gap: 20,
            // The list stops where its rows stop. Stretched to the height of the
            // detail beside it, one shift left a card of empty white that read as
            // a screen still loading.
            alignItems: 'start',
          }}
          className="caja-grid"
        >
          <section className="card" style={{ padding: '18px 20px' }} aria-label={t`Turnos de caja`}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              <Trans>Turnos de caja</Trans>
            </div>
            <ShiftTable items={items} selectedId={effectiveSelected} onSelect={setSelected} />
          </section>
          <section className="card" style={{ padding: '20px 22px' }}>
            <ShiftDetail shiftId={effectiveSelected} />
          </section>
        </div>
      )}
    </div>
  );
}
