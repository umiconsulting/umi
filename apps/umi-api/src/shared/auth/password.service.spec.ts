import { describe, expect, it } from 'vitest';
import { createHash, scryptSync } from 'node:crypto';
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

  describe('legacy sha256, the scheme umi-cash still accepts', () => {
    const salt = 'b'.repeat(32);
    const legacy = (pw: string) =>
      createHash('sha256')
        .update(pw + salt)
        .digest('hex');

    it('verifies a legacy hash when the row says so', () => {
      const stored = legacy('correct horse');
      expect(svc.verify('correct horse', salt, stored, 'legacy-sha256-v1')).toBe(true);
      expect(svc.verify('wrong horse', salt, stored, 'legacy-sha256-v1')).toBe(false);
    });

    it('treats a NULL algorithm as legacy, exactly as umi-cash does', () => {
      // umi-cash picks the branch with `algorithm?.startsWith('scrypt')`, so
      // anything that is not scrypt — null included — takes the sha256 path.
      const stored = legacy('correct horse');
      expect(svc.verify('correct horse', salt, stored, null)).toBe(true);
    });

    it('sends EVERY scrypt label down the scrypt path', () => {
      // A migration once tagged scrypt rows as `scrypt-v1`. Matching the exact
      // string `scrypt-sha256-v1` would send those down the sha256 branch and
      // silently fail every login on them. Match the prefix, as umi-cash does.
      const stored = scryptSync('correct horse', salt, 64).toString('hex');
      for (const label of ['scrypt-sha256-v1', 'scrypt-v1', 'scrypt']) {
        expect(svc.verify('correct horse', salt, stored, label)).toBe(true);
      }
    });

    it('knows which rows still need upgrading', () => {
      expect(svc.needsUpgrade('legacy-sha256-v1')).toBe(true);
      expect(svc.needsUpgrade(null)).toBe(true);
      expect(svc.needsUpgrade('scrypt-sha256-v1')).toBe(false);
    });

    it('a legacy hash does NOT verify as scrypt', () => {
      // The guard against the reverse mistake: if the dispatch were inverted, a
      // legacy row would fail closed rather than open — but prove it.
      const stored = legacy('correct horse');
      expect(svc.verify('correct horse', salt, stored, 'scrypt-sha256-v1')).toBe(false);
    });
  });

  it('returns false (never throws) on malformed/empty input', () => {
    expect(svc.verify('x', '', '')).toBe(false);
    expect(svc.verify('x', 'salt', 'not-hex-zz')).toBe(false);
    // length mismatch (shorter expected) must not throw
    expect(svc.verify('x', 'salt', 'ab')).toBe(false);
  });
});
