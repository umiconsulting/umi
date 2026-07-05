// Zod product-write schema guards. Run against the BUILT dist (what umi-api
// require()s), so `pnpm --filter @umi/contract build` first. Each schema is
// checked for one representative accept + the rejections its DTO enforces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ScanRequest,
  TopupRequest,
  PurchaseRequest,
  GiftCardCreateRequest,
  RegisterMemberRequest,
  GiftRedeemRequest,
} = require('../dist/index.cjs');

test('ScanRequest', () => {
  assert.ok(ScanRequest.safeParse({ qrPayload: 'q' }).success);
  assert.ok(ScanRequest.safeParse({ qrPayload: 'q', action: 'VISIT' }).success);
  assert.ok(ScanRequest.safeParse({ qrPayload: 'q', actions: ['VISIT', 'REDEEM'] }).success);
  assert.equal(ScanRequest.safeParse({ qrPayload: 'q', action: 'NOPE' }).success, false);
  assert.equal(ScanRequest.safeParse({ qrPayload: '' }).success, false);
  assert.equal(
    ScanRequest.safeParse({ qrPayload: 'q', actions: ['VISIT', 'REDEEM', 'BIRTHDAY_REDEEM', 'VISIT'] }).success,
    false,
  );
});

test('TopupRequest — $1.00 floor', () => {
  assert.ok(TopupRequest.safeParse({ cardId: 'c', amountCentavos: 100 }).success);
  assert.ok(TopupRequest.safeParse({ cardId: 'c', amountCentavos: 500, note: 'x', idempotencyKey: 'k' }).success);
  assert.equal(TopupRequest.safeParse({ cardId: 'c', amountCentavos: 99 }).success, false);
  assert.equal(TopupRequest.safeParse({ cardId: 'c', amountCentavos: 100.5 }).success, false);
  assert.equal(TopupRequest.safeParse({ amountCentavos: 100 }).success, false);
});

test('PurchaseRequest — $0.01 floor', () => {
  assert.ok(PurchaseRequest.safeParse({ cardId: 'c', amountCentavos: 1 }).success);
  assert.equal(PurchaseRequest.safeParse({ cardId: 'c', amountCentavos: 0 }).success, false);
});

test('GiftCardCreateRequest — requires a recipient channel', () => {
  assert.ok(GiftCardCreateRequest.safeParse({ amountCentavos: 100, recipientEmail: 'a@b.co' }).success);
  assert.ok(GiftCardCreateRequest.safeParse({ amountCentavos: 100, recipientPhone: '5550001' }).success);
  assert.equal(GiftCardCreateRequest.safeParse({ amountCentavos: 100 }).success, false);
  assert.equal(GiftCardCreateRequest.safeParse({ amountCentavos: 100, recipientEmail: 'not-an-email' }).success, false);
});

test('RegisterMemberRequest — real calendar birthDate', () => {
  assert.ok(RegisterMemberRequest.safeParse({ name: 'Ana', phone: '5550001', birthDate: '1990-02-28' }).success);
  assert.equal(RegisterMemberRequest.safeParse({ name: 'Ana', phone: '5550001', birthDate: '1990-2-8' }).success, false);
  assert.equal(RegisterMemberRequest.safeParse({ name: 'Ana', phone: '5550001', birthDate: '2026-02-30' }).success, false);
  assert.equal(RegisterMemberRequest.safeParse({ name: 'A', phone: '5550001', birthDate: '1990-02-28' }).success, false);
  assert.equal(RegisterMemberRequest.safeParse({ name: 'Ana', phone: '55', birthDate: '1990-02-28' }).success, false);
});

test('GiftRedeemRequest — both channels optional', () => {
  assert.ok(GiftRedeemRequest.safeParse({}).success);
  assert.ok(GiftRedeemRequest.safeParse({ phone: '5550001' }).success);
});
