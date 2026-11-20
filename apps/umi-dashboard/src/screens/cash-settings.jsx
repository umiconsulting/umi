import { useId, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { RegionHead } from '@/shell.jsx';
import { saveCashSettings } from '@/data.jsx';
import { CASH_DOW, buildCashSettingsPatch, cashSettingsForm } from './cash-settings-model.js';

const DOW_LABELS = {
  dom: msg`Dom`,
  lun: msg`Lun`,
  mar: msg`Mar`,
  mie: msg`Mié`,
  jue: msg`Jue`,
  vie: msg`Vie`,
  sab: msg`Sáb`,
};

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={'switch lg focusable' + (checked ? ' on' : '')}
      style={{ border: 'none', padding: 0 }}
      onClick={onChange}
    />
  );
}

/**
 * Cash-only settings, reachable from the Lealtad y valor hub.
 *
 * The panel writes only the fields the Cash settings contract owns. It does not
 * send `passStyle` because it has no pass-style control; an absent key preserves
 * an existing grid café.
 */
export default function CashSettingsScreen({ merchant, loading = false }) {
  const { t, i18n } = useLingui();
  const uid = useId();
  const [form, setForm] = useState(() => (merchant ? cashSettingsForm(merchant) : null));
  const [base, setBase] = useState(() => (merchant ? cashSettingsForm(merchant) : null));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  if (!form) {
    return (
      <div className="cash-settings" data-cash-settings="">
        <div className="cash-panel cash-settings-empty">
          {loading ? (
            <Trans>Cargando ajustes de Cash…</Trans>
          ) : (
            <Trans>No se pudieron cargar los ajustes de Cash.</Trans>
          )}
        </div>
      </div>
    );
  }

  const dirty = base ? JSON.stringify(form) !== JSON.stringify(base) : false;

  const update = (key, value) => {
    setSaved(false);
    setError(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleDay = (id) => {
    const days = form.promoDays.includes(id)
      ? form.promoDays.filter((item) => item !== id)
      : [...form.promoDays, id];
    update('promoDays', days);
  };

  async function submit() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveCashSettings(buildCashSettingsPatch(form));
      setBase(form);
      setSaved(true);
    } catch (err) {
      setError(err.message || t`No se pudieron guardar los ajustes.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cash-settings" data-cash-settings="">
      <RegionHead
        title={<Trans>Ajustes de Cash</Trans>}
        note={<Trans>Configura el pase, la promoción y el registro del programa.</Trans>}
      />

      <section className="cash-panel cash-settings-panel" aria-label={t`Ajustes de Cash`}>
        <div className="cash-settings-section">
          <h3 className="cash-section-title">
            <Trans>Apariencia</Trans>
          </h3>
          <p className="cash-settings-note">
            <Trans>Los colores se aplican al pase y a la tarjeta del cliente.</Trans>
          </p>
          <div className="cash-settings-grid">
            <div className="field">
              <label htmlFor={`${uid}-primary-color`}>
                <Trans>Color principal</Trans>
              </label>
              <div className="cash-color-control">
                <input
                  id={`${uid}-primary-color`}
                  type="color"
                  className="cash-color-input"
                  aria-label={t`Color principal`}
                  value={form.primaryColor}
                  onChange={(event) => update('primaryColor', event.target.value)}
                />
                <input
                  className="input"
                  value={form.primaryColor}
                  onChange={(event) => update('primaryColor', event.target.value)}
                  aria-label={t`Valor del color principal`}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor={`${uid}-secondary-color`}>
                <Trans>Color secundario</Trans>
              </label>
              <div className="cash-color-control">
                <input
                  id={`${uid}-secondary-color`}
                  type="color"
                  className="cash-color-input"
                  aria-label={t`Color secundario`}
                  value={form.secondaryColor}
                  onChange={(event) => update('secondaryColor', event.target.value)}
                />
                <input
                  className="input"
                  value={form.secondaryColor}
                  onChange={(event) => update('secondaryColor', event.target.value)}
                  aria-label={t`Valor del color secundario`}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="cash-settings-section">
          <h3 className="cash-section-title">
            <Trans>Promoción</Trans>
          </h3>
          <p className="cash-settings-note">
            <Trans>El mensaje se envía por WhatsApp y aparece en el pase.</Trans>
          </p>
          <div className="field">
            <label htmlFor={`${uid}-promo-message`}>
              <Trans>Mensaje · máx. 200 caracteres</Trans>
            </label>
            <textarea
              id={`${uid}-promo-message`}
              className="input"
              value={form.promoMessage}
              maxLength={200}
              onChange={(event) => update('promoMessage', event.target.value)}
              style={{ minHeight: 100 }}
            />
            <div className="cash-settings-count">{form.promoMessage.length} / 200</div>
          </div>
          <div className="cash-settings-grid">
            <div className="field">
              <label htmlFor={`${uid}-promo-start`}>
                <Trans>Inicio de la vigencia</Trans>
              </label>
              <input
                id={`${uid}-promo-start`}
                type="date"
                className="input"
                value={form.promoStartsAt}
                onChange={(event) => update('promoStartsAt', event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-promo-end`}>
                <Trans>Fin de la vigencia</Trans>
              </label>
              <input
                id={`${uid}-promo-end`}
                type="date"
                className="input"
                value={form.promoEndsAt}
                onChange={(event) => update('promoEndsAt', event.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">
              <Trans>Días de la semana</Trans>
            </span>
            <div className="cash-settings-days">
              {CASH_DOW.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={'day-pill focusable' + (form.promoDays.includes(id) ? ' on' : '')}
                  aria-pressed={form.promoDays.includes(id)}
                  onClick={() => toggleDay(id)}
                >
                  {i18n._(DOW_LABELS[id])}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="cash-settings-section">
          <div className="cash-settings-section-head">
            <div>
              <h3 className="cash-section-title">
                <Trans>Cumpleaños</Trans>
              </h3>
              <p className="cash-settings-note">
                <Trans>Un premio que se emite solo el día del cumpleaños.</Trans>
              </p>
            </div>
            <Switch
              checked={form.birthdayRewardEnabled}
              label={t`Regalo de cumpleaños`}
              onChange={() => update('birthdayRewardEnabled', !form.birthdayRewardEnabled)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-birthday-name`}>
              <Trans>Nombre del premio</Trans>
            </label>
            <input
              id={`${uid}-birthday-name`}
              className="input"
              value={form.birthdayRewardName}
              disabled={!form.birthdayRewardEnabled}
              onChange={(event) => update('birthdayRewardName', event.target.value)}
            />
          </div>
        </div>

        <div className="cash-settings-section">
          <h3 className="cash-section-title">
            <Trans>Registro y monedero</Trans>
          </h3>
          <div className="cash-settings-toggle">
            <div>
              <div className="cash-settings-toggle-title">
                <Trans>Autorregistro</Trans>
              </div>
              <p className="cash-settings-note">
                <Trans>El cliente puede entrar al programa escaneando un código QR.</Trans>
              </p>
            </div>
            <Switch
              checked={form.selfRegistration}
              label={t`Autorregistro`}
              onChange={() => update('selfRegistration', !form.selfRegistration)}
            />
          </div>
          <div className="cash-settings-toggle">
            <div>
              <div className="cash-settings-toggle-title">
                <Trans>Recargas del monedero</Trans>
              </div>
              <p className="cash-settings-note">
                <Trans>Permite abonar saldo a la tarjeta del cliente.</Trans>
              </p>
            </div>
            <Switch
              checked={form.topupEnabled}
              label={t`Recargas del monedero`}
              onChange={() => update('topupEnabled', !form.topupEnabled)}
            />
          </div>
          <div className="cash-settings-toggle">
            <div>
              <div className="cash-settings-toggle-title">
                <Trans>Sellos múltiples</Trans>
              </div>
              <p className="cash-settings-note">
                <Trans>Permite más de un sello por visita cuando la promoción lo indica.</Trans>
              </p>
            </div>
            <Switch
              checked={form.multiSealEnabled}
              label={t`Sellos múltiples`}
              onChange={() => update('multiSealEnabled', !form.multiSealEnabled)}
            />
          </div>
        </div>

        <div className="cash-settings-save">
          <span role="status" className={'cash-settings-status' + (error ? ' is-error' : '')}>
            {error ? (
              <>
                <I.AlertTriangle size={15} aria-hidden="true" /> {error}
              </>
            ) : saved ? (
              <>
                <I.Check size={15} aria-hidden="true" /> <Trans>Cambios guardados</Trans>
              </>
            ) : dirty ? (
              <Trans>Sin guardar</Trans>
            ) : null}
          </span>
          <button
            className="btn btn-primary focusable"
            type="button"
            onClick={submit}
            disabled={!dirty || saving}
          >
            {saving ? <Trans>Guardando…</Trans> : <Trans>Guardar cambios</Trans>}
          </button>
        </div>
      </section>
    </div>
  );
}
