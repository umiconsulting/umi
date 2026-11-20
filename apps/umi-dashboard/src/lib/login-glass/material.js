/* eslint-disable lingui/no-unlocalized-strings -- CSS, media queries, and SVG primitives. */
import { resolveTheme, subscribeTheme } from '../theme.js';
import { getGlassTints, subscribeGlassTints } from './preferences.js';
import { createRimLens, supportsRimLens } from './lens.js';

const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const linear = (n) => {
  const s = n / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (rgb) =>
  linear(rgb[0]) * 0.2126 + linear(rgb[1]) * 0.7152 + linear(rgb[2]) * 0.0722;
const brightness = (rgb) => (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;
const mix = (front, back, alpha) => front.map((n, i) => n * alpha + back[i] * (1 - alpha));
const contrast = (front, back) => {
  const a = luminance(front),
    b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const SELECTOR =
  '.login-form .input, .login-form .locale-select, .login-submit, .login-remember .box';
const INK_KEY = 'umi.login.glass-ink';

function palette() {
  const style = getComputedStyle(document.documentElement);
  const raw = (name) => style.getPropertyValue(`--glass-${name}`).trim();
  const number = (name) => Number(raw(name));
  return {
    states: Object.fromEntries(
      ['light', 'shade', 'dark'].map((state) => [
        state,
        {
          tint: raw(`${state}-tint`),
          thin: number(`${state}-thin`),
          dense: number(`${state}-dense`),
          saturation: number(`${state}-saturation`),
          brightness: number(`${state}-brightness`),
          edge: raw(`${state}-edge`),
          highlight: raw(`${state}-highlight`),
        },
      ]),
    ),
    ink: { dark: raw('light-ink'), light: raw('dark-ink') },
    secondary: { dark: raw('light-secondary'), light: raw('dark-secondary') },
    rimMin: number('rim-min'),
    rimMax: number('rim-max'),
    rimRatio: number('rim-ratio'),
    rimDepth: number('rim-depth'),
    rimPower: number('rim-power'),
    split: number('color-split'),
    panelDense: number('panel-dense'),
  };
}

// Contrast uses the fixed secondary ink, including its alpha. Density supplies the correction.
function safeAlpha(samples, state, ink, alpha, saturation, dim) {
  const tint =
    state === 'light' ? [255, 255, 255] : state === 'shade' ? [16, 18, 22] : [20, 20, 24];
  const foreground = ink === 'dark' ? [58, 58, 65] : [235, 235, 245];
  const opacity = ink === 'dark' ? 0.7 : 0.64;
  const passes = (a) =>
    samples.every((sample) => {
      const gray = sample[0] * 0.213 + sample[1] * 0.715 + sample[2] * 0.072;
      const filtered = sample.map((n) => clamp((gray + (n - gray) * saturation) * dim, 0, 255));
      // Include a small interior reflection. The strongest rim stays outside the text inset.
      const background = mix(
        [255, 255, 255],
        mix(tint, filtered, a),
        state === 'light' ? 0.1 : 0.13,
      );
      return (
        contrast(mix(foreground, background, opacity), background) >= (ink === 'dark' ? 4.5 : 4.7)
      );
    });
  let result = alpha;
  while (result < 1 && !passes(result)) result = Math.min(1, result + 0.025);
  return result;
}

export function attachLoginGlass(root) {
  const tokens = palette();
  root.dataset.loginInput = 'keyboard';
  let pressedSurface;
  const release = () => {
    if (pressedSurface) delete pressedSurface.dataset.glassPressed;
    pressedSurface = undefined;
  };
  const pointer = (event) => {
    root.dataset.loginInput = 'pointer';
    release();
    const element = event.target.closest('.input, .select, .login-submit');
    if (!element || !root.contains(element)) return;
    pressedSurface = element;
    element.dataset.glassPressed = 'true';
    const bounds = element.getBoundingClientRect();
    element.style.setProperty(
      '--login-glass-touch-x',
      String(clamp((event.clientX - bounds.left) / bounds.width)),
    );
    element.style.setProperty(
      '--login-glass-touch-y',
      String(clamp((event.clientY - bounds.top) / bounds.height)),
    );
  };
  const keyboard = (event) => {
    if (['Tab', 'ArrowDown', 'ArrowUp'].includes(event.key)) root.dataset.loginInput = 'keyboard';
  };
  root.addEventListener('pointerdown', pointer);
  document.addEventListener('keydown', keyboard, true);
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', release);
  const surfaces = new Map();
  let disposed = false,
    pending = 0,
    timer;
  let tints = getGlassTints();
  let remembered = {};
  try {
    const saved = JSON.parse(localStorage.getItem(INK_KEY) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) remembered = saved;
  } catch {
    /* Storage is optional. */
  }
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 5;
  sampleCanvas.height = 3;
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  const media = window.matchMedia('(prefers-reduced-transparency: reduce)');
  const forced = window.matchMedia('(forced-colors: active)');
  const lensSupported = supportsRimLens();

  function reset(element, record) {
    record.lens?.destroy();
    record.lens = null;
    delete element.dataset.loginGlass;
    delete element.dataset.glassInk;
    delete element.dataset.glassState;
    for (const name of [
      'tint',
      'highlight',
      'ink',
      'secondary',
      'alpha',
      'scale',
      'saturation',
      'brightness',
      'edge',
      'blend',
    ])
      element.style.removeProperty(`--login-glass-${name}`);
  }
  function refresh() {
    const candidates = [...root.querySelectorAll(SELECTOR)];
    const trigger = root.querySelector('.locale-select[aria-controls]');
    const popup = trigger && document.getElementById(trigger.getAttribute('aria-controls'));
    if (popup) candidates.push(popup);
    root
      .querySelectorAll('.login-glass-settings[open] > .login-glass-settings-panel')
      .forEach((p) => candidates.push(p));
    for (const [element, record] of surfaces)
      if (!candidates.includes(element)) {
        reset(element, record);
        surfaces.delete(element);
        observer.unobserve(element);
      }
    for (const element of candidates) {
      if (surfaces.has(element)) continue;
      const key =
        element.id || (element.matches('.ui-select-pop') ? 'locale-popup' : element.className);
      surfaces.set(element, {
        key,
        ink: ['light', 'dark'].includes(remembered[key]) ? remembered[key] : undefined,
        lens: null,
      });
      observer.observe(element);
    }
  }
  function samplesBehind(element, scene) {
    const bounds = element.getBoundingClientRect();
    const visible = scene && !scene.hidden && scene.dataset.ready === 'true';
    const area = visible && scene.getBoundingClientRect();
    if (
      !area ||
      bounds.right <= area.left ||
      bounds.left >= area.right ||
      bounds.top >= area.bottom ||
      bounds.bottom <= area.top
    )
      return null;
    if (!ctx) return { bounds, pixels: null };
    try {
      // One read for fifteen nearest-neighbor samples from the actual animated canvas.
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        scene,
        ((bounds.left - area.left) * scene.width) / area.width,
        ((bounds.top - area.top) * scene.height) / area.height,
        (bounds.width * scene.width) / area.width,
        (bounds.height * scene.height) / area.height,
        0,
        0,
        5,
        3,
      );
      const data = ctx.getImageData(0, 0, 5, 3).data;
      const pixels = Array.from({ length: 15 }, (_, i) => [
        data[i * 4],
        data[i * 4 + 1],
        data[i * 4 + 2],
      ]);
      return { bounds, pixels };
    } catch {
      return { bounds, pixels: null };
    }
  }
  function canLens(element, bounds) {
    if (
      !lensSupported ||
      media.matches ||
      forced.matches ||
      Math.min(bounds.width, bounds.height) < 32 ||
      element.matches('.ui-select-pop, .login-glass-settings-panel')
    )
      return false;
    let current = element;
    while (current && current !== root) {
      const s = getComputedStyle(current);
      if (
        s.willChange !== 'auto' ||
        s.transform !== 'none' ||
        (current === element && s.filter !== 'none')
      )
        return false;
      current = current.parentElement;
    }
    const shape = getComputedStyle(element).cornerShape;
    // Chromium serializes the default circular corner as superellipse(1).
    return !shape || shape === 'round' || shape === 'superellipse(1)';
  }
  function update() {
    pending = 0;
    if (disposed || document.hidden) return;
    refresh();
    const scene = root.querySelector('.login-goldfish canvas');
    const dark = resolveTheme() !== 'umi';
    const rows = [];
    let changedInk = false;
    for (const [element, record] of surfaces) {
      const sampled = samplesBehind(element, scene);
      if (!sampled || (element.disabled && !element.matches('.login-submit'))) {
        reset(element, record);
        continue;
      }
      const { bounds, pixels } = sampled;
      if (!bounds.width || !bounds.height) continue;
      const sorted = pixels?.slice().sort((a, b) => brightness(a) - brightness(b));
      const trimmed = sorted?.slice(2, -2);
      const average = trimmed
        ? trimmed.reduce((sum, rgb) => sum + brightness(rgb), 0) / trimmed.length
        : dark
          ? 0
          : 1;
      const texture = sorted ? brightness(sorted.at(-1)) - brightness(sorted[0]) : 1;
      const chroma = trimmed
        ? trimmed.reduce((sum, rgb) => sum + (Math.max(...rgb) - Math.min(...rgb)) / 255, 0) /
          trimmed.length
        : 0;
      // Expanded panels keep one polarity as the scene moves beneath them.
      const panel = element.matches('.ui-select-pop, .login-glass-settings-panel');
      let ink = dark || panel ? 'light' : record.ink;
      if (
        !dark &&
        !panel &&
        (!ink || (ink === 'light' && average > 0.55) || (ink === 'dark' && average < 0.45))
      )
        ink = average < 0.5 ? 'light' : 'dark';
      const row = rows.find((entry) => Math.abs(entry.top - bounds.top) < 12);
      if (row) ink = row.ink;
      else rows.push({ top: bounds.top, ink });
      if (record.ink !== ink) {
        record.ink = ink;
        remembered[record.key] = ink;
        changedInk = true;
      }
      const state = dark ? 'dark' : ink === 'light' ? 'shade' : 'light';
      const material = tokens.states[state];
      const density = pixels
        ? clamp(
            0.55 * (1 - Math.abs(average - (ink === 'light' ? 1 : 0))) +
              0.7 * texture +
              0.3 * chroma,
          )
        : 1;
      const kept = Math.max(0.45, 1 - 0.75 * chroma);
      const saturation = material.saturation * kept;
      const initial = Math.max(
        panel ? tokens.panelDense : 0,
        material.thin + (material.dense - material.thin) * density,
      );
      const alpha = pixels
        ? safeAlpha(pixels, state, ink, initial, saturation, material.brightness)
        : Math.max(panel ? tokens.panelDense : 0, material.dense);
      const values = {
        tint: material.tint,
        highlight: material.highlight,
        ink: tokens.ink[ink],
        secondary: tokens.secondary[ink],
        alpha: alpha.toFixed(3),
        scale: tints[dark ? 'dark' : 'light'],
        saturation,
        brightness: material.brightness,
        edge: material.edge,
        blend: ink === 'light' ? 'plus-lighter' : 'multiply',
      };
      element.dataset.loginGlass = 'true';
      element.dataset.glassInk = ink;
      element.dataset.glassState = state;
      for (const [name, value] of Object.entries(values))
        element.style.setProperty(`--login-glass-${name}`, String(value));
      if (canLens(element, bounds)) {
        if (!record.lens) record.lens = createRimLens(element, tokens);
        record.lens.update().catch(() => {
          record.lens?.destroy();
          record.lens = null;
        });
      } else if (record.lens) {
        record.lens.destroy();
        record.lens = null;
      }
    }
    if (changedInk)
      try {
        localStorage.setItem(INK_KEY, JSON.stringify(remembered));
      } catch {
        /* Storage is optional. */
      }
  }
  const schedule = () => {
    if (!pending && !disposed) pending = requestAnimationFrame(update);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(root);
  const mutations = new MutationObserver(schedule);
  mutations.observe(root, { childList: true, subtree: true });
  const portals = new MutationObserver(schedule);
  portals.observe(document.body, { childList: true });
  const unsubscribeTheme = subscribeTheme(schedule);
  const unsubscribeTints = subscribeGlassTints((next) => {
    tints = next;
    schedule();
  });
  for (const query of [media, forced]) query.addEventListener('change', schedule);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', schedule);
  timer = window.setInterval(schedule, 250);
  update();
  return () => {
    disposed = true;
    release();
    root.removeEventListener('pointerdown', pointer);
    document.removeEventListener('pointerup', release, true);
    document.removeEventListener('pointercancel', release, true);
    window.removeEventListener('blur', release);
    document.removeEventListener('keydown', keyboard, true);
    delete root.dataset.loginInput;
    for (const element of root.querySelectorAll('.input, .select, .login-submit')) {
      element.style.removeProperty('--login-glass-touch-x');
      element.style.removeProperty('--login-glass-touch-y');
    }
    clearInterval(timer);
    cancelAnimationFrame(pending);
    observer.disconnect();
    mutations.disconnect();
    portals.disconnect();
    unsubscribeTheme();
    unsubscribeTints();
    for (const query of [media, forced]) query.removeEventListener('change', schedule);
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('visibilitychange', schedule);
    for (const [element, record] of surfaces) reset(element, record);
  };
}
