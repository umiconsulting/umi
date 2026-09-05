import { useState } from 'react';
import { HubTabs } from '@/shell.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';

// Catálogo e inventario — what the shop sells and what it holds. These two domains
// had no home except the operations browser; here they get a real one. Direct
// inventory mutations stay online-only by product policy.
const TABS = [
  { id: 'catalog', label: 'Catálogo' },
  { id: 'inventory', label: 'Inventario' },
];

export default function CatalogInventoryScreen() {
  const [tab, setTab] = useState('catalog');
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <HubTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Catálogo e inventario" />
      <DomainWorkspace key={tab} domain={tab} />
    </div>
  );
}
