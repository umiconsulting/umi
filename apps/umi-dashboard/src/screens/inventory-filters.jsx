import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { Select } from '@/components/select.jsx';
import { ITEM_TYPE_ORDER, TRACKING_ORDER } from './inventory-copy.js';

/**
 * The filter sheet (redesign plan D6).
 *
 * Three filters stay as chips on the list. Everything else lives here, behind one
 * button, and applies as ONE batch. The rules put it plainly: promote no more than
 * three filters, keep the full set behind one entry point, and apply the change
 * once rather than on every keystroke.
 *
 * The sheet holds only two controls today, and that is on purpose. A filter set
 * grows to fill the room it is given, and every filter is a question the operator
 * must learn. Two questions earn their place: what kind of thing is it, and does
 * it count.
 */

const TYPE_LABEL = {
  ingredient: msg`Insumo`,
  product: msg`Producto`,
  packaging: msg`Empaque`,
  supply: msg`Consumible`,
};

const TRACKING_LABEL = {
  tracked: msg`Se cuenta`,
  reservation_required: msg`Se reserva`,
  not_tracked: msg`No se cuenta`,
};

export default function InventoryFilters({ value, onApply, onClose }) {
  const { t, i18n } = useLingui();
  const [draft, setDraft] = useState(value);

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t`Filtros`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <h3 style={{ margin: 0, fontSize: 16 }}>
            <Trans>Filtros</Trans>
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
          <label className="field">
            <span className="field-label">
              <Trans>Tipo de artículo</Trans>
            </span>
            <Select
              value={draft.type}
              aria-label={t`Tipo de artículo`}
              onChange={(event) =>
                setDraft((current) => ({ ...current, type: event.target.value }))
              }
            >
              <option value="">{t`Todos`}</option>
              {ITEM_TYPE_ORDER.map((code) => (
                <option key={code} value={code}>
                  {TYPE_LABEL[code] ? i18n._(TYPE_LABEL[code]) : code}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">
              <Trans>Control de existencia</Trans>
            </span>
            <Select
              value={draft.tracking}
              aria-label={t`Control de existencia`}
              onChange={(event) =>
                setDraft((current) => ({ ...current, tracking: event.target.value }))
              }
            >
              <option value="">{t`Todos`}</option>
              {TRACKING_ORDER.map((code) => (
                <option key={code} value={code}>
                  {TRACKING_LABEL[code] ? i18n._(TRACKING_LABEL[code]) : code}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="sheet-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDraft({ type: '', tracking: '' })}
          >
            <Trans>Limpiar</Trans>
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onApply(draft)}>
            <Trans>Aplicar filtros</Trans>
          </button>
        </div>
      </section>
    </div>
  );
}
