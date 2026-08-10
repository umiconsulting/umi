import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOperationsData } from '@/data.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { formatOperationDate, formatOperationMoney } from './operations-format.js';

const ACTION_ROUTES = {
  organization: '/settings',
  locations: '/settings',
  memberships: '/staff',
  devices: '/devices',
  customers: '/customers',
  loyalty: '/members',
  rewards: '/members',
  gift_cards: '/gift-cards',
  kitchen: '/orders',
};

const ERROR_COPY = {
  PERMISSION_DENIED: 'No tienes el permiso requerido para esta operación.',
  LOCATION_SCOPE_VIOLATION: 'La ubicación no pertenece a tu alcance.',
  OPTIMISTIC_VERSION_CONFLICT: 'Los datos cambiaron. Actualiza la vista antes de continuar.',
  HARDWARE_OUTCOME_UNKNOWN:
    'El resultado físico es desconocido. Verifica el equipo antes de repetir.',
  RECOVERY_REQUIRED: 'Consulta el comando original en el Centro de recuperación.',
  SERVICE_UNAVAILABLE: 'El servicio no está disponible. Intenta de nuevo después.',
};

function Status({ value }) {
  return <span className="sub-pill">{String(value || 'unknown').replaceAll('_', ' ')}</span>;
}

export default function OperationsScreen() {
  const navigate = useNavigate();
  const merchant = useMerchant();
  const [domain, setDomain] = useState('organization');
  const [cursor, setCursor] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [merchantWide, setMerchantWide] = useState(false);
  const [copied, setCopied] = useState('');
  const state = useOperationsData(domain, cursor, refresh, merchantWide);
  const domains = state.data?.domains || [];
  const selected = domains.find((item) => item.domain === domain);
  const permissions = merchant?.capabilities?.membership?.permissions || [];
  const canUseMerchantScope =
    !merchant?.capabilities?.membership?.locationId &&
    (permissions.includes('*') ||
      permissions.includes('merchant.manage') ||
      permissions.includes('kitchen.merchant.read'));

  function select(next) {
    setDomain(next);
    setCursor(0);
  }

  async function copy(value) {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied(''), 1200);
  }

  return (
    <div className="fade-up" style={{ display: 'grid', gap: 18 }}>
      <section className="card" style={{ padding: 22 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}
        >
          <div>
            <div className="sec-index">
              <span className="nn">21</span>
              <span>/</span>
              <span>DOMINIOS OPERATIVOS</span>
            </div>
            <h2 style={{ margin: '10px 0 6px' }}>Centro operativo</h2>
            <p style={{ margin: 0, color: 'var(--ink-3)', maxWidth: 760 }}>
              La API mantiene la autoridad. El Dashboard muestra datos seguros y acciones
              autorizadas.
            </p>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--ink-3)' }}>
            <div>
              {state.data?.scope === 'merchant'
                ? 'Alcance del merchant'
                : 'Alcance de la ubicación'}
            </div>
            <div>{merchant?.selectedLocation?.name || 'Todas las ubicaciones autorizadas'}</div>
            {canUseMerchantScope && (
              <button
                className="btn"
                type="button"
                aria-pressed={merchantWide}
                onClick={() => {
                  setMerchantWide((value) => !value);
                  setCursor(0);
                }}
                style={{ marginTop: 8 }}
              >
                {merchantWide ? 'Usar ubicación seleccionada' : 'Ver alcance del merchant'}
              </button>
            )}
          </div>
        </div>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(230px, 0.72fr) minmax(0, 2fr)',
          gap: 18,
        }}
      >
        <nav
          className="card"
          aria-label="Dominios operativos"
          style={{ padding: 10, alignSelf: 'start' }}
        >
          {domains.map((item, index) => (
            <button
              key={item.domain}
              type="button"
              className={'side-item focusable' + (domain === item.domain ? ' active' : '')}
              onClick={() => select(item.domain)}
              disabled={!item.available}
              aria-current={domain === item.domain ? 'page' : undefined}
              title={
                item.available ? item.label : `Requiere ${item.requiredPermissions.join(' o ')}`
              }
              style={{
                width: '100%',
                border: 0,
                background: domain === item.domain ? 'var(--canvas-2)' : 'transparent',
                color: item.available ? 'var(--ink-1)' : 'var(--ink-3)',
                opacity: item.available ? 1 : 0.48,
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="label">{item.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 9 }}>{item.priority}</span>
            </button>
          ))}
        </nav>

        <section className="card" style={{ minWidth: 0 }} aria-live="polite">
          <div style={{ padding: 20, borderBottom: '1px solid var(--line)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>{selected?.label || 'Operación'}</h3>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 5 }}>
                  Permiso: {selected?.requiredPermissions?.join(' o ') || '—'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {ACTION_ROUTES[domain] && (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => navigate(ACTION_ROUTES[domain])}
                  >
                    Administrar
                  </button>
                )}
                <button
                  className="btn"
                  type="button"
                  disabled={state.loading}
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  {state.loading ? 'Actualizando…' : 'Actualizar'}
                </button>
              </div>
            </div>
            {selected?.allowedActions?.length ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
                {selected.allowedActions.map((action) => (
                  <span className="sub-pill" key={action}>
                    {action.replaceAll('_', ' ')}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {state.error ? (
            <div style={{ padding: 28, color: 'var(--danger)' }}>
              {ERROR_COPY[state.errorCode] || 'No fue posible cargar esta operación.'}
            </div>
          ) : state.loading && !state.data?.items?.length ? (
            <div style={{ padding: 28, color: 'var(--ink-3)' }}>Cargando datos autorizados…</div>
          ) : !state.data?.items?.length ? (
            <div style={{ padding: 28, color: 'var(--ink-3)' }}>
              No hay datos para este alcance.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}>
                    <th style={{ padding: '12px 16px' }}>Referencia</th>
                    <th>Detalle</th>
                    <th>Estado</th>
                    <th>Importe</th>
                    <th>Fecha</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.map((item) => (
                    <tr key={item.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <strong>{item.title}</strong>
                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            color: 'var(--ink-3)',
                            marginTop: 4,
                          }}
                        >
                          {item.publicReference}
                        </div>
                      </td>
                      <td>{item.detail || '—'}</td>
                      <td>
                        <Status value={item.status} />
                      </td>
                      <td>{formatOperationMoney(item.amountMinorUnits, item.currency)}</td>
                      <td>{formatOperationDate(item.occurredAt)}</td>
                      <td style={{ paddingRight: 14 }}>
                        <button
                          className="btn-icon"
                          type="button"
                          onClick={() => copy(item.correlationId || item.publicReference)}
                          aria-label={`Copiar referencia ${item.publicReference}`}
                        >
                          {copied === (item.correlationId || item.publicReference) ? '✓' : '⧉'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div
            style={{
              padding: 14,
              display: 'flex',
              justifyContent: 'space-between',
              borderTop: '1px solid var(--line)',
            }}
          >
            <button
              className="btn"
              type="button"
              disabled={cursor === 0 || state.loading}
              onClick={() => setCursor(Math.max(0, cursor - 20))}
            >
              Anterior
            </button>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              Página {Math.floor(cursor / 20) + 1} · {permissions.length} permisos efectivos
            </span>
            <button
              className="btn"
              type="button"
              disabled={!state.data?.page?.hasMore || state.loading}
              onClick={() => setCursor(Number(state.data.page.nextCursor))}
            >
              Siguiente
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
