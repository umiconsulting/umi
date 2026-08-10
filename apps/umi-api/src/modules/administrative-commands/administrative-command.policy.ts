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
}

const DASHBOARD_AND_POS = ['dashboard_administrative', 'pos_device'] as const;
const DASHBOARD = ['dashboard_administrative'] as const;

export const ADMINISTRATIVE_COMMAND_POLICIES: readonly AdministrativeCommandPolicy[] = [
  policy('register.configure', DASHBOARD, 'register.manage'),
  policy('hardware.register', DASHBOARD, 'hardware.manage'),
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
  policy('hardware.drawer.test', DASHBOARD_AND_POS, 'hardware.drawer.test', true, true, true, true),
  policy('inventory.adjustment', DASHBOARD_AND_POS, 'inventory.adjust.increase', true, true, true),
  policy('inventory.waste', DASHBOARD_AND_POS, 'inventory.waste.create', true, true, true),
  policy('inventory.damage', DASHBOARD_AND_POS, 'inventory.damage.create', true, true, true),
  policy('inventory.quarantine', DASHBOARD_AND_POS, 'inventory.quarantine.enter', true, true, true),
  policy('inventory.count.create', DASHBOARD_AND_POS, 'inventory.count.create'),
  policy('inventory.count.submit', DASHBOARD_AND_POS, 'inventory.count.submit'),
  policy(
    'inventory.count.reconcile',
    DASHBOARD_AND_POS,
    'inventory.count.reconcile',
    true,
    true,
    true,
  ),
  policy('refund.preview', DASHBOARD_AND_POS, 'sale.exception.read'),
  policy('refund.approval', DASHBOARD_AND_POS, 'sale.refund.approve', true, true, true),
  policy('refund.commit', DASHBOARD_AND_POS, 'sale.exception.read', true, true, true),
  policy('refund.recovery', DASHBOARD_AND_POS, 'sale.exception.read'),
  policy('loyalty.adjustment', DASHBOARD_AND_POS, 'loyalty.points.adjust', true, true, true),
  policy(
    'gift_card.promotional_issue',
    DASHBOARD_AND_POS,
    'gift_card.issue.promotional',
    true,
    true,
    true,
  ),
  policy('gift_card.suspend', DASHBOARD, 'gift_card.suspend', true, false),
  policy('gift_card.recovery', DASHBOARD_AND_POS, 'gift_card.recovery.read'),
  policy('wallet.recovery', DASHBOARD_AND_POS, 'wallet.read'),
  policy('kitchen.station.create', DASHBOARD, 'kitchen.station.manage'),
  policy('kitchen.station.update', DASHBOARD, 'kitchen.station.manage'),
  policy('kitchen.route.update', DASHBOARD, 'kitchen.station.manage'),
  policy('kitchen.device.assign', DASHBOARD, 'kitchen.station.manage'),
  policy('catalog.create', DASHBOARD, 'catalog.write'),
  policy('catalog.update', DASHBOARD, 'catalog.write'),
  policy('catalog.archive', DASHBOARD, 'catalog.write'),
  policy('recovery.query_original', DASHBOARD_AND_POS, 'audit.read'),
  policy('recovery.retry_known_safe', DASHBOARD_AND_POS, 'audit.read', true),
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
): AdministrativeCommandPolicy {
  return {
    operation,
    contexts,
    permission,
    stepUp,
    approval,
    actorSeparation,
    remotePhysicalExecution,
  };
}
