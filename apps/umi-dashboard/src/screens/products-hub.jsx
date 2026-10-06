import { useNavigate, useParams } from 'react-router-dom';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { HubTabs } from '@/shell.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';
import CategoriesWorkspace from './categories-workspace.jsx';

/**
 * Productos — what the shop sells, and what it calls it.
 *
 * This hub is half of the split that the design audit of 2026-09-18 made. The old
 * `catalog-inventory` hub held six tabs across three objects and rendered 72
 * controls, the highest count in the dashboard. The product answers one question:
 * "what do I sell?" The stock answers a different one, and it moved to
 * `inventory-hub.jsx`.
 *
 * Sources for the cut: Square names one help topic "Items and inventory"; Shopify
 * nests inventory under Products; Lightspeed, Loyverse, Fudo, and PoloTab keep
 * the two apart because their product and stock records are separate tables, as
 * Umi's are. See docs/research/2026-09-18-catalog-vs-inventory-ia.md.
 */

/** The tab id in the URL maps to the view. The first entry is the hub's home. */
const TABS = [
  { id: 'productos', route: '', label: msg`Productos` },
  { id: 'categorias', route: 'categorias', label: msg`Categorías` },
];

export default function ProductsHub() {
  const { i18n } = useLingui();
  const navigate = useNavigate();
  const { tab } = useParams();
  const active = TABS.find((entry) => entry.route === (tab || '')) || TABS[0];
  const tabs = TABS.map((entry) => ({ id: entry.route, label: i18n._(entry.label) }));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <HubTabs
        tabs={tabs}
        active={active.route}
        onChange={(route) => navigate(route ? `/products/${route}` : '/products')}
        ariaLabel={i18n._(msg`Productos`)}
      />
      {active.id === 'categorias' ? <CategoriesWorkspace /> : <DomainWorkspace domain="catalog" />}
    </div>
  );
}
