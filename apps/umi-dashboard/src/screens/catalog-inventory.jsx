import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { HubTabs } from '@/shell.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';
import CategoriesWorkspace from './categories-workspace.jsx';
import InventoryWorkspace from './inventory-workspace.jsx';
import RecipeWorkspace from './recipe-workspace.jsx';
import PrepListWorkspace from './prep-list.jsx';
import InvoiceInbox from './invoice-inbox.jsx';

// Catálogo e inventario — what the shop sells and what it holds. These two domains
// had no home except the operations browser; here they get a real one. Direct
// inventory mutations stay online-only by product policy. "Categorías" is the
// owner-facing home for the POS colour, populated from the products' categories.
// "Recetas" joins them in Phase 2: the owner builds a recipe and a sub-recipe and
// sees the true plate cost and margin while typing (recipes module plan §7).
// "Preparación" is the kitchen board of Phase 3: the prep list and the printed
// label sheet (recipes module plan §8.3, §8.4 and D14).
// "Facturas" is the supplier-invoice inbox of Phase 5: an uploaded CFDI XML, its
// lines, the match state of each line and the price changes (plan §7 and §10).
const TABS = [
  { id: 'catalog', label: msg`Catálogo` },
  { id: 'categories', label: msg`Categorías` },
  { id: 'inventory', label: msg`Inventario` },
  { id: 'recipes', label: msg`Recetas` },
  { id: 'prep', label: msg`Preparación` },
  { id: 'invoices', label: msg`Facturas` },
];

export default function CatalogInventoryScreen() {
  const { t, i18n } = useLingui();
  const [tab, setTab] = useState('catalog');
  const tabs = TABS.map((item) => ({ ...item, label: i18n._(item.label) }));
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <HubTabs tabs={tabs} active={tab} onChange={setTab} ariaLabel={t`Catálogo e inventario`} />
      {tab === 'categories' ? (
        <CategoriesWorkspace />
      ) : tab === 'inventory' ? (
        <InventoryWorkspace />
      ) : tab === 'recipes' ? (
        <RecipeWorkspace />
      ) : tab === 'prep' ? (
        <PrepListWorkspace />
      ) : tab === 'invoices' ? (
        <InvoiceInbox />
      ) : (
        <DomainWorkspace key={tab} domain={tab} />
      )}
    </div>
  );
}
