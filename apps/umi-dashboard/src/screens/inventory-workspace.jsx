import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { Menu } from '@/components/menu.jsx';
import { useAdministrativeCommand } from '@/lib/administrative-command.jsx';
import { hasRequiredPermission } from '@/lib/module-registry.js';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { useInventoryAllergens, useInventoryItems, useInventoryUnitConversions } from '@/data.jsx';
import {
  PAGE_SIZE,
  VIEW_KEYS,
  attentionQueue,
  filterByView,
  itemSignals,
  paginate,
  rowActionFor,
  sortItems,
  sortByUrgency,
  viewCounts,
} from './inventory-model.js';
import {
  ITEM_ERROR_COPY,
  ITEM_TYPE_LABEL,
  MANAGE_GATE,
  TRACKING_LABEL,
  UNIT_LABEL,
  errorText,
} from './inventory-copy.js';
import {
  AllergenLabelsPanel,
  ItemEditor,
  NoPermissionNotice,
  SinCosto,
} from './inventory-item-editor.jsx';
import InventoryAdjustSheet from './inventory-adjust.jsx';
import InventoryCount from './inventory-count.jsx';
import InventoryFilters from './inventory-filters.jsx';
import InventoryItemPanel from './inventory-item-panel.jsx';

/**
 * Inventario — the console's workbench for stock (redesign plan, 2026-09-18).
 *
 * The screen this replaces was an eight-column table with one action on each row.
 * A person could not use it. Polaris states the rule the old screen broke: a data
 * table "is not to be used for an actionable list of items that link to details
 * pages", and "If your use case is more about finding and taking action on
 * objects, use a resource list."
 *
 * The workbench holds three bands, in this order.
 *   1. The task rail — the three jobs a person starts on purpose.
 *   2. The attention queue — the questions the data is asking, each with a verb.
 *   3. The resource list — items, one line each, with the action the row needs.
 *
 * The tab is reachable with `catalog.read` or `inventory.read`, but every read and
 * write behind it is gated on `merchant.manage`. A screen that fired the reads
 * anyway would answer with three 403s for a cashier, so the permission is checked
 * first and the tab says what the operator cannot do instead.
 */

const VIEW_LABEL = {
  all: msg`Todo`,
  low_stock: msg`Bajo stock`,
  no_cost: msg`Sin costo`,
  no_balance: msg`Sin existencia`,
  archived: msg`Archivados`,
};

/** The label and the icon of each need, in the one place both the list and the menu read. */
const NEED_COPY = {
  count: I.ClipboardList,
  review_stock: I.AlertTriangle,
  set_cost: I.CircleDollarSign,
  enable_tracking: I.ToggleRight,
};

const NEED_LABEL = {
  count: msg`Contar`,
  review_stock: msg`Revisar`,
  set_cost: msg`Poner costo`,
  enable_tracking: msg`Activar conteo`,
};

/** The state word that follows the dot. A colour alone is not a signal. */
const STATE_COPY = {
  ok: msg`En nivel`,
  low: msg`Bajo`,
  out: msg`Agotado`,
  unknown: msg`Sin existencia`,
  not_tracked: msg`No se cuenta`,
  archived: msg`Archivado`,
};

export default function InventoryWorkspace() {
  const { t, i18n } = useLingui();
  const merchant = useMerchant();
  const command = useAdministrativeCommand();
  const capabilities = merchant?.capabilities || null;
  const canManage = hasRequiredPermission(MANAGE_GATE, capabilities);

  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState(() => new Set());
  const [focusIndex, setFocusIndex] = useState(-1);
  const [panelItem, setPanelItem] = useState(null);
  const [editor, setEditor] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [adjustItem, setAdjustItem] = useState(null);
  const [countOpen, setCountOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filters, setFilters] = useState({ type: '', tracking: '' });
  const [notice, setNotice] = useState('');

  const searchRef = useRef(null);
  const rowRefs = useRef([]);

  const itemsState = useInventoryItems({ includeArchived: view === 'archived' }, refresh);
  const conversionsState = useInventoryUnitConversions(refresh);
  const allergensState = useInventoryAllergens(refresh);

  const locationId = merchant?.selectedLocationId || merchant?.selectedLocation?.id || '';
  const locationName =
    capabilities?.selectedLocation?.name ||
    (capabilities?.locations || []).find((location) => location.id === locationId)?.name ||
    t`Todas las sucursales`;

  const costedIds = useMemo(
    () => new Set(itemsState.data.costedIds || []),
    [itemsState.data.costedIds],
  );

  const items = useMemo(
    () => (Array.isArray(itemsState.data.items) ? itemsState.data.items : []),
    [itemsState.data.items],
  );

  /** One pass for the chip counts. The chips and the rows must agree, so both read this. */
  const counts = useMemo(
    () => viewCounts(items, locationId, costedIds),
    [items, locationId, costedIds],
  );

  const attention = useMemo(
    () => attentionQueue(counts).map((entry) => ({ ...entry, count: entry.count })),
    [counts],
  );

  const allSignals = useMemo(() => {
    const map = new Map();
    for (const item of items) map.set(item.id, itemSignals(item, locationId, costedIds));
    return map;
  }, [items, locationId, costedIds]);

  const viewRows = useMemo(() => {
    const rows = filterByView(items, view, locationId, costedIds, { query });
    const typed = rows.filter((item) => {
      if (filters.type && item.itemType !== filters.type) return false;
      if (filters.tracking && item.trackingPolicy !== filters.tracking) return false;
      return true;
    });
    return sortItems(typed);
  }, [items, view, locationId, costedIds, query, filters]);

  /** The attention views read worst-first. The default list keeps the name order. */
  const orderedRows = useMemo(() => {
    if (view === 'low_stock' || view === 'no_balance') {
      return sortByUrgency(viewRows, locationId, costedIds);
    }
    return viewRows;
  }, [viewRows, view, locationId, costedIds]);

  const slice = useMemo(() => paginate(orderedRows, page, PAGE_SIZE), [orderedRows, page]);

  /**
   * A change of view or of filter starts the list again at the first page, and the
   * selection does not survive it: a person who selects rows and then narrows the
   * view must not archive a row that is no longer on screen. The reset lives in the
   * handlers rather than in an effect, so the screen never renders the stale page
   * first.
   */
  const restartList = useCallback(() => {
    setPage(0);
    setSelection(new Set());
    setFocusIndex(-1);
  }, []);

  const changeView = useCallback(
    (next) => {
      setView(next);
      restartList();
    },
    [restartList],
  );

  const activeFilterCount = Number(Boolean(filters.type)) + Number(Boolean(filters.tracking));

  const reload = useCallback(async () => {
    setPanelItem(null);
    setEditor(null);
    setAdjustItem(null);
    setRefresh((value) => value + 1);
  }, []);

  const openPanel = useCallback((item) => {
    setPanelItem(item);
  }, []);

  /** The row's own verb. Each need opens the smallest surface that answers it. */
  const runNeed = useCallback(
    (need, item) => {
      if (need === 'set_cost') window.location.assign('/inventory/costos');
      else if (need === 'count') setCountOpen(true);
      else if (need === 'enable_tracking') setEditor({ item, id: item.id });
      else openPanel(item);
    },
    [openPanel],
  );

  const toggleSelect = useCallback((id) => {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  /**
   * A bulk write runs one command per item, because `inventory.item.update` takes an
   * aggregate id and its own expected version. The loop reports how many landed.
   */
  const runBulkUpdate = useCallback(
    async (parameters, doneMessage) => {
      const chosen = items.filter((item) => selection.has(item.id));
      let done = 0;
      for (const item of chosen) {
        try {
          await command.execute('inventory.item.update', item.id, {
            targetVersion: item.version,
            parameters,
          });
          done += 1;
        } catch {
          // One refusal must not stop the rest. The notice names the split.
        }
      }
      setNotice(doneMessage(done, chosen.length));
      clearSelection();
      await reload();
    },
    [items, selection, command, clearSelection, reload],
  );

  // Keyboard: the workspace answers the keys a dense tool must answer (plan D12).
  useEffect(() => {
    if (!canManage) return undefined;
    function onKey(event) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      /**
       * Escape closes the TOP layer, in the order the layers stack. Without the
       * order, Escape on the palette would clear a selection behind the backdrop
       * and leave the panel open — which is what the browser run caught. This
       * branch sits ABOVE the typing guard on purpose: the palette autofocuses its
       * own input, so the guard would swallow the key the palette needs.
       */
      if (event.key === 'Escape') {
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        if (filtersOpen) {
          setFiltersOpen(false);
          return;
        }
        if (adjustItem) {
          setAdjustItem(null);
          return;
        }
        if (countOpen) {
          setCountOpen(false);
          return;
        }
        if (editor) {
          setEditor(null);
          return;
        }
        clearSelection();
        return;
      }
      if (typing) return;
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      setFocusIndex((current) => {
        const size = slice.rows.length;
        if (size === 0) return -1;
        const next =
          event.key === 'ArrowDown'
            ? Math.min(size - 1, current + 1)
            : Math.max(0, current <= 0 ? 0 : current - 1);
        rowRefs.current[next]?.focus();
        return next;
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    canManage,
    slice.rows.length,
    clearSelection,
    paletteOpen,
    filtersOpen,
    adjustItem,
    countOpen,
    editor,
  ]);

  if (merchant?.loading && !capabilities) {
    return (
      <p className="muted">
        <Trans>Cargando el inventario…</Trans>
      </p>
    );
  }
  if (!canManage) return <NoPermissionNotice />;

  const loading = itemsState.loading && !itemsState.loaded;
  const failed = Boolean(itemsState.error);
  const filteredEmpty =
    !loading &&
    !failed &&
    orderedRows.length === 0 &&
    (query || activeFilterCount > 0 || view !== 'all');
  const empty = !loading && !failed && orderedRows.length === 0 && !filteredEmpty;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* ---------- 1. the task rail ---------- */}
      <div className="inv-tiles">
        <button type="button" className="inv-tile" onClick={() => setCountOpen(true)}>
          <span className="inv-tile-icon">
            <I.ClipboardList size={18} />
          </span>
          <span>
            <span className="inv-tile-title">
              <Trans>Contar stock</Trans>
            </span>
            <span className="inv-tile-note">
              <Trans>Elige las áreas y cuenta artículo por artículo</Trans>
            </span>
          </span>
        </button>
        <button type="button" className="inv-tile" onClick={() => changeView('no_balance')}>
          <span className="inv-tile-icon">
            <I.PackagePlus size={18} />
          </span>
          <span>
            <span className="inv-tile-title">
              <Trans>Revisar existencia</Trans>
            </span>
            <span className="inv-tile-note">
              {t`${counts.no_balance} artículos sin existencia en ${locationName}`}
            </span>
          </span>
        </button>
        {/*
          The rail holds the two JOBS and nothing else. "New item" is the list's own
          primary, and a second copy here would be two identical primary actions on
          one screen — the browser run showed both at once. A rail of two also
          stretches to the full width, which reads as the band it is.
        */}
      </div>

      {/* ---------- 2. the attention queue ---------- */}
      {attention.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <span className="inv-band-title">
            <Trans>Necesita tu atención</Trans>
          </span>
          <div className="inv-attention">
            {attention.map((entry) => (
              <div key={entry.key} className="inv-attention-row">
                <span className="inv-attention-text">
                  <span
                    className="inv-dot"
                    data-state={
                      entry.key === 'no_cost'
                        ? 'unknown'
                        : entry.key === 'low_stock'
                          ? 'low'
                          : 'unknown'
                    }
                    aria-hidden="true"
                  />
                  {entry.key === 'no_balance' ? (
                    <Trans>{entry.count} artículos sin existencia registrada</Trans>
                  ) : entry.key === 'low_stock' ? (
                    <Trans>{entry.count} artículos en o bajo el umbral</Trans>
                  ) : (
                    <Trans>{entry.count} artículos sin costo</Trans>
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => changeView(entry.view)}
                >
                  {entry.key === 'no_cost' ? (
                    <Trans>Ver sin costo</Trans>
                  ) : entry.key === 'low_stock' ? (
                    <Trans>Ver bajo stock</Trans>
                  ) : (
                    <Trans>Ver sin existencia</Trans>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ---------- 3. the resource list ---------- */}
      <div className="inv-split" data-panel={panelItem ? 'open' : 'closed'}>
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
            }}
          >
            <div className="inv-views" role="tablist" aria-label={t`Vistas de inventario`}>
              {VIEW_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  className="inv-view"
                  onClick={() => changeView(key)}
                >
                  {i18n._(VIEW_LABEL[key])}
                  <span className="inv-view-count">{counts[key]}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                ref={searchRef}
                className="input"
                style={{ width: 220 }}
                value={query}
                placeholder={t`Buscar artículo`}
                aria-label={t`Buscar artículo`}
                onChange={(event) => {
                  setQuery(event.target.value);
                  restartList();
                }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setFiltersOpen(true)}
              >
                <I.Filter size={16} />
                <Trans>Filtros</Trans>
                {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPaletteOpen(true)}
                aria-label={t`Abrir comandos`}
                title={t`Comandos (Ctrl+K)`}
              >
                <I.Command size={16} />
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setEditor({ item: null, id: crypto.randomUUID() })}
              >
                <I.Plus size={16} />
                <Trans>Nuevo artículo</Trans>
              </button>
            </div>
          </div>

          {notice ? (
            <p className="muted" style={{ margin: 0 }}>
              {notice}
            </p>
          ) : null}

          {selection.size > 0 ? (
            <div className="inv-bulkbar">
              <span className="inv-bulkbar-count">
                <Trans>{selection.size} seleccionados</Trans>
              </span>
              <span className="inv-bulkbar-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    runBulkUpdate(
                      { trackingPolicy: 'tracked' },
                      (done, total) => t`${done} de ${total} artículos ahora se cuentan`,
                    )
                  }
                >
                  <Trans>Activar conteo</Trans>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    runBulkUpdate(
                      { negativeStockPolicy: 'block' },
                      (done, total) => t`${done} de ${total} artículos ya no permiten negativos`,
                    )
                  }
                >
                  <Trans>Bloquear negativos</Trans>
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection}>
                  <Trans>Limpiar</Trans>
                </button>
              </span>
            </div>
          ) : null}

          {loading ? (
            <div className="inv-skeleton" aria-busy="true" aria-label={t`Cargando el inventario`}>
              {Array.from({ length: 8 }, (unused, index) => (
                <div key={index} className="inv-skeleton-row" />
              ))}
            </div>
          ) : failed ? (
            <div className="inv-state">
              <I.AlertTriangle size={22} />
              <span className="inv-state-title">
                <Trans>No se pudo leer el inventario</Trans>
              </span>
              <span className="inv-state-note">
                {errorText(i18n, ITEM_ERROR_COPY, {
                  code: itemsState.errorCode,
                  message: itemsState.error,
                })}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRefresh((value) => value + 1)}
              >
                <Trans>Reintentar</Trans>
              </button>
            </div>
          ) : empty ? (
            <div className="inv-state">
              <I.Package size={22} />
              <span className="inv-state-title">
                <Trans>Aún no hay artículos</Trans>
              </span>
              <span className="inv-state-note">
                <Trans>Crea el primer insumo para empezar a controlar la existencia.</Trans>
              </span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setEditor({ item: null, id: crypto.randomUUID() })}
              >
                <I.Plus size={16} />
                <Trans>Crear artículo</Trans>
              </button>
            </div>
          ) : filteredEmpty ? (
            <div className="inv-state">
              <I.Search size={22} />
              <span className="inv-state-title">
                <Trans>Ningún artículo coincide</Trans>
              </span>
              <span className="inv-state-note">
                <Trans>Cambia la vista o quita la búsqueda para ver más artículos.</Trans>
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setQuery('');
                  setFilters({ type: '', tracking: '' });
                  setView('all');
                  restartList();
                }}
              >
                <Trans>Limpiar filtros</Trans>
              </button>
            </div>
          ) : (
            <>
              <div className="inv-list">
                {slice.rows.map((item, index) => {
                  const signals = allSignals.get(item.id);
                  const need = rowActionFor(signals);
                  const onHand = signals.onHand;
                  const unit = UNIT_LABEL[item.baseUnit]
                    ? i18n._(UNIT_LABEL[item.baseUnit])
                    : item.baseUnit;
                  const selected = selection.has(item.id);
                  const menuItems = [
                    {
                      key: 'select',
                      label: t`Seleccionar`,
                      icon: I.Check,
                      onSelect: () => toggleSelect(item.id),
                    },
                    {
                      key: 'open',
                      label: t`Ver detalle`,
                      icon: I.Eye,
                      onSelect: () => openPanel(item),
                    },
                    {
                      key: 'adjust',
                      label: t`Ajustar existencia`,
                      icon: I.SlidersHorizontal,
                      onSelect: () => setAdjustItem(item),
                    },
                    {
                      key: 'edit',
                      label: t`Editar artículo`,
                      icon: I.Edit,
                      onSelect: () => setEditor({ item, id: item.id }),
                    },
                    {
                      key: 'archive',
                      label: t`Archivar`,
                      icon: I.Archive,
                      danger: true,
                      onSelect: () => setPanelItem(item),
                    },
                  ];
                  return (
                    <div
                      key={item.id}
                      className="inv-row"
                      data-selected={selected}
                      data-needs={Boolean(need)}
                      role="row"
                      /**
                       * A roving tabindex needs exactly ONE row in the tab order.
                       * `focusIndex` starts at -1, so the first row takes the 0 and
                       * the arrow keys move it from there. Without the fallback no
                       * row is reachable by Tab at all — which the browser run
                       * caught.
                       */
                      tabIndex={index === (focusIndex === -1 ? 0 : focusIndex) ? 0 : -1}
                      ref={(node) => {
                        rowRefs.current[index] = node;
                      }}
                      onClick={(event) => {
                        if (event.target.closest('button')) return;
                        // Once a selection is open, the whole row is a checkbox. The
                        // person is in a batch, and a row click must not open a panel
                        // over the work.
                        if (selection.size > 0) {
                          toggleSelect(item.id);
                          return;
                        }
                        openPanel(item);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          if (selection.size > 0) toggleSelect(item.id);
                          else openPanel(item);
                        }
                        if (event.key === 'x' || event.key === 'X') toggleSelect(item.id);
                      }}
                    >
                      <span
                        className="inv-dot"
                        data-state={signals.stockState}
                        aria-hidden="true"
                      />
                      <span className="inv-row-main">
                        <span className="inv-row-name">{item.displayName}</span>
                        <span className="inv-row-meta">
                          {item.publicReference}
                          <span>·</span>
                          {ITEM_TYPE_LABEL[item.itemType]
                            ? i18n._(ITEM_TYPE_LABEL[item.itemType])
                            : item.itemType}
                          <span>·</span>
                          {TRACKING_LABEL[item.trackingPolicy]
                            ? i18n._(TRACKING_LABEL[item.trackingPolicy])
                            : item.trackingPolicy}
                          {!signals.hasCost ? <SinCosto /> : null}
                        </span>
                      </span>
                      <span className="inv-row-value">
                        <span className="inv-row-figure">
                          {onHand.state === 'empty' ? '—' : onHand.text}
                          {onHand.state === 'empty' ? null : ` ${unit}`}
                        </span>
                        <span className="inv-row-note">
                          {i18n._(STATE_COPY[signals.stockState])}
                          {signals.threshold != null ? ` · ${t`umbral`} ${signals.threshold}` : ''}
                        </span>
                      </span>
                      <span className="inv-row-action" style={{ display: 'flex', gap: 4 }}>
                        {/*
                          The batch rule, from Carbon: once a row is selected, the
                          row's own controls step aside for the batch action bar, so
                          the person acts on the SET and not on one row by mistake.
                        */}
                        {selection.size > 0 ? null : need ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => runNeed(need, item)}
                          >
                            {(() => {
                              const Glyph = NEED_COPY[need] || I.Eye;
                              return <Glyph size={15} />;
                            })()}
                            {NEED_LABEL[need] ? i18n._(NEED_LABEL[need]) : need}
                          </button>
                        ) : null}
                        {selection.size > 0 ? null : (
                          <Menu
                            align="end"
                            label={t`Acciones de ${item.displayName}`}
                            items={menuItems}
                            renderTrigger={({ ref, props }) => (
                              <button
                                type="button"
                                ref={ref}
                                className="btn btn-ghost btn-sm"
                                aria-label={t`Acciones de ${item.displayName}`}
                                {...props}
                              >
                                <I.MoreH size={16} />
                              </button>
                            )}
                          />
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="inv-foot">
                <span>{t`${slice.from}–${slice.to} de ${slice.total}`}</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={slice.page === 0}
                    onClick={() => setPage(slice.page - 1)}
                  >
                    <Trans>Anterior</Trans>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={slice.page >= slice.pages - 1}
                    onClick={() => setPage(slice.page + 1)}
                  >
                    <Trans>Siguiente</Trans>
                  </button>
                </span>
              </div>
            </>
          )}
        </div>

        {panelItem ? (
          <InventoryItemPanel
            item={panelItem}
            signals={allSignals.get(panelItem.id) || itemSignals(panelItem, locationId, costedIds)}
            unit={
              UNIT_LABEL[panelItem.baseUnit]
                ? i18n._(UNIT_LABEL[panelItem.baseUnit])
                : panelItem.baseUnit
            }
            conversions={conversionsState.data.items}
            allergens={allergensState.data.allergens}
            onClose={() => setPanelItem(null)}
            onEdit={() => setEditor({ item: panelItem, id: panelItem.id })}
            onAdjust={() => setAdjustItem(panelItem)}
            onCount={() => setCountOpen(true)}
            onArchived={async () => {
              setNotice(t`Artículo archivado`);
              await reload();
            }}
          />
        ) : null}
      </div>

      <AllergenLabelsPanel allergens={allergensState.data.allergens} onSaved={reload} />

      {editor ? (
        <ItemEditor
          item={editor.item}
          itemId={editor.id}
          flatConversions={conversionsState.data.items}
          allergens={allergensState.data.allergens}
          onClose={() => setEditor(null)}
          onSaved={reload}
        />
      ) : null}

      {adjustItem ? (
        <InventoryAdjustSheet
          item={adjustItem}
          locationId={locationId}
          onClose={() => setAdjustItem(null)}
          onDone={reload}
        />
      ) : null}

      {countOpen ? (
        <InventoryCount
          locationId={locationId}
          onClose={() => setCountOpen(false)}
          onDone={reload}
        />
      ) : null}

      {filtersOpen ? (
        <InventoryFilters
          value={filters}
          onApply={(next) => {
            setFilters(next);
            restartList();
            setFiltersOpen(false);
          }}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}

      {paletteOpen ? (
        <CommandPalette
          rows={orderedRows.slice(0, 40)}
          onClose={() => setPaletteOpen(false)}
          onOpenItem={(item) => {
            setPaletteOpen(false);
            openPanel(item);
          }}
          onCommand={(key) => {
            setPaletteOpen(false);
            if (key === 'count') setCountOpen(true);
            else if (key === 'new') setEditor({ item: null, id: crypto.randomUUID() });
            else if (key === 'low') changeView('low_stock');
            else if (key === 'nocost') changeView('no_cost');
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The command palette. It answers one question: "take me to the thing". It lists
 * the three tasks and the items in the current view, and it filters on the name.
 */
function CommandPalette({ rows, onClose, onOpenItem, onCommand }) {
  const { t } = useLingui();
  const [term, setTerm] = useState('');
  const [index, setIndex] = useState(0);
  const needle = term.trim().toLowerCase();
  const matches = rows.filter(
    (item) =>
      !needle ||
      String(item.displayName || '')
        .toLowerCase()
        .includes(needle) ||
      String(item.publicReference || '')
        .toLowerCase()
        .includes(needle),
  );
  const commands = [
    { key: 'count', label: t`Contar stock` },
    { key: 'new', label: t`Nuevo artículo` },
    { key: 'low', label: t`Ver bajo stock` },
    { key: 'nocost', label: t`Ver sin costo` },
  ].filter((entry) => !needle || entry.label.toLowerCase().includes(needle));
  const total = commands.length + matches.length;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Comandos`}
        style={{
          width: 'min(520px, 94vw)',
          maxHeight: '70vh',
          overflow: 'hidden',
          display: 'grid',
          gap: 0,
          padding: 0,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
          <input
            autoFocus
            className="input"
            style={{ width: '100%' }}
            value={term}
            placeholder={t`Escribe un comando o un artículo`}
            aria-label={t`Escribe un comando o un artículo`}
            onChange={(event) => {
              setTerm(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((value) => Math.min(total - 1, value + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((value) => Math.max(0, value - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (index >= commands.length) {
                  const item = matches[index - commands.length];
                  if (item) onOpenItem(item);
                } else {
                  const command = commands[index];
                  if (command) onCommand(command.key);
                }
              }
            }}
          />
        </div>
        <div style={{ overflowY: 'auto', padding: 6 }}>
          {total === 0 ? (
            <p className="muted" style={{ padding: 12, margin: 0 }}>
              <Trans>Sin resultados</Trans>
            </p>
          ) : null}
          {commands.map((entry, position) => (
            <button
              key={entry.key}
              type="button"
              className="btn btn-ghost"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                background: index === position ? 'var(--canvas-2)' : 'transparent',
              }}
              onClick={() => onCommand(entry.key)}
            >
              {entry.label}
            </button>
          ))}
          {matches.map((item, position) => (
            <button
              key={item.id}
              type="button"
              className="btn btn-ghost"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                background:
                  index === commands.length + position ? 'var(--canvas-2)' : 'transparent',
              }}
              onClick={() => onOpenItem(item)}
            >
              {item.displayName}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
