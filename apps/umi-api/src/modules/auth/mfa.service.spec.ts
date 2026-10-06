import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { MfaService } from './mfa.service';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';

const PEPPER = 'test-pepper-that-is-at-least-32-chars-long';
const CONFIG: Record<string, unknown> = {
  MFA_OTP_PEPPER: PEPPER,
  MFA_OTP_TTL_SECONDS: 300,
  MFA_OTP_MAX_ATTEMPTS: 5,
  MFA_OTP_MAX_PER_HOUR: 5,
};

function digest(code: string): string {
  return createHmac('sha256', PEPPER).update(code).digest('hex');
}

function make(overrides: Record<string, unknown> = {}) {
  const repo = {
    replaceMfaOtp: vi.fn().mockResolvedValue(undefined),
    findLiveMfaOtp: vi.fn(),
    recordMfaOtpFailure: vi.fn().mockResolvedValue(1),
    consumeMfaOtp: vi.fn().mockResolvedValue(true),
    recordSecurityEvent: vi.fn().mockResolvedValue(undefined),
  };
  const email = { send: vi.fn().mockResolvedValue({ messageId: 'm1' }) };
  const config = { get: vi.fn((k: string) => ({ ...CONFIG, ...overrides })[k]) };
  // A REAL limiter, not a stub: the issue cap is the control that makes the per-code
  // attempt cap mean anything, so the test should exercise the thing that enforces it.
  // Each make() builds its own instance, so the window is fresh per test.
  const svc = new MfaService(
    repo as never,
    email as never,
    config as never,
    new RateLimitService(),
  );
  return { svc, repo, email };
}

const USER = { id: 'u1', email: 'owner@kala.co', displayName: 'Owner' };

describe('MfaService.issueChallenge', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('stores a peppered HMAC, never the code itself', async () => {
    await h.svc.issueChallenge(USER);
    const [, storedHash] = h.repo.replaceMfaOtp.mock.calls[0];
    const mailedCode = /\b(\d{6})\b/.exec(h.email.send.mock.calls[0][0].text)?.[1];

    expect(mailedCode).toMatch(/^\d{6}$/);
    expect(storedHash).toBe(digest(mailedCode!));
    // The plain code must not be recoverable from what was written.
    expect(storedHash).not.toContain(mailedCode!);
  });

  it('produces a six-digit code, zero-padded', async () => {
    for (let i = 0; i < 25; i++) {
      const h2 = make();
      await h2.svc.issueChallenge(USER);
      const text = h2.email.send.mock.calls[0][0].text as string;
      expect(text).toMatch(/\b\d{6}\b/);
    }
  });

  it('refuses to run without a pepper, rather than storing a bare digest', async () => {
    const h2 = make({ MFA_OTP_PEPPER: undefined });
    await expect(h2.svc.issueChallenge(USER)).rejects.toThrow(/MFA_OTP_PEPPER/);
    expect(h2.repo.replaceMfaOtp).not.toHaveBeenCalled();
  });

  it('still stores the code when the mail fails, so a resend can help', async () => {
    const h2 = make();
    h2.email.send.mockResolvedValue(null);
    await expect(h2.svc.issueChallenge(USER)).resolves.toBeUndefined();
    expect(h2.repo.replaceMfaOtp).toHaveBeenCalledOnce();
  });
});

describe('MfaService.verifyCode', () => {
  let h: ReturnType<typeof make>;
  const live = (code: string, attempts = 0) => ({
    id: 'o1',
    userId: 'u1',
    codeHash: digest(code),
    attempts,
    expiresAt: new Date(Date.now() + 60_000),
  });

  beforeEach(() => (h = make()));

  it('accepts the right code and consumes it', async () => {
    h.repo.findLiveMfaOtp.mockResolvedValue(live('123456'));
    await expect(h.svc.verifyCode('u1', '123456')).resolves.toBeUndefined();
    expect(h.repo.consumeMfaOtp).toHaveBeenCalledWith('o1');
  });

  it('rejects the wrong code and spends an attempt', async () => {
    h.repo.findLiveMfaOtp.mockResolvedValue(live('123456'));
    await expect(h.svc.verifyCode('u1', '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.repo.recordMfaOtpFailure).toHaveBeenCalledWith('o1', 5);
    expect(h.repo.consumeMfaOtp).not.toHaveBeenCalled();
  });

  it('gives the SAME message whether no code exists or the code is wrong', async () => {
    h.repo.findLiveMfaOtp.mockResolvedValue(null);
    const missing = await h.svc.verifyCode('u1', '123456').catch((e: Error) => e.message);
    h.repo.findLiveMfaOtp.mockResolvedValue(live('123456'));
    const wrong = await h.svc.verifyCode('u1', '000000').catch((e: Error) => e.message);
    expect(missing).toBe(wrong);
  });

  it('loses the race when another request consumed the same code first', async () => {
    h.repo.findLiveMfaOtp.mockResolvedValue(live('123456'));
    h.repo.consumeMfaOtp.mockResolvedValue(false);
    await expect(h.svc.verifyCode('u1', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('tolerates surrounding whitespace from a paste', async () => {
    h.repo.findLiveMfaOtp.mockResolvedValue(live('123456'));
    await expect(h.svc.verifyCode('u1', ' 123456 ')).resolves.toBeUndefined();
  });
});

// ── Regressions from the 2026-08-01 review ─────────────────────────────────────

describe('MfaService · the issue cap is what bounds guessing', () => {
  it('refuses a sixth code in the window, so a fresh attempt budget cannot be bought', async () => {
    // Each issued code resets runtime.otp.attempts to 0. Without this cap, an attacker
    // holding the password alternates login and verify forever and the per-code cap
    // stops bounding anything. THIS is the control; the per-code cap only shapes it.
    const h = make();
    for (let i = 0; i < 5; i++) await h.svc.issueChallenge(USER);
    await expect(h.svc.issueChallenge(USER)).rejects.toBeInstanceOf(HttpException);
    expect(h.repo.replaceMfaOtp).toHaveBeenCalledTimes(5);
  });

  it('counts per user, not per caller, so rotating source addresses buys nothing', async () => {
    const h = make();
    for (let i = 0; i < 5; i++) await h.svc.issueChallenge(USER);
    await expect(h.svc.issueChallenge(USER)).rejects.toBeInstanceOf(HttpException);
    // A different account is unaffected — the cap is a per-account budget.
    await expect(
      h.svc.issueChallenge({ id: 'u2', email: 'other@kala.co', displayName: 'Other' }),
    ).resolves.toBeUndefined();
  });

  it('records the refusal instead of only logging it', async () => {
    const h = make();
    for (let i = 0; i < 5; i++) await h.svc.issueChallenge(USER);
    await h.svc.issueChallenge(USER).catch(() => undefined);
    expect(h.repo.recordSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'mfa.challenge_throttled', outcome: 'denied' }),
    );
  });
});

describe('MfaService · the email is not an injection surface', () => {
  it('escapes the display name, which a MERCHANT controls', async () => {
    // umi.user.full_name is written verbatim by the staff form, so a café owner picks
    // this string. Raw interpolation puts owner-supplied markup in a real Umi email.
    const h = make();
    await h.svc.issueChallenge({
      id: 'u1',
      email: 'barista@kala.co',
      displayName: '<a href="https://evil.example">Verifica tu cuenta</a>',
    });
    const mail = h.email.send.mock.calls[0][0];
    expect(mail.html).not.toContain('<a href="https://evil.example"');
    expect(mail.html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;');
  });

  it('keeps the code out of the subject line', async () => {
    // A subject is rendered in lock-screen notifications, so a code there is readable
    // without unlocking the phone — which is the possession the factor is testing.
    const h = make();
    await h.svc.issueChallenge(USER);
    const mail = h.email.send.mock.calls[0][0];
    expect(mail.subject).not.toMatch(/\d{6}/);
    expect(mail.text).toMatch(/\d{6}/);
  });
});

describe('MfaService · failures reach the security log', () => {
  it('writes a denied event for a wrong code', async () => {
    const h = make();
    h.repo.findLiveMfaOtp.mockResolvedValue({
      id: 'o1',
      userId: 'u1',
      codeHash: digest('123456'),
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await h.svc.verifyCode('u1', '000000').catch(() => undefined);
    expect(h.repo.recordSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'mfa.verify_failed',
        outcome: 'denied',
        reasonCode: 'wrong_code',
      }),
    );
  });

  it('writes a denied event when no live code exists', async () => {
    const h = make();
    h.repo.findLiveMfaOtp.mockResolvedValue(null);
    await h.svc.verifyCode('u1', '123456').catch(() => undefined);
    expect(h.repo.recordSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'no_live_code', outcome: 'denied' }),
    );
  });
});
