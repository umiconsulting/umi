/**
 * Self-check for the Centro de caja artifact.
 *
 *   node qa.mjs            # checks + screenshots into ./shots
 *   node qa.mjs --no-shots # checks only
 *
 * Findings, not opinions: the script measures layout, contrast, touch targets,
 * accessible names, keyboard operation, and the full close flow.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PW =
  process.env.PLAYWRIGHT_PATH ||
  '/home/juan/Projects/umiconsulting/umi-buildv3/node_modules/.pnpm/playwright@1.63.0-alpha-2026-08-31/node_modules/playwright';
const require = createRequire(path.join(PW, 'package.json'));
const { chromium } = require('playwright');

const URL = process.env.ARTIFACT_URL || 'file://' + path.join(HERE, 'index.html');
const SHOTS = path.join(HERE, 'shots');
const wantShots = !process.argv.includes('--no-shots');
if (wantShots) fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { w: 1440, h: 900, name: 'desktop-1440' },
  { w: 1280, h: 800, name: 'desktop-1280' },
  { w: 1024, h: 768, name: 'terminal-1024' },
  { w: 900, h: 720, name: 'min-900' },
  { w: 480, h: 900, name: 'narrow-480' },
];

const findings = [];
const add = (level, area, detail) => findings.push({ level, area, detail });

const AUDIT = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: fg.a + bg.a * (1 - fg.a),
  });
  const flatten = (c) => ({ r: c.r, g: c.g, b: c.b, a: 1 });
  const bgOf = (el) => {
    let n = el,
      acc = null;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) return null; // not measurable
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) acc = acc ? over(acc, c) : c;
      if (acc && acc.a >= 0.999) return flatten(acc);
      n = n.parentElement;
    }
    return acc ? flatten(acc) : { r: 255, g: 255, b: 255, a: 1 };
  };
  const ratio = (a, b) => {
    const l1 = lum(a),
      l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const out = { contrast: [], targets: [], names: [], fonts: [], clipped: [] };
  out.overlaps = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return (
      r.width > 1 &&
      r.height > 1 &&
      cs.visibility !== 'hidden' &&
      cs.display !== 'none' &&
      !el.classList.contains('sr') &&
      r.bottom > 0 &&
      r.top < window.innerHeight &&
      r.right > 0 &&
      r.left < window.innerWidth
    );
  };

  // clipped content: taller than the box, and the box cannot scroll
  const hasScrollableChild = (el) =>
    Array.from(el.querySelectorAll('*')).some((c) => {
      const cs = getComputedStyle(c);
      return /auto|scroll/.test(cs.overflowY) && c.scrollHeight > c.clientHeight + 1;
    });
  document.querySelectorAll('body *').forEach((el) => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    const scrollable = /auto|scroll/.test(cs.overflowY);
    if (
      !scrollable &&
      !hasScrollableChild(el) &&
      el.scrollHeight > el.clientHeight + 6 &&
      el.clientHeight > 0
    ) {
      out.clipped.push({
        el: el.className || el.tagName,
        need: el.scrollHeight,
        has: el.clientHeight,
      });
    }
  });

  // touch targets
  document
    .querySelectorAll('button, a[href], input, select, [role="button"], [role="option"]')
    .forEach((el) => {
      if (!visible(el)) return;
      const cs = getComputedStyle(el);
      const inline =
        el.tagName === 'A' &&
        cs.display.startsWith('inline') &&
        parseFloat(cs.paddingLeft) === 0 &&
        parseFloat(cs.paddingRight) === 0;
      if (inline) return; // text links are not controls
      const box = el.tagName === 'INPUT' && el.closest('label') ? el.closest('label') : el;
      const r = box.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || el.textContent || el.value || '')
        .trim()
        .slice(0, 34);
      if (r.height < 44 || r.width < 44)
        out.targets.push({
          label,
          w: Math.round(r.width),
          h: Math.round(r.height),
          cls: el.className,
        });
    });

  // accessible names
  document.querySelectorAll('button, a[href], input, select').forEach((el) => {
    if (!visible(el)) return;
    const named =
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.textContent.trim() ||
      (el.labels && el.labels.length) ||
      el.getAttribute('aria-labelledby') ||
      el.placeholder;
    if (!named) out.names.push(el.outerHTML.slice(0, 90));
  });

  // contrast
  document.querySelectorAll('body *').forEach((el) => {
    if (!visible(el)) return;
    const txt = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim())
      .join(' ');
    if (!txt) return;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) return;
    const bg = bgOf(el);
    if (!bg) return; // a gradient background is not measurable here
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 600);
    const r = ratio(fg.a < 1 ? flatten(over(fg, bg)) : fg, bg);
    const min = large ? 3 : 4.5;
    if (r < min)
      out.contrast.push({
        txt: txt.slice(0, 40),
        ratio: Math.round(r * 100) / 100,
        size: Math.round(size),
        min,
        cls: el.className,
      });
  });

  // fonts below the platform floor (11px)
  document.querySelectorAll('body *').forEach((el) => {
    if (!visible(el)) return;
    const txt = Array.from(el.childNodes).filter(
      (n) => n.nodeType === 3 && n.textContent.trim(),
    ).length;
    if (!txt) return;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 11)
      out.fonts.push({
        txt: (el.textContent || '').trim().slice(0, 30),
        size: Math.round(size * 10) / 10,
      });
  });

  // sibling overlap inside a layout container (a collision the eye sees first)
  document
    .querySelectorAll('.topbar, .panel-head, .answer, .filters, .actions, .steps')
    .forEach((box) => {
      const kids = Array.from(box.children).filter(visible);
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect(),
            b = kids[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 4 && oy > 4)
            out.overlaps.push(
              `${kids[i].className || kids[i].tagName} ∩ ${kids[j].className || kids[j].tagName} (${Math.round(ox)}×${Math.round(oy)})`,
            );
        }
      }
    });

  return out;
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const r = await page.evaluate(AUDIT);
  const overflowX = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (errors.length) add('error', 'console@' + vp.name, errors.slice(0, 3).join(' | '));
  if (overflowX > 1) add('error', 'overflow-x@' + vp.name, overflowX + 'px');
  if (r.clipped.length)
    add(
      'error',
      'clipped@' + vp.name,
      r.clipped
        .slice(0, 4)
        .map((c) => `${c.el} ${c.has}/${c.need}`)
        .join(' · '),
    );
  if (r.targets.length)
    add(
      'warn',
      'targets@' + vp.name,
      r.targets
        .slice(0, 6)
        .map((t) => `${t.w}×${t.h} “${t.label}”`)
        .join(' · '),
    );
  if (r.names.length) add('error', 'names@' + vp.name, r.names.slice(0, 3).join(' | '));
  if (r.contrast.length)
    add(
      'warn',
      'contrast@' + vp.name,
      r.contrast
        .slice(0, 6)
        .map((c) => `${c.ratio}:1 “${c.txt}”`)
        .join(' · '),
    );
  if (r.fonts.length)
    add(
      'warn',
      'fonts@' + vp.name,
      r.fonts
        .slice(0, 4)
        .map((f) => `${f.size}px “${f.txt}”`)
        .join(' · '),
    );
  if (r.overlaps.length) add('error', 'overlap@' + vp.name, r.overlaps.slice(0, 4).join(' · '));
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, vp.name + '.png') });
  await page.close();
}

/* ── keyboard ── */
if (!process.env.QA_SKIP_FLOW) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.keyboard.press('Control+k');
  if (!(await page.locator('#dlg-palette').evaluate((d) => d.open)))
    add('error', 'keyboard', 'Ctrl+K no abrió la paleta');
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focused !== 'ledger-search')
    add('error', 'keyboard', '“/” no enfocó la búsqueda (' + focused + ')');
  const reachable = await page.evaluate(async () => {
    const all = Array.from(
      document.querySelectorAll('button, a[href], input, [tabindex="0"]'),
    ).filter((e) => e.offsetParent !== null);
    return all.filter((e) => e.tabIndex >= 0).length;
  });
  if (reachable < 30) add('warn', 'keyboard', 'sólo ' + reachable + ' controles alcanzables');
  await page.close();
}

/* ── dark mode contrast ── */
{
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const r = await page.evaluate(AUDIT);
  if (r.contrast.length)
    add(
      'warn',
      'contrast@dark',
      r.contrast
        .slice(0, 6)
        .map((c) => `${c.ratio}:1 “${c.txt}”`)
        .join(' · '),
    );
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, 'dark-1440.png') });
  await page.close();
}

/* ── the close flow, end to end ── */
if (!process.env.QA_SKIP_FLOW) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      add('error', 'flow', name + ' → ' + e.message);
    }
  };

  await step('abrir conteo', async () => {
    await page.click('[data-act="count"]');
    if (!(await page.locator('#dlg-count').evaluate((d) => d.open)))
      throw new Error('el diálogo no abrió');
  });
  await step('total en el botón', async () => {
    const label = await page.locator('#btn-submit-count').innerText();
    if (!/\$/.test(label)) throw new Error('el botón no lleva el total');
  });
  // $3,425.00 against an expected $3,430.00 → a $5.00 difference: outside the
  // $1.00 tolerance (so a manager approves) and exactly at the $5.00 close
  // threshold (so the close itself needs nothing extra).
  await step('contar $3,425.00', async () => {
    const inputs = page.locator('#denoms input');
    const n = await inputs.count();
    const bag = { 0: '3', 2: '2', 5: '1', 7: '1' };
    for (let i = 0; i < n; i++) await inputs.nth(i).fill(bag[i] || '0');
    const tally = await page.locator('#tally-value').innerText();
    if (!tally.includes('3,425')) throw new Error('el total no es 3,425: ' + tally);
    await page.click('#btn-submit-count');
  });
  await step('revelar la diferencia', async () => {
    await page.waitForTimeout(200);
    const v = await page.locator('.block--var .block-value').innerText();
    if (!v.includes('5.00')) throw new Error('la diferencia no es $5.00: ' + v);
    if (await page.locator('#dlg-count').evaluate((d) => d.open))
      throw new Error('el diálogo siguió abierto');
  });
  await step('motivo + PIN', async () => {
    await page.click('[data-act="cta"]');
    await page.locator('#dlg-var-body .reason').nth(1).click();
    await page.click('#btn-submit-variance');
    await page.waitForTimeout(150);
    if (!(await page.locator('#dlg-pin').evaluate((d) => d.open)))
      throw new Error('no pidió PIN de gerente');
    await page.fill('#pin-input', '1234');
    await page.click('#btn-submit-pin');
    await page.waitForTimeout(150);
  });
  await step('conciliar', async () => {
    await page.click('[data-act="cta"]');
    await page.waitForTimeout(150);
    const txt = await page.locator('[data-act="cta"]').innerText();
    if (!/Cerrar/.test(txt))
      throw new Error('la acción principal no es cerrar: ' + txt.replace(/\n/g, ' '));
  });
  await step('cerrar sin PIN (la diferencia no supera el umbral)', async () => {
    await page.click('[data-act="cta"]');
    await page.waitForTimeout(700);
    if (await page.locator('#dlg-pin').evaluate((d) => d.open))
      throw new Error('pidió PIN cuando no debía');
    const status = await page.locator('#shift-state-text').innerText();
    if (!/cerrado/i.test(status)) throw new Error('el turno no quedó cerrado: ' + status);
    if (await page.locator('#dlg-print').evaluate((d) => d.open))
      await page.keyboard.press('Escape');
  });
  await step('crear el depósito', async () => {
    await page.click('[data-act="cta"]');
    await page.waitForTimeout(150);
    if (!(await page.locator('#dlg-deposit').evaluate((d) => d.open)))
      throw new Error('el diálogo de depósito no abrió');
    await page.click('#btn-submit-deposit');
    await page.waitForTimeout(200);
    const ok = await page.locator('.pill--ok').count();
    if (!ok) throw new Error('no apareció el depósito creado');
  });
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, 'flow-closed.png') });
  if (errors.length) add('error', 'flow', errors.slice(0, 2).join(' | '));

  /* cancel-count guard */
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await step('cancelar el conteo vuelve a abierto', async () => {
    await page.click('[data-act="cancel-count"]');
    await page.waitForTimeout(200);
    const count = await page.locator('.block--var .block-value').innerText();
    if (count.trim() !== '—') throw new Error('el conteo no se limpió: ' + count);
  });
  await page.close();
}

await browser.close();

const errors = findings.filter((f) => f.level === 'error');
const warns = findings.filter((f) => f.level === 'warn');
console.log('\nCentro de caja · self-check');
console.log('='.repeat(60));
if (!findings.length) console.log('Sin hallazgos.');
for (const f of findings) console.log(`${f.level === 'error' ? '✗' : '!'} [${f.area}] ${f.detail}`);
console.log('-'.repeat(60));
console.log(`${errors.length} errores · ${warns.length} avisos`);
process.exitCode = errors.length ? 1 : 0;
