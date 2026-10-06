export type CommandContextType =
  'pos_device' | 'dashboard_administrative' | 'kds_device' | 'system_worker';

export interface AdministrativeCommandPolicy {
  operation: string;
  contexts: readonly CommandContextType[];
  permission: string;
  stepUp: boolean;
  approval: boolean;
  actorSeparation: boolean;
  remotePhysicalExecution: boolean;
  domainConditionalApproval: boolean;
}

const DASHBOARD_AND_POS = ['dashboard_administrative', 'pos_device'] as const;
const DASHBOARD = ['dashboard_administrative'] as const;

export const ADMINISTRATIVE_COMMAND_POLICIES: readonly AdministrativeCommandPolicy[] = [
  policy('register.configure', DASHBOARD, 'register.manage'),
  policy('hardware.update', DASHBOARD, 'hardware.manage'),
  policy('hardware.assign', DASHBOARD, 'hardware.assign'),
  policy(
    'hardware.diagnostic',
    DASHBOARD_AND_POS,
    'hardware.diagnostics',
    false,
    false,
    false,
    true,
  ),
  policy('hardware.command.status', DASHBOARD, 'hardware.read'),
  policy('gift_card.reveal', DASHBOARD, 'gift_card.issue'),
  policy(
    'hardware.printer.test',
    DASHBOARD_AND_POS,
    'hardware.printer.test',
    false,
    false,
    false,
    true,
  ),
  policy(
    'hardware.printer.reprint',
    DASHBOARD_AND_POS,
    'hardware.printer.reprint',
    false,
    false,
    false,
    true,
  ),
  policy(
    'inventory.adjustment',
    DASHBOARD_AND_POS,
    'inventory.adjust.increase',
    false,
    false,
    false,
    false,
    true,
  ),
  policy('inventory.overview', DASHBOARD_AND_POS, 'inventory.read'),
  policy('inventory.preview', DASHBOARD, 'inventory.read'),
  policy(
    'inventory.waste',
    DASHBOARD_AND_POS,
    'inventory.waste.create',
    false,
    false,
    false,
    false,
    true,
  ),
  policy(
    'inventory.damage',
    DASHBOARD_AND_POS,
    'inventory.damage.create',
    false,
    false,
    false,
    false,
    true,
  ),
  policy(
    'inventory.quarantine',
    DASHBOARD_AND_POS,
    'inventory.quarantine.enter',
    false,
    false,
    false,
    false,
    true,
  ),
  policy('inventory.count.create', DASHBOARD_AND_POS, 'inventory.count.create'),
  policy('inventory.count.submit', DASHBOARD_AND_POS, 'inventory.count.submit'),
  policy(
    'inventory.count.reconcile',
    DASHBOARD_AND_POS,
    'inventory.count.reconcile',
    false,
    false,
    false,
    false,
    true,
  ),
  policy('inventory.recovery', DASHBOARD_AND_POS, 'inventory.read'),
  policy('inventory.adjustment.approval', DASHBOARD, 'inventory.adjust.increase', true, true, true),
  policy('inventory.waste.approval', DASHBOARD, 'inventory.waste.create', true, true, true),
  policy('inventory.damage.approval', DASHBOARD, 'inventory.damage.create', true, true, true),
  policy(
    'inventory.quarantine.approval',
    DASHBOARD,
    'inventory.quarantine.enter',
    true,
    true,
    true,
  ),
  policy('inventory.count.approval', DASHBOARD, 'inventory.count.reconcile', true, true, true),
  policy('refund.preview', DASHBOARD_AND_POS, 'sale.exception.read'),
  policy('refund.eligibility', DASHBOARD_AND_POS, 'sale.exception.read'),
  policy('refund.approval', DASHBOARD_AND_POS, 'sale.exception.read', true, true, true),
  policy(
    'refund.commit',
    DASHBOARD_AND_POS,
    'sale.exception.read',
    false,
    false,
    false,
    false,
    true,
  ),
  policy('refund.recovery', DASHBOARD_AND_POS, 'sale.exception.read'),
  policy(
    'loyalty.adjustment',
    DASHBOARD_AND_POS,
    'loyalty.adjust',
    false,
    false,
    false,
    false,
    true,
  ),
  policy('loyalty.adjustment.preview', DASHBOARD, 'loyalty.adjust'),
  policy('loyalty.adjustment.approval', DASHBOARD, 'loyalty.adjust', true, true, true),
  policy(
    'gift_card.promotional_issue',
    DASHBOARD_AND_POS,
    'gift_card.issue',
    false,
    false,
    false,
    false,
    true,
  ),
  policy('gift_card.promotional_issue.preview', DASHBOARD, 'gift_card.issue'),
  policy('gift_card.promotional_issue.approval', DASHBOARD, 'gift_card.issue', true, true, true),
  policy('gift_card.recovery', DASHBOARD_AND_POS, 'gift_card.read'),
  policy('kitchen.station.create', DASHBOARD, 'kitchen.station.manage'),
  policy('kitchen.station.update', DASHBOARD, 'kitchen.station.manage'),
  policy('kitchen.route.update', DASHBOARD, 'kitchen.station.manage'),
  policy('kitchen.device.assign', DASHBOARD, 'kitchen.station.manage'),
  policy('catalog.create', DASHBOARD, 'catalog.manage'),
  policy('catalog.detail', DASHBOARD, 'catalog.manage'),
  policy('catalog.update', DASHBOARD, 'catalog.manage'),
  policy('catalog.archive', DASHBOARD, 'catalog.manage'),
  // Recipes and inventory authoring (recipes module plan §11, phase 1). The console
  // authors; the till operates. The permissions are the ones migration 76 seeded to
  // owner, admin and manager, so the console's own staff hold them.
  policy('inventory.item.create', DASHBOARD, 'inventory.item.manage'),
  policy('inventory.item.update', DASHBOARD, 'inventory.item.manage'),
  policy('inventory.item.archive', DASHBOARD, 'inventory.item.manage'),
  policy('inventory.conversion.set', DASHBOARD, 'inventory.conversion.manage'),
  policy('inventory.allergen.set', DASHBOARD, 'inventory.recipe.manage'),
  policy('inventory.item_allergen.set', DASHBOARD, 'inventory.recipe.manage'),
  // Recipes (plan §11, phase 2). An edit is a new version, so no approval gate is
  // added here: the console authors, and the version the caller read is the guard.
  policy('inventory.recipe.create', DASHBOARD, 'inventory.recipe.manage'),
  policy('inventory.recipe.update', DASHBOARD, 'inventory.recipe.manage'),
  policy('inventory.recipe.retire', DASHBOARD, 'inventory.recipe.manage'),
  // Production (plan §11, phase 3). The kitchen produces, and the console posts the same
  // batch the till would; both surfaces call one service method, so a batch is authored
  // once. `inventory.production.produce` is the key migration 76 grants to the four
  // roles that work the kitchen.
  policy('inventory.production.produce', DASHBOARD, 'inventory.production.produce'),
  // Supplier invoices (plan §11, phase 5). The console captures a supplier's document,
  // lets a person correct the proposed matches, and commits the receipt that prices the
  // stock. CAPTURE AND APPROVAL ARE SEPARATE KEYS on purpose: the person who uploads a
  // document is not always the person who accepts the cost it sets, and migration 76
  // grants `inventory.invoice.approve` to owner and admin alone.
  policy('inventory.invoice.upload', DASHBOARD, 'inventory.invoice.capture'),
  policy('inventory.invoice.match', DASHBOARD, 'inventory.invoice.capture'),
  policy('inventory.invoice.commit', DASHBOARD, 'inventory.invoice.approve'),
  policy('recovery.query_original', DASHBOARD_AND_POS, 'audit.read'),
] as const;

export function administrativeCommandPolicy(operation: string): AdministrativeCommandPolicy | null {
  return ADMINISTRATIVE_COMMAND_POLICIES.find((entry) => entry.operation === operation) ?? null;
}

function policy(
  operation: string,
  contexts: readonly CommandContextType[],
  permission: string,
  stepUp = false,
  approval = false,
  actorSeparation = false,
  remotePhysicalExecution = false,
  domainConditionalApproval = false,
): AdministrativeCommandPolicy {
  return {
    operation,
    contexts,
    permission,
    stepUp,
    approval,
    actorSeparation,
    remotePhysicalExecution,
    domainConditionalApproval,
  };
}
