// theme.js
// One place that owns the console theme choice.
//
// Themes are NAMED, not a light/dark switch. 'umi' is the default theme (the
// original light palette, served by :root). 'midnight' is the first alternate
// (dark). More themes can be added later: add the palette under each token's
// $themes map in packages/tokens and add the name to THEMES here.
//
// The stored preference is a theme name or 'system':
//   - 'system' stores nothing and removes the data-theme attribute; the OS
//     preference then governs through the @media (prefers-color-scheme) block in
//     the generated token stylesheet (@umi/tokens/dashboard.css), which maps OS
//     dark to PREFERS_DARK ('midnight').
//   - a theme name writes data-theme on <html>, which always wins over the OS.
//
// index.html sets the attribute BEFORE first paint from the same storage key, so
// the first frame is already the right theme (no flash). This module is the
// runtime side: it flips the attribute when the operator picks a theme and
// resolves the concrete theme name for the picker's icon.

const KEY = 'umi-theme';

// The default theme lives in :root, so it has no data-theme block; it is still a
// valid explicit choice (data-theme="umi" pins it and blocks the OS override).
const DEFAULT_THEME = 'umi';
// Every selectable theme, in picker order. Keep in step with packages/tokens.
const THEMES = ['umi', 'midnight'];
// The theme the OS dark preference resolves to under 'system'.
const PREFERS_DARK = 'midnight';

// Read the stored preference. Any unknown or absent value means 'system', so a
// cleared or blocked localStorage degrades to following the OS.
function getThemePreference() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

// Put the preference onto <html>. 'system' clears the attribute so the OS wins.
function applyThemePreference(pref) {
  const root = document.documentElement;
  if (THEMES.includes(pref)) root.setAttribute('data-theme', pref);
  else root.removeAttribute('data-theme');
}

// Store the preference and apply it, then announce the change so open controls
// re-render. 'system' clears the key rather than storing the word, which keeps
// the boot script's read simple (a stored value is always a real theme name).
function setThemePreference(pref) {
  const next = THEMES.includes(pref) ? pref : 'system';
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Storage is best-effort; the in-page attribute below still takes effect.
  }
  applyThemePreference(next);
  window.dispatchEvent(new CustomEvent('umi-theme-change', { detail: next }));
}

// Does the OS ask for dark right now?
function systemPrefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

// The concrete theme name on screen for a given preference: 'system' resolves
// through the OS to PREFERS_DARK or the default. Use this for the picker icon.
function resolveTheme(pref = getThemePreference()) {
  if (THEMES.includes(pref)) return pref;
  return systemPrefersDark() ? PREFERS_DARK : DEFAULT_THEME;
}

// The theme a two-state toggle flips to. It reads the concrete theme on screen
// (resolving a legacy 'system' preference through the OS) and returns the OTHER
// one, so the switch only ever moves between 'umi' and 'midnight' — there is no
// third 'system' stop. The return is always a real theme name, never 'system'.
function nextToggleTheme(pref = getThemePreference()) {
  return resolveTheme(pref) === DEFAULT_THEME ? PREFERS_DARK : DEFAULT_THEME;
}

// Call cb whenever the effective theme could change: an in-app pick, another tab
// writing the same key, or the OS preference flipping while on 'system'.
// Returns an unsubscribe function.
function subscribeTheme(cb) {
  const onChange = () => cb(getThemePreference());
  const mql = (() => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return null;
    }
  })();
  window.addEventListener('umi-theme-change', onChange);
  window.addEventListener('storage', onChange);
  mql?.addEventListener?.('change', onChange);
  return () => {
    window.removeEventListener('umi-theme-change', onChange);
    window.removeEventListener('storage', onChange);
    mql?.removeEventListener?.('change', onChange);
  };
}

export {
  THEMES,
  DEFAULT_THEME,
  PREFERS_DARK,
  getThemePreference,
  setThemePreference,
  applyThemePreference,
  resolveTheme,
  nextToggleTheme,
  systemPrefersDark,
  subscribeTheme,
};
