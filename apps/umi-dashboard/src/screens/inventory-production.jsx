import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useAdministrativeCommand } from '@/lib/administrative-command.jsx';
import { hasRequiredPermission } from '@/lib/module-registry.js';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { useInventoryItems, useInventoryRecipes } from '@/data.jsx';
import { UNIT_LABEL } from './inventory-copy.js';
import { formatScaled } from './inventory-model.js';
import {
  preparationQuantity,
  preparationSelectionKey,
  preparationPreviewMatches,
  preparationRecipes,
} from './inventory-production-model.js';

const ERROR_COPY = {
  INVENTORY_PREPARATION_CHANGED: msg`La receta cambió. Revisa de nuevo los ingredientes antes de confirmar.`,
  INVENTORY_QUANTITY_NOT_EXACT: msg`Esta cantidad no permite medir los ingredientes con exactitud. Elige otra cantidad.`,
  INVENTORY_PRODUCTION_QUANTITY_INVALID: msg`Revisa la cantidad que quieres preparar.`,
  INVENTORY_UNIT_CONVERSION_REQUIRED: msg`Falta una conversión de unidades. Revisa el artículo y su receta.`,
  INVENTORY_LOCATION_INVALID: msg`El almacén ya no está disponible. Cierra y vuelve a abrir la preparación.`,
  INVENTORY_RECIPE_REQUIRED: msg`El artículo ya no tiene una receta activa. Actualiza la lista.`,
  INVENTORY_ITEM_ARCHIVED: msg`El artículo está archivado. Elige otro artículo.`,
  NEGATIVE_STOCK_BLOCKED: msg`No hay ingredientes suficientes. Registra su entrada antes de preparar.`,
  NEGATIVE_STOCK_APPROVAL_REQUIRED: msg`Esta preparación necesita aprobación por falta de ingredientes. Pide ayuda a la persona responsable.`,
  RATE_LIMITED: msg`Espera un momento antes de intentar de nuevo.`,
  PERMISSION_DENIED: msg`No tienes permiso para registrar preparaciones.`,
  SERVICE_UNAVAILABLE: msg`El servicio no está disponible. Intenta de nuevo después.`,
};

export default function InventoryProduction({ recipe = null, locationId, onClose, onDone }) {
  const { t, i18n } = useLingui();
  const merchant = useMerchant();
  const command = useAdministrativeCommand();
  const overviewCommand = useAdministrativeCommand();
  const executeOverview = overviewCommand.execute;
  const canProduce = hasRequiredPermission(
    { permissions: ['inventory.production.produce'] },
    merchant?.capabilities,
  );
  const itemsState = useInventoryItems({ includeArchived: false });
  const recipesState = useInventoryRecipes({ includeRetired: false });
  const options = preparationRecipes(recipesState.data.recipes, itemsState.data.items);
  const [itemId, setItemId] = useState(recipe?.targetItemId || '');
  const [amount, setAmount] = useState('');
  const [inventoryLocationId, setInventoryLocationId] = useState('');
  const [areas, setAreas] = useState(null);
  const [readError, setReadError] = useState(null);
  const [error, setError] = useState(null);
  const [reviewed, setReviewed] = useState(null);
  const [unresolved, setUnresolved] = useState(null);
  const [result, setResult] = useState(null);
  const busy = useRef(false);
  const overviewRequest = useRef(null);
  const dialogRef = useRef(null);
  const item = options.find((option) => option.item.id === itemId)?.item;
  const quantity = preparationQuantity(amount, item);
  const selection = { itemId, locationId, inventoryLocationId, quantity };
  const selectionKey = preparationSelectionKey(selection);
  const selectionRef = useRef(selectionKey);
  useEffect(() => {
    selectionRef.current = selectionKey;
  }, [selectionKey]);
  const preview = preparationPreviewMatches(reviewed, selection) ? reviewed.result : null;
  const frozen = command.pending || Boolean(unresolved);
  const unitOf = (unit) => (UNIT_LABEL[unit] ? i18n._(UNIT_LABEL[unit]) : unit);
  const quantityOf = (value) => `${formatScaled(value.value, value.scale)} ${unitOf(value.unit)}`;
  const messageOf = (cause) =>
    ERROR_COPY[cause?.code]
      ? i18n._(ERROR_COPY[cause.code])
      : t`No se pudo completar la operación. Intenta de nuevo.`;

  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();
    const trap = (event) => {
      if (event.key !== 'Tab') return;
      const controls = [
        ...dialog.querySelectorAll(
          // eslint-disable-next-line lingui/no-unlocalized-strings
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      ];
      const first = controls[0];
      const last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog?.addEventListener('keydown', trap);
    return () => {
      dialog?.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    if (!locationId || !canProduce) return;
    let alive = true;
    if (
      overviewRequest.current?.locationId !== locationId ||
      overviewRequest.current?.execute !== executeOverview
    ) {
      overviewRequest.current = {
        locationId,
        execute: executeOverview,
        promise: executeOverview('inventory.overview', locationId, {
          locationId,
          parameters: { limit: 100 },
        }),
      };
    }
    overviewRequest.current.promise
      .then((response) => {
        if (!alive) return;
        const locations = (response.result.locations || []).filter((area) => area.active !== false);
        setAreas(locations);
        setInventoryLocationId(locations.length === 1 ? locations[0].id : '');
      })
      .catch((cause) => {
        if (alive) setReadError(cause);
      });
    return () => {
      alive = false;
    };
  }, [locationId, canProduce, executeOverview]);

  function invalidate(update) {
    setReviewed(null);
    setError(null);
    command.reset();
    update();
  }

  async function review() {
    if (busy.current || frozen || !quantity || !inventoryLocationId || !locationId) return;
    busy.current = true;
    setError(null);
    setReviewed(null);
    try {
      const response = await command.execute('inventory.production.preview', itemId, {
        commandId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        locationId,
        parameters: { inventoryLocationId, quantity },
      });
      if (selectionRef.current === selectionKey)
        setReviewed({ selectionKey, result: response.result });
    } catch (cause) {
      setError(cause);
    } finally {
      busy.current = false;
    }
  }

  async function confirm() {
    if (busy.current || (!preview && !unresolved)) return;
    const request = unresolved || {
      target: preview.outputItemId,
      options: {
        locationId,
        parameters: {
          inventoryLocationId: preview.inventoryLocationId,
          quantity: preview.plannedQuantity,
          plannedQuantity: preview.plannedQuantity,
          recipeFingerprint: preview.recipeFingerprint,
        },
      },
    };
    busy.current = true;
    setError(null);
    try {
      const response = await command.execute(
        'inventory.production.produce',
        request.target,
        request.options,
      );
      setUnresolved(null);
      setResult(response.result);
      onDone();
    } catch (cause) {
      setError(cause);
      if (!cause?.status || cause.status >= 500) setUnresolved(request);
      else {
        setUnresolved(null);
        if (
          cause.code === 'INVENTORY_PREPARATION_CHANGED' ||
          cause.code === 'INVENTORY_RECIPE_REQUIRED'
        )
          setReviewed(null);
      }
    } finally {
      busy.current = false;
    }
  }

  const loading = itemsState.loading || recipesState.loading;
  const failedRead = readError || itemsState.error || recipesState.error;
  return createPortal(
    <div className="sheet-backdrop" style={{ zIndex: 1000 }}>
      <section
        ref={dialogRef}
        className="sheet"
        style={{ width: 520, maxWidth: '100vw' }}
        role="dialog"
        aria-modal="true"
        aria-label={t`Nueva preparación`}
        tabIndex={-1}
      >
        <div className="sheet-head">
          <h3 style={{ margin: 0 }}>
            <Trans>Nueva preparación</Trans>
          </h3>
        </div>
        <div className="sheet-body">
          {result ? (
            <div role="status" style={{ overflowWrap: 'anywhere' }}>
              <p>
                <Trans>Preparación registrada: {quantityOf(result.producedQuantity)}.</Trans>
              </p>
              <p>
                <Trans>Lote: {result.lotReference}</Trans>
              </p>
            </div>
          ) : !canProduce ? (
            <p role="alert">
              <Trans>No tienes permiso para registrar preparaciones.</Trans>
            </p>
          ) : !locationId ? (
            <p role="alert">
              <Trans>Elige una sucursal para registrar una preparación.</Trans>
            </p>
          ) : failedRead ? (
            <p role="alert">
              <Trans>
                No se pudieron cargar los artículos, las recetas o los almacenes. Cierra y vuelve a
                intentar.
              </Trans>
            </p>
          ) : loading || !areas ? (
            <p>
              <Trans>Cargando la preparación…</Trans>
            </p>
          ) : !areas.length ? (
            <p role="alert">
              <Trans>
                No hay un almacén activo en esta sucursal. Pide a la persona responsable que lo
                configure.
              </Trans>
            </p>
          ) : !options.length ? (
            <p role="status">
              <Trans>
                No hay artículos activos con receta para preparar. Crea una receta de artículo en
                Recetas.
              </Trans>
            </p>
          ) : (
            <>
              <label className="field">
                <span className="field-label">
                  <Trans>Artículo a preparar</Trans>
                </span>
                <select
                  className="input"
                  aria-label={t`Artículo a preparar`}
                  value={itemId}
                  disabled={frozen}
                  onChange={(event) => invalidate(() => setItemId(event.target.value))}
                >
                  <option value="">{t`Elige un artículo`}</option>
                  {options.map(({ recipe: option, item: output }) => (
                    <option key={option.id} value={output.id}>
                      {output.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">
                  <Trans>Almacén</Trans>
                </span>
                <select
                  className="input"
                  aria-label={t`Almacén`}
                  value={inventoryLocationId}
                  disabled={frozen}
                  onChange={(event) => invalidate(() => setInventoryLocationId(event.target.value))}
                >
                  <option value="">{t`Elige un almacén`}</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.displayName || area.publicReference}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">
                  <Trans>Cantidad a preparar</Trans>
                </span>
                <input
                  className="input"
                  aria-label={t`Cantidad a preparar`}
                  inputMode="decimal"
                  value={amount}
                  disabled={frozen || !item}
                  onChange={(event) => invalidate(() => setAmount(event.target.value))}
                />
              </label>
              {item ? (
                <p style={{ margin: 0 }}>
                  <Trans>Unidad: {unitOf(item.baseUnit)}</Trans>
                </p>
              ) : null}
              {item && amount && !quantity ? (
                <p role="alert">
                  <Trans>
                    Escribe una cantidad mayor que cero con los decimales del artículo, sin
                    redondear.
                  </Trans>
                </p>
              ) : null}
              {preview ? (
                <section aria-label={t`Ingredientes revisados`}>
                  <h4>
                    <Trans>Ingredientes para {quantityOf(preview.plannedQuantity)}</Trans>
                  </h4>
                  <ul style={{ paddingLeft: 20, overflowWrap: 'anywhere' }}>
                    {preview.consumed.map((line) => (
                      <li key={line.inventoryItemId}>
                        {line.displayName}: {quantityOf(line.quantity)}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {unresolved ? (
                <p role="alert">
                  <Trans>
                    No pudimos confirmar el resultado. Reintenta para consultar la misma preparación
                    antes de salir.
                  </Trans>
                </p>
              ) : null}
              {error ? (
                <p role="alert" style={{ color: 'var(--danger)' }}>
                  {messageOf(error)}
                </p>
              ) : null}
            </>
          )}
        </div>
        <div className="sheet-foot" style={{ flexWrap: 'wrap', padding: 16 }}>
          <button className="btn btn-secondary" type="button" disabled={frozen} onClick={onClose}>
            {result ? <Trans>Cerrar</Trans> : <Trans>Cancelar</Trans>}
          </button>
          {!result && canProduce && !failedRead ? (
            unresolved ? (
              <button
                className="btn btn-primary"
                type="button"
                disabled={command.pending}
                onClick={confirm}
              >
                <Trans>Reintentar preparación</Trans>
              </button>
            ) : preview ? (
              <button
                className="btn btn-primary"
                type="button"
                disabled={command.pending}
                onClick={confirm}
              >
                <Trans>Confirmar preparación</Trans>
              </button>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                disabled={
                  command.pending || !quantity || !inventoryLocationId || !locationId || loading
                }
                onClick={review}
              >
                <Trans>Revisar ingredientes</Trans>
              </button>
            )
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
