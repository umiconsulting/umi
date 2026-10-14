#!/usr/bin/env node
/**
 * Every actionable node on every POS surface, with its size and its label.
 *
 * Plan §7 Step F2's acceptance line is exactly that sentence. The two harnesses that exist do
 * not answer it: `pos-semantics-inventory.mjs` reads ONE surface (a desktop accessibility tree
 * only ever contains what is on screen), and `pos-surfaces.mjs` drives the Flutter **web**
 * build, which `docs/architecture/2026-09-16-pos-is-a-native-app.md` retired as a client. The
 * surfaces have to be walked on the native build, by clicking the navigation the operator uses
 * and reading the tree that is on screen after each click.
 *
 * It applies the same floor the dashboard inventory applies — `--control-min` is 44px (plan
 * §5.2) — so a control narrower or shorter than 44, or an actionable node with no name, is a
 * finding, printed by surface and counted.
 *
 * Usage:
 *   node tools/ux-sweep/pos-native-surfaces.mjs \
 *     --out /tmp/ux/pos-native-surfaces.json --md /tmp/ux/pos-native-surfaces.md \
 *     --shots /tmp/ux/pos-native-shots/surfaces
 *   node tools/ux-sweep/pos-native-surfaces.mjs --no-fail     # report without a verdict
 *
 * The app must be running and signed in. `pos-native-flows.mjs` leaves it that way; the launcher
 * alone leaves it on the PIN pad, where the only surface is the pad.
 *
 * Flags:
 *   --vm <url>        Dart VM service URL (default: read from --log, as the other tools do).
 *   --log <path>      The launcher's log (default /tmp/umi-pos-linux.log).
 *   --out/--md        Report paths.
 *   --shots <dir>     One screenshot per surface.
 *   --no-fail         Always exit 0.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriver, nameOf, sleep } from './pos-native-driver.mjs';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const OUT = arg('--out', '/tmp/ux/pos-native-surfaces.json');
const MD = arg('--md', null);
const SHOTS = arg('--shots', null);
const LOG = arg('--log', '/tmp/umi-pos-linux.log');
const NO_FAIL = process.argv.includes('--no-fail');

/**
 * The navigation the operator sees, top to bottom of the rail. The label is the accessible name
 * the rail publishes, so the click goes through the same control a person presses.
 */
const SURFACES = ['Comanda', 'Caja', 'Ventas', 'Mesas', 'Cocina', 'Pedidos', 'Ajustes'];

/**
 * THE INNER MODES OF A SURFACE, BY THE LABEL THE OPERATOR PRESSES.
 *
 * A surface is not one screen. The kitchen board has two tabs (the queue and what is being
 * prepared), the sales list has three (all, suspended, cancelled), and the room has a plan and a
 * list. Each is a different arrangement of controls, and the first pass of this walk inventoried
 * only whichever one happened to be open. The default mode of each surface is the one reached by
 * the navigation click; everything here is an ADDITIONAL mode, walked after it.
 */
const MODES = {
  Ventas: ['Ventas suspendidas', 'Ventas canceladas'],
  Mesas: ['Ver lista'],
  Cocina: ['Preparación'],
};

/** The pointer-target floor every control shares (plan §5.2, `--control-min`). */
const MIN_TARGET = 44;

async function resolveVm() {
  const explicit = arg('--vm');
  if (explicit) return explicit.endsWith('/') ? explicit : `${explicit}/`;
  const log = await readFile(LOG, 'utf8').catch(() => '');
  const matches = log.match(/http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_=-]+\//g);
  if (!matches?.length) throw new Error(`No Dart VM service URL in ${LOG}; pass --vm.`);
  return matches[matches.length - 1];
}

/** The actionable nodes on the screen right now, in the engine's traversal order. */
async function actionable(driver) {
  const nodes = await driver.nodes();
  return nodes
    .filter((node) => driver.isVisible(node) && (node.actions || []).length > 0)
    .map((node) => ({
      name: nameOf(node),
      value: node.value ?? '',
      actions: node.actions,
      // A node the operator PRESSES, as opposed to a scrollable viewport. Flutter publishes
      // `scrollToOffset`/`scrollUp` on every scrollable area, and those are not controls: they
      // need no accessible name and have no target to size. Counting them as unnamed controls
      // reported six "findings" on the first run that were five scroll containers and one card.
      pressable: (node.actions || []).includes('tap'),
      // The live node is deliberately NOT carried into the report: it holds a `parent` chain,
      // so keeping it made `JSON.stringify` throw "Converting circular structure to JSON" and
      // the run died after the console summary but before the report was written.
      width: Math.round(node.absolute?.width ?? NaN),
      height: Math.round(node.absolute?.height ?? NaN),
      // `absolute` is `{left, top, right, bottom, width, height}` — not `x`/`y`. Reading the
      // wrong keys silently made every position NaN on the first run and left the report's
      // header column filled from whatever nodes came first.
      x: Math.round(node.absolute?.left ?? NaN),
      y: Math.round(node.absolute?.top ?? NaN),
    }));
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

  const report = {
    generatedAt: new Date().toISOString(),
    vm,
    window: { width: driver.viewSize.width, height: driver.viewSize.height },
    minTarget: MIN_TARGET,
    surfaces: [],
  };

  /** Press a control and decide whether the screen changed, which is what proves the click. */
  const reach = async (target) => {
    const before = await driver.fingerprintOf(await driver.nodes());
    try {
      // The nav is on every surface, so it cannot be the expectation that proves the click
      // landed. It only proves the control was found and pressed; the fingerprint comparison
      // below is what decides whether the screen actually changed.
      await driver.clickText(target, {
        expect: { appears: 'Ajustes', timeout: 8000 },
        attempts: 1,
      });
      // WAIT FOR THE SURFACE, THEN WAIT AGAIN. The Cocina board published five "Empezar"
      // buttons at 115x34 for about a second while its tickets were still arriving; once the
      // paint landed they measured 115x48, over the floor. A judgement taken inside that window
      // is a defect about the harness, so the reading is taken twice, 700 ms apart, and only the
      // second one is judged — the same discipline the visual baseline applies to a loading
      // frame.
      await driver.waitSettled({ stable: 5, interval: 300, timeout: 12000 }).catch(() => {});
      await actionable(driver);
      await sleep(700);
      const after = await driver.fingerprintOf(await driver.nodes());
      const changed = before !== after;
      return {
        reached: changed,
        note: changed ? null : 'the screen did not change after the click',
      };
    } catch (error) {
      return { reached: false, note: error.message.split('\n')[0] };
    }
  };

  /** Everything on the screen right now, judged. */
  const snapshot = async (label, mode = null) => {
    const nodes = await actionable(driver);
    // JUDGE ONLY WHAT IS WHOLLY ON SCREEN. Flutter publishes a node's box intersected with the
    // clip rect, so the kitchen board's last row — cut by the bottom edge of the window —
    // reports its "Empezar" buttons as 115x34 against 115x48 for the identical buttons one row
    // up. That is a fact about the window, not about the control, and reporting it as an
    // undersized button is how a harness invents a defect. The screen scrolls; a cook presses
    // the whole button.
    const viewport = driver.viewSize;
    const fullyOnScreen = (node) =>
      Number.isFinite(node.x) &&
      Number.isFinite(node.y) &&
      node.x >= 0 &&
      node.y >= 0 &&
      // AN EDGE IS NOT A SIZE. A node whose clipped box ends exactly on the window's edge is
      // the one a scroll viewport is cutting: the kitchen board's last row reports five
      // "Empezar" buttons at 115x34 with `bottom = 1080` while the identical buttons one row
      // up measure 115x48. Inside by a pixel is inside; flush against the edge is cut.
      node.x + node.width < viewport.width - 1 &&
      node.y + node.height < viewport.height - 1;
    const clipped = nodes.filter((node) => node.pressable && !fullyOnScreen(node));
    // The edge rule above is the whole adjudication: a node inside the window with a real rect
    // is measured as it is. (An earlier version also scrolled each candidate into view — but it
    // re-found the node BY NAME, and on the kitchen board the first "Empezar" of that name is a
    // different, fully visible ticket, so a short one would have been quietly replaced by a tall
    // one. A confirmation that can pick the wrong element is worse than no confirmation.)
    const shortAll = nodes.filter(
      (node) =>
        node.pressable &&
        fullyOnScreen(node) &&
        Number.isFinite(node.width) &&
        Number.isFinite(node.height) &&
        node.width > 0 &&
        node.height > 0 &&
        (node.width < MIN_TARGET || node.height < MIN_TARGET),
    );
    // A CONTROL THAT IS SHORT IN ONE PLACE AND TALL IN ANOTHER IS CUT, NOT SMALL.
    //
    // The sales list's third "Reanudar venta" measured 135x8 at the bottom of the inner list
    // while the two above it measured 135x48 — the list's own viewport is what cut it, and the
    // window's bottom edge is 24px further down, so the window-edge rule above cannot see it.
    // The tallest instance of a name on the screen is that control's natural size; anything
    // shorter under the same name is reported as clipped rather than as a defect. The check is
    // deliberately the *same screen*, so a genuinely small control that appears only once still
    // lands in `undersized`.
    const tallest = new Map();
    for (const node of nodes) {
      if (!node.pressable) continue;
      const name = String(node.name || '').trim();
      if (!name) continue;
      tallest.set(name, Math.max(tallest.get(name) ?? 0, node.height));
    }
    const isCut = (node) =>
      node.height < (tallest.get(String(node.name || '').trim()) ?? node.height);
    const clippedByScroll = shortAll.filter(isCut);
    const undersized = shortAll.filter((node) => !isCut(node));
    const unnamed = nodes.filter((node) => node.pressable && !String(node.name || '').trim());
    const header = nodes
      .filter((node) => node.y < 120)
      .map((node) => node.name)
      .filter(Boolean)
      .slice(0, 3);

    const entry = {
      label,
      mode,
      reached: true,
      note: null,
      header,
      actionableCount: nodes.length,
      pressableCount: nodes.filter((node) => node.pressable).length,
      scrollAreas: nodes.filter((node) => !node.pressable).length,
      clippedCount: clipped.length,
      clippedByScrollCount: clippedByScroll.length,
      undersized,
      unnamed,
      unnamedCount: unnamed.length,
      nodes,
    };
    const shot = SHOTS
      ? await driver.shot(`surface-${label}${mode ? `-${mode}` : ''}`).catch(() => null)
      : null;
    if (shot) entry.screenshot = shot;
    process.stderr.write(
      `${(mode ? `${label} → ${mode}` : label).padEnd(28)} · ${nodes.length} actionable · ` +
        `${undersized.length} under ${MIN_TARGET}px · ${unnamed.length} pressable and unnamed` +
        ` · ${clipped.length + clippedByScroll.length} clipped` +
        `\n`,
    );
    return entry;
  };

  for (const label of SURFACES) {
    const surfaceReach = await reach(label);
    const entry = await snapshot(label);
    Object.assign(entry, surfaceReach);
    report.surfaces.push(entry);
    for (const mode of MODES[label] ?? []) {
      const modeReach = await reach(mode);
      const modeEntry = await snapshot(label, mode);
      Object.assign(modeEntry, modeReach);
      report.surfaces.push(modeEntry);
    }
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));

  if (MD) {
    const lines = [
      '# POS surfaces, native build',
      '',
      `Generated: ${report.generatedAt}`,
      `Window: ${report.window.width}x${report.window.height} · floor: ${MIN_TARGET}px`,
      '',
      '| Surface · mode | Reached | Pressable | Under 44px | Unnamed | Header |',
      '| --- | --- | --- | --- | --- | --- |',
      ...report.surfaces.map(
        (s) =>
          `| ${s.mode ? `${s.label} → **${s.mode}**` : s.label} | ${s.reached ? 'yes' : 'no'} | ` +
          `${s.pressableCount} | ` +
          `${s.undersized.length} | ${s.unnamedCount} | ${(s.header || []).join(' · ')} |`,
      ),
      '',
      '## Controls under 44 px',
      '',
    ];
    const small = report.surfaces.flatMap((s) => s.undersized.map((n) => ({ s: s.label, n })));
    if (small.length === 0) lines.push('None.');
    for (const { s, n } of small) {
      lines.push(`- \`${s}\` — **${n.name || '(unnamed)'}** ${n.width}x${n.height}`);
    }
    lines.push(
      '',
      'A control cut by a scroll viewport is not counted here: the rule is the tallest instance of',
      'that control on the same screen, and anything shorter under the same name is reported as',
      `clipped instead (${report.surfaces.reduce((n, s) => n + (s.clippedByScrollCount || 0), 0)} this run).`,
      '',
    );
    lines.push('');
    await writeFile(MD, lines.join('\n'));
  }

  const total = report.surfaces.reduce((sum, s) => sum + s.undersized.length, 0);
  const unreached = report.surfaces.filter((s) => !s.reached);
  process.stderr.write(
    `\nwrote ${OUT}${MD ? ` and ${MD}` : ''} · ${total} control(s) under ${MIN_TARGET}px · ` +
      `${unreached.length} surface(s) not reached\n`,
  );
  if (!NO_FAIL && (total > 0 || unreached.length > 0)) process.exit(1);
}

// Only when run as a command. The surface and mode maps are exported so the click pass
// (`pos-native-click-pass.mjs`) walks exactly the same screens instead of keeping a second copy
// of the list that can drift.
export { SURFACES, MODES, MIN_TARGET };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
}
