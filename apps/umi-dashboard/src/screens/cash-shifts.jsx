import { DomainWorkspace } from './operations-workspace.jsx';
import CajaTurnos from './caja-turnos.jsx';
import Registros from './registros.jsx';

// Caja y turnos — the cash-custody lens. Not tabs: the sidebar carries a nested dropdown
// (Turnos de caja · Registros), and each sub-route renders here. Cash movement stays
// POS-only by product policy; here the owner reads the record and governs.
export default function CashShiftsScreen({ view = 'cash_shifts' }) {
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16, '--merchant-brand': '#0F5BFF' }}>
      {view === 'cash_shifts' ? (
        <CajaTurnos />
      ) : view === 'registers' ? (
        <Registros />
      ) : (
        <DomainWorkspace key={view} domain={view} />
      )}
    </div>
  );
}
