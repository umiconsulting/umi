import { describe, expect, it } from 'vitest';
import { initialsFrom } from './profile-format.js';

describe('profile initials', () => {
  it('takes the first and last initial from a full name', () => {
    expect(initialsFrom('Lucio Martínez', 'x@y.com')).toBe('LM');
  });

  it('collapses extra whitespace before reading the name', () => {
    expect(initialsFrom('  Lucio   Alberto  Martínez ', 'x@y.com')).toBe('LM');
  });

  it('takes two letters from a single-word name', () => {
    expect(initialsFrom('Lucio', 'x@y.com')).toBe('LU');
  });

  it('falls back to the email local part when there is no name', () => {
    expect(initialsFrom('', 'luciomtnz@gmail.com')).toBe('LU');
  });

  it('returns a dash when there is neither name nor email', () => {
    expect(initialsFrom('', '')).toBe('—');
    expect(initialsFrom(null, null)).toBe('—');
  });
});
