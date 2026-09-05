import { useEffect, useRef, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { RegionHead } from '@/shell.jsx';
import { useCafes, provisionCafe } from '@/data.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';

// Screen — Cafés (platform)
// Data:  useCafes()      → GET  /api/me/merchants  (a platform grant lists every café)
// Write: provisionCafe() → POST /api/merchants     (PlatformAdminGuard · super_admin)
//
// Built from primitives this dashboard already owns — .ed-head, table.matrix,
// .card, .sheet, .field, .input, .badge, .btn. No new class and no new token: a
// screen that needs its own CSS is a screen that reads as bolted on.
//
// The 44px page title belongs to Topbar, so nothing here repeats it.

const PLANS = [
  { key: 'starter', label: msg`Starter · solo lealtad` },
  { key: 'growth', label: msg`Growth · lealtad + dashboard` },
  { key: 'pro', label: msg`Pro · todo` },
];

// The same swatches the Settings screen offers, so a café opened here and one
// edited there are drawn from one palette.
const PRESET_COLORS = [
  '#B5605A',
  '#223979',
  '#7692CB',
  '#5B7A4C',
  '#B5812A',
  '#1F1410',
  '#A8463F',
  '#2D5F8F',
];

const BLANK = {
  name: '',
  city: '',
  timezone: 'America/Mexico_City',
  plan: 'growth',
  cardPrefix: '',
  primaryColor: '#223979',
  adminName: '',
  adminEmail: '',
  adminPassword: '',
  locationName: '',
};

/**
 * A band label inside the sheet. Three groups, because nine fields in one flat
 * list make the reader hold the whole form at once: what the café IS, what it
 * SELLS, and who ADMINISTERS it are three separate questions.
 *
 * `.eyebrow` is an existing class, and this is structure rather than
 * instruction — the house rule forbids visible text that explains the UI, and a
 * group name names its fields, which is what a label does.
 */
function Band({ children }) {
  return (
    <div className="eyebrow" style={{ marginTop: 6 }}>
      {children}
    </div>
  );
}

function NewCafeSheet({ onClose, onCreated }) {
  const { t, i18n } = useLingui();
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const firstField = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  // Escape closes. That is the one keyboard behaviour a panel like this owes the
  // reader, and the only one hand-written here.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await provisionCafe({
        name: form.name.trim(),
        city: form.city.trim() || undefined,
        timezone: form.timezone.trim() || undefined,
        plan: form.plan,
        cardPrefix: form.cardPrefix.trim().toUpperCase(),
        primaryColor: form.primaryColor,
        adminEmail: form.adminEmail.trim(),
        adminPassword: form.adminPassword,
        adminName: form.adminName.trim() || undefined,
        locations: form.locationName.trim() ? [{ name: form.locationName.trim() }] : undefined,
      });
      onCreated();
    } catch (err) {
      // Every refusal from this route carries a sentence; `err.code` is there
      // when a caller wants to branch, and the sentence is what a person reads.
      setError(err.message || t`No se pudo abrir el café.`);
      setSaving(false);
    }
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={saving ? undefined : onClose} />
      <form
        className="sheet"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-cafe-title"
      >
        <div className="sheet-head">
          <div className="titles">
            {' '}
            <h2 id="new-cafe-title" style={{ margin: '6px 0 0' }}>
              <Trans>Abrir café</Trans>
            </h2>
          </div>
          <button
            type="button"
            className="btn-icon focusable"
            onClick={onClose}
            aria-label={t`Cerrar`}
            disabled={saving}
          >
            <I.X size={18} />
          </button>
        </div>

        <div className="sheet-body">
          <Band>
            <Trans>El café</Trans>
          </Band>
          <div className="field">
            <label htmlFor="cafe-name">
              <Trans>Nombre del café</Trans>
            </label>
            <input
              id="cafe-name"
              ref={firstField}
              className="input"
              value={form.name}
              onChange={set('name')}
              required
              minLength={2}
              maxLength={100}
            />
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="cafe-city">
                <Trans>Ciudad · opcional</Trans>
              </label>
              <input
                id="cafe-city"
                className="input"
                value={form.city}
                onChange={set('city')}
                maxLength={100}
              />
            </div>
            <div className="field">
              <label htmlFor="cafe-tz">
                <Trans>Zona horaria</Trans>
              </label>
              <input
                id="cafe-tz"
                className="input"
                value={form.timezone}
                onChange={set('timezone')}
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="cafe-location">
              <Trans>Primera sucursal · opcional</Trans>
            </label>
            <input
              id="cafe-location"
              className="input"
              value={form.locationName}
              onChange={set('locationName')}
              maxLength={100}
            />
          </div>

          <Band>
            <Trans>Plan y marca</Trans>
          </Band>
          <div className="field">
            <label htmlFor="cafe-plan">
              <Trans>Plan · decide qué productos tiene el café</Trans>
            </label>
            <select id="cafe-plan" className="select" value={form.plan} onChange={set('plan')}>
              {PLANS.map((p) => (
                <option key={p.key} value={p.key}>
                  {i18n._(p.label)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="cafe-prefix">
              <Trans>Prefijo de tarjeta · solo letras</Trans>
            </label>
            <input
              id="cafe-prefix"
              className="input"
              value={form.cardPrefix}
              onChange={set('cardPrefix')}
              required
              minLength={2}
              maxLength={5}
              pattern="[A-Za-z]{2,5}"
              style={{ textTransform: 'uppercase', maxWidth: 180 }}
            />
          </div>

          <div className="field">
            <span className="field-label">
              <Trans>Color principal · fondo de la tarjeta</Trans>
            </span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className="focusable"
                  aria-label={t`Color principal ${c}`}
                  aria-pressed={form.primaryColor === c}
                  onClick={() => setForm((f) => ({ ...f, primaryColor: c }))}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: c,
                    border:
                      form.primaryColor === c
                        ? '2px solid var(--ink-1)'
                        : '1px solid var(--line-strong)',
                  }}
                />
              ))}
            </div>
          </div>

          <Band>
            <Trans>Quién lo administra</Trans>
          </Band>
          <div className="field">
            <label htmlFor="cafe-admin-name">
              <Trans>Nombre del dueño · opcional</Trans>
            </label>
            <input
              id="cafe-admin-name"
              className="input"
              value={form.adminName}
              onChange={set('adminName')}
              maxLength={100}
            />
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="cafe-admin-email">
                <Trans>Correo del dueño · su acceso</Trans>
              </label>
              <input
                id="cafe-admin-email"
                className="input"
                type="email"
                value={form.adminEmail}
                onChange={set('adminEmail')}
                required
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="cafe-admin-pw">
                <Trans>Contraseña · 8 caracteres o más</Trans>
              </label>
              <input
                id="cafe-admin-pw"
                className="input"
                type="password"
                value={form.adminPassword}
                onChange={set('adminPassword')}
                required
                minLength={8}
                maxLength={100}
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>

        <div className="sheet-foot">
          {/* The refusal sits where the action is, not in a corner toast. */}
          {error ? (
            <span
              role="alert"
              style={{
                flex: 1,
                fontSize: 12.5,
                color: 'var(--danger)',
                textAlign: 'left',
                alignSelf: 'center',
              }}
            >
              {error}
            </span>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            <Trans>Cancelar</Trans>
          </button>
          <button type="submit" className="btn btn-primary focusable" disabled={saving}>
            {saving ? <Trans>Abriendo…</Trans> : <Trans>Abrir café</Trans>}
          </button>
        </div>
      </form>
    </>
  );
}

const CafesScreen = () => {
  const { t } = useLingui();
  const merchantState = useMerchant();
  const [refresh, setRefresh] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { data, loading, error } = useCafes(refresh);
  const cafes = data?.cafes || [];

  // The route is reachable by URL whether or not the sidebar offers it, so the
  // screen states the same refusal the API would. Nothing renders before it.
  if (merchantState?.platformRole !== 'super_admin') {
    return (
      <div className="alert danger">
        <span className="strip" />
        <I.AlertTriangle className="ico" size={18} />
        <div className="body">
          <div className="ttl">
            <Trans>Acceso de plataforma requerido</Trans>
          </div>
          <div className="sub">
            <Trans>Esta pantalla es para operadores de Umi.</Trans>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <RegionHead
        title={t`Cafés en la plataforma`}
        note={loading ? t`Cargando…` : t`Todos los cafés que opera Umi.`}
        count={{ value: cafes.length, label: t`cafés` }}
        actions={
          <button className="btn btn-primary focusable" onClick={() => setSheetOpen(true)}>
            <I.Plus size={16} /> <Trans>Abrir café</Trans>
          </button>
        }
      />

      {error ? (
        <div className="alert danger">
          <span className="strip" />
          <I.AlertTriangle className="ico" size={18} />
          <div className="body">
            <div className="ttl">
              <Trans>No se pudieron cargar los cafés</Trans>
            </div>
            <div className="sub">{error}</div>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {!cafes.length && !loading ? (
          // An empty state with one clear next action, not a shrug.
          <div style={{ padding: '48px 32px', textAlign: 'center', color: 'var(--ink-3)' }}>
            <div style={{ marginBottom: 14 }}>
              <Trans>Todavía no hay cafés.</Trans>
            </div>
            <button className="btn btn-primary focusable" onClick={() => setSheetOpen(true)}>
              <I.Plus size={16} /> <Trans>Abrir el primero</Trans>
            </button>
          </div>
        ) : (
          <table className="matrix">
            {/* THREE COLUMNS, and the fourth was cut on purpose. A `Rol` column
                showed the READER's role at each café — nothing about the café —
                and it carried no drill-down or action, which every element here
                owes. It also pushed the table to 495px inside a 360px card whose
                `overflow` is hidden, so on a narrow window it was clipped and
                unreachable. The sibling roster fits at 360; this now does too. */}
            <thead>
              <tr>
                <th style={{ width: '45%' }}>
                  <Trans>Café</Trans>
                </th>
                <th>
                  <Trans>Dirección pública</Trans>
                </th>
                <th>
                  <Trans>Zona horaria</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {cafes.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ color: c.handle ? 'var(--ink-2)' : 'var(--ink-3)' }}>
                    {/* A café opened after the cutover has no handle and is reached
                        by id. Saying so beats an em dash that explains nothing. */}
                    {c.handle ? '/' + c.handle : <Trans>por id</Trans>}
                  </td>
                  {/* `America/Mexico_City` carries no space, so it cannot wrap on
                      its own and held the table 7px wider than the card that
                      clips it. Breaking anywhere costs nothing here and is what
                      keeps the last column whole on a narrow window. */}
                  <td style={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
                    {c.timezone || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sheetOpen ? (
        <NewCafeSheet
          onClose={() => setSheetOpen(false)}
          onCreated={() => {
            setSheetOpen(false);
            setRefresh((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
};

export default CafesScreen;
