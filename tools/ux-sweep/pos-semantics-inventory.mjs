#!/usr/bin/env node
/**
 * Action inventory for the native Flutter POS.
 *
 * The POS is a Flutter desktop app, so there is no DOM to query. Flutter does
 * publish an accessibility tree, and `flutter run` exposes it over the Dart VM
 * service. This script asks the running app for that tree and extracts every
 * actionable node: its label, its rectangle, and its enabled/disabled state.
 *
 * That gives the same audit surface as the Dashboard DOM sweep, and it works on
 * the real Linux build, not a web stand-in.
 *
 * Usage:
 *   node tools/ux-sweep/pos-semantics-inventory.mjs \
 *     --vm http://127.0.0.1:40057/TOKEN/ --out /tmp/ux/pos-semantics.json
 *
 * Find the VM service URL in the `flutter run` output, or read it from a log.
 * When --vm is omitted the script greps /tmp/umi-pos.log for it.
 *
 * This reads one surface at a time, because a desktop accessibility tree only
 * ever contains what is on screen. To walk every POS surface and record the
 * same columns the Dashboard inventory records, use `pos-surfaces.mjs`, which
 * drives the Flutter web build; `patrol` has no Linux platform, so the web
 * build is the only surface with a driver that can navigate.
 *
 * Cross-reference for the `subtouch` column: this harness reports the
 * rectangle the engine publishes, and that rectangle is the node's box
 * intersected with the clip rect covering it, so a row a list viewport cuts in
 * half reads as its visible remainder - a 48x48 step button measured 48x37 on
 * the web build for exactly that reason. `pos-surfaces.mjs` scrolls such a node
 * into view before judging it (`rectBeforeScroll` / `rectAfterScroll` /
 * `judgedWidth`); compare sizes between the two harnesses with that in mind,
 * and prefer its `--self-test` when the question is whether the floor check
 * still catches a genuinely small control.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const OUT = arg('--out', '/tmp/ux/pos-semantics.json');
const LOG = arg('--log', '/tmp/umi-pos.log');

async function resolveVm() {
  const explicit = arg('--vm');
  if (explicit) return explicit.endsWith('/') ? explicit : `${explicit}/`;
  const log = await readFile(LOG, 'utf8');
  const matches = log.match(/http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_=-]+\//g);
  if (!matches?.length) throw new Error(`No Dart VM service URL found in ${LOG}.`);
  return matches[matches.length - 1];
}

async function rpc(base, method, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${base}${method}${query ? `?${query}` : ''}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

/**
 * A printed field puts its value either on the same line or on the lines after it.
 * `debugDumpSemanticsTreeInTraversalOrder` emits both forms:
 *
 *   label: "Plano actualizado: 12:19"     same line
 *   label:                                value follows, and may span lines
 *   "T1, 4
 *   T1"
 *
 * Reading only the same-line form reported every table on the native POS floor plan as
 * unnamed — a false defect about the product, caused by a parser that could not read
 * what the engine printed. This joins the multi-line form into one line first.
 */
function collapseFieldContinuations(text) {
  const lines = text.split('\n');
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opened = lines[index].match(/^(.*?(?:label|tooltip|value):)\s*$/);
    if (!opened) {
      out.push(lines[index]);
      continue;
    }
    const parts = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const closes = /"\s*$/.test(lines[cursor]);
      parts.push(lines[cursor].replace(/^\s*"/, '').replace(/"\s*$/, ''));
      cursor += 1;
      if (closes) break;
    }
    out.push(`${opened[1]} "${parts.join(' | ')}"`);
    index = cursor - 1;
  }
  return out.join('\n');
}

/** Parse the printed semantics tree into nodes with their attributes. */
function parseTree(text) {
  const nodes = [];
  // Strip the box-drawing gutter FIRST: a joined multi-line value would otherwise keep
  // the interior gutter characters inside the name it produces.
  const lines = collapseFieldContinuations(
    text
      .split('\n')
      .map((raw) =>
        raw.replace(/^[\s\u2502\u251c\u2514\u2500\u250c\u2510\u2518\u252c\u2534\u253c]+/, ''),
      )
      .join('\n'),
  ).split('\n');
  let current = null;
  for (const line of lines) {
    // Tree lines carry box-drawing prefixes, so match the node marker anywhere.
    const head = line.match(/SemanticsNode#(\d+)/);
    if (head) {
      if (current) nodes.push(current);
      current = {
        id: Number(head[1]),
        label: '',
        tooltip: '',
        value: '',
        actions: [],
        rect: null,
        flags: [],
      };
      continue;
    }
    if (!current) continue;
    const rect = line.match(/^Rect\.fromLTRB\(([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\)/);
    if (rect) {
      const [l, t, r, b] = rect.slice(1).map(Number);
      current.rect = {
        left: l,
        top: t,
        right: r,
        bottom: b,
        width: Math.round(r - l),
        height: Math.round(b - t),
      };
      continue;
    }
    if (line.startsWith('actions:')) {
      current.actions = line.replace('actions:', '').trim().split(/,\s*/).filter(Boolean);
      continue;
    }
    if (line.startsWith('flags:')) {
      current.flags = line.replace('flags:', '').trim().split(/,\s*/).filter(Boolean);
      continue;
    }
    const labelled = line.match(/^label:\s*"(.*)"?$/);
    if (labelled) current.label = labelled[1].replace(/"$/, '');
    // A Flutter `IconButton` names itself with its TOOLTIP, not a label: the node
    // carries `tooltip: "Actualizar"` and no `label:` line at all. Reading only
    // labels reported the console's icon buttons as unnamed, which is how a
    // measurement of the native POS first showed eight unnamed controls where
    // three of them are named perfectly well.
    const tooltip = line.match(/^tooltip:\s*"(.*)"?$/);
    if (tooltip) current.tooltip = tooltip[1].replace(/"$/, '');
    const valued = line.match(/^value:\s*"(.*)"?$/);
    if (valued) current.value = valued[1].replace(/"$/, '');
  }
  if (current) nodes.push(current);
  return nodes;
}

async function main() {
  const base = await resolveVm();
  const vm = await rpc(base, 'getVM');
  const isolateId = vm.isolates?.[0]?.id;
  if (!isolateId) throw new Error('No isolate on the VM service.');

  const dump = await rpc(base, 'ext.flutter.debugDumpSemanticsTreeInTraversalOrder', { isolateId });
  const nodes = parseTree(dump.data || '');

  const actionable = nodes.filter((n) =>
    n.actions.some((a) => /tap|longPress|focus|scroll/.test(a)),
  );

  // What is a CONTROL, and what is measuring noise.
  //
  // Two kinds of node were being counted as broken controls on the native till
  // and are neither:
  //
  //  * the scrollable list itself. Flutter reports it with scroll actions and
  //    no name, which is correct for a viewport - a screen reader calls it a
  //    region, not a button - so counting it as an "unnamed actionable" invents
  //    a defect.
  //  * a node whose reported rect is a sliver. The kitchen board's item rows
  //    came back 288x8 at the bottom of the list while the screen plainly draws
  //    a ~50px row (checked: a screenshot crop at that band shows a normal
  //    card), and identical controls elsewhere in the SAME tree are 288x52. The
  //    rect is the dump's, not the product's, so it must not be reported as an
  //    undersized touch target - that is the "false defect is worse than a
  //    missing number" rule this plan has already paid for once.
  const SCROLL_ONLY = /^(scrollUp|scrollDown|scrollLeft|scrollRight|scrollToOffset|showOnScreen)$/;
  const isScrollContainer = (n) =>
    n.actions.length > 0 && n.actions.every((a) => SCROLL_ONLY.test(a));
  const scrollContainers = actionable.filter(isScrollContainer);
  const controls = actionable.filter((n) => !isScrollContainer(n));

  // The largest sane box the same label draws anywhere in this tree. An outlier
  // smaller than the floor is only reported as undersized when nothing proves
  // the label can be big.
  const saneSizeByLabel = new Map();
  for (const n of controls) {
    const key = (n.label || n.tooltip || '').trim();
    if (!key || !n.rect) continue;
    const best = saneSizeByLabel.get(key);
    const size = Math.min(n.rect.width, n.rect.height);
    if (!best || size > best) saneSizeByLabel.set(key, size);
  }
  const rectLooksClipped = (n) => {
    if (!n.rect) return false;
    if (n.rect.width >= 44 && n.rect.height >= 44) return false;
    const key = (n.label || n.tooltip || '').trim();
    const sane = saneSizeByLabel.get(key) ?? 0;
    return sane >= 44;
  };

  const report = {
    generatedAt: new Date().toISOString(),
    vmService: base,
    isolateId,
    nodeCount: nodes.length,
    actionableCount: actionable.length,
    // Reported so the exclusion above is visible rather than silent.
    controlCount: controls.length,
    scrollContainers: scrollContainers.length,
    // An accessible name is the label OR the tooltip, the same way a screen reader
    // resolves it. `namedByTooltip` is reported separately so the distinction stays
    // visible rather than being folded into one number.
    unnamedActions: controls.filter((n) => !n.label && !n.tooltip).length,
    namedByTooltip: controls.filter((n) => !n.label && n.tooltip).length,
    subtouchActions: controls.filter(
      (n) => n.rect && (n.rect.width < 44 || n.rect.height < 44) && !rectLooksClipped(n),
    ).length,
    // Not defects: the dump gave a rect too small for the label it carries while
    // the same label draws at a sane size elsewhere. Worth a look, not a count.
    unreliableRects: controls.filter(rectLooksClipped).length,
    actions: actionable.map((n) => ({
      name: (n.label || n.tooltip).slice(0, 120),
      nameSource: n.label ? 'label' : n.tooltip ? 'tooltip' : 'none',
      actions: n.actions,
      width: n.rect?.width ?? null,
      height: n.rect?.height ?? null,
      disabled: n.flags.includes('hasEnabledState') && !n.flags.includes('isEnabled'),
    })),
    raw: dump.data,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));
  process.stderr.write(
    `nodes=${report.nodeCount} actionable=${report.actionableCount} unnamed=${report.unnamedActions} subtouch=${report.subtouchActions}\nwrote ${OUT}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
