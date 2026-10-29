#!/usr/bin/env node
/**
 * Press every safe control on every POS surface, ON THE DEVICE, and say what happened.
 *
 * The desktop till has `pos-native-click-pass.mjs`, and the device has an inventory
 * (`pos-device-inventory.mjs`). Nothing pressed the device's controls. The package in the field is
 * Android, so this pass exists: it reads the Flutter semantics through `uiautomator`, sends a real
 * touch with `input tap`, and records the result.
 *
 * WHAT IT DOES NOT PRESS, AND WHY. The same rule as the desktop pass. The till moves money and
 * closes shifts. A pass that fires courses, charges, or closes a till measures a café, not a
 * build. Every control is classified from its own words into *safe* (navigation, filters, tabs,
 * rows, zoom, detail) and *committing* (money, shift, destructive verbs). Committing controls are
 * listed with the reason and are never pressed.
 *
 * THE WEAKEST HONEST EXPECTATION. An audit cannot name what a tap produces; it presses to find
 * out. The assertion is that the screen must not stay put: a swallowed press leaves both the
 * semantics tree and the pixels identical. Zoom buttons move no label, so the pixel hash is the
 * second witness.
 *
 * Usage:
 *   node tools/ux-sweep/pos-device-click-pass.mjs --serial 192.168.1.10:5555 --pin 1111 \
 *     --out /tmp/ux/imin/clicks.json --md /tmp/ux/imin/clicks.md --shots /tmp/ux/imin/clicks
 *
 * Flags: --serial, --pin, --out/--md/--shots, --limit N per screen (default 6), --no-fail,
 * --screens (comma separated titles to walk, e.g. `Mesas,Mesas → Ver lista`),
 * --package (default `co.umiconsulting.umi_pos.estacion`).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SURFACES, MODES } from './pos-native-surfaces.mjs';

/** The rail is navigation, not a control under test, on every screen and in the restore. */
const RAIL = new Set(SURFACES);

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const NO_FAIL = process.argv.includes('--no-fail');
const PIN = arg('--pin', '');
const OUT = arg('--out', '/tmp/ux/pos-device-click-pass.json');
const MD = arg('--md', null);
const SHOTS = arg('--shots', null);
const LIMIT = Number(arg('--limit', '6'));
const PKG = arg('--package', 'co.umiconsulting.umi_pos.estacion');
const ONLY = (arg('--screens') || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const serial = (() => {
  const explicit = arg('--serial');
  if (explicit) return explicit;
  const list = execFileSync('adb', ['devices'], { encoding: 'utf8' })
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === 'device');
  if (list.length !== 1) throw new Error(`pass --serial: ${list.length} devices are attached.`);
  return list[0][0];
})();

const adb = (...args) =>
  execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8', maxBuffer: 40e6 });
const shell = (...args) => adb('shell', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * COMMITTING CONTROLS, BY THE WORDS ON THEM. Two families, and both are skipped on purpose:
 * money and shift state (a sale, a tender, a drawer movement, a shift handover) and verbs that
 * destroy work.
 */
const COMMITTING = [
  {
    family: 'money',
    why: 'charges, tenders or totals a sale',
    re: /cobrar|pago|efectivo|importe|propina|descuento|terminal|tarjeta|mixto|reanudar venta|dividir/i,
  },
  {
    family: 'shift',
    why: 'moves shift or drawer state',
    re: /turno|caj[óo]n|retiro|entrada de efectivo|salida de efectivo|contar|arqueo|fondo/i,
  },
  {
    family: 'destructive',
    why: 'destroys or commits work in progress',
    re: /anular|cancelar|eliminar|borrar|vaciar|deshacer|reembols|devoluci|liberar|terminar|recuperar|empezar|empezar de nuevo|imprimir|ajustar|enviar|fire/i,
  },
];

function classify(name) {
  for (const entry of COMMITTING) {
    if (entry.re.test(name)) return { press: false, family: entry.family, why: entry.why };
  }
  return { press: true, family: null, why: null };
}

/** Every node on the screen, with its rectangle in device pixels and its raw XML line. */
function nodes() {
  shell('uiautomator dump /sdcard/umi-click.xml');
  const xml = shell('cat /sdcard/umi-click.xml');
  return {
    xml,
    list: [...xml.matchAll(/<node[^>]*>/g)].map((match) => {
      const tag = match[0];
      const text = /text="([^"]*)"/.exec(tag)?.[1] ?? '';
      const desc = /content-desc="([^"]*)"/.exec(tag)?.[1] ?? '';
      const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
      return {
        label: (text || desc).replace(/&#10;/g, ' ').replace(/&amp;/g, '&').trim(),
        clickable: /clickable="true"/.test(tag),
        selected: /selected="true"/.test(tag) || /checked="true"/.test(tag),
        center: bounds
          ? [
              Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
              Math.round((Number(bounds[2]) + Number(bounds[4])) / 2),
            ]
          : null,
      };
    }),
  };
}

/**
 * THE LABEL WITHOUT THE CLOCK ON IT.
 *
 * A table's accessible name carries its elapsed time ("Mesa 1, 2 lugares, Ocupada, 2 personas,
 * Tiempo 29:42 h"). The timer moves while the pass runs, so the label the pass read and the label
 * it looks for a moment later differ, and the press is reported as "gone" — a defect in the
 * instrument, not in the till. Two labels that differ only in their timers are the same control.
 */
function labelKey(label) {
  return label.replace(/tiempo\s+\d{1,2}:\d{2}(:\d{2})?\s*h/gi, 'tiempo T h').trim();
}

/** The same control, found by its label or, if the label moved, by where it was. */
function findControl(list, control) {
  const key = labelKey(control.name);
  const exact = list.find((n) => labelKey(n.label) === key && n.center);
  if (exact) return exact;
  return (
    list.find(
      (n) =>
        n.center &&
        n.label &&
        (n.label.startsWith(key.slice(0, 24)) || key.startsWith(n.label.slice(0, 24))),
    ) ?? null
  );
}

/**
 * The state of the screen, in one string. The clock and the elapsed table timers tick on their
 * own, so they are removed first: without that, every press "changes the screen".
 */
function fingerprint(xml) {
  const stable = xml.replace(/\d{1,2}:\d{2}(:\d{2})?/g, 'T').replace(/T\s*h/g, 'T h');
  return createHash('sha1').update(stable).digest('hex');
}

function pixels() {
  const png = execFileSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], {
    maxBuffer: 40e6,
  });
  return { hash: createHash('sha1').update(png).digest('hex'), png };
}

async function tap(center) {
  shell('input', 'tap', String(center[0]), String(center[1]));
  await sleep(900);
}

async function back() {
  shell('input', 'keyevent', '4');
  await sleep(700);
}

/**
 * IS THE APP PUBLISHING A TREE AT ALL?
 *
 * Flutter builds its accessibility tree only while the platform asks for it, and this device
 * stops asking: `uiautomator dump` then returns a valid root with no labelled children while the
 * screen renders perfectly. A pass that trusts that tree reports its own blindness as a product
 * defect — the first version of this tool called five controls "gone" that were on the screen.
 *
 * The engine cannot be asked twice: the APK is AOT, so `evaluate` over the VM service is refused
 * (`Debugger is disabled in AOT mode`). A fresh process publishes a readable tree on the first
 * read, so a blind pass restarts the app and signs in again.
 */
async function signIn() {
  // The counter is "0 dígitos, PIN de operador". The help line above it also says "dígitos"
  // ("Usa de 4 a 8 dígitos"), so the label is matched from its start and nowhere else.
  const readCount = () => {
    const label = nodes().list.find((n) => /^\d+\s*d[íi]gitos/.test(n.label))?.label ?? '';
    return Number((/^(\d+)\s*d[íi]gitos/.exec(label) ?? [])[1] ?? -1);
  };
  if (readCount() === -1)
    return { skipped: 'no PIN field on screen; the till is already signed in' };
  if (readCount() !== 0) await tapLabel('Borrar todo').catch(() => null);
  for (const digit of PIN.split('')) await tapLabel(digit);
  const after = nodes().list.find((n) => /^\d+\s*d[íi]gitos/.test(n.label))?.label ?? '';
  const got = Number((/^(\d+)\s*d[íi]gitos/.exec(after) ?? [])[1] ?? -1);
  if (got !== PIN.length) return { landed: false, after };
  await tapLabel('Continuar').catch(() => null);
  await sleep(4500);
  return { landed: true };
}

async function treeIsReadable(attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (nodes().list.some((n) => n.label)) return true;
    await sleep(700);
  }
  return false;
}

async function ensureTree() {
  if (await treeIsReadable()) return true;
  process.stderr.write(
    'the app published no labels; restarting it, because a blind pass is not a measurement\n',
  );
  shell('am', 'force-stop', PKG);
  await sleep(1500);
  shell('monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
  await sleep(9000);
  if (PIN) await signIn();
  return treeIsReadable(6);
}

/** The app's own exceptions since the pass started. */
function appErrors() {
  return shell('logcat', '-d', '-v', 'brief')
    .split('\n')
    .filter((line) => /E\/flutter|Unhandled exception|FATAL EXCEPTION/.test(line))
    .slice(0, 6);
}

function appPid() {
  return shell('pidof', PKG).trim();
}

async function state(xml) {
  const { hash } = pixels();
  return `${fingerprint(xml)}:${hash}`;
}

async function tapLabel(label, { retries = 3 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const node = nodes().list.find((n) => n.label === label && n.center);
    if (!node) {
      if (attempt === retries) throw new Error(`no tappable node labelled "${label}"`);
      await sleep(500);
      continue;
    }
    await tap(node.center);
    return node;
  }
  return null;
}

/**
 * Put the screen back, so the next press is not aimed at a menu left by the one before.
 *
 * The rail is the witness. A sheet, a dialog or the keyboard covers it, and then the rail labels
 * leave the tree. `BACK` closes those and does nothing else. Pressing `BACK` on a plain screen
 * would send the task to the background, so the rail test decides.
 */
async function dismissOverlay() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // WHOSE SCREEN IS THIS? A `BACK` on a screen with no overlay sends the app to the launcher,
    // and then the next `BACK` presses walk the home screen — the first version of this pass did
    // exactly that, because the rail test alone cannot tell an overlay from a different app.
    const focus =
      shell('dumpsys', 'window', 'displays')
        .split('\n')
        .findLast(
          (line) => line.includes('mCurrentFocus') && !line.includes('mCurrentFocus=null'),
        ) ?? '';
    if (!focus.includes(PKG)) {
      shell('monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
      await sleep(6000);
      return;
    }
    const labels = new Set(nodes().list.map((n) => n.label));
    if (labels.has('Comanda') && labels.has('Ajustes')) return;
    await back();
  }
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    serial,
    package: PKG,
    limitPerScreen: LIMIT,
    screens: [],
    appExceptions: [],
  };
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  shell('logcat', '-c');

  if (PIN) report.signIn = await signIn();

  const ALL_SCREENS = SURFACES.flatMap((surface) => [
    { surface, mode: null },
    ...(MODES[surface] ?? []).map((mode) => ({ surface, mode })),
  ]);
  const SCREENS = ONLY.length
    ? ALL_SCREENS.filter((screen) =>
        ONLY.some(
          (name) => name === screen.surface || name === `${screen.surface} → ${screen.mode}`,
        ),
      )
    : ALL_SCREENS;

  for (const { surface, mode } of SCREENS) {
    const title = mode ? `${surface} → ${mode}` : surface;
    const entry = { title, surface, mode, reached: false, clicks: [], skipped: [] };
    if (!(await ensureTree())) {
      entry.note = 'tree unreadable: the app published no labels even after a restart';
      process.stderr.write(`${title.padEnd(26)} · TREE UNREADABLE\n`);
      report.screens.push(entry);
      continue;
    }
    for (let attempt = 1; attempt <= 2 && !entry.reached; attempt += 1) {
      try {
        await tapLabel(surface);
        await sleep(1200);
        entry.reached = true;
      } catch {
        await dismissOverlay();
      }
    }
    if (!entry.reached) {
      process.stderr.write(`${title.padEnd(26)} · NOT REACHED\n`);
      report.screens.push(entry);
      continue;
    }
    if (mode) await tapLabel(mode).catch(() => null);
    await sleep(900);

    const seen = new Set();
    const controls = [];
    // Labels repeat on this device — Ajustes carries three controls called `Seguir al sistema`.
    // Which one is meant is its position among the nodes that share the label, and that position
    // is what the restore needs to press the same control again.
    const occurrences = new Map();
    for (const node of nodes().list) {
      if (!node.clickable || !node.center || !node.label) continue;
      // A control is a label AT A POSITION. Three controls on this screen are called `Seguir al
      // sistema`, and pressing one is not pressing the others, so the label alone is not an
      // identity — the first version of this pass deduplicated by label and only ever pressed the
      // first of the three.
      const identity = `${node.label}@${node.center.join(',')}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      // The rail is how this pass reaches a screen. Pressing it here would spend the budget on
      // navigation the reach step already exercised.
      if (RAIL.has(node.label)) continue;
      const nth = occurrences.get(node.label) ?? 0;
      occurrences.set(node.label, nth + 1);
      controls.push({
        name: node.label,
        nth,
        center: node.center,
        selected: node.selected,
        verdict: classify(node.label),
      });
    }
    // WHAT THE SCREEN LOOKED LIKE BEFORE THE PASS TOUCHED IT. Ajustes keeps its preferences on
    // the terminal itself, so pressing `Oscura` and `Muy grande` leaves the till dark and huge for
    // the next person — the same reason the desktop room flow puts the tables back. These labels
    // are the state to restore when the walk ends.
    entry.initiallySelected = controls
      .filter((c) => c.selected)
      .map((c) => ({ name: c.name, nth: c.nth }));
    entry.skipped = controls
      .filter((c) => !c.verdict.press)
      .map((c) => ({ name: c.name, family: c.verdict.family, why: c.verdict.why }));

    const toPress = controls.filter((c) => c.verdict.press).slice(0, LIMIT);
    for (const control of toPress) {
      // Return to the screen before each press: the pass must never aim a control at a menu.
      await dismissOverlay();
      await tapLabel(surface).catch(() => null);
      await sleep(800);
      if (mode) await tapLabel(mode).catch(() => null);
      const before = nodes();
      const beforeState = await state(before.xml);
      let node = findControl(before.list, control);
      if (!node) {
        // Either the control really left the screen, or the app stopped publishing. Ask the
        // cheaper question first: a readable tree that still lacks the control means the press
        // before this one moved the screen.
        await treeIsReadable(2);
        node = findControl(nodes().list, control);
      }
      if (!node) {
        entry.clicks.push({
          control: control.name,
          outcome: (await treeIsReadable(1)) ? 'gone' : 'unreadable',
          changed: false,
        });
        continue;
      }
      const pidBefore = appPid();
      await tap(node.center);
      await sleep(900);
      const after = nodes();
      const afterState = await state(after.xml);
      const pidAfter = appPid();
      const outcome = !pidAfter ? 'crashed' : pidAfter !== pidBefore ? 'restarted' : 'ok';
      entry.clicks.push({
        control: control.name,
        outcome,
        changed: beforeState !== afterState,
        // A tab that is already the active one cannot change the screen. Its own state says so,
        // and the report must not read that as a dead press.
        alreadyActive: node.selected,
        errors: outcome === 'ok' ? appErrors() : [],
      });
      if (SHOTS && entry.clicks.length <= 2) {
        const file = join(
          SHOTS,
          `${surface.toLowerCase()}-${(mode ?? 'base').toLowerCase().replace(/\W+/g, '-')}-${entry.clicks.length}.png`,
        );
        await writeFile(file, pixels().png);
      }
      if (outcome !== 'ok') {
        process.stderr.write(`${title} · ${control.name} · ${outcome.toUpperCase()}\n`);
        break;
      }
    }
    const swallowed = entry.clicks.filter(
      (c) => c.outcome === 'ok' && !c.changed && !c.alreadyActive,
    );
    process.stderr.write(
      `${title.padEnd(26)} · ${entry.reached ? 'reached' : 'NOT REACHED'} · ` +
        `${entry.clicks.length} pressed · ${swallowed.length} swallowed · ` +
        `${entry.skipped.length} committing\n`,
    );
    report.screens.push(entry);
    await dismissOverlay();
    await sleep(400);
  }

  report.appExceptions = appErrors();

  /**
   * PUT THE TERMINAL BACK THE WAY THE PASS FOUND IT. Only the screens that had a selected control
   * need a visit, which in practice is Ajustes: theme, text size, language and motion are stored
   * on the device, not in the database, so nothing else puts them back.
   */
  report.restore = { attempted: [], failed: [] };
  for (const entry of report.screens.filter((s) => s.initiallySelected?.length)) {
    if (!(await ensureTree())) {
      report.restore.failed.push(`${entry.title}: the screen could not be reached`);
      continue;
    }
    await tapLabel(entry.surface).catch(() => null);
    await sleep(900);
    if (entry.mode) await tapLabel(entry.mode).catch(() => null);
    for (const control of entry.initiallySelected) {
      const key = labelKey(control.name);
      const candidates = nodes().list.filter(
        (n) => n.clickable && n.center && labelKey(n.label) === key && !RAIL.has(n.label),
      );
      const node = candidates[control.nth] ?? candidates[0];
      if (!node) {
        report.restore.failed.push(`${entry.title}: ${control.name}`);
        continue;
      }
      await tap(node.center);
      await sleep(700);
      report.restore.attempted.push(`${entry.title}: ${control.name}`);
    }
  }
  if (report.restore.attempted.length) {
    process.stderr.write(
      `restored ${report.restore.attempted.length} preference(s)` +
        `${report.restore.failed.length ? `, ${report.restore.failed.length} failed` : ''}\n`,
    );
  }

  await mkdir(join(OUT, '..'), { recursive: true }).catch(() => {});
  await writeFile(OUT, JSON.stringify(report, null, 2));

  const pressed = report.screens.reduce((sum, s) => sum + s.clicks.length, 0);
  const swallowed = report.screens.reduce(
    (sum, s) =>
      sum + s.clicks.filter((c) => c.outcome === 'ok' && !c.changed && !c.alreadyActive).length,
    0,
  );
  // A press that "broke" the app is one that killed or restarted it. A control that was no longer
  // where the pass aimed is a different fact: usually the press before it moved the screen, and
  // sometimes the app stopped publishing — neither is the till's fault.
  const broken = report.screens.reduce(
    (sum, s) =>
      sum + s.clicks.filter((c) => c.outcome === 'crashed' || c.outcome === 'restarted').length,
    0,
  );
  const left = report.screens.reduce(
    (sum, s) =>
      sum + s.clicks.filter((c) => c.outcome === 'gone' || c.outcome === 'unreadable').length,
    0,
  );

  if (MD) {
    const lines = [
      '# POS device click pass',
      '',
      `Generated: ${report.generatedAt} · device ${serial} · package ${PKG}`,
      '',
      `Presses: ${pressed} · swallowed (screen and pixels did not move): ${swallowed} · ` +
        `broke the app: ${broken} · the control was no longer where it was aimed: ${left}`,
      '',
      '| Screen | Reached | Pressed | Swallowed | Committing (not pressed) |',
      '| --- | --- | --- | --- | --- |',
      ...report.screens.map((s) => {
        const sw = s.clicks.filter(
          (c) => c.outcome === 'ok' && !c.changed && !c.alreadyActive,
        ).length;
        return `| ${s.title} | ${s.reached ? 'yes' : '**no**'} | ${s.clicks.length} | ${sw} | ${s.skipped.length} |`;
      }),
      '',
      '## Presses that did nothing',
      '',
    ];
    const dead = report.screens.flatMap((s) =>
      s.clicks
        .filter((c) => c.outcome === 'ok' && !c.changed && !c.alreadyActive)
        .map((c) => ({ screen: s.title, control: c.control })),
    );
    if (!dead.length) lines.push('None.');
    for (const item of dead) lines.push(`- \`${item.screen}\` — **${item.control}**`);
    lines.push('', '## Presses that broke the app', '');
    const broke = report.screens.flatMap((s) =>
      s.clicks
        .filter((c) => c.outcome === 'crashed' || c.outcome === 'restarted')
        .map((c) => ({ screen: s.title, control: c.control, outcome: c.outcome })),
    );
    if (!broke.length) lines.push('None.');
    for (const item of broke)
      lines.push(`- \`${item.screen}\` — **${item.control}** — ${item.outcome}`);
    lines.push('', '## Controls that had left the screen when the press was aimed', '');
    const moved = report.screens.flatMap((s) =>
      s.clicks
        .filter((c) => c.outcome === 'gone' || c.outcome === 'unreadable')
        .map((c) => ({ screen: s.title, control: c.control, outcome: c.outcome })),
    );
    if (!moved.length) lines.push('None.');
    for (const item of moved)
      lines.push(`- \`${item.screen}\` — **${item.control}** — ${item.outcome}`);
    lines.push('', '## App exceptions during the pass', '');
    lines.push(
      ...(report.appExceptions.length ? report.appExceptions.map((l) => `- \`${l}\``) : ['None.']),
    );
    lines.push('', '## Terminal preferences put back', '');
    lines.push(
      ...(report.restore.attempted.length
        ? report.restore.attempted.map((l) => `- ${l}`)
        : ['Nothing on the terminal was left changed by a press.']),
    );
    if (report.restore.failed.length) {
      lines.push('', 'These could not be put back:', '');
      lines.push(...report.restore.failed.map((l) => `- ${l}`));
    }
    lines.push('');
    await writeFile(MD, lines.join('\n'));
  }

  process.stderr.write(
    `\nwrote ${OUT}${MD ? ` and ${MD}` : ''} · ${pressed} pressed · ${swallowed} swallowed · ` +
      `${broken} broke · ${left} had left the screen\n`,
  );
  if (!NO_FAIL && (broken > 0 || report.screens.some((s) => !s.reached))) process.exitCode = 1;
}

await main();
