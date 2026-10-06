import { z } from 'zod';
import { CorrelationId, CurrencyCode, IsoTimestamp, MerchantDate, Uuid } from './platform';

export const HardwareDeviceType = z.enum([
  'printer',
  'cash_drawer',
  'barcode_scanner',
  'customer_display',
  'payment_terminal_foundation',
  'scale_foundation',
]);
export const HardwareTransport = z.enum([
  'simulator',
  'network_tcp',
  'printer_attached',
  'keyboard_wedge',
  'usb_foundation',
  'bluetooth_foundation',
  'network_foundation',
  'serial_foundation',
  'platform_channel_foundation',
]);
export const HardwareCapability = z.enum([
  'printer.receipt',
  'printer.image',
  'printer.qr',
  'printer.cut',
  'printer.test_page',
  'printer.kitchen_ticket_foundation',
  'drawer.open',
  'drawer.status',
  'scanner.barcode',
  'scanner.qr',
  'scanner.continuous',
  'scanner.single',
  'customer_display.text',
  'customer_display.totals',
  'customer_display.qr',
  'terminal.connect_foundation',
  'terminal.payment_foundation',
  'terminal.refund_foundation',
  'scale.read_weight_foundation',
  'scale.tare_foundation',
]);
export const HardwareConnectionState = z.enum([
  'connected',
  'disconnected',
  'connecting',
  'busy',
  'recovering',
  'failed',
  'disabled',
  'error',
  'unknown',
]);
export const HardwareHealth = z.enum(['healthy', 'degraded', 'unavailable', 'unknown']);

export const HardwareConnectionConfiguration = z
  .object({
    networkHost: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[A-Za-z0-9.-]+$/)
      .nullable()
      .default(null),
    networkPort: z.number().int().min(1).max(65535).nullable().default(null),
    connectTimeoutMs: z.number().int().min(250).max(10_000).default(2_000),
    commandTimeoutMs: z.number().int().min(500).max(30_000).default(5_000),
    characterEncoding: z.enum(['cp850', 'utf8']).default('cp850'),
    receiptWidthColumns: z.number().int().min(20).max(120).default(42),
    drawerPulsePin: z.number().int().min(0).max(1).default(0),
    drawerPulseOnMs: z.number().int().min(10).max(500).default(50),
    scannerTerminator: z.enum(['enter', 'tab']).default('enter'),
    scannerBurstWindowMs: z.number().int().min(20).max(500).default(80),
  })
  .strict();

export const HardwarePilotPolicy = z
  .object({
    autoPrintReceipt: z.boolean().default(true),
    openDrawerOnCashSale: z.boolean().default(true),
    openDrawerOnCashRefund: z.boolean().default(true),
    allowNoSale: z.boolean().default(false),
    receiptCopiesDefault: z.number().int().min(1).max(3).default(1),
    hardwareRetryLimit: z.number().int().min(1).max(3).default(2),
    hardwareHealthIntervalSeconds: z.number().int().min(15).max(300).default(30),
    scannerEnabled: z.boolean().default(true),
    customerDisplayEnabled: z.boolean().default(false),
  })
  .strict();
export const HardwareCommandType = z.enum([
  'print_receipt',
  'print_kitchen_ticket_foundation',
  'print_test_page',
  'controlled_reprint',
  'cancel_pending_print',
  'query_printer_status',
  'open_drawer',
  'query_drawer_status',
  'test_drawer',
  'begin_scanner_session',
  'end_scanner_session',
  'update_customer_display',
  'clear_customer_display',
  'run_diagnostic',
  'terminal_connect_foundation',
  'terminal_disconnect_foundation',
  'scale_read_foundation',
]);
export const HardwareCommandStatus = z.enum([
  'pending',
  'dispatching',
  'succeeded',
  'failed',
  'retryable',
  'cancelled',
  'unknown',
]);
export const HardwareFailureCode = z.enum([
  'hardware_not_found',
  'hardware_disabled',
  'hardware_not_assigned',
  'capability_unsupported',
  'disconnected',
  'busy',
  'paper_out',
  'cover_open_foundation',
  'transport_unavailable',
  'command_timeout',
  'unknown_outcome',
  'permission_denied',
  'location_mismatch',
  'register_mismatch',
  'configuration_stale',
  'retryable_transport_failure',
  'terminal_hardware_failure',
]);

const PublicReference = z.string().trim().min(1).max(160);
const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const IdempotencyKey = z.string().trim().min(8).max(128);
const SafeMetadata = z
  .object({
    statusMessage: z.string().trim().max(240).nullable().optional(),
    latencyMs: z.number().int().min(0).max(120_000).nullable().optional(),
    artifactReference: PublicReference.nullable().optional(),
    acknowledged: z.boolean().nullable().optional(),
    commandId: Uuid.optional(),
    commandStatus: HardwareCommandStatus.optional(),
    recovered: z.boolean().optional(),
    connectionState: HardwareConnectionState.optional(),
    attemptLimitReached: z.boolean().optional(),
  })
  .strict();

export const HardwareAssignment = z
  .object({
    merchantId: Uuid,
    locationId: Uuid,
    registerId: Uuid.nullable(),
    assignedPosDeviceId: Uuid.nullable(),
    primary: z.boolean(),
  })
  .strict();

export const HardwareDevice = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    registerId: Uuid.nullable(),
    assignedPosDeviceId: Uuid.nullable(),
    primary: z.boolean().default(false),
    type: HardwareDeviceType,
    manufacturer: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(120),
    publicReference: PublicReference,
    transport: HardwareTransport,
    connectionConfiguration: HardwareConnectionConfiguration.default({}),
    capabilities: z.array(HardwareCapability).max(32),
    enabled: z.boolean(),
    configurationVersion: z.number().int().positive(),
    connectionState: HardwareConnectionState,
    firmwareVersion: z.string().trim().max(120).nullable(),
    lastHeartbeatAt: IsoTimestamp.nullable(),
    lastDiagnosticAt: IsoTimestamp.nullable(),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp,
    archivedAt: IsoTimestamp.nullable(),
    optimisticVersion: z.number().int().positive(),
  })
  .strict();

export const PrinterCapabilities = z
  .object({
    receipt: z.boolean(),
    image: z.boolean(),
    qr: z.boolean(),
    cut: z.boolean(),
    testPage: z.boolean(),
    kitchenTicketFoundation: z.boolean(),
    supportedWidths: z.array(z.number().int().min(20).max(120)).max(8),
  })
  .strict();
export const PrinterDevice = HardwareDevice.extend({
  type: z.literal('printer'),
  printerCapabilities: PrinterCapabilities,
});
export const CashDrawerDevice = HardwareDevice.extend({ type: z.literal('cash_drawer') });
export const BarcodeScannerDevice = HardwareDevice.extend({ type: z.literal('barcode_scanner') });
export const CustomerDisplayDevice = HardwareDevice.extend({
  type: z.literal('customer_display'),
});
export const PaymentTerminalDeviceFoundation = HardwareDevice.extend({
  type: z.literal('payment_terminal_foundation'),
  executionEnabled: z.literal(false),
});
export const ScaleDeviceFoundation = HardwareDevice.extend({
  type: z.literal('scale_foundation'),
  pricingIntegrationEnabled: z.literal(false),
});

export const HardwareFailure = z
  .object({
    code: HardwareFailureCode,
    retryable: z.boolean(),
    operatorGuidance: z.string().trim().min(1).max(160),
    safeDetail: z.string().trim().max(240).nullable().default(null),
    correlationId: CorrelationId.nullable().default(null),
  })
  .strict();

export const HardwareCommand = z
  .object({
    commandId: Uuid,
    commandType: HardwareCommandType,
    targetHardwareId: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    registerId: Uuid.nullable(),
    originatingPosDeviceId: Uuid,
    operatorId: Uuid,
    sourceAggregateType: z.string().trim().min(1).max(80),
    sourceAggregateId: PublicReference,
    payloadFingerprint: Fingerprint,
    idempotencyKey: IdempotencyKey,
    expectedConfigurationVersion: z.number().int().positive(),
    correlationId: CorrelationId,
    status: HardwareCommandStatus,
    createdAt: IsoTimestamp,
    startedAt: IsoTimestamp.nullable(),
    completedAt: IsoTimestamp.nullable(),
    failureCode: HardwareFailureCode.nullable(),
    safeResultMetadata: SafeMetadata,
  })
  .strict();
export const HardwareCommandResult = z
  .object({
    command: HardwareCommand,
    recovered: z.boolean(),
    failure: HardwareFailure.nullable(),
    dispatchPayload: z.lazy(() => HardwareDispatchPayload),
  })
  .strict();

export const HardwareDiagnostic = z.enum([
  'query_status',
  'connection_test',
  'capability_report',
  'printer_test_page',
  'drawer_test',
  'scanner_test_session',
  'customer_display_test',
  'runtime_snapshot',
]);
export const HardwareDiagnosticResult = z
  .object({
    diagnosticId: Uuid,
    hardwareId: Uuid,
    diagnostic: HardwareDiagnostic,
    health: HardwareHealth,
    connectionState: HardwareConnectionState,
    capabilities: z.array(HardwareCapability).max(32),
    latencyMs: z.number().int().min(0).max(120_000).nullable(),
    failure: HardwareFailure.nullable(),
    occurredAt: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();

export const PrintJobType = z.enum([
  'official_receipt',
  'receipt_copy',
  'test_page',
  'kitchen_ticket_foundation',
  'diagnostic_page_foundation',
]);
export const PrintJobStatus = z.enum([
  'queued',
  'printing',
  'printed',
  'retryable_failure',
  'terminal_failure',
  'cancelled',
  'unknown_outcome',
]);
export const PrintDocument = z
  .object({
    documentType: PrintJobType,
    widthColumns: z.number().int().min(20).max(120),
    contentFingerprint: Fingerprint,
  })
  .strict();
const ReceiptItem = z
  .object({
    name: z.string().trim().min(1).max(160),
    quantity: z.number().int().positive(),
    totalMinorUnits: z.number().int().nonnegative(),
    modifiers: z.array(z.string().trim().min(1).max(120)).max(40),
  })
  .strict();
const ReceiptTender = z
  .object({
    type: z.enum(['cash', 'manual_terminal', 'wallet', 'gift_card', 'other']),
    amountMinorUnits: z.number().int().nonnegative(),
    maskedReference: z.string().trim().max(80).nullable(),
  })
  .strict();
export const ReceiptPrintPayload = z
  .object({
    receiptId: PublicReference,
    merchantName: z.string().trim().min(1).max(160),
    locationName: z.string().trim().min(1).max(160),
    registerName: z.string().trim().max(160).nullable(),
    receiptNumber: PublicReference,
    businessDate: MerchantDate,
    currency: CurrencyCode,
    items: z.array(ReceiptItem).max(500),
    subtotalMinorUnits: z.number().int().nonnegative(),
    discountMinorUnits: z.number().int().nonnegative(),
    taxMinorUnits: z.number().int().nonnegative(),
    tipMinorUnits: z.number().int().nonnegative(),
    totalMinorUnits: z.number().int().nonnegative(),
    tenders: z.array(ReceiptTender).max(16),
    changeMinorUnits: z.number().int().nonnegative(),
    loyaltySummary: z.string().trim().max(240).nullable(),
    customerValueSummary: z.string().trim().max(240).nullable(),
    exceptionMarker: z.enum(['refund', 'void', 'provisional']).nullable(),
    qrValue: z.string().trim().max(512).nullable(),
    footer: z.string().trim().max(500).nullable(),
  })
  .strict();
export const KitchenTicketPrintPayloadFoundation = z
  .object({
    orderReference: PublicReference,
    items: z.array(ReceiptItem).max(500),
    operationalOnly: z.literal(true),
  })
  .strict();

export const PrintJob = z
  .object({
    jobId: Uuid,
    targetPrinterId: Uuid,
    type: PrintJobType,
    sourceAggregateType: z.string().trim().min(1).max(80),
    sourceAggregateId: PublicReference,
    correlationId: CorrelationId,
    idempotencyKey: IdempotencyKey,
    payloadFingerprint: Fingerprint,
    copies: z.number().int().min(1).max(10),
    status: PrintJobStatus,
    attempts: z.number().int().min(0).max(10),
    createdAt: IsoTimestamp,
    startedAt: IsoTimestamp.nullable(),
    completedAt: IsoTimestamp.nullable(),
    failure: HardwareFailure.nullable(),
    originalJobId: Uuid.nullable(),
  })
  .strict();

export const CashDrawerCommand = z
  .object({
    reason: z.enum([
      'cash_sale',
      'cash_refund',
      'paid_in',
      'paid_out',
      'safe_drop',
      'register_open',
      'register_close_foundation',
      'no_sale',
      'manager_test',
    ]),
    cashReference: PublicReference.nullable(),
    approvalId: Uuid.nullable(),
  })
  .strict();
export const BarcodeType = z.enum(['ean', 'upc', 'code128', 'qr', 'unknown_symbology']);
export const BarcodeScanEvent = z
  .object({
    scannerId: Uuid,
    posDeviceId: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    registerId: Uuid.nullable(),
    symbology: BarcodeType,
    normalizedValue: z.string().trim().min(1).max(256),
    occurredAt: IsoTimestamp,
    eventSequence: z.number().int().positive(),
    correlationId: CorrelationId,
  })
  .strict();
export const CustomerDisplayState = z
  .object({
    state: z.enum(['idle', 'sale_active', 'payment', 'completed', 'error_safe']),
    items: z.array(ReceiptItem).max(100),
    subtotalMinorUnits: z.number().int().nonnegative(),
    discountMinorUnits: z.number().int().nonnegative(),
    taxMinorUnits: z.number().int().nonnegative(),
    tipMinorUnits: z.number().int().nonnegative(),
    totalMinorUnits: z.number().int().nonnegative(),
    amountDueMinorUnits: z.number().int().nonnegative(),
    receivedMinorUnits: z.number().int().nonnegative(),
    changeMinorUnits: z.number().int().nonnegative(),
    currency: CurrencyCode,
    receiptQr: z.string().trim().max(512).nullable(),
    messageCode: z.string().trim().max(80).nullable(),
  })
  .strict();
export const CustomerDisplayCommand = z
  .object({ displayId: Uuid, state: CustomerDisplayState })
  .strict();
export const HardwareDispatchPayload = z
  .object({
    drawer: CashDrawerCommand.nullable().default(null),
    display: CustomerDisplayState.nullable().default(null),
    printPayload: ReceiptPrintPayload.nullable().default(null),
  })
  .strict();

export const HardwareRecoveryState = z.enum([
  'none',
  'pending_print',
  'failed_print',
  'unknown_print',
  'drawer_unknown',
  'disconnected',
  'stale_assignment',
  'stale_configuration',
  'recovered',
]);
export const HardwareRuntimeSnapshot = z
  .object({
    merchantId: Uuid,
    locationId: Uuid,
    registerId: Uuid.nullable(),
    policy: HardwarePilotPolicy.default({}),
    policyVersion: z.number().int().positive().default(1),
    devices: z.array(HardwareDevice).max(100),
    printJobs: z.array(PrintJob).max(100).default([]),
    recoveryStates: z.array(HardwareRecoveryState).max(100).default([]),
    pendingJobs: z.number().int().nonnegative(),
    retryableJobs: z.number().int().nonnegative(),
    unknownCommands: z.number().int().nonnegative(),
    capturedAt: IsoTimestamp,
  })
  .strict();

export const HardwareRegistryQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    registerId: Uuid.optional(),
    includeDisabled: z.coerce.boolean().default(false),
  })
  .strict();
export const RegisterHardwareRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    registerId: Uuid.nullable().default(null),
    assignedPosDeviceId: Uuid.nullable().default(null),
    type: HardwareDeviceType,
    manufacturer: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(120),
    publicReference: PublicReference,
    transport: HardwareTransport,
    connectionConfiguration: HardwareConnectionConfiguration.default({}),
    capabilities: z.array(HardwareCapability).min(1).max(32),
    commandId: Uuid,
    idempotencyKey: IdempotencyKey,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedType =
      value.transport === 'network_tcp'
        ? 'printer'
        : value.transport === 'printer_attached'
          ? 'cash_drawer'
          : value.transport === 'keyboard_wedge'
            ? 'barcode_scanner'
            : null;
    if (expectedType !== null && value.type !== expectedType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'HARDWARE_TRANSPORT_TYPE_MISMATCH',
        path: ['transport'],
      });
    }
    if (
      ['network_tcp', 'printer_attached'].includes(value.transport) &&
      (value.connectionConfiguration.networkHost === null ||
        value.connectionConfiguration.networkPort === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'HARDWARE_NETWORK_ENDPOINT_REQUIRED',
        path: ['connectionConfiguration'],
      });
    }
  });
export const AssignHardwareRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    registerId: Uuid.nullable(),
    assignedPosDeviceId: Uuid.nullable(),
    primary: z.boolean().default(false),
    expectedVersion: z.number().int().positive(),
    commandId: Uuid,
    idempotencyKey: IdempotencyKey,
  })
  .strict();
export const UpdateHardwareRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    commandId: Uuid,
    idempotencyKey: IdempotencyKey,
    enabled: z.boolean(),
    connectionConfiguration: HardwareConnectionConfiguration.nullable().default(null),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const UpdateHardwarePolicyRequest = z
  .object({
    locationId: Uuid,
    registerId: Uuid.nullable().default(null),
    operatorSessionId: Uuid,
    commandId: Uuid,
    idempotencyKey: IdempotencyKey,
    expectedVersion: z.number().int().positive(),
    policy: HardwarePilotPolicy,
  })
  .strict();
export const HardwarePilotPolicyResult = z
  .object({
    merchantId: Uuid,
    locationId: Uuid,
    registerId: Uuid.nullable(),
    policy: HardwarePilotPolicy,
    version: z.number().int().positive(),
    updatedAt: IsoTimestamp,
  })
  .strict();
export const HardwareCommandRequest = z
  .object({
    locationId: Uuid,
    registerId: Uuid.nullable(),
    operatorSessionId: Uuid,
    commandId: Uuid,
    idempotencyKey: IdempotencyKey,
    targetHardwareId: Uuid,
    commandType: HardwareCommandType,
    sourceAggregateType: z.string().trim().min(1).max(80),
    sourceAggregateId: PublicReference,
    expectedConfigurationVersion: z.number().int().positive(),
    payloadFingerprint: Fingerprint,
    drawer: CashDrawerCommand.nullable().default(null),
    display: CustomerDisplayState.nullable().default(null),
    printPayload: ReceiptPrintPayload.nullable().default(null),
  })
  .strict();
export const ControlledReprintRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    commandId: Uuid,
    idempotencyKey: IdempotencyKey,
    reason: z.enum(['operator_verified_missing', 'customer_copy', 'diagnostic_recovery']),
  })
  .strict();
export const ControlledReprintResult = z
  .object({
    job: PrintJob,
    command: HardwareCommandRequest,
  })
  .strict();
export const HardwareCommandTransitionRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    status: z.enum(['dispatching', 'succeeded', 'failed', 'retryable', 'cancelled', 'unknown']),
    failureCode: HardwareFailureCode.nullable().default(null),
    safeResultMetadata: SafeMetadata.default({}),
  })
  .strict();
export const HardwareDiagnosticRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    commandId: Uuid,
    idempotencyKey: IdempotencyKey,
    hardwareId: Uuid,
    diagnostic: HardwareDiagnostic,
    health: HardwareHealth,
    connectionState: HardwareConnectionState,
    latencyMs: z.number().int().min(0).max(120000).nullable().default(null),
    failureCode: HardwareFailureCode.nullable().default(null),
    safeResult: SafeMetadata.default({}),
  })
  .strict();
export const HardwareRecoveryQuery = z
  .object({ locationId: Uuid, operatorSessionId: Uuid })
  .strict();
export const HardwareRemoteClaimResult = z
  .object({ command: HardwareCommandResult.nullable() })
  .strict();

export type HardwareDevice = z.infer<typeof HardwareDevice>;
export type HardwareConnectionConfiguration = z.infer<typeof HardwareConnectionConfiguration>;
export type HardwarePilotPolicy = z.infer<typeof HardwarePilotPolicy>;
export type HardwarePilotPolicyResult = z.infer<typeof HardwarePilotPolicyResult>;
export type HardwareAssignment = z.infer<typeof HardwareAssignment>;
export type HardwareCommand = z.infer<typeof HardwareCommand>;
export type HardwareCommandResult = z.infer<typeof HardwareCommandResult>;
export type HardwareDiagnosticResult = z.infer<typeof HardwareDiagnosticResult>;
export type PrintJob = z.infer<typeof PrintJob>;
export type ReceiptPrintPayload = z.infer<typeof ReceiptPrintPayload>;
export type BarcodeScanEvent = z.infer<typeof BarcodeScanEvent>;
export type CustomerDisplayState = z.infer<typeof CustomerDisplayState>;
export type HardwareRuntimeSnapshot = z.infer<typeof HardwareRuntimeSnapshot>;
export type HardwareRemoteClaimResult = z.infer<typeof HardwareRemoteClaimResult>;
export type RegisterHardwareRequest = z.infer<typeof RegisterHardwareRequest>;
export type AssignHardwareRequest = z.infer<typeof AssignHardwareRequest>;
export type UpdateHardwareRequest = z.infer<typeof UpdateHardwareRequest>;
export type UpdateHardwarePolicyRequest = z.infer<typeof UpdateHardwarePolicyRequest>;
export type HardwareCommandRequest = z.infer<typeof HardwareCommandRequest>;
export type HardwareCommandTransitionRequest = z.infer<typeof HardwareCommandTransitionRequest>;
export type ControlledReprintRequest = z.infer<typeof ControlledReprintRequest>;
export type ControlledReprintResult = z.infer<typeof ControlledReprintResult>;
export type HardwareDiagnosticRequest = z.infer<typeof HardwareDiagnosticRequest>;
export type HardwareRegistryQuery = z.infer<typeof HardwareRegistryQuery>;
export type HardwareRecoveryQuery = z.infer<typeof HardwareRecoveryQuery>;

export const posHardwareModels = {
  HardwareDeviceType,
  HardwareTransport,
  HardwareCapability,
  HardwareConnectionState,
  HardwareConnectionConfiguration,
  HardwarePilotPolicy,
  HardwarePilotPolicyResult,
  HardwareHealth,
  HardwareAssignment,
  HardwareDevice,
  HardwareCommandType,
  HardwareCommandStatus,
  HardwareCommand,
  HardwareCommandResult,
  HardwareDispatchPayload,
  HardwareDiagnostic,
  HardwareDiagnosticResult,
  HardwareFailure,
  HardwareFailureCode,
  PrinterDevice,
  PrinterCapabilities,
  PrintJob,
  PrintJobType,
  PrintJobStatus,
  PrintDocument,
  ReceiptPrintPayload,
  KitchenTicketPrintPayloadFoundation,
  CashDrawerDevice,
  CashDrawerCommand,
  BarcodeScannerDevice,
  BarcodeScanEvent,
  BarcodeType,
  CustomerDisplayDevice,
  CustomerDisplayState,
  CustomerDisplayCommand,
  PaymentTerminalDeviceFoundation,
  ScaleDeviceFoundation,
  HardwareRecoveryState,
  HardwareRuntimeSnapshot,
  HardwareRegistryQuery,
  RegisterHardwareRequest,
  AssignHardwareRequest,
  UpdateHardwareRequest,
  UpdateHardwarePolicyRequest,
  HardwareCommandRequest,
  HardwareCommandTransitionRequest,
  ControlledReprintRequest,
  ControlledReprintResult,
  HardwareDiagnosticRequest,
  HardwareRecoveryQuery,
  HardwareRemoteClaimResult,
};
