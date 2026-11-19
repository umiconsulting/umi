const KEY = 'umi.login.glass-tint';
const EVENT = 'umi-login-glass-change';
const clamp = (value) => Math.min(1.5, Math.max(0, value));
let memory = { light: 1, dark: 1 };

export function getGlassTints() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    memory = Object.fromEntries(
      ['light', 'dark'].map((mode) => [
        mode,
        typeof saved[mode] === 'number' && Number.isFinite(saved[mode]) ? clamp(saved[mode]) : 1,
      ]),
    );
    return memory;
  } catch {
    return memory;
  }
}

export function setGlassTint(mode, value) {
  if (!['light', 'dark'].includes(mode) || !Number.isFinite(value)) return;
  const next = { ...getGlassTints(), [mode]: clamp(value) };
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Browser storage is optional. */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

export function subscribeGlassTints(callback) {
  const change = (event) => callback(event.detail || getGlassTints());
  const storage = (event) => {
    if (!event.key || event.key === KEY) callback(getGlassTints());
  };
  window.addEventListener(EVENT, change);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(EVENT, change);
    window.removeEventListener('storage', storage);
  };
}
