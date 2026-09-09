import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { HubTabs } from '@/shell.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';
import CategoriesWorkspace from './categories-workspace.jsx';

// Catálogo e inventario — what the shop sells and what it holds. These two domains
// had no home except the operations browser; here they get a real one. Direct
// inventory mutations stay online-only by product policy. "Categorías" is the
// owner-facing home for the POS colour, populated from the products' categories.
const TABS = [
  { id: 'catalog', label: msg`Catálogo` },
  { id: 'categories', label: msg`Categorías` },
  { id: 'inventory', label: msg`Inventario` },
];

export default function CatalogInventoryScreen() {
  const { t, i18n } = useLingui();
  const [tab, setTab] = useState('catalog');
  const tabs = TABS.map((item) => ({ ...item, label: i18n._(item.label) }));
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <HubTabs tabs={tabs} active={tab} onChange={setTab} ariaLabel={t`Catálogo e inventario`} />
      {tab === 'categories' ? <CategoriesWorkspace /> : <DomainWorkspace key={tab} domain={tab} />}
    </div>
  );
}
