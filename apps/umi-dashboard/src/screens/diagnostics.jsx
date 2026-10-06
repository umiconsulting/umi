import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { HubTabs } from '@/shell.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';

// Diagnóstico — the admin surface for recovery, audit, and diagnostics. Technical
// codes belong here and nowhere else (Design Language V1). It is permission-gated,
// so a plain operator never sees it. Each tab reads the same authorized model.
const TABS = [
  { id: 'recovery', label: msg`Recuperación` },
  { id: 'audit', label: msg`Auditoría` },
  { id: 'diagnostics', label: msg`Diagnóstico` },
];

export default function DiagnosticsScreen() {
  const { t, i18n } = useLingui();
  const [tab, setTab] = useState('recovery');
  const tabs = TABS.map((item) => ({ ...item, label: i18n._(item.label) }));
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <HubTabs tabs={tabs} active={tab} onChange={setTab} ariaLabel={t`Diagnóstico`} />
      <DomainWorkspace key={tab} domain={tab} />
    </div>
  );
}
