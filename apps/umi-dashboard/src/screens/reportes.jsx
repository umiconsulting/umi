import { DomainWorkspace } from './operations-workspace.jsx';
import VentasReport from './ventas-report.jsx';
import Reembolsos from './reembolsos.jsx';

// Reportes — the commercial lens. This is NOT a tabbed hub: the sidebar carries a nested
// dropdown (Ventas · Reembolsos), and each sub-route renders here. Ventas is the default
// page and owns the sales records, including the receipts/print-custody view (reached from
// inside Ventas, not as its own destination). Reembolsos is the loss-prevention lens. See
// ADR 2026-09-08 (Reportes por trabajo, no por documento).
export default function ReportesScreen({ view = 'sales' }) {
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16, '--merchant-brand': '#0F5BFF' }}>
      {view === 'sales' ? (
        <VentasReport />
      ) : view === 'refunds_voids' ? (
        <Reembolsos />
      ) : (
        <DomainWorkspace key={view} domain={view} />
      )}
    </div>
  );
}
