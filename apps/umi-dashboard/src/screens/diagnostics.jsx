import { useState } from 'react';
import { HubTabs } from '@/shell.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';

// Diagnóstico — the admin surface for recovery, audit, and diagnostics. Technical
// codes belong here and nowhere else (Design Language V1). It is permission-gated,
// so a plain operator never sees it. Each tab reads the same authorized model.
const TABS = [
  { id: 'recovery', label: 'Recuperación' },
  { id: 'audit', label: 'Auditoría' },
  { id: 'diagnostics', label: 'Diagnóstico' },
];

export default function DiagnosticsScreen() {
  const [tab, setTab] = useState('recovery');
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <HubTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Diagnóstico" />
      <DomainWorkspace key={tab} domain={tab} />
    </div>
  );
}
