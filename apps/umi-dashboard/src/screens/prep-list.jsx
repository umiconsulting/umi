import { useMemo, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { hasRequiredPermission } from '@/lib/module-registry.js';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { downloadPrepListLabels, usePrepList } from '@/data.jsx';
import {
  forecastWindowText,
  labelSheetFilename,
  prepQuantityCell,
  scaledQuantityText,
  sortPrepItems,
} from './prep-model.js';

/**
 * Preparacion - the console's kitchen board for the prep list (recipes module
 * plan 8.4, D13 and 11 Phase 3).
 *
 * The board answers one question: WHAT DO I MAKE. The quantity comes from the
 * server, which subtracts the on-hand and the forecast usage from the par over
 * the shelf-life window, so the screen never repeats that formula. The order is
 * the kitchen's own order: the largest quantity first.
 *
 * The label sheet is a SERVER render (plan D14). The action fetches the PNG and
 * saves it. The browser never lays out a label, because the cafe prints the
 * sheet on the printer it already owns.
 *
 * The tab is reachable with `catalog.read` OR `inventory.read`, but the read and
 * the label route are gated on `merchant.manage`. The permission is checked
 * first, so a cashier's pass never hits a 403.
 */
const MANAGE_GATE = { permissions: ['merchant.manage'] };

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

const PREP_ERROR_COPY = {
  PERMISSION_DENIED: msg`No tienes permiso para administrar el inventario.`,
  VALIDATION_FAILED: msg`Revisa los datos. La API no aceptó la operación.`,
  SERVICE_UNAVAILABLE: msg`El servicio no está disponible. Intenta de nuevo después.`,
};

function errorText(i18n, copy, error) {
  if (!error) return null;
  const known = copy[error.code];
  return known ? i18n._(known) : error.message;
}

/** A named state, not a zero: the item has no par, so there is no work order. */
function NoValue({ children }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 9px',
        borderRadius: 'var(--r-pill)',
        background: 'var(--warning-soft)',
        color: 'var(--warning)',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

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
        <Trans>No puedes administrar la preparación.</Trans>
      </p>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5 }}>
        <Trans>
          Pide a la persona propietaria que te dé el permiso para administrar el negocio.
        </Trans>
      </p>
    </div>
  );
}

export default function PrepListWorkspace() {
  const { t, i18n } = useLingui();
  const merchant = useMerchant();
  const capabilities = merchant?.capabilities || null;
  const canManage = hasRequiredPermission(MANAGE_GATE, capabilities);
  const [refresh, setRefresh] = useState(0);
  const [includeAbovePar, setIncludeAbovePar] = useState(false);
  const [download, setDownload] = useState({ pending: false, error: null });

  const prepState = usePrepList({ includeAbovePar }, refresh);
  const rows = useMemo(() => sortPrepItems(prepState.data.items), [prepState.data.items]);
  const windowText = forecastWindowText(prepState.data.from, prepState.data.to);
  const merchantId = merchant?.selectedMerchantId || capabilities?.merchant?.id || null;
  const locationId = merchant?.selectedLocationId || merchant?.selectedLocation?.id || null;
  const unitOf = (unit) => (UNIT_LABEL[unit] ? i18n._(UNIT_LABEL[unit]) : unit);
  const quantityOf = (quantity) => scaledQuantityText(quantity, unitOf);

  async function printLabels() {
    if (!merchantId || download.pending) return;
    setDownload({ pending: true, error: null });
    try {
      const blob = await downloadPrepListLabels(merchantId, locationId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = labelSheetFilename(new Date());
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Keep the object URL alive until the browser has started the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownload({ pending: false, error: null });
    } catch (error) {
      setDownload({ pending: false, error });
    }
  }

  if (merchant?.loading && !capabilities) {
    return (
      <p className="muted">
        <Trans>Cargando la preparación…</Trans>
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
        <Toggle
          checked={includeAbovePar}
          label={t`Mostrar también los que ya tienen suficiente`}
          onChange={setIncludeAbovePar}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn-icon"
            type="button"
            aria-label={t`Recargar la preparación`}
            title={t`Recargar la preparación`}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <I.Refresh size={15} />
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={printLabels}
            disabled={download.pending || !merchantId}
          >
            <Trans>Imprimir etiquetas</Trans>
          </button>
        </div>
      </div>

      {download.error ? (
        <p style={{ color: 'var(--danger)', margin: 0, fontSize: 12.5 }}>
          {errorText(i18n, PREP_ERROR_COPY, download.error)}
        </p>
      ) : null}

      {windowText ? (
        <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
          {windowText}
        </p>
      ) : null}

      {prepState.loading && !prepState.loaded ? (
        <p className="muted">
          <Trans>Cargando la preparación…</Trans>
        </p>
      ) : prepState.error ? (
        <p style={{ color: 'var(--danger)' }}>
          {errorText(i18n, PREP_ERROR_COPY, {
            code: prepState.errorCode,
            message: prepState.error,
          })}
        </p>
      ) : rows.length === 0 ? (
        <p className="muted">
          <Trans>Aún no hay artículos con par. Define el par en Inventario.</Trans>
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th scope="col" style={HEAD}>
                  <Trans>Artículo</Trans>
                </th>
                <th scope="col" style={HEAD}>
                  <Trans>Unidad</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Par</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Existencia</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Uso previsto</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Cantidad a preparar</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const cell = prepQuantityCell(item);
                const prepText = cell.state === 'quantity' ? quantityOf(cell.quantity) : null;
                const parText = quantityOf(item.parQuantity);
                return (
                  <tr key={item.inventoryItemId} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={CELL}>
                      <div style={{ display: 'grid', gap: 3 }}>
                        <strong style={{ fontWeight: 600 }}>{item.displayName}</strong>
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          {item.publicReference}
                        </span>
                        {item.expiresOn ? (
                          <span className="muted" style={{ fontSize: 11.5 }}>
                            <Trans>Caduca el {item.expiresOn}</Trans>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td style={CELL}>
                      {UNIT_LABEL[item.unit] ? i18n._(UNIT_LABEL[item.unit]) : item.unit}
                    </td>
                    <td style={NUM}>{parText || <span className="muted">·</span>}</td>
                    <td style={NUM}>
                      {quantityOf(item.onHandQuantity) || <span className="muted">·</span>}
                    </td>
                    <td style={NUM}>
                      {quantityOf(item.forecastUsageQuantity) || <span className="muted">·</span>}
                    </td>
                    <td style={NUM}>
                      {cell.state === 'no_par' ? (
                        <NoValue>
                          <Trans>Sin par</Trans>
                        </NoValue>
                      ) : prepText ? (
                        <strong style={{ fontWeight: 600 }}>{prepText}</strong>
                      ) : (
                        <span className="muted">·</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
