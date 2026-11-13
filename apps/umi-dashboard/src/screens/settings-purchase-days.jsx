import './inventory-planning.css';
import { useEffect, useRef, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { inventoryPlanningData, saveMerchantSettings } from '@/data.jsx';

/** Mount with a merchant key so pending requests cannot replace another business's draft. */
export function PurchaseDays({ merchantId }) {
  const { t } = useLingui();
  const [base, setBase] = useState(null);
  const [draft, setDraft] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    let current = true;
    active.current = true;
    inventoryPlanningData
      .loadPurchaseDays(merchantId)
      .then((days) => {
        if (!current) return;
        setBase(days);
        setDraft(days);
      })
      .catch((err) => {
        if (current) setError(err.message);
      });
    return () => {
      current = false;
      active.current = false;
    };
  }, [merchantId, retry]);
  const days = [
    [1, t`Lunes`],
    [2, t`Martes`],
    [3, t`Miércoles`],
    [4, t`Jueves`],
    [5, t`Viernes`],
    [6, t`Sábado`],
    [0, t`Domingo`],
  ];
  const dirty =
    base !== null && JSON.stringify([...base].sort()) !== JSON.stringify([...draft].sort());
  async function save() {
    if (pending.current || !dirty) return;
    pending.current = true;
    const submitted = [...draft].sort();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveMerchantSettings({ purchaseDays: submitted }, merchantId);
      if (!active.current) return;
      setBase(submitted);
      setDraft(submitted);
      setSaved(true);
    } catch (err) {
      if (active.current) setError(err.message);
    } finally {
      pending.current = false;
      if (active.current) setSaving(false);
    }
  }
  return (
    <section
      style={{ padding: 24, borderTop: '1px solid var(--line-soft)' }}
      aria-label={t`Días de compra`}
    >
      <h2>
        <Trans>Días de compra</Trans>
      </h2>
      <p>
        <Trans>Selecciona los días en que sueles comprar.</Trans>
      </p>
      {error && <p role="alert">{error}</p>}
      {base === null ? (
        error ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setError(null);
              setRetry(retry + 1);
            }}
          >
            <Trans>Reintentar</Trans>
          </button>
        ) : (
          <p role="status">
            <Trans>Cargando ajustes…</Trans>
          </p>
        )
      ) : (
        <>
          <fieldset
            disabled={saving}
            style={{ border: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 12 }}
          >
            <legend className="sr-only">
              <Trans>Días de compra</Trans>
            </legend>
            {days.map(([day, label]) => (
              <label key={day} className="purchase-day">
                <input
                  type="checkbox"
                  checked={draft.includes(day)}
                  onChange={() => {
                    setSaved(false);
                    setDraft((value) =>
                      value.includes(day) ? value.filter((d) => d !== day) : [...value, day],
                    );
                  }}
                />
                <span className={'day-pill' + (draft.includes(day) ? ' on' : '')}>{label}</span>
              </label>
            ))}
          </fieldset>
          <p role="status">
            {saved ? (
              <Trans>Cambios guardados</Trans>
            ) : draft.length === 0 ? (
              <Trans>Sin configurar</Trans>
            ) : dirty ? (
              <Trans>Sin guardar</Trans>
            ) : null}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm focusable"
              disabled={saving || !dirty}
              onClick={() => {
                setDraft([...base]);
                setError(null);
                setSaved(false);
              }}
            >
              <Trans>Cancelar</Trans>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm focusable"
              disabled={saving || !dirty}
              onClick={save}
            >
              {saving ? <Trans>Guardando…</Trans> : <Trans>Guardar</Trans>}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
