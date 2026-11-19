import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

let preferences;

beforeEach(async () => {
  vi.resetModules();
  globalThis.localStorage = new MemoryStorage();
  globalThis.window = new EventTarget();
  preferences = await import('./preferences.js');
});

describe('login glass tints', () => {
  it('defaults both modes to 100% when nothing is stored', () => {
    expect(preferences.getGlassTints()).toEqual({ light: 1, dark: 1 });
  });

  it('clamps a stored value into the supported 0..1.5 range', () => {
    localStorage.setItem('umi.login.glass-tint', JSON.stringify({ light: 2.4, dark: -3 }));
    expect(preferences.getGlassTints()).toEqual({ light: 1.5, dark: 0 });
  });

  it('persists and announces a changed tint', () => {
    const seen = [];
    const stop = preferences.subscribeGlassTints((tints) => seen.push(tints));
    preferences.setGlassTint('dark', 0.35);
    expect(JSON.parse(localStorage.getItem('umi.login.glass-tint'))).toEqual({
      light: 1,
      dark: 0.35,
    });
    expect(seen).toEqual([{ light: 1, dark: 0.35 }]);
    stop();
  });

  it('ignores an unknown mode or a non-finite value', () => {
    expect(preferences.setGlassTint('auto', 0.5)).toBeUndefined();
    expect(preferences.setGlassTint('light', Number.NaN)).toBeUndefined();
    expect(preferences.getGlassTints()).toEqual({ light: 1, dark: 1 });
  });

  it('falls back to the last valid tints when storage is malformed', () => {
    preferences.setGlassTint('light', 0.6);
    localStorage.setItem('umi.login.glass-tint', '{not json');
    expect(preferences.getGlassTints()).toEqual({ light: 0.6, dark: 1 });
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const stop = preferences.subscribeGlassTints(listener);
    stop();
    preferences.setGlassTint('light', 0.2);
    expect(listener).not.toHaveBeenCalled();
  });
});
