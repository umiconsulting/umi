import { useCallback, useEffect, useRef, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { useAdministrativeCommand } from '@/lib/administrative-command.jsx';
import { UNIT_LABEL } from './inventory-copy.js';
import {
  QUICK_LEVELS,
  applyAreaAssignments,
  areaById,
  countFor,
  countedItemIdsInArea,
  countedLinesInArea,
  createDraft,
  currentItem,
  deserialise,
  entryFor,
  itemsInScope,
  moveToItem,
  nextItemId,
  position,
  previousItemId,
  recordCount,
  selectArea,
  serialise,
  setCount,
  setStep,
  storageKey,
  summary,
} from './inventory-count-model.js';

/**
 * The count session (redesign plan D9, phase 2.2).
 *
 * THE RULE. A count is a session, not a grid. The person picks the areas, counts
 * ONE item at a time, and reviews the result. WISK ships this model on a phone
 * and Partender ships one bottle per screen, because the count happens in a
 * walk-in fridge and not at a desk.
 *
 * THE BLIND RULE. The count screen shows no system amount. The console reads the
 * balances when the person opens the summary and not before. A person who sees
 * the expected number types that number back.
 *
 * THE COMMANDS. The four calls copy `InventoryDialog` in operations-workspace.jsx:
 * `inventory.overview`, `inventory.count.create`, `inventory.count.submit`, and
 * the approved `inventory.count.reconcile`. This screen invents no route.
 */

const AREA_TYPE_LABEL = {
  business_location: msg`Sucursal`,
  stock_room: msg`Almacén`,
  kitchen_storage: msg`Almacén de cocina`,
  bar_storage: msg`Almacén de barra`,
  quarantine: msg`Cuarentena`,
  operational_sub_location: msg`Subzona`,
};

const STEP_LABEL = {
  areas: msg`Áreas`,
  count: msg`Conteo`,
  // The bare word "Resumen" is the Overview nav item in the catalog. The longer
  // message keeps one word for one meaning on this screen.
  summary: msg`Resumen del conteo`,
};

/** The quick level buttons. A fraction of one base unit. */
const LEVEL_LABEL = {
  0: msg`0`,
  0.25: msg`¼`,
  0.5: msg`½`,
  0.75: msg`¾`,
  1: msg`1`,
};

/** The word that follows the delta. A colour alone is not a signal. */
const DELTA_LABEL = {
  short: msg`Falta`,
  over: msg`Sobra`,
  even: msg`Igual`,
  unknown: msg`Sin lectura`,
};

function readStoredDraft(locationId) {
  try {
    return deserialise(window.sessionStorage.getItem(storageKey(locationId)));
  } catch {
    // A private window can refuse the read. The session then starts again.
    return null;
  }
}

function writeStoredDraft(locationId, draft) {
  try {
    window.sessionStorage.setItem(storageKey(locationId), serialise(draft));
  } catch {
    // A private window can refuse the write. The session still lives in memory.
  }
}

function clearStoredDraft(locationId) {
  try {
    window.sessionStorage.removeItem(storageKey(locationId));
  } catch {
    // A refused remove is not a failure of the count.
  }
}

function areaOptions(result) {
  return (result?.locations || [])
    .filter((location) => location && location.active !== false)
    .map((location) => ({
      id: location.id,
      name: location.displayName || location.publicReference || '',
      type: location.type || null,
      eligible: location.countEligible !== false,
    }));
}

function itemOptions(result) {
  return (result?.items || []).map((item) => ({
    id: item.id,
    name: item.displayName || item.publicReference || '',
    unit: item.baseUnit,
    scale: item.scale,
  }));
}

export default function InventoryCount({ locationId, onClose, onDone }) {
  const { t, i18n } = useLingui();
  const command = useAdministrativeCommand();
  const commandRef = useRef(command);
  const started = useRef(false);

  // A stored draft resumes at the same step and the same item. The session is the
  // unit of work, so the state comes from the store before the first render.
  const [seeded] = useState(() => {
    const stored = readStoredDraft(locationId);
    return { stored, loaded: Boolean(stored) };
  });
  const [draft, setDraft] = useState(seeded.stored);
  const [reveal, setReveal] = useState(null);
  const [loaded, setLoaded] = useState(seeded.loaded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pin, setPin] = useState('');
  const [truncated, setTruncated] = useState(false);

  // The command handle is a new object on every render. The ref keeps the first
  // effect from a re-read loop, and the effect below updates it before any use.
  useEffect(() => {
    commandRef.current = command;
  });

  const loadAreas = useCallback(async () => {
    try {
      const response = await commandRef.current.execute('inventory.overview', locationId, {
        parameters: { limit: 100 },
      });
      const result = response.result || {};
      setDraft(createDraft({ locationId, areas: areaOptions(result), items: itemOptions(result) }));
      setTruncated(Boolean(result.page?.hasMore));
      setError('');
    } catch (cause) {
      setError(cause?.message || t`No se pudo leer el inventario.`);
    } finally {
      setLoaded(true);
    }
  }, [locationId, t]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (seeded.stored) return;
    loadAreas();
  }, [seeded, loadAreas]);

  useEffect(() => {
    if (!draft) return;
    writeStoredDraft(locationId, draft);
  }, [draft, locationId]);

  const unitText = useCallback(
    (unit) => (UNIT_LABEL[unit] ? i18n._(UNIT_LABEL[unit]) : unit),
    [i18n],
  );

  function close() {
    onClose?.();
  }

  function cancel() {
    clearStoredDraft(locationId);
    onClose?.();
  }

  async function readArea(areaId) {
    const response = await commandRef.current.execute('inventory.overview', areaId, {
      parameters: { inventoryLocationId: areaId, limit: 100 },
    });
    return response.result || {};
  }

  /**
   * Step 1 to step 2. The console reads the balances of each chosen area here and
   * keeps ONLY the item list and the area of each item. The amounts do not leave
   * this function, so the count step cannot show them.
   */
  async function startCounting() {
    if (!draft || busy) return;
    const chosen = draft.selectedAreaIds.filter((id) => areaById(draft, id)?.eligible !== false);
    if (chosen.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const assignments = [];
      for (const areaId of chosen) {
        const result = await readArea(areaId);
        const byId = new Map((result.items || []).map((item) => [item.id, item]));
        for (const balance of result.balances || []) {
          const item = byId.get(balance.inventoryItemId);
          if (!item) continue;
          assignments.push({
            id: item.id,
            name: item.displayName || item.publicReference || '',
            unit: item.baseUnit,
            scale: item.scale,
            areaId,
          });
        }
        if (result.page?.hasMore) setTruncated(true);
      }
      const next = applyAreaAssignments(draft, assignments);
      if (itemsInScope(next).length === 0) {
        setError(t`Las áreas elegidas no tienen artículos con existencia.`);
        return;
      }
      setDraft(setStep(next, 'count'));
    } catch (cause) {
      setError(cause?.message || t`No se pudo leer el inventario.`);
    } finally {
      setBusy(false);
    }
  }

  /** Step 2 to step 3. This is the one moment that the system amount arrives. */
  async function openSummary() {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    try {
      const onHand = {};
      for (const areaId of draft.selectedAreaIds) {
        const result = await readArea(areaId);
        for (const balance of result.balances || []) {
          if (Object.prototype.hasOwnProperty.call(onHand, balance.inventoryItemId)) continue;
          onHand[balance.inventoryItemId] = balance.onHand;
        }
      }
      setReveal(onHand);
      setDraft(setStep(draft, 'summary'));
    } catch (cause) {
      setError(cause?.message || t`No se pudo leer la existencia del sistema.`);
    } finally {
      setBusy(false);
    }
  }

  function backToOneItem() {
    setReveal(null);
    setDraft((current) => setStep(current, 'count'));
  }

  function editItem(itemId) {
    setReveal(null);
    setDraft((current) => moveToItem(setStep(current, 'count'), itemId));
  }

  function press(key) {
    const item = currentItem(draft);
    if (!item) return;
    const text = draft.entries[item.id] ?? '';
    if (key === 'back') {
      setDraft((current) => setCount(current, item.id, text.slice(0, -1)));
      return;
    }
    if (key === '.' && text.includes('.')) return;
    if (text === '0' && key !== '.') {
      setDraft((current) => setCount(current, item.id, key));
      return;
    }
    if (text.length >= 12) return;
    setDraft((current) => setCount(current, item.id, `${text}${key}`));
  }

  function setLevel(value) {
    const item = currentItem(draft);
    if (!item) return;
    setDraft((current) => setCount(current, item.id, String(value)));
  }

  function goToNextItem() {
    const next = nextItemId(draft);
    if (next === null) return;
    setDraft((current) => moveToItem(current, next));
  }

  function goToPreviousItem() {
    const previous = previousItemId(draft);
    if (previous === null) {
      setDraft((current) => setStep(current, 'areas'));
      return;
    }
    setDraft((current) => moveToItem(current, previous));
  }

  /** The reconcile step. The reasons come from the variances of the submit. */
  async function reconcileCount(areaId, location, overview, count, variances) {
    const reasons = {};
    for (const variance of variances) {
      const absolute = Number(variance?.absolute ?? 0);
      if (absolute > 0) reasons[variance.inventoryItemId] = 'physical_count';
    }
    const identity = { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    const body = {
      inventoryLocationId: areaId,
      expectedVersion: location.version,
      policyFingerprint: overview.policy.fingerprint,
      approvalFingerprint: null,
      businessDate: new Date().toISOString().slice(0, 10),
      countId: count.id,
      countAttempt: count.attempt,
      snapshotLedgerSequence: count.snapshotLedgerSequence,
      reasons,
    };
    const preview = await commandRef.current.execute('inventory.preview', count.id, {
      parameters: {
        mutationOperation: 'inventory.count.reconcile',
        mutationCommandId: identity.commandId,
        mutationIdempotencyKey: identity.idempotencyKey,
        command: body,
      },
    });
    await commandRef.current.executeApprovedCommand({
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
      managerPin: pin,
      targetAggregateId: count.id,
    });
  }

  /**
   * The four calls, one time per area with a counted line. A count is scoped to
   * the lines of ONE area, so the loop keeps the server contract exact.
   */
  async function send() {
    if (!draft || busy) return;
    const groups = draft.selectedAreaIds
      .map((areaId) => ({
        areaId,
        itemIds: countedItemIdsInArea(draft, areaId),
        lines: countedLinesInArea(draft, areaId),
      }))
      .filter((group) => group.lines.length > 0);
    if (groups.length === 0) return;
    setBusy(true);
    setError('');
    let working = draft;
    try {
      for (const group of groups) {
        const overview = await readArea(group.areaId);
        const location = (overview.locations || []).find((value) => value.id === group.areaId);
        if (!location) throw new Error(t`El área ya no está disponible.`);
        const businessDate = new Date().toISOString().slice(0, 10);
        let count = countFor(working, group.areaId);
        if (count && count.phase === 'done') continue;
        let variances = count ? count.variances : [];
        if (!count) {
          // One count can be open for one area. The database refuses a second one,
          // so the screen continues the open count instead of creating a duplicate.
          const active = overview.activeCount;
          const openCount = active?.count;
          if (openCount && openCount.status === 'counting') {
            count = { ...openCount, phase: 'created' };
            working = recordCount(working, group.areaId, count);
            setDraft(working);
          } else if (openCount && openCount.status === 'reconciliation_required') {
            count = { ...openCount, phase: 'submitted', variances: active.variances || [] };
            working = recordCount(working, group.areaId, count);
            variances = countFor(working, group.areaId).variances;
            setDraft(working);
          }
        }
        if (!count) {
          const created = await commandRef.current.execute('inventory.count.create', group.areaId, {
            targetVersion: location.version,
            parameters: {
              inventoryLocationId: group.areaId,
              expectedVersion: location.version,
              policyFingerprint: overview.policy.fingerprint,
              approvalFingerprint: null,
              businessDate,
              scope: 'selected_items',
              itemIds: group.itemIds,
            },
          });
          count = { ...created.result.count, phase: 'created' };
          working = recordCount(working, group.areaId, count);
          setDraft(working);
        }
        // A retry after a dropped answer must not submit the same count twice.
        if (count.phase !== 'submitted') {
          const submitted = await commandRef.current.execute('inventory.count.submit', count.id, {
            parameters: {
              inventoryLocationId: group.areaId,
              expectedVersion: location.version,
              policyFingerprint: overview.policy.fingerprint,
              approvalFingerprint: null,
              businessDate,
              countId: count.id,
              attempt: count.attempt,
              snapshotLedgerSequence: count.snapshotLedgerSequence,
              lines: group.lines,
            },
          });
          variances = Array.isArray(submitted.result?.variances) ? submitted.result.variances : [];
          count = { ...count, phase: 'submitted', variances };
          working = recordCount(working, group.areaId, count);
          // Read the stored shape back. It is the one the reconcile reads, and a
          // retry after a reload must use the same numbers.
          variances = countFor(working, group.areaId).variances;
          setDraft(working);
        }
        await reconcileCount(group.areaId, location, overview, count, variances);
        working = recordCount(working, group.areaId, { ...count, phase: 'done' });
        setDraft(working);
      }
      clearStoredDraft(locationId);
      onDone?.();
      onClose?.();
    } catch (cause) {
      setError(cause?.message || t`No se pudo enviar el conteo.`);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="inv-row-note">
          <Trans>Cargando el inventario…</Trans>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{error}</p>
        <div className="inv-session-foot">
          <button type="button" className="btn btn-ghost" onClick={close}>
            <Trans>Cancelar</Trans>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              loadAreas().finally(() => setBusy(false));
            }}
          >
            <I.Refresh size={16} />
            <Trans>Reintentar</Trans>
          </button>
        </div>
      </div>
    );
  }

  const at = position(draft);
  const item = currentItem(draft);
  const result = summary(draft, reveal || {});

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="inv-panel-title">
            <Trans>Contar stock</Trans>
          </div>
          <div className="inv-step" aria-label={t`Pasos del conteo`}>
            {['areas', 'count', 'summary'].map((key, index) => (
              <span key={key} data-active={draft.step === key}>
                {index + 1} {i18n._(STEP_LABEL[key])}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={cancel}
          aria-label={t`Cerrar`}
        >
          <I.X size={16} />
        </button>
      </div>

      {truncated ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)' }}>
          <Trans>El conteo cubre los primeros 100 artículos de la lista.</Trans>
        </p>
      ) : null}

      {/* ---------- 1. the areas ---------- */}
      {draft.step === 'areas' ? (
        <>
          <div className="inv-areas">
            {draft.areas.map((area) => (
              <button
                key={area.id}
                type="button"
                className="inv-area"
                aria-pressed={draft.selectedAreaIds.includes(area.id)}
                disabled={!area.eligible}
                onClick={() => setDraft((current) => selectArea(current, area.id))}
              >
                <span className="inv-area-name">{area.name}</span>
                <span className="inv-area-note">
                  {area.eligible
                    ? i18n._(AREA_TYPE_LABEL[area.type] || AREA_TYPE_LABEL.stock_room)
                    : t`Sin permiso para contar`}
                </span>
              </button>
            ))}
          </div>
          <div className="inv-session-foot">
            <button type="button" className="btn btn-ghost" onClick={cancel}>
              <Trans>Cancelar</Trans>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || draft.selectedAreaIds.length === 0}
              onClick={startCounting}
            >
              <Trans>Siguiente</Trans>
              <I.ArrowRight size={16} />
            </button>
          </div>
        </>
      ) : null}

      {/* ---------- 2. one item at a time ---------- */}
      {draft.step === 'count' && item ? (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 12,
            }}
          >
            <div>
              <div className="inv-panel-title">{item.name}</div>
              <div className="inv-panel-sub">{areaById(draft, item.areaId)?.name}</div>
            </div>
            <div className="inv-num" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              <Trans>
                {at.index} de {at.total}
              </Trans>
            </div>
          </div>

          <div className="inv-count-figure">
            <span className="inv-count-value">
              {(draft.entries[item.id] ?? '') === '' ? '0' : draft.entries[item.id]}
            </span>
            <span className="inv-count-unit">{unitText(item.unit)}</span>
          </div>

          {entryFor(draft, item.id) && !entryFor(draft, item.id).valid ? (
            <p style={{ margin: 0, textAlign: 'center', fontSize: 12.5, color: 'var(--warning)' }}>
              <Trans>La cantidad tiene más decimales de los que la unidad admite.</Trans>
            </p>
          ) : null}

          <p
            style={{
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontSize: 12.5,
              color: 'var(--ink-3)',
            }}
          >
            <I.EyeOff size={15} />
            <Trans>Conteo ciego. La existencia del sistema aparece al enviar.</Trans>
          </p>

          <div className="inv-levels">
            {QUICK_LEVELS.filter((value) => Number.isInteger(value * 10 ** item.scale)).map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setLevel(value)}
                >
                  {i18n._(LEVEL_LABEL[String(value)])}
                </button>
              ),
            )}
          </div>

          <div className="inv-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map((key) => (
              <button
                key={key}
                type="button"
                className="inv-key"
                aria-label={key === '.' ? t`Punto decimal` : key}
                onClick={() => press(key)}
              >
                {key}
              </button>
            ))}
            <button
              type="button"
              className="inv-key"
              aria-label={t`Borrar el último dígito`}
              onClick={() => press('back')}
            >
              <I.X size={18} />
            </button>
          </div>

          <div className="inv-session-foot">
            <button type="button" className="btn btn-secondary" onClick={goToPreviousItem}>
              <I.ChevronLeft size={16} />
              <Trans>Atrás</Trans>
            </button>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={nextItemId(draft) === null}
                onClick={goToNextItem}
              >
                <Trans>Siguiente</Trans>
                <I.ArrowRight size={16} />
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={openSummary}
              >
                <Trans>Resumen ({result.countedCount})</Trans>
              </button>
            </div>
          </div>
        </>
      ) : null}

      {/* ---------- 3. the summary ------------------------------- */}
      {draft.step === 'summary' ? (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="inv-num" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              <Trans>
                Contado: {result.countedCount} de {result.totalCount}
              </Trans>
            </div>
          </div>

          <div className="inv-list">
            {result.lines.map((line) => (
              <div key={line.itemId} className="inv-row" style={{ cursor: 'default' }}>
                <span
                  className="inv-dot"
                  data-state={
                    line.delta === null || line.delta === 0
                      ? 'unknown'
                      : line.delta < 0
                        ? 'out'
                        : 'low'
                  }
                />
                <span className="inv-row-main">
                  <span className="inv-row-name">{line.name}</span>
                  <span className="inv-row-meta">{line.areaName}</span>
                </span>
                <span className="inv-row-value">
                  <span className="inv-row-figure">
                    {line.systemText === null ? '—' : line.systemText}
                  </span>
                  <span className="inv-row-note">
                    {'→'} {line.countedText} {unitText(line.unit)}
                  </span>
                </span>
                <span className="inv-row-value">
                  <span className="inv-row-figure">
                    {line.deltaText === null
                      ? '—'
                      : line.delta > 0
                        ? `+${line.deltaText}`
                        : line.deltaText}
                  </span>
                  <span className="inv-row-note">
                    {line.delta === null
                      ? i18n._(DELTA_LABEL.unknown)
                      : line.delta < 0
                        ? i18n._(DELTA_LABEL.short)
                        : line.delta > 0
                          ? i18n._(DELTA_LABEL.over)
                          : i18n._(DELTA_LABEL.even)}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {result.uncountedCount > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)' }}>
                <Trans>{result.uncountedCount} artículos sin contar. No entran en el conteo.</Trans>
              </p>
              <div className="inv-list">
                {result.uncounted.slice(0, 8).map((row) => (
                  <div key={row.itemId} className="inv-row">
                    <span className="inv-dot" data-state="unknown" />
                    <span className="inv-row-main">
                      <span className="inv-row-name">{row.name}</span>
                      <span className="inv-row-meta">
                        {row.areaName}
                        {row.invalid ? <Trans> · Cantidad no válida</Trans> : null}
                      </span>
                    </span>
                    <span className="inv-row-value" />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => editItem(row.itemId)}
                    >
                      <Trans>Contar</Trans>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{error}</p>
          ) : null}

          <div className="inv-session-foot">
            <button type="button" className="btn btn-secondary" onClick={backToOneItem}>
              <I.ChevronLeft size={16} />
              <Trans>Atrás</Trans>
            </button>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="input"
                type="password"
                style={{ width: 150 }}
                value={pin}
                placeholder={t`PIN del aprobador`}
                aria-label={t`PIN del aprobador`}
                onChange={(event) => setPin(event.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || result.countedCount === 0}
                onClick={send}
              >
                <I.Check size={16} />
                {busy ? <Trans>Enviando…</Trans> : <Trans>Enviar conteo</Trans>}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {error && draft.step !== 'summary' ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{error}</p>
      ) : null}

      {draft.step === 'count' && !item ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
          <Trans>No hay artículos en las áreas elegidas.</Trans>
        </p>
      ) : null}
    </div>
  );
}
