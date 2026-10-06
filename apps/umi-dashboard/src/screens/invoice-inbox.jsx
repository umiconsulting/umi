import { useMemo, useRef, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { Select } from '@/components/select.jsx';
import { useAdministrativeCommand } from '@/lib/administrative-command.jsx';
import { hasRequiredPermission } from '@/lib/module-registry.js';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { useInventoryItems, useSupplierInvoiceInbox } from '@/data.jsx';
import { formatMoney } from '@/lib/format.js';
import {
  INVOICE_STATUS_LABEL,
  buildCommitLines,
  commitReady,
  invoiceLineTally,
  invoiceStatusLabel,
  lineQuantityText,
  matchMethodLabel,
  orderLinesForItem,
  priceChangeText,
} from './invoice-model.js';

/**
 * Facturas - the console's supplier-invoice inbox (recipes module plan 7, 10 and
 * 11, Phase 5).
 *
 * THE OWNER UPLOADS THE SUPPLIER'S OWN DOCUMENT. A CFDI 4.0 XML file is read as
 * TEXT in the browser and posted as `source: 'cfdi_xml'`. The server parses it, so
 * the folio, the issuer, the date, the totals and the unit prices on this screen
 * are the server's answer and never a guess. A PHOTO IS NOT OFFERED, because the
 * extractor of plan 10.2 does not exist yet, so this screen does not pretend it
 * does.
 *
 * THE PRICE FLAG IS THE POINT. A line whose cost differs from the last price paid,
 * or from the price the open order expected, prints BOTH numbers (plan 10.3).
 *
 * AN UNMATCHED LINE BLOCKS THE COMMIT. The operator cashes the line by hand with
 * `inventory.invoice.match` and may remember the supplier's SKU for the next
 * invoice. `inventory.invoice.commit` takes the purchase order, so the modal names
 * the order and its own line for every invoice line. A refusal names the line.
 *
 * THE READS ARE GATED ON `merchant.manage` on the server, and the tab is reachable
 * with `catalog.read` or `inventory.read`, so the permission is checked first and
 * a cashier's pass never hits the reads.
 */
const MANAGE_GATE = { permissions: ['merchant.manage'] };
const CAPTURE_GATE = { permissions: ['inventory.invoice.capture'] };
const APPROVE_GATE = { permissions: ['inventory.invoice.approve'] };

const STATUS_ORDER = ['uploaded', 'extracted', 'matched', 'committed', 'rejected'];
const STATUS_TONE = {
  uploaded: 'neutral',
  extracted: 'warning',
  matched: 'ok',
  committed: 'ok',
  rejected: 'danger',
};

const HEAD = {
  textAlign: 'left',
  padding: '8px 10px',
  fontWeight: 600,
  color: 'var(--ink-3)',
  fontSize: 11.5,
  letterSpacing: 0,
  whiteSpace: 'nowrap',
};
const CELL = { padding: '10px', verticalAlign: 'top' };
const NUM = { ...CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

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

const INVOICE_ERROR_COPY = {
  SUPPLIER_INVOICE_UNMATCHED_LINES: msg`La factura tiene líneas sin casar. Casa cada línea marcada antes de registrar la entrada.`,
  SUPPLIER_INVOICE_NOT_FOUND: msg`La factura ya no existe. Recarga la lista.`,
  SUPPLIER_INVOICE_ALREADY_COMMITTED: msg`La factura ya tiene su entrada registrada.`,
  PURCHASE_ORDER_NOT_FOUND: msg`El pedido ya no existe. Recarga la lista.`,
  INVENTORY_ITEM_NOT_FOUND: msg`Un artículo ya no existe. Recarga la lista.`,
  PERMISSION_DENIED: msg`No tienes permiso para administrar el inventario.`,
  VALIDATION_FAILED: msg`Revisa los datos. La API no aceptó la operación.`,
  SERVICE_UNAVAILABLE: msg`El servicio no está disponible. Intenta de nuevo después.`,
};

function errorText(i18n, copy, error) {
  if (!error) return null;
  const known = copy[error.code];
  return known ? i18n._(known) : error.message;
}

const TONES = {
  neutral: { background: 'var(--canvas-2)', color: 'var(--ink-2)' },
  warning: { background: 'var(--warning-soft)', color: 'var(--warning)' },
  ok: { background: 'var(--success-soft)', color: 'var(--success)' },
  danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
};

/** A named state, never a zero and never an empty cell. */
function Pill({ tone = 'warning', children }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 9px',
        borderRadius: 'var(--r-pill)',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        ...TONES[tone],
      }}
    >
      {children}
    </span>
  );
}

/** The house `.switch` class with the ARIA role a toggle needs. */
function Toggle({ checked, label, onChange }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      />
      <span className="muted">{label}</span>
    </span>
  );
}

function NoPermissionNotice() {
  return (
    <div className="card" style={{ padding: 18 }}>
      <p style={{ margin: 0, color: 'var(--ink-2)' }}>
        <Trans>No puedes administrar las facturas.</Trans>
      </p>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5 }}>
        <Trans>
          Pide a la persona propietaria que te dé el permiso para administrar el negocio.
        </Trans>
      </p>
    </div>
  );
}

/**
 * The manual match. `inventory.invoice.match` takes one line at a time here,
 * because one line is what the operator is looking at. The supplier's SKU is
 * remembered on the way in, so the next invoice of the same supplier matches
 * without a person.
 */
function MatchLineDialog({ invoice, line, items, onClose, onMatched }) {
  const { t, i18n } = useLingui();
  const merchant = useMerchant();
  const command = useAdministrativeCommand();
  const [itemId, setItemId] = useState(line.matchedInventoryItemId || '');
  const [remember, setRemember] = useState(false);
  const [sku, setSku] = useState(line.supplierSku || '');
  const locationId = merchant?.selectedLocationId || merchant?.selectedLocation?.id || null;

  const itemOptions = useMemo(
    () => [...(items || [])].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [items],
  );
  const skuReady = !remember || sku.trim().length > 0;
  const savable = Boolean(itemId) && skuReady && !command.pending;

  async function save() {
    if (!savable) return;
    await command.execute('inventory.invoice.match', invoice.id, {
      locationId,
      parameters: {
        lines: [
          {
            lineId: line.id,
            inventoryItemId: itemId,
            supplierSku: remember ? sku.trim() : null,
          },
        ],
      },
    });
    await onMatched();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Casar la línea ${line.lineNumber}`}
        style={{ width: 'min(560px, 94vw)', display: 'grid', gap: 16 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ margin: 0 }}>
            <Trans>Casar la línea {line.lineNumber}</Trans>
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            <I.X size={16} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: 11.5 }}>
            <Trans>Descripción del proveedor</Trans>
          </span>
          <strong style={{ fontWeight: 600 }}>{line.rawDescription}</strong>
        </div>

        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          <Trans>Artículo del inventario</Trans>
          <Select value={itemId} onChange={(event) => setItemId(event.target.value)}>
            <option value="">{t`Elige un artículo`}</option>
            {itemOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName} · {item.publicReference}
              </option>
            ))}
          </Select>
        </label>

        <div style={{ display: 'grid', gap: 8 }}>
          <Toggle
            checked={remember}
            label={t`Recordar el SKU del proveedor`}
            onChange={setRemember}
          />
          {remember ? (
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <Trans>SKU del proveedor</Trans>
              <input
                className="input"
                value={sku}
                maxLength={80}
                onChange={(event) => setSku(event.target.value)}
              />
              {sku.trim().length === 0 ? (
                <span style={{ color: 'var(--danger)', fontSize: 11.5 }}>
                  <Trans>Escribe el SKU que el proveedor usa en esta línea.</Trans>
                </span>
              ) : null}
            </label>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            <Trans>Cancelar</Trans>
          </button>
          <button className="btn btn-primary" type="button" onClick={save} disabled={!savable}>
            <Trans>Guardar el cotejo</Trans>
          </button>
        </div>

        {command.error ? (
          <p style={{ color: 'var(--danger)', margin: 0, fontSize: 12.5 }}>
            {errorText(i18n, INVOICE_ERROR_COPY, command.error)}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/**
 * The commit. The request wants the purchase order, one of its lines and a
 * received quantity per line, so this modal reads the order the operator chooses
 * and offers that order's own lines for each cashed invoice line. The unit cost
 * comes from the INVOICE, because the invoice is the document that priced the
 * goods (plan 10.4). A refusal names the unmatched line.
 */
function CommitInvoiceDialog({ invoice, orders, onClose, onCommitted }) {
  const { t, i18n } = useLingui();
  const merchant = useMerchant();
  const command = useAdministrativeCommand();
  const [orderId, setOrderId] = useState('');
  const [draftByLineId, setDraftByLineId] = useState({});
  const locationId = merchant?.selectedLocationId || merchant?.selectedLocation?.id || null;

  const order = useMemo(
    () => (orders || []).find((entry) => entry.id === orderId) || null,
    [orders, orderId],
  );
  const tally = invoiceLineTally(invoice);
  const built = buildCommitLines({ invoice, order, draftByLineId });
  const unmatchedIds = new Set(built.unmatchedLineIds);
  const savable = built.state === 'ready' && !command.pending;

  function setLineDraft(lineId, patch) {
    setDraftByLineId((previous) => ({
      ...previous,
      [lineId]: { ...(previous[lineId] || {}), ...patch },
    }));
  }

  async function commit() {
    if (!savable) return;
    await command.execute('inventory.invoice.commit', invoice.id, {
      locationId,
      parameters: { purchaseOrderId: order.id, lines: built.lines },
    });
    await onCommitted();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Registrar la entrada de la factura`}
        style={{
          width: 'min(880px, 94vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'grid',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ margin: 0 }}>
            <Trans>Registrar la entrada</Trans>
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            <I.X size={16} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 12.5 }}>
          <strong>{invoice.folio || <Trans>Sin folio</Trans>}</strong>{' '}
          <span className="muted">
            {invoice.supplierName || <Trans>Proveedor sin identificar</Trans>}
          </span>
        </p>

        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          <Trans>Pedido de compra</Trans>
          <Select value={orderId} onChange={(event) => setOrderId(event.target.value)}>
            <option value="">{t`Elige un pedido`}</option>
            {(orders || []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.publicReference} · {entry.supplierName}
                {entry.expectedOn ? ` · ${entry.expectedOn}` : ''}
              </option>
            ))}
          </Select>
        </label>

        <div style={{ display: 'grid' }}>
          {(invoice.lines || []).map((line) => {
            const isUnmatched = unmatchedIds.has(line.id) || !line.matchedInventoryItemId;
            const candidates = orderLinesForItem(order, line.matchedInventoryItemId);
            const draft = draftByLineId[line.id] || {};
            const chosenOrderLineId =
              draft.purchaseOrderLineId || (candidates[0] ? candidates[0].id : '');
            return (
              <div
                key={line.id}
                style={{
                  display: 'grid',
                  gap: 8,
                  padding: '10px 0',
                  borderTop: '1px solid var(--line)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong style={{ fontWeight: 600 }}>
                    {line.lineNumber}. {line.rawDescription}
                  </strong>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {lineQuantityText(line.quantity)}{' '}
                    {UNIT_LABEL[line.quantity.unit]
                      ? i18n._(UNIT_LABEL[line.quantity.unit])
                      : line.quantity.unit}{' '}
                    · {formatMoney(line.unitCostMinor, invoice.currency)}
                  </span>
                </div>

                {isUnmatched ? (
                  <p style={{ margin: 0, color: 'var(--warning)', fontSize: 12.5 }}>
                    <Trans>
                      Esta línea no está casada. Casa la línea antes de registrar la entrada.
                    </Trans>
                  </p>
                ) : candidates.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--warning)', fontSize: 12.5 }}>
                    <Trans>El pedido no tiene una línea para este artículo.</Trans>
                  </p>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: 12,
                    }}
                  >
                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      <Trans>Línea del pedido</Trans>
                      <Select
                        value={chosenOrderLineId}
                        onChange={(event) =>
                          setLineDraft(line.id, { purchaseOrderLineId: event.target.value })
                        }
                      >
                        {candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {t`Línea ${candidate.lineNumber}`}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      <Trans>Cantidad recibida</Trans>
                      <input
                        className="input"
                        value={
                          draft.receivedText == null
                            ? lineQuantityText(line.quantity)
                            : draft.receivedText
                        }
                        inputMode="decimal"
                        aria-label={t`Cantidad recibida de la línea ${line.lineNumber}`}
                        onChange={(event) =>
                          setLineDraft(line.id, { receivedText: event.target.value })
                        }
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {tally.unmatched > 0 ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill tone="warning">
              <Plural value={tally.unmatched} one="# línea sin casar" other="# líneas sin casar" />
            </Pill>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {tally.unmatchedLines
                .map((line) => `${line.lineNumber}. ${line.rawDescription}`)
                .join(' · ')}
            </span>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            <Trans>Cancelar</Trans>
          </button>
          <button className="btn btn-primary" type="button" onClick={commit} disabled={!savable}>
            <I.Check size={16} />
            <Trans>Registrar la entrada</Trans>
          </button>
        </div>

        {command.error ? (
          <p style={{ color: 'var(--danger)', margin: 0, fontSize: 12.5 }}>
            {errorText(i18n, INVOICE_ERROR_COPY, command.error)}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export default function InvoiceInbox() {
  const { t, i18n } = useLingui();
  const merchant = useMerchant();
  const capabilities = merchant?.capabilities || null;
  const canManage = hasRequiredPermission(MANAGE_GATE, capabilities);
  const canCapture = hasRequiredPermission(CAPTURE_GATE, capabilities);
  const canApprove = hasRequiredPermission(APPROVE_GATE, capabilities);
  const command = useAdministrativeCommand();
  const fileRef = useRef(null);
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState('');
  const [reading, setReading] = useState({ pending: false, error: null });
  const [matching, setMatching] = useState(null);
  const [committing, setCommitting] = useState(null);

  const locationId = merchant?.selectedLocationId || merchant?.selectedLocation?.id || null;
  const inbox = useSupplierInvoiceInbox({ status: status || null }, refresh);
  const itemsState = useInventoryItems({ includeArchived: false }, refresh);
  const invoices = inbox.data.invoices || [];
  const items = itemsState.data.items || [];

  async function pickFile(event) {
    const file = event.target.files && event.target.files[0];
    // The same file must be uploadable twice, so the input forgets the choice.
    event.target.value = '';
    if (!file) return;
    setReading({ pending: true, error: null });
    try {
      const cfdiXml = await file.text();
      await command.execute('inventory.invoice.upload', crypto.randomUUID(), {
        locationId,
        parameters: { source: 'cfdi_xml', cfdiXml },
      });
      setReading({ pending: false, error: null });
      setRefresh((value) => value + 1);
    } catch (error) {
      setReading({ pending: false, error });
    }
  }

  async function reload() {
    setMatching(null);
    setCommitting(null);
    setRefresh((value) => value + 1);
  }

  if (merchant?.loading && !capabilities) {
    return (
      <p className="muted">
        <Trans>Cargando las facturas…</Trans>
      </p>
    );
  }
  if (!canManage) return <NoPermissionNotice />;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: 4 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            style={{ display: 'none' }}
            onChange={pickFile}
          />
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => fileRef.current && fileRef.current.click()}
            disabled={reading.pending}
          >
            <I.Receipt size={16} />
            <Trans>Subir factura XML</Trans>
          </button>
          <span className="muted" style={{ fontSize: 11.5 }}>
            <Trans>Solo archivos XML (CFDI).</Trans>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label={t`Filtrar por estado`}
          >
            <option value="">{t`Todas las facturas`}</option>
            {STATUS_ORDER.map((entry) => (
              <option key={entry} value={entry}>
                {i18n._(INVOICE_STATUS_LABEL[entry])}
              </option>
            ))}
          </Select>
          <button
            className="btn-icon"
            type="button"
            aria-label={t`Recargar las facturas`}
            title={t`Recargar las facturas`}
            onClick={reload}
          >
            <I.Refresh size={15} />
          </button>
        </div>
      </div>

      {reading.error ? (
        <p style={{ color: 'var(--danger)', margin: 0, fontSize: 12.5 }}>
          {errorText(i18n, INVOICE_ERROR_COPY, reading.error)}
        </p>
      ) : null}

      {inbox.data.ordersFailed ? (
        <p style={{ color: 'var(--warning)', margin: 0, fontSize: 12.5 }}>
          <Trans>No se pudieron leer los pedidos de compra. Recarga la lista.</Trans>
        </p>
      ) : null}

      {inbox.loading && !inbox.loaded ? (
        <p className="muted">
          <Trans>Cargando las facturas…</Trans>
        </p>
      ) : inbox.error ? (
        <p style={{ color: 'var(--danger)' }}>
          {errorText(i18n, INVOICE_ERROR_COPY, {
            code: inbox.errorCode,
            message: inbox.error,
          })}
        </p>
      ) : invoices.length === 0 ? (
        <p className="muted">
          <Trans>Aún no hay facturas. Sube el archivo XML del proveedor.</Trans>
        </p>
      ) : (
        invoices.map((invoice) => {
          const tally = invoiceLineTally(invoice);
          const check = commitReady(invoice);
          const committed = invoice.status === 'committed';
          const lineMoney = (minorUnits) => formatMoney(minorUnits, invoice.currency);
          return (
            <article
              className="card"
              key={invoice.id}
              style={{ padding: 16, display: 'grid', gap: 12 }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'grid', gap: 4 }}>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ fontWeight: 600 }}>
                      {invoice.folio || <Trans>Sin folio</Trans>}
                    </strong>
                    <Pill tone={STATUS_TONE[invoice.status] || 'neutral'}>
                      {invoiceStatusLabel(invoice.status)
                        ? i18n._(invoiceStatusLabel(invoice.status))
                        : invoice.status}
                    </Pill>
                  </span>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {invoice.supplierName || <Trans>Proveedor sin identificar</Trans>}
                  </span>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {invoice.issuedOn ? (
                      <Trans>Facturada el {invoice.issuedOn}</Trans>
                    ) : (
                      <Trans>Sin fecha de factura</Trans>
                    )}
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 4, justifyItems: 'end' }}>
                  <strong style={{ fontWeight: 600 }}>
                    {formatMoney(invoice.totalMinor, invoice.currency)}
                  </strong>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    <Trans>Subtotal {formatMoney(invoice.subtotalMinor, invoice.currency)}</Trans>
                  </span>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    <Trans>Impuestos {formatMoney(invoice.taxMinor, invoice.currency)}</Trans>
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Pill tone="ok">
                  <Plural value={tally.matched} one="# línea casada" other="# líneas casadas" />
                </Pill>
                {tally.unmatched > 0 ? (
                  <Pill tone="warning">
                    <Plural
                      value={tally.unmatched}
                      one="# línea sin casar"
                      other="# líneas sin casar"
                    />
                  </Pill>
                ) : null}
                {tally.priceChanged > 0 ? (
                  <Pill tone="warning">
                    <Plural
                      value={tally.priceChanged}
                      one="# cambio de precio"
                      other="# cambios de precio"
                    />
                  </Pill>
                ) : null}
                <span className="muted" style={{ fontSize: 11.5 }}>
                  <Trans>Total de {tally.total} líneas.</Trans>
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      <th scope="col" style={HEAD}>
                        <Trans>Nº</Trans>
                      </th>
                      <th scope="col" style={HEAD}>
                        <Trans>Descripción del proveedor</Trans>
                      </th>
                      <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                        <Trans>Cantidad</Trans>
                      </th>
                      <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                        <Trans>Costo unitario</Trans>
                      </th>
                      <th scope="col" style={HEAD}>
                        <Trans>Cotejo</Trans>
                      </th>
                      {canCapture ? (
                        <th scope="col" style={HEAD}>
                          <Trans>Acciones</Trans>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {(invoice.lines || []).map((line) => {
                      const matched = Boolean(line.matchedInventoryItemId);
                      const priceText = priceChangeText(line, lineMoney);
                      const unit = UNIT_LABEL[line.quantity.unit]
                        ? i18n._(UNIT_LABEL[line.quantity.unit])
                        : line.quantity.unit;
                      return (
                        <tr key={line.id} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={CELL}>{line.lineNumber}</td>
                          <td style={CELL}>
                            <div style={{ display: 'grid', gap: 4 }}>
                              <strong style={{ fontWeight: 600 }}>{line.rawDescription}</strong>
                              <span
                                style={{
                                  display: 'flex',
                                  gap: 6,
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                }}
                              >
                                {line.supplierSku ? (
                                  <span className="muted" style={{ fontSize: 11.5 }}>
                                    {t`SKU ${line.supplierSku}`}
                                  </span>
                                ) : null}
                                {matched ? null : (
                                  <Pill tone="warning">
                                    <Trans>Sin casar</Trans>
                                  </Pill>
                                )}
                                {line.priceChanged ? (
                                  <Pill tone="warning">
                                    <Trans>Cambió el precio</Trans>
                                  </Pill>
                                ) : null}
                              </span>
                            </div>
                          </td>
                          <td style={NUM}>
                            {lineQuantityText(line.quantity)} {unit}
                          </td>
                          <td style={NUM}>
                            <div style={{ display: 'grid', gap: 4, justifyItems: 'end' }}>
                              <strong style={{ fontWeight: 600 }}>
                                {formatMoney(line.unitCostMinor, invoice.currency)}
                              </strong>
                              {priceText ? (
                                <span style={{ color: 'var(--warning)', fontSize: 11.5 }}>
                                  {priceText}
                                </span>
                              ) : null}
                              <span className="muted" style={{ fontSize: 11.5 }}>
                                <Trans>
                                  Total de la línea{' '}
                                  {formatMoney(line.lineTotalMinor, invoice.currency)}
                                </Trans>
                              </span>
                            </div>
                          </td>
                          <td style={CELL}>
                            {matched ? (
                              <div style={{ display: 'grid', gap: 4 }}>
                                <strong style={{ fontWeight: 600 }}>
                                  {line.matchedInventoryItemName ||
                                    t`Artículo sin nombre en la respuesta`}
                                </strong>
                                <span>
                                  <Pill tone="neutral">
                                    {matchMethodLabel(line.matchMethod)
                                      ? i18n._(matchMethodLabel(line.matchMethod))
                                      : line.matchMethod}
                                  </Pill>
                                </span>
                              </div>
                            ) : (
                              <Pill tone="warning">
                                <Trans>Sin casar</Trans>
                              </Pill>
                            )}
                          </td>
                          {canCapture ? (
                            <td style={CELL}>
                              <button
                                className="btn-icon"
                                type="button"
                                aria-label={t`Casar la línea ${line.lineNumber}`}
                                title={t`Casar la línea ${line.lineNumber}`}
                                onClick={() => setMatching({ invoice, line })}
                              >
                                <I.Edit size={15} />
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {canApprove && !committed ? (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => setCommitting({ invoice })}
                  >
                    <I.Check size={16} />
                    <Trans>Registrar la entrada</Trans>
                  </button>
                  {check.ready ? null : (
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      <Trans>Casa cada línea antes de registrar la entrada.</Trans>
                    </span>
                  )}
                </div>
              ) : null}
            </article>
          );
        })
      )}

      {matching ? (
        <MatchLineDialog
          invoice={matching.invoice}
          line={matching.line}
          items={items}
          onClose={() => setMatching(null)}
          onMatched={reload}
        />
      ) : null}

      {committing ? (
        <CommitInvoiceDialog
          invoice={committing.invoice}
          orders={inbox.data.purchaseOrders}
          onClose={() => setCommitting(null)}
          onCommitted={reload}
        />
      ) : null}
    </div>
  );
}
