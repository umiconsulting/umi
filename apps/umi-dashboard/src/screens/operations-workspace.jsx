import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useOperationsData } from '@/data.jsx';
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

function Status({ value }) {
  const { t } = useLingui();
  return (
    <span className="sub-pill">{value ? String(value).replaceAll('_', ' ') : t`desconocido`}</span>
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

function RefundDialog({ sale, onClose, onComplete }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
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
              <select
                value={exceptionType}
                onChange={(event) => setExceptionType(event.target.value)}
              >
                {eligibility.allowedTypes.map((type) => (
                  <option value={type} key={type}>
                    {type.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <Trans>Motivo</Trans>
              <select value={reason} onChange={(event) => setReason(event.target.value)}>
                <option value="customer_changed_mind">{t`Cambio de decisión`}</option>
                <option value="incorrect_item">{t`Artículo incorrecto`}</option>
                <option value="product_defect">{t`Defecto del producto`}</option>
              </select>
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
                  className="btn"
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
              <select
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
              </select>
            </label>
            {operation === 'inventory.adjustment' && (
              <label>
                <Trans>Dirección</Trans>
                <select value={direction} onChange={(event) => setDirection(event.target.value)}>
                  <option value="increase">{t`Aumentar`}</option>
                  <option value="decrease">{t`Reducir`}</option>
                </select>
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
              <button className="btn" type="button" onClick={previewMutation}>
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
              <button className="btn" type="button" onClick={createCount}>
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
                <button className="btn" type="button" onClick={submitCount}>
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

function ReceiptReprintDialog({ row, onClose, onComplete }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
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
          <select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="increase">{t`Aumentar`}</option>
            <option value="decrease">{t`Reducir`}</option>
          </select>
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
          <button className="btn" type="button" onClick={preview}>
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
              <button className="btn" type="button" onClick={preview}>
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
                <button className="btn" type="button" disabled={command.pending} onClick={archive}>
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
          <select
            value={assignmentPolicy}
            onChange={(event) => setAssignmentPolicy(event.target.value)}
          >
            <option value="device_required">{t`Dispositivo requerido`}</option>
            <option value="operator_selects">{t`Selección del operador`}</option>
          </select>
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
          <select value={routeType} onChange={(event) => setRouteType(event.target.value)}>
            <option value="default">{t`Predeterminada`}</option>
            <option value="product">{t`Producto`}</option>
            <option value="category">{t`Categoría`}</option>
          </select>
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
            className="btn"
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
// Per-domain observability views (the seam): the generic table is the fallback for
// every domain; a domain with a registered summary gets a rich strip above it. Adding
// a rich domain is one component + one branch in DomainSummary — the table is untouched.
function CashShiftsSummary({ items }) {
  const shifts = items.filter((it) => it.facts);
  if (!shifts.length) return null;
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        padding: '16px 20px',
        borderBottom: '1px solid var(--line)',
      }}
    >
      {shifts.map((it) => {
        const f = it.facts;
        const expected = f.expectedCashMinorUnits ?? null;
        const counted = f.countedCashMinorUnits ?? null;
        const variance = counted != null && expected != null ? counted - expected : null;
        const varianceOff = variance != null && variance !== 0;
        const accent = varianceOff
          ? 'var(--danger)'
          : it.status === 'open'
            ? 'var(--success)'
            : 'var(--ink-2)';
        return (
          <div
            key={it.id}
            style={{
              minWidth: 200,
              borderLeft: `3px solid ${accent}`,
              padding: '10px 14px',
              borderRadius: 6,
            }}
          >
            <div style={{ fontWeight: 600 }}>{f.operator || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {f.register} · {it.status}
            </div>
            <div style={{ fontSize: 12, marginTop: 6 }}>
              <Trans>Fondo {formatOperationMoney(f.openingFloatMinorUnits, it.currency)}</Trans>
            </div>
            <div style={{ fontSize: 12 }}>
              <Trans>
                Esperado <strong>{formatOperationMoney(expected, it.currency)}</strong>
              </Trans>
            </div>
            {counted != null && (
              <div style={{ fontSize: 12 }}>
                <Trans>Contado {formatOperationMoney(counted, it.currency)}</Trans>
              </div>
            )}
            {variance != null && (
              <div
                style={{ fontSize: 12, color: varianceOff ? 'var(--danger)' : 'var(--success)' }}
              >
                <Trans>Diferencia {formatOperationMoney(variance, it.currency)}</Trans>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DomainSummary({ domain, items }) {
  if (domain === 'cash_shifts') return <CashShiftsSummary items={items} />;
  return null;
}

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
  const state = useOperationsData(domain, cursor, refresh, merchantWide);
  const domains = state.data?.domains || [];
  const selected = domains.find((item) => item.domain === domain);
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

  return (
    <>
      <section className="card" style={{ minWidth: 0 }} aria-live="polite">
        <div style={{ padding: 20, borderBottom: '1px solid var(--line)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <div>
              <h3 style={{ margin: 0 }}>{selected?.label || t`Operación`}</h3>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 5 }}>
                <Trans>Permiso: {selected?.requiredPermissions?.join(t` o `) || '—'}</Trans>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {domain === 'catalog' && (
                <button className="btn" type="button" onClick={() => setCatalogRow(null)}>
                  <Trans>Crear producto</Trans>
                </button>
              )}
              {domain === 'gift_cards' && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => setGiftCardRow({ id: crypto.randomUUID(), currency: 'MXN' })}
                >
                  <Trans>Emitir tarjeta</Trans>
                </button>
              )}
              {domain === 'kitchen' && (
                <button className="btn" type="button" onClick={() => setKitchenRouteOpen(true)}>
                  <Trans>Configurar ruta</Trans>
                </button>
              )}
              {ACTION_ROUTES[domain] && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => navigate(ACTION_ROUTES[domain])}
                >
                  <Trans>Administrar</Trans>
                </button>
              )}
              {canUseMerchantScope && (
                <button
                  className="btn"
                  type="button"
                  aria-pressed={merchantWide}
                  onClick={() => {
                    setMerchantWide((value) => !value);
                    setCursor(0);
                  }}
                >
                  {merchantWide ? <Trans>Ubicación</Trans> : <Trans>Todo el negocio</Trans>}
                </button>
              )}
              <button
                className="btn"
                type="button"
                disabled={state.loading}
                onClick={() => setRefresh((value) => value + 1)}
              >
                {state.loading ? <Trans>Actualizando…</Trans> : <Trans>Actualizar</Trans>}
              </button>
            </div>
          </div>
          {selected?.allowedActions?.length ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
              {selected.allowedActions.map((action) => (
                <span className="sub-pill" key={action}>
                  {action.replaceAll('_', ' ')}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {state.data?.items?.length ? (
          <DomainSummary domain={domain} items={state.data.items} />
        ) : null}
        {selected && !selected.available ? (
          <div style={{ padding: 28, color: 'var(--ink-3)' }}>
            <Trans>Requiere permiso: {selected.requiredPermissions?.join(t` o `) || '—'}</Trans>
          </div>
        ) : state.error ? (
          <div style={{ padding: 28, color: 'var(--danger)' }}>
            {ERROR_COPY[state.errorCode]
              ? i18n._(ERROR_COPY[state.errorCode])
              : t`No fue posible cargar esta operación.`}
          </div>
        ) : state.loading && !state.data?.items?.length ? (
          <div style={{ padding: 28, color: 'var(--ink-3)' }}>
            <Trans>Cargando datos autorizados…</Trans>
          </div>
        ) : !state.data?.items?.length ? (
          <div style={{ padding: 28, color: 'var(--ink-3)' }}>
            <Trans>No hay datos para este alcance.</Trans>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}>
                  <th style={{ padding: '12px 16px' }}>
                    <Trans>Referencia</Trans>
                  </th>
                  <th>
                    <Trans>Detalle</Trans>
                  </th>
                  <th>
                    <Trans>Estado</Trans>
                  </th>
                  <th>
                    <Trans>Importe</Trans>
                  </th>
                  <th>
                    <Trans>Fecha</Trans>
                  </th>
                  <th aria-label={t`Acciones`} />
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((item) => (
                  <tr key={item.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <strong>{item.title}</strong>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: 'var(--ink-3)',
                          marginTop: 4,
                        }}
                      >
                        {item.publicReference}
                      </div>
                    </td>
                    <td>{item.detail || '—'}</td>
                    <td>
                      <Status value={item.status} />
                    </td>
                    <td>{formatOperationMoney(item.amountMinorUnits, item.currency)}</td>
                    <td>{formatOperationDate(item.occurredAt)}</td>
                    <td style={{ paddingRight: 14 }}>
                      {domain === 'sales' && (
                        <button className="btn" type="button" onClick={() => setRefundSale(item)}>
                          <Trans>Reembolsar</Trans>
                        </button>
                      )}
                      {domain === 'inventory' && (
                        <button className="btn" type="button" onClick={() => setInventoryRow(item)}>
                          <Trans>Operar</Trans>
                        </button>
                      )}
                      {domain === 'receipts' && item.status !== 'not_printed' && (
                        <button className="btn" type="button" onClick={() => setReceiptRow(item)}>
                          <Trans>Reimprimir</Trans>
                        </button>
                      )}
                      {domain === 'loyalty' && (
                        <button className="btn" type="button" onClick={() => setLoyaltyRow(item)}>
                          <Trans>Ajustar</Trans>
                        </button>
                      )}
                      {domain === 'gift_cards' && (
                        <button className="btn" type="button" onClick={() => setGiftCardRow(item)}>
                          <Trans>Emitir</Trans>
                        </button>
                      )}
                      {domain === 'catalog' && (
                        <button className="btn" type="button" onClick={() => setCatalogRow(item)}>
                          <Trans>Editar</Trans>
                        </button>
                      )}
                      {domain === 'registers' && (
                        <button className="btn" type="button" onClick={() => setRegisterRow(item)}>
                          <Trans>Configurar</Trans>
                        </button>
                      )}
                      {domain === 'recovery' && (
                        <button className="btn" type="button" onClick={() => setRecoveryRow(item)}>
                          <Trans>Recuperar</Trans>
                        </button>
                      )}
                      <button
                        className="btn-icon"
                        type="button"
                        onClick={() => copy(item.correlationId || item.publicReference)}
                        aria-label={t`Copiar referencia ${item.publicReference}`}
                      >
                        {copied === (item.correlationId || item.publicReference) ? '✓' : '⧉'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div
          style={{
            padding: 14,
            display: 'flex',
            justifyContent: 'space-between',
            borderTop: '1px solid var(--line)',
          }}
        >
          <button
            className="btn"
            type="button"
            disabled={cursor === 0 || state.loading}
            onClick={() => setCursor(Math.max(0, cursor - 20))}
          >
            <Trans>Anterior</Trans>
          </button>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            <Trans>Página {Math.floor(cursor / 20) + 1}</Trans> ·{' '}
            <Plural
              value={permissions.length}
              one="# permiso efectivo"
              other="# permisos efectivos"
            />
          </span>
          <button
            className="btn"
            type="button"
            disabled={!state.data?.page?.hasMore || state.loading}
            onClick={() => setCursor(Number(state.data.page.nextCursor))}
          >
            <Trans>Siguiente</Trans>
          </button>
        </div>
      </section>
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
    </>
  );
}
