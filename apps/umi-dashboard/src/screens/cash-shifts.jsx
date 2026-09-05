import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { HubTabs } from '@/shell.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';

// Caja y turnos — the money side of the day. It gives sales, receipts, refunds,
// cash shifts, and registers a single home. Each tab renders the same authorized
// workspace the API backs. Cash movement stays POS-only by product policy; here
// the owner reads the record and runs the authorized Dashboard actions.
const TABS = [
  { id: 'sales', label: msg`Ventas` },
  { id: 'receipts', label: msg`Recibos` },
  { id: 'refunds_voids', label: msg`Reembolsos` },
  { id: 'cash_shifts', label: msg`Turnos de caja` },
  { id: 'registers', label: msg`Registros` },
];

export default function CashShiftsScreen() {
  const { t, i18n } = useLingui();
  const [tab, setTab] = useState('sales');
  const tabs = TABS.map((item) => ({ ...item, label: i18n._(item.label) }));
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <HubTabs tabs={tabs} active={tab} onChange={setTab} ariaLabel={t`Caja y turnos`} />
      <DomainWorkspace key={tab} domain={tab} />
    </div>
  );
}
