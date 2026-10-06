import { describe, expect, it } from 'vitest';
import { canonicalJson, commandFingerprint, redactObject } from './canonical-json';

describe('canonical command data', () => {
  it('produces the same fingerprint for semantically identical objects', () => {
    expect(commandFingerprint('test.command', { b: 2, a: { y: 1, x: 0 } })).toBe(
      commandFingerprint('test.command', { a: { x: 0, y: 1 }, b: 2 }),
    );
  });

  it('keeps command type in the fingerprint boundary', () => {
    expect(commandFingerprint('one', { value: 1 })).not.toBe(
      commandFingerprint('two', { value: 1 }),
    );
  });

  it('redacts sensitive keys recursively without mutating ordinary values', () => {
    expect(redactObject({ token: 'secret', nested: { cvv: '123', value: 7 } })).toEqual({
      token: '[REDACTED]',
      nested: { cvv: '[REDACTED]', value: 7 },
    });
    expect(canonicalJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });
});
