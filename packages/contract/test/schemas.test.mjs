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
    RegisterMemberRequest.safeParse({
      name: 'Ana',
      phone: '+525512345678',
      birthDate: '1990-02-28',
    }).success,
  );
  assert.equal(
    RegisterMemberRequest.safeParse({ name: 'Ana', phone: '+525512345678', birthDate: '1990-2-8' })
      .success,
    false,
  );
  assert.equal(
    RegisterMemberRequest.safeParse({
      name: 'Ana',
      phone: '+525512345678',
      birthDate: '2026-02-30',
    }).success,
    false,
  );
  assert.equal(
    RegisterMemberRequest.safeParse({ name: 'A', phone: '+525512345678', birthDate: '1990-02-28' })
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
  assert.ok(GiftRedeemRequest.safeParse({ phone: '+525512345678' }).success);
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
        merchants: [{ id: 't', handle: 's', name: 'n', roles: ['owner'] }],
        provider: 'local',
        accessExpiresIn: 1800,
        platformRole: null,
      },
    }).success,
  );
  // The two grants the contract names, and nothing else. A key that reaches a
  // client before the contract says what it means is a key the client cannot gate on.
  for (const role of ['super_admin', 'developer', null]) {
    assert.ok(
      SessionResponse.safeParse({
        session: {
          user: { id: '1', email: 'a@b.co', displayName: null },
          merchants: [],
          provider: 'local',
          accessExpiresIn: 1800,
          platformRole: role,
        },
      }).success,
      `platformRole ${role} must parse`,
    );
  }
  assert.equal(
    SessionResponse.safeParse({
      session: {
        user: { id: '1', email: 'a@b.co', displayName: null },
        merchants: [],
        provider: 'local',
        accessExpiresIn: 1800,
        platformRole: 'tech_assist',
      },
    }).success,
    false,
  );
});

test('RegisterMemberRequest — national digit count, not string length', () => {
  const ok = (phone) =>
    RegisterMemberRequest.safeParse({ name: 'Ana Torres', phone, birthDate: '1994-03-02' }).success;
  // Exactly 10 national digits for +52; the picker supplies the country code.
  assert.equal(ok('+525512345678'), true);
  // Every one of these is a REAL row that got in under the old min(7).max(20) rule.
  for (const bad of [
    '+5266748626', //  8 national digits
    '+52787878787', //  9
    '+5266716222762', // 11
    '+5266718054238', // 11
    '+52556672675598', // 12
  ]) {
    assert.equal(ok(bad), false, `${bad} must be rejected`);
  }
  // NANP is 10 too; a country we never measured falls back to the E.164 bounds.
  assert.equal(ok('+14804016182'), true);
  assert.equal(ok('+34612345678'), true);
});

// ── The two-outcome login ─────────────────────────────────────────────────────
//
// `POST /api/auth/local/login` answers with a session, OR with an MFA challenge.
// The route table said `SessionResponse` and hid the second branch from every
// client. The dashboard then stored `payload.session` whatever came back, so an
// enrolled account could never sign in.
const {
  MfaChallengeResponse,
  LoginResponse,
  VerifyMfaRequest,
  mfaChallenged,
} = require('../dist/index.cjs');

const CHALLENGE = {
  mfaRequired: true,
  method: 'totp',
  challengeToken: 'tok-abc',
  expiresInSeconds: 300,
};

const SESSION = {
  session: {
    user: { id: 'u1', email: 'a@b.c', displayName: 'A' },
    merchants: [],
    provider: 'local',
    accessExpiresIn: 1800,
    // Nullable, not optional: every envelope says what platform grant the login
    // holds, so a client never has to tell "no grant" from "this build is older".
    platformRole: null,
  },
};

test('MfaChallengeResponse accepts the four fields the server sends', () => {
  assert.equal(MfaChallengeResponse.safeParse(CHALLENGE).success, true);
});

test('MfaChallengeResponse rejects a session body', () => {
  assert.equal(MfaChallengeResponse.safeParse(SESSION).success, false);
});

test('mfaRequired must be the LITERAL true, not a truthy value', () => {
  // An error body carrying mfaRequired: "yes" must not read as a challenge.
  assert.equal(MfaChallengeResponse.safeParse({ ...CHALLENGE, mfaRequired: 'yes' }).success, false);
  assert.equal(MfaChallengeResponse.safeParse({ ...CHALLENGE, mfaRequired: false }).success, false);
});

test('LoginResponse accepts BOTH outcomes', () => {
  assert.equal(LoginResponse.safeParse(SESSION).success, true);
  assert.equal(LoginResponse.safeParse(CHALLENGE).success, true);
});

test('LoginResponse rejects a body that is neither', () => {
  assert.equal(LoginResponse.safeParse({ error: 'nope' }).success, false);
});

test('mfaChallenged tells the two apart', () => {
  assert.equal(mfaChallenged(CHALLENGE), true);
  assert.equal(mfaChallenged(SESSION), false);
});

test('mfaChallenged does not read a truthy mfaRequired as a challenge', () => {
  assert.equal(mfaChallenged({ mfaRequired: 'yes' }), false);
  assert.equal(mfaChallenged({ mfaRequired: 1 }), false);
});

test('VerifyMfaRequest takes exactly six digits', () => {
  assert.equal(VerifyMfaRequest.safeParse({ challengeToken: 't', code: '012345' }).success, true);
  for (const code of ['12345', '1234567', 'abcdef', '12 456', '']) {
    assert.equal(
      VerifyMfaRequest.safeParse({ challengeToken: 't', code }).success,
      false,
      `code ${JSON.stringify(code)} must be rejected`,
    );
  }
});

test('VerifyMfaRequest needs a challenge token', () => {
  assert.equal(VerifyMfaRequest.safeParse({ challengeToken: '', code: '123456' }).success, false);
});
