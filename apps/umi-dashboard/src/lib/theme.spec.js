import { describe, expect, it } from 'vitest';
import { nextToggleTheme } from './theme.js';

describe('theme toggle is a two-state switch', () => {
  it('flips Umi to Midnight', () => {
    expect(nextToggleTheme('umi')).toBe('midnight');
  });

  it('flips Midnight to Umi', () => {
    expect(nextToggleTheme('midnight')).toBe('umi');
  });

  it('resolves a legacy system preference to a concrete theme, never system', () => {
    const next = nextToggleTheme('system');
    expect(['umi', 'midnight']).toContain(next);
    expect(next).not.toBe('system');
  });
});
