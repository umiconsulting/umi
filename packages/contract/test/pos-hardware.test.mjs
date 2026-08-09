import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HardwareCommand,
  HardwareDevice,
  HardwareRuntimeSnapshot,
  PrintJob,
  ReceiptPrintPayload,
  routeCatalog,
} from '../dist/index.js';

const ids = {
  merchant: '00000000-0000-4000-8000-000000000001',
  location: '00000000-0000-4000-8000-000000000002',
  register: '00000000-0000-4000-8000-000000000003',
  pos: '00000000-0000-4000-8000-000000000004',
  operator: '00000000-0000-4000-8000-000000000005',
  hardware: '00000000-0000-4000-8000-000000000006',
  command: '00000000-0000-4000-8000-000000000007',
  job: '00000000-0000-4000-8000-000000000008',
};

test('Gate 3G-A device and command contracts reject vendor authority and unsafe payloads', () => {
  const device = HardwareDevice.parse({
    id: ids.hardware,
    merchantId: ids.merchant,
    locationId: ids.location,
    registerId: ids.register,
    assignedPosDeviceId: ids.pos,
    type: 'printer',
    manufacturer: 'Simulator',
    model: 'receipt-printer-v1',
    publicReference: 'SIM-PRINTER-01',
    transport: 'simulator',
    capabilities: ['printer.receipt', 'printer.test_page'],
    enabled: true,
    configurationVersion: 1,
    connectionState: 'connected',
    firmwareVersion: 'sim-1',
    lastHeartbeatAt: null,
    lastDiagnosticAt: null,
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    archivedAt: null,
    optimisticVersion: 1,
  });
  assert.equal(device.transport, 'simulator');
  assert.equal(HardwareDevice.safeParse({ ...device, transport: 'epson_sdk' }).success, false);

  const command = HardwareCommand.parse({
    commandId: ids.command,
    commandType: 'print_receipt',
    targetHardwareId: ids.hardware,
    merchantId: ids.merchant,
    locationId: ids.location,
    registerId: ids.register,
    originatingPosDeviceId: ids.pos,
    operatorId: ids.operator,
    sourceAggregateType: 'receipt',
    sourceAggregateId: 'receipt-public-1',
    payloadFingerprint: 'a'.repeat(64),
    idempotencyKey: 'hardware-command-1',
    correlationId: 'hardware-correlation-1',
    status: 'pending',
    createdAt: '2026-08-09T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    failureCode: null,
    safeResultMetadata: {},
  });
  assert.equal(command.status, 'pending');
  assert.equal(
    HardwareCommand.safeParse({ ...command, safeResultMetadata: { password: 'secret' } }).success,
    false,
  );
});

test('Gate 3G-A print payload keeps authoritative totals and masked value summaries', () => {
  const payload = ReceiptPrintPayload.parse({
    receiptId: 'receipt-public-1',
    merchantName: 'Umi Cafe',
    locationName: 'Centro',
    registerName: 'Register A',
    receiptNumber: 'R-100',
    businessDate: '2026-08-09',
    currency: 'MXN',
    items: [{ name: 'Coffee', quantity: 1, totalMinorUnits: 5500, modifiers: [] }],
    subtotalMinorUnits: 5000,
    discountMinorUnits: 0,
    taxMinorUnits: 500,
    tipMinorUnits: 0,
    totalMinorUnits: 5500,
    tenders: [{ type: 'cash', amountMinorUnits: 5500, maskedReference: null }],
    changeMinorUnits: 0,
    loyaltySummary: null,
    customerValueSummary: null,
    exceptionMarker: null,
    qrValue: null,
    footer: null,
  });
  assert.equal(payload.totalMinorUnits, 5500);
  assert.equal(
    ReceiptPrintPayload.safeParse({ ...payload, customerContact: 'private@example.com' }).success,
    false,
  );
});

test('Gate 3G-A print job and runtime snapshot expose explicit unknown recovery', () => {
  const job = PrintJob.parse({
    jobId: ids.job,
    targetPrinterId: ids.hardware,
    type: 'official_receipt',
    sourceAggregateType: 'receipt',
    sourceAggregateId: 'receipt-public-1',
    correlationId: 'hardware-correlation-1',
    idempotencyKey: 'print-job-1',
    payloadFingerprint: 'b'.repeat(64),
    copies: 1,
    status: 'unknown_outcome',
    attempts: 1,
    createdAt: '2026-08-09T00:00:00.000Z',
    startedAt: '2026-08-09T00:00:01.000Z',
    completedAt: null,
    failure: { code: 'unknown_outcome', retryable: false, operatorGuidance: 'verify_print' },
    originalJobId: null,
  });
  assert.equal(job.status, 'unknown_outcome');
  assert.equal(job.failure.retryable, false);

  assert.equal(
    HardwareRuntimeSnapshot.safeParse({
      merchantId: ids.merchant,
      locationId: ids.location,
      registerId: ids.register,
      devices: [],
      pendingJobs: 0,
      retryableJobs: 0,
      unknownCommands: 0,
      capturedAt: '2026-08-09T00:00:00.000Z',
    }).success,
    true,
  );
});

test('Gate 3G-A hardware routes are typed and permission scoped', () => {
  assert.equal(
    routeCatalog['POST /api/v1/pos/merchants/:merchantId/hardware/commands'].permission,
    'hardware.command.execute',
  );
  assert.equal(
    routeCatalog['POST /api/v1/pos/merchants/:merchantId/hardware/print-jobs/:jobId/reprint']
      .permission,
    'hardware.printer.reprint',
  );
  assert.equal(
    routeCatalog['GET /api/v1/pos/merchants/:merchantId/hardware/runtime'].permission,
    'hardware.read',
  );
});
