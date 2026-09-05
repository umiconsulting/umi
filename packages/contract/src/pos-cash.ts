import { z } from 'zod';
import { MerchantDate, CorrelationId, CurrencyCode, IsoTimestamp, Money, Uuid } from './platform';

const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const PositiveMoney = Money.refine((value) => value.minorUnits > 0, 'Amount must be positive.');
const NonNegativeMoney = Money.refine(
  (value) => value.minorUnits >= 0,
  'Amount must not be negative.',
);
const SafeNote = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[^<>]*$/)
  .nullable();

export const RegisterStatus = z.enum([
  'available',
  'assigned',
  'in_use',
  'suspended',
  'counting',
  'reconciliation_required',
  'blocked',
  'archived',
]);
export const CashShiftStatus = z.enum([
  'opening',
  'open',
  'suspended',
  'handoff_pending',
  'counting',
  'reconciliation_required',
  'closing',
  'closed',
  'blocked',
  'recovered',
]);
export const CashMovementType = z.enum(['paid_in', 'paid_out', 'safe_drop', 'drawer_correction']);
export const CashLedgerEntryType = z.enum([
  'opening_float',
  'cash_sale',
  'cash_refund',
  'paid_in',
  'paid_out',
  'safe_drop',
  'drawer_correction',
  'handoff_transfer',
  'count_observation',
  'variance_resolution',
  'close_adjustment',
]);
export const CashCountState = z.enum([
  'not_started',
  'counting',
  'submitted',
  'variance_calculated',
  'recount_required',
  'approval_required',
  'resolved',
]);
export const CashVarianceReason = z.enum([
  'no_variance',
  'counting_error',
  'change_error',
  'unrecorded_paid_in',
  'unrecorded_paid_out',
  'missing_safe_drop',
  'cash_handling_error',
  'unknown_operational_difference',
  'other_approved_reason',
]);
export const CashReconciliationOutcome = z.enum([
  'balanced',
  'within_tolerance',
  'approved_variance',
  'recount_required',
  'approval_required',
  'posting_pending',
  'ambiguous_cash_effect',
  'blocked',
  'support_required',
]);
export const CashRecoveryState = z.enum([
  'none',
  'query_original_command',
  'shift_required',
  'shift_suspended',
  'reconciliation_required',
  'register_blocked',
  'operator_mismatch',
  'device_adoption_required',
  'credential_rotated',
  'policy_expired',
  'posting_pending',
  'ambiguous_cash_effect',
  'stale_count',
  'approval_required',
  'support_required',
]);

export const DenominationCount = z
  .object({
    denomination: PositiveMoney,
    quantity: z.number().int().min(0).max(100_000),
    lineTotal: NonNegativeMoney,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.denomination.currency !== value.lineTotal.currency ||
      value.denomination.minorUnits * value.quantity !== value.lineTotal.minorUnits
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The denomination line total is invalid.',
      });
    }
  });

const validateDenominations = (
  total: z.infer<typeof Money>,
  lines: z.infer<typeof DenominationCount>[],
  context: z.RefinementCtx,
) => {
  if (lines.length === 0) return;
  const keys = lines.map((line) => `${line.denomination.currency}:${line.denomination.minorUnits}`);
  const sum = lines.reduce((value, line) => value + line.lineTotal.minorUnits, 0);
  if (
    new Set(keys).size !== keys.length ||
    lines.some((line) => line.denomination.currency !== total.currency) ||
    sum !== total.minorUnits
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The denomination lines must be unique and equal the declared total.',
    });
  }
};

export const RegisterAssignment = z
  .object({
    deviceId: Uuid.nullable(),
    allowedDeviceClasses: z.array(z.string().min(1).max(40)).max(16),
    assignedAt: IsoTimestamp.nullable(),
  })
  .strict();
export const PhysicalRegister = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    displayName: z.string().trim().min(1).max(80),
    publicReference: z.string().min(1).max(80),
    currency: CurrencyCode,
    active: z.boolean(),
    assignmentPolicy: z.enum(['device_required', 'operator_selects']),
    assignment: RegisterAssignment,
    currentShiftId: Uuid.nullable(),
    status: RegisterStatus,
    version: z.number().int().positive(),
    createdAt: IsoTimestamp,
    archivedAt: IsoTimestamp.nullable(),
  })
  .strict();

export const CashShiftPolicy = z
  .object({
    version: z.string().min(1).max(64),
    issuedAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
    fingerprint: Fingerprint,
    cashShiftRequired: z.boolean(),
    registerAssignmentRequired: z.boolean(),
    oneShiftPerOperator: z.boolean(),
    oneShiftPerRegister: z.boolean(),
    openingFloatRequired: z.boolean(),
    maximumOpeningFloat: NonNegativeMoney,
    allowedMovementTypes: z.array(CashMovementType).max(4),
    movementApprovalThreshold: NonNegativeMoney,
    countMethod: z.enum(['total_only', 'denomination_or_total']),
    blindCountRequired: z.boolean(),
    handoffAllowed: z.boolean(),
    handoffCountRequired: z.boolean(),
    varianceTolerance: NonNegativeMoney,
    closeApprovalThreshold: NonNegativeMoney,
    noSaleDrawerAllowed: z.boolean(),
    offlineCashShiftAllowed: z.boolean(),
    denominations: z.array(PositiveMoney).max(64),
  })
  .strict();

export const CashShift = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    registerId: Uuid,
    deviceId: Uuid,
    deviceCredentialVersion: z.number().int().positive(),
    /**
     * The terminal holding the drawer right now. Equal to `deviceId` until custody
     * moves — a replaced tablet, a rotated credential, or a web POS that lost its
     * browser storage and came back as a new device.
     */
    holdingDeviceId: Uuid,
    holdingDeviceCredentialVersion: z.number().int().positive(),
    openingOperatorId: Uuid,
    responsibleOperatorId: Uuid,
    operatorSessionId: Uuid,
    currency: CurrencyCode,
    businessDate: MerchantDate,
    status: CashShiftStatus,
    openingCommandId: Uuid,
    openedAt: IsoTimestamp,
    suspendedAt: IsoTimestamp.nullable(),
    closedAt: IsoTimestamp.nullable(),
    ledgerSequence: z.number().int().min(0),
    version: z.number().int().positive(),
  })
  .strict();

export const OpeningFloat = z
  .object({
    total: NonNegativeMoney,
    denominations: z.array(DenominationCount).max(64),
    note: SafeNote,
  })
  .strict()
  .superRefine((value, context) =>
    validateDenominations(value.total, value.denominations, context),
  );

const CommandContext = {
  locationId: Uuid,
  operatorSessionId: Uuid,
  commandId: Uuid,
  idempotencyKey: Uuid,
};

export const OpenCashShiftRequest = z
  .object({
    ...CommandContext,
    registerId: Uuid,
    openingFloat: NonNegativeMoney,
    denominations: z.array(DenominationCount).max(64),
    businessDate: MerchantDate,
    note: SafeNote,
    expectedRegisterVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) =>
    validateDenominations(value.openingFloat, value.denominations, context),
  );

export const OpenCashShiftResult = z
  .object({
    register: PhysicalRegister,
    shift: CashShift,
    openingFloat: OpeningFloat,
    policy: CashShiftPolicy,
    correlationId: CorrelationId,
    recovered: z.boolean(),
  })
  .strict();

export const CashLedgerEntry = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    registerId: Uuid,
    shiftId: Uuid,
    sequence: z.number().int().positive(),
    type: CashLedgerEntryType,
    amount: Money,
    cashReceived: NonNegativeMoney,
    changeGiven: NonNegativeMoney,
    saleId: Uuid.nullable(),
    commandId: Uuid,
    businessDate: MerchantDate,
    occurredAt: IsoTimestamp,
  })
  .strict();

export const CashMovementRequest = z
  .object({
    ...CommandContext,
    shiftId: Uuid,
    type: CashMovementType,
    amount: PositiveMoney,
    reasonCode: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_.-]+$/),
    note: SafeNote,
    approvalId: Uuid.nullable(),
    actionFingerprint: Fingerprint.nullable().optional(),
    expectedShiftVersion: z.number().int().positive(),
  })
  .strict();
export const CashMovement = z
  .object({
    id: Uuid,
    type: CashMovementType,
    amount: PositiveMoney,
    reasonCode: z.string().min(1).max(80),
    note: SafeNote,
    operatorId: Uuid,
    shiftId: Uuid,
    registerId: Uuid,
    businessDate: MerchantDate,
    ledgerEntry: CashLedgerEntry,
    committedAt: IsoTimestamp,
  })
  .strict();

export const ExpectedCash = z
  .object({
    openingFloat: NonNegativeMoney,
    grossCashReceived: NonNegativeMoney,
    changeGiven: NonNegativeMoney,
    netCashSales: Money,
    paidIn: NonNegativeMoney,
    paidOut: NonNegativeMoney,
    safeDrops: NonNegativeMoney,
    adjustments: Money,
    expectedDrawerCash: Money,
    currency: CurrencyCode,
    ledgerSequence: z.number().int().min(0),
    calculatedAt: IsoTimestamp,
    shiftVersion: z.number().int().positive(),
  })
  .strict();

export const SubmitBlindCountRequest = z
  .object({
    ...CommandContext,
    shiftId: Uuid,
    countedCash: NonNegativeMoney,
    denominations: z.array(DenominationCount).max(64),
    expectedShiftVersion: z.number().int().positive(),
    expectedLedgerSequence: z.number().int().min(0),
    note: SafeNote,
  })
  .strict()
  .superRefine((value, context) =>
    validateDenominations(value.countedCash, value.denominations, context),
  );

export const BlindCount = z
  .object({
    id: Uuid,
    shiftId: Uuid,
    attemptNumber: z.number().int().positive(),
    state: CashCountState,
    countedCash: NonNegativeMoney,
    denominations: z.array(DenominationCount).max(64),
    operatorId: Uuid,
    ledgerSequence: z.number().int().min(0),
    submittedAt: IsoTimestamp,
  })
  .strict();
export const CashVariance = z
  .object({
    expectedCash: Money,
    countedCash: Money,
    signedVariance: Money,
    absoluteVariance: NonNegativeMoney,
    tolerance: NonNegativeMoney,
    withinTolerance: z.boolean(),
    approvalRequired: z.boolean(),
    reasonRequired: z.boolean(),
    outcome: CashReconciliationOutcome,
    ledgerSequence: z.number().int().min(0),
  })
  .strict();
export const CashCountSummary = z
  .object({
    count: BlindCount,
    variance: CashVariance,
    approvalFingerprint: Fingerprint.nullable(),
  })
  .strict();
export const CashCountLine = DenominationCount;

export const RecountRequest = z
  .object({
    ...CommandContext,
    shiftId: Uuid,
    priorCountAttemptId: Uuid,
    reasonCode: z.string().min(1).max(80),
    expectedShiftVersion: z.number().int().positive(),
  })
  .strict();

export const CashVarianceResolution = z
  .object({
    id: Uuid,
    shiftId: Uuid,
    countAttemptId: Uuid,
    reason: CashVarianceReason,
    note: SafeNote,
    approvalId: Uuid.nullable(),
    approvalFingerprint: Fingerprint.nullable(),
    ledgerSequence: z.number().int().min(0),
    resolvedAt: IsoTimestamp,
  })
  .strict();
export const ResolveCashVarianceRequest = z
  .object({
    ...CommandContext,
    shiftId: Uuid,
    countAttemptId: Uuid,
    reason: CashVarianceReason,
    note: SafeNote,
    approvalId: Uuid.nullable(),
    approvalFingerprint: Fingerprint.nullable(),
    expectedShiftVersion: z.number().int().positive(),
  })
  .strict();

export const CashApprovalRequest = z
  .object({
    locationId: Uuid,
    shiftId: Uuid,
    countAttemptId: Uuid,
    variance: Money,
    reason: CashVarianceReason,
    ledgerSequence: z.number().int().min(0),
    commandFingerprint: Fingerprint,
    managerPin: z.string().regex(/^\d{4,8}$/),
  })
  .strict();
export const CashApprovalResult = z
  .object({
    approvalId: Uuid,
    permission: z.literal('cash.variance.approve'),
    commandFingerprint: Fingerprint,
    expiresAt: IsoTimestamp,
    approvingOperatorReference: z.string().min(1).max(80),
  })
  .strict();

export const ShiftTransitionRequest = z
  .object({
    ...CommandContext,
    shiftId: Uuid,
    expectedShiftVersion: z.number().int().positive(),
    reasonCode: z.string().min(1).max(80).nullable(),
  })
  .strict();
export const ShiftHandoffRequest = z
  .object({
    ...CommandContext,
    shiftId: Uuid,
    expectedShiftVersion: z.number().int().positive(),
    incomingOperatorPin: z.string().regex(/^\d{4,8}$/),
    fingerprint: Fingerprint,
  })
  .strict();
export const ShiftHandoff = z
  .object({
    id: Uuid,
    shiftId: Uuid,
    outgoingOperatorId: Uuid,
    incomingOperatorId: Uuid,
    expectedCash: ExpectedCash,
    completedAt: IsoTimestamp,
  })
  .strict();

export const NoSaleDrawerRequest = z
  .object({
    ...CommandContext,
    shiftId: Uuid,
    reasonCode: z.string().min(1).max(80),
    approvalId: Uuid,
    approvalFingerprint: Fingerprint,
  })
  .strict();
export const NoSaleDrawerEvent = z
  .object({
    id: Uuid,
    shiftId: Uuid,
    status: z.literal('requested'),
    verifiedHardwareResult: z.literal(false),
    requestedAt: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();

export const ShiftReconciliation = z
  .object({
    id: Uuid,
    shiftId: Uuid,
    countAttemptId: Uuid,
    expectedCash: ExpectedCash,
    selectedCount: BlindCount,
    variance: CashVariance,
    resolution: CashVarianceResolution.nullable(),
    outcome: CashReconciliationOutcome,
    ledgerSequence: z.number().int().min(0),
    closeApprovalRequired: z.boolean(),
    closeApprovalFingerprint: Fingerprint.nullable(),
    reconciledAt: IsoTimestamp,
  })
  .strict();
export const ReconcileCashShiftRequest = z
  .object({
    ...CommandContext,
    shiftId: Uuid,
    countAttemptId: Uuid,
    resolutionId: Uuid.nullable(),
    expectedShiftVersion: z.number().int().positive(),
  })
  .strict();

export const CashShiftSummary = z
  .object({
    shift: CashShift,
    register: PhysicalRegister,
    openingFloat: NonNegativeMoney,
    expectedCash: ExpectedCash,
    countedCash: Money.nullable(),
    variance: Money.nullable(),
    varianceReason: CashVarianceReason.nullable(),
    reconciliationOutcome: CashReconciliationOutcome.nullable(),
    countAttempts: z.number().int().min(0),
    handoffCount: z.number().int().min(0),
  })
  .strict();
export const ShiftCloseRequest = z
  .object({
    ...CommandContext,
    shiftId: Uuid,
    countAttemptId: Uuid,
    reconciliationId: Uuid,
    approvalId: Uuid.nullable(),
    approvalFingerprint: Fingerprint.nullable(),
    expectedShiftVersion: z.number().int().positive(),
  })
  .strict();
export const ShiftCloseResult = z
  .object({
    summary: CashShiftSummary,
    reconciliation: ShiftReconciliation,
    closedAt: IsoTimestamp,
    correlationId: CorrelationId,
    recovered: z.boolean(),
  })
  .strict();

export const CashShiftCustodyEventType = z.enum(['device_adoption', 'manager_recovery']);

/**
 * One rebinding of a cash shift onto a different terminal, or onto a manager who is
 * closing it out. Read it as the chain of custody for the drawer: both sides of the
 * swap are named, so a reader can always say which terminal held the money when.
 */
export const CashShiftCustodyEvent = z
  .object({
    id: Uuid,
    shiftId: Uuid,
    registerId: Uuid,
    eventType: CashShiftCustodyEventType,
    previousHoldingDeviceId: Uuid,
    newHoldingDeviceId: Uuid.nullable(),
    actingOperatorId: Uuid,
    responsibleOperatorId: Uuid,
    shiftStatusBefore: CashShiftStatus,
    shiftStatusAfter: CashShiftStatus,
    expectedCash: Money.nullable(),
    countedCash: Money.nullable(),
    variance: Money.nullable(),
    reasonCode: z.string().min(1).max(80),
    note: SafeNote,
    occurredAt: IsoTimestamp,
  })
  .strict();

/**
 * The same operator takes their own open shift back onto the terminal in front of
 * them. No approval and no count: nothing about the drawer changes, only which device
 * is allowed to speak for it. This is the ordinary path after a browser loses its
 * stored identity, which on web is one clearing of site data away.
 */
export const AdoptCashShiftRequest = z
  .object({
    ...CommandContext,
    shiftId: Uuid,
    expectedShiftVersion: z.number().int().positive(),
    reasonCode: z.string().min(1).max(80),
  })
  .strict();

export const AdoptCashShiftResult = z
  .object({
    shift: CashShift,
    register: PhysicalRegister,
    custody: CashShiftCustodyEvent,
    correlationId: CorrelationId,
  })
  .strict();

/**
 * A manager closes out a shift whose operator cannot come back to close it — the
 * terminal is gone, or the person is. The manager counts the drawer under their own
 * name and the shift lands on `recovered`, never `closed`, so a report can always
 * tell a counted-out shift from one its own cashier reconciled.
 */
export const RecoverCashShiftRequest = z
  .object({
    ...CommandContext,
    shiftId: Uuid,
    countedCash: NonNegativeMoney,
    denominations: z.array(DenominationCount).max(64),
    approvalId: Uuid,
    approvalFingerprint: Fingerprint,
    expectedShiftVersion: z.number().int().positive(),
    reasonCode: z.string().min(1).max(80),
    note: SafeNote,
  })
  .strict()
  .superRefine((value, context) =>
    validateDenominations(value.countedCash, value.denominations, context),
  );

export const RecoverCashShiftResult = z
  .object({
    summary: CashShiftSummary,
    custody: CashShiftCustodyEvent,
    recoveredAt: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();

export const CashCenterQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
  })
  .strict();
export const CashCommandRecoveryQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    commandId: Uuid,
    idempotencyKey: Uuid,
  })
  .strict();
export const CashCommandRecoveryResult = z
  .object({
    commandId: Uuid,
    commandType: z.string().min(1).max(100).nullable(),
    status: z.enum(['not_found', 'processing', 'succeeded', 'failed']),
    retryable: z.boolean(),
    failureCode: z.string().min(1).max(100).nullable(),
    correlationId: CorrelationId.nullable(),
  })
  .strict();
export const CashCenterSnapshot = z
  .object({
    businessDate: MerchantDate,
    policy: CashShiftPolicy,
    registers: z.array(PhysicalRegister).max(100),
    currentShift: CashShift.nullable(),
    /**
     * The operator's own open shift, sitting on a terminal that is not this one. It
     * appears when this device cannot find a shift of its own but the operator still
     * has one somewhere — the ordinary shape of a web POS that lost its stored
     * identity. `adopt_shift` moves it here.
     */
    adoptableShift: CashShift.nullable(),
    expectedCash: ExpectedCash.nullable(),
    latestCount: CashCountSummary.nullable(),
    varianceResolution: CashVarianceResolution.nullable(),
    reconciliation: ShiftReconciliation.nullable(),
    recoveryState: CashRecoveryState,
    allowedActions: z.array(z.string().min(1).max(80)).max(24),
    summary: CashShiftSummary.nullable(),
  })
  .strict();
export const CashConflict = z
  .object({
    code: z.string().min(1).max(100),
    recoveryState: CashRecoveryState,
    blocksCash: z.boolean(),
    actionCode: z.string().min(1).max(100),
    correlationId: CorrelationId,
  })
  .strict();
export const SafeCashDiagnostic = z
  .object({
    registerReference: z.string().min(1).max(80).nullable(),
    shiftReference: z.string().min(1).max(80).nullable(),
    shiftStatus: CashShiftStatus.nullable(),
    ledgerSequence: z.number().int().min(0),
    recoveryState: CashRecoveryState,
    correlationId: CorrelationId,
  })
  .strict();

export type CashShiftPolicy = z.infer<typeof CashShiftPolicy>;
export type RegisterStatus = z.infer<typeof RegisterStatus>;
export type CashShiftStatus = z.infer<typeof CashShiftStatus>;
export type CashMovementType = z.infer<typeof CashMovementType>;
export type CashLedgerEntryType = z.infer<typeof CashLedgerEntryType>;
export type CashCountState = z.infer<typeof CashCountState>;
export type CashVariance = z.infer<typeof CashVariance>;
export type CashVarianceReason = z.infer<typeof CashVarianceReason>;
export type CashReconciliationOutcome = z.infer<typeof CashReconciliationOutcome>;
export type CashRecoveryState = z.infer<typeof CashRecoveryState>;
export type PhysicalRegister = z.infer<typeof PhysicalRegister>;
export type CashShift = z.infer<typeof CashShift>;
export type OpenCashShiftRequest = z.infer<typeof OpenCashShiftRequest>;
export type OpenCashShiftResult = z.infer<typeof OpenCashShiftResult>;
export type CashMovementRequest = z.infer<typeof CashMovementRequest>;
export type CashMovement = z.infer<typeof CashMovement>;
export type ExpectedCash = z.infer<typeof ExpectedCash>;
export type SubmitBlindCountRequest = z.infer<typeof SubmitBlindCountRequest>;
export type CashCountSummary = z.infer<typeof CashCountSummary>;
export type CashShiftSummary = z.infer<typeof CashShiftSummary>;
export type ResolveCashVarianceRequest = z.infer<typeof ResolveCashVarianceRequest>;
export type ReconcileCashShiftRequest = z.infer<typeof ReconcileCashShiftRequest>;
export type ShiftCloseRequest = z.infer<typeof ShiftCloseRequest>;
export type ShiftCloseResult = z.infer<typeof ShiftCloseResult>;
export type CashCenterQuery = z.infer<typeof CashCenterQuery>;
export type CashCommandRecoveryQuery = z.infer<typeof CashCommandRecoveryQuery>;
export type CashCommandRecoveryResult = z.infer<typeof CashCommandRecoveryResult>;
export type CashCenterSnapshot = z.infer<typeof CashCenterSnapshot>;
export type ShiftTransitionRequest = z.infer<typeof ShiftTransitionRequest>;
export type ShiftHandoffRequest = z.infer<typeof ShiftHandoffRequest>;
export type RecountRequest = z.infer<typeof RecountRequest>;
export type NoSaleDrawerRequest = z.infer<typeof NoSaleDrawerRequest>;
export type NoSaleDrawerEvent = z.infer<typeof NoSaleDrawerEvent>;
export type ShiftHandoff = z.infer<typeof ShiftHandoff>;
export type CashShiftCustodyEventType = z.infer<typeof CashShiftCustodyEventType>;
export type CashShiftCustodyEvent = z.infer<typeof CashShiftCustodyEvent>;
export type AdoptCashShiftRequest = z.infer<typeof AdoptCashShiftRequest>;
export type AdoptCashShiftResult = z.infer<typeof AdoptCashShiftResult>;
export type RecoverCashShiftRequest = z.infer<typeof RecoverCashShiftRequest>;
export type RecoverCashShiftResult = z.infer<typeof RecoverCashShiftResult>;

export const posCashModels = {
  RegisterStatus,
  RegisterAssignment,
  PhysicalRegister,
  CashShiftStatus,
  CashShift,
  CashShiftPolicy,
  OpeningFloat,
  OpenCashShiftRequest,
  OpenCashShiftResult,
  CashMovementType,
  CashLedgerEntryType,
  CashLedgerEntry,
  CashMovementRequest,
  CashMovement,
  ExpectedCash,
  DenominationCount,
  CashCountLine,
  CashCountState,
  SubmitBlindCountRequest,
  BlindCount,
  CashVariance,
  CashVarianceReason,
  CashVarianceResolution,
  ResolveCashVarianceRequest,
  CashCountSummary,
  RecountRequest,
  CashApprovalRequest,
  CashApprovalResult,
  ShiftTransitionRequest,
  ShiftHandoffRequest,
  ShiftHandoff,
  NoSaleDrawerRequest,
  NoSaleDrawerEvent,
  CashReconciliationOutcome,
  ShiftReconciliation,
  ReconcileCashShiftRequest,
  CashShiftSummary,
  ShiftCloseRequest,
  ShiftCloseResult,
  CashShiftCustodyEventType,
  CashShiftCustodyEvent,
  AdoptCashShiftRequest,
  AdoptCashShiftResult,
  RecoverCashShiftRequest,
  RecoverCashShiftResult,
  CashRecoveryState,
  CashCenterQuery,
  CashCommandRecoveryQuery,
  CashCommandRecoveryResult,
  CashCenterSnapshot,
  CashConflict,
  SafeCashDiagnostic,
};
