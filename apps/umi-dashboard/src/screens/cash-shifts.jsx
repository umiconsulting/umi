import { useState } from 'react';
import { HubTabs } from '@/shell.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';

// Caja y turnos — the money side of the day. It gives sales, receipts, refunds,
// cash shifts, and registers a single home. Each tab renders the same authorized
// workspace the API backs. Cash movement stays POS-only by product policy; here
// the owner reads the record and runs the authorized Dashboard actions.
const TABS = [
  { id: 'sales', label: 'Ventas' },
  { id: 'receipts', label: 'Recibos' },
  { id: 'refunds_voids', label: 'Reembolsos' },
  { id: 'cash_shifts', label: 'Turnos de caja' },
  { id: 'registers', label: 'Registros' },
];

export default function CashShiftsScreen() {
  const [tab, setTab] = useState('sales');
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <HubTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Caja y turnos" />
      <DomainWorkspace key={tab} domain={tab} />
    </div>
  );
}
