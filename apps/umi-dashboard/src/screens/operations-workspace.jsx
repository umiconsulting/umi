import { useEffect, useState } from 'react';
import { Select } from '@/components/select.jsx';
import { Segmented } from '@/components/segmented.jsx';
import { PageHead } from '@/components/page-head.jsx';
import { useNavigate } from 'react-router-dom';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { loadSaleReceipt, useOperationsData } from '@/data.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { formatOperationDate, formatOperationMoney } from './operations-format.js';
import { useAdministrativeCommand } from '@/lib/administrative-command.jsx';

const ACTION_ROUTES = {
  organization: '/settings',
  locations: '/settings',
  memberships: '/staff',
  devices: '/devices',
  customers: '/customers',
  loyalty: '/members',
  rewards: '/members',
  gift_cards: '/gift-cards',
  kitchen: '/orders',
};

const ERROR_COPY = {
  PERMISSION_DENIED: msg`No tienes el permiso requerido para esta operación.`,
  LOCATION_SCOPE_VIOLATION: msg`La ubicación no pertenece a tu alcance.`,
  OPTIMISTIC_VERSION_CONFLICT: msg`Los datos cambiaron. Actualiza la vista antes de continuar.`,
  HARDWARE_OUTCOME_UNKNOWN: msg`El resultado físico es desconocido. Verifica el equipo antes de repetir.`,
  RECOVERY_REQUIRED: msg`Consulta el comando original en el Centro de recuperación.`,
  SERVICE_UNAVAILABLE: msg`El servicio no está disponible. Intenta de nuevo después.`,
};

// Domain heading labels, localized on the client. The API's domain registry sends a
// Spanish `label`; here the owner reads the heading in the active language. Any domain
// not mapped falls back to the server label, so nothing regresses.
const DOMAIN_LABELS = {
  organization: msg`Organización`,
  locations: msg`Ubicaciones`,
  memberships: msg`Usuarios y membresías`,
  devices: msg`Dispositivos POS`,
  registers: msg`Registros`,
  catalog: msg`Catálogo`,
  inventory: msg`Inventario`,
  sales: msg`Ventas`,
  receipts: msg`Recibos`,
  refunds_voids: msg`Reembolsos y anulaciones`,
  cash_shifts: msg`Turnos de caja`,
  customers: msg`Clientes`,
  loyalty: msg`Lealtad`,
  rewards: msg`Recompensas`,
  wallet: msg`Wallet`,
  gift_cards: msg`Gift cards`,
  kitchen: msg`Cocina y KDS`,
  recovery: msg`Centro de recuperación`,
  audit: msg`Auditoría`,
  diagnostics: msg`Diagnóstico`,
};

/**
 * The verb one row offers, by domain. A list row carries one main action. The
 * action names the thing a person does to that row. The audit of 2026-09-18
 * measured the catalog printing three raw enum names instead: `REVIEW`, `EDIT
 * PRODUCT`, and `ARCHIVE`, each as a green pill.
 */
const ROW_ACTION_LABEL = {
  catalog: msg`Editar`,
  inventory: msg`Operar`,
  receipts: msg`Reimprimir`,
  loyalty: msg`Ajustar`,
  gift_cards: msg`Emitir`,
  registers: msg`Configurar`,
  recovery: msg`Recuperar`,
  sales: msg`Reembolsar`,
};

/** The owner-facing sentence for an API error code, or the raw message when none maps. */
function errorCopy(i18n, error) {
  if (!error) return null;
  const known = ERROR_COPY[error.code];
  return known ? i18n._(known) : error.message;
}

function CommandError({ command }) {
  const { i18n } = useLingui();
  if (!command.error) return null;
  return <p style={{ color: 'var(--danger)' }}>{errorCopy(i18n, command.error)}</p>;
}

/**
 * The colour language for a record state.
 *
 * The audit of 2026-09-18 found this slot printing a green `ACTIVE` pill on every
 * row of the catalog: a column where every value is equal, in the strongest
 * colour on the screen. So an ordinary state is a quiet word. Only a state that
 * asks a person to act takes a colour. `status-plain` and `inv-state-pill` own
 * the look.
 */
const STATE_TONE = {
  needs_review: 'low',
  warning: 'low',
  pending: 'low',
  queued: 'low',
  printing: 'low',
  counting: 'low',
  closing: 'low',
  reconciliation_required: 'low',
  rotation: 'low',
  low: 'low',
  failed: 'out',
  blocked: 'out',
  error: 'out',
  expired: 'out',
  short: 'out',
};

/** The owner-facing word for a record state. The key is the API enum. */
const STATE_LABEL = {
  active: msg`Activo`,
  inactive: msg`Inactivo`,
  archived: msg`Archivado`,
  pending: msg`Pendiente`,
  needs_review: msg`Necesita revisión`,
  blocked: msg`Bloqueado`,
  failed: msg`Falló`,
  available: msg`Disponible`,
  in_use: msg`En uso`,
  printed: msg`Impreso`,
  not_printed: msg`Sin imprimir`,
  queued: msg`En cola`,
  printing: msg`Imprimiendo`,
  reconciliation_required: msg`Conciliación`,
};

function Status({ value }) {
  const { t, i18n } = useLingui();
  const key = String(value || '').toLowerCase();
  const raw = value
    ? STATE_LABEL[key]
      ? i18n._(STATE_LABEL[key])
      : String(value).replaceAll('_', ' ')
    : t`desconocido`;
  const tone = STATE_TONE[key];
  if (!tone) return <span className="status-plain">{raw}</span>;
  return (
    <span className="inv-state-pill">
      <span className="inv-dot" data-state={tone} aria-hidden="true" />
      {raw}
    </span>
  );
}

/** The "PIN del aprobador" field, shared by every dialog that may need a manager. */
function ManagerPinField({ value, onChange }) {
  return (
    <label>
      <Trans>PIN del aprobador</Trans>
      <input
        type="password"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

const HARDWARE_TERMINAL = new Set(['succeeded', 'failed', 'retryable', 'cancelled', 'unknown']);

async function waitForHardwareResult(command, commandId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const response = await command.execute('hardware.command.status', commandId);
    if (HARDWARE_TERMINAL.has(response.result?.command?.status)) return response.result;
  }
  return { command: { commandId, status: 'pending' } };
}

/**
 * A dialog answers Escape. The audit of 2026-09-18 measured a completed dialog
 * with no keyboard exit. `busy` blocks the key while a command is in flight, so a
 * person cannot abandon a write by accident.
 */
function useEscapeToClose(onClose, busy) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
}

function RefundDialog({ sale, onClose, onComplete }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
  useEscapeToClose(onClose, command.pending);
  const [eligibility, setEligibility] = useState(null);
  const [preview, setPreview] = useState(null);
  const [exceptionType, setExceptionType] = useState('partial_refund');
  const [reason, setReason] = useState('customer_changed_mind');
  const [selected, setSelected] = useState({});
  const [managerPin, setManagerPin] = useState('');
  const [commitIdentity, setCommitIdentity] = useState(null);
  const [approvalId, setApprovalId] = useState(null);

  async function loadEligibility() {
    const response = await command.execute('refund.eligibility', sale.id, {
      targetVersion: sale.version,
    });
    setEligibility(response.result);
    const initial = {};
    for (const line of response.result?.refund?.lines || []) {
      if (line.quantity.remaining > 0) initial[line.saleLineId] = line.quantity.remaining;
    }
    setSelected(initial);
  }

  async function createPreview() {
    const lines = Object.entries(selected)
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([saleLineId, quantity]) => ({
        saleLineId,
        quantity: Number(quantity),
        restockDecision: 'restock',
      }));
    const response = await command.execute('refund.preview', sale.id, {
      targetVersion: eligibility.sale.version,
      parameters: {
        exceptionType,
        reason,
        note: null,
        lines: exceptionType === 'partial_refund' ? lines : [],
        expectedSaleVersion: eligibility.sale.version,
      },
    });
    setPreview(response.result);
    setCommitIdentity({ commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });
    setApprovalId(null);
  }

  async function approve() {
    const response = await command.requestApproval('refund.approval', sale.id, {
      parameters: {
        previewId: preview.previewId,
        commandId: commitIdentity.commandId,
        previewFingerprint: preview.previewFingerprint,
        managerPin,
      },
    });
    setApprovalId(response.result.approvalId);
  }

  async function commit() {
    const response = await command.execute('refund.commit', sale.id, {
      ...commitIdentity,
      targetVersion: preview.saleVersion,
      approvalId,
      parameters: {
        previewId: preview.previewId,
        previewFingerprint: preview.previewFingerprint,
        approvalId,
        expectedSaleVersion: preview.saleVersion,
        offline: false,
      },
    });
    onComplete(response.result);
  }

  const requiresApproval = preview?.approvalRequired === true;
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Reembolso`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>
              <Trans>Reembolso de {sale.publicReference}</Trans>
            </h3>
            <p style={{ color: 'var(--ink-3)' }}>
              <Trans>La API calcula todos los importes.</Trans>
            </p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        {!eligibility ? (
          <button
            className="btn btn-primary"
            type="button"
            disabled={command.pending}
            onClick={loadEligibility}
          >
            {command.pending ? <Trans>Consultando…</Trans> : <Trans>Consultar elegibilidad</Trans>}
          </button>
        ) : !preview ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <label>
              <Trans>Tipo</Trans>
              <Select
                value={exceptionType}
                onChange={(event) => setExceptionType(event.target.value)}
              >
                {eligibility.allowedTypes.map((type) => (
                  <option value={type} key={type}>
                    {type.replaceAll('_', ' ')}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <Trans>Motivo</Trans>
              <Select value={reason} onChange={(event) => setReason(event.target.value)}>
                <option value="customer_changed_mind">{t`Cambio de decisión`}</option>
                <option value="incorrect_item">{t`Artículo incorrecto`}</option>
                <option value="product_defect">{t`Defecto del producto`}</option>
              </Select>
            </label>
            {exceptionType === 'partial_refund' &&
              eligibility.refund.lines.map((line) => (
                <label
                  key={line.saleLineId}
                  style={{ display: 'flex', gap: 10, alignItems: 'center' }}
                >
                  <input
                    type="checkbox"
                    checked={Number(selected[line.saleLineId] || 0) > 0}
                    onChange={(event) =>
                      setSelected((value) => ({
                        ...value,
                        [line.saleLineId]: event.target.checked ? line.quantity.remaining : 0,
                      }))
                    }
                  />
                  <span>{line.displayName}</span>
                  <input
                    aria-label={t`Cantidad para ${line.displayName}`}
                    type="number"
                    min="0"
                    max={line.quantity.remaining}
                    value={selected[line.saleLineId] || 0}
                    onChange={(event) =>
                      setSelected((value) => ({
                        ...value,
                        [line.saleLineId]: Number(event.target.value),
                      }))
                    }
                    style={{ width: 80 }}
                  />
                </label>
              ))}
            <button
              className="btn btn-primary"
              type="button"
              disabled={command.pending}
              onClick={createPreview}
            >
              {command.pending ? <Trans>Calculando…</Trans> : <Trans>Crear vista previa</Trans>}
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <strong>
              <Trans>
                Total:{' '}
                {formatOperationMoney(
                  preview.allocation.total.minorUnits,
                  preview.allocation.total.currency,
                )}
              </Trans>
            </strong>
            {requiresApproval && !approvalId && (
              <>
                <ManagerPinField value={managerPin} onChange={setManagerPin} />
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={command.pending || managerPin.length < 4}
                  onClick={approve}
                >
                  <Trans>Obtener aprobación</Trans>
                </button>
              </>
            )}
            <button
              className="btn btn-primary"
              type="button"
              disabled={command.pending || (requiresApproval && !approvalId)}
              onClick={commit}
            >
              {command.pending ? <Trans>Ejecutando…</Trans> : <Trans>Confirmar reembolso</Trans>}
            </button>
          </div>
        )}
        <CommandError command={command} />
      </section>
    </div>
  );
}

function InventoryDialog({ row, onClose, onComplete }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
  useEscapeToClose(onClose, command.pending);
  const [overview, setOverview] = useState(null);
  const [operation, setOperation] = useState('inventory.adjustment');
  const [quantity, setQuantity] = useState(1);
  const [direction, setDirection] = useState('increase');
  const [managerPin, setManagerPin] = useState('');
  const [planned, setPlanned] = useState(null);
  const [count, setCount] = useState(null);
  const [counted, setCounted] = useState({});
  const [submitted, setSubmitted] = useState(null);
  const [message, setMessage] = useState('');
  const [inventoryLocationId, inventoryItemId] = row.id.split(':');

  async function load() {
    const response = await command.execute('inventory.overview', inventoryItemId, {
      parameters: { inventoryLocationId, itemId: inventoryItemId, limit: 100 },
    });
    setOverview(response.result);
    if (response.result.activeCount?.count) {
      setCount(response.result.activeCount.count);
      if (
        ['submitted', 'variance_calculated', 'reconciliation_required', 'approved'].includes(
          response.result.activeCount.count.status,
        )
      ) {
        setSubmitted(response.result.activeCount);
      }
    }
    const initial = {};
    for (const balance of response.result.balances || []) {
      initial[balance.inventoryItemId] = balance.onHand;
    }
    setCounted(initial);
  }

  function commandBody(selectedOperation) {
    const item = overview.items.find((value) => value.id === inventoryItemId);
    const balance = overview.balances.find(
      (value) =>
        value.inventoryLocationId === inventoryLocationId &&
        value.inventoryItemId === inventoryItemId,
    );
    const common = {
      inventoryLocationId,
      expectedVersion: balance?.version ?? 1,
      policyFingerprint: overview.policy.fingerprint,
      approvalFingerprint: null,
      businessDate: new Date().toISOString().slice(0, 10),
    };
    const scaled = { value: Number(quantity), scale: item.scale, unit: item.baseUnit };
    if (selectedOperation === 'inventory.adjustment') {
      return { ...common, direction, quantity: scaled, reason: 'count_correction', note: null };
    }
    if (selectedOperation === 'inventory.waste') {
      return { ...common, quantity: scaled, reason: 'expired', note: null };
    }
    if (selectedOperation === 'inventory.damage') {
      return { ...common, quantity: scaled, reason: 'damaged', note: null, disposition: 'damaged' };
    }
    return {
      ...common,
      quantity: scaled,
      action: 'enter_quarantine',
      reason: 'inspection_required',
    };
  }

  async function previewMutation() {
    const identity = { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    const response = await command.execute('inventory.preview', inventoryItemId, {
      parameters: {
        mutationOperation: operation,
        mutationCommandId: identity.commandId,
        mutationIdempotencyKey: identity.idempotencyKey,
        command: commandBody(operation),
      },
    });
    setPlanned({ identity, command: commandBody(operation), approval: response.result });
  }

  async function executeMutation() {
    await command.executeApprovedCommand({
      approvalOperation: planned.approval.approvalRequired ? `${operation}.approval` : null,
      approvalParameters: {
        commandFingerprint: planned.approval.commandFingerprint,
        approvalPermission: planned.approval.approvalPermission,
      },
      commitOperation: operation,
      commitOptions: {
        ...planned.identity,
        parameters: {
          ...planned.command,
          approvalFingerprint: planned.approval.approvalRequired
            ? planned.approval.commandFingerprint
            : null,
        },
      },
      managerPin,
      targetAggregateId: inventoryItemId,
    });
    setMessage(t`Operación de inventario confirmada.`);
    onComplete();
  }

  async function createCount() {
    const location = overview.locations.find((value) => value.id === inventoryLocationId);
    const response = await command.execute('inventory.count.create', inventoryLocationId, {
      targetVersion: location.version,
      parameters: {
        inventoryLocationId,
        expectedVersion: location.version,
        policyFingerprint: overview.policy.fingerprint,
        approvalFingerprint: null,
        businessDate: new Date().toISOString().slice(0, 10),
        scope: 'selected_items',
        itemIds: [inventoryItemId],
      },
    });
    setCount(response.result.count);
  }

  async function submitCount() {
    const location = overview.locations.find((value) => value.id === inventoryLocationId);
    const lines = overview.items.map((item) => ({
      inventoryItemId: item.id,
      counted: { value: Number(counted[item.id] || 0), scale: item.scale, unit: item.baseUnit },
      note: null,
    }));
    const response = await command.execute('inventory.count.submit', count.id, {
      parameters: {
        inventoryLocationId,
        expectedVersion: location.version,
        policyFingerprint: overview.policy.fingerprint,
        approvalFingerprint: null,
        businessDate: new Date().toISOString().slice(0, 10),
        countId: count.id,
        attempt: count.attempt,
        snapshotLedgerSequence: count.snapshotLedgerSequence,
        lines,
      },
    });
    setSubmitted(response.result);
  }

  async function reconcileCount() {
    const location = overview.locations.find((value) => value.id === inventoryLocationId);
    const identity = { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    const reasons = Object.fromEntries(
      submitted.variances
        .filter((value) => value.absolute.value > 0)
        .map((value) => [value.inventoryItemId, 'physical_count']),
    );
    const body = {
      inventoryLocationId,
      expectedVersion: location.version,
      policyFingerprint: overview.policy.fingerprint,
      approvalFingerprint: null,
      businessDate: new Date().toISOString().slice(0, 10),
      countId: count.id,
      countAttempt: count.attempt,
      snapshotLedgerSequence: count.snapshotLedgerSequence,
      reasons,
    };
    const preview = await command.execute('inventory.preview', count.id, {
      parameters: {
        mutationOperation: 'inventory.count.reconcile',
        mutationCommandId: identity.commandId,
        mutationIdempotencyKey: identity.idempotencyKey,
        command: body,
      },
    });
    await command.executeApprovedCommand({
      approvalOperation: preview.result.approvalRequired ? 'inventory.count.approval' : null,
      approvalParameters: {
        commandFingerprint: preview.result.commandFingerprint,
        approvalPermission: preview.result.approvalPermission,
      },
      commitOperation: 'inventory.count.reconcile',
      commitOptions: {
        ...identity,
        parameters: {
          ...body,
          approvalFingerprint: preview.result.approvalRequired
            ? preview.result.commandFingerprint
            : null,
        },
      },
      managerPin,
      targetAggregateId: count.id,
    });
    setMessage(t`Conteo reconciliado.`);
    onComplete();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Inventario`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            <Trans>Inventario: {row.title}</Trans>
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        {!overview ? (
          <button
            className="btn btn-primary"
            type="button"
            disabled={command.pending}
            onClick={load}
          >
            <Trans>Cargar datos autorizados</Trans>
          </button>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <label>
              <Trans>Operación</Trans>
              <Select
                value={operation}
                onChange={(event) => {
                  setOperation(event.target.value);
                  setPlanned(null);
                }}
              >
                <option value="inventory.adjustment">{t`Ajuste`}</option>
                <option value="inventory.waste">{t`Merma`}</option>
                <option value="inventory.damage">{t`Daño`}</option>
                <option value="inventory.quarantine">{t`Cuarentena`}</option>
              </Select>
            </label>
            {operation === 'inventory.adjustment' && (
              <label>
                <Trans>Dirección</Trans>
                <Select value={direction} onChange={(event) => setDirection(event.target.value)}>
                  <option value="increase">{t`Aumentar`}</option>
                  <option value="decrease">{t`Reducir`}</option>
                </Select>
              </label>
            )}
            <label>
              <Trans>Cantidad</Trans>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            {!planned ? (
              <button className="btn btn-secondary" type="button" onClick={previewMutation}>
                <Trans>Revisar operación</Trans>
              </button>
            ) : (
              <>
                {planned.approval.approvalRequired && (
                  <ManagerPinField value={managerPin} onChange={setManagerPin} />
                )}
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={
                    command.pending || (planned.approval.approvalRequired && managerPin.length < 4)
                  }
                  onClick={executeMutation}
                >
                  <Trans>Confirmar operación</Trans>
                </button>
              </>
            )}
            <hr />
            {!count ? (
              <button className="btn btn-secondary" type="button" onClick={createCount}>
                <Trans>Crear conteo del artículo</Trans>
              </button>
            ) : !submitted ? (
              <>
                {overview.items.map((item) => (
                  <label key={item.id}>
                    {item.displayName}
                    <input
                      type="number"
                      min="0"
                      value={counted[item.id] || 0}
                      onChange={(event) =>
                        setCounted((value) => ({ ...value, [item.id]: Number(event.target.value) }))
                      }
                    />
                  </label>
                ))}
                <button className="btn btn-secondary" type="button" onClick={submitCount}>
                  <Trans>Enviar conteo</Trans>
                </button>
              </>
            ) : (
              <>
                {submitted.variances.some((value) => value.approvalRequired) && (
                  <ManagerPinField value={managerPin} onChange={setManagerPin} />
                )}
                <button className="btn btn-primary" type="button" onClick={reconcileCount}>
                  <Trans>Reconciliar conteo</Trans>
                </button>
              </>
            )}
          </div>
        )}
        {message && <p>{message}</p>}
        <CommandError command={command} />
      </section>
    </div>
  );
}

export function ReceiptReprintDialog({ row, onClose, onComplete }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
  useEscapeToClose(onClose, command.pending);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');

  async function reprint() {
    const response = await command.execute('hardware.printer.reprint', row.id, {
      parameters: { originalJobId: row.id, reason: 'customer_copy' },
    });
    const result = HARDWARE_TERMINAL.has(response.result.command.status)
      ? response.result
      : await waitForHardwareResult(command, response.result.command.commandId);
    setMessage(
      t`COPIA en estado ${result.command.status}. Referencia ${result.command.commandId}.`,
    );
    onComplete();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Reimpresión`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            <Trans>Reimprimir {row.publicReference}</Trans>
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{' '}
          <Trans>Confirmo una copia controlada.</Trans>
        </label>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!confirmed || command.pending}
          onClick={reprint}
        >
          <Trans>Crear COPIA</Trans>
        </button>
        {message && <p>{message}</p>}
        <CommandError command={command} />
      </section>
    </div>
  );
}

function LoyaltyDialog({ row, onClose, onComplete }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
  useEscapeToClose(onClose, command.pending);
  const [direction, setDirection] = useState('increase');
  const [points, setPoints] = useState(10);
  const [managerPin, setManagerPin] = useState('');
  const [planned, setPlanned] = useState(null);

  async function preview() {
    const identity = { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    const body = {
      direction,
      points: Number(points),
      reason: 'operational_correction',
      note: null,
      expectedVersion: row.version,
      approvalId: null,
      approvalFingerprint: null,
    };
    const response = await command.execute('loyalty.adjustment.preview', row.id, {
      targetVersion: row.version,
      parameters: {
        mutationCommandId: identity.commandId,
        mutationIdempotencyKey: identity.idempotencyKey,
        command: body,
      },
    });
    setPlanned({ identity, body, preview: response.result });
  }

  async function commit() {
    await command.executeApprovedCommand({
      approvalOperation: planned.preview.approvalPermission ? 'loyalty.adjustment.approval' : null,
      approvalParameters: {
        commandFingerprint: planned.preview.fingerprint,
        approvalPermission: planned.preview.approvalPermission,
      },
      commitOperation: 'loyalty.adjustment',
      commitOptions: {
        ...planned.identity,
        targetVersion: row.version,
        parameters: {
          ...planned.body,
          approvalFingerprint: planned.preview.approvalPermission
            ? planned.preview.fingerprint
            : null,
        },
      },
      managerPin,
      targetAggregateId: row.id,
    });
    onComplete();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Ajuste de puntos`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            <Trans>Ajuste de puntos</Trans>
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        <label>
          <Trans>Dirección</Trans>
          <Select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="increase">{t`Aumentar`}</option>
            <option value="decrease">{t`Reducir`}</option>
          </Select>
        </label>
        <label>
          <Trans>Puntos</Trans>
          <input
            type="number"
            min="1"
            step="1"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
          />
        </label>
        {!planned ? (
          <button className="btn btn-secondary" type="button" onClick={preview}>
            <Trans>Revisar ajuste</Trans>
          </button>
        ) : (
          <>
            <p>
              <Trans>Saldo proyectado: {planned.preview.projectedAvailable}</Trans>
            </p>
            {planned.preview.approvalPermission && (
              <ManagerPinField value={managerPin} onChange={setManagerPin} />
            )}
            <button
              className="btn btn-primary"
              type="button"
              disabled={
                command.pending || (planned.preview.approvalPermission && managerPin.length < 4)
              }
              onClick={commit}
            >
              <Trans>Confirmar ajuste</Trans>
            </button>
          </>
        )}
        <CommandError command={command} />
      </section>
    </div>
  );
}

function GiftCardIssueDialog({ row, onClose, onComplete }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
  useEscapeToClose(onClose, command.pending);
  const [amount, setAmount] = useState(10000);
  const [managerPin, setManagerPin] = useState('');
  const [planned, setPlanned] = useState(null);
  const [secret, setSecret] = useState(null);

  async function preview() {
    const identity = { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    const body = {
      currency: row.currency || 'MXN',
      initialValueMinorUnits: Number(amount),
      customerId: null,
      saleId: null,
      saleLineId: null,
      approvalId: null,
      approvalFingerprint: null,
    };
    const response = await command.execute('gift_card.promotional_issue.preview', row.id, {
      parameters: {
        mutationCommandId: identity.commandId,
        mutationIdempotencyKey: identity.idempotencyKey,
        command: body,
      },
    });
    setPlanned({ identity, body, preview: response.result });
  }

  async function issue() {
    const issued = await command.executeApprovedCommand({
      approvalOperation: planned.preview.approvalPermission
        ? 'gift_card.promotional_issue.approval'
        : null,
      approvalParameters: {
        commandFingerprint: planned.preview.fingerprint,
        approvalPermission: planned.preview.approvalPermission,
      },
      commitOperation: 'gift_card.promotional_issue',
      commitOptions: {
        ...planned.identity,
        parameters: {
          ...planned.body,
          approvalFingerprint: planned.preview.approvalPermission
            ? planned.preview.fingerprint
            : null,
        },
      },
      managerPin,
      targetAggregateId: row.id,
    });
    const revealed = await command.execute('gift_card.reveal', issued.result.card.id, {
      parameters: { deliveryToken: issued.result.deliveryToken },
    });
    setSecret(revealed.result);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Emitir tarjeta de regalo`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            <Trans>Emisión promocional</Trans>
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        {secret ? (
          <>
            <p>
              <Trans>Código de entrega única:</Trans>
            </p>
            <code>{secret.code}</code>
            <button className="btn btn-primary" type="button" onClick={onComplete}>
              <Trans>Terminar</Trans>
            </button>
          </>
        ) : (
          <>
            <label>
              <Trans>Importe en centavos</Trans>
              <input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            {!planned ? (
              <button className="btn btn-secondary" type="button" onClick={preview}>
                <Trans>Revisar emisión</Trans>
              </button>
            ) : (
              <>
                <p>
                  <Trans>Límite: {planned.preview.maximumValueMinorUnits}</Trans>
                </p>
                {planned.preview.approvalPermission && (
                  <ManagerPinField value={managerPin} onChange={setManagerPin} />
                )}
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={
                    command.pending || (planned.preview.approvalPermission && managerPin.length < 4)
                  }
                  onClick={issue}
                >
                  <Trans>Emitir y revelar</Trans>
                </button>
              </>
            )}
          </>
        )}
        <CommandError command={command} />
      </section>
    </div>
  );
}

function CatalogDialog({ row, onClose, onComplete }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
  useEscapeToClose(onClose, command.pending);
  const [name, setName] = useState(row?.title || '');
  const [price, setPrice] = useState(row?.amountMinorUnits ?? 0);
  const [sku, setSku] = useState(
    row?.publicReference === row?.id ? '' : row?.publicReference || '',
  );
  const [barcode, setBarcode] = useState('');
  const [requiresPreparation, setRequiresPreparation] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [inventoryItemId, setInventoryItemId] = useState('');
  const [loaded, setLoaded] = useState(!row);
  const [productId] = useState(() => row?.id || crypto.randomUUID());

  async function loadDetail() {
    const response = await command.execute('catalog.detail', productId, {
      targetVersion: row.version,
    });
    const detail = response.result;
    setName(detail.name);
    setPrice(detail.priceMinorUnits);
    setSku(detail.sku || '');
    setBarcode(detail.barcode || '');
    setRequiresPreparation(detail.requiresPreparation === true);
    setCategoryId(detail.categoryId || '');
    setInventoryItemId(detail.inventoryItemId || '');
    setLoaded(true);
  }

  async function save() {
    const operation = row ? 'catalog.update' : 'catalog.create';
    const parameters = {
      name,
      priceMinorUnits: Number(price),
      sku: sku || null,
      barcode: barcode || null,
      requiresPreparation,
      categoryId: categoryId || null,
      inventoryItemId: inventoryItemId || null,
      taxRateBasisPoints: 0,
    };
    await command.execute(operation, productId, {
      targetVersion: row?.version ?? null,
      parameters,
    });
    onComplete();
  }

  async function archive() {
    await command.execute('catalog.archive', productId, {
      targetVersion: row.version,
      parameters: {},
    });
    onComplete();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="card modal-card" role="dialog" aria-modal="true" aria-label={t`Producto`}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            {row ? <Trans>Editar producto</Trans> : <Trans>Crear producto</Trans>}
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        {!loaded ? (
          <button
            className="btn btn-primary"
            type="button"
            disabled={command.pending}
            onClick={loadDetail}
          >
            <Trans>Cargar datos actuales</Trans>
          </button>
        ) : (
          <>
            <label>
              <Trans>Nombre</Trans>
              <input
                value={name}
                maxLength={240}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <Trans>Precio en centavos</Trans>
              <input
                type="number"
                min="0"
                step="1"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            <label>
              SKU
              <input value={sku} maxLength={120} onChange={(event) => setSku(event.target.value)} />
            </label>
            <label>
              <Trans>Código de barras</Trans>
              <input
                value={barcode}
                maxLength={160}
                onChange={(event) => setBarcode(event.target.value)}
              />
            </label>
            <label>
              <Trans>Categoría</Trans>
              <input
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                placeholder={t`UUID opcional`}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={requiresPreparation}
                onChange={(event) => setRequiresPreparation(event.target.checked)}
              />{' '}
              <Trans>Requiere preparación</Trans>
            </label>
            <label>
              <Trans>Artículo de inventario</Trans>
              <input
                value={inventoryItemId}
                onChange={(event) => setInventoryItemId(event.target.value)}
                placeholder={t`UUID opcional`}
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                type="button"
                disabled={command.pending || !name.trim()}
                onClick={save}
              >
                <Trans>Guardar</Trans>
              </button>
              {row && row.status !== 'archived' && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={command.pending}
                  onClick={archive}
                >
                  <Trans>Archivar</Trans>
                </button>
              )}
            </div>
          </>
        )}
        <CommandError command={command} />
      </section>
    </div>
  );
}

function RegisterDialog({ row, onClose, onComplete }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
  useEscapeToClose(onClose, command.pending);
  const [displayName, setDisplayName] = useState(row.title);
  const [assignmentPolicy, setAssignmentPolicy] = useState('device_required');
  const [assignedDeviceId, setAssignedDeviceId] = useState('');
  const [enabled, setEnabled] = useState(row.status !== 'suspended');

  async function save() {
    await command.execute('register.configure', row.id, {
      targetVersion: row.version,
      parameters: {
        displayName,
        assignmentPolicy,
        assignedDeviceId: assignedDeviceId || null,
        enabled,
      },
    });
    onComplete();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="card modal-card" role="dialog" aria-modal="true" aria-label={t`Registro`}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            <Trans>Configurar registro</Trans>
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        <label>
          <Trans>Nombre</Trans>
          <input
            value={displayName}
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          <Trans>Política</Trans>
          <Select
            value={assignmentPolicy}
            onChange={(event) => setAssignmentPolicy(event.target.value)}
          >
            <option value="device_required">{t`Dispositivo requerido`}</option>
            <option value="operator_selects">{t`Selección del operador`}</option>
          </Select>
        </label>
        <label>
          <Trans>Dispositivo POS asignado</Trans>
          <input
            value={assignedDeviceId}
            placeholder={t`UUID opcional`}
            onChange={(event) => setAssignedDeviceId(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />{' '}
          <Trans>Habilitado</Trans>
        </label>
        <button
          className="btn btn-primary"
          type="button"
          disabled={command.pending || !displayName.trim()}
          onClick={save}
        >
          <Trans>Guardar</Trans>
        </button>
        <CommandError command={command} />
      </section>
    </div>
  );
}

function KitchenRouteDialog({ onClose, onComplete }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
  useEscapeToClose(onClose, command.pending);
  const [stationId, setStationId] = useState('');
  const [routeType, setRouteType] = useState('default');
  const [routeTargetId, setRouteTargetId] = useState('');
  const [priority, setPriority] = useState(100);

  async function save() {
    await command.execute('kitchen.route.update', crypto.randomUUID(), {
      parameters: {
        create: true,
        stationId,
        routePriority: Number(priority),
        productId: routeType === 'product' ? routeTargetId : null,
        categoryId: routeType === 'category' ? routeTargetId : null,
      },
    });
    onComplete();
  }

  const targetRequired = routeType !== 'default';
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Ruta de cocina`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            <Trans>Configurar ruta de cocina</Trans>
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        <label>
          <Trans>Estación</Trans>
          <input
            value={stationId}
            onChange={(event) => setStationId(event.target.value)}
            placeholder={t`UUID de estación`}
          />
        </label>
        <label>
          <Trans>Tipo</Trans>
          <Select value={routeType} onChange={(event) => setRouteType(event.target.value)}>
            <option value="default">{t`Predeterminada`}</option>
            <option value="product">{t`Producto`}</option>
            <option value="category">{t`Categoría`}</option>
          </Select>
        </label>
        {targetRequired && (
          <label>
            <Trans>Objetivo</Trans>
            <input
              value={routeTargetId}
              onChange={(event) => setRouteTargetId(event.target.value)}
              placeholder={t`UUID del objetivo`}
            />
          </label>
        )}
        <label>
          <Trans>Prioridad</Trans>
          <input
            type="number"
            min="0"
            max="10000"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
        </label>
        <button
          className="btn btn-primary"
          type="button"
          disabled={command.pending || !stationId || (targetRequired && !routeTargetId)}
          onClick={save}
        >
          <Trans>Guardar ruta</Trans>
        </button>
        <CommandError command={command} />
      </section>
    </div>
  );
}

function RecoveryDialog({ row, onClose }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
  useEscapeToClose(onClose, command.pending);
  const [result, setResult] = useState(null);
  async function query() {
    const response = await command.recover(row.id);
    setResult(response.result);
  }
  async function executeDomainRecovery() {
    const type = String(result.commandType || '');
    if (type.includes('inventory')) {
      setResult((await command.execute('inventory.recovery', result.commandId)).result);
      return;
    }
    if (type.includes('gift') || type.includes('customer_value') || type.includes('points')) {
      setResult((await command.execute('gift_card.recovery', result.commandId)).result);
      return;
    }
    if (type.includes('exception') || type.includes('refund')) {
      setResult(
        (
          await command.execute('refund.recovery', result.commandId, {
            parameters: {
              commandId: result.commandId,
              idempotencyKey: result.idempotencyKey,
            },
          })
        ).result,
      );
    }
  }
  const canRecover =
    result &&
    ['inventory', 'gift', 'customer_value', 'points', 'exception', 'refund'].some((value) =>
      String(result.commandType || '').includes(value),
    );
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Recuperación`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            <Trans>Comando original</Trans>
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={command.pending}
          onClick={query}
        >
          <Trans>Consultar el registro</Trans>
        </button>
        {canRecover && (
          <button
            className="btn btn-secondary"
            type="button"
            disabled={command.pending}
            onClick={executeDomainRecovery}
          >
            <Trans>Ejecutar recuperación del dominio</Trans>
          </button>
        )}
        {result && (
          <dl>
            <dt>
              <Trans>Tipo</Trans>
            </dt>
            <dd>{result.commandType}</dd>
            <dt>
              <Trans>Estado</Trans>
            </dt>
            <dd>{result.status}</dd>
            <dt>
              <Trans>Correlación</Trans>
            </dt>
            <dd>
              <code>{result.correlationId}</code>
            </dd>
            <dt>
              <Trans>Acción</Trans>
            </dt>
            <dd>
              {result.retryable ? (
                <Trans>Usa la acción del dominio.</Trans>
              ) : (
                <Trans>Consulta antes de repetir.</Trans>
              )}
            </dd>
          </dl>
        )}
        <CommandError command={command} />
      </section>
    </div>
  );
}

/**
 * DomainWorkspace — one operational domain rendered as a table with its authorized
 * actions and command dialogs. Self-contained: it fetches, paginates, and mounts
 * every dialog. Both the bridge `operations` screen and the new hubs render it.
 * Give it a `key={domain}` so a domain switch resets the cursor and dialog state.
 */
// Per-domain views (the seam): the generic table is the fallback for every domain;
// a domain in DOMAIN_VIEWS replaces the table with a purpose-built view.
//
// The money hub is written as a CALM EDITORIAL BRIEFING, not a data cockpit: each tab
// opens with one honest sentence (the lede), then a few quiet figures, then the items as
// narrative rows — jobs, not tables ("think outside the database"). Refunds are OBSERVED
// here, never issued: a cash refund happens at the register, with the customer present
// (Toast Web cannot open a drawer either), so the owner reviews and governs, not executes.

const CASH_SHIFT_CLOSED = 'closed';
const CASH_SHIFT_OPEN = new Set(['open', 'opening']);
// Statuses that demand the owner's attention: an in-progress or blocked close.
const CASH_SHIFT_ATTENTION = new Set(['reconciliation_required', 'counting', 'closing']);

/** counted − expected, in centavos. Null until a count exists. */
function shiftVariance(facts) {
  const expected = facts?.expectedCashMinorUnits ?? null;
  const counted = facts?.countedCashMinorUnits ?? null;
  if (expected == null || counted == null) return null;
  return counted - expected;
}

/** Text colour + label key for a variance. Null when there is nothing to show. */
function varianceTone(variance) {
  if (variance == null) return null;
  if (variance === 0) return { color: 'var(--success)', key: 'ok' };
  if (variance > 0) return { color: 'var(--warning)', key: 'over' };
  return { color: 'var(--danger)', key: 'short' };
}

/** Short elapsed time ("2h 15m", "3d 4h", "45m"). Symbols only, so no translation. */
function formatShiftDuration(fromIso, toIso) {
  if (!fromIso) return null;
  const start = new Date(fromIso).getTime();
  const end = toIso ? new Date(toIso).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const minutes = Math.floor((end - start) / 60000);
  if (minutes < 1) return '<1m';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return [`${days}d`, `${hours}h`].join(' ');
  if (hours > 0) return [`${hours}h`, `${mins}m`].join(' ');
  return `${mins}m`;
}

/** The signed word for a variance: balanced / over / short. */
function VarianceLabel({ toneKey }) {
  if (toneKey === 'ok') return <Trans>Cuadrado</Trans>;
  if (toneKey === 'over') return <Trans>Sobrante</Trans>;
  return <Trans>Faltante</Trans>;
}

/** The owner-facing word for an exception type. */
function ExceptionTypeLabel({ type }) {
  if (type === 'void') return <Trans>Anulación</Trans>;
  if (type === 'partial_refund') return <Trans>Reembolso parcial</Trans>;
  return <Trans>Reembolso total</Trans>;
}

/** The owner-facing word for a print-job status. */
export function ReceiptStatusLabel({ status }) {
  if (status === 'printed') return <Trans>Impreso</Trans>;
  if (status === 'failed') return <Trans>Falló</Trans>;
  if (status === 'not_printed') return <Trans>Sin imprimir</Trans>;
  if (status === 'queued') return <Trans>En cola</Trans>;
  if (status === 'printing') return <Trans>Imprimiendo</Trans>;
  return <>{String(status || '').replaceAll('_', ' ')}</>;
}

/** The owner-facing word for a physical-register status. */
export function RegisterStatusLabel({ status }) {
  if (status === 'available') return <Trans>Disponible</Trans>;
  if (status === 'in_use') return <Trans>En uso</Trans>;
  if (status === 'reconciliation_required') return <Trans>Conciliación</Trans>;
  if (status === 'blocked') return <Trans>Bloqueado</Trans>;
  if (status === 'archived') return <Trans>Archivado</Trans>;
  return <>{String(status || '').replaceAll('_', ' ')}</>;
}

// ── Editorial primitives — a calm briefing, not tiles ────────────────────────
const TONE_COLOR = { ok: 'var(--success)', warn: 'var(--warning)', danger: 'var(--danger)' };

/** A quiet state dot. */
function StateDot({ tone }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        flexShrink: 0,
        background: TONE_COLOR[tone] || 'var(--ink-3)',
      }}
    />
  );
}

/** The lede: the honest one-sentence read that opens a tab. */
function Lede({ tone, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
      <span style={{ position: 'relative', top: -3, flexShrink: 0 }}>
        <StateDot tone={tone} />
      </span>
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontWeight: 400,
          fontSize: 23,
          letterSpacing: '-0.012em',
          color: 'var(--ink-1)',
          lineHeight: 1.35,
        }}
      >
        {children}
      </p>
    </div>
  );
}

/** A quiet figure: a small label over a display-face value. No box. */
function FigureStat({ label, value, tone }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div className="eyebrow">{label}</div>
      <div
        className="figures"
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 400,
          fontSize: 34,
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
          marginTop: 6,
          color: TONE_COLOR[tone] || 'var(--ink-1)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** A row of figures separated by whitespace, a hairline beneath. */
function FigureRow({ children }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '18px 52px',
        paddingBottom: 22,
        borderBottom: '1px solid var(--line)',
      }}
    >
      {children}
    </div>
  );
}

/** A narrative line item: a state dot, a subject sentence, and an optional right slot. */
function NarrativeRow({ tone, subject, meta, right, onClick }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      onClick={onClick}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={clickable ? 'narrative-row-click' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: clickable ? '15px 10px' : '15px 2px',
        margin: clickable ? '0 -10px' : undefined,
        borderRadius: clickable ? 10 : undefined,
        borderBottom: '1px solid var(--line-soft)',
        cursor: clickable ? 'pointer' : undefined,
      }}
    >
      {tone ? <StateDot tone={tone} /> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, color: 'var(--ink-1)' }}>{subject}</div>
        {meta ? (
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 3 }}>{meta}</div>
        ) : null}
      </div>
      {right ? (
        <div
          style={{
            textAlign: 'right',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            justifyContent: 'flex-end',
          }}
        >
          {right}
        </div>
      ) : null}
    </div>
  );
}

/** A section in the editorial voice: a broadsheet header, then rows. */
function BriefSection({ title, children }) {
  return (
    <section>
      <div className="ed-head">
        <div className="titles">
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

/** The display-face amount on the right of a narrative row. */
function RowAmount({ children, tone }) {
  return (
    <span
      className="figures"
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 19,
        letterSpacing: '-0.01em',
        color: TONE_COLOR[tone] || 'var(--ink-1)',
      }}
    >
      {children}
    </span>
  );
}

// ── cash_shifts — "is my money safe, and who did what" ───────────────────────
function CashShiftsView({ items }) {
  const shifts = items.filter((it) => it.facts);
  if (!shifts.length) return null;
  const currency = shifts.find((s) => s.currency)?.currency ?? null;
  const active = shifts.filter((s) => s.status !== CASH_SHIFT_CLOSED);
  const closed = shifts.filter((s) => s.status === CASH_SHIFT_CLOSED);
  const openCount = shifts.filter((s) => CASH_SHIFT_OPEN.has(s.status)).length;
  const expectedInDrawers = active.reduce(
    (sum, s) => sum + (s.facts?.expectedCashMinorUnits ?? 0),
    0,
  );
  const blocked = active.filter((s) => CASH_SHIFT_ATTENTION.has(s.status)).length;
  const reviewCount = shifts.filter(
    (s) =>
      CASH_SHIFT_ATTENTION.has(s.status) ||
      (s.status === CASH_SHIFT_CLOSED && (shiftVariance(s.facts) ?? 0) !== 0),
  ).length;
  const netClosedVariance = closed.reduce((sum, s) => sum + (shiftVariance(s.facts) ?? 0), 0);
  const netToneKey = netClosedVariance < 0 ? 'danger' : netClosedVariance > 0 ? 'warn' : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <Lede tone={reviewCount ? (blocked ? 'danger' : 'warn') : 'ok'}>
        {reviewCount > 0 ? (
          <Plural
            value={reviewCount}
            one="# turno necesita tu revisión."
            other="# turnos necesitan tu revisión."
          />
        ) : (
          <Trans>Todo cuadrado. Nada requiere tu atención.</Trans>
        )}
      </Lede>

      <FigureRow>
        <FigureStat
          label={<Trans>En caja ahora</Trans>}
          value={formatOperationMoney(expectedInDrawers, currency)}
        />
        <FigureStat
          label={<Trans>Diferencia del día</Trans>}
          value={closed.length ? formatOperationMoney(netClosedVariance, currency) : '—'}
          tone={netToneKey}
        />
        <FigureStat label={<Trans>Turnos abiertos</Trans>} value={openCount} />
      </FigureRow>

      <BriefSection title={<Trans>Turnos abiertos</Trans>}>
        {active.length ? (
          active.map((s) => {
            const f = s.facts;
            const dur = formatShiftDuration(f.openedAt, null);
            return (
              <NarrativeRow
                key={s.id}
                tone={
                  s.status === 'reconciliation_required'
                    ? 'danger'
                    : CASH_SHIFT_OPEN.has(s.status)
                      ? 'ok'
                      : 'warn'
                }
                subject={
                  <>
                    <strong style={{ fontWeight: 600 }}>{f.operator || '—'}</strong>
                    <span style={{ color: 'var(--ink-3)' }}> · {f.register}</span>
                  </>
                }
                meta={
                  dur ? (
                    <Trans>
                      Abrió {formatOperationMoney(f.openingFloatMinorUnits, s.currency)} · lleva{' '}
                      {dur}
                    </Trans>
                  ) : (
                    <Trans>
                      Abrió {formatOperationMoney(f.openingFloatMinorUnits, s.currency)}
                    </Trans>
                  )
                }
                right={
                  <RowAmount>
                    {formatOperationMoney(f.expectedCashMinorUnits, s.currency)}
                  </RowAmount>
                }
              />
            );
          })
        ) : (
          <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>
            <Trans>No hay turnos abiertos ahora.</Trans>
          </p>
        )}
      </BriefSection>

      {closed.length > 0 && (
        <BriefSection title={<Trans>Historial de turnos</Trans>}>
          {closed.map((s) => {
            const f = s.facts;
            const variance = shiftVariance(f);
            const t = varianceTone(variance);
            const toneKey =
              variance == null
                ? undefined
                : variance === 0
                  ? 'ok'
                  : variance > 0
                    ? 'warn'
                    : 'danger';
            return (
              <NarrativeRow
                key={s.id}
                tone={toneKey}
                subject={
                  <>
                    <strong style={{ fontWeight: 600 }}>{f.operator || '—'}</strong>
                    <span style={{ color: 'var(--ink-3)' }}> · {f.register}</span>
                  </>
                }
                meta={
                  <Trans>
                    Esperaba {formatOperationMoney(f.expectedCashMinorUnits, s.currency)}, contó{' '}
                    {formatOperationMoney(f.countedCashMinorUnits, s.currency)} · cerró{' '}
                    {formatOperationDate(s.occurredAt)}
                  </Trans>
                }
                right={
                  variance == null ? null : (
                    <RowAmount tone={toneKey}>
                      <VarianceLabel toneKey={t.key} />{' '}
                      {formatOperationMoney(Math.abs(variance), s.currency)}
                    </RowAmount>
                  )
                }
              />
            );
          })}
        </BriefSection>
      )}
    </div>
  );
}

/** The owner-facing word for a payment method. */
function PaymentMethodLabel({ method }) {
  if (method === 'cash') return <Trans>Efectivo</Trans>;
  if (method === 'card') return <Trans>Tarjeta</Trans>;
  return <>{String(method || '').replaceAll('_', ' ')}</>;
}

/** A totals line in the sale detail (subtotal / discount / tax / total). */
function SaleTotalRow({ label, value, strong, tone }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: strong ? 15 : 13,
        fontWeight: strong ? 600 : 400,
        color: tone === 'warn' ? 'var(--warning)' : strong ? 'var(--ink-1)' : 'var(--ink-2)',
      }}
    >
      <span>{label}</span>
      <span className="figures">{value}</span>
    </div>
  );
}

// A sale's detail = its receipt, rendered in a slide-over. Read-only: the receipt IS
// the sale (the transaction rendered as a document), so this is both the "detail" and
// the "receipt" in one surface — no separate ticket button (see the placement research).
// The snapshot is fetched on open from the immutable receipt_snapshot.
function SaleReceiptSheet({ sale, onClose }) {
  const { t } = useLingui();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  useEscapeToClose(onClose, state.loading);
  // Keyed by sale.id at the call site, so each open mounts fresh at loading:true —
  // no synchronous setState in the effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    let live = true;
    loadSaleReceipt(sale.id)
      .then((data) => live && setState({ loading: false, error: null, data }))
      .catch(
        (err) =>
          live && setState({ loading: false, error: err.message || String(err), data: null }),
      );
    return () => {
      live = false;
    };
  }, [sale.id]);

  const snap = state.data?.snapshot || null;
  const money = (m) => (m ? formatOperationMoney(m.minorUnits, m.currency) : '—');
  const lines = snap?.lines || [];
  const payment = (snap?.payments && snap.payments[0]) || snap?.payment || null;
  const discountTotal = lines.reduce((sum, l) => sum + (l.discount?.minorUnits || 0), 0);

  return (
    <>
      <div className="sheet-backdrop" role="presentation" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={t`Venta`}>
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{sale.facts?.operator || '—'}</div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--ink-3)',
                marginTop: 2,
              }}
            >
              {sale.publicReference}
            </div>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        <div className="sheet-body">
          {state.loading ? (
            <p style={{ color: 'var(--ink-3)' }}>
              <Trans>Cargando la venta…</Trans>
            </p>
          ) : state.error ? (
            <p style={{ color: 'var(--danger)' }}>{state.error}</p>
          ) : !snap ? (
            <p style={{ color: 'var(--ink-3)' }}>
              <Trans>No se encontró el recibo de esta venta.</Trans>
            </p>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {formatOperationDate(sale.occurredAt)}
              </div>
              <div>
                {lines.map((line, i) => (
                  <div
                    key={line.lineRef || i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '10px 0',
                      borderBottom: '1px solid var(--line-soft)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: 'var(--ink-1)' }}>
                        {line.quantity}× {line.description}
                        {line.variantName ? ` · ${line.variantName}` : ''}
                      </div>
                      {(line.modifiers || []).length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                          {line.modifiers
                            .map((m) => m.description || m.name)
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                      {line.discount?.minorUnits > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 2 }}>
                          <Trans>Descuento {money(line.discount)}</Trans>
                        </div>
                      )}
                    </div>
                    <div
                      className="figures"
                      style={{ whiteSpace: 'nowrap', color: 'var(--ink-1)' }}
                    >
                      {money(line.lineTotal)}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                <SaleTotalRow label={<Trans>Subtotal</Trans>} value={money(snap.subtotal)} />
                {discountTotal > 0 && (
                  <SaleTotalRow
                    label={<Trans>Descuento</Trans>}
                    value={money({ minorUnits: discountTotal, currency: snap.currency })}
                    tone="warn"
                  />
                )}
                {snap.taxTotal?.minorUnits > 0 && (
                  <SaleTotalRow label={<Trans>Impuestos</Trans>} value={money(snap.taxTotal)} />
                )}
                <SaleTotalRow label={<Trans>Total</Trans>} value={money(snap.grandTotal)} strong />
              </div>
              {payment && (
                <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <div className="eyebrow">
                    <Trans>Pago</Trans>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: 6,
                      fontSize: 14,
                    }}
                  >
                    <span>
                      <PaymentMethodLabel method={payment.method} />
                    </span>
                    <span className="figures">{money(payment.amount)}</span>
                  </div>
                  {payment.received && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: 4,
                        fontSize: 13,
                        color: 'var(--ink-3)',
                      }}
                    >
                      <span>
                        <Trans>Recibido</Trans>
                      </span>
                      <span className="figures">{money(payment.received)}</span>
                    </div>
                  )}
                  {payment.change && payment.change.minorUnits > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: 4,
                        fontSize: 13,
                        color: 'var(--ink-3)',
                      }}
                    >
                      <span>
                        <Trans>Cambio</Trans>
                      </span>
                      <span className="figures">{money(payment.change)}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="sheet-foot">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            <Trans>Cerrar</Trans>
          </button>
        </div>
      </section>
    </>
  );
}

// ── sales — the day's take, and any margin given away ────────────────────────
function SalesView({ items, ctx }) {
  const currency = items.find((i) => i.currency)?.currency ?? null;
  const total = items.reduce((sum, i) => sum + (i.amountMinorUnits ?? 0), 0);
  const discounted = items.filter((i) => (i.facts?.discountMinorUnits ?? 0) > 0).length;
  const average = items.length ? Math.round(total / items.length) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <Lede tone="ok">
        {items.length > 0 ? (
          <Trans>
            Ventas: {items.length} · {formatOperationMoney(total, currency)} vendido.
          </Trans>
        ) : (
          <Trans>Aún no hay ventas en esta vista.</Trans>
        )}
      </Lede>

      <FigureRow>
        <FigureStat label={<Trans>Vendido</Trans>} value={formatOperationMoney(total, currency)} />
        <FigureStat
          label={<Trans>Ticket promedio</Trans>}
          value={formatOperationMoney(average, currency)}
        />
        <FigureStat
          label={<Trans>Con descuento</Trans>}
          value={discounted}
          tone={discounted ? 'warn' : undefined}
        />
      </FigureRow>

      {items.length > 0 && (
        <BriefSection title={<Trans>Ventas</Trans>}>
          {items.map((item) => {
            const discount = item.facts?.discountMinorUnits ?? 0;
            return (
              <NarrativeRow
                key={item.id}
                subject={<strong style={{ fontWeight: 600 }}>{item.facts?.operator || '—'}</strong>}
                meta={
                  <>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {item.publicReference}
                    </span>
                    {' · '}
                    {formatOperationDate(item.occurredAt)}
                    {discount > 0 ? (
                      <span style={{ color: 'var(--warning)' }}>
                        {' · '}
                        <Trans>desc. {formatOperationMoney(discount, item.currency)}</Trans>
                      </span>
                    ) : null}
                  </>
                }
                onClick={() => ctx.onSale(item)}
                right={
                  <>
                    <RowAmount>
                      {formatOperationMoney(item.amountMinorUnits, item.currency)}
                    </RowAmount>
                    <span
                      aria-hidden="true"
                      style={{ color: 'var(--ink-4)', fontSize: 18, lineHeight: 1 }}
                    >
                      ›
                    </span>
                  </>
                }
              />
            );
          })}
        </BriefSection>
      )}
    </div>
  );
}

// ── receipts — which receipts printed, and which failed ──────────────────────
function ReceiptsView({ items, ctx }) {
  const printed = items.filter((i) => i.status === 'printed').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const queued = items.filter((i) => i.status === 'queued' || i.status === 'printing').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <Lede tone={failed ? 'danger' : queued ? 'warn' : 'ok'}>
        {failed > 0 ? (
          <Trans>
            Recibos: {items.length} · {failed} no se imprimieron.
          </Trans>
        ) : queued > 0 ? (
          <Trans>
            Recibos: {items.length} · {queued} en cola.
          </Trans>
        ) : printed === items.length && items.length > 0 ? (
          <Trans>Recibos: {items.length} · todos impresos.</Trans>
        ) : (
          <Trans>Recibos: {items.length}.</Trans>
        )}
      </Lede>

      <FigureRow>
        <FigureStat
          label={<Trans>Impresos</Trans>}
          value={printed}
          tone={printed ? 'ok' : undefined}
        />
        <FigureStat
          label={<Trans>En cola</Trans>}
          value={queued}
          tone={queued ? 'warn' : undefined}
        />
        <FigureStat
          label={<Trans>Fallidos</Trans>}
          value={failed}
          tone={failed ? 'danger' : undefined}
        />
      </FigureRow>

      <BriefSection title={<Trans>Recibos</Trans>}>
        {items.map((item) => {
          const st = item.status;
          const dotTone =
            st === 'printed'
              ? 'ok'
              : st === 'failed'
                ? 'danger'
                : st === 'not_printed'
                  ? undefined
                  : 'warn';
          return (
            <NarrativeRow
              key={item.id}
              tone={dotTone}
              subject={
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  {item.publicReference}
                </span>
              }
              meta={
                <>
                  <ReceiptStatusLabel status={st} />
                  {' · '}
                  <Trans>emitido {formatOperationDate(item.occurredAt)}</Trans>
                </>
              }
              right={
                <>
                  <RowAmount>
                    {formatOperationMoney(item.amountMinorUnits, item.currency)}
                  </RowAmount>
                  {st !== 'not_printed' && (
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={() => ctx.onReprint(item)}
                    >
                      <Trans>Reimprimir</Trans>
                    </button>
                  )}
                </>
              }
            />
          );
        })}
      </BriefSection>
    </div>
  );
}

// ── refunds_voids — OBSERVE only: money back is a register act, with the customer.
function RefundsView({ items }) {
  const currency = items.find((i) => i.currency)?.currency ?? null;
  const total = items.reduce((sum, i) => sum + (i.amountMinorUnits ?? 0), 0);
  const voids = items.filter((i) => i.facts?.exceptionType === 'void').length;
  const approved = items.filter((i) => i.facts?.approved).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <Lede tone={total ? 'warn' : 'ok'}>
        {items.length > 0 ? (
          <Trans>
            Excepciones: {items.length} · {formatOperationMoney(total, currency)} devuelto.
          </Trans>
        ) : (
          <Trans>Sin reembolsos ni anulaciones en esta vista.</Trans>
        )}
      </Lede>

      <FigureRow>
        <FigureStat
          label={<Trans>Devuelto</Trans>}
          value={formatOperationMoney(total, currency)}
          tone={total ? 'danger' : undefined}
        />
        <FigureStat label={<Trans>Anulaciones</Trans>} value={voids} />
        <FigureStat label={<Trans>Con aprobación</Trans>} value={approved} />
      </FigureRow>

      {items.length > 0 && (
        <BriefSection title={<Trans>Movimientos</Trans>}>
          {items.map((item) => {
            const f = item.facts || {};
            const reason = f.reasonCode ? String(f.reasonCode).replaceAll('_', ' ') : null;
            return (
              <NarrativeRow
                key={item.id}
                tone="danger"
                subject={
                  <>
                    <strong style={{ fontWeight: 600 }}>
                      <ExceptionTypeLabel type={f.exceptionType} />
                    </strong>
                    {f.originalReceipt ? (
                      <span
                        style={{
                          color: 'var(--ink-3)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                        }}
                      >
                        {' · '}
                        {f.originalReceipt}
                      </span>
                    ) : null}
                  </>
                }
                meta={
                  <>
                    {f.operator || '—'}
                    {reason ? ` · ${reason}` : null}
                    {f.approved ? (
                      <>
                        {' · '}
                        <Trans>aprobado por gerente</Trans>
                      </>
                    ) : null}
                  </>
                }
                right={
                  <RowAmount tone="danger">
                    {formatOperationMoney(item.amountMinorUnits, item.currency)}
                  </RowAmount>
                }
              />
            );
          })}
        </BriefSection>
      )}

      <p
        style={{
          color: 'var(--ink-3)',
          fontSize: 13,
          paddingTop: 16,
          borderTop: '1px solid var(--line-soft)',
          margin: 0,
          maxWidth: '64ch',
        }}
      >
        <Trans>
          Los reembolsos y las anulaciones se hacen en la caja, con el cliente presente. Aquí los
          revisas: quién, por qué y quién autorizó.
        </Trans>
      </p>
    </div>
  );
}

// ── registers — the drawers, and the no-sale opens that signal shrinkage ──────
function RegistersView({ items }) {
  const inUse = items.filter((i) => i.status === 'in_use').length;
  const movements = items.reduce((sum, i) => sum + (i.facts?.movements ?? 0), 0);
  const noSale = items.reduce((sum, i) => sum + (i.facts?.noSaleOpens ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <Lede tone={noSale ? 'danger' : 'ok'}>
        {noSale > 0 ? (
          <Trans>{noSale} aperturas de cajón sin venta — conviene revisarlas.</Trans>
        ) : (
          <Trans>Cajas en orden. Ninguna apertura de cajón sin venta.</Trans>
        )}
      </Lede>

      <FigureRow>
        <FigureStat label={<Trans>En uso</Trans>} value={inUse} tone={inUse ? 'ok' : undefined} />
        <FigureStat label={<Trans>Movimientos</Trans>} value={movements} />
        <FigureStat
          label={<Trans>Sin venta</Trans>}
          value={noSale}
          tone={noSale ? 'danger' : undefined}
        />
      </FigureRow>

      <BriefSection title={<Trans>Cajas registradoras</Trans>}>
        {items.map((item) => {
          const noSaleOpens = item.facts?.noSaleOpens ?? 0;
          const moves = item.facts?.movements ?? 0;
          return (
            <NarrativeRow
              key={item.id}
              tone={
                item.status === 'reconciliation_required' || item.status === 'blocked'
                  ? 'danger'
                  : item.status === 'in_use'
                    ? 'ok'
                    : noSaleOpens
                      ? 'warn'
                      : undefined
              }
              subject={<strong style={{ fontWeight: 600 }}>{item.title}</strong>}
              meta={
                <>
                  <RegisterStatusLabel status={item.status} />
                  {' · '}
                  <Trans>
                    {moves} movimientos · {noSaleOpens} sin venta
                  </Trans>
                </>
              }
            />
          );
        })}
      </BriefSection>
    </div>
  );
}

// The domain-view registry (the seam). A domain here replaces the generic table.
const DOMAIN_VIEWS = {
  cash_shifts: CashShiftsView,
  sales: SalesView,
  receipts: ReceiptsView,
  refunds_voids: RefundsView,
  registers: RegistersView,
};

// The money hub: these five domains render as the calm editorial briefing (on the
// canvas), not the generic card+table. Every other domain keeps the generic table.
const MONEY_HUB = new Set(['sales', 'receipts', 'refunds_voids', 'cash_shifts', 'registers']);

export function DomainWorkspace({ domain }) {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const merchant = useMerchant();
  const [cursor, setCursor] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [merchantWide, setMerchantWide] = useState(false);
  const [copied, setCopied] = useState('');
  const [refundSale, setRefundSale] = useState(null);
  const [inventoryRow, setInventoryRow] = useState(null);
  const [receiptRow, setReceiptRow] = useState(null);
  const [loyaltyRow, setLoyaltyRow] = useState(null);
  const [giftCardRow, setGiftCardRow] = useState(null);
  const [catalogRow, setCatalogRow] = useState(undefined);
  const [registerRow, setRegisterRow] = useState(null);
  const [kitchenRouteOpen, setKitchenRouteOpen] = useState(false);
  const [recoveryRow, setRecoveryRow] = useState(null);
  const [saleDetail, setSaleDetail] = useState(null);
  const state = useOperationsData(domain, cursor, refresh, merchantWide);
  const domains = state.data?.domains || [];
  const selected = domains.find((item) => item.domain === domain);
  const DomainView = DOMAIN_VIEWS[domain];
  const permissions = merchant?.capabilities?.membership?.permissions || [];
  const canUseMerchantScope =
    !merchant?.capabilities?.membership?.locationId &&
    (permissions.includes('*') ||
      permissions.includes('merchant.manage') ||
      permissions.includes('kitchen.merchant.read'));

  async function copy(value) {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied(''), 1200);
  }

  /**
   * The scope switch. The audit of 2026-09-18 found a button that said `Todo el
   * negocio` with no context: a person could not tell if it named the current
   * scope or the next one. A segmented control shows both options and marks the
   * active one, so the control says what it does.
   */
  const scopeControl = canUseMerchantScope ? (
    <Segmented
      label={t`Alcance`}
      value={merchantWide ? 'all' : 'location'}
      onChange={(next) => {
        setMerchantWide(next === 'all');
        setCursor(0);
      }}
      options={[
        { id: 'location', label: t`Ubicación` },
        { id: 'all', label: t`Todo el negocio` },
      ]}
    />
  ) : null;

  /** Open the smallest authorized surface for one row of this domain. */
  function openDomainRow(item) {
    if (domain === 'catalog') setCatalogRow(item);
    else if (domain === 'inventory') setInventoryRow(item);
    else if (domain === 'receipts') setReceiptRow(item);
    else if (domain === 'loyalty') setLoyaltyRow(item);
    else if (domain === 'gift_cards') setGiftCardRow(item);
    else if (domain === 'registers') setRegisterRow(item);
    else if (domain === 'recovery') setRecoveryRow(item);
    else if (domain === 'sales') setRefundSale(item);
  }
  return (
    <>
      {MONEY_HUB.has(domain) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }} aria-live="polite">
          {scopeControl ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{scopeControl}</div>
          ) : null}
          {selected && !selected.available ? (
            <div className="card" style={{ padding: 28, color: 'var(--ink-3)' }}>
              <Trans>Requiere permiso: {selected.requiredPermissions?.join(t` o `) || '—'}</Trans>
            </div>
          ) : state.error ? (
            <div className="card" style={{ padding: 28, color: 'var(--danger)' }}>
              {ERROR_COPY[state.errorCode]
                ? i18n._(ERROR_COPY[state.errorCode])
                : t`No fue posible cargar esta operación.`}
            </div>
          ) : state.loading && !state.data?.items?.length ? (
            <div className="card" style={{ padding: 28, color: 'var(--ink-3)' }}>
              <Trans>Cargando datos autorizados…</Trans>
            </div>
          ) : !state.data?.items?.length ? (
            <div className="card" style={{ padding: 28, color: 'var(--ink-3)' }}>
              <Trans>No hay datos para este alcance.</Trans>
            </div>
          ) : (
            <DomainView
              items={state.data.items}
              ctx={{
                copy,
                copied,
                onRefund: setRefundSale,
                onReprint: setReceiptRow,
                onConfigure: setRegisterRow,
                onSale: setSaleDetail,
              }}
            />
          )}
          {(cursor > 0 || state.data?.page?.hasMore) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={cursor === 0 || state.loading}
                onClick={() => setCursor(Math.max(0, cursor - 20))}
              >
                <Trans>Anterior</Trans>
              </button>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                <Trans>Página {Math.floor(cursor / 20) + 1}</Trans>
              </span>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={!state.data?.page?.hasMore || state.loading}
                onClick={() => setCursor(Number(state.data.page.nextCursor))}
              >
                <Trans>Siguiente</Trans>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }} aria-live="polite">
          <section
            className="surface"
            /* The name is still here for a screen reader. It is not printed again,
               because the masthead and the hub tab already say it. */
            aria-label={
              DOMAIN_LABELS[domain] ? i18n._(DOMAIN_LABELS[domain]) : selected?.label || undefined
            }
            style={{ minWidth: 0, overflow: 'hidden' }}
          >
            {/*
              The opening band. The masthead owns the page name, so this band never
              prints it: the audit of 2026-09-18 found `Catálogo` in the masthead,
              in the hub tab, and again as a card heading. The band holds one count
              and one primary action. The scope switch and the refresh are
              controls, not actions, so they stay quiet.
            */}
            <div style={{ padding: '12px 16px' }}>
              <PageHead
                count={
                  state.data?.items?.length && domain === 'catalog' ? (
                    <Trans>{state.data.items.length} productos</Trans>
                  ) : undefined
                }
                actions={
                  <>
                    {scopeControl}
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={state.loading}
                      onClick={() => setRefresh((value) => value + 1)}
                    >
                      {state.loading ? <Trans>Actualizando…</Trans> : <Trans>Actualizar</Trans>}
                    </button>
                    {domain === 'catalog' && state.data?.items?.length ? (
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        onClick={() => setCatalogRow(null)}
                      >
                        <Trans>Crear producto</Trans>
                      </button>
                    ) : null}
                    {domain === 'gift_cards' ? (
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        onClick={() => setGiftCardRow({ id: crypto.randomUUID(), currency: 'MXN' })}
                      >
                        <Trans>Emitir tarjeta</Trans>
                      </button>
                    ) : null}
                    {domain === 'kitchen' ? (
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        onClick={() => setKitchenRouteOpen(true)}
                      >
                        <Trans>Configurar ruta</Trans>
                      </button>
                    ) : null}
                    {ACTION_ROUTES[domain] ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        onClick={() => navigate(ACTION_ROUTES[domain])}
                      >
                        <Trans>Administrar</Trans>
                      </button>
                    ) : null}
                  </>
                }
              />
            </div>

            <div className="surface-divide">
              {selected && !selected.available ? (
                <div className="inv-state">
                  <span className="inv-state-title">
                    <Trans>
                      Requiere permiso: {selected.requiredPermissions?.join(t` o `) || '—'}
                    </Trans>
                  </span>
                </div>
              ) : state.error ? (
                <div className="inv-state">
                  <span className="inv-state-title">
                    <Trans>No fue posible cargar esta operación.</Trans>
                  </span>
                  <span className="inv-state-note">
                    {ERROR_COPY[state.errorCode] ? i18n._(ERROR_COPY[state.errorCode]) : null}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => setRefresh((value) => value + 1)}
                  >
                    <Trans>Reintentar</Trans>
                  </button>
                </div>
              ) : state.loading && !state.data?.items?.length ? (
                <div className="inv-state">
                  <span className="inv-state-note">
                    <Trans>Cargando datos autorizados…</Trans>
                  </span>
                </div>
              ) : !state.data?.items?.length ? (
                <div className="inv-state">
                  <span className="inv-state-title">
                    {domain === 'catalog' ? (
                      <Trans>Aún no hay productos</Trans>
                    ) : (
                      <Trans>No hay datos para este alcance.</Trans>
                    )}
                  </span>
                  {domain === 'catalog' ? (
                    <>
                      <span className="inv-state-note">
                        <Trans>Crea el primer producto de la carta.</Trans>
                      </span>
                      {/* The band hides its own primary action while the set is
                      empty, so the screen holds exactly one. */}
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => setCatalogRow(null)}
                      >
                        <Trans>Crear producto</Trans>
                      </button>
                    </>
                  ) : null}
                </div>
              ) : DomainView ? (
                <DomainView
                  items={state.data.items}
                  ctx={{
                    copy,
                    copied,
                    onRefund: setRefundSale,
                    onReprint: setReceiptRow,
                    onConfigure: setRegisterRow,
                    onSale: setSaleDetail,
                  }}
                />
              ) : (
                /*
              A resource list, not a data table. The audit of 2026-09-18 counted
              72 controls on this screen. It held a permission key, a raw UUID
              under every name, a status pill on every row, and a button on every
              row. A row here holds one name, one meta line, one figure, and one
              verb.
            */
                <div>
                  {state.data.items.map((item) => {
                    const tone = STATE_TONE[String(item.status || '').toLowerCase()];
                    const reference = item.correlationId || item.publicReference;
                    const verbLabel = ROW_ACTION_LABEL[domain]
                      ? i18n._(ROW_ACTION_LABEL[domain])
                      : null;
                    const verbAllowed =
                      Boolean(verbLabel) &&
                      !(domain === 'receipts' && item.status === 'not_printed');
                    return (
                      <div key={item.id} className="inv-row">
                        {/* A neutral dot for an ordinary state, so a colour never
                        repeats down the column. */}
                        <span className="inv-dot" data-state={tone} aria-hidden="true" />
                        <span className="inv-row-main">
                          <span className="inv-row-name">
                            {item.title || item.publicReference || '—'}
                          </span>
                          <span className="inv-row-meta">
                            {item.detail || '—'}
                            {item.occurredAt ? (
                              <>
                                <span>·</span>
                                {formatOperationDate(item.occurredAt)}
                              </>
                            ) : null}
                          </span>
                        </span>
                        <span className="inv-row-value">
                          <span className="inv-row-figure">
                            {item.amountMinorUnits == null
                              ? ''
                              : formatOperationMoney(item.amountMinorUnits, item.currency)}
                          </span>
                          <span className="inv-row-note">
                            <Status value={item.status} />
                          </span>
                        </span>
                        <span className="inv-row-action" style={{ display: 'flex', gap: 4 }}>
                          {verbAllowed ? (
                            <button
                              className="btn btn-secondary btn-sm"
                              type="button"
                              onClick={() => openDomainRow(item)}
                            >
                              {verbLabel}
                            </button>
                          ) : null}
                          <button
                            className="btn-icon"
                            type="button"
                            onClick={() => copy(reference)}
                            aria-label={t`Copiar referencia ${item.publicReference}`}
                          >
                            {copied === reference ? '✓' : '⧉'}
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {state.data?.items?.length ? (
              <div className="surface-divide" style={{ padding: '10px 16px' }}>
                <div className="inv-foot">
                  {/* The old footer printed the effective permission count. The
                    audit of 2026-09-18 counted that as developer text. */}
                  <span>
                    <Trans>Página {Math.floor(cursor / 20) + 1}</Trans>
                  </span>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      disabled={cursor === 0 || state.loading}
                      onClick={() => setCursor(Math.max(0, cursor - 20))}
                    >
                      <Trans>Anterior</Trans>
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      disabled={!state.data?.page?.hasMore || state.loading}
                      onClick={() => setCursor(Number(state.data.page.nextCursor))}
                    >
                      <Trans>Siguiente</Trans>
                    </button>
                  </span>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      )}
      {refundSale && (
        <RefundDialog
          sale={refundSale}
          onClose={() => setRefundSale(null)}
          onComplete={() => {
            setRefundSale(null);
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {inventoryRow && (
        <InventoryDialog
          row={inventoryRow}
          onClose={() => setInventoryRow(null)}
          onComplete={() => {
            setInventoryRow(null);
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {receiptRow && (
        <ReceiptReprintDialog
          row={receiptRow}
          onClose={() => setReceiptRow(null)}
          onComplete={() => {
            setReceiptRow(null);
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {loyaltyRow && (
        <LoyaltyDialog
          row={loyaltyRow}
          onClose={() => setLoyaltyRow(null)}
          onComplete={() => {
            setLoyaltyRow(null);
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {giftCardRow && (
        <GiftCardIssueDialog
          row={giftCardRow}
          onClose={() => setGiftCardRow(null)}
          onComplete={() => {
            setGiftCardRow(null);
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {catalogRow !== undefined && (
        <CatalogDialog
          row={catalogRow}
          onClose={() => setCatalogRow(undefined)}
          onComplete={() => {
            setCatalogRow(undefined);
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {registerRow && (
        <RegisterDialog
          row={registerRow}
          onClose={() => setRegisterRow(null)}
          onComplete={() => {
            setRegisterRow(null);
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {kitchenRouteOpen && (
        <KitchenRouteDialog
          onClose={() => setKitchenRouteOpen(false)}
          onComplete={() => {
            setKitchenRouteOpen(false);
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {recoveryRow && <RecoveryDialog row={recoveryRow} onClose={() => setRecoveryRow(null)} />}
      {saleDetail && (
        <SaleReceiptSheet
          key={saleDetail.id}
          sale={saleDetail}
          onClose={() => setSaleDetail(null)}
        />
      )}
    </>
  );
}
