import { useEffect, useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { loadInventoryAlertSettings, saveMerchantSettings } from '@/data.jsx';
export function InventoryAlertSettings({ merchantId }) {
  const [base, setBase] = useState(null);
  const [draft, setDraft] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    let current = true;
    active.current = true;
    setError(null);
    loadInventoryAlertSettings(merchantId)
      .then((value) => {
        if (current) {
          setBase(value.inventoryPlanningEmailEnabled === true);
          setDraft(value.inventoryPlanningEmailEnabled === true);
        }
      })
      .catch((err) => {
        if (current) setError(err.message);
      });
    return () => {
      current = false;
      active.current = false;
    };
  }, [merchantId, retry]);
  async function save() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    const submitted = draft;
    try {
      await saveMerchantSettings({ inventoryPlanningEmailEnabled: submitted }, merchantId);
      if (active.current) {
        setBase(submitted);
        setSaved(true);
      }
    } catch (err) {
      if (active.current) setError(err.message);
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <section style={{ padding: 24, borderTop: '1px solid var(--line-soft)' }}>
      <h2>
        <Trans>Avisos de inventario</Trans>
      </h2>
      <p>
        <Trans>
          Resumen por correo al dueño después de las 09:00 del negocio, como máximo una vez al día.
          Requiere un canal de correo configurado.
        </Trans>
      </p>
      {error && <p role="alert">{error}</p>}
      {base === null ? (
        error ? (
          <button className="btn btn-secondary" onClick={() => setRetry((value) => value + 1)}>
            <Trans>Reintentar</Trans>
          </button>
        ) : (
          <p>
            <Trans>Cargando ajustes…</Trans>
          </p>
        )
      ) : (
        <>
          <label style={{ display: 'flex', gap: 8, minHeight: 44, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={draft}
              disabled={busy}
              onChange={(event) => {
                setDraft(event.target.checked);
                setSaved(false);
              }}
            />
            <Trans>Enviar avisos por correo al dueño</Trans>
          </label>
          {saved && (
            <p role="status">
              <Trans>Cambios guardados</Trans>
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button
              className="btn btn-secondary"
              disabled={busy || base === draft}
              onClick={() => {
                setDraft(base);
                setError(null);
              }}
            >
              <Trans>Cancelar</Trans>
            </button>
            <button className="btn btn-secondary" disabled={busy || base === draft} onClick={save}>
              {busy ? <Trans>Guardando…</Trans> : <Trans>Guardar</Trans>}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
