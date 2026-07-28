import { z } from 'zod';
import { IsoTimestamp, JsonPayload, Uuid } from './platform';

export const ConnectivityState = z.enum([
  'unknown', 'online', 'degraded', 'offline', 'recovering', 'replaying',
  'reconciliation_required', 'blocked',
]);
export type ConnectivityState = z.infer<typeof ConnectivityState>;

export const OfflineCommandType = z.enum(['operational.ack']);
export type OfflineCommandType = z.infer<typeof OfflineCommandType>;

export const ConflictClassification = z.enum([
  'duplicate_already_applied', 'fingerprint_mismatch', 'sequence_gap',
  'sequence_behind', 'credential_rotated', 'device_revoked', 'tenant_mismatch',
  'branch_mismatch', 'operator_invalid', 'permission_revoked',
  'entitlement_disabled', 'catalog_version_expired', 'price_changed',
  'tax_changed', 'availability_changed', 'inventory_unavailable',
  'aggregate_version_conflict', 'command_expired', 'policy_changed',
  'unsupported_offline_command', 'ambiguous_payment_requires_query',
  'server_validation_failed', 'reconciliation_required', 'terminal_failure',
]);
export type ConflictClassification = z.infer<typeof ConflictClassification>;

export const OfflinePolicy = z.object({
  version: z.string().min(1).max(64),
  issuedAt: IsoTimestamp,
  expiresAt: IsoTimestamp,
  allowedCommandTypes: z.array(OfflineCommandType).max(16),
  cashSaleEnabled: z.literal(false),
  maxQueueDepth: z.number().int().positive().max(1000),
  maxBatchSize: z.number().int().positive().max(50),
  maxCommandAgeSeconds: z.number().int().positive().max(604800),
  webSensitiveJournalEnabled: z.literal(false),
}).strict();
export type OfflinePolicy = z.infer<typeof OfflinePolicy>;

export const OfflineCommand = z.object({
  commandId: Uuid,
  provisionalId: Uuid.nullable(),
  deviceId: Uuid,
  deviceCredentialVersion: z.number().int().positive(),
  deviceSequence: z.number().int().positive(),
  tenantId: Uuid,
  branchId: Uuid,
  operatorSessionId: Uuid,
  commandType: OfflineCommandType,
  idempotencyKey: Uuid,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  contractVersion: z.string().min(1).max(64),
  schemaVersion: z.number().int().positive(),
  createdAt: IsoTimestamp,
  payload: JsonPayload,
}).strict();
export type OfflineCommand = z.infer<typeof OfflineCommand>;

export const ReplayBatch = z.object({
  replaySessionId: Uuid,
  commands: z.array(OfflineCommand).min(1).max(50),
}).strict();
export type ReplayBatch = z.infer<typeof ReplayBatch>;

export const ReplayFailure = z.object({
  classification: ConflictClassification,
  retryable: z.boolean(),
  blocksFollowing: z.boolean(),
  operatorActionRequired: z.boolean(),
  managerActionRequired: z.boolean(),
  guidanceCode: z.string().min(1).max(100),
  correlationId: z.string().min(8).max(128),
}).strict();
export type ReplayFailure = z.infer<typeof ReplayFailure>;

export const ReplayResult = z.object({
  commandId: Uuid,
  deviceSequence: z.number().int().positive(),
  status: z.enum(['accepted', 'duplicate', 'conflict', 'rejected']),
  officialId: Uuid.nullable(),
  failure: ReplayFailure.nullable(),
}).strict();
export type ReplayResult = z.infer<typeof ReplayResult>;

export const ReplayCursor = z.object({
  deviceId: Uuid,
  credentialVersion: z.number().int().positive(),
  lastAcceptedSequence: z.number().int().nonnegative(),
  reconciliationRequired: z.boolean(),
  updatedAt: IsoTimestamp,
}).strict();
export type ReplayCursor = z.infer<typeof ReplayCursor>;

export const BeginReplayRequest = z.object({
  tenantId: Uuid, branchId: Uuid, operatorSessionId: Uuid,
  credentialVersion: z.number().int().positive(),
}).strict();
export type BeginReplayRequest = z.infer<typeof BeginReplayRequest>;
export const BeginReplayResponse = z.object({
  replaySessionId: Uuid, cursor: ReplayCursor, policy: OfflinePolicy,
}).strict();

export const ReplayBatchResult = z.object({
  replaySessionId: Uuid,
  results: z.array(ReplayResult).max(50),
  cursor: ReplayCursor,
  stopped: z.boolean(),
}).strict();
export type ReplayBatchResult = z.infer<typeof ReplayBatchResult>;

export const ReconciliationSummary = z.object({
  deviceId: Uuid,
  credentialVersion: z.number().int().positive(),
  localLastAllocatedSequence: z.number().int().nonnegative(),
  localLastAcknowledgedSequence: z.number().int().nonnegative(),
  serverLastAcceptedSequence: z.number().int().nonnegative(),
  missingSequences: z.array(z.number().int().positive()).max(100),
  duplicates: z.array(Uuid).max(100),
  conflicts: z.array(ReplayResult).max(100),
  provisionalMappings: z.array(z.object({
    provisionalId: Uuid, officialId: Uuid, commandId: Uuid,
  }).strict()).max(100),
  reconciliationRequired: z.boolean(),
}).strict();
export type ReconciliationSummary = z.infer<typeof ReconciliationSummary>;

export const ReconcileRequest = z.object({
  localLastAllocatedSequence: z.number().int().nonnegative(),
  localLastAcknowledgedSequence: z.number().int().nonnegative(),
}).strict();
export type ReconcileRequest = z.infer<typeof ReconcileRequest>;
export const AcknowledgeReconciliationRequest = z.object({
  reconciliationId: Uuid,
}).strict();
export type AcknowledgeReconciliationRequest = z.infer<typeof AcknowledgeReconciliationRequest>;
export const ReplayDiagnostics = z.object({
  contractVersion: z.string().min(1).max(64),
  serverLastAcceptedSequence: z.number().int().nonnegative(),
  acceptedCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  lastReplayAt: IsoTimestamp.nullable(),
  lastSafeErrorCategory: ConflictClassification.nullable(),
}).strict();
export const ReplayContextQuery = z.object({
  branchId: Uuid, operatorSessionId: Uuid,
  credentialVersion: z.coerce.number().int().positive(),
}).strict();
export type ReplayContextQuery = z.infer<typeof ReplayContextQuery>;
export const ReplayCommandResultQuery = ReplayContextQuery.extend({ commandId: Uuid }).strict();
export type ReplayCommandResultQuery = z.infer<typeof ReplayCommandResultQuery>;
export const ConflictSummary = z.object({
  items: z.array(ReplayResult).max(100),
}).strict();

export const posOfflineModels = {
  ConnectivityState, OfflineCommandType, ConflictClassification, OfflinePolicy,
  OfflineCommand, ReplayBatch, ReplayFailure, ReplayResult, ReplayCursor,
  BeginReplayRequest, BeginReplayResponse, ReplayBatchResult,
  ReconciliationSummary, ReconcileRequest, AcknowledgeReconciliationRequest,
  ReplayDiagnostics, ReplayContextQuery, ReplayCommandResultQuery, ConflictSummary,
} as const;
