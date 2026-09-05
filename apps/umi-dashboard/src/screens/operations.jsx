import { useState } from 'react';
import { useOperationsData } from '@/data.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';

/**
 * Centro operativo — the Gate 5A proof surface: every operational domain reachable
 * through one authorized read model. This is now a BRIDGE. Each domain is moving to
 * its own hub (Caja y turnos, Catálogo e inventario, Lealtad y valor, Diagnóstico…),
 * and this screen is removed once every domain has a home. It reuses the same
 * `DomainWorkspace` the hubs render, so the two never drift.
 */
export default function OperationsScreen() {
  const [domain, setDomain] = useState('organization');
  const state = useOperationsData(domain, 0, 0, false);
  const domains = state.data?.domains || [];

  return (
    <div className="fade-up" style={{ display: 'grid', gap: 18 }}>
      <section className="card" style={{ padding: 22 }}>
        <h2 style={{ margin: '0 0 6px' }}>Centro operativo</h2>
        <p style={{ margin: 0, color: 'var(--ink-3)', maxWidth: 760 }}>
          Vista puente. Cada dominio se está moviendo a su propia sección. La API mantiene la
          autoridad; el Dashboard muestra datos seguros y acciones autorizadas.
        </p>
      </section>

      <div className="operations-layout">
        <nav
          className="card"
          aria-label="Dominios operativos"
          style={{ padding: 10, alignSelf: 'start' }}
        >
          {domains.map((item) => (
            <button
              key={item.domain}
              type="button"
              className={'side-item focusable' + (domain === item.domain ? ' active' : '')}
              onClick={() => setDomain(item.domain)}
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
              <span className="label">{item.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 9 }}>{item.priority}</span>
            </button>
          ))}
        </nav>

        <DomainWorkspace key={domain} domain={domain} />
      </div>
    </div>
  );
}
