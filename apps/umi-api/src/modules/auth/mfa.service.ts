import { HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { EmailAdapter } from '../../shared/adapters/email.adapter';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import type { AppConfig } from '../../shared/config/config.schema';
import { AuthRepository } from './auth.repository';

/**
 * Escape text before it enters an HTML email body.
 *
 * `displayName` is NOT ours. It comes from `umi.user.full_name`, which the staff form
 * writes verbatim (`staff.repository.ts` inserts the merchant-typed name), so a café
 * owner controls it. Interpolated raw, a name like
 * `<a href="https://evil.example">Verifica tu cuenta</a>` renders as a working link
 * inside a genuine Umi login-code email.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The second factor.
 *
 * ⚠ READ THIS BEFORE TREATING `email_otp` AS MFA FOR COMPLIANCE.
 * A code mailed to the user's address is a second STEP, not a second FACTOR. NIST
 * SP 800-63B §5.1.3.1 is explicit: "Methods that do not prove possession of a
 * specific device, such as voice-over-IP (VOIP) or email, SHALL NOT be used for
 * out-of-band authentication." Email proves possession of nothing — whoever holds
 * the account password very often reaches the mailbox too, and both may sit behind
 * the same recovery address.
 *
 * It ships first anyway, deliberately, because it needs no enrolment ceremony and
 * it closes the current state, which is a password alone guarding cross-café
 * authority. It will NOT satisfy PCI DSS 8.4.1 when an assessor asks. `totp` is the
 * method that does; it is a shared secret and RFC 6238 arithmetic, no new vendor and
 * no new infrastructure, and this service is shaped so that adding it touches only
 * `issueChallenge` and `verifyCode`.
 *
 * The code itself:
 *   - six digits, drawn with `randomInt` (CSPRNG), never `Math.random`;
 *   - stored as HMAC-SHA256 under a pepper held OUTSIDE the database, because a bare
 *     digest of a six-digit code is reversible by brute force in milliseconds by
 *     anyone who reads the table. Same construction as merchant.staff.operator_pin_lookup;
 *   - compared in constant time, so response timing does not leak a digit-by-digit match;
 *   - single-use and attempt-capped in the database, not here.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly email: EmailAdapter,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly rateLimit: RateLimitService,
  ) {}

  get ttlSeconds(): number {
    return this.config.get('MFA_OTP_TTL_SECONDS', { infer: true });
  }

  private get maxAttempts(): number {
    return this.config.get('MFA_OTP_MAX_ATTEMPTS', { infer: true });
  }

  private get maxPerHour(): number {
    return this.config.get('MFA_OTP_MAX_PER_HOUR', { infer: true });
  }

  /**
   * Resolve the pepper, or refuse to run. Failing loudly matters more here than in
   * most config reads: a missing pepper would otherwise silently downgrade every
   * stored code to an unsalted digest, and nothing in the response would show it.
   */
  private pepper(): string {
    const value = this.config.get('MFA_OTP_PEPPER', { infer: true });
    if (!value) {
      throw new Error('MFA_OTP_PEPPER is not configured; the second factor is unavailable.');
    }
    return value;
  }

  private digest(code: string): string {
    return createHmac('sha256', this.pepper()).update(code).digest('hex');
  }

  /** Six digits, uniformly drawn. `randomInt` is rejection-sampled, so no modulo bias. */
  private generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /**
   * Mint a code, store it, and mail it. Returns nothing about delivery: a caller that
   * could tell "sent" from "not sent" would leak which addresses exist.
   *
   * ⚠ THIS CAP IS LOAD-BEARING, and it is not about mail volume.
   * `runtime.otp.attempts` starts at 0 on every new row, so each issued code brings a
   * fresh allowance of `maxAttempts` guesses. Without a limit on ISSUING, an attacker
   * who already holds the password — the exact case a second factor exists to survive —
   * alternates login and verify forever, and the per-code cap stops bounding anything.
   * The mail-bomb on the victim is the secondary harm, not the primary one.
   *
   * Keyed by user, not by IP: the budget being protected belongs to the account, and an
   * attacker rotating source addresses must not get a fresh allowance with each one.
   */
  async issueChallenge(user: {
    id: string;
    email: string;
    displayName: string | null;
  }): Promise<void> {
    const quota = this.rateLimit.hit(`mfa:issue:${user.id}`, this.maxPerHour, 60 * 60 * 1000);
    if (!quota.allowed) {
      this.logger.warn(`mfa_issue_throttled user=${user.id}`);
      await this.repo.recordSecurityEvent({
        actorUserId: user.id,
        eventType: 'mfa.challenge_throttled',
        outcome: 'denied',
        reasonCode: 'issue_quota_exhausted',
      });
      // A code already sent stays valid and verifiable, so a user mid-login is not
      // stranded by an attacker burning their quota — only NEW codes stop.
      throw new HttpException(
        { error: 'Demasiados códigos solicitados. Intenta de nuevo más tarde.' },
        429,
      );
    }

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    await this.repo.replaceMfaOtp(user.id, this.digest(code), expiresAt);

    const minutes = Math.round(this.ttlSeconds / 60);
    // Escaped: this value is merchant-controlled. See escapeHtml above.
    const name = escapeHtml(user.displayName || user.email);
    const sent = await this.email.send({
      to: user.email,
      // The code is NOT in the subject. A subject line is the one field every mail
      // client renders in a lock-screen notification and in the inbox list, so putting
      // the secret there hands it to anyone who can see the phone without unlocking it
      // — which is precisely the possession the factor is supposed to test.
      subject: 'Código de acceso Umi',
      text: `Hola ${name},\n\nTu código de acceso es ${code}.\n\nExpira en ${minutes} minutos y sirve una sola vez.\n\nSi no intentaste iniciar sesión, cambia tu contraseña ahora.\n\nUmi Consulting`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px 24px;color:#1a1a1a">
          <div style="font-size:18px;font-weight:700;margin-bottom:24px">umi <em style="color:#888">· dash</em></div>
          <h2 style="font-size:20px;font-weight:700;margin:0 0 8px">Código de acceso</h2>
          <p style="color:#555;margin:0 0 24px">Hola ${name}, usa este código para completar tu inicio de sesión.</p>
          <div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 0">${code}</div>
          <p style="color:#888;font-size:12px;margin-top:24px">Expira en ${minutes} minutos y sirve una sola vez. Si no intentaste iniciar sesión, cambia tu contraseña ahora.</p>
        </div>
      `,
    });
    if (!sent) {
      // The code is already stored, so the user can still be helped by a re-send.
      // Surface it for ops without telling the caller anything.
      this.logger.error(`mfa_code_send_failed user=${user.id}`);
    }
  }

  /**
   * Check a submitted code. Throws on every failure path with ONE message, so the
   * response cannot be used to tell "no code outstanding" from "wrong code" from
   * "expired" — each of those is a fact an attacker would like to have.
   */
  async verifyCode(userId: string, codeRaw: string): Promise<void> {
    const code = codeRaw.trim();
    const record = await this.repo.findLiveMfaOtp(userId);
    if (!record) {
      // No live code. Recorded too: a burst of these is what a guessing campaign looks
      // like AFTER the attempt cap has burned every code it was given.
      await this.repo.recordSecurityEvent({
        actorUserId: userId,
        eventType: 'mfa.verify_failed',
        outcome: 'denied',
        reasonCode: 'no_live_code',
      });
      throw new UnauthorizedException('Código inválido o expirado');
    }

    const expected = Buffer.from(record.codeHash, 'hex');
    const actual = Buffer.from(this.digest(code), 'hex');
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      const attempts = await this.repo.recordMfaOtpFailure(record.id, this.maxAttempts);
      this.logger.warn(`mfa_code_rejected user=${userId} attempts=${attempts}`);
      // The database, not stdout. runtime.security_audit_event exists for denials,
      // lockouts and credential failures; a log line on the VPS is not queryable, is
      // not alertable, and rotation eventually discards it.
      await this.repo.recordSecurityEvent({
        actorUserId: userId,
        eventType: 'mfa.verify_failed',
        outcome: 'denied',
        reasonCode: attempts >= this.maxAttempts ? 'code_burned' : 'wrong_code',
        metadata: { attempts, maxAttempts: this.maxAttempts },
      });
      throw new UnauthorizedException('Código inválido o expirado');
    }

    // Single-use is decided by the database, not by the check above: two concurrent
    // requests carrying the same correct code both reach here, and only the one whose
    // UPDATE matches `consumed_at IS NULL` is allowed through.
    const consumed = await this.repo.consumeMfaOtp(record.id);
    if (!consumed) {
      await this.repo.recordSecurityEvent({
        actorUserId: userId,
        eventType: 'mfa.verify_failed',
        outcome: 'denied',
        reasonCode: 'code_already_used',
      });
      throw new UnauthorizedException('Código inválido o expirado');
    }

    await this.repo.recordSecurityEvent({
      actorUserId: userId,
      eventType: 'mfa.verify_succeeded',
      outcome: 'success',
    });
  }
}
