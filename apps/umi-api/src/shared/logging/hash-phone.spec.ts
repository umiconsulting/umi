import { describe, expect, it } from 'vitest';
import { hashPhone } from './hash-phone';

describe('hashPhone', () => {
  it('never returns the number it was given', () => {
    const phone = '+525512345678';
    expect(hashPhone(phone)).not.toContain('5512345678');
  });

  it('is stable, so two events from one number share a handle', () => {
    expect(hashPhone('+525512345678')).toBe(hashPhone('+525512345678'));
  });

  it('separates two different numbers', () => {
    expect(hashPhone('+525512345678')).not.toBe(hashPhone('+525512345679'));
  });

  it('returns 16 hex characters', () => {
    expect(hashPhone('+525512345678')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('matches a known value, so the handle survives a refactor', () => {
    // A literal, not a sha256 that this test computes again. A second
    // computation with the same steps agrees with the code even when the code is
    // wrong. The value is persisted, so a change to it orphans every stored
    // phone_hash.
    expect(hashPhone('+525512345678')).toBe('91e296c972c986bf');
  });
});
