import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { HubTabs } from '@/shell.jsx';
import { hasRequiredPermission } from '@/lib/module-registry.js';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';

// Diagnóstico — the admin surface for recovery, audit, and diagnostics. Technical
// codes belong here and nowhere else (Design Language V1). It is permission-gated,
// so a plain operator never sees it. Each tab reads the same authorized model.
//
// EACH TAB CARRIES THE PERMISSION ITS DOMAIN ANSWERS WITH, and a tab the role cannot read is not
// drawn. The screen's own gate is `any(audit.read, hardware.diagnostics)` (module-registry), so a
// MANAGER is admitted — and every tab used to be drawn with it, including `recovery` and `audit`,
// whose domain the server answers only for `audit.read` (`dashboard-operations.policy.ts`). The
// manager's Audit tab asked `/operations` and took a 403 (`PERMISSION_DENIED`, exactly what the
// contract's own `operations.audit` row expects), drew "You do not have the permission required
// for this operation." over a Retry that could never succeed, and logged a console error on every
// visit. Found by `tools/ux-sweep/dashboard-role-surfaces.mjs`, which walks all four roles.
const TABS = [
  { id: 'recovery', label: msg`Recuperación`, permissions: ['audit.read'] },
  { id: 'audit', label: msg`Auditoría`, permissions: ['audit.read'] },
  { id: 'diagnostics', label: msg`Diagnóstico`, permissions: ['hardware.diagnostics'] },
];

export default function DiagnosticsScreen() {
  const { t, i18n } = useLingui();
  const merchant = useMerchant();
  const capabilities = merchant?.capabilities;
  const [tab, setTab] = useState(null);
  const allowed = TABS.filter((item) =>
    hasRequiredPermission({ permissions: item.permissions }, capabilities),
  );
  const tabs = allowed.map((item) => ({ ...item, label: i18n._(item.label) }));
  // The module gate has already admitted this screen with at least one of the two permissions, so
  // `allowed` is never empty in practice; the guard keeps the component total when the capability
  // set has not resolved yet.
  const active = allowed.some((item) => item.id === tab) ? tab : allowed[0]?.id;
  if (!active) return null;
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <HubTabs tabs={tabs} active={active} onChange={setTab} ariaLabel={t`Diagnóstico`} />
      <DomainWorkspace key={active} domain={active} />
    </div>
  );
}
