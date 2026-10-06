import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { useAuth, signOut } from '@/lib/auth.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { formatDateTime } from '@/lib/format.js';
import { initialsFrom } from './profile-format.js';

// Tu perfil — the one screen about the PERSON, not the café. It shows every
// piece of personal data the console already holds on the signed-in operator:
// their identity, the businesses they belong to and the role they hold at each,
// the access this café grants them, and how their session is signed in. The
// data is read-only here; the café and language switchers live in the sidebar,
// and account edits are not a dashboard capability yet.
//
// Nothing here is fetched. Every field comes from the session the API already
// sent (auth.jsx) and the capabilities the merchant context already loaded, so
// the screen renders instantly and never shows a spinner.

/** Café membership roles as an operator reads them. Falls back to the raw key. */
const CAFE_ROLE_LABELS = {
  owner: msg`Dueño`,
  admin: msg`Administrador`,
  manager: msg`Encargado`,
  staff: msg`Personal`,
  viewer: msg`Solo lectura`,
};

/** Platform grants — a different axis from the café role. */
const PLATFORM_ROLE_LABELS = {
  super_admin: msg`Super administrador`,
  developer: msg`Desarrollador`,
};

/** How the person signed in. Today the dashboard has one method. */
const PROVIDER_LABELS = {
  local: msg`Correo y contraseña`,
};

function labelFor(i18n, map, key) {
  const descriptor = key ? map[key] : null;
  return descriptor ? i18n._(descriptor) : key || '—';
}

/** One label/value line inside a card. The value keeps its own type — an email,
 *  an id, a date — without being localized. */
function Field({ label, children }) {
  return (
    <div className="profile-field">
      <div className="profile-field-label">{label}</div>
      <div className="profile-field-value">{children}</div>
    </div>
  );
}

/** A wrapped row of role or permission tags. */
function Chips({ items, tone }) {
  return (
    <div className="profile-chips">
      {items.map((item) => (
        <span key={item.key} className={'profile-chip' + (tone ? ' ' + tone : '')}>
          {item.label}
        </span>
      ))}
    </div>
  );
}

export default function ProfileScreen() {
  const { t, i18n } = useLingui();
  const { session } = useAuth();
  const merchantState = useMerchant();

  const user = session?.user || null;
  const displayName = user?.displayName || '';
  const email = user?.email || '';
  const initials = initialsFrom(displayName, email);

  const platformRole = session?.platformRole || null;
  const provider = session?.provider || null;
  const expiresAt = Number(session?.accessExpiresAt) || null;

  const merchants = session?.merchants || [];
  const membership = merchantState?.capabilities?.membership || null;
  const selectedMerchant = merchantState?.selectedMerchant || null;
  const selectedMerchantId = merchantState?.selectedMerchantId || null;

  const permissions = membership?.permissions || [];
  const hasAllPermissions = permissions.includes('*');

  if (!user) {
    return (
      <div className="card" style={{ padding: '32px 28px', color: 'var(--ink-3)' }}>
        <Trans>No hay una sesión activa.</Trans>
      </div>
    );
  }

  const cafeRoleLabel = membership?.role ? labelFor(i18n, CAFE_ROLE_LABELS, membership.role) : null;

  return (
    <div className="fade-up profile" style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      {/* Identity header */}
      <div className="card profile-head">
        <div className="avatar-lg profile-avatar" aria-hidden="true">
          {initials}
        </div>
        <div className="profile-head-body">
          <h2 className="profile-name">{displayName || <Trans>Sin nombre</Trans>}</h2>
          <div className="profile-email">{email}</div>
          <div className="profile-head-roles">
            {platformRole ? (
              <span className="profile-chip platform">
                {labelFor(i18n, PLATFORM_ROLE_LABELS, platformRole)}
              </span>
            ) : null}
            {cafeRoleLabel && selectedMerchant ? (
              <span className="profile-chip">
                {cafeRoleLabel} · {selectedMerchant.name}
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm focusable profile-signout"
          onClick={signOut}
          title={t`Cerrar sesión`}
        >
          <I.Power size={16} />
          <Trans>Cerrar sesión</Trans>
        </button>
      </div>

      {/* Account identity */}
      <div className="card profile-section">
        <h3 className="profile-section-title">
          <Trans>Tu cuenta</Trans>
        </h3>
        <Field label={t`Nombre`}>{displayName || <Trans>Sin nombre</Trans>}</Field>
        <Field label={t`Correo`}>{email}</Field>
        <Field label={t`ID de usuario`}>
          <code className="profile-mono">{user.id}</code>
        </Field>
      </div>

      {/* Access at the selected café */}
      <div className="card profile-section">
        <h3 className="profile-section-title">
          <Trans>Acceso en este café</Trans>
        </h3>
        {membership ? (
          <>
            <Field label={t`Café`}>{selectedMerchant?.name || '—'}</Field>
            <Field label={t`Rol`}>{cafeRoleLabel || '—'}</Field>
            <Field label={t`Permisos`}>
              {hasAllPermissions ? (
                <span className="profile-chip">
                  <Trans>Todos los permisos</Trans>
                </span>
              ) : permissions.length ? (
                <Chips items={permissions.map((key) => ({ key, label: key }))} tone="mono" />
              ) : (
                <span style={{ color: 'var(--ink-3)' }}>
                  <Trans>Sin permisos asignados</Trans>
                </span>
              )}
            </Field>
          </>
        ) : (
          <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>
            <Trans>Selecciona un café para ver tu acceso.</Trans>
          </div>
        )}
      </div>

      {/* Businesses the person belongs to */}
      <div className="card profile-section">
        <h3 className="profile-section-title">
          <Trans>Tus negocios</Trans>
        </h3>
        {merchants.length ? (
          <div className="profile-merchants">
            {merchants.map((merchant) => {
              const isCurrent = merchant.id === selectedMerchantId;
              const roleChips = (merchant.roles || []).map((key) => ({
                key,
                label: labelFor(i18n, CAFE_ROLE_LABELS, key),
              }));
              return (
                <div
                  key={merchant.id}
                  className={'profile-merchant' + (isCurrent ? ' current' : '')}
                >
                  <div className="profile-merchant-main">
                    <span className="profile-merchant-name">{merchant.name}</span>
                    {isCurrent ? (
                      <span className="profile-tag-current">
                        <Trans>Activo</Trans>
                      </span>
                    ) : null}
                  </div>
                  {roleChips.length ? <Chips items={roleChips} /> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>
            <Trans>No perteneces a ningún negocio todavía.</Trans>
          </div>
        )}
      </div>

      {/* Session and sign-in method */}
      <div className="card profile-section">
        <h3 className="profile-section-title">
          <Trans>Sesión</Trans>
        </h3>
        <Field label={t`Método de acceso`}>
          {provider ? labelFor(i18n, PROVIDER_LABELS, provider) : '—'}
        </Field>
        {expiresAt ? (
          <Field label={t`La sesión se renueva`}>{formatDateTime(expiresAt)}</Field>
        ) : null}
      </div>
    </div>
  );
}
