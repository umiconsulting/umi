#!/usr/bin/env node
/**
 * Press every safe control on every POS surface and say what happened.
 *
 * The dashboard has had this since `click-audit.mjs`: one command presses what a person can press
 * and records the result. The till had journeys (seven of them, in `pos-native-flows.mjs`) and an
 * inventory (`pos-native-surfaces.mjs`), but nothing that presses the controls an inventory
 * merely measures. This is that pass.
 *
 * WHAT IT DOES NOT PRESS, AND WHY. The till moves money and closes shifts. A pass that fires
 * courses, charges, or closes a till would be measuring a café, not a build, and the state it
 * wrecked would poison the screens that follow. So every control is classified first, from its
 * own words, into *safe* (navigation, filters, tabs, rows, zoom, detail) and *committing*
 * (money, shift, destructive verbs). Committing controls are listed in the report with the
 * reason, never pressed. On a disposable database the money path is covered by the journeys,
 * which is where it belongs.
 *
 * THE WEAKEST HONEST EXPECTATION. A journey names what a tap should produce. An audit cannot; it
 * presses to find out. The assertion is that the screen must not stay put — a swallowed press
 * leaves the tree identical, and `expect: { screenChanges: true }` catches exactly that.
 *
 * Usage:
 *   node tools/ux-sweep/pos-native-click-pass.mjs --vm <url> --limit 6 \
 *     --out /tmp/ux/pos-click-pass.json --md /tmp/ux/pos-click-pass.md \
 *     --shots /tmp/ux/pos-native-shots/clicks
 *
 * Flags: --vm/--log (as the other POS tools), --out/--md/--shots, --limit N per screen
 * (default 6), --no-fail.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createDriver, nameOf, sleep } from './pos-native-driver.mjs';
import { MODES, SURFACES } from './pos-native-surfaces.mjs';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const OUT = arg('--out', '/tmp/ux/pos-click-pass.json');
const MD = arg('--md', null);
const SHOTS = arg('--shots', null);
const LOG = arg('--log', '/tmp/umi-pos-linux.log');
const LIMIT = Number(arg('--limit', '6'));
const NO_FAIL = process.argv.includes('--no-fail');

/**
 * COMMITTING CONTROLS, BY THE WORDS ON THEM. Two families, and both are skipped on purpose:
 * money and shift state (a sale, a tender, a drawer movement, a shift handover) and verbs that
 * destroy work (cancel, void, refund, clear, release). Everything else is pressed.
 */
const COMMITTING = [
  {
    family: 'money',
    why: 'charges, tenders or totals a sale',
    re: /cobrar|pago|efectivo|importe|propina|descuento|terminal|tarjeta|mixto|reanudar venta/i,
  },
  {
    family: 'shift',
    why: 'moves shift or drawer state',
    re: /turno|cajón|cajon|retiro|entrada de efectivo|salida de efectivo|contar|arqueo|fondo/i,
  },
  {
    family: 'destructive',
    why: 'destroys work in progress',
    re: /anular|cancelar|eliminar|borrar todo|vaciar|deshacer|reembols|devoluci|liberar|terminar|recuperar|empezar|imprimir|ajustar/i,
  },
];

function classify(name) {
  for (const entry of COMMITTING) {
    if (entry.re.test(name)) return { press: false, family: entry.family, why: entry.why };
  }
  return { press: true, family: null, why: null };
}

async function resolveVm() {
  const explicit = arg('--vm');
  if (explicit) return explicit.endsWith('/') ? explicit : `${explicit}/`;
  const log = await readFile(LOG, 'utf8').catch(() => '');
  const matches = log.match(/http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_=-]+\//g);
  if (!matches?.length) throw new Error(`No Dart VM service URL in ${LOG}; pass --vm.`);
  return matches[matches.length - 1];
}

/** Every pressable node right now, in the engine's traversal order. */
async function pressable(driver) {
  const nodes = await driver.nodes();
  return nodes
    .filter((node) => driver.isVisible(node) && (node.actions || []).includes('tap'))
    .map((node) => ({
      name: String(nameOf(node) || '').trim(),
      width: Math.round(node.absolute?.width ?? 0),
      height: Math.round(node.absolute?.height ?? 0),
      y: Math.round(node.absolute?.top ?? NaN),
    }))
    .filter((node) => node.name);
}

/**
 * Any exception the app printed between two offsets of its own log.
 *
 * The POS has no browser console; `flutter run` writes Dart errors to its log, and an unhandled
 * exception during a click is a defect the report must contain. Reading the delta keeps the pass
 * from blaming a click for an error an earlier action produced.
 */
async function logErrorsSince(offset) {
  const text = await readFile(LOG, 'utf8').catch(() => '');
  if (text.length <= offset) return { offset: text.length, errors: [] };
  const fresh = text.slice(offset);
  const errors = fresh
    .split('\n')
    .filter((line) => /EXCEPTION CAUGHT|Unhandled exception|^Error:|E\/flutter/.test(line))
    .slice(0, 4);
  return { offset: text.length, errors };
}

async function main() {
  const vm = await resolveVm();
  const driver = await createDriver({
    vm,
    log: LOG,
    shots: SHOTS,
    display: process.env.UX_DISPLAY || ':0',
  });
  await driver.waitReady({ timeout: 30_000 });
  if (SHOTS) await mkdir(SHOTS, { recursive: true });

  /**
   * PUT THE SCREEN BACK, SO THE NEXT PRESS IS NOT AIMED AT A MENU.
   *
   * A press that opens an overlay (the "Más" menu, a detail sheet, the keyboard) leaves it
   * covering the rail: the first run of this pass lost nine of eleven screens to exactly that,
   * each reported as "not reached" because the nav item it clicked was behind an open menu.
   * `Escape` closes them — measured, not assumed: with the account menu open the tree lists the
   * menu's items, and after one Escape it lists the catalog again.
   */
  const dismissOverlay = async () => {
    await driver.pressKey('Escape').catch(() => {});
    await sleep(300);
    await driver.waitSettled({ stable: 3, interval: 250, timeout: 4000 }).catch(() => {});
  };

  const reach = async (target) => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const before = await driver.fingerprintOf(await driver.nodes());
      try {
        await driver.clickText(target, {
          expect: { appears: 'Ajustes', timeout: 8000 },
          attempts: 1,
        });
        await driver.waitSettled({ stable: 5, interval: 300, timeout: 12000 }).catch(() => {});
        await sleep(500);
        if (before !== (await driver.fingerprintOf(await driver.nodes()))) return true;
      } catch {
        // Fall through to the dismissal: an overlay left by the press before this one is what
        // stopped the click, and nothing else will move until it is closed.
      }
      await dismissOverlay();
    }
    return false;
  };

  const report = {
    generatedAt: new Date().toISOString(),
    vm,
    limitPerScreen: LIMIT,
    screens: [],
  };

  const SCREENS = SURFACES.flatMap((surface) => [
    { surface, mode: null },
    ...(MODES[surface] ?? []).map((mode) => ({ surface, mode })),
  ]);

  for (const { surface, mode } of SCREENS) {
    const title = mode ? `${surface} → ${mode}` : surface;
    const reached = await reach(surface);
    if (!reached) {
      process.stderr.write(`${title.padEnd(28)} · NOT REACHED\n`);
      report.screens.push({ title, surface, mode, reached: false, clicks: [], skipped: [] });
      continue;
    }
    if (mode) await reach(mode);

    const seen = new Set();
    const controls = [];
    for (const node of await pressable(driver)) {
      if (seen.has(node.name)) continue;
      seen.add(node.name);
      // The rail is how this pass reaches a screen, so pressing it again here would spend the
      // budget on navigation the reach step already exercised. Skip it and press the screen's
      // own controls, which is the point of the pass.
      if (SURFACES.includes(node.name)) continue;
      controls.push({ ...node, verdict: classify(node.name) });
    }
    const toPress = controls.filter((c) => c.verdict.press).slice(0, LIMIT);
    const skipped = controls.filter((c) => !c.verdict.press);

    const clicks = [];
    for (const control of toPress) {
      // FRESH STATE FOR EVERY CLICK. The screen is re-opened before each press so no click is
      // judged from a state a previous click created, which is the same rule the dashboard's
      // click audit follows.
      await reach(surface);
      if (mode) await reach(mode);
      const before = await logErrorsSince(0);
      let result = 'ok';
      let note = null;
      try {
        await driver.clickText(control.name, {
          expect: { screenChanges: true, timeout: 6000 },
          attempts: 1,
        });
      } catch (error) {
        result = error.clickVerdict === 'inert' ? 'no-effect' : 'failed';
        note = error.message.split('\n')[0].slice(0, 200);
      }
      const after = await logErrorsSince(before.offset);
      clicks.push({
        name: control.name,
        width: control.width,
        height: control.height,
        result,
        note,
        appErrors: after.errors,
      });
      // Leave the screen as the press found it, or the next press is aimed at whatever this one
      // opened.
      await dismissOverlay();
    }

    const shot = SHOTS
      ? await driver.shot(`clicks-${surface}${mode ? `-${mode}` : ''}`).catch(() => null)
      : null;
    const screen = { title, surface, mode, reached: true, clicks, skipped, screenshot: shot };
    report.screens.push(screen);
    const bad = clicks.filter((c) => c.result !== 'ok').length;
    process.stderr.write(
      `${title.padEnd(28)} · ${clicks.length} pressed · ${bad} without an effect · ` +
        `${skipped.length} committing, not pressed\n`,
    );
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));

  const allClicks = report.screens.flatMap((s) => s.clicks);
  const noEffect = allClicks.filter((c) => c.result !== 'ok');
  const appErrors = allClicks.filter((c) => c.appErrors.length > 0);
  if (MD) {
    const lines = [
      '# POS click pass, native build',
      '',
      `Generated: ${report.generatedAt}`,
      `Limit per screen: ${LIMIT} · pressed ${allClicks.length} controls`,
      '',
      '| Screen | Pressed | Without an effect | Committing (skipped) |',
      '| --- | --- | --- | --- |',
      ...report.screens.map(
        (s) =>
          `| ${s.title} | ${s.clicks.length} | ${s.clicks.filter((c) => c.result !== 'ok').length} | ` +
          `${(s.skipped || []).length} |`,
      ),
      '',
      '## Presses with no visible effect',
      '',
    ];
    if (noEffect.length === 0) lines.push('None.');
    for (const c of noEffect) lines.push(`- \`${c.name}\` — ${c.note}`);
    lines.push('', '## App exceptions during a press', '');
    if (appErrors.length === 0) lines.push('None.');
    for (const c of appErrors) lines.push(`- \`${c.name}\` — ${c.appErrors.join(' | ')}`);
    lines.push('', '## Not pressed (by design)', '');
    const reasons = new Map();
    for (const screen of report.screens) {
      for (const s of screen.skipped || []) {
        const key = `${s.verdict.family}: ${s.verdict.why}`;
        reasons.set(key, [...(reasons.get(key) ?? []), s.name]);
      }
    }
    for (const [reason, names] of reasons) lines.push(`- **${reason}** — ${names.join(', ')}`);
    lines.push('');
    await writeFile(MD, lines.join('\n'));
  }

  process.stderr.write(
    `\nwrote ${OUT}${MD ? ` and ${MD}` : ''} · ${allClicks.length} pressed · ` +
      `${noEffect.length} without an effect · ${appErrors.length} with an app exception\n`,
  );
  if (!NO_FAIL && appErrors.length > 0) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
