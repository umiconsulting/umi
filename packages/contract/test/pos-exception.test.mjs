import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  RefundPreviewRequest,
  SaleExceptionCommand,
  RefundApprovalRequest,
  ManualTerminalRefundInstruction,
} = require('../dist/index.cjs');
const { routes } = require('../dist/routes.cjs');
const { route } = require('../dist/route-table.cjs');

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

test('Gate 3D contracts reject unsafe refund quantities and offline authority', () => {
  const valid = RefundPreviewRequest.safeParse({
    locationId: id(1),
    operatorSessionId: id(2),
    exceptionType: 'partial_refund',
    reason: 'incorrect_item',
    note: null,
    lines: [{ saleLineId: id(3), quantity: 1, restockDecision: 'restock' }],
    expectedSaleVersion: 3,
  });
  assert.equal(valid.success, true);

  assert.equal(
    RefundPreviewRequest.safeParse({
      locationId: id(1),
      operatorSessionId: id(2),
      exceptionType: 'partial_refund',
      reason: 'incorrect_item',
      note: null,
      lines: [{ saleLineId: id(3), quantity: 0, restockDecision: 'restock' }],
      expectedSaleVersion: 3,
    }).success,
    false,
  );

  assert.equal(
    SaleExceptionCommand.safeParse({
      locationId: id(1),
      operatorSessionId: id(2),
      previewId: id(7),
      previewFingerprint: 'a'.repeat(64),
      approvalId: null,
      expectedSaleVersion: 3,
      commandId: id(4),
      idempotencyKey: id(5),
      offline: true,
    }).success,
    false,
  );

  assert.equal(
    RefundApprovalRequest.safeParse({
      locationId: id(1),
      operatorSessionId: id(2),
      saleId: id(6),
      previewId: id(7),
      commandId: id(4),
      previewFingerprint: 'a'.repeat(64),
      commandFingerprint: 'b'.repeat(64),
      managerPin: '1234',
    }).success,
    true,
  );
  assert.equal(
    RefundApprovalRequest.safeParse({
      locationId: id(1),
      operatorSessionId: id(2),
      saleId: id(6),
      previewId: id(7),
      commandId: id(4),
      previewFingerprint: 'a'.repeat(64),
      commandFingerprint: 'b'.repeat(64),
      managerPin: '123456789',
    }).success,
    false,
  );

  assert.equal(
    ManualTerminalRefundInstruction.safeParse({
      status: 'outcome_unknown',
      amount: { minorUnits: 1000, currency: 'MXN' },
      correlationReference: 'refund-correlation',
      queryOnly: false,
      canRetryAsNew: true,
    }).success,
    false,
  );

  assert.equal(
    routes.pos.exceptions.eligibility(id(1), id(6)),
    `/api/v1/pos/merchants/${id(1)}/sales/${id(6)}/exceptions/eligibility`,
  );
  assert.equal(route('pos.exceptionPreview').contract.idempotent, false);
  assert.equal(route('pos.exceptionApproval').contract.idempotent, false);
  assert.equal(route('pos.exceptionCommit').contract.idempotent, false);
  assert.equal(route('pos.exceptionTerminalOutcome').contract.idempotent, false);
});
