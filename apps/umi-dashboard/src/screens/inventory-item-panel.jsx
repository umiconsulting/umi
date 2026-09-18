import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { Menu } from '@/components/menu.jsx';
import { useAdministrativeCommand } from '@/lib/administrative-command.jsx';
import { conversionSummary, mergeConversions } from './inventory-model.js';
import { ITEM_TYPE_LABEL, TRACKING_LABEL, UNIT_LABEL } from './inventory-copy.js';

/**
 * The item panel — the read surface for one item (redesign plan D13).
 *
 * Material 3 fixes list-detail at 840 dp for two panes; this panel switches at
 * 1024 px, where a 1fr list plus a 400 px panel still leaves the list readable.
 * Below that the panel takes the whole screen, because a second column on a phone
 * is a sheet under the content and never a squeezed list.
 *
 * The panel is READ FIRST. Every section carries its own way into the editor, and
 * only the two things a person does standing up — a count and an adjustment — sit
 * on the header as buttons.
 */

const STATE_COPY = {
  ok: msg`En nivel`,
  low: msg`Bajo el umbral`,
  out: msg`Agotado`,
  unknown: msg`Sin existencia registrada`,
  not_tracked: msg`No se cuenta`,
  archived: msg`Archivado`,
};

/** The panel's own breakpoint. It matches the `.inv-panel` media rule in styles.css. */
const NARROW_QUERY = '(max-width: 1023px)';

export default function InventoryItemPanel({
  item,
  signals,
  unit,
  conversions,
  allergens,
  onClose,
  onEdit,
  onAdjust,
  onCount,
  onArchived,
}) {
  const { t, i18n } = useLingui();
  const command = useAdministrativeCommand();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * Below 1024 px the panel is a full-screen layer. It MUST leave the screen's own
   * subtree to do that: `.main` carries `isolation: isolate`, so a `position: fixed`
   * child of it is trapped in that stacking context and paints under the topbar —
   * measured in the browser, where the open panel's box was 0,0,375×844 and
   * `elementFromPoint(20,20)` still answered the nav toggle. `Select` and `Menu`
   * already solve this the same way, with a portal to `body`.
   */
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (event) => setNarrow(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const itemConversions = mergeConversions(item, conversions);
  const unitOf = (code) => (UNIT_LABEL[code] ? i18n._(UNIT_LABEL[code]) : code);
  const allergenNames = (item.allergens || [])
    .map(
      (entry) =>
        allergens.find((known) => known.id === entry.id)?.label || entry.label || entry.code,
    )
    .filter(Boolean);

  async function archive() {
    setBusy(true);
    try {
      await command.execute('inventory.item.archive', item.id, {
        targetVersion: item.version,
        parameters: {},
      });
      await onArchived();
    } finally {
      setBusy(false);
      setConfirmArchive(false);
    }
  }

  const menuItems = [
    { key: 'edit', label: t`Editar artículo`, icon: I.Edit, onSelect: onEdit },
    {
      key: 'archive',
      label: t`Archivar`,
      icon: I.Archive,
      danger: true,
      onSelect: () => setConfirmArchive(true),
    },
  ];

  const panel = (
    <aside className="inv-panel" aria-label={t`Detalle de ${item.displayName}`}>
      <div className="inv-panel-head">
        <div style={{ minWidth: 0 }}>
          <div className="inv-panel-title">{item.displayName}</div>
          <div className="inv-panel-sub">
            {item.publicReference}
            {' · '}
            {ITEM_TYPE_LABEL[item.itemType]
              ? i18n._(ITEM_TYPE_LABEL[item.itemType])
              : item.itemType}
            {' · '}
            {TRACKING_LABEL[item.trackingPolicy]
              ? i18n._(TRACKING_LABEL[item.trackingPolicy])
              : item.trackingPolicy}
          </div>
        </div>
        <div className="inv-panel-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCount}>
            <I.ClipboardList size={15} />
            <Trans>Contar</Trans>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onAdjust}>
            <I.SlidersHorizontal size={15} />
            <Trans>Ajustar</Trans>
          </button>
          <Menu
            align="end"
            label={t`Acciones del artículo`}
            items={menuItems}
            renderTrigger={({ ref, props }) => (
              <button
                type="button"
                ref={ref}
                className="btn btn-ghost btn-sm"
                aria-label={t`Acciones del artículo`}
                {...props}
              >
                <I.MoreH size={16} />
              </button>
            )}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label={t`Cerrar`}
          >
            <I.X size={16} />
          </button>
        </div>
      </div>

      {confirmArchive ? (
        <div className="inv-section" style={{ background: 'var(--danger-soft)' }}>
          <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--ink-1)' }}>
            <Trans>
              {item.displayName} sale del POS y deja de contar. Este panel no puede reactivarlo.
            </Trans>
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => setConfirmArchive(false)}
            >
              <Trans>Cancelar</Trans>
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={archive}
            >
              <Trans>Archivar de todos modos</Trans>
            </button>
          </div>
        </div>
      ) : null}

      <div className="inv-section">
        <div className="inv-section-head">
          <span className="inv-section-title">
            <Trans>Existencia</Trans>
          </span>
          <span className="inv-state-pill">
            <span className="inv-dot" data-state={signals.stockState} aria-hidden="true" />
            {i18n._(STATE_COPY[signals.stockState])}
          </span>
        </div>
        <div
          className="inv-count-figure"
          style={{ justifyContent: 'flex-start', padding: '4px 0' }}
        >
          <span className="inv-count-value">
            {signals.onHand.state === 'empty' ? '—' : signals.onHand.text}
          </span>
          <span className="inv-count-unit">
            {signals.onHand.state === 'empty' ? t`sin registro` : unit}
          </span>
        </div>
        {signals.threshold != null ? (
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            <Trans>
              Umbral bajo {signals.threshold} {unit}
            </Trans>
          </p>
        ) : null}
      </div>

      <div className="inv-section">
        <div className="inv-section-head">
          <span className="inv-section-title">
            <Trans>Identidad</Trans>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <Trans>Editar</Trans>
          </button>
        </div>
        <dl className="inv-kv">
          <dt>
            <Trans>Referencia</Trans>
          </dt>
          <dd>{item.publicReference}</dd>
          <dt>
            <Trans>Unidad base</Trans>
          </dt>
          <dd>{unit}</dd>
          <dt>
            <Trans>Vida útil</Trans>
          </dt>
          <dd>{item.shelfLifeDays == null ? t`Sin vida útil` : t`${item.shelfLifeDays} días`}</dd>
          <dt>
            <Trans>Negativos</Trans>
          </dt>
          <dd>{item.negativeStockPolicy}</dd>
        </dl>
      </div>

      <div className="inv-section">
        <div className="inv-section-head">
          <span className="inv-section-title">
            <Trans>Unidades</Trans>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <Trans>Editar</Trans>
          </button>
        </div>
        {itemConversions.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            <Trans>No hay conversiones. El artículo se cuenta en su unidad base.</Trans>
          </p>
        ) : (
          <dl className="inv-kv">
            {itemConversions.map((conversion) => (
              <div key={conversion.id} style={{ display: 'contents' }}>
                <dt>{conversionSummary(conversion, unitOf)}</dt>
                <dd>{conversion.roundingPolicy}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="inv-section">
        <div className="inv-section-head">
          <span className="inv-section-title">
            <Trans>Costo</Trans>
          </span>
        </div>
        {signals.hasCost ? (
          <p style={{ margin: 0, fontSize: 13.5 }}>
            <Trans>El costo viene de las facturas recibidas.</Trans>
          </p>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            <Trans>
              Ningún recibo ha fijado el costo de este artículo. Los márgenes no lo incluyen.
            </Trans>
          </p>
        )}
      </div>

      <div className="inv-section">
        <div className="inv-section-head">
          <span className="inv-section-title">
            <Trans>Alérgenos</Trans>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <Trans>Editar</Trans>
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13.5 }}>
          {allergenNames.length === 0 ? <Trans>Ninguno declarado</Trans> : allergenNames.join(', ')}
        </p>
      </div>
    </aside>
  );

  return narrow ? createPortal(panel, document.body) : panel;
}
