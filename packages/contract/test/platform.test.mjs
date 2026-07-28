import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ApiErrorEnvelope,
  Money,
  OfflineCommandEnvelope,
  PaymentAmbiguity,
  ReceiptSnapshot,
  CatalogPage,
  CatalogQuery,
  Cart,
  CartLineInput,
  CheckoutCommand,
  CheckoutResult,
} = require('../dist/index.cjs');

test('Gate 2D cart contracts bound quantities, notes, and checkout authority', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const line = {
    cartId: id,
    branchId: id,
    operatorSessionId: id,
    productId: id,
    modifierSelections: [],
    quantity: 2,
    expectedVersion: 1,
    idempotencyKey: id,
  };
  assert.ok(CartLineInput.safeParse(line).success);
  assert.equal(CartLineInput.safeParse({ ...line, quantity: 1000 }).success, false);
  assert.equal(CartLineInput.safeParse({ ...line, note: '<script>' }).success, false);
  assert.ok(
    Cart.safeParse({
      id,
      tenantId: id,
      branchId: id,
      operatorSessionId: id,
      status: 'draft',
      version: 1,
      items: [],
      totals: {
        subtotal: { minorUnits: 0, currency: 'MXN' },
        tax: { minorUnits: 0, currency: 'MXN' },
        discounts: {
          total: { minorUnits: 0, currency: 'MXN' },
          entries: [],
        },
        grandTotal: { minorUnits: 0, currency: 'MXN' },
        businessDate: '2026-07-28',
      },
      checkoutEnabled: false,
      checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
      updatedAt: '2026-07-28T12:00:00Z',
    }).success,
  );
});

test('Gate 2E checkout requires explicit totals confirmation and safe ambiguity', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const command = {
    cartId: id,
    branchId: id,
    operatorSessionId: id,
    expectedCartVersion: 1,
    paymentMethod: 'cash',
    totalsFingerprint: null,
    idempotencyKey: id,
  };
  assert.ok(CheckoutCommand.safeParse(command).success);
  assert.equal(
    CheckoutCommand.safeParse({ ...command, paymentMethod: 'client_card_sdk' }).success,
    false,
  );
  const money = { minorUnits: 100, currency: 'MXN' };
  const confirmation = {
    cartVersion: 1,
    fingerprint: 'a'.repeat(64),
    totals: {
      subtotal: money,
      tax: { minorUnits: 14, currency: 'MXN' },
      discounts: { total: { minorUnits: 0, currency: 'MXN' }, entries: [] },
      grandTotal: money,
      businessDate: '2026-07-28',
    },
    taxes: {
      total: { minorUnits: 14, currency: 'MXN' },
      entries: [],
    },
    discounts: { total: { minorUnits: 0, currency: 'MXN' }, entries: [] },
    confirmedAt: null,
  };
  assert.ok(
    CheckoutResult.safeParse({
      status: 'confirmation_required',
      confirmation,
      payment: null,
      reservation: null,
      sale: null,
      receipt: null,
      failure: {
        code: 'CHECKOUT_CONFIRMATION_REQUIRED',
        retryable: false,
        operatorGuidance: 'confirm_totals',
        correlationId: 'checkout-test',
      },
    }).success,
  );
});

test('Money uses integer minor units and explicit currency', () => {
  assert.ok(Money.safeParse({ minorUnits: 1099, currency: 'MXN' }).success);
  assert.equal(Money.safeParse({ minorUnits: 10.5, currency: 'MXN' }).success, false);
  assert.equal(Money.safeParse({ minorUnits: 1099, currency: 'mxn' }).success, false);
});

test('Gate 2C catalog contracts bound branch search and cursor pages', () => {
  const branchId = '00000000-0000-4000-8000-000000000004';
  assert.ok(CatalogQuery.safeParse({ branchId, search: 'cafe', limit: 40 }).success);
  assert.equal(CatalogQuery.safeParse({ branchId, limit: 101 }).success, false);
  assert.ok(
    CatalogPage.safeParse({
      items: [],
      nextCursor: null,
      catalogVersion: '42',
      updatedAt: '2026-07-28T12:00:00Z',
    }).success,
  );
});

test('PaymentAmbiguity prevents a new retry for an unknown outcome', () => {
  const base = {
    paymentRef: 'opaque-payment',
    status: 'unknown',
    queryAfter: '2026-07-25T12:00:00Z',
    correlationId: 'request-1',
  };
  assert.ok(PaymentAmbiguity.safeParse({ ...base, queryOnly: true, canRetryAsNew: false }).success);
  assert.equal(
    PaymentAmbiguity.safeParse({ ...base, queryOnly: false, canRetryAsNew: true }).success,
    false,
  );
});

test('OfflineCommandEnvelope rejects unbounded identity and invalid fingerprints', () => {
  const command = {
    commandId: '00000000-0000-4000-8000-000000000001',
    deviceId: '00000000-0000-4000-8000-000000000002',
    tenantId: '00000000-0000-4000-8000-000000000003',
    branchId: '00000000-0000-4000-8000-000000000004',
    operatorSessionId: '00000000-0000-4000-8000-000000000005',
    sequence: 1,
    issuedAt: '2026-07-25T12:00:00Z',
    commandType: 'example.command',
    payload: {},
    fingerprint: 'a'.repeat(64),
  };
  assert.ok(OfflineCommandEnvelope.safeParse(command).success);
  assert.equal(OfflineCommandEnvelope.safeParse({ ...command, sequence: 0 }).success, false);
  assert.equal(OfflineCommandEnvelope.safeParse({ ...command, fingerprint: 'bad' }).success, false);
});

test('receipt and error envelopes validate public-safe shapes', () => {
  const money = { minorUnits: 100, currency: 'MXN' };
  assert.ok(
    ReceiptSnapshot.safeParse({
      receiptRef: 'receipt-public-ref',
      tenantId: '00000000-0000-4000-8000-000000000003',
      branchId: '00000000-0000-4000-8000-000000000004',
      issuedAt: '2026-07-25T12:00:00Z',
      businessDate: '2026-07-25',
      lines: [
        {
          lineRef: 'line-1',
          description: 'Coffee',
          quantity: 1,
          unitPrice: money,
          lineTotal: money,
        },
      ],
      subtotal: money,
      taxTotal: { minorUnits: 0, currency: 'MXN' },
      grandTotal: money,
      currency: 'MXN',
      version: 1,
    }).success,
  );
  assert.ok(
    ApiErrorEnvelope.safeParse({
      error: {
        code: 'PERMISSION_DENIED',
        message: 'Permission denied',
        retryable: false,
        correlationId: 'request-1',
      },
    }).success,
  );
});

test('neutral artifact has required models and a valid checksum', async () => {
  const artifactBytes = await readFile(new URL('../generated/contract.json', import.meta.url));
  const manifest = JSON.parse(artifactBytes);
  for (const name of [
    'ApiError',
    'Money',
    'PageInfo',
    'OperatorContext',
    'OfflineCommandEnvelope',
    'ReconciliationResponse',
    'ReceiptSnapshot',
    'PaymentAmbiguity',
  ]) {
    assert.ok(manifest.definitions[name], `missing ${name}`);
  }
  const checksum = (
    await readFile(new URL('../generated/contract.sha256', import.meta.url), 'utf8')
  ).split(/\s+/)[0];
  assert.equal(createHash('sha256').update(artifactBytes).digest('hex'), checksum);
});

test('generated Dart package metadata contains real YAML line breaks', async () => {
  const pubspec = await readFile(
    new URL('../generated/dart/pubspec.yaml', import.meta.url),
    'utf8',
  );
  assert.match(pubspec, /^name: umi_contract\ndescription:/);
  assert.equal(pubspec.includes('\\n'), false);
});

test('Gate 2B device contracts are bounded and generated for Flutter', async () => {
  const artifact = JSON.parse(
    await readFile(new URL('../generated/contract.json', import.meta.url), 'utf8'),
  );
  assert.ok(artifact.definitions.DeviceSummary);
  assert.ok(artifact.definitions.CompleteDeviceEnrollmentRequest);
  assert.ok(artifact.definitions.PosSessionResponse);
  assert.ok(artifact.definitions.OperatorSessionView);
  assert.ok(artifact.errors.DEVICE_CREDENTIAL_INVALID);
  const dart = await readFile(
    new URL('../generated/dart/lib/umi_contract.dart', import.meta.url),
    'utf8',
  );
  assert.match(dart, /abstract final class UmiRoutes/);
  assert.match(dart, /static const posLogin = '\/api\/auth\/pos\/login'/);
});
