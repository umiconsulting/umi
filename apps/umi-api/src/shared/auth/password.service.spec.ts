import { describe, expect, it } from 'vitest';
import { scryptSync } from 'node:crypto';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('verifies a hash produced by the dashboard scheme (scrypt keylen 64, hex)', () => {
    // Reproduce exactly what apps/umi-dashboard/server.js stored.
    const salt = 'a'.repeat(32);
    const stored = scryptSync('correct horse', salt, 64).toString('hex');
    expect(svc.verify('correct horse', salt, stored)).toBe(true);
    expect(svc.verify('wrong horse', salt, stored)).toBe(false);
  });

  it('round-trips its own hash()', () => {
    const { salt, hash } = svc.hash('hunter2');
    expect(svc.verify('hunter2', salt, hash)).toBe(true);
    expect(svc.verify('hunter3', salt, hash)).toBe(false);
  });

  it('returns false (never throws) on malformed/empty input', () => {
    expect(svc.verify('x', '', '')).toBe(false);
    expect(svc.verify('x', 'salt', 'not-hex-zz')).toBe(false);
    // length mismatch (shorter expected) must not throw
    expect(svc.verify('x', 'salt', 'ab')).toBe(false);
  });
});
