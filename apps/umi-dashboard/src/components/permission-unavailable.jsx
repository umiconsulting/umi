import { Trans, useLingui } from '@lingui/react/macro';
import { PERMISSION_LABELS } from '@/screens/permission-labels.js';

/**
 * A refusal that names the missing authority.
 *
 * The product refusal ("this café does not own Umi Cash") and the permission
 * refusal ("your role cannot read gift cards") are different facts. They used
 * to share one card, so a person with the product but not the key was told the
 * café was not subscribed. This component owns the second sentence.
 *
 * It never renders the protected data, and the action it offers goes to a
 * screen the caller has already proved this membership can open. A refusal
 * without a way back is a dead end, and a way back to the refused screen is a
 * loop.
 */
export default function PermissionUnavailable({
  title,
  permissions = [],
  onBack,
  backLabel,
  compact = false,
}) {
  const { i18n, t } = useLingui();
  const labels = permissions.map((key) =>
    PERMISSION_LABELS[key] ? i18n._(PERMISSION_LABELS[key]) : key,
  );

  return (
    <section
      className="card"
      role="alert"
      aria-live="polite"
      data-permission-unavailable=""
      style={{
        padding: compact ? '24px 26px' : '34px 32px',
        display: 'grid',
        gap: 12,
        maxWidth: 720,
      }}
    >
      <div className="eyebrow">
        <Trans>Acceso restringido</Trans>
      </div>
      <h2 style={{ margin: 0, fontSize: compact ? 20 : 24 }}>
        <Trans>No tienes acceso a</Trans> {title || t`esta sección`}
      </h2>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55 }}>
        <Trans>
          Tu rol no incluye el permiso necesario. Esta pantalla no cargó los datos y el servidor
          también rechaza la lectura.
        </Trans>
      </p>
      {labels.length ? (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            <Trans>Permiso requerido</Trans>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2)', fontSize: 13.5 }}>
            {labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {onBack ? (
        <div>
          <button className="btn btn-secondary" type="button" onClick={onBack}>
            {backLabel ? t`Ir a ${backLabel}` : t`Volver`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
