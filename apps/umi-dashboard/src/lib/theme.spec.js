import { describe, expect, it } from 'vitest';
import { nextToggleTheme } from './theme.js';

// nextToggleTheme is the light↔dark helper: it flips between the Umi default and
// the OS-dark default ('dark', the ocean theme). It never returns 'system', and it
// never returns 'midnight' — that all-black theme is reachable from the picker, not
// this two-state flip.
describe('theme toggle helper (light ↔ dark default)', () => {
  it('flips Umi to the dark default', () => {
    expect(nextToggleTheme('umi')).toBe('dark');
  });

  it('flips a dark theme back to Umi', () => {
    expect(nextToggleTheme('dark')).toBe('umi');
    expect(nextToggleTheme('midnight')).toBe('umi');
  });

  it('resolves a legacy system preference to a concrete theme, never system', () => {
    const next = nextToggleTheme('system');
    expect(['umi', 'dark', 'midnight']).toContain(next);
    expect(next).not.toBe('system');
  });
});
