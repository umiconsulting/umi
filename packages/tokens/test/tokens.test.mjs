// Parity + anti-drift guard for the generated token artifacts. Zero-dep: runs on
// the built-in `node --test` runner. Regenerates dist/ (importing the generator
// for its side effect) then asserts the output still matches the values captured
// from the two apps' current sources. A deliberate token change is expected to
// update the expected maps below — that is the point: value edits must be stated,
// not silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
await import('../build/build.mjs'); // regenerate dist/ as a side effect
const require = createRequire(import.meta.url);
const distText = (f) => readFileSync(join(PKG, 'dist', f), 'utf8');

// Captured verbatim from apps/umi-dashboard/src/styles.css :root (lines 6-77).
const EXPECTED_DASHBOARD = {
  'umi-navy': '#223979',
  'umi-navy-deep': '#1a2c5e',
  'umi-navy-ink': '#131f44',
  'umi-blue': '#7692CB',
  'umi-blue-soft': '#a8bbde',
  'umi-neutral': '#EEF1F8',
  'umi-white': '#ffffff',
  canvas: '#EEF1F8',
  'canvas-2': '#E4E9F3',
  surface: '#ffffff',
  'surface-warm': '#FAF4EC',
  'surface-warm-border': '#EAE0D3',
  'sidebar-bg': '#1a2952',
  'sidebar-bg-deep': '#131f44',
  'ink-1': '#131f44',
  'ink-2': '#4a5680',
  'ink-3': '#5C678F',
  'ink-4': '#7D8AAE',
  'ink-warm': '#1F1410',
  'ink-warm-soft': '#6e5a4a',
  'ink-warm-mute': '#C4A882',
  'side-text-1': '#f0f4ff',
  'side-text-2': 'rgba(240, 244, 255, 0.62)',
  'side-text-3': 'rgba(240, 244, 255, 0.34)',
  'side-line': 'rgba(255, 255, 255, 0.08)',
  line: '#DDE3F0',
  'line-soft': '#E8ECF5',
  'line-strong': '#C8D1E5',
  success: '#447644',
  'success-soft': '#E4F0E1',
  danger: '#B33A35',
  'danger-soft': '#F4DEDB',
  warning: '#8F6621',
  'warning-soft': '#F6E9D0',
  info: '#7692CB',
  'info-soft': '#DEE6F4',
  'tenant-brand': '#B5605A',
  'r-pill': '9999px',
  'r-lg': '12px',
  'r-xl': '16px',
  'r-card': '20px',
  'r-shell': '28px',
  'shadow-card': '0 1px 2px rgba(19, 31, 68, 0.04)',
  'shadow-pop': '0 24px 60px -24px rgba(19, 31, 68, 0.32), 0 2px 8px rgba(19, 31, 68, 0.06)',
  'shadow-inner': 'inset 0 0 0 1px rgba(19, 31, 68, 0.05)',
  'font-display': '"Fraunces", "Source Serif 4", Georgia, serif',
  'font-body': '"Source Sans 3", "Source Sans Pro", system-ui, sans-serif',
  'font-mono': '"JetBrains Mono", ui-monospace, "SF Mono", monospace',
  ease: 'cubic-bezier(.2,.7,.2,1)',
  'ease-out': 'cubic-bezier(.16,1,.3,1)',
  'dur-1': '120ms',
  'dur-2': '220ms',
  'dur-3': '320ms',
};

// Captured verbatim from apps/umi-landing-page/tailwind.config.js theme.extend.
const EXPECTED_LANDING = {
  colors: {
    'umi-blue': {
      dark: '#223979',
      light: '#7692CB',
      deep: '#0A1430',
      80: 'rgba(34, 57, 121, 0.8)',
      60: 'rgba(34, 57, 121, 0.6)',
      40: 'rgba(34, 57, 121, 0.4)',
    },
    'umi-light-blue': {
      DEFAULT: '#7692CB',
      soft: '#BFD1F2',
      80: 'rgba(118, 146, 203, 0.8)',
      60: 'rgba(118, 146, 203, 0.6)',
      40: 'rgba(118, 146, 203, 0.4)',
    },
    'umi-paper': '#FBF7EF',
    'umi-paper-warm': '#EDE7DA',
    'umi-accent': '#E7A85B',
    'umi-ink': '#F2F6FF',
  },
  fontFamily: {
    domus: ['var(--font-nunito)', 'sans-serif'],
    sans: ['var(--font-nunito)', 'sans-serif'],
    serif: ['var(--font-fraunces)', 'Georgia', 'serif'],
    mono: ['var(--font-source-code)', 'monospace'],
  },
  letterSpacing: { 'wider-2': '0.2em', 'wider-3': '0.22em' },
};

// The dark theme adds a second and third block of --vars to dashboard.css, so a
// whole-file scan would collapse light + dark into one map (last write wins).
// Scope every dashboard assertion to a single selector block instead.
function block(css, header) {
  const start = css.indexOf(header);
  assert.ok(start >= 0, `block "${header}" not found`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function parseCssVars(css) {
  const map = {};
  for (const [, name, value] of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) map[name] = value.trim();
  return map;
}

// Only the tokens the Midnight theme overrides. Every other token keeps its Umi
// (:root) value in every theme (see dashboard.json — a leaf's $themes map).
const EXPECTED_DASHBOARD_MIDNIGHT = {
  canvas: '#000000',
  'canvas-2': '#0D0D0D',
  surface: '#000000',
  'surface-warm': '#000000',
  'surface-warm-border': '#2A2A2A',
  'sidebar-bg': '#000000',
  'sidebar-bg-deep': '#000000',
  'ink-1': '#F2F2F2',
  'ink-2': '#B0B0B0',
  'ink-3': '#8A8A8A',
  'ink-4': '#6A6A6A',
  'ink-warm': '#EDEDED',
  'ink-warm-soft': '#A0A0A0',
  'ink-warm-mute': '#6E6E6E',
  line: '#2A2A2A',
  'line-soft': '#1C1C1C',
  'line-strong': '#3A3A3A',
  success: '#62B36B',
  'success-soft': '#12211A',
  danger: '#E5706B',
  'danger-soft': '#251312',
  warning: '#D9A441',
  'warning-soft': '#241D10',
  info: '#7FA2E0',
  'info-soft': '#131A26',
  'tenant-brand': '#C77B72',
  'shadow-card': '0 1px 2px rgba(0, 0, 0, 0.5)',
  'shadow-pop': '0 24px 60px -24px rgba(0, 0, 0, 0.8), 0 2px 8px rgba(0, 0, 0, 0.5)',
  'shadow-inner': 'inset 0 0 0 1px rgba(255, 255, 255, 0.06)',
};

test('dashboard.css :root reproduces the default Umi token set 1:1', () => {
  assert.deepEqual(parseCssVars(block(distText('dashboard.css'), ':root {')), EXPECTED_DASHBOARD);
});

test('dashboard.css Midnight theme overrides exactly the tokens that declare it', () => {
  const css = distText('dashboard.css');
  const choice = parseCssVars(block(css, '[data-theme="midnight"] {'));
  assert.deepEqual(choice, EXPECTED_DASHBOARD_MIDNIGHT);
  // The OS-preference block must carry the identical override set, so the picker
  // and the system setting can never resolve to different palettes.
  const osPref = parseCssVars(block(css, ':root:not([data-theme]) {'));
  assert.deepEqual(osPref, EXPECTED_DASHBOARD_MIDNIGHT);
});

test('every Midnight override names a real Umi token (no orphan theme-only vars)', () => {
  const umi = parseCssVars(block(distText('dashboard.css'), ':root {'));
  for (const name of Object.keys(EXPECTED_DASHBOARD_MIDNIGHT)) {
    assert.ok(name in umi, `Midnight override --${name} has no :root base`);
  }
});

test('landing.cjs (require) matches tailwind.config.js theme.extend', () => {
  assert.deepEqual(require('../dist/landing.cjs'), EXPECTED_LANDING);
});

test('landing.mjs default export equals the CJS export (dual-format parity)', async () => {
  const mjs = await import('../dist/landing.mjs');
  assert.deepEqual(mjs.default, require('../dist/landing.cjs'));
});

test('shared brand hues resolve from core in BOTH apps (single source, no drift)', () => {
  const dash = parseCssVars(block(distText('dashboard.css'), ':root {'));
  const land = require('../dist/landing.cjs');
  assert.equal(dash['umi-navy'], '#223979');
  assert.equal(dash['umi-navy'], land.colors['umi-blue'].dark);
  assert.equal(dash['umi-blue'], '#7692CB');
  assert.equal(dash['umi-blue'], land.colors['umi-light-blue'].DEFAULT);
});

test('no unresolved DTCG references leak into any generated artifact', () => {
  for (const f of ['dashboard.css', 'landing.cjs', 'landing.mjs', 'tokens.json']) {
    assert.doesNotMatch(distText(f), /\{[a-z]+(\.[a-z]+)+\}/i, `unresolved {ref} in dist/${f}`);
  }
});
