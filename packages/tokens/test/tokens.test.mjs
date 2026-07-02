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
  'ink-3': '#8892b3',
  'ink-4': '#b9c0d3',
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
  success: '#4F8A4F',
  'success-soft': '#E4F0E1',
  danger: '#B33A35',
  'danger-soft': '#F4DEDB',
  warning: '#B5812A',
  'warning-soft': '#F6E9D0',
  info: '#7692CB',
  'info-soft': '#DEE6F4',
  'tenant-brand': '#B5605A',
  'r-pill': '9999px',
  'r-lg': '12px',
  'r-xl': '16px',
  'r-card': '20px',
  'r-shell': '28px',
  'shadow-card': '0 1px 0 rgba(19, 31, 68, 0.04), 0 8px 32px -16px rgba(19, 31, 68, 0.18)',
  'shadow-pop': '0 12px 40px -12px rgba(19, 31, 68, 0.25)',
  'shadow-inner': 'inset 0 0 0 1px rgba(19, 31, 68, 0.05)',
  'font-display': '"Source Sans 3", "Domus", Georgia, serif',
  'font-body': '"Source Sans 3", "Source Sans Pro", system-ui, sans-serif',
  'font-mono': '"JetBrains Mono", ui-monospace, "SF Mono", monospace',
  ease: 'cubic-bezier(.2,.7,.2,1)',
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

function parseCssVars(css) {
  const map = {};
  for (const [, name, value] of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) map[name] = value.trim();
  return map;
}

test('dashboard.css reproduces the styles.css :root token set 1:1', () => {
  assert.deepEqual(parseCssVars(distText('dashboard.css')), EXPECTED_DASHBOARD);
});

test('landing.cjs (require) matches tailwind.config.js theme.extend', () => {
  assert.deepEqual(require('../dist/landing.cjs'), EXPECTED_LANDING);
});

test('landing.mjs default export equals the CJS export (dual-format parity)', async () => {
  const mjs = await import('../dist/landing.mjs');
  assert.deepEqual(mjs.default, require('../dist/landing.cjs'));
});

test('shared brand hues resolve from core in BOTH apps (single source, no drift)', () => {
  const dash = parseCssVars(distText('dashboard.css'));
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
