import { useNavigate, useParams } from 'react-router-dom';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { HubTabs } from '@/shell.jsx';
import { hasRequiredPermission } from '@/lib/module-registry.js';
import { useMerchant } from '@/lib/merchant-context.jsx';
import InventoryWorkspace from './inventory-workspace.jsx';
import RecipeWorkspace from './recipe-workspace.jsx';
import PrepListWorkspace from './prep-list.jsx';
import InventoryCostingScreen from './inventory-costing.jsx';
import InvoiceInbox from './invoice-inbox.jsx';
import { NoPermissionNotice } from './inventory-item-editor.jsx';

/**
 * Inventario — what the shop holds, and what it costs.
 *
 * The second half of the split the design audit made. Four things live here
 * because they answer the same question: the articles the shop tracks, the
 * recipes that decide what a sale deducts, the costing that prices those recipes,
 * and the purchases that put stock back.
 *
 * **Why the recipe is here and not with the menu.** A recipe is not a menu object.
 * It is the rule that decides what the shop deducts when a plate is sold. It is a
 * stock mechanic that happens to name a menu item. Both vendors in Umi's own
 * market that document recipes — Fudo and PoloTab — file them under STOCK, not
 * under the menu.
 *
 * **Why costing is here and no longer a top-level destination.** `Costos y
 * márgenes` reads the same objects the articles tab writes. A separate top-level
 * entry split one job across two doors.
 *
 * The costing tab carries its own gate. The four reads behind it need
 * `merchant.manage`, because an `inventory.*` key is carried only by POS operator
 * sessions. A manager who holds `inventory.read` but not `merchant.manage` sees
 * the tab and a sentence that says why it is closed, rather than an empty screen.
 */

const TABS = [
  { id: 'items', route: '', label: msg`Artículos` },
  { id: 'recipes', route: 'recetas', label: msg`Recetas` },
  { id: 'prep', route: 'preparacion', label: msg`Preparación` },
  { id: 'costing', route: 'costos', label: msg`Costos y márgenes`, gate: 'merchant.manage' },
  { id: 'purchases', route: 'compras', label: msg`Compras` },
];

export default function InventoryHub() {
  const { i18n } = useLingui();
  const navigate = useNavigate();
  const merchant = useMerchant();
  const { tab } = useParams();
  const capabilities = merchant?.capabilities || null;
  const active = TABS.find((entry) => entry.route === (tab || '')) || TABS[0];
  const tabs = TABS.map((entry) => ({ id: entry.route, label: i18n._(entry.label) }));
  const canReadCost = hasRequiredPermission({ permissions: ['merchant.manage'] }, capabilities);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <HubTabs
        tabs={tabs}
        active={active.route}
        onChange={(route) => navigate(route ? `/inventory/${route}` : '/inventory')}
        ariaLabel={i18n._(msg`Inventario`)}
      />
      {active.id === 'items' ? <InventoryWorkspace /> : null}
      {active.id === 'recipes' ? <RecipeWorkspace /> : null}
      {active.id === 'prep' ? <PrepListWorkspace /> : null}
      {active.id === 'purchases' ? <InvoiceInbox /> : null}
      {active.id === 'costing' ? (
        canReadCost ? (
          <InventoryCostingScreen />
        ) : (
          <NoPermissionNotice />
        )
      ) : null}
    </div>
  );
}
