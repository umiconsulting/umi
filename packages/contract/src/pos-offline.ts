import { z } from 'zod';
import { IsoTimestamp, JsonPayload, ReceiptSnapshot, Uuid } from './platform';
import { CheckoutCommand, TotalsConfirmation } from './pos-checkout';

export const ConnectivityState = z.enum([
  'unknown',
  'online',
  'degraded',
  'offline',
  'recovering',
  'replaying',
  'reconciliation_required',
  'blocked',
]);
export type ConnectivityState = z.infer<typeof ConnectivityState>;

export const OfflineCommandType = z.enum(['operational.ack', 'pos.checkout.cash']);
export type OfflineCommandType = z.infer<typeof OfflineCommandType>;

export const ConflictClassification = z.enum([
  'duplicate_already_applied',
  'fingerprint_mismatch',
  'sequence_gap',
  'sequence_behind',
  'credential_rotated',
  'device_revoked',
  'merchant_mismatch',
  'location_mismatch',
  'operator_invalid',
  'permission_revoked',
  'entitlement_disabled',
  'catalog_version_expired',
  'price_changed',
  'tax_changed',
  'availability_changed',
  'inventory_unavailable',
  'aggregate_version_conflict',
  'command_expired',
  'policy_changed',
  'unsupported_offline_command',
  'ambiguous_payment_requires_query',
  'server_validation_failed',
  'reconciliation_required',
  'terminal_failure',
]);
export type ConflictClassification = z.infer<typeof ConflictClassification>;

export const OfflinePolicyLimits = z
  .object({
    maxSingleSaleMinorUnits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxAccumulatedMinorUnits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxOfflineSaleCount: z.number().int().positive().max(1000),
    maxActiveQueueDepth: z.number().int().positive().max(1000),
    maxCommandAgeSeconds: z.number().int().positive().max(604800),
    maxCatalogAgeSeconds: z.number().int().positive().max(604800),
    maxPricingAgeSeconds: z.number().int().positive().max(604800),
    maxTaxAgeSeconds: z.number().int().positive().max(604800),
  })
  .strict();
export type OfflinePolicyLimits = z.infer<typeof OfflinePolicyLimits>;

export const OfflineCashPolicy = z
  .object({
    enabled: z.boolean(),
    version: z.string().min(1).max(64),
    issuedAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
    maxPolicyAgeSeconds: z.number().int().positive().max(86400),
    merchantId: Uuid,
    locationId: Uuid,
    deviceId: Uuid,
    deviceCredentialVersion: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    requiredPermission: z.literal('offline.cash.checkout'),
    requiredEntitlement: z.literal('pos.offline_cash'),
    managerApprovalThresholdMinorUnits: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    allowedDeviceClasses: z.array(z.string().min(1).max(50)).max(20),
    limits: OfflinePolicyLimits,
    correlationId: z.string().min(8).max(128),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type OfflineCashPolicy = z.infer<typeof OfflineCashPolicy>;

export const OfflinePolicy = z
  .object({
    cash: OfflineCashPolicy,
    allowedCommandTypes: z.array(OfflineCommandType).max(16),
    maxBatchSize: z.number().int().positive().max(50),
    webSensitiveJournalEnabled: z.literal(false),
  })
  .strict();
export type OfflinePolicy = z.infer<typeof OfflinePolicy>;

export const OfflineCommand = z
  .object({
    commandId: Uuid,
    provisionalId: Uuid.nullable(),
    deviceId: Uuid,
    deviceCredentialVersion: z.number().int().positive(),
    deviceSequence: z.number().int().positive(),
    merchantId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    commandType: OfflineCommandType,
    idempotencyKey: Uuid,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    contractVersion: z.string().min(1).max(64),
    schemaVersion: z.number().int().positive(),
    createdAt: IsoTimestamp,
    payload: JsonPayload,
  })
  .strict();
export type OfflineCommand = z.infer<typeof OfflineCommand>;

export const OfflineCheckoutSnapshot = z
  .object({
    checkoutCommand: CheckoutCommand,
    cartSnapshot: JsonPayload,
    totals: TotalsConfirmation,
    catalogVersion: z.string().min(1).max(100),
    pricingVersion: z.string().min(1).max(100),
    taxVersion: z.string().min(1).max(100),
    catalogSnapshotAt: IsoTimestamp,
    pricingSnapshotAt: IsoTimestamp,
    taxSnapshotAt: IsoTimestamp,
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountDueMinorUnits: z.number().int().nonnegative(),
    amountReceivedMinorUnits: z.number().int().nonnegative(),
    changeDueMinorUnits: z.number().int().nonnegative(),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type OfflineCheckoutSnapshot = z.infer<typeof OfflineCheckoutSnapshot>;

export const OfflineCheckoutCommand = z
  .object({
    policyVersion: z.string().min(1).max(64),
    policyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    checkoutIdentity: z.string().regex(/^[a-f0-9]{64}$/),
    snapshot: OfflineCheckoutSnapshot,
  })
  .strict();
export type OfflineCheckoutCommand = z.infer<typeof OfflineCheckoutCommand>;

export const OfflineCheckoutBlockReason = z.enum([
  'unsupported_platform',
  'storage_unavailable',
  'journal_unhealthy',
  'device_untrusted',
  'credential_rotated',
  'operator_invalid',
  'permission_denied',
  'entitlement_disabled',
  'merchant_mismatch',
  'location_mismatch',
  'currency_mismatch',
  'policy_missing',
  'policy_invalid',
  'policy_expired',
  'catalog_stale',
  'pricing_stale',
  'tax_stale',
  'single_sale_limit',
  'manager_approval_required',
  'cash_received_insufficient',
  'accumulated_amount_limit',
  'sale_count_limit',
  'queue_full',
  'payment_method_unsupported',
  'ambiguous_payment',
  'reconciliation_required',
  'trusted_time_unavailable',
]);
export type OfflineCheckoutBlockReason = z.infer<typeof OfflineCheckoutBlockReason>;

export const OfflineCheckoutEligibility = z
  .object({
    status: z.enum([
      'eligible',
      'blocked',
      'requires_manager_approval',
      'requires_online_refresh',
      'requires_reauthentication',
      'requires_reconciliation',
      'unsupported_platform',
    ]),
    reason: OfflineCheckoutBlockReason.nullable(),
    recoveryActions: z
      .array(
        z.enum([
          'retry',
          'refresh_policy',
          'refresh_data',
          'reauthenticate',
          'reselect_location',
          'reconcile',
          'manager_review',
          'contact_support',
        ]),
      )
      .max(8),
    cartPreserved: z.literal(true),
    retrySafe: z.boolean(),
    correlationId: z.string().min(8).max(128).nullable(),
  })
  .strict();
export type OfflineCheckoutEligibility = z.infer<typeof OfflineCheckoutEligibility>;

export const ProvisionalReceiptStatus = z.enum([
  'pending_sync',
  'synchronizing',
  'accepted',
  'official_available',
  'conflict',
]);
export const ProvisionalReceipt = z
  .object({
    provisionalSaleId: Uuid,
    status: ProvisionalReceiptStatus,
    locationName: z.string().min(1).max(160),
    operatorName: z.string().min(1).max(160),
    snapshot: OfflineCheckoutSnapshot,
    createdAt: IsoTimestamp,
    lastSynchronizationAt: IsoTimestamp.nullable(),
    officialReceipt: ReceiptSnapshot.nullable(),
  })
  .strict();
export type ProvisionalReceipt = z.infer<typeof ProvisionalReceipt>;

export const OfficialCommitResult = z
  .object({
    provisionalSaleId: Uuid,
    officialSaleId: Uuid,
    officialReceiptId: Uuid,
    officialReceiptNumber: z.string().min(1).max(100),
    committedTotals: TotalsConfirmation,
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    acceptedAt: IsoTimestamp,
    paymentSummary: JsonPayload,
    reconciliationReference: Uuid,
  })
  .strict();
export type OfficialCommitResult = z.infer<typeof OfficialCommitResult>;

export const ReplayBatch = z
  .object({
    replaySessionId: Uuid,
    commands: z.array(OfflineCommand).min(1).max(50),
  })
  .strict();
export type ReplayBatch = z.infer<typeof ReplayBatch>;

export const ReplayFailure = z
  .object({
    classification: ConflictClassification,
    retryable: z.boolean(),
    blocksFollowing: z.boolean(),
    operatorActionRequired: z.boolean(),
    managerActionRequired: z.boolean(),
    guidanceCode: z.string().min(1).max(100),
    correlationId: z.string().min(8).max(128),
  })
  .strict();
export type ReplayFailure = z.infer<typeof ReplayFailure>;

export const ReplayResult = z
  .object({
    commandId: Uuid,
    deviceSequence: z.number().int().positive(),
    status: z.enum(['accepted', 'duplicate', 'conflict', 'rejected']),
    officialId: Uuid.nullable(),
    officialCommit: OfficialCommitResult.nullable(),
    serverConflictReference: Uuid.nullable(),
    failure: ReplayFailure.nullable(),
  })
  .strict();
export type ReplayResult = z.infer<typeof ReplayResult>;

export const ReplayCursor = z
  .object({
    deviceId: Uuid,
    credentialVersion: z.number().int().positive(),
    lastAcceptedSequence: z.number().int().nonnegative(),
    reconciliationRequired: z.boolean(),
    updatedAt: IsoTimestamp,
  })
  .strict();
export type ReplayCursor = z.infer<typeof ReplayCursor>;

export const BeginReplayRequest = z
  .object({
    merchantId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    credentialVersion: z.number().int().positive(),
  })
  .strict();
export type BeginReplayRequest = z.infer<typeof BeginReplayRequest>;
export const BeginReplayResponse = z
  .object({
    replaySessionId: Uuid,
    cursor: ReplayCursor,
    policy: OfflinePolicy,
  })
  .strict();

export const ReplayBatchResult = z
  .object({
    replaySessionId: Uuid,
    results: z.array(ReplayResult).max(50),
    cursor: ReplayCursor,
    stopped: z.boolean(),
  })
  .strict();
export type ReplayBatchResult = z.infer<typeof ReplayBatchResult>;

export const ReplayProgress = z
  .object({
    total: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    awaitingResult: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    operationCode: z.string().min(1).max(100),
    lastSynchronizedAt: IsoTimestamp.nullable(),
  })
  .strict();
export type ReplayProgress = z.infer<typeof ReplayProgress>;

export const RecoveryState = z.enum([
  'idle',
  'inspecting_storage',
  'validating_authority',
  'recovering_unknown_results',
  'reconciling',
  'ready_to_replay',
  'replaying',
  'waiting_for_connectivity',
  'waiting_for_authentication',
  'waiting_for_location',
  'waiting_for_policy_refresh',
  'waiting_for_operator_action',
  'waiting_for_manager_action',
  'blocked_by_device',
  'blocked_by_conflict',
  'blocked_by_storage',
  'completed',
  'failed_safely',
]);
export const RecoveryActionId = z.enum([
  'synchronize',
  'query_result',
  'refresh_policy',
  'reauthenticate',
  'reselect_location',
  'manager_review',
  'acknowledge',
  'view_receipt',
  'query_ambiguous_payment',
  'device_recovery',
  'credential_recovery',
  'storage_recovery',
  'refresh_snapshots',
  'contact_support',
]);
export const RecoveryActionActor = z.enum(['operator', 'manager', 'administrator', 'support']);
export const RecoveryActionSeverity = z.enum(['information', 'warning', 'blocking', 'security']);
export const RecoveryActionRetryPolicy = z.enum([
  'never',
  'transport_safe',
  'after_authority',
  'query_only',
]);
export const RecoveryAction = z
  .object({
    id: RecoveryActionId,
    titleCode: z.string().min(1).max(100),
    descriptionCode: z.string().min(1).max(100),
    requiredPermission: z.string().min(1).max(100).nullable(),
    allowedActor: RecoveryActionActor,
    severity: RecoveryActionSeverity,
    retryPolicy: RecoveryActionRetryPolicy,
    diagnosticCode: z.string().min(1).max(100),
    auditEvent: z.string().min(1).max(100),
  })
  .strict();
export const ReconciliationState = z.enum([
  'in_sync',
  'replay_required',
  'result_recovery_required',
  'conflict_resolution_required',
  'reauthentication_required',
  'device_blocked',
  'location_reselection_required',
  'policy_refresh_required',
  'storage_recovery_required',
  'support_required',
]);

export const ReconciliationSummary = z
  .object({
    reconciliationId: Uuid,
    deviceId: Uuid,
    credentialVersion: z.number().int().positive(),
    localLastAllocatedSequence: z.number().int().nonnegative(),
    localLastAcknowledgedSequence: z.number().int().nonnegative(),
    serverLastAcceptedSequence: z.number().int().nonnegative(),
    missingSequences: z.array(z.number().int().positive()).max(100),
    duplicates: z.array(Uuid).max(100),
    conflicts: z.array(ReplayResult).max(100),
    provisionalMappings: z
      .array(
        z
          .object({
            provisionalId: Uuid,
            officialId: Uuid,
            commandId: Uuid,
          })
          .strict(),
      )
      .max(100),
    reconciliationRequired: z.boolean(),
  })
  .strict();
export type ReconciliationSummary = z.infer<typeof ReconciliationSummary>;

export const ReconcileRequest = z
  .object({
    localLastAllocatedSequence: z.number().int().nonnegative(),
    localLastAcknowledgedSequence: z.number().int().nonnegative(),
  })
  .strict();
export type ReconcileRequest = z.infer<typeof ReconcileRequest>;
export const AcknowledgeReconciliationRequest = z
  .object({
    reconciliationId: Uuid,
  })
  .strict();
export type AcknowledgeReconciliationRequest = z.infer<typeof AcknowledgeReconciliationRequest>;
export const ReplayDiagnostics = z
  .object({
    contractVersion: z.string().min(1).max(64),
    serverLastAcceptedSequence: z.number().int().nonnegative(),
    acceptedCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    lastReplayAt: IsoTimestamp.nullable(),
    lastSafeErrorCategory: ConflictClassification.nullable(),
  })
  .strict();
export const ReplayContextQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    credentialVersion: z.coerce.number().int().positive(),
  })
  .strict();
export type ReplayContextQuery = z.infer<typeof ReplayContextQuery>;
export const ReplayCommandResultQuery = ReplayContextQuery.extend({ commandId: Uuid }).strict();
export type ReplayCommandResultQuery = z.infer<typeof ReplayCommandResultQuery>;
export const ConflictSummary = z
  .object({
    items: z.array(ReplayResult).max(100),
  })
  .strict();
export const ReplayAuditSummary = z
  .object({
    eventCategory: z.string().min(1).max(100),
    occurredAt: IsoTimestamp,
    correlationId: z.string().min(8).max(128),
    commandReference: Uuid.nullable(),
    deviceReference: Uuid,
    sequence: z.number().int().nonnegative(),
    locationReference: Uuid,
    outcomeCode: z.string().min(1).max(100),
    resolutionStatus: z.string().min(1).max(100),
  })
  .strict();
export const SafeReplayDiagnostic = ReplayDiagnostics.extend({
  queueDepth: z.number().int().nonnegative(),
  unresolvedCount: z.number().int().nonnegative(),
  audit: z.array(ReplayAuditSummary).max(100),
}).strict();

export const posOfflineModels = {
  ConnectivityState,
  OfflineCommandType,
  ConflictClassification,
  OfflinePolicyLimits,
  OfflineCashPolicy,
  OfflinePolicy,
  OfflineCommand,
  OfflineCheckoutSnapshot,
  OfflineCheckoutCommand,
  OfflineCheckoutBlockReason,
  OfflineCheckoutEligibility,
  ProvisionalReceiptStatus,
  ProvisionalReceipt,
  OfficialCommitResult,
  ReplayBatch,
  ReplayFailure,
  ReplayResult,
  ReplayCursor,
  ReplayProgress,
  RecoveryState,
  RecoveryActionId,
  RecoveryActionActor,
  RecoveryActionSeverity,
  RecoveryActionRetryPolicy,
  RecoveryAction,
  ReconciliationState,
  BeginReplayRequest,
  BeginReplayResponse,
  ReplayBatchResult,
  ReconciliationSummary,
  ReconcileRequest,
  AcknowledgeReconciliationRequest,
  ReplayDiagnostics,
  ReplayContextQuery,
  ReplayCommandResultQuery,
  ConflictSummary,
  ReplayAuditSummary,
  SafeReplayDiagnostic,
} as const;
