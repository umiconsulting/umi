import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  PERMISSION_DENIED: 'No tienes el permiso requerido para esta operación.',
  LOCATION_SCOPE_VIOLATION: 'La ubicación no pertenece a tu alcance.',
  OPTIMISTIC_VERSION_CONFLICT: 'Los datos cambiaron. Actualiza la vista antes de continuar.',
  HARDWARE_OUTCOME_UNKNOWN:
    'El resultado físico es desconocido. Verifica el equipo antes de repetir.',
  RECOVERY_REQUIRED: 'Consulta el comando original en el Centro de recuperación.',
  SERVICE_UNAVAILABLE: 'El servicio no está disponible. Intenta de nuevo después.',
};

function Status({ value }) {
  return <span className="sub-pill">{String(value || 'unknown').replaceAll('_', ' ')}</span>;
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
      <section className="card modal-card" role="dialog" aria-modal="true" aria-label="Refund">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Refund de {sale.publicReference}</h3>
            <p style={{ color: 'var(--ink-3)' }}>La API calcula todos los importes.</p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
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
            {command.pending ? 'Consultando…' : 'Consultar elegibilidad'}
          </button>
        ) : !preview ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <label>
              Tipo
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
              Motivo
              <select value={reason} onChange={(event) => setReason(event.target.value)}>
                <option value="customer_changed_mind">Cambio de decisión</option>
                <option value="incorrect_item">Artículo incorrecto</option>
                <option value="product_defect">Defecto del producto</option>
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
                    aria-label={`Cantidad para ${line.displayName}`}
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
              {command.pending ? 'Calculando…' : 'Crear preview'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <strong>
              Total:{' '}
              {formatOperationMoney(
                preview.allocation.total.minorUnits,
                preview.allocation.total.currency,
              )}
            </strong>
            {requiresApproval && !approvalId && (
              <>
                <label>
                  PIN del aprobador
                  <input
                    type="password"
                    inputMode="numeric"
                    value={managerPin}
                    onChange={(event) => setManagerPin(event.target.value)}
                  />
                </label>
                <button
                  className="btn"
                  type="button"
                  disabled={command.pending || managerPin.length < 4}
                  onClick={approve}
                >
                  Obtener aprobación
                </button>
              </>
            )}
            <button
              className="btn btn-primary"
              type="button"
              disabled={command.pending || (requiresApproval && !approvalId)}
              onClick={commit}
            >
              {command.pending ? 'Ejecutando…' : 'Confirmar refund'}
            </button>
          </div>
        )}
        {command.error && (
          <p style={{ color: 'var(--danger)' }}>
            {ERROR_COPY[command.error.code] || command.error.message}
          </p>
        )}
      </section>
    </div>
  );
}

function InventoryDialog({ row, onClose, onComplete }) {
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
    setMessage('Operación de inventario comprometida.');
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
    setMessage('Conteo reconciliado.');
    onComplete();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="card modal-card" role="dialog" aria-modal="true" aria-label="Inventario">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Inventario: {row.title}</h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
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
            Cargar autoridad
          </button>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <label>
              Operación
              <select
                value={operation}
                onChange={(event) => {
                  setOperation(event.target.value);
                  setPlanned(null);
                }}
              >
                <option value="inventory.adjustment">Ajuste</option>
                <option value="inventory.waste">Merma</option>
                <option value="inventory.damage">Daño</option>
                <option value="inventory.quarantine">Cuarentena</option>
              </select>
            </label>
            {operation === 'inventory.adjustment' && (
              <label>
                Dirección
                <select value={direction} onChange={(event) => setDirection(event.target.value)}>
                  <option value="increase">Aumentar</option>
                  <option value="decrease">Reducir</option>
                </select>
              </label>
            )}
            <label>
              Cantidad
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            {!planned ? (
              <button className="btn" type="button" onClick={previewMutation}>
                Revisar operación
              </button>
            ) : (
              <>
                {planned.approval.approvalRequired && (
                  <label>
                    PIN del aprobador
                    <input
                      type="password"
                      inputMode="numeric"
                      value={managerPin}
                      onChange={(event) => setManagerPin(event.target.value)}
                    />
                  </label>
                )}
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={
                    command.pending || (planned.approval.approvalRequired && managerPin.length < 4)
                  }
                  onClick={executeMutation}
                >
                  Confirmar operación
                </button>
              </>
            )}
            <hr />
            {!count ? (
              <button className="btn" type="button" onClick={createCount}>
                Crear conteo del artículo
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
                  Enviar conteo
                </button>
              </>
            ) : (
              <>
                {submitted.variances.some((value) => value.approvalRequired) && (
                  <label>
                    PIN del aprobador
                    <input
                      type="password"
                      inputMode="numeric"
                      value={managerPin}
                      onChange={(event) => setManagerPin(event.target.value)}
                    />
                  </label>
                )}
                <button className="btn btn-primary" type="button" onClick={reconcileCount}>
                  Reconciliar conteo
                </button>
              </>
            )}
          </div>
        )}
        {message && <p>{message}</p>}
        {command.error && <p style={{ color: 'var(--danger)' }}>{command.error.message}</p>}
      </section>
    </div>
  );
}

function ReceiptReprintDialog({ row, onClose, onComplete }) {
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
    setMessage(`COPY en estado ${result.command.status}. Referencia ${result.command.commandId}.`);
    onComplete();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="card modal-card" role="dialog" aria-modal="true" aria-label="Reimpresión">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Reimprimir {row.publicReference}</h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{' '}
          Confirmo una copia controlada.
        </label>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!confirmed || command.pending}
          onClick={reprint}
        >
          Crear COPY
        </button>
        {message && <p>{message}</p>}
        {command.error && (
          <p style={{ color: 'var(--danger)' }}>
            {ERROR_COPY[command.error.code] || command.error.message}
          </p>
        )}
      </section>
    </div>
  );
}

function LoyaltyDialog({ row, onClose, onComplete }) {
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
        aria-label="Ajuste de puntos"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Ajuste de puntos</h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <label>
          Dirección
          <select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="increase">Aumentar</option>
            <option value="decrease">Reducir</option>
          </select>
        </label>
        <label>
          Puntos
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
            Revisar ajuste
          </button>
        ) : (
          <>
            <p>Saldo proyectado: {planned.preview.projectedAvailable}</p>
            {planned.preview.approvalPermission && (
              <label>
                PIN del aprobador
                <input
                  type="password"
                  inputMode="numeric"
                  value={managerPin}
                  onChange={(event) => setManagerPin(event.target.value)}
                />
              </label>
            )}
            <button
              className="btn btn-primary"
              type="button"
              disabled={
                command.pending || (planned.preview.approvalPermission && managerPin.length < 4)
              }
              onClick={commit}
            >
              Confirmar ajuste
            </button>
          </>
        )}
        {command.error && (
          <p style={{ color: 'var(--danger)' }}>
            {ERROR_COPY[command.error.code] || command.error.message}
          </p>
        )}
      </section>
    </div>
  );
}

function GiftCardIssueDialog({ row, onClose, onComplete }) {
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
        aria-label="Emitir tarjeta de regalo"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Emisión promocional</h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        {secret ? (
          <>
            <p>Código de entrega única:</p>
            <code>{secret.code}</code>
            <button className="btn btn-primary" type="button" onClick={onComplete}>
              Terminar
            </button>
          </>
        ) : (
          <>
            <label>
              Importe menor
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
                Revisar emisión
              </button>
            ) : (
              <>
                <p>Límite: {planned.preview.maximumValueMinorUnits}</p>
                {planned.preview.approvalPermission && (
                  <label>
                    PIN del aprobador
                    <input
                      type="password"
                      inputMode="numeric"
                      value={managerPin}
                      onChange={(event) => setManagerPin(event.target.value)}
                    />
                  </label>
                )}
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={
                    command.pending || (planned.preview.approvalPermission && managerPin.length < 4)
                  }
                  onClick={issue}
                >
                  Emitir y revelar
                </button>
              </>
            )}
          </>
        )}
        {command.error && (
          <p style={{ color: 'var(--danger)' }}>
            {ERROR_COPY[command.error.code] || command.error.message}
          </p>
        )}
      </section>
    </div>
  );
}

function CatalogDialog({ row, onClose, onComplete }) {
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
      <section className="card modal-card" role="dialog" aria-modal="true" aria-label="Producto">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>{row ? 'Editar producto' : 'Crear producto'}</h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
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
            Cargar datos actuales
          </button>
        ) : (
          <>
            <label>
              Nombre
              <input
                value={name}
                maxLength={240}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Precio en unidades menores
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
              Código de barras
              <input
                value={barcode}
                maxLength={160}
                onChange={(event) => setBarcode(event.target.value)}
              />
            </label>
            <label>
              Categoría
              <input
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                placeholder="UUID opcional"
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={requiresPreparation}
                onChange={(event) => setRequiresPreparation(event.target.checked)}
              />{' '}
              Requiere preparación
            </label>
            <label>
              Artículo de inventario
              <input
                value={inventoryItemId}
                onChange={(event) => setInventoryItemId(event.target.value)}
                placeholder="UUID opcional"
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                type="button"
                disabled={command.pending || !name.trim()}
                onClick={save}
              >
                Guardar
              </button>
              {row && row.status !== 'archived' && (
                <button className="btn" type="button" disabled={command.pending} onClick={archive}>
                  Archivar
                </button>
              )}
            </div>
          </>
        )}
        {command.error && (
          <p style={{ color: 'var(--danger)' }}>
            {ERROR_COPY[command.error.code] || command.error.message}
          </p>
        )}
      </section>
    </div>
  );
}

function RegisterDialog({ row, onClose, onComplete }) {
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
      <section className="card modal-card" role="dialog" aria-modal="true" aria-label="Registro">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Configurar registro</h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <label>
          Nombre
          <input
            value={displayName}
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          Política
          <select
            value={assignmentPolicy}
            onChange={(event) => setAssignmentPolicy(event.target.value)}
          >
            <option value="device_required">Dispositivo requerido</option>
            <option value="operator_selects">Selección del operador</option>
          </select>
        </label>
        <label>
          Dispositivo POS asignado
          <input
            value={assignedDeviceId}
            placeholder="UUID opcional"
            onChange={(event) => setAssignedDeviceId(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />{' '}
          Habilitado
        </label>
        <button
          className="btn btn-primary"
          type="button"
          disabled={command.pending || !displayName.trim()}
          onClick={save}
        >
          Guardar
        </button>
        {command.error && (
          <p style={{ color: 'var(--danger)' }}>
            {ERROR_COPY[command.error.code] || command.error.message}
          </p>
        )}
      </section>
    </div>
  );
}

function KitchenRouteDialog({ onClose, onComplete }) {
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
        aria-label="Ruta de cocina"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Configurar ruta de cocina</h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <label>
          Estación
          <input
            value={stationId}
            onChange={(event) => setStationId(event.target.value)}
            placeholder="UUID de estación"
          />
        </label>
        <label>
          Tipo
          <select value={routeType} onChange={(event) => setRouteType(event.target.value)}>
            <option value="default">Predeterminada</option>
            <option value="product">Producto</option>
            <option value="category">Categoría</option>
          </select>
        </label>
        {targetRequired && (
          <label>
            Objetivo
            <input
              value={routeTargetId}
              onChange={(event) => setRouteTargetId(event.target.value)}
              placeholder="UUID del objetivo"
            />
          </label>
        )}
        <label>
          Prioridad
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
          Guardar ruta
        </button>
        {command.error && (
          <p style={{ color: 'var(--danger)' }}>
            {ERROR_COPY[command.error.code] || command.error.message}
          </p>
        )}
      </section>
    </div>
  );
}

function RecoveryDialog({ row, onClose }) {
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
        aria-label="Recuperación"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Comando original</h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={command.pending}
          onClick={query}
        >
          Consultar autoridad
        </button>
        {canRecover && (
          <button
            className="btn"
            type="button"
            disabled={command.pending}
            onClick={executeDomainRecovery}
          >
            Ejecutar recuperación del dominio
          </button>
        )}
        {result && (
          <dl>
            <dt>Tipo</dt>
            <dd>{result.commandType}</dd>
            <dt>Estado</dt>
            <dd>{result.status}</dd>
            <dt>Correlación</dt>
            <dd>
              <code>{result.correlationId}</code>
            </dd>
            <dt>Acción</dt>
            <dd>
              {result.retryable ? 'Usa la acción del dominio.' : 'Consulta antes de repetir.'}
            </dd>
          </dl>
        )}
        {command.error && (
          <p style={{ color: 'var(--danger)' }}>
            {ERROR_COPY[command.error.code] || command.error.message}
          </p>
        )}
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
export function DomainWorkspace({ domain }) {
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
              <h3 style={{ margin: 0 }}>{selected?.label || 'Operación'}</h3>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 5 }}>
                Permiso: {selected?.requiredPermissions?.join(' o ') || '—'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {domain === 'catalog' && (
                <button className="btn" type="button" onClick={() => setCatalogRow(null)}>
                  Crear producto
                </button>
              )}
              {domain === 'gift_cards' && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => setGiftCardRow({ id: crypto.randomUUID(), currency: 'MXN' })}
                >
                  Emitir tarjeta
                </button>
              )}
              {domain === 'kitchen' && (
                <button className="btn" type="button" onClick={() => setKitchenRouteOpen(true)}>
                  Configurar ruta
                </button>
              )}
              {ACTION_ROUTES[domain] && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => navigate(ACTION_ROUTES[domain])}
                >
                  Administrar
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
                  {merchantWide ? 'Ubicación' : 'Todo el negocio'}
                </button>
              )}
              <button
                className="btn"
                type="button"
                disabled={state.loading}
                onClick={() => setRefresh((value) => value + 1)}
              >
                {state.loading ? 'Actualizando…' : 'Actualizar'}
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

        {selected && !selected.available ? (
          <div style={{ padding: 28, color: 'var(--ink-3)' }}>
            Requiere permiso: {selected.requiredPermissions?.join(' o ') || '—'}
          </div>
        ) : state.error ? (
          <div style={{ padding: 28, color: 'var(--danger)' }}>
            {ERROR_COPY[state.errorCode] || 'No fue posible cargar esta operación.'}
          </div>
        ) : state.loading && !state.data?.items?.length ? (
          <div style={{ padding: 28, color: 'var(--ink-3)' }}>Cargando datos autorizados…</div>
        ) : !state.data?.items?.length ? (
          <div style={{ padding: 28, color: 'var(--ink-3)' }}>No hay datos para este alcance.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}>
                  <th style={{ padding: '12px 16px' }}>Referencia</th>
                  <th>Detalle</th>
                  <th>Estado</th>
                  <th>Importe</th>
                  <th>Fecha</th>
                  <th aria-label="Acciones" />
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
                          Refund
                        </button>
                      )}
                      {domain === 'inventory' && (
                        <button className="btn" type="button" onClick={() => setInventoryRow(item)}>
                          Operar
                        </button>
                      )}
                      {domain === 'receipts' && item.status !== 'not_printed' && (
                        <button className="btn" type="button" onClick={() => setReceiptRow(item)}>
                          Reimprimir
                        </button>
                      )}
                      {domain === 'loyalty' && (
                        <button className="btn" type="button" onClick={() => setLoyaltyRow(item)}>
                          Ajustar
                        </button>
                      )}
                      {domain === 'gift_cards' && (
                        <button className="btn" type="button" onClick={() => setGiftCardRow(item)}>
                          Emitir
                        </button>
                      )}
                      {domain === 'catalog' && (
                        <button className="btn" type="button" onClick={() => setCatalogRow(item)}>
                          Editar
                        </button>
                      )}
                      {domain === 'registers' && (
                        <button className="btn" type="button" onClick={() => setRegisterRow(item)}>
                          Configurar
                        </button>
                      )}
                      {domain === 'recovery' && (
                        <button className="btn" type="button" onClick={() => setRecoveryRow(item)}>
                          Recuperar
                        </button>
                      )}
                      <button
                        className="btn-icon"
                        type="button"
                        onClick={() => copy(item.correlationId || item.publicReference)}
                        aria-label={`Copiar referencia ${item.publicReference}`}
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
            Anterior
          </button>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            Página {Math.floor(cursor / 20) + 1} · {permissions.length} permisos efectivos
          </span>
          <button
            className="btn"
            type="button"
            disabled={!state.data?.page?.hasMore || state.loading}
            onClick={() => setCursor(Number(state.data.page.nextCursor))}
          >
            Siguiente
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
