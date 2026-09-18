import { z } from 'zod';

export const Uuid = z.string().uuid();
export const IsoTimestamp = z.string().datetime({ offset: true });
export const MerchantDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);
export const CorrelationId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
export const OpaqueCursor = z.string().min(1).max(512);
export const JsonPayload = z.record(z.unknown());

export const Money = z
  .object({
    minorUnits: z.number().int().safe(),
    currency: CurrencyCode,
  })
  .strict();
export type Money = z.infer<typeof Money>;

export const PageRequest = z
  .object({
    limit: z.number().int().min(1).max(100).default(25),
    cursor: OpaqueCursor.optional(),
  })
  .strict();
export type PageRequest = z.infer<typeof PageRequest>;

export const PageInfo = z
  .object({
    limit: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
    nextCursor: OpaqueCursor.nullable(),
  })
  .strict();
export type PageInfo = z.infer<typeof PageInfo>;

export const Identity = z
  .object({
    id: Uuid,
    email: z.string().email(),
    displayName: z.string().min(1).max(160).nullable(),
  })
  .strict();
export type Identity = z.infer<typeof Identity>;

export const SessionApplication = z.enum(['dashboard', 'kds', 'pos']);
export type SessionApplication = z.infer<typeof SessionApplication>;

export const DeviceAuthContext = z
  .object({
    deviceId: Uuid.nullable(),
    application: SessionApplication,
  })
  .strict();
export type DeviceAuthContext = z.infer<typeof DeviceAuthContext>;

export const DurableSession = z
  .object({
    sessionId: Uuid,
    userId: Uuid,
    deviceId: Uuid.nullable(),
    application: SessionApplication,
    issuedAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
    lastSeenAt: IsoTimestamp.nullable(),
    revokedAt: IsoTimestamp.nullable(),
  })
  .strict();
export type DurableSession = z.infer<typeof DurableSession>;

export const Membership = z
  .object({
    membershipId: Uuid.nullable(),
    userId: Uuid,
    merchantId: Uuid,
    locationIds: z.array(Uuid).max(500),
    allLocations: z.boolean(),
    roles: z.array(z.string().min(1).max(100)).max(50),
    permissions: z.array(z.string().min(1).max(100)).max(500),
  })
  .strict();
export type Membership = z.infer<typeof Membership>;

export const StaffIdentity = z
  .object({
    staffId: Uuid,
    identity: Identity,
    merchantId: Uuid,
    locationId: Uuid.nullable(),
    position: z.string().max(160).nullable(),
    status: z.enum(['active', 'inactive']),
  })
  .strict();
export type StaffIdentity = z.infer<typeof StaffIdentity>;

export const AuthorizationDecision = z
  .object({
    allowed: z.boolean(),
    reason: z.enum([
      'granted',
      'explicit_deny',
      'missing_permission',
      'missing_entitlement',
      'merchant_scope',
      'location_scope',
      'elevation_required',
    ]),
    permission: z.string().min(1).max(100),
    merchantId: Uuid,
    locationId: Uuid.nullable(),
  })
  .strict();
export type AuthorizationDecision = z.infer<typeof AuthorizationDecision>;

export const EffectiveEntitlement = z
  .object({
    featureKey: z.string().min(1).max(160),
    enabled: z.boolean(),
    limit: z.number().int().nonnegative().nullable(),
    subscriptionStatus: z.enum(['trialing', 'active', 'past_due', 'canceled']),
  })
  .strict();
export type EffectiveEntitlement = z.infer<typeof EffectiveEntitlement>;

export const ElevationRequirement = z
  .object({
    permission: z.string().min(1).max(100),
    method: z.enum(['manager_approval', 'operator_pin']),
    freshWithinSeconds: z.number().int().positive().max(900),
  })
  .strict();
export type ElevationRequirement = z.infer<typeof ElevationRequirement>;

export const MerchantFailureClass = z.enum([
  'validation',
  'authorization',
  'conflict',
  'transient',
  'permanent',
  'unknown_outcome',
]);
export type MerchantFailureClass = z.infer<typeof MerchantFailureClass>;

export const MerchantCommandResult = z
  .object({
    commandId: Uuid,
    status: z.enum(['succeeded', 'failed']),
    duplicate: z.boolean(),
    retryable: z.boolean(),
    result: JsonPayload.nullable(),
    failureCode: z.string().min(1).max(100).nullable(),
    failureClass: MerchantFailureClass.nullable(),
    correlationId: CorrelationId,
  })
  .strict();
export type MerchantCommandResult = z.infer<typeof MerchantCommandResult>;

export const AuditEventView = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid.nullable(),
    eventType: z.string().min(1).max(160),
    entityType: z.string().min(1).max(160),
    entityId: Uuid.nullable(),
    outcome: z.enum(['success', 'denied', 'failure']),
    reasonCode: z.string().min(1).max(160).nullable(),
    data: JsonPayload,
    correlationId: CorrelationId,
    occurredAt: IsoTimestamp,
  })
  .strict();
export type AuditEventView = z.infer<typeof AuditEventView>;

export const AuditSearchRequest = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    before: IsoTimestamp.optional(),
    eventType: z.string().min(1).max(160).optional(),
    entityType: z.string().min(1).max(160).optional(),
    entityId: Uuid.optional(),
    correlationId: CorrelationId.optional(),
  })
  .strict();
export type AuditSearchRequest = z.infer<typeof AuditSearchRequest>;

export const AuditSearchResponse = z
  .object({
    events: z.array(AuditEventView).max(100),
    page: PageInfo,
  })
  .strict();
export type AuditSearchResponse = z.infer<typeof AuditSearchResponse>;

export const FinancialEvent = z
  .object({
    id: Uuid,
    commandId: Uuid,
    merchantId: Uuid,
    locationId: Uuid.nullable(),
    aggregateType: z.string().min(1).max(160),
    aggregateId: Uuid,
    aggregateVersion: z.number().int().positive(),
    eventType: z.string().min(1).max(160),
    amount: Money,
    compensatesEventId: Uuid.nullable(),
    data: JsonPayload,
    correlationId: CorrelationId,
    occurredAt: IsoTimestamp,
  })
  .strict();
export type FinancialEvent = z.infer<typeof FinancialEvent>;

export const MerchantContext = z
  .object({
    merchantId: Uuid,
  })
  .strict();
export type MerchantContext = z.infer<typeof MerchantContext>;

export const LocationContext = MerchantContext.extend({
  locationId: Uuid,
}).strict();
export type LocationContext = z.infer<typeof LocationContext>;

export const OperatorContext = LocationContext.extend({
  operatorId: Uuid,
  operatorSessionId: Uuid,
  permissions: z.array(z.string().min(1).max(100)).max(200),
}).strict();
export type OperatorContext = z.infer<typeof OperatorContext>;

export const MerchantSummaryModel = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(160),
    timezone: z.string().min(1).max(100).nullable(),
    locale: z.string().min(2).max(20),
    currency: CurrencyCode,
  })
  .strict();
export type MerchantSummaryModel = z.infer<typeof MerchantSummaryModel>;

export const LocationSummaryModel = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    name: z.string().min(1).max(160),
    timezone: z.string().min(1).max(100).nullable(),
    status: z.enum(['active', 'closed']),
  })
  .strict();
export type LocationSummaryModel = z.infer<typeof LocationSummaryModel>;

export const OptimisticVersion = z
  .object({
    version: z.number().int().nonnegative(),
  })
  .strict();
export type OptimisticVersion = z.infer<typeof OptimisticVersion>;

export const IdempotencyMetadata = z
  .object({
    commandId: Uuid,
    idempotencyKey: z.string().min(8).max(128),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type IdempotencyMetadata = z.infer<typeof IdempotencyMetadata>;

export const CompensationRequest = z
  .object({
    command: IdempotencyMetadata,
    originalEventId: Uuid,
    reasonCode: z.string().min(1).max(160),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type CompensationRequest = z.infer<typeof CompensationRequest>;

export const CorrelationMetadata = z
  .object({
    correlationId: CorrelationId,
    requestId: CorrelationId,
  })
  .strict();
export type CorrelationMetadata = z.infer<typeof CorrelationMetadata>;

export const AuditMetadata = z
  .object({
    actorType: z.enum(['operator', 'manager', 'device', 'service']),
    actorId: Uuid,
    occurredAt: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type AuditMetadata = z.infer<typeof AuditMetadata>;

export const OfflineCommandEnvelope = z
  .object({
    commandId: Uuid,
    deviceId: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    sequence: z.number().int().positive(),
    issuedAt: IsoTimestamp,
    commandType: z.string().min(1).max(100),
    payload: JsonPayload,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    optimisticVersion: z.number().int().nonnegative().optional(),
  })
  .strict();
export type OfflineCommandEnvelope = z.infer<typeof OfflineCommandEnvelope>;

export const ReconciliationItem = z
  .object({
    commandId: Uuid,
    status: z.enum(['accepted', 'duplicate', 'rejected', 'conflict', 'pending']),
    resultRef: z.string().min(1).max(200).nullable(),
    errorCode: z.string().min(1).max(100).nullable(),
  })
  .strict();
export type ReconciliationItem = z.infer<typeof ReconciliationItem>;

export const ReconciliationResponse = z
  .object({
    batchId: Uuid,
    acceptedThroughSequence: z.number().int().nonnegative(),
    items: z.array(ReconciliationItem).max(500),
    nextCursor: OpaqueCursor.nullable(),
  })
  .strict();
export type ReconciliationResponse = z.infer<typeof ReconciliationResponse>;

export const ReceiptLineSnapshot = z
  .object({
    lineRef: z.string().min(1).max(100),
    description: z.string().min(1).max(300),
    quantity: z.number().int().positive(),
    unitPrice: Money,
    lineTotal: Money,
    variantName: z.string().min(1).max(160).nullable().optional(),
    modifiers: z.array(z.string().min(1).max(160)).max(100).optional(),
    tax: Money.optional(),
    discount: Money.optional(),
    tip: Money.optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();
export type ReceiptLineSnapshot = z.infer<typeof ReceiptLineSnapshot>;

export const ReceiptSnapshot = z
  .object({
    receiptRef: z.string().min(1).max(100),
    merchantId: Uuid,
    locationId: Uuid,
    issuedAt: IsoTimestamp,
    businessDate: MerchantDate,
    lines: z.array(ReceiptLineSnapshot).min(1).max(500),
    subtotal: Money,
    taxTotal: Money,
    grandTotal: Money,
    currency: CurrencyCode,
    version: z.number().int().positive(),
    merchantName: z.string().min(1).max(240).optional(),
    locationName: z.string().min(1).max(240).optional(),
    operatorName: z.string().min(1).max(240).optional(),
    payment: z
      .object({
        method: z.enum(['cash', 'external_terminal', 'card', 'stored_value', 'gift_card']),
        status: z.enum(['succeeded', 'captured']),
        reference: z.string().min(1).max(100),
        amount: Money,
      })
      .strict()
      .optional(),
    payments: z
      .array(
        z
          .object({
            tenderId: Uuid,
            method: z.enum(['cash', 'manual_terminal', 'wallet', 'gift_card']),
            amount: Money,
            received: Money.nullable(),
            change: Money,
          })
          .strict(),
      )
      .max(8)
      .optional(),
    tip: Money.optional(),
    receiptDestination: z.enum(['display', 'print_later', 'digital', 'none']).optional(),
    discountTotal: Money.optional(),
  })
  .strict();
export type ReceiptSnapshot = z.infer<typeof ReceiptSnapshot>;

export const PaymentAmbiguity = z
  .object({
    paymentRef: z.string().min(1).max(100),
    status: z.enum(['pending', 'confirmed', 'declined', 'unknown']),
    queryOnly: z.boolean(),
    canRetryAsNew: z.boolean(),
    queryAfter: IsoTimestamp.nullable(),
    correlationId: CorrelationId,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'unknown' && (!value.queryOnly || value.canRetryAsNew)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An unknown payment outcome must be query-only and cannot be retried as new.',
      });
    }
  });
export type PaymentAmbiguity = z.infer<typeof PaymentAmbiguity>;

export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'AUTHENTICATION_REQUIRED',
  'PERMISSION_DENIED',
  'MERCHANT_NOT_FOUND',
  'LOCATION_NOT_FOUND',
  'LOCATION_REQUIRED',
  // The caller is bound to a different location than the one it addressed. A POS
  // cannot transact at a location where it is not enrolled.
  'LOCATION_SCOPE_VIOLATION',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  // The idempotency key is older than the retention window (see
  // `IDEMPOTENCY_RETENTION_HOURS`). The recorded result is gone, so the command
  // must be queried by id — replaying it must never produce a second charge.
  'IDEMPOTENCY_EXPIRED',
  'COMMAND_IN_PROGRESS',
  'OPTIMISTIC_VERSION_CONFLICT',
  'RATE_LIMITED',
  'DEVICE_REVOKED',
  'DEVICE_NOT_ALLOWED',
  'DEVICE_NOT_ENROLLED',
  'DEVICE_CREDENTIAL_INVALID',
  'DEVICE_ROTATION_REQUIRED',
  'ENROLLMENT_EXPIRED',
  'ENROLLMENT_REJECTED',
  'ENROLLMENT_ATTEMPTS_EXCEEDED',
  'MERCHANT_DISABLED',
  'LOCATION_DISABLED',
  // The product is not active for this merchant, so the whole surface is closed.
  // What `EntitlementGuard(@RequireProduct('pos'))` returns.
  'ENTITLEMENT_DISABLED',
  'OPERATOR_SESSION_REQUIRED',
  'CART_VALIDATION_FAILED',
  'CART_NOT_FOUND',
  'PRODUCT_UNAVAILABLE',
  'VARIANT_NOT_AVAILABLE',
  'MODIFIER_SELECTION_INVALID',
  'CHECKOUT_GATE_NOT_AVAILABLE',
  'CHECKOUT_CONFIRMATION_REQUIRED',
  'CHECKOUT_CART_CHANGED',
  'INVENTORY_UNAVAILABLE',
  'INVENTORY_PARTIALLY_AVAILABLE',
  'INVENTORY_POLICY_REQUIRED',
  'INVENTORY_POLICY_CHANGED',
  'INVENTORY_MAPPING_REQUIRED',
  'INVENTORY_MAPPING_CHANGED',
  'INVENTORY_CONSUMPTION_REQUIRED',
  'INVENTORY_ITEM_ARCHIVED',
  'INVENTORY_LOCATION_CHANGED',
  'INVENTORY_UNIT_CONVERSION_REQUIRED',
  'INVENTORY_QUANTITY_NOT_EXACT',
  'INVENTORY_QUANTITY_OUT_OF_RANGE',
  'INVENTORY_SOURCE_STATE_INSUFFICIENT',
  'NEGATIVE_STOCK_BLOCKED',
  'RESERVATION_CONFLICT',
  'RESERVATION_EXPIRED',
  'RESERVATION_VERSION_CHANGED',
  // Table map, workstream D steps 3 to 5: the live state of a table. These are
  // refusals an operator triggers by tapping a table, so each one names the exact
  // thing that was wrong — "conflict" would leave the floor staff guessing which
  // of the two tables moved under them.
  'TABLE_NOT_IN_PLAN',
  'TABLE_ALREADY_OCCUPIED',
  'TABLE_NOT_OCCUPIED',
  'TABLE_NOT_GROUPED',
  'TABLE_CAPACITY_EXCEEDED',
  // The floor plan has no published version, so there is no room to operate on.
  'FLOOR_PLAN_NOT_PUBLISHED',
  // Publishing a layout that removes or moves a table a party is sitting at.
  'FLOOR_PLAN_OCCUPIED_TABLE_CHANGED',
  // Table-order intake, §8I step 2 (build-v3-75). Two refusals that a GUEST reads,
  // so each one has to be actionable on its own:
  //   · the QR's token is unknown, revoked, or names a table that is gone. One code
  //     for all three on purpose — a guest cannot act on the difference, and saying
  //     "revoked" where a token was merely mistyped tells an attacker the token was
  //     once real.
  //   · the owner is issuing a code for a table that already has a live one, which
  //     would leave a QR the owner believes is dead still ordering. Rotation is
  //     revoke-then-issue, so the refusal names the operation that is missing.
  //
  // A table with no party on it is refused with `TABLE_NOT_OCCUPIED` above, not with
  // a code of its own: it is the same fact the serve transition refuses, decided by
  // the same predicate (`table_state.seated_at is not null`).
  'TABLE_ORDER_CREDENTIAL_INVALID',
  'TABLE_ORDER_CREDENTIAL_ALREADY_LIVE',
  // Cash shifts, build-v3-68. A register the till cannot open because a shift
  // still holds it is a CONFLICT, not a server fault: the drawer exists, the
  // cash exists, and the operator needs to be told which terminal has it. The
  // refusal carries the facts in `details` (see `ApiError`).
  'REGISTER_NOT_AVAILABLE',
  // The register is held by a terminal that is still usable, so nobody may take
  // its drawer without counting it. The refusal points at manager recovery.
  'REGISTER_HELD_BY_ACTIVE_TILL',
  // A cash sale arrived with no cash shift on the request, so there is no drawer
  // to book the money against. This is the ordinary shape of a till whose
  // operator session was replaced by a restart: the shift is still open, still
  // held by this very device, and only its `operator_session_id` points at the
  // session that is gone. The refusal carries the register and its `hold` in
  // `details` (see `RegisterHold`), which is what tells the client whether to
  // resume its own shift, reclaim an orphaned one, or ask a manager to count the
  // drawer out. It stays a CONFLICT, never a server fault.
  'CASH_SHIFT_REQUIRED',
  'RECIPE_CHANGED',
  'RESTOCK_INTENT_NOT_ELIGIBLE',
  'RESTOCK_EXCEEDS_ORIGINAL_CONSUMPTION',
  'STALE_INVENTORY_COUNT',
  'INVENTORY_COUNT_NOT_FOUND',
  'INVENTORY_COUNT_SCOPE_MISMATCH',
  // Purchasing, workstream E step 3 (build-v3-69). Buying stock is back-of-house
  // work with two refusals that must not be confused: an order that cannot be
  // received (OVER_RECEIPT — the quantity is the problem, and the message names
  // the line), and an order that is not in a state to be touched at all
  // (NOT_SENT / CLOSED — the order is the problem). "Conflict" for both would
  // leave the person at the counter guessing which one they are looking at.
  'SUPPLIER_NOT_FOUND',
  'SUPPLIER_REFERENCE_TAKEN',
  'SUPPLIER_ARCHIVED',
  'PURCHASE_ORDER_NOT_FOUND',
  'PURCHASE_ORDER_REFERENCE_TAKEN',
  'PURCHASE_ORDER_NOT_DRAFT',
  'PURCHASE_ORDER_NOT_SENT',
  'PURCHASE_ORDER_CLOSED',
  'PURCHASE_ORDER_OVER_RECEIPT',
  'PURCHASE_ORDER_LINE_NOT_FOUND',
  'PURCHASE_ORDER_LINE_TOTAL_MISMATCH',
  // Kitchen commands, §8H step 3 (defect D33). A POS device works the whole
  // location's board, so the ways a ticket can be out of its reach must not all
  // read the same: it is gone, it belongs to another location, or nothing on it
  // is routed to a station of this location — which is why it is not on the board
  // the operator is looking at. "Ticket not found" for all three leaves the cook
  // tapping a card that will never answer.
  'KITCHEN_ORDER_NOT_FOUND',
  'KITCHEN_ORDER_OUT_OF_SCOPE',
  'KITCHEN_ORDER_NOT_ROUTED',
  // The operator holds a live kitchen session but not this command's permission:
  // `mark_item_ready` needs kitchen.ready, `complete` needs kitchen.complete,
  // `recall` needs kitchen.recall. The refusal names the one that is missing,
  // because a bare PERMISSION_DENIED leaves the cook staring at a dead button.
  'KITCHEN_PERMISSION_REQUIRED',
  'APPROVAL_REQUIRED',
  'APPROVAL_FINGERPRINT_MISMATCH',
  'APPROVAL_INVALID',
  'PAYMENT_DECLINED',
  'PAYMENT_UNKNOWN',
  'PAYMENT_TIMEOUT',
  'RECEIPT_CREATION_FAILED',
  'OPERATOR_LOCKED',
  'PIN_LOCKED',
  'SESSION_REVOKED',
  'ELEVATION_REQUIRED',
  'AUDIT_INTEGRITY_FAILURE',
  'PAYMENT_OUTCOME_UNKNOWN',
  'RESOURCE_NOT_FOUND',
  'HARDWARE_NOT_FOUND',
  'HARDWARE_DISABLED',
  'HARDWARE_NOT_ASSIGNED',
  'HARDWARE_CAPABILITY_UNSUPPORTED',
  'HARDWARE_DISCONNECTED',
  'HARDWARE_BUSY',
  'HARDWARE_PAPER_OUT',
  'HARDWARE_COMMAND_TIMEOUT',
  'HARDWARE_OUTCOME_UNKNOWN',
  'HARDWARE_CONFIGURATION_STALE',
  'EXECUTION_DEVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  // Recipes and inventory authoring (plan of record §11, phase 0). Each code names
  // the one thing that was wrong, because the console renders a different action for
  // each: a missing item, a reference already in use, a conversion that loses a unit.
  'INVENTORY_ITEM_NOT_FOUND',
  'INVENTORY_ITEM_REFERENCE_TAKEN',
  'INVENTORY_UNIT_CONVERSION_INVALID',
  'INVENTORY_RECIPE_NOT_FOUND',
  // A recipe chain that revisits an item, and one deeper than the runaway stop of 12.
  'INVENTORY_RECIPE_CYCLE',
  'INVENTORY_RECIPE_TOO_DEEP',
  // The target is not exactly one of a product, a variant or an inventory item.
  'INVENTORY_RECIPE_TARGET_INVALID',
  // Production. The output item has no active recipe, so there is nothing to
  // explode and nothing the server could consume; and an expiry that lands before
  // the batch was made is a label nobody can trust.
  'INVENTORY_RECIPE_REQUIRED',
  'INVENTORY_LOT_EXPIRY_INVALID',
  'INVENTORY_ALLERGEN_NOT_FOUND',
  // Invoice capture: the upload is idempotent on the CFDI UUID, a commit is refused
  // while a line has no match, and a file that does not parse names itself.
  'SUPPLIER_INVOICE_NOT_FOUND',
  'SUPPLIER_INVOICE_DUPLICATE',
  'SUPPLIER_INVOICE_UNMATCHED_LINES',
  'SUPPLIER_INVOICE_PARSE_FAILED',
  // The rest of the invoice refusals. A code that is not in this list is REPLACED on
  // the wire by the generic code for its status, so an operator who needed to read
  // "this line has no match" would have been shown "conflict" instead.
  'SUPPLIER_INVOICE_ALREADY_COMMITTED',
  'SUPPLIER_INVOICE_ARTIFACT_TOO_LARGE',
  'SUPPLIER_INVOICE_ARTIFACT_UNSUPPORTED',
  'SUPPLIER_INVOICE_HAS_NO_LINES',
  'SUPPLIER_INVOICE_LINE_NOT_FOUND',
  'SUPPLIER_INVOICE_LOT_UNSUPPORTED',
  'SUPPLIER_INVOICE_UPLOAD_CONFLICT',
  'PREP_LIST_ITEM_NOT_FOUND',
] as const;

export const ApiError = z
  .object({
    code: z.enum(API_ERROR_CODES),
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    correlationId: CorrelationId,
    fieldErrors: z.record(z.array(z.string().max(300)).max(20)).optional(),
    /**
     * The facts a refusal needs in order to be actionable, when the CODE alone
     * would leave the operator guessing. Plan §4: "Every failure shows a typed
     * message with a recovery action." A `REGISTER_NOT_AVAILABLE` that does not
     * say which shift holds the register, since when, and on which terminal, is
     * a typed code the person at the counter still cannot act on.
     *
     * Flat, scalar and short by construction: this travels on the error path of
     * every client, so it carries identifiers, statuses and timestamps only —
     * never a nested object, a list, or a customer's data. It is emitted only for
     * 4xx; a 5xx response never carries it (see `all-exceptions.filter.ts`).
     */
    details: z.record(z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiError>;

export const ApiErrorEnvelope = z
  .object({
    error: ApiError,
  })
  .strict();
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelope>;

export const contractModels = {
  Money,
  PageRequest,
  PageInfo,
  Identity,
  SessionApplication,
  DeviceAuthContext,
  DurableSession,
  Membership,
  StaffIdentity,
  AuthorizationDecision,
  EffectiveEntitlement,
  ElevationRequirement,
  MerchantFailureClass,
  MerchantCommandResult,
  AuditEventView,
  AuditSearchRequest,
  AuditSearchResponse,
  FinancialEvent,
  CompensationRequest,
  MerchantContext,
  LocationContext,
  OperatorContext,
  MerchantSummaryModel,
  LocationSummaryModel,
  OptimisticVersion,
  IdempotencyMetadata,
  CorrelationMetadata,
  AuditMetadata,
  OfflineCommandEnvelope,
  ReconciliationItem,
  ReconciliationResponse,
  ReceiptLineSnapshot,
  ReceiptSnapshot,
  PaymentAmbiguity,
  ApiError,
  ApiErrorEnvelope,
} as const;
