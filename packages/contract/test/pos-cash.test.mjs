import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CashShiftPolicy,
  OpenCashShiftRequest,
  SubmitBlindCountRequest,
  CashMovementRequest,
  ShiftCloseRequest,
  CashCommandRecoveryQuery,
} = require('../dist/index.cjs');
const { routes } = require('../dist/routes.cjs');

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const money = (minorUnits) => ({ minorUnits, currency: 'MXN' });

test('Gate 3C contracts enforce cash facts and blind-count boundaries', () => {
  const policy = CashShiftPolicy.parse({
    version: 'cash-v1',
    issuedAt: '2026-07-29T18:00:00.000Z',
    expiresAt: '2026-07-29T19:00:00.000Z',
    fingerprint: 'a'.repeat(64),
    cashShiftRequired: true,
    registerAssignmentRequired: true,
    oneShiftPerOperator: true,
    oneShiftPerRegister: true,
    openingFloatRequired: true,
    maximumOpeningFloat: money(100_000),
    allowedMovementTypes: ['paid_in', 'paid_out', 'safe_drop'],
    movementApprovalThreshold: money(50_000),
    countMethod: 'denomination_or_total',
    blindCountRequired: true,
    handoffAllowed: true,
    handoffCountRequired: false,
    varianceTolerance: money(100),
    closeApprovalThreshold: money(500),
    noSaleDrawerAllowed: false,
    offlineCashShiftAllowed: false,
    denominations: [money(100), money(200), money(500)],
  });
  assert.equal(policy.blindCountRequired, true);

  assert.ok(
    OpenCashShiftRequest.safeParse({
      locationId: id(1),
      registerId: id(2),
      operatorSessionId: id(3),
      openingFloat: money(700),
      denominations: [
        { denomination: money(100), quantity: 2, lineTotal: money(200) },
        { denomination: money(500), quantity: 1, lineTotal: money(500) },
      ],
      businessDate: '2026-07-29',
      note: null,
      commandId: id(4),
      idempotencyKey: id(5),
      expectedRegisterVersion: 1,
    }).success,
  );

  assert.equal(
    OpenCashShiftRequest.safeParse({
      locationId: id(1),
      registerId: id(2),
      operatorSessionId: id(3),
      openingFloat: money(600),
      denominations: [
        { denomination: money(100), quantity: 2, lineTotal: money(200) },
        { denomination: money(500), quantity: 1, lineTotal: money(500) },
      ],
      businessDate: '2026-07-29',
      note: null,
      commandId: id(4),
      idempotencyKey: id(5),
      expectedRegisterVersion: 1,
    }).success,
    false,
  );

  assert.equal(
    SubmitBlindCountRequest.safeParse({
      locationId: id(1),
      shiftId: id(6),
      operatorSessionId: id(3),
      countedCash: money(-1),
      denominations: [],
      expectedShiftVersion: 2,
      expectedLedgerSequence: 4,
      note: null,
      commandId: id(7),
      idempotencyKey: id(8),
    }).success,
    false,
  );

  assert.equal(
    CashMovementRequest.safeParse({
      locationId: id(1),
      shiftId: id(6),
      operatorSessionId: id(3),
      type: 'paid_out',
      amount: money(0),
      reasonCode: 'supplies',
      note: null,
      approvalId: null,
      expectedShiftVersion: 2,
      commandId: id(7),
      idempotencyKey: id(8),
    }).success,
    false,
  );

  assert.ok(
    ShiftCloseRequest.safeParse({
      locationId: id(1),
      shiftId: id(6),
      operatorSessionId: id(3),
      countAttemptId: id(9),
      reconciliationId: id(10),
      approvalId: null,
      approvalFingerprint: null,
      expectedShiftVersion: 4,
      commandId: id(11),
      idempotencyKey: id(12),
    }).success,
  );
  assert.ok(
    CashCommandRecoveryQuery.safeParse({
      locationId: id(1),
      operatorSessionId: id(3),
      commandId: id(11),
      idempotencyKey: id(12),
    }).success,
  );
  assert.equal(routes.pos.cash.shifts(id(1)), `/api/v1/pos/merchants/${id(1)}/cash/shifts`);
  assert.equal(
    routes.pos.cash.command(id(1), id(11)),
    `/api/v1/pos/merchants/${id(1)}/cash/commands/${id(11)}`,
  );
});
