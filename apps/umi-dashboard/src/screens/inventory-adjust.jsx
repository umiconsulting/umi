import { useEffect, useRef, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { Select } from '@/components/select.jsx';
import { useAdministrativeCommand } from '@/lib/administrative-command.jsx';
import { adjustmentBalance, adjustmentDelta } from './inventory-model.js';
import { UNIT_LABEL } from './inventory-copy.js';

/**
 * The stock adjustment sheet (redesign plan D10).
 *
 * Square ships this exact shape: one item, one number, one reason, one button.
 * A routine adjustment touches one item, so a multi-row form would be a table the
 * operator has to fill in to do one thing.
 *
 * The writes go through the SAME pipeline the operations browser already uses:
 * `inventory.overview` reads the balance and the policy fingerprint, `inventory.preview`
 * computes the approval requirement, and the approved command commits. Nothing here
 * invents a route.
 */

const REASON_LABEL = {
  count_correction: msg`Corrección de conteo`,
  expired: msg`Caducado`,
  damaged: msg`Dañado`,
  spillage: msg`Derrame`,
  theft: msg`Robo`,
};

/** The reasons the adjustment command accepts, in the order the select shows them. */
const REASONS = ['count_correction', 'expired', 'damaged', 'spillage', 'theft'];

export default function InventoryAdjustSheet({ item, locationId, onClose, onDone }) {
  const { t, i18n } = useLingui();
  const command = useAdministrativeCommand();
  const execute = command.execute;
  const overviewRequest = useRef(null);

  const [overview, setOverview] = useState(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('count_correction');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * The read runs when the sheet opens. The result lands in a promise callback and
   * not in the effect body, so React does not re-render twice before the network
   * answers. `alive` stops a late answer from writing to an unmounted sheet.
   */
  useEffect(() => {
    let alive = true;
    // StrictMode repite el efecto. Ambas ejecuciones comparten una sola lectura.
    if (
      overviewRequest.current?.itemId !== item.id ||
      overviewRequest.current?.locationId !== locationId ||
      overviewRequest.current?.execute !== execute
    ) {
      overviewRequest.current = {
        itemId: item.id,
        locationId,
        execute,
        promise: execute('inventory.overview', item.id, {
          parameters: { itemId: item.id, limit: 100 },
        }),
      };
    }
    overviewRequest.current.promise
      .then((response) => {
        if (alive) {
          const balance = adjustmentBalance(response.result, item.id, locationId);
          setOverview(response.result);
          setAmount(balance?.text ?? '');
          if (!balance) setMessage(t`No se pudo leer la existencia.`);
        }
      })
      .catch((error) => {
        if (alive) setMessage(error?.message || t`No se pudo leer la existencia.`);
      });
    return () => {
      alive = false;
    };
  }, [execute, item.id, locationId, t]);

  const current = adjustmentBalance(overview, item.id, locationId);
  const delta = adjustmentDelta(amount, current);
  const valid = delta !== null;
  const changed = valid && delta.quantity.value > 0;
  const baseUnit = current?.unit ?? item.baseUnit;
  const unit = UNIT_LABEL[baseUnit] ? i18n._(UNIT_LABEL[baseUnit]) : baseUnit;

  async function submit() {
    if (!overview || !valid || !changed) return;
    setBusy(true);
    setMessage('');
    try {
      const common = {
        inventoryLocationId: current.inventoryLocationId,
        expectedVersion: delta.expectedVersion,
        policyFingerprint: overview.policy.fingerprint,
        approvalFingerprint: null,
        businessDate: new Date().toISOString().slice(0, 10),
      };
      const body = {
        ...common,
        direction: delta.direction,
        quantity: delta.quantity,
        reason,
        note: note.trim() || null,
      };
      const identity = { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
      const preview = await command.execute('inventory.preview', item.id, {
        parameters: {
          mutationOperation: 'inventory.adjustment',
          mutationCommandId: identity.commandId,
          mutationIdempotencyKey: identity.idempotencyKey,
          command: body,
        },
      });
      await command.executeApprovedCommand({
        approvalOperation: preview.result.approvalRequired ? 'inventory.adjustment.approval' : null,
        approvalParameters: {
          commandFingerprint: preview.result.commandFingerprint,
          approvalPermission: preview.result.approvalPermission,
        },
        commitOperation: 'inventory.adjustment',
        commitOptions: {
          ...identity,
          parameters: {
            ...body,
            approvalFingerprint: preview.result.approvalRequired
              ? preview.result.commandFingerprint
              : null,
          },
        },
        managerPin: pin,
        targetAggregateId: item.id,
      });
      await onDone();
    } catch (error) {
      setMessage(error?.message || t`No se pudo ajustar la existencia.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t`Ajustar existencia`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <h3 style={{ margin: 0, fontSize: 16 }}>
            <Trans>Ajustar existencia</Trans>
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label={t`Cerrar`}
          >
            <I.X size={16} />
          </button>
        </div>

        <div className="sheet-body">
          <div>
            <div className="inv-panel-title">{item.displayName}</div>
            <div className="inv-panel-sub">{item.publicReference}</div>
          </div>

          <dl className="inv-kv">
            <dt>
              <Trans>Existencia actual</Trans>
            </dt>
            <dd>{current ? `${current.text} ${unit}` : t`sin registro`}</dd>
          </dl>

          <label className="field">
            <span className="field-label">
              <Trans>Nueva existencia contada</Trans>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                className="input inv-num"
                style={{ flex: 1 }}
                inputMode="decimal"
                disabled={!current}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label={t`Nueva existencia contada`}
              />
              <span className="inv-count-unit">{unit}</span>
            </div>
          </label>

          <label className="field">
            <span className="field-label">
              <Trans>Motivo</Trans>
            </span>
            <Select
              value={reason}
              aria-label={t`Motivo`}
              onChange={(event) => setReason(event.target.value)}
            >
              {REASONS.map((code) => (
                <option key={code} value={code}>
                  {REASON_LABEL[code] ? i18n._(REASON_LABEL[code]) : code}
                </option>
              ))}
            </Select>
          </label>

          <label className="field">
            <span className="field-label">
              <Trans>Nota</Trans>
            </span>
            <input
              className="input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-label={t`Nota`}
            />
          </label>

          <label className="field">
            <span className="field-label">
              <Trans>PIN del aprobador, si la política lo pide</Trans>
            </span>
            <input
              className="input"
              type="password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              aria-label={t`PIN del aprobador`}
            />
          </label>

          {message ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{message}</p>
          ) : null}
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            <Trans>Cancelar</Trans>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !valid || !changed || !overview}
            onClick={submit}
          >
            <Trans>Guardar ajuste</Trans>
          </button>
        </div>
      </section>
    </div>
  );
}
