import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useOperationsData, useSaleReceipt } from '@/data.jsx';
import { formatOperationMoney, formatOperationDate } from './operations-format.js';
import { ReceiptReprintDialog, ReceiptStatusLabel } from './operations-workspace.jsx';

// Reportes → Ventas → Recibos — the receipt record and its print custody: which receipts
// issued, how much each was, and whether the official copy printed, queued or failed. The
// owner searches, opens a sale detail (lines, tender, operator, totals — the receipt
// snapshot), and can order a controlled reprint (COPIA). Reached from inside Ventas, not as
// its own destination (ADR 2026-09-08). Read-only apart from the reprint.

const FILTERS = [
  { id: 'all', label: msg`Todos`, match: () => true },
  { id: 'printed', label: msg`Impresos`, match: (s) => s === 'printed' },
  { id: 'queued', label: msg`En cola`, match: (s) => s === 'queued' || s === 'printing' },
  { id: 'not_printed', label: msg`Sin imprimir`, match: (s) => s === 'not_printed' },
  { id: 'failed', label: msg`Fallidos`, match: (s) => s === 'failed' },
];

// Tender methods as they arrive on the receipt snapshot (payment.method / payments[].method).
const METHOD_LABEL = {
  cash: msg`Efectivo`,
  manual_terminal: msg`Terminal manual`,
  external_terminal: msg`Terminal`,
  card: msg`Tarjeta`,
  wallet: msg`Monedero`,
  stored_value: msg`Monedero`,
  gift_card: msg`Tarjeta de regalo`,
};

// Exception types as they arrive on pos_sale_exception (a void or refund on a committed sale).
const EXCEPTION_LABEL = {
  void: msg`Anulación`,
  full_refund: msg`Reembolso total`,
  partial_refund: msg`Reembolso parcial`,
};

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

function StatusPill({ status }) {
  const tone =
    status === 'printed'
      ? 'var(--success)'
      : status === 'failed'
        ? 'var(--danger)'
        : status === 'not_printed'
          ? 'var(--ink-3)'
          : 'var(--warning)';
  return (
    <span
      className="sub-pill"
      style={{
        background: `color-mix(in srgb, ${tone} 16%, transparent)`,
        color: tone,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <ReceiptStatusLabel status={status} />
    </span>
  );
}

/** One line of the detail totals block. `strong` renders the grand total. */
function TotalRow({ label, value, strong }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        fontSize: strong ? 15 : 13,
        fontWeight: strong ? 700 : 500,
        padding: strong ? '8px 0 0' : '2px 0',
        borderTop: strong ? '1px solid var(--line)' : 'none',
      }}
    >
      <span style={{ color: strong ? 'var(--ink-1)' : 'var(--ink-3)' }}>{label}</span>
      <span className="figures" style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-1)' }}>
        {value}
      </span>
    </div>
  );
}

/**
 * The sale detail drawer. Fetches the receipt snapshot for a row's saleId and renders the
 * lines, tender, operator and totals — the sale as the customer got it — plus the controlled
 * reprint. A row with no linked sale still reprints, it just has no detail to show.
 */
function ReceiptDetailDrawer({ row, onClose, onReprint }) {
  const { t, i18n } = useLingui();
  const { data, loading, loaded, error } = useSaleReceipt(row.saleId, 0);
  const snap = data?.snapshot || null;
  const currency = snap?.currency || row.currency || null;
  const lines = snap?.lines || [];
  const payments =
    snap?.payments ||
    (snap?.payment
      ? [
          {
            tenderId: 'single',
            method: snap.payment.method,
            amount: snap.payment.amount,
            change: 0,
          },
        ]
      : []);
  const exceptions = data?.exceptions || [];

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Detalle del recibo`}
        onClick={(event) => event.stopPropagation()}
        style={{
          maxWidth: 560,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{row.publicReference}</h3>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {formatOperationDate(row.occurredAt)}
            </div>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>

        {!row.saleId ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: 0 }}>
            <Trans>
              Este recibo no tiene una venta ligada, así que no hay un detalle que mostrar. Aún
              puedes reimprimir la copia.
            </Trans>
          </p>
        ) : loading && !loaded ? (
          <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '12px 0' }}>
            <Trans>Cargando detalle…</Trans>
          </div>
        ) : error || !snap ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: 0 }}>
            <Trans>No se pudo cargar el detalle de esta venta.</Trans>
          </p>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px 18px',
                fontSize: 12.5,
                alignItems: 'center',
              }}
            >
              <span>
                <span style={{ color: 'var(--ink-3)' }}>
                  <Trans>Operador</Trans>:{' '}
                </span>
                {snap.operatorName || '—'}
              </span>
              <span>
                <span style={{ color: 'var(--ink-3)' }}>
                  <Trans>Fecha comercial</Trans>:{' '}
                </span>
                {snap.businessDate}
              </span>
              <StatusPill status={row.status} />
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
              <table
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 360 }}
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
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>
                      <Trans>Concepto</Trans>
                    </th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>
                      <Trans>Cant.</Trans>
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                      <Trans>Importe</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln) => (
                    <tr key={ln.lineRef} style={{ borderTop: '1px solid var(--line-soft)' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontWeight: 500 }}>{ln.description}</div>
                        {ln.variantName ? (
                          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                            {ln.variantName}
                          </div>
                        ) : null}
                        {ln.modifiers && ln.modifiers.length ? (
                          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                            {ln.modifiers.join(' · ')}
                          </div>
                        ) : null}
                      </td>
                      <td
                        style={{
                          padding: '8px 8px',
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {ln.quantity}
                      </td>
                      <td
                        style={{
                          padding: '8px 12px',
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {formatOperationMoney(ln.lineTotal, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TotalRow
                label={<Trans>Subtotal</Trans>}
                value={formatOperationMoney(snap.subtotal, currency)}
              />
              {snap.discountTotal ? (
                <TotalRow
                  label={<Trans>Descuento</Trans>}
                  value={'−' + formatOperationMoney(snap.discountTotal, currency)}
                />
              ) : null}
              <TotalRow
                label={<Trans>Impuestos</Trans>}
                value={formatOperationMoney(snap.taxTotal, currency)}
              />
              {snap.tip ? (
                <TotalRow
                  label={<Trans>Propina</Trans>}
                  value={formatOperationMoney(snap.tip, currency)}
                />
              ) : null}
              <TotalRow
                label={<Trans>Total</Trans>}
                value={formatOperationMoney(snap.grandTotal, currency)}
                strong
              />
            </div>

            {payments.length ? (
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  <Trans>Pago</Trans>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {payments.map((p) => (
                    <div
                      key={p.tenderId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        fontSize: 12.5,
                      }}
                    >
                      <span>
                        {i18n._(METHOD_LABEL[p.method] || p.method)}
                        {p.change ? (
                          <span style={{ color: 'var(--ink-3)' }}>
                            {' · '}
                            {t`cambio`} {formatOperationMoney(p.change, currency)}
                          </span>
                        ) : null}
                      </span>
                      <span className="figures" style={{ fontFamily: 'var(--font-mono)' }}>
                        {formatOperationMoney(p.amount, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                <Trans>Actividad</Trans>
              </div>
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <li style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                  <Trans>Emitido</Trans> · {formatOperationDate(snap.issuedAt)}
                </li>
                {exceptions.map((ex) => (
                  <li
                    key={ex.id}
                    style={{
                      fontSize: 12.5,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      borderTop: '1px solid var(--line-soft)',
                      paddingTop: 8,
                    }}
                  >
                    <span>
                      <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                        {i18n._(EXCEPTION_LABEL[ex.exceptionType] || ex.exceptionType)}
                      </span>
                      {' · '}
                      {ex.operator || '—'}
                      {ex.approved ? (
                        <span style={{ color: 'var(--success)' }}> · {t`aprobado`}</span>
                      ) : null}
                      {ex.reasonCode ? (
                        <span style={{ color: 'var(--ink-3)' }}>
                          {' '}
                          · {String(ex.reasonCode).replaceAll('_', ' ')}
                        </span>
                      ) : null}
                      <span style={{ color: 'var(--ink-3)' }}>
                        {' '}
                        · {formatOperationDate(ex.occurredAt)}
                      </span>
                    </span>
                    <span
                      className="figures"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--danger)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      −{formatOperationMoney(ex.totalMinorUnits, ex.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {row.status !== 'not_printed' ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              borderTop: '1px solid var(--line)',
              paddingTop: 12,
            }}
          >
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => onReprint(row)}
            >
              <Trans>Reimprimir</Trans>
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default function Recibos() {
  const { t, i18n } = useLingui();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' });
  const [reprintRow, setReprintRow] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const state = useOperationsData('receipts', 0, refresh, false);
  const items = state.data?.items || [];
  const currency = items.find((i) => i.currency)?.currency ?? null;

  const printed = items.filter((i) => i.status === 'printed').length;
  const queued = items.filter((i) => i.status === 'queued' || i.status === 'printing').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const billed = items.reduce((sum, i) => sum + (i.amountMinorUnits ?? 0), 0);

  const active = FILTERS.find((f) => f.id === filter) || FILTERS[0];
  const q = search.trim().toLowerCase();
  // Search runs over what a row already carries: receipt number, amount (formatted and raw),
  // and issue date. Card last-4 and operator search need list enrichment and land in a later
  // pass, once those columns join the receipts read model.
  const filtered = items.filter((i) => {
    if (!active.match(i.status)) return false;
    if (!q) return true;
    const hay = [
      i.publicReference,
      formatOperationMoney(i.amountMinorUnits, i.currency),
      i.amountMinorUnits != null ? String(i.amountMinorUnits) : '',
      formatOperationDate(i.occurredAt),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
  const mul = sort.dir === 'asc' ? 1 : -1;
  const sorted = [...filtered].sort((a, b) =>
    sort.col === 'amount'
      ? mul * ((a.amountMinorUnits ?? 0) - (b.amountMinorUnits ?? 0))
      : mul * String(a.occurredAt || '').localeCompare(String(b.occurredAt || '')),
  );

  const th = (col, node, alignRight) => {
    const activeCol = sort.col === col;
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
          color: activeCol ? 'var(--ink-1)' : 'var(--ink-3)',
          whiteSpace: 'nowrap',
        }}
      >
        {node} {activeCol ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
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
          label={<Trans>Recibos</Trans>}
          value={items.length}
          meta={<Trans>en esta vista</Trans>}
        />
        <Kpi
          label={<Trans>Impresos</Trans>}
          value={printed}
          tone={printed ? 'var(--success)' : undefined}
        />
        <Kpi
          label={<Trans>En cola</Trans>}
          value={queued}
          tone={queued ? 'var(--warning)' : undefined}
        />
        <Kpi
          label={<Trans>Fallidos</Trans>}
          value={failed}
          tone={failed ? 'var(--danger)' : undefined}
        />
        <Kpi
          label={<Trans>Total facturado</Trans>}
          value={formatOperationMoney(billed, currency)}
          meta={<Trans>en esta vista</Trans>}
        />
      </div>

      {state.loading && !state.loaded ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '24px 4px' }}>
          <Trans>Cargando recibos…</Trans>
        </div>
      ) : !items.length ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '24px 4px' }}>
          <Trans>Aún no hay recibos en esta vista.</Trans>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t`Buscar por recibo, monto o fecha…`}
              aria-label={t`Buscar recibos`}
              style={{
                maxWidth: 360,
                padding: '8px 12px',
                border: '1px solid var(--line)',
                borderRadius: 10,
                background: 'var(--surface)',
                color: 'var(--ink-1)',
                fontSize: 13,
              }}
            />
            <div
              role="group"
              aria-label={t`Filtrar por estado`}
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
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}
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
                      <Trans>Recibo</Trans>
                    </th>
                    {th('date', <Trans>Emitido</Trans>, false)}
                    <th
                      style={{
                        padding: '9px 12px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: 'var(--ink-3)',
                      }}
                    >
                      <Trans>Estado</Trans>
                    </th>
                    {th('amount', <Trans>Monto</Trans>, true)}
                    <th style={{ padding: '9px 12px' }} aria-label={t`Acciones`} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        style={{ padding: '20px 12px', color: 'var(--ink-3)', fontSize: 13 }}
                      >
                        <Trans>Ningún recibo coincide con la búsqueda.</Trans>
                      </td>
                    </tr>
                  ) : (
                    sorted.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => setDetailRow(item)}
                        style={{ borderTop: '1px solid var(--line-soft)', cursor: 'pointer' }}
                      >
                        <td style={{ padding: '9px 12px' }}>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDetailRow(item);
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 600,
                              color: 'var(--ink-2)',
                              textAlign: 'left',
                            }}
                          >
                            {item.publicReference}
                          </button>
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
                        <td style={{ padding: '9px 12px' }}>
                          <StatusPill status={item.status} />
                        </td>
                        <td
                          style={{
                            padding: '9px 12px',
                            textAlign: 'right',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 600,
                          }}
                        >
                          {formatOperationMoney(item.amountMinorUnits, item.currency)}
                        </td>
                        <td
                          style={{ padding: '7px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}
                        >
                          {item.status !== 'not_printed' ? (
                            <button
                              className="btn btn-secondary btn-sm"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setReprintRow(item);
                              }}
                            >
                              <Trans>Reimprimir</Trans>
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: 0, maxWidth: '64ch' }}>
            <Trans>
              Abre un recibo para ver la venta con sus conceptos, impuestos y forma de pago. El
              recibo oficial se imprime en la caja; aquí puedes ordenar una COPIA controlada cuando
              el cliente la pide.
            </Trans>
          </p>
        </>
      )}

      {detailRow ? (
        <ReceiptDetailDrawer
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onReprint={(row) => {
            setDetailRow(null);
            setReprintRow(row);
          }}
        />
      ) : null}

      {reprintRow ? (
        <ReceiptReprintDialog
          row={reprintRow}
          onClose={() => setReprintRow(null)}
          onComplete={() => setRefresh((r) => r + 1)}
        />
      ) : null}
    </div>
  );
}
