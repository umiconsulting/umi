#!/usr/bin/env node
/**
 * The POS surface inventory, measured on the DEVICE over ADB.
 *
 * Every other POS instrument drives the Linux desktop build (`pos-native-*.mjs`). The package in
 * the field is Android: an iMin D3-504 counter till, a Galaxy Tab A9+ for the kitchen and a
 * Galaxy Tab A11 as the handheld (`docs/pilot/UMIPOS_SITE_DEVICE_INVENTORY.md` §1). The screen a
 * café actually touches is that one, so the inventory has to be taken there too.
 *
 * HOW IT DRIVES. Flutter publishes its semantics to Android's accessibility layer, so
 * `uiautomator dump` returns the same labels and rectangles the desktop driver reads from the Dart
 * VM service — and `input tap` sends a real touch. The APK in the field is a release build (no VM
 * service), which is why this path exists at all.
 *
 * WHAT IT CHECKS. The same two things the desktop inventory checks: a pressable node smaller than
 * the 44 px floor (`--control-min`, plan §5.2) in either axis, and a pressable node with no
 * accessible name. Screenshots come from `screencap`, so they show the device's own pixels.
 *
 * Usage:
 *   node tools/ux-sweep/pos-device-inventory.mjs --serial 192.168.1.10:5555 --pin 4321 \
 *     --out /tmp/ux/imin/inventory.json --md /tmp/ux/imin/inventory.md --shots /tmp/ux/imin/shots
 *
 * Flags: --serial (required unless one device is attached), --pin, --out/--md/--shots,
 * --surfaces (comma separated, defaults to the rail), --no-fail.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const NO_FAIL = process.argv.includes('--no-fail');
const PIN = arg('--pin', '');
const OUT = arg('--out', '/tmp/ux/pos-device-inventory.json');
const MD = arg('--md', null);
const SHOTS = arg('--shots', null);
/**
 * The pointer floor this walk measures against.
 *
 * The plan's §5.2 names 44, the rubric names 48, and the product's own token is
 * `UmiTouchTarget.minimum = 48.0` (`apps/umi-pos/lib/core/theme/umi_theme.dart`). The flag was
 * documented in this file's header long before it existed, which meant the one number the walk
 * reports could not be pointed at the bar that actually applies. Pass `--control-min 48` to
 * measure the product's own floor; the default stays at the plan's 44 so the earlier reports
 * remain comparable.
 */
const MIN_TARGET = Number(arg('--control-min', '44'));
const SURFACES = (arg('--surfaces') || 'Comanda,Cuentas,KDS,Ventas,Caja,Ajustes').split(',');

const serial = (() => {
  const explicit = arg('--serial');
  if (explicit) return explicit;
  const list = execFileSync('adb', ['devices'], { encoding: 'utf8' })
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === 'device');
  if (list.length !== 1) {
    throw new Error(`pass --serial: ${list.length} devices are attached.`);
  }
  return list[0][0];
})();

const adb = (...args) =>
  execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8', maxBuffer: 40e6 });
const shell = (...args) => adb('shell', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every labelled node on the screen, with its rectangle in device pixels. */
function nodes() {
  shell('uiautomator dump /sdcard/umi-inventory.xml');
  const xml = shell('cat /sdcard/umi-inventory.xml');
  return [...xml.matchAll(/<node[^>]*>/g)].map((match) => {
    const tag = match[0];
    const text = /text="([^"]*)"/.exec(tag)?.[1] ?? '';
    const desc = /content-desc="([^"]*)"/.exec(tag)?.[1] ?? '';
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    const clickable = /clickable="true"/.test(tag);
    return {
      label: (text || desc).replace(/&#10;/g, ' ').trim(),
      clickable,
      x: bounds ? Number(bounds[1]) : null,
      y: bounds ? Number(bounds[2]) : null,
      width: bounds ? Number(bounds[3]) - Number(bounds[1]) : 0,
      height: bounds ? Number(bounds[4]) - Number(bounds[2]) : 0,
      center: bounds
        ? [
            Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
            Math.round((Number(bounds[2]) + Number(bounds[4])) / 2),
          ]
        : null,
    };
  });
}

async function tapLabel(label, { retries = 3, destination = false } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const matches = nodes().filter((n) => n.label === label && n.center);
    // The order sheet trigger also reads "Comanda". Prefer the bottom navigation.
    const node = destination ? matches.sort((a, b) => b.center[1] - a.center[1])[0] : matches[0];
    if (!node) {
      if (attempt === retries) throw new Error(`no tappable node labelled "${label}"`);
      await sleep(500);
      continue;
    }
    shell('input', 'tap', String(node.center[0]), String(node.center[1]));
    await sleep(700);
    return node;
  }
  return null;
}

async function screenshot(file) {
  // BINARY, read as bytes. Going through the text helper (`adb()` decodes UTF-8) corrupts a PNG
  // into something no viewer will open, which is the same class of mistake as a black screenshot:
  // the report names a file and the file is not evidence.
  const png = execFileSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], {
    maxBuffer: 40e6,
  });
  await writeFile(file, png);
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    serial,
    device: {},
    minTarget: MIN_TARGET,
    surfaces: [],
    appExceptions: [],
  };
  const props = ['ro.product.model', 'ro.build.version.release', 'ro.build.version.sdk'];
  for (const prop of props) report.device[prop] = shell('getprop', prop).trim();
  report.device.size = shell('wm', 'size').trim();
  if (SHOTS) await mkdir(SHOTS, { recursive: true });

  // The log is read from the moment the walk starts; a Dart exception during a tap is a defect the
  // report must contain, and the offset keeps an older crash out of it.
  shell('logcat', '-c');
  const logSince = () =>
    shell('logcat', '-d', '-v', 'brief')
      .split('\n')
      .filter((line) =>
        /E\/flutter|Unhandled exception|FATAL EXCEPTION|EXCEPTION CAUGHT/.test(line),
      )
      .slice(0, 6);

  if (PIN) {
    // THE FIELD HAS TO START EMPTY. The till keeps whatever was on it — a previous operator's
    // abandoned digits, or the ones a person left on the screen — and typing four digits into a
    // field that already held one makes five, which signs nobody in and reports "the PIN did not
    // land" about a keyboard that worked perfectly. The keypad publishes `Borrar todo`.
    const readCount = () => {
      const label = nodes().find((n) => /dígitos, PIN/.test(n.label))?.label ?? '';
      return Number((/(\d+)\s*dígitos/.exec(label) ?? [])[1] ?? -1);
    };
    // A TILL THAT IS ALREADY SIGNED IN HAS NO KEYPAD, and that is not a failure: the walk can
    // start where the operator left it. (The first version of this tool threw "no tappable node
    // labelled 1" here, which reads as a broken keypad.)
    if (readCount() === -1) {
      report.signIn = { skipped: 'no PIN field on screen; the till is already signed in' };
    } else {
      if (readCount() !== 0) await tapLabel('Borrar todo').catch(() => null);
      const before = nodes().find((n) => /dígitos, PIN/.test(n.label))?.label ?? '(no PIN field)';
      for (const digit of PIN.split('')) await tapLabel(digit);
      const after = nodes().find((n) => /dígitos, PIN/.test(n.label))?.label ?? '(no PIN field)';
      // The field counts the digits it received, so the count is the evidence that the taps landed.
      const got = Number((/(\d+)\s*dígitos/.exec(after) ?? [])[1] ?? -1);
      report.signIn = { before, after, expectedDigits: PIN.length, landed: got === PIN.length };
      if (report.signIn.landed) {
        await tapLabel('Continuar').catch(() => null);
        await sleep(4000);
        report.signIn.post = nodes()
          .map((n) => n.label)
          .filter((l) => /Comanda|Comer aquí|Nueva venta/.test(l))
          .slice(0, 3);
      }
    }
  }

  for (const surface of SURFACES) {
    const tapped = await tapLabel(surface, { destination: true }).catch((error) => ({
      error: error.message,
    }));
    await sleep(1500);
    const screen = nodes().filter((n) => n.label && n.center);
    const pressable = screen.filter((n) => n.clickable);
    const undersized = pressable.filter((n) => n.width < MIN_TARGET || n.height < MIN_TARGET);
    const unnamed = pressable.filter((n) => !n.label);
    const entry = {
      surface,
      reached: Boolean(tapped && !tapped.error),
      note: tapped?.error ?? null,
      nodes: screen.length,
      pressable: pressable.length,
      undersized,
      unnamed: unnamed.length,
      labels: [...new Set(screen.map((n) => n.label))].slice(0, 20),
    };
    if (SHOTS) {
      entry.screenshot = join(SHOTS, `${surface.toLowerCase()}.png`);
      await screenshot(entry.screenshot);
    }
    report.surfaces.push(entry);
    process.stderr.write(
      `${surface.padEnd(9)} ${entry.reached ? 'reached' : 'NOT REACHED'} · ${entry.pressable} ` +
        `pressable · ${undersized.length} under ${MIN_TARGET}px · ${unnamed.length} unnamed\n`,
    );
  }

  report.appExceptions = logSince();
  await mkdir(join(OUT, '..'), { recursive: true }).catch(() => {});
  await writeFile(OUT, JSON.stringify(report, null, 2));

  if (MD) {
    const lines = [
      '# POS device inventory',
      '',
      `Generated: ${report.generatedAt} · device ${report.device['ro.product.model']} · ` +
        `Android ${report.device['ro.build.version.release']} (SDK ${report.device['ro.build.version.sdk']}) · ` +
        `${report.device.size}`,
      '',
      `Sign-in: ${report.signIn ? (report.signIn.landed ? 'PIN accepted' : 'PIN did NOT land') : 'skipped'}`,
      '',
      `| Surface | Pressable | Under ${MIN_TARGET}px | Unnamed |`,
      '| --- | --- | --- | --- |',
      ...report.surfaces.map(
        (s) => `| ${s.surface} | ${s.pressable} | ${s.undersized.length} | ${s.unnamed} |`,
      ),
      '',
      `## Controls under ${MIN_TARGET} px`,
      '',
    ];
    const small = report.surfaces.flatMap((s) => s.undersized.map((n) => ({ s: s.surface, n })));
    if (small.length === 0) lines.push('None.');
    for (const { s, n } of small) lines.push(`- \`${s}\` — **${n.label}** ${n.width}x${n.height}`);
    lines.push('', '## App exceptions during the walk', '');
    lines.push(
      ...(report.appExceptions.length ? report.appExceptions.map((l) => `- \`${l}\``) : ['None.']),
    );
    lines.push('');
    await writeFile(MD, lines.join('\n'));
  }

  const undersized = report.surfaces.reduce((sum, s) => sum + s.undersized.length, 0);
  const unnamed = report.surfaces.reduce((sum, s) => sum + s.unnamed, 0);
  process.stderr.write(
    `\nwrote ${OUT}${MD ? ` and ${MD}` : ''} · ${undersized} under ${MIN_TARGET}px · ` +
      `${unnamed} unnamed · ${report.appExceptions.length} app exception(s)\n`,
  );
  if (!NO_FAIL && (undersized > 0 || report.appExceptions.length > 0)) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
