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
  LoginRequest,
  SessionResponse,
  OkResponse,
} = require('../dist/index.cjs');

test('ScanRequest', () => {
  assert.ok(ScanRequest.safeParse({ qrPayload: 'q' }).success);
  assert.ok(ScanRequest.safeParse({ qrPayload: 'q', action: 'VISIT' }).success);
  assert.ok(ScanRequest.safeParse({ qrPayload: 'q', actions: ['VISIT', 'REDEEM'] }).success);
  assert.equal(ScanRequest.safeParse({ qrPayload: 'q', action: 'NOPE' }).success, false);
  assert.ok(ScanRequest.safeParse({ qrPayload: '' }).success); // bare @IsString accepts empty
  assert.equal(ScanRequest.safeParse({}).success, false); // qrPayload required
  assert.equal(
    ScanRequest.safeParse({
      qrPayload: 'q',
      actions: ['VISIT', 'REDEEM', 'BIRTHDAY_REDEEM', 'VISIT'],
    }).success,
    false,
  );
});

test('TopupRequest — $1.00 floor', () => {
  assert.ok(TopupRequest.safeParse({ cardId: 'c', amountCentavos: 100 }).success);
  assert.ok(
    TopupRequest.safeParse({ cardId: 'c', amountCentavos: 500, note: 'x', idempotencyKey: 'k' })
      .success,
  );
  assert.equal(TopupRequest.safeParse({ cardId: 'c', amountCentavos: 99 }).success, false);
  assert.equal(TopupRequest.safeParse({ cardId: 'c', amountCentavos: 100.5 }).success, false);
  assert.equal(TopupRequest.safeParse({ amountCentavos: 100 }).success, false);
});

test('PurchaseRequest — $0.01 floor', () => {
  assert.ok(PurchaseRequest.safeParse({ cardId: 'c', amountCentavos: 1 }).success);
  assert.equal(PurchaseRequest.safeParse({ cardId: 'c', amountCentavos: 0 }).success, false);
});

test('GiftCardCreateRequest — mirrors the DTO @ValidateIf conditionals', () => {
  // sole channel is validated
  assert.ok(
    GiftCardCreateRequest.safeParse({ amountCentavos: 100, recipientEmail: 'a@b.co' }).success,
  );
  assert.ok(
    GiftCardCreateRequest.safeParse({ amountCentavos: 100, recipientPhone: '5550001' }).success,
  );
  // at least one required
  assert.equal(GiftCardCreateRequest.safeParse({ amountCentavos: 100 }).success, false);
  // email-only must be valid; phone-only must be ≤20
  assert.equal(
    GiftCardCreateRequest.safeParse({ amountCentavos: 100, recipientEmail: 'not-an-email' })
      .success,
    false,
  );
  assert.equal(
    GiftCardCreateRequest.safeParse({ amountCentavos: 100, recipientPhone: '0'.repeat(21) })
      .success,
    false,
  );
  // both present → the DTO validates NEITHER, so a garbage email alongside a phone is accepted
  assert.ok(
    GiftCardCreateRequest.safeParse({
      amountCentavos: 100,
      recipientEmail: 'garbage',
      recipientPhone: '5550001',
    }).success,
  );
});

test('RegisterMemberRequest — real calendar birthDate', () => {
  assert.ok(
    RegisterMemberRequest.safeParse({ name: 'Ana', phone: '5550001', birthDate: '1990-02-28' })
      .success,
  );
  assert.equal(
    RegisterMemberRequest.safeParse({ name: 'Ana', phone: '5550001', birthDate: '1990-2-8' })
      .success,
    false,
  );
  assert.equal(
    RegisterMemberRequest.safeParse({ name: 'Ana', phone: '5550001', birthDate: '2026-02-30' })
      .success,
    false,
  );
  assert.equal(
    RegisterMemberRequest.safeParse({ name: 'A', phone: '5550001', birthDate: '1990-02-28' })
      .success,
    false,
  );
  assert.equal(
    RegisterMemberRequest.safeParse({ name: 'Ana', phone: '55', birthDate: '1990-02-28' }).success,
    false,
  );
});

test('GiftRedeemRequest — both channels optional', () => {
  assert.ok(GiftRedeemRequest.safeParse({}).success);
  assert.ok(GiftRedeemRequest.safeParse({ phone: '5550001' }).success);
});

test('session schemas (auth surface) — representative parse', () => {
  assert.ok(LoginRequest.safeParse({ username: 'u', password: 'p' }).success);
  assert.equal(LoginRequest.safeParse({ username: 'u' }).success, false);
  assert.ok(OkResponse.safeParse({ ok: true }).success);
  assert.equal(OkResponse.safeParse({ ok: false }).success, false);
  assert.ok(
    SessionResponse.safeParse({
      session: {
        user: { id: '1', email: 'a@b.co', displayName: null },
        tenants: [{ id: 't', slug: 's', name: 'n', roles: ['owner'] }],
        provider: 'local',
        accessExpiresIn: 1800,
      },
    }).success,
  );
});
