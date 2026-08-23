import { z } from 'zod';
import {
  CorrelationId,
  IsoTimestamp,
  MerchantDate,
  OpaqueCursor,
  PageInfo,
  Uuid,
} from './platform';

export const InventoryItemType = z.enum([
  'physical_product',
  'variant_stock',
  'ingredient',
  'packaging',
  'composite_component',
  'bundle_component',
  'operational_supply',
]);
export const StockTrackingPolicy = z.enum(['not_tracked', 'tracked', 'reservation_required']);
export const InventoryLocationType = z.enum([
  'business_location',
  'stock_room',
  'kitchen_storage',
  'bar_storage',
  'quarantine',
  'operational_sub_location',
]);
export const UnitOfMeasure = z.enum([
  'unit',
  'gram',
  'kilogram',
  'milliliter',
  'liter',
  'portion',
  'package',
  'box',
]);
export const InventoryState = z.enum([
  'on_hand',
  'available',
  'reserved',
  'committed',
  'in_transit',
  'damaged',
  'quarantine',
  'waste',
]);
export const StockLedgerEntryType = z.enum([
  'opening_balance',
  'reservation_created',
  'reservation_released',
  'reservation_expired',
  'sale_committed',
  'refund_restocked',
  'refund_not_restocked',
  'inspection_queued',
  'adjustment_increase',
  'adjustment_decrease',
  'waste_recorded',
  'damage_recorded',
  'quarantine_entered',
  'quarantine_released',
  'count_correction',
  'transfer_out_foundation',
  'transfer_in_foundation',
]);
export const StockReservationStatus = z.enum([
  'draft',
  'active',
  'partially_available',
  'committed',
  'released',
  'expired',
  'conflict',
]);
export const StockAvailabilityState = z.enum([
  'available',
  'low_stock',
  'unavailable',
  'backorder_allowed',
  'unknown',
  'policy_blocked',
]);
export const NegativeStockPolicy = z.enum([
  'block',
  'manager_override',
  'allow_and_flag',
  'backorder',
  'not_applicable',
]);
export const InventoryCountStatus = z.enum([
  'draft',
  'counting',
  'submitted',
  'variance_calculated',
  'reconciliation_required',
  'approved',
  'committed',
  'cancelled',
  'recovered',
]);
export const InventoryAdjustmentReason = z.enum([
  'opening_correction',
  'count_correction',
  'data_correction',
  'found_stock',
  'missing_stock',
  'operational_correction',
  'authorized_other',
]);
export const WasteReason = z.enum([
  'preparation_error',
  'spillage',
  'expired',
  'contamination',
  'quality_failure',
  'damaged',
  'customer_return_not_restockable',
  'operational_loss',
  'authorized_other',
]);
export const RestockOutcome = z.enum([
  'restocked',
  'not_restocked',
  'inspection_queued',
  'component_resolved',
  'not_applicable',
  'review_required',
]);
export const InventoryRecoveryState = z.enum([
  'none',
  'query_required',
  'outcome_unknown',
  'conflict',
  'recovered',
  'support_required',
]);

export const ScaledQuantity = z
  .object({
    value: z.number().int().safe(),
    scale: z.number().int().min(0).max(6),
    unit: UnitOfMeasure,
  })
  .strict();
export const PositiveScaledQuantity = ScaledQuantity.refine(
  (quantity) => quantity.value > 0,
  'Inventory quantity must be positive.',
);
export const NonNegativeScaledQuantity = ScaledQuantity.refine(
  (quantity) => quantity.value >= 0,
  'Inventory quantity must not be negative.',
);
export const InventoryCommandContext = z
  .object({
    locationId: Uuid,
    inventoryLocationId: Uuid,
    operatorSessionId: Uuid,
    commandId: Uuid,
    idempotencyKey: Uuid,
    expectedVersion: z.number().int().positive(),
    policyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    approvalId: Uuid.nullable().default(null),
    approvalFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    businessDate: MerchantDate,
  })
  .strict();
const commandShape = InventoryCommandContext.shape;

export const UnitConversion = z
  .object({
    from: UnitOfMeasure,
    to: UnitOfMeasure,
    numerator: z.number().int().positive().safe(),
    denominator: z.number().int().positive().safe(),
    targetScale: z.number().int().min(0).max(6),
    rounding: z.enum(['exact', 'floor', 'ceiling', 'half_up']),
    version: z.number().int().positive(),
  })
  .strict();

export const InventoryItem = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    type: InventoryItemType,
    baseUnit: UnitOfMeasure,
    scale: z.number().int().min(0).max(6),
    active: z.boolean(),
    trackingPolicy: StockTrackingPolicy,
    negativeStockPolicy: NegativeStockPolicy,
    reservationRequired: z.boolean(),
    lowStockThreshold: ScaledQuantity.nullable(),
    version: z.number().int().positive(),
    createdAt: IsoTimestamp,
    archivedAt: IsoTimestamp.nullable(),
  })
  .strict();

export const InventoryLocation = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    type: InventoryLocationType,
    active: z.boolean(),
    saleFulfillmentEligible: z.boolean(),
    reservationEligible: z.boolean(),
    countEligible: z.boolean(),
    version: z.number().int().positive(),
    createdAt: IsoTimestamp,
    archivedAt: IsoTimestamp.nullable(),
  })
  .strict();

export const StockBalance = z
  .object({
    inventoryItemId: Uuid,
    inventoryLocationId: Uuid,
    unit: UnitOfMeasure,
    scale: z.number().int().min(0).max(6),
    onHand: z.number().int().safe(),
    reserved: z.number().int().safe(),
    available: z.number().int().safe(),
    committed: z.number().int().safe(),
    damaged: z.number().int().safe(),
    quarantine: z.number().int().safe(),
    waste: z.number().int().safe(),
    inTransit: z.number().int().safe(),
    ledgerSequence: z.number().int().min(0),
    version: z.number().int().positive(),
    calculatedAt: IsoTimestamp,
  })
  .strict();

export const StockAvailability = z
  .object({
    catalogItemId: Uuid,
    variantId: Uuid.nullable(),
    inventoryLocationId: Uuid.nullable(),
    state: StockAvailabilityState,
    availableQuantity: ScaledQuantity.nullable(),
    ledgerSequence: z.number().int().min(0),
    mappingVersion: z.number().int().positive().nullable(),
    recipeVersion: z.number().int().positive().nullable(),
    policyVersion: z.string().min(1).max(80),
    stale: z.boolean(),
    checkedAt: IsoTimestamp,
  })
  .strict();

export const StockLedgerEntry = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    inventoryLocationId: Uuid,
    inventoryItemId: Uuid,
    sequence: z.number().int().positive(),
    type: StockLedgerEntryType,
    quantity: PositiveScaledQuantity,
    effects: z.record(z.number().int().safe()),
    commandId: Uuid,
    sourceType: z.string().min(1).max(80),
    sourceId: Uuid,
    saleId: Uuid.nullable(),
    saleLineId: Uuid.nullable(),
    refundId: Uuid.nullable(),
    countId: Uuid.nullable(),
    operatorId: Uuid,
    deviceId: Uuid.nullable(),
    credentialVersion: z.number().int().positive().nullable(),
    businessDate: MerchantDate,
    correlationId: CorrelationId,
    occurredAt: IsoTimestamp,
  })
  .strict();

export const ReservationLine = z
  .object({
    id: Uuid,
    inventoryItemId: Uuid,
    saleLineId: Uuid,
    requiredQuantity: PositiveScaledQuantity,
    mappingVersion: z.number().int().positive(),
    recipeVersion: z.number().int().positive().nullable(),
    availabilitySnapshot: StockBalance,
  })
  .strict();
export const StockReservation = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    inventoryLocationId: Uuid,
    saleId: Uuid,
    saleVersion: z.number().int().positive(),
    status: StockReservationStatus,
    lines: z.array(ReservationLine).max(250),
    createdAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
    ledgerSequenceBasis: z.number().int().min(0),
  })
  .strict();

export const RecipeComponent = z
  .object({
    inventoryItemId: Uuid,
    quantity: PositiveScaledQuantity,
    modifierId: Uuid.nullable(),
    required: z.boolean(),
    rounding: z.enum(['exact', 'floor', 'ceiling', 'half_up']),
  })
  .strict();
export const Recipe = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    catalogItemId: Uuid,
    variantId: Uuid.nullable(),
    version: z.number().int().positive(),
    active: z.boolean(),
    yieldQuantity: PositiveScaledQuantity,
    components: z.array(RecipeComponent).min(1).max(100),
    effectiveAt: IsoTimestamp,
    retiredAt: IsoTimestamp.nullable(),
  })
  .strict();
export const CompositeConsumption = z
  .object({
    saleLineId: Uuid,
    recipeId: Uuid.nullable(),
    recipeVersion: z.number().int().positive().nullable(),
    components: z.array(RecipeComponent).max(100),
  })
  .strict();
export const BundleConsumption = CompositeConsumption;

export const InventoryPolicy = z
  .object({
    version: z.string().min(1).max(80),
    merchantId: Uuid,
    locationId: Uuid,
    trackingEnabled: z.boolean(),
    defaultReservationRequired: z.boolean(),
    defaultNegativeStockPolicy: NegativeStockPolicy,
    adjustmentApprovalThreshold: ScaledQuantity,
    wasteApprovalThreshold: ScaledQuantity,
    countVarianceTolerance: ScaledQuantity,
    blindCount: z.boolean(),
    offlineMutationsAllowed: z.boolean(),
    issuedAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const InventoryQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    inventoryLocationId: Uuid.optional(),
    itemId: Uuid.optional(),
    catalogItemId: Uuid.optional(),
    cursor: OpaqueCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const RestockIntentReview = z
  .object({
    restockIntentId: Uuid,
    exceptionId: Uuid,
    saleLineId: Uuid,
    decision: z.enum([
      'restock',
      'do_not_restock',
      'inspection_required',
      'not_applicable',
      'unknown_until_inventory_review',
    ]),
    quantity: z.number().int().positive(),
    version: z.number().int().positive(),
    status: z.enum(['intent_only', 'review_required']),
    components: z
      .array(
        z
          .object({
            inventoryItemId: Uuid,
            displayName: z.string().trim().min(1).max(120),
            publicReference: z.string().min(1).max(80),
            maximum: PositiveScaledQuantity,
            recipeEffect: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const InventoryOverview = z
  .object({
    policy: InventoryPolicy,
    locations: z.array(InventoryLocation).max(100),
    items: z.array(InventoryItem).max(100),
    balances: z.array(StockBalance).max(100),
    restockReviews: z.array(RestockIntentReview).max(100),
    activeCount: z.lazy(() => InventoryCountResult).nullable(),
    page: PageInfo,
  })
  .strict();
export const AvailabilityQuery = InventoryQuery.extend({
  catalogItemIds: z.string().max(4000).optional(),
}).strict();
export const AvailabilityResult = z
  .object({
    entries: z.array(StockAvailability).max(250),
    correlationId: CorrelationId,
  })
  .strict();

export const InventoryAdjustment = z
  .object({
    ...commandShape,
    inventoryItemId: Uuid,
    direction: z.enum(['increase', 'decrease']),
    quantity: PositiveScaledQuantity,
    reason: InventoryAdjustmentReason,
    note: z.string().max(240).nullable().default(null),
  })
  .strict();
export const WasteRecord = z
  .object({
    ...commandShape,
    inventoryItemId: Uuid,
    quantity: PositiveScaledQuantity,
    reason: WasteReason,
    note: z.string().max(240).nullable().default(null),
  })
  .strict();
export const DamageRecord = WasteRecord.extend({
  disposition: z.enum(['damaged', 'quarantine', 'waste']),
}).strict();
export const QuarantineRecord = z
  .object({
    ...commandShape,
    inventoryItemId: Uuid,
    quantity: PositiveScaledQuantity,
    action: z.enum([
      'enter_quarantine',
      'release_from_quarantine',
      'dispose_from_quarantine',
      'return_to_available',
    ]),
    reason: z.string().min(1).max(80),
  })
  .strict();
export const InventoryMutationResult = z
  .object({
    commandId: Uuid,
    entries: z.array(StockLedgerEntry).max(250),
    balances: z.array(StockBalance).max(250),
    recovered: z.boolean(),
    correlationId: CorrelationId,
  })
  .strict();

export const RestockCommand = z
  .object({
    ...commandShape,
    restockIntentId: Uuid,
    componentDecisions: z
      .array(
        z
          .object({
            inventoryItemId: Uuid,
            outcome: RestockOutcome.refine(
              (outcome) => outcome !== 'component_resolved',
              'Component outcome must describe one physical disposition.',
            ),
            quantity: PositiveScaledQuantity.nullable(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();

export const InventoryCountLine = z
  .object({
    inventoryItemId: Uuid,
    counted: NonNegativeScaledQuantity,
    note: z.string().max(240).nullable().default(null),
  })
  .strict();
export const InventoryCount = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    inventoryLocationId: Uuid,
    status: InventoryCountStatus,
    scope: z.enum(['full_location', 'selected_items', 'cycle_count']),
    blind: z.boolean(),
    snapshotLedgerSequence: z.number().int().min(0),
    attempt: z.number().int().positive(),
    lines: z.array(InventoryCountLine).max(1000),
    createdAt: IsoTimestamp,
    submittedAt: IsoTimestamp.nullable(),
  })
  .strict();
export const CreateInventoryCountRequest = z
  .object({
    ...commandShape,
    scope: z.enum(['full_location', 'selected_items', 'cycle_count']),
    itemIds: z.array(Uuid).max(1000).default([]),
  })
  .strict();
export const SubmitInventoryCountRequest = z
  .object({
    ...commandShape,
    countId: Uuid,
    attempt: z.number().int().positive(),
    snapshotLedgerSequence: z.number().int().min(0),
    lines: z.array(InventoryCountLine).min(1).max(1000),
  })
  .strict();
export const InventoryVariance = z
  .object({
    inventoryItemId: Uuid,
    expected: ScaledQuantity,
    counted: ScaledQuantity,
    signed: ScaledQuantity,
    absolute: ScaledQuantity,
    tolerance: ScaledQuantity,
    withinTolerance: z.boolean(),
    reasonRequired: z.boolean(),
    approvalRequired: z.boolean(),
    ledgerSequence: z.number().int().min(0),
  })
  .strict();
export const InventoryReconciliation = z
  .object({
    ...commandShape,
    countId: Uuid,
    countAttempt: z.number().int().positive(),
    snapshotLedgerSequence: z.number().int().min(0),
    reasons: z.record(z.string().min(1).max(80)),
  })
  .strict();
export const InventoryCountResult = z
  .object({
    count: InventoryCount,
    variances: z.array(InventoryVariance).max(1000),
    entries: z.array(StockLedgerEntry).max(1000),
    recovered: z.boolean(),
    correlationId: CorrelationId,
  })
  .strict();

export const InventoryConflict = z
  .object({
    code: z.enum([
      'inventory_unavailable',
      'inventory_partially_available',
      'reservation_expired',
      'reservation_conflict',
      'reservation_version_changed',
      'inventory_mapping_changed',
      'recipe_changed',
      'inventory_policy_changed',
      'inventory_location_changed',
      'stock_item_archived',
      'negative_stock_blocked',
      'quarantine_blocked',
      'damaged_stock_blocked',
      'bundle_component_unavailable',
      'modifier_component_unavailable',
      'fingerprint_mismatch',
      'outcome_unknown',
    ]),
    retryable: z.boolean(),
    availableQuantity: ScaledQuantity.nullable(),
    requiredPermission: z.string().max(100).nullable(),
    correlationId: CorrelationId,
  })
  .strict();
export const InventoryHistoryEntry = StockLedgerEntry;
export const InventoryHistoryResult = z
  .object({ entries: z.array(InventoryHistoryEntry).max(100), page: PageInfo })
  .strict();
export const InventoryRecoveryQuery = z
  .object({ locationId: Uuid, operatorSessionId: Uuid })
  .strict();
export const InventoryRecoveryResult = z
  .object({
    commandId: Uuid,
    state: InventoryRecoveryState,
    result: z.union([InventoryMutationResult, InventoryCountResult]).nullable(),
    conflict: InventoryConflict.nullable(),
  })
  .strict();
export const SafeInventoryDiagnostic = z
  .object({
    merchantReference: z.string().max(80),
    locationReference: z.string().max(80),
    inventoryLocationReference: z.string().max(80).nullable(),
    inventoryItemReference: z.string().max(80).nullable(),
    ledgerSequence: z.number().int().min(0),
    projectionVersion: z.number().int().min(0),
    unresolvedConflictCount: z.number().int().min(0),
    lastMutationAt: IsoTimestamp.nullable(),
    correlationId: CorrelationId,
    contractVersion: z.string().min(1).max(40),
    policyVersion: z.string().min(1).max(80),
  })
  .strict();

export type InventoryItem = z.infer<typeof InventoryItem>;
export type InventoryLocation = z.infer<typeof InventoryLocation>;
export type StockBalance = z.infer<typeof StockBalance>;
export type StockAvailability = z.infer<typeof StockAvailability>;
export type StockLedgerEntry = z.infer<typeof StockLedgerEntry>;
export type StockReservation = z.infer<typeof StockReservation>;
export type InventoryAdjustment = z.infer<typeof InventoryAdjustment>;
export type WasteRecord = z.infer<typeof WasteRecord>;
export type DamageRecord = z.infer<typeof DamageRecord>;
export type QuarantineRecord = z.infer<typeof QuarantineRecord>;
export type RestockCommand = z.infer<typeof RestockCommand>;
export type InventoryCount = z.infer<typeof InventoryCount>;
export type InventoryVariance = z.infer<typeof InventoryVariance>;
export type InventoryReconciliation = z.infer<typeof InventoryReconciliation>;
export type InventoryMutationResult = z.infer<typeof InventoryMutationResult>;
export type InventoryQuery = z.infer<typeof InventoryQuery>;
export type RestockIntentReview = z.infer<typeof RestockIntentReview>;
export type AvailabilityQuery = z.infer<typeof AvailabilityQuery>;
export type InventoryRecoveryQuery = z.infer<typeof InventoryRecoveryQuery>;
export type InventoryRecoveryResult = z.infer<typeof InventoryRecoveryResult>;
export type InventoryOverview = z.infer<typeof InventoryOverview>;
export type AvailabilityResult = z.infer<typeof AvailabilityResult>;
export type InventoryHistoryResult = z.infer<typeof InventoryHistoryResult>;
export type InventoryCountResult = z.infer<typeof InventoryCountResult>;
export type CreateInventoryCountRequest = z.infer<typeof CreateInventoryCountRequest>;
export type SubmitInventoryCountRequest = z.infer<typeof SubmitInventoryCountRequest>;

export const posInventoryModels = {
  InventoryItemType,
  StockTrackingPolicy,
  InventoryLocationType,
  UnitOfMeasure,
  InventoryState,
  StockLedgerEntryType,
  StockReservationStatus,
  StockAvailabilityState,
  NegativeStockPolicy,
  InventoryCountStatus,
  InventoryAdjustmentReason,
  WasteReason,
  RestockOutcome,
  InventoryRecoveryState,
  ScaledQuantity,
  UnitConversion,
  InventoryItem,
  InventoryLocation,
  StockBalance,
  StockAvailability,
  StockLedgerEntry,
  ReservationLine,
  StockReservation,
  RecipeComponent,
  Recipe,
  CompositeConsumption,
  BundleConsumption,
  InventoryPolicy,
  InventoryQuery,
  RestockIntentReview,
  InventoryOverview,
  AvailabilityQuery,
  AvailabilityResult,
  InventoryAdjustment,
  WasteRecord,
  DamageRecord,
  QuarantineRecord,
  InventoryMutationResult,
  RestockCommand,
  InventoryCountLine,
  InventoryCount,
  CreateInventoryCountRequest,
  SubmitInventoryCountRequest,
  InventoryVariance,
  InventoryReconciliation,
  InventoryCountResult,
  InventoryConflict,
  InventoryHistoryEntry,
  InventoryHistoryResult,
  InventoryRecoveryQuery,
  InventoryRecoveryResult,
  SafeInventoryDiagnostic,
};
