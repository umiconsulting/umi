import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useOperationsData } from '@/data.jsx';

// Caja y turnos → Registros — the physical drawers: which are in use, how much moves through
// each, and the no-sale opens that signal shrinkage. Read-only: the register is governed from
// the POS; here the owner watches custody and exceptions. One lens per drawer.

const STATUS_LABEL = {
  available: msg`Disponible`,
  in_use: msg`En uso`,
  reconciliation_required: msg`Conciliación`,
  blocked: msg`Bloqueado`,
  archived: msg`Archivado`,
};
const ATTENTION = new Set(['reconciliation_required', 'blocked']);

/** A boxed pulse tile: label over a big mono figure. */
function Stat({ label, value, tone }) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: '14px 16px',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div className="eyebrow">{label}</div>
      <div
        className="figures"
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          fontSize: 24,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          color: tone || 'var(--ink-1)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const { i18n } = useLingui();
  const label = STATUS_LABEL[status] ? i18n._(STATUS_LABEL[status]) : String(status || '').replaceAll('_', ' ');
  const attn = ATTENTION.has(status);
  const inUse = status === 'in_use';
  return (
    <span
      className="sub-pill"
      style={{
        background: attn
          ? 'color-mix(in srgb, var(--danger) 16%, transparent)'
          : inUse
            ? 'color-mix(in srgb, var(--merchant-brand) 14%, transparent)'
            : 'var(--surface-2)',
        color: attn ? 'var(--danger)' : inUse ? 'var(--merchant-brand)' : 'var(--ink-3)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export default function Registros() {
  const state = useOperationsData('registers', 0, 0, false);
  const items = state.data?.items || [];

  const inUse = items.filter((i) => i.status === 'in_use').length;
  const available = items.filter((i) => i.status === 'available').length;
  const movements = items.reduce((sum, i) => sum + (i.facts?.movements ?? 0), 0);
  const noSale = items.reduce((sum, i) => sum + (i.facts?.noSaleOpens ?? 0), 0);
  const attention = items.filter((i) => ATTENTION.has(i.status)).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Stat label={<Trans>Cajas en uso</Trans>} value={inUse} tone={inUse ? 'var(--merchant-brand)' : undefined} />
        <Stat label={<Trans>Disponibles</Trans>} value={available} />
        <Stat label={<Trans>Movimientos</Trans>} value={movements} />
        <Stat
          label={<Trans>Aperturas sin venta</Trans>}
          value={noSale}
          tone={noSale ? 'var(--danger)' : undefined}
        />
      </div>

      {state.loading && !state.loaded ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '20px 4px' }}>
          <Trans>Cargando cajas…</Trans>
        </div>
      ) : !items.length ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '20px 4px' }}>
          <Trans>No hay cajas registradoras en esta vista.</Trans>
        </div>
      ) : (
        <>
          <div
            style={{
              fontSize: 15,
              color: noSale ? 'var(--danger)' : attention ? 'var(--warning)' : 'var(--ink-2)',
            }}
          >
            {noSale > 0 ? (
              <Trans>{noSale} aperturas de cajón sin venta — conviene revisarlas.</Trans>
            ) : attention > 0 ? (
              <Trans>{attention} cajas requieren conciliación.</Trans>
            ) : (
              <Trans>Cajas en orden. Ninguna apertura de cajón sin venta.</Trans>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {items.map((item) => {
              const moves = item.facts?.movements ?? 0;
              const opens = item.facts?.noSaleOpens ?? 0;
              const attn = ATTENTION.has(item.status);
              return (
                <div
                  key={item.id}
                  className="card"
                  style={{
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                    borderColor: attn ? 'var(--danger)' : opens ? 'var(--warning)' : 'var(--line)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {item.publicReference}
                      </div>
                    </div>
                    <StatusPill status={item.status} />
                  </div>
                  <div style={{ display: 'flex', gap: 24 }}>
                    <div>
                      <div className="eyebrow">
                        <Trans>Movimientos</Trans>
                      </div>
                      <div className="figures" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 18, marginTop: 4 }}>
                        {moves}
                      </div>
                    </div>
                    <div>
                      <div className="eyebrow">
                        <Trans>Sin venta</Trans>
                      </div>
                      <div
                        className="figures"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 600,
                          fontSize: 18,
                          marginTop: 4,
                          color: opens ? 'var(--danger)' : 'var(--ink-1)',
                        }}
                      >
                        {opens}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: 0, maxWidth: '64ch' }}>
            <Trans>
              Cada caja es un cajón físico. El movimiento y las aperturas sin venta se registran en el
              POS; aquí vigilas la custodia y las excepciones.
            </Trans>
          </p>
        </>
      )}
    </div>
  );
}
