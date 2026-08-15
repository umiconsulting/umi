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
  OfflineCheckoutCommand,
  RecoveryAction,
} = require('../dist/index.cjs');

test('Gate 2F checkout identity and recovery actions are typed and bounded', () => {
  const hash = 'a'.repeat(64);
  assert.equal(
    OfflineCheckoutCommand.safeParse({
      policyVersion: '1',
      policyFingerprint: hash,
      checkoutIdentity: hash,
      snapshot: {},
    }).success,
    false,
  );
  assert.ok(
    RecoveryAction.safeParse({
      id: 'query_ambiguous_payment',
      titleCode: 'recoveryPaymentTitle',
      descriptionCode: 'recoveryPaymentDescription',
      requiredPermission: 'pos.checkout',
      allowedActor: 'operator',
      severity: 'security',
      retryPolicy: 'query_only',
      diagnosticCode: 'query_ambiguous_payment',
      auditEvent: 'offline.recovery.payment_query_requested',
    }).success,
  );
  assert.equal(
    RecoveryAction.safeParse({
      id: 'retry',
      titleCode: 'raw',
      descriptionCode: 'raw',
      requiredPermission: null,
      allowedActor: 'operator',
      severity: 'information',
      retryPolicy: 'transport_safe',
      diagnosticCode: 'retry',
      auditEvent: 'retry',
    }).success,
    false,
  );
});

test('Gate 2D cart contracts bound quantities, notes, and checkout authority', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const line = {
    cartId: id,
    locationId: id,
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
      merchantId: id,
      locationId: id,
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
    locationId: id,
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
    catalogVersion: 'catalog-1',
    pricingVersion: 'pricing-1',
    taxVersion: 'tax-1',
    snapshotAt: '2026-07-28T00:00:00.000Z',
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

test('Gate 2C catalog contracts bound location search and cursor pages', () => {
  const locationId = '00000000-0000-4000-8000-000000000004';
  assert.ok(CatalogQuery.safeParse({ locationId, search: 'cafe', limit: 40 }).success);
  assert.equal(CatalogQuery.safeParse({ locationId, limit: 101 }).success, false);
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
    merchantId: '00000000-0000-4000-8000-000000000003',
    locationId: '00000000-0000-4000-8000-000000000004',
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
      merchantId: '00000000-0000-4000-8000-000000000003',
      locationId: '00000000-0000-4000-8000-000000000004',
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
  // The generated Dart must agree with ROUTE_TABLE, not with a path repeated here.
  // Asserting a literal is how this file became a fourth copy of the URL space.
  const { ROUTE_TABLE } = await import('../dist/index.js');
  const exposed = ROUTE_TABLE.filter((r) => r.dart !== null);
  assert.ok(exposed.length > 0, 'no routes are exposed to the Dart client');
  for (const def of exposed) {
    const literal = def.path.replace(
      /:([A-Za-z0-9_]+)/g,
      (_m, name) => '${Uri.encodeComponent(' + name + ')}',
    );
    assert.ok(
      dart.includes(`'${literal}'`),
      `generated Dart is missing ${def.method} ${def.path} (${def.dart})`,
    );
  }
  // Every POS-facing path carries the URL major. A field client must never be able
  // to reach an unversioned POS route.
  for (const def of exposed) {
    assert.match(def.path, /^\/api\/v1\//, `${def.id} is exposed to the POS but unversioned`);
  }
});

test('a true union survives generation — both login outcomes reach the artifact', async () => {
  // The generator's `withoutNull` helper exists for `z.nullable(X)`, which zod
  // encodes as `anyOf: [X, {type:'null'}]`. It took `anyOf[0]` for EVERY anyOf,
  // so `z.union([SessionResponse, MfaChallengeResponse])` published as the
  // session branch alone. A generated consumer then could not see the MFA
  // challenge, and would lock an enrolled account out exactly as the dashboard
  // did. The zod source was right and the artifact was wrong.
  const ts = await readFile(
    new URL('../generated/typescript/umi_contract.ts', import.meta.url),
    'utf8',
  );
  const line = ts.split('\n').find((l) => l.startsWith('export type LoginResponse ='));
  assert.ok(line, 'LoginResponse must be generated');
  assert.match(line, /"session"/, 'the session branch must survive');
  assert.match(line, /"mfaRequired"/, 'the challenge branch must survive');
  assert.match(line, /\|/, 'the two branches must be a union, not one of them');
});
