import { z } from 'zod';
import { IsoTimestamp, PageInfo, Uuid } from './platform';

export const DashboardOperationDomain = z.enum([
  'organization',
  'locations',
  'memberships',
  'devices',
  'registers',
  'hardware',
  'catalog',
  'inventory',
  'sales',
  'receipts',
  'refunds_voids',
  'cash_shifts',
  'customers',
  'loyalty',
  'rewards',
  'wallet',
  'gift_cards',
  'kitchen',
  'recovery',
  'audit',
  'diagnostics',
]);
export type DashboardOperationDomain = z.infer<typeof DashboardOperationDomain>;

export const DashboardOperationsQuery = z
  .object({
    domain: DashboardOperationDomain.default('organization'),
    locationId: Uuid.optional(),
    cursor: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type DashboardOperationsQuery = z.infer<typeof DashboardOperationsQuery>;

export const DashboardOperationItem = z
  .object({
    id: z.string().min(1).max(160),
    publicReference: z.string().min(1).max(160),
    title: z.string().min(1).max(240),
    detail: z.string().max(500).nullable(),
    status: z.string().min(1).max(100),
    locationId: Uuid.nullable(),
    occurredAt: IsoTimestamp.nullable(),
    amountMinorUnits: z.number().int().safe().nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    version: z.number().int().nonnegative().nullable(),
    correlationId: z.string().min(1).max(160).nullable(),
    // Per-domain observability payload (the seam): opaque here, typed by each
    // domain's view. cash_shifts carries {operator, register, openingFloatMinorUnits,
    // expectedCashMinorUnits, countedCashMinorUnits, status}. Null when a domain has none.
    facts: z.record(z.unknown()).nullish(),
  })
  .strict();

export const DashboardDomainCoverage = z
  .object({
    domain: DashboardOperationDomain,
    label: z.string().min(1).max(100),
    priority: z.enum(['P0', 'P1', 'P2']),
    available: z.boolean(),
    administrative: z.boolean(),
    boundary: z.enum(['dashboard', 'pos', 'kds']),
    requiredPermissions: z.array(z.string().min(1).max(100)).max(12),
    allowedActions: z.array(z.string().min(1).max(100)).max(24),
    recovery: z.boolean(),
  })
  .strict();

export const DashboardOperationsSnapshot = z
  .object({
    merchantId: Uuid,
    locationId: Uuid.nullable(),
    scope: z.enum(['merchant', 'assigned_location', 'selected_location']),
    domains: z.array(DashboardDomainCoverage).length(21),
    selectedDomain: DashboardOperationDomain,
    items: z.array(DashboardOperationItem).max(50),
    page: PageInfo,
    capturedAt: IsoTimestamp,
  })
  .strict();
export type DashboardOperationsSnapshot = z.infer<typeof DashboardOperationsSnapshot>;

export const DashboardAdministrativeOperation = z.enum([
  'register.configure',
  'hardware.update',
  'hardware.assign',
  'hardware.diagnostic',
  'hardware.command.status',
  'hardware.printer.test',
  'hardware.printer.reprint',
  'inventory.adjustment',
  'inventory.overview',
  'inventory.preview',
  'inventory.waste',
  'inventory.damage',
  'inventory.quarantine',
  'inventory.count.create',
  'inventory.count.submit',
  'inventory.count.reconcile',
  'inventory.recovery',
  'inventory.adjustment.approval',
  'inventory.waste.approval',
  'inventory.damage.approval',
  'inventory.quarantine.approval',
  'inventory.count.approval',
  'refund.preview',
  'refund.eligibility',
  'refund.approval',
  'refund.commit',
  'refund.recovery',
  'loyalty.adjustment',
  'loyalty.adjustment.preview',
  'loyalty.adjustment.approval',
  'gift_card.promotional_issue',
  'gift_card.promotional_issue.preview',
  'gift_card.promotional_issue.approval',
  'gift_card.reveal',
  'gift_card.recovery',
  'kitchen.station.create',
  'kitchen.station.update',
  'kitchen.route.update',
  'kitchen.device.assign',
  'catalog.create',
  'catalog.detail',
  'catalog.update',
  'catalog.archive',
  // Recipes and inventory authoring (recipes module plan §11, phase 1). The console
  // AUTHORS items, their unit conversions and their allergen labels; the till
  // operates. Every one of these is an administrative command, never a write route,
  // because it must be idempotent and audited (plan D15).
  'inventory.item.create',
  'inventory.item.update',
  'inventory.item.archive',
  'inventory.conversion.set',
  'inventory.allergen.set',
  'inventory.item_allergen.set',
  // Recipes (plan §11, phase 2). An edit is a NEW IMMUTABLE VERSION: `update` retires
  // the row the caller read and writes the next version, and `retire` ends the life of
  // the version without deleting it (plan D3).
  'inventory.recipe.create',
  'inventory.recipe.update',
  'inventory.recipe.retire',
  // Production (plan §8.1 and §11, phase 3). The console posts the same batch the
  // till does, through the same door, so a batch is never authored twice.
  'inventory.production.produce',
  // Supplier invoices (plan §10 and §11, phase 5). CAPTURE AND APPROVAL ARE TWO KEYS:
  // migration 76 grants `inventory.invoice.approve` to owner and admin alone, so the
  // person who uploads a supplier's document is not necessarily the person who accepts
  // the price it sets.
  'inventory.invoice.upload',
  'inventory.invoice.match',
  'inventory.invoice.commit',
  'recovery.query_original',
]);

export const DashboardAdministrativeCommandRequest = z
  .object({
    operation: DashboardAdministrativeOperation,
    locationId: Uuid.nullable(),
    targetAggregateId: Uuid,
    targetVersion: z.number().int().nonnegative().nullable(),
    commandId: Uuid,
    idempotencyKey: Uuid,
    parameters: z.record(z.unknown()),
    approvalId: Uuid.nullable(),
  })
  .strict();

export const DashboardAdministrativeCommandResult = z.record(z.unknown());

export type DashboardAdministrativeCommandRequest = z.infer<
  typeof DashboardAdministrativeCommandRequest
>;
export type DashboardAdministrativeCommandResult = z.infer<
  typeof DashboardAdministrativeCommandResult
>;

export const dashboardOperationsModels = {
  DashboardOperationsQuery,
  DashboardOperationItem,
  DashboardDomainCoverage,
  DashboardOperationsSnapshot,
  DashboardAdministrativeOperation,
  DashboardAdministrativeCommandRequest,
  DashboardAdministrativeCommandResult,
} as const;
