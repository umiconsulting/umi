#!/usr/bin/env node
/**
 * Drive the native Linux POS with real clicks.
 *
 * The POS is a native Flutter application, so there is no DOM to hold and no
 * `page.click()`. What it does have is an accessibility tree published over the
 * Dart VM service, and an X11 window that `xdotool` can put a real pointer into.
 * This module joins the two: it reads the semantics tree, turns a node into a
 * screen coordinate, and clicks it — then checks the click did what it was
 * supposed to do.
 *
 * See `docs/architecture/2026-09-16-pos-is-a-native-app.md` for why the web
 * build is never an acceptable substitute here, and `pos-native-launch.sh` for
 * how the app is started (`--debug`, so the VM service is published).
 *
 * ## The one non-obvious part: coordinates
 *
 * Flutter publishes each semantics node's rect **relative to its parent**, not
 * to the window. The PIN keypad's "1" key genuinely reports
 * `Rect.fromLTRB(0.0, 0.0, 144.0, 84.7)` because it is the first cell of its
 * row; its place on screen is the sum of every ancestor's offset. Reading the
 * raw rect and clicking it would put the pointer in the top-left corner of the
 * window, which is exactly the class of bug this driver exists to prevent. The
 * parser rebuilds the parent chain from the dump's indentation and accumulates.
 *
 * The second leg is logical pixels -> screen pixels. The app runs at device
 * pixel ratio 1.0, so that leg is a translation, but the translation is not
 * zero and it is not constant:
 *
 *   - the X window carries client-side decorations, so its geometry is the
 *     *frame*, and `_GTK_FRAME_EXTENTS` says how far the client is inset;
 *   - GTK draws a header bar inside the client, and the Flutter view fills what
 *     is left below it, which is why `client height - view height` is the
 *     header bar's height.
 *
 * Both parts are read from the running system on every invocation, because they
 * change: one launch produced a 1280x720 view at origin (0, 76) and an earlier
 * one a 1210x603 view at origin (35, 79). Hard-coding either would have been a
 * silent miss. `viewOrigin()` derives the origin from those facts and
 * `verifyOrigin()` checks the derivation against the framebuffer before
 * anything is clicked.
 *
 * "Change" is not only between launches. The frame is reported at (0, 0) when
 * it is mapped and the window manager re-places it seconds later; measured on
 * this workstation, (0, 0) at 12.6 s after launch and (-35, -3) at 18.2 s. An
 * origin read once at attach time is therefore stale for the whole run, and
 * every click lands offset by exactly that much - inside a 144 px keypad key,
 * outside a 70 px table. `refreshOrigin()` re-derives it before every pointer
 * event and records each move in `originDrift`.
 *
 * ## What a click has to prove
 *
 * A click is never "sent and assumed". It carries an expectation; the node is
 * re-resolved in a fresh dump first; the screen is allowed to settle (by
 * content fingerprint, bounded); and if the expectation is refused, the screen
 * is fingerprinted again. If anything at all changed, the press had an effect
 * and the retry is refused with the names that moved - because on a money path
 * "the expectation did not hold" and "nothing happened" are very different
 * claims, and only the second one licenses pressing the button twice.
 *
 * ## Usage
 *
 *   node tools/ux-sweep/pos-native-driver.mjs probe
 *   node tools/ux-sweep/pos-native-driver.mjs self-test
 *   node tools/ux-sweep/pos-native-driver.mjs tree --grep PIN
 *   node tools/ux-sweep/pos-native-driver.mjs click "1" --node PIN --expect-value-change "0 dígitos"
 *   node tools/ux-sweep/pos-native-driver.mjs type 1234
 *   node tools/ux-sweep/pos-native-driver.mjs scroll down --times 3
 *   node tools/ux-sweep/pos-native-driver.mjs wait "Continuar" --timeout 15000
 *
 * The VM service URL is read from the tail of the `flutter run` log
 * (`/tmp/umi-pos-linux.log` by default) or given with `--vm`; `UMIPOS_VM_SERVICE`
 * works too. `--shots <dir>` captures the Flutter view (not the whole screen)
 * after each action, so screenshots are comparable between runs.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_LOG = '/tmp/umi-pos-linux.log';
const DEFAULT_WINDOW = '^UmiPOS$';

/** Locate an external binary, preferring the copy unpacked into ~/.local. */
function tool(name) {
  const override = process.env[`UX_${name.toUpperCase()}_BIN`];
  const candidates = [override, join(homedir(), '.local/bin', name), `/usr/bin/${name}`].filter(
    Boolean,
  );
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return name;
}

function run(bin, args, { display = process.env.UX_DISPLAY || ':0' } = {}) {
  return execFileSync(tool(bin), args, {
    env: { ...process.env, DISPLAY: display },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Strip the box-drawing gutter Flutter puts in front of every tree line. */
function stripGutter(line) {
  return line.replace(/^[\s\u2502\u251c\u2514\u2500\u250c\u2510\u2518\u252c\u2534\u253c]+/, '');
}

/**
 * Parse `debugDumpSemanticsTreeInTraversalOrder` into nodes.
 *
 * Two things about the printed form drive this parser:
 *
 * 1. Depth comes from the position of the node marker **in the raw line**, not
 *    from interpreting the box-drawing characters: every level of the dump
 *    costs exactly two characters of gutter, so `(markerIndex - 1) / 2` is the
 *    depth. That is steadier than pattern-matching `|-` against `\-`. Measuring
 *    it after stripping the gutter is a mistake that yields depth -0.5 and
 *    flattens the whole tree, so the index is always taken from the raw line.
 * 2. The engine prints short field values inline and long ones in quotes on the
 *    lines *after* the field name:
 *
 *      label:
 *        "Ingresa tu PIN de operador
 *        ...
 *        Usa de 4 a 8 dígitos."
 *
 *    Only that shape starts a continuation — a bare `label:` immediately
 *    followed by `value:` (a node with a value and no label) must not swallow
 *    the value line.
 */
export function parseSemantics(text) {
  const lines = text.split('\n');
  const nodes = [];
  let current = null;
  let pendingField = null;
  let pendingParts = [];

  const flushField = () => {
    if (current && pendingField) current[pendingField] = pendingParts.join(' | ').trim();
    pendingField = null;
    pendingParts = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripGutter(raw);
    const marker = raw.indexOf('SemanticsNode#');

    if (marker !== -1) {
      flushField();
      if (current) nodes.push(current);
      current = {
        id: Number(raw.slice(marker + 'SemanticsNode#'.length).match(/^\d+/)?.[0] ?? -1),
        depth: Math.max(0, (marker - 1) / 2),
        label: '',
        tooltip: '',
        value: '',
        role: '',
        actions: [],
        flags: [],
        scrollPosition: null,
        scrollExtentMax: null,
        children: [],
        parent: null,
        rect: null,
        absolute: null,
      };
      continue;
    }
    if (!current) continue;

    if (pendingField) {
      pendingParts.push(line.replace(/^\s*"/, '').replace(/"\s*$/, '').trim());
      if (/"\s*$/.test(line)) flushField();
      continue;
    }

    const rectMatch = line.match(
      /^Rect\.fromLTRB\((-?[\d.]+), (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\)/,
    );
    if (rectMatch) {
      const [left, top, right, bottom] = rectMatch.slice(1).map(Number);
      current.rect = { left, top, right, bottom, width: right - left, height: bottom - top };
      continue;
    }

    const field = line.match(/^(label|tooltip|value|role):\s*(.*)$/);
    if (field) {
      const [, name, rest] = field;
      if (rest === '') {
        const next = stripGutter(lines[index + 1] ?? '');
        if (/^\s*"/.test(next)) {
          pendingField = name;
          pendingParts = [];
          continue;
        }
        current[name] = '';
        continue;
      }
      current[name] = rest.replace(/^"(.*)"$/, '$1');
      continue;
    }

    const actions = line.match(/^actions:\s*(.*)$/);
    if (actions) {
      current.actions = actions[1].split(/,\s*/).filter(Boolean);
      continue;
    }
    const flags = line.match(/^flags:\s*(.*)$/);
    if (flags) {
      current.flags = flags[1].split(/,\s*/).filter(Boolean);
      continue;
    }
    const scrollPosition = line.match(/^scrollPosition:\s*(-?[\d.]+)/);
    if (scrollPosition) {
      current.scrollPosition = Number(scrollPosition[1]);
      continue;
    }
    const scrollExtentMax = line.match(/^scrollExtentMax:\s*(-?[\d.]+)/);
    if (scrollExtentMax) current.scrollExtentMax = Number(scrollExtentMax[1]);
  }
  flushField();
  if (current) nodes.push(current);

  // Rebuild the hierarchy from depth, then accumulate offsets down the tree.
  const stack = [];
  for (const node of nodes) {
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    node.parent = parent;
    if (parent) parent.children.push(node);
    stack.push(node);
  }

  for (const node of nodes) {
    const own = node.rect ?? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    // A child's rect is expressed in the parent's own coordinate space, whose
    // origin is the parent's top-left corner. So every edge of the child shifts
    // by the same amount - the parent's *left/top*, never its right/bottom.
    const originLeft = node.parent?.absolute?.left ?? 0;
    const originTop = node.parent?.absolute?.top ?? 0;
    node.absolute = {
      left: originLeft + own.left,
      top: originTop + own.top,
      right: originLeft + own.right,
      bottom: originTop + own.bottom,
      width: own.width,
      height: own.height,
    };
  }
  return nodes;
}

/** Accent- and case-insensitive comparison, so "Salon" finds "Salón". */
function normalise(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The accessible name of a node: its label, or its tooltip when it has none. */
export function nameOf(node) {
  return node.label || node.tooltip || '';
}

export function isActionable(node) {
  return node.actions.some((action) => /tap|longPress|focus|scroll/.test(action));
}

/** Read the X window's frame geometry and the GTK frame extents around it. */
export function windowFacts(windowName = DEFAULT_WINDOW, display) {
  const ids = run('xdotool', ['search', '--name', windowName], { display })
    .trim()
    .split('\n')
    .filter(Boolean);
  if (!ids.length) {
    throw new Error(`No X window matching ${windowName}. Is the native POS running?`);
  }
  const windowId = ids[ids.length - 1];

  const frame = {};
  const info = run('xwininfo', ['-id', windowId], { display });
  for (const line of info.split('\n')) {
    const match = line.match(
      /^\s*(Absolute upper-left X|Absolute upper-left Y|Width|Height):\s*(-?\d+)/,
    );
    if (!match) continue;
    const key =
      { 'Absolute upper-left X': 'x', 'Absolute upper-left Y': 'y' }[match[1]] ??
      match[1].toLowerCase();
    frame[key] = Number(match[2]);
  }
  if (Object.keys(frame).length < 4) {
    throw new Error(`Could not read geometry of window ${windowId}: ${info}`);
  }

  // `_GTK_FRAME_EXTENTS(CARDINAL) = left, right, top, bottom`; absent on a
  // window with no client-side decoration, which means no inset.
  let extents = { left: 0, right: 0, top: 0, bottom: 0 };
  const props = run('xprop', ['-id', windowId, '_GTK_FRAME_EXTENTS'], { display });
  const numbers = props.match(/=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (numbers) {
    const [left, right, top, bottom] = numbers.slice(1).map(Number);
    extents = { left, right, top, bottom };
  }

  return { windowId, windowIds: ids, windowCount: ids.length, frame, extents };
}

/**
 * Where the Flutter view sits inside the X frame.
 *
 * The client is the frame inset by `_GTK_FRAME_EXTENTS`. GTK paints a header
 * bar at the top of the client and the Flutter view takes the rest, so the
 * leftover height is the header bar.
 */
export function viewOrigin(facts, viewSize) {
  const { frame, extents } = facts;
  const client = {
    x: frame.x + extents.left,
    y: frame.y + extents.top,
    width: frame.width - extents.left - extents.right,
    height: frame.height - extents.top - extents.bottom,
  };
  const headerBar = client.height - viewSize.height;
  if (headerBar < 0) {
    throw new Error(
      `Flutter view (${viewSize.width}x${viewSize.height}) is taller than the client area ` +
        `(${client.width}x${client.height}); the geometry assumption is wrong.`,
    );
  }
  if (Math.abs(client.width - viewSize.width) > 1) {
    throw new Error(
      `Flutter view width ${viewSize.width} does not match client width ${client.width}; ` +
        'the window is probably letterboxed and the mapping would be off.',
    );
  }
  return {
    client,
    headerBar,
    x: client.x,
    y: client.y + headerBar,
    width: viewSize.width,
    height: viewSize.height,
  };
}

/**
 * Check the derived origin against the framebuffer: the corners of the derived
 * view rectangle must land inside the app's client area, and the band just
 * outside must not. Returns the evidence rather than a bare boolean.
 */
export async function verifyOrigin(display, origin, { screen = '1920x1080' } = {}) {
  const [screenWidth] = screen.split('x').map(Number);
  const raw = resolve('/tmp/ux', `origin-check-${process.pid}-${Date.now()}.rgb`);
  await mkdir(dirname(raw), { recursive: true });
  run(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'x11grab',
      '-video_size',
      screen,
      '-i',
      display,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      raw,
    ],
    { display },
  );
  const buffer = await readFile(raw);
  const hex = (x, y) => {
    const offset = (y * screenWidth + x) * 3;
    return `#${[buffer[offset], buffer[offset + 1], buffer[offset + 2]]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')}`;
  };
  const probes = {};
  for (const [name, x, y] of [
    ['topLeft', origin.x + 2, origin.y + 2],
    ['topRight', origin.x + origin.width - 3, origin.y + 2],
    ['bottomLeft', origin.x + 2, origin.y + origin.height - 3],
    ['bottomRight', origin.x + origin.width - 3, origin.y + origin.height - 3],
    ['justAboveView', origin.x + Math.floor(origin.width / 2), origin.y - 2],
    ['justLeftOfView', origin.x - 2, origin.y + Math.floor(origin.height / 2)],
  ]) {
    probes[name] = x < 0 || y < 0 || x >= screenWidth || y >= 1080 ? 'off-screen' : hex(x, y);
  }
  return { raw, probes };
}

/** A connection to one running POS isolate. */
export async function connect({ vm, log = DEFAULT_LOG } = {}) {
  const base = await resolveVm(vm, log);
  const vmInfo = await rpc(base, 'getVM');
  const isolateId = vmInfo.isolates?.[0]?.id;
  if (!isolateId) throw new Error('The VM service has no isolate; is the app actually running?');

  const call = (method, params = {}) => rpc(base, method, params);
  const dumpText = async () => {
    const result = await call('ext.flutter.debugDumpSemanticsTreeInTraversalOrder', { isolateId });
    return result.data ?? '';
  };
  const viewSize = async () => {
    const result = await call('ext.flutter.debugDumpRenderTree', { isolateId });
    const match = (result.data ?? '').match(/view size: Size\(([\d.]+), ([\d.]+)\)/);
    if (!match) throw new Error('Could not read the Flutter view size from the render tree.');
    return { width: Number(match[1]), height: Number(match[2]) };
  };
  return { base, isolateId, call, dumpText, viewSize };
}

async function resolveVm(explicit, log) {
  const candidate = explicit ?? process.env.UMIPOS_VM_SERVICE ?? (await urlFromLog(log));
  if (!candidate) {
    throw new Error(
      `No Dart VM service URL. Pass --vm, set UMIPOS_VM_SERVICE, or write it to ${log}.`,
    );
  }
  return candidate.endsWith('/') ? candidate : `${candidate}/`;
}

async function urlFromLog(log) {
  if (!existsSync(log)) return null;
  const text = await readFile(log, 'utf8');
  const matches = text.match(/http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_=-]+\//g);
  return matches?.length ? matches[matches.length - 1] : null;
}

async function rpc(base, method, params = {}) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${base}${method}${query ? `?${query}` : ''}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function rect(r) {
  return `(${r.left.toFixed(1)}, ${r.top.toFixed(1)}, ${r.right.toFixed(1)}, ${r.bottom.toFixed(1)})`;
}

/**
 * A click-capable driver.
 *
 * Every action is awaited and reported: what it targeted, the logical rect it
 * resolved, the screen coordinate it clicked, how long the app took to settle,
 * and whether the expectation held. `clickText` requires an expectation, so a
 * click can never quietly miss: a pointer that lands on nothing produces no
 * change, and "no change" has to be a failure, not an observation.
 */
export async function createDriver({
  vm,
  log = DEFAULT_LOG,
  windowName = DEFAULT_WINDOW,
  display = process.env.UX_DISPLAY || ':0',
  shots = null,
  settle = 260,
  say = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  let connection = await connect({ vm, log });
  let facts = windowFacts(windowName, display);
  let size = await connection.viewSize();
  let origin = viewOrigin(facts, size);
  const steps = [];
  const originDrift = [];
  let windowMissing = null;

  /**
   * Re-derive where the Flutter view sits on the screen.
   *
   * The window is **not** where it was when the launcher returned. X reports the
   * frame at (0, 0) the moment it is mapped and the window manager re-places it
   * a few seconds later; measured on this workstation, frame (0, 0) at 12.6 s
   * after launch and (-35, -3) at 18.2 s. An origin read once at attach time is
   * therefore stale for the whole run, and every click lands offset by exactly
   * that much. That is not a cosmetic error: a 35 px shift is inside a 144 px
   * keypad key and a 183 px navigation item, and *outside* a 70 px table, so a
   * cold run missed every table while every keypad tap worked - which read like
   * "the canvas repaints and swallows the taps". It was the pointer, not the app.
   *
   * Two `xdotool`/`xwininfo` calls cost ~20 ms, so this runs before every
   * pointer event and reports each move it finds.
   */
  const refreshOrigin = (reason) => {
    let next;
    let nextFacts;
    try {
      nextFacts = windowFacts(windowName, display);
      next = viewOrigin(nextFacts, size);
    } catch {
      // The window is momentarily unmapped (a route change can rebuild the X
      // surface); the previous reading is the best evidence available. If it
      // stays missing the pointer is being aimed at a window that is not there,
      // which is worth saying out loud: on a shared workstation another
      // launcher will kill this instance, and the symptom otherwise looks like
      // an app that stopped responding.
      windowMissing = new Date().toISOString();
      return null;
    }
    windowMissing = null;
    if (next.x === origin.x && next.y === origin.y) return null;
    const move = {
      reason,
      at: new Date().toISOString(),
      from: { x: origin.x, y: origin.y },
      to: { x: next.x, y: next.y },
      frame: { x: nextFacts.frame.x, y: nextFacts.frame.y },
    };
    originDrift.push(move);
    origin = next;
    facts = nextFacts;
    say(
      `  the window moved: view origin (${move.from.x}, ${move.from.y}) -> ` +
        `(${move.to.x}, ${move.to.y}); every click from here uses the new one [${reason}]`,
    );
    return move;
  };

  const tree = async () => parseSemantics(await connection.dumpText());
  const toScreen = (x, y) => ({ x: Math.round(origin.x + x), y: Math.round(origin.y + y) });

  // Two POS windows means the pointer and the semantics tree can belong to
  // different processes: the driver reads one instance's accessibility tree and
  // clicks whatever X has on top. That produces results that look like app
  // bugs (a key press registering twice, a screen that answers the wrong
  // control) and are really two apps sharing one workstation. Say so loudly.
  if ((facts.windowCount ?? 1) > 1) {
    say(
      `  WARNING: ${facts.windowCount} windows match "${windowName}" (${facts.windowIds.join(', ')}); ` +
        'the pointer may land on one instance while the tree is read from another.',
    );
  }

  /**
   * Re-attach to a POS that was just restarted under the driver.
   *
   * A restart is a new process, a new Dart VM service URL and a new X window, so
   * every fact the driver holds — the isolate it reads the tree from, the view
   * size, the frame — belongs to a process that no longer exists. Re-reading the
   * URL from the launcher log and re-deriving the geometry is what makes a
   * "restart mid-shift" flow measurable at all; without it the driver would keep
   * asking a dead isolate for a semantics tree.
   */
  const reconnect = async () => {
    connection = await connect({ vm: undefined, log });
    size = await connection.viewSize();
    facts = windowFacts(windowName, display);
    origin = viewOrigin(facts, size);
    return connection.base;
  };

  const shot = async (name) => {
    if (!shots) return null;
    await mkdir(shots, { recursive: true });
    // The file is named for the step, not for a counter that restarts every
    // run. An earlier version numbered screenshots per process, so the "caja"
    // shot of one pass silently overwrote the "caja" shot of the next and two
    // runs could not be compared.
    const safe = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'shot';
    // The name is the step's name, so `caja.png` is always the Caja step of
    // whichever run wrote it. Callers that want history keep it by passing a
    // fresh directory per run rather than by varying the file name.
    const file = join(shots, `${safe}.png`);
    run(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'x11grab',
        '-video_size',
        `${origin.width}x${origin.height}`,
        '-i',
        `${display}.0+${origin.x},${origin.y}`,
        '-frames:v',
        '1',
        file,
      ],
      { display },
    );
    say(`  shot  ${file}`);
    return file;
  };

  /**
   * Put the till on screen before a pointer event, and prove it got there.
   *
   * This used to be `windowfocus` alone, and that is not enough on a desk with
   * more than one workspace. Here the terminal and the Dashboard's Chromium
   * live on workspace 0 and the till lives on workspace 1, and a window that is
   * focused but not *shown* still receives nothing: the click lands on whatever
   * the visible workspace has at those coordinates. The symptom is a flow that
   * fails on a screen the app never saw, and the tell is in the evidence - the
   * screenshot written by a failed flow during the sweep showed the terminal,
   * not the till. `windowactivate` is the call that also brings the window's
   * workspace forward, which is what the playbook already says to use.
   *
   * The desktop check afterwards is the part that makes a failure loud: if the
   * till is still not the visible desktop, the click is refused rather than
   * aimed into somebody else's window.
   */
  const focus = () => {
    try {
      run('xdotool', ['windowactivate', '--sync', facts.windowId], { display });
    } catch {
      // No window manager, or a window that refuses activation. Focus is the
      // fallback and is enough when there is only one workspace.
      try {
        run('xdotool', ['windowfocus', '--sync', facts.windowId], { display });
      } catch {
        // Pointer events still reach the app on a bare X server, so this is not
        // fatal either.
        return;
      }
    }
    const read = (args) => {
      try {
        return run('xdotool', args, { display }).trim();
      } catch {
        return null;
      }
    };
    const windowDesktop = read(['get_desktop_for_window', facts.windowId]);
    const shownDesktop = read(['get_desktop']);
    if (windowDesktop !== null && shownDesktop !== null && windowDesktop !== shownDesktop) {
      throw new Error(
        `The till is on desktop ${windowDesktop} but desktop ${shownDesktop} is showing, so a ` +
          'click at its coordinates would land in another window. Bring the till forward ' +
          '(`xdotool windowactivate`, or `wmctrl -s` for its workspace) and run again.',
      );
    }
  };

  /**
   * Put the pointer on a screen coordinate and prove it got there.
   *
   * `mousemove --sync` is the obvious call and the wrong one: when the pointer
   * is already at the target no motion event is generated, so `--sync` waits out
   * its whole timeout (measured: 15.3 s) before returning. A plain `mousemove`
   * plus a `getmouselocation` read-back is faster and strictly more informative,
   * because it confirms the coordinates instead of assuming them.
   */
  const movePointer = (x, y) => {
    run('xdotool', ['mousemove', String(x), String(y)], { display });
    const location = run('xdotool', ['getmouselocation', '--shell'], { display });
    const actualX = Number(location.match(/X=(-?\d+)/)?.[1]);
    const actualY = Number(location.match(/Y=(-?\d+)/)?.[1]);
    if (actualX !== x || actualY !== y) {
      throw new Error(`Pointer asked for (${x}, ${y}) but X reports (${actualX}, ${actualY}).`);
    }
  };

  const clickRaw = (x, y) => {
    movePointer(x, y);
    run('xdotool', ['click', '1'], { display });
  };

  /**
   * Wait until the UI stops changing.
   *
   * The launcher returns as soon as the window exists, which is well before the
   * app is interactive - it still has to bootstrap, pair and render. A click
   * delivered into that window is discarded, and a discarded click looks
   * exactly like a wrong coordinate. Two identical consecutive dumps is the
   * cheapest honest evidence that the screen has settled.
   */
  const waitReady = async ({ until = null, stable = 2, timeout = 30000, interval = 400 } = {}) => {
    const deadline = Date.now() + timeout;
    // A stable screen is not the same as a ready one: the boot spinner is
    // perfectly stable. When a caller knows what readiness looks like, gate on
    // that first and only then require the screen to stop changing.
    if (until) await waitFor(until, { timeout });
    let previous = null;
    let repeats = 0;
    for (;;) {
      const text = await connection.dumpText();
      if (text === previous) {
        repeats += 1;
        if (repeats >= stable - 1) return true;
      } else {
        repeats = 0;
        previous = text;
      }
      if (Date.now() > deadline) {
        throw new Error(`The screen never settled within ${timeout}ms.`);
      }
      await sleep(interval);
    }
  };

  const nodes = async () => tree();

  /**
   * The parts of a name that tick.
   *
   * The surface publishes its turn timer inside the node's own name
   * (`T1, 4, seated 7 s | T1 | 7 s`) and the map publishes its refresh time
   * (`Plano actualizado: 18:20`). Both change on their own, so a fingerprint
   * that kept them would differ every second: every swallowed tap would look
   * like a successful one, the retry would be refused exactly when it was
   * needed, and `waitSettled` could never settle on a room with a party in it.
   * Masking happens here and only here - callers still see the real names.
   */
  const stableName = (name) =>
    name.replace(/\b\d+\s*(s|seg|mins?|h)\b/g, '~t').replace(/\b\d{1,2}:\d{2}\b/g, '~clock');

  /**
   * A fingerprint of everything an operator could see: the name, value and
   * rounded rect of every named node, sorted. Two equal fingerprints mean the
   * screen did not change in any way the accessibility tree can express.
   *
   * This is what makes a retry *provable* rather than hopeful. A refused
   * expectation says the click did not do what the caller expected; it does not
   * say the click did nothing. On a money path that difference is a sale. The
   * fingerprint is taken immediately before the press and again after a refused
   * expectation - any difference at all means the press had an effect, and the
   * retry is refused with the names that moved.
   *
   * The names and values are passed through `stableName` first, so the ticking
   * parts cannot masquerade as an effect.
   */
  const fingerprintOf = (list) =>
    list
      .filter((node) => nameOf(node))
      .map(
        (node) =>
          `${stableName(nameOf(node))}|${stableName(node.value ?? '')}|${node.actions.join(',')}|` +
          `${Math.round(node.absolute.left)},${Math.round(node.absolute.top)},` +
          `${Math.round(node.absolute.width)}x${Math.round(node.absolute.height)}`,
      )
      .sort();

  const fingerprint = async () => fingerprintOf(await tree());

  /** What changed between two fingerprints, as `+`/`-`/`~` lines. */
  const fingerprintDiff = (before, after) => {
    const count = (list) => {
      const map = new Map();
      for (const entry of list) map.set(entry, (map.get(entry) ?? 0) + 1);
      return map;
    };
    const left = count(before);
    const right = count(after);
    const changes = [];
    for (const [entry, seen] of right) {
      const was = left.get(entry) ?? 0;
      if (was === 0) changes.push(`+ ${entry}`);
      else if (was !== seen) changes.push(`~ ${entry} (x${was} -> x${seen})`);
    }
    for (const [entry, seen] of left) if (!right.has(entry)) changes.push(`- ${entry}`);
    return changes;
  };

  /**
   * Wait until the screen stops changing, by fingerprint.
   *
   * Tapping a surface that is still loading is a coin toss: the press lands on
   * the layout that is about to be replaced. `first` lets a caller donate a
   * fingerprint it has already taken, so settling usually costs one extra dump.
   * The wait is bounded and reports `stable: false` rather than hanging - a
   * screen that never stops changing (a live clock, a spinner) is a fact the
   * caller should see, not something to wait out.
   */
  const waitSettled = async ({ first = null, stable = 3, timeout = 4000, interval = 250 } = {}) => {
    const started = Date.now();
    let previous = first ?? (await fingerprint());
    let repeats = 1;
    for (;;) {
      if (Date.now() - started > timeout) {
        return { stable: false, fingerprint: previous, waitedMs: Date.now() - started };
      }
      await sleep(interval);
      const current = await fingerprint();
      if (!fingerprintDiff(previous, current).length) {
        repeats += 1;
        if (repeats >= stable) {
          return { stable: true, fingerprint: current, waitedMs: Date.now() - started };
        }
      } else {
        repeats = 1;
      }
      previous = current;
    }
  };

  /** A one-line description of what is on screen, for a failure message. */
  const screenSummary = async () => {
    const names = [
      ...new Set(
        (await nodes())
          .filter(isActionable)
          .map((node) => nameOf(node))
          .filter(Boolean),
      ),
    ];
    return `screen offers ${JSON.stringify(names.slice(0, 12))}`;
  };

  /**
   * Is the node fully inside every box that clips it?
   *
   * Scrolling moves nodes out of the viewport but they stay in the semantics
   * tree, and two nodes can share a name - the tender screen has a "Cerrar" in
   * its header and another inside the scrolled body. Clicking the scrolled-out
   * one is impossible (the pointer would have to leave the screen), so
   * visibility has to be part of choosing a target, not an afterthought.
   *
   * The Flutter view is only the outermost clip. A scrollable panel clips its
   * own children too, and a node just past a panel's bottom edge is inside the
   * view while being invisible in the product: "Agregar al carrito" accumulated
   * to y 616..668 under a panel whose visible box ends at 616, which is how a
   * click meant for the button landed on the bottom navigation bar underneath
   * it and navigated to another screen. Every ancestor's accumulated box is
   * therefore part of the test.
   */
  const isVisible = (node) => {
    const inside = (box, outer) =>
      box.left >= outer.left - 0.5 &&
      box.top >= outer.top - 0.5 &&
      box.right <= outer.right + 0.5 &&
      box.bottom <= outer.bottom + 0.5;
    if (!inside(node.absolute, { left: 0, top: 0, right: size.width, bottom: size.height })) {
      return false;
    }
    for (let current = node.parent; current; current = current.parent) {
      if (!current.rect) continue;
      if (!inside(node.absolute, current.absolute)) return false;
    }
    return true;
  };

  /**
   * Find nodes by accessible name (label or tooltip), optionally by role/action.
   *
   * Matching is ranked so an exact name always wins over a substring: asking
   * for the "1" key must not return "T1" because it merely contains a 1.
   */
  const findAll = async (name, { actionable = false, role = null } = {}) => {
    const all = await nodes();
    const wanted = normalise(name);
    const ranked = [];
    all.forEach((node, order) => {
      if (actionable && !isActionable(node)) return;
      if (role && normalise(node.role) !== normalise(role)) return;
      const haystack = normalise(nameOf(node));
      const score =
        haystack === wanted
          ? 0
          : haystack.startsWith(wanted)
            ? 1
            : haystack.includes(wanted)
              ? 2
              : -1;
      if (score === -1) return;
      ranked.push({ node, score, order, hidden: isVisible(node) ? 0 : 1 });
    });
    ranked.sort((a, b) => a.score - b.score || a.hidden - b.hidden || a.order - b.order);
    return ranked.map((entry) => entry.node);
  };

  /**
   * Scroll until a named node is inside the view.
   *
   * Returns the node, or throws with the scroll count it tried - a workflow
   * that cannot reach its target should say so, not click somewhere else.
   */
  const scrollIntoView = async (name, { direction = 'down', times = 8, step = 3 } = {}) => {
    const clampX = (value) => Math.min(Math.max(value, 8), size.width - 8);
    const clampY = (value) => Math.min(Math.max(value, 8), size.height - 8);
    /**
     * Where to park the pointer so the wheel reaches the right scroller.
     *
     * A wheel event goes to whatever is under the pointer, so parking on the
     * target's own clamped position is wrong as soon as the target is off
     * screen: a control 100px below the fold gets clamped onto the bottom
     * navigation bar, and the modal never scrolls. Walk up to the enclosing
     * scrollable and park in the middle of the part of it that is on screen.
     */
    const parkPoint = (node) => {
      let scroller = node;
      while (scroller && !scroller.actions.some((action) => action.startsWith('scroll'))) {
        scroller = scroller.parent;
      }
      const box = (scroller ?? node).absolute;
      return {
        x: clampX((Math.max(box.left, 0) + Math.min(box.right, size.width)) / 2),
        y: clampY((Math.max(box.top, 0) + Math.min(box.bottom, size.height)) / 2),
      };
    };
    const matches = await findAll(name);
    if (!matches.length) {
      throw new Error(
        `"${name}" is not in the semantics tree at all, so scrolling cannot find it.`,
      );
    }
    // Each copy of the name gets its own attempt, and each one scrolls in the
    // direction it actually lies. A name can appear twice - the tender screen
    // has a "Cerrar" in its header and another inside the scrolled body - and
    // when the panel is already at its scroll end one of them is unreachable no
    // matter how many wheel clicks are fired at it.
    for (const candidate of matches) {
      if (isVisible(candidate)) return candidate;
      const way = candidate.absolute.top < 0 ? 'up' : 'down';
      for (let attempt = 0; attempt < times; attempt += 1) {
        const current = (await findAll(name)).find((node) => node.id === candidate.id);
        if (!current) break;
        if (isVisible(current)) return current;
        const park = parkPoint(current);
        await scrollAt(park.x, park.y, way, { times: step });
      }
    }
    throw new Error(
      `"${name}" never became visible after trying every match (${times} scrolls each).`,
    );
  };

  /** The current value of the node a name resolves to, same ranking as `find`. */
  const valueOf = async (name) => {
    const matches = await findAll(name);
    const node = matches.find((candidate) => candidate.value !== '') ?? matches[0];
    if (!node)
      throw new Error(`Expected a node named "${name}" to still be on screen; it is gone.`);
    return { node, value: node.value };
  };

  /**
   * Read a value for use as a baseline, tolerating a momentarily empty tree.
   * The engine publishes no nodes at all for a frame while a route changes, and
   * taking the baseline is the one read that has no retry of its own.
   */
  const baselineValue = async (name) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const seen = await valueOf(name).catch(() => null);
      if (seen) return seen.value;
      if (Date.now() > deadline) {
        throw new Error(`Could not read a starting value from "${name}" within 5000ms.`);
      }
      await sleep(150);
    }
  };

  const find = async (name, options = {}) => {
    const index = options.index ?? 0;
    // The tree is not always there to be read. During a route transition the
    // engine can publish an empty tree for a frame or two - a PIN keypad click
    // was followed by "actionable names on screen: []" - so a miss is retried
    // briefly before it is treated as a real miss.
    const deadline = Date.now() + (options.timeout ?? 4000);
    for (;;) {
      const matches = await findAll(name, options);
      if (matches[index]) return matches[index];
      if (Date.now() > deadline) break;
      await sleep(150);
    }
    {
      const seen = (await nodes())
        .filter(isActionable)
        .map((node) => nameOf(node))
        .filter(Boolean);
      throw new Error(
        `No node named "${name}"${options.actionable ? ' (actionable)' : ''}. ` +
          `Actionable names on screen: ${JSON.stringify([...new Set(seen)].slice(0, 30))}`,
      );
    }
  };

  const waitFor = async (name, { timeout = 10000, gone = false, actionable = false } = {}) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const matches = await findAll(name, { actionable });
      if (gone ? matches.length === 0 : matches.length > 0) return matches;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out after ${timeout}ms waiting for "${name}" to ${gone ? 'disappear' : 'appear'}.`,
        );
      }
      await sleep(120);
    }
  };

  /** The state an expectation is judged against. */
  const snapshot = async () => {
    const map = new Map();
    for (const node of await tree()) {
      const name = normalise(nameOf(node));
      if (name) map.set(name, { value: node.value, label: node.label, tooltip: node.tooltip });
    }
    return map;
  };

  const checkExpectation = async (expect) => {
    if (expect.appears) {
      await waitFor(expect.appears, { timeout: expect.timeout ?? 10000, actionable: false });
      return `"${expect.appears}" appeared`;
    }
    if (expect.gone) {
      await waitFor(expect.gone, { timeout: expect.timeout ?? 10000, gone: true });
      return `"${expect.gone}" disappeared`;
    }
    if (expect.valueChange) {
      const { name, from } = expect.valueChange;
      // Poll: the app updates a frame or several after the press, and a single
      // read right after the click caught the old value and declared a landed
      // click a miss ("still 1 dígitos"), which then made the retry guard
      // refuse to retry a click that had in fact already worked.
      const deadline = Date.now() + (expect.timeout ?? 5000);
      for (;;) {
        // `valueOf` throws when the node is momentarily absent, and the tree is
        // genuinely empty for a frame or two while a route changes. Treat that
        // as "not yet" rather than as a verdict.
        const seen = await valueOf(name).catch(() => null);
        if (seen && seen.value !== from) return `"${name}": "${from}" -> "${seen.value}"`;
        if (Date.now() > deadline) {
          throw new Error(`Expected "${name}" to stop reading "${from}", but it still does.`);
        }
        await sleep(150);
      }
    }
    // The negative control. An inert action has to be able to assert that
    // nothing moved; otherwise "the value changed" proves nothing about where
    // the pointer landed - only that the digit counter is not frozen.
    if (expect.unchanged) {
      const { name, value } = expect.unchanged;
      const seen = await valueOf(name);
      if (seen.value !== value) {
        throw new Error(
          `Expected "${name}" to stay "${value}" but it became "${seen.value}"; the action was not inert.`,
        );
      }
      return `"${name}" still "${value}"`;
    }
    throw new Error('An expectation of {appears}|{gone}|{valueChange}|{unchanged} is required.');
  };

  const record = (step) => {
    steps.push(step);
    return step;
  };

  /**
   * Is a second attempt safe?
   *
   * Only when the current screen *proves* the first attempt did nothing. A
   * click that landed cannot be repeated blindly - tapping a product twice puts
   * two in the cart - so the retry is gated on evidence of no effect, not on a
   * hunch. `unchanged` is deliberately excluded: its whole purpose is to detect
   * that an action did something, so a failure there is a result, not a miss.
   */
  const nothingHappened = async (expect) => {
    if (expect.valueChange) {
      const { name, from } = expect.valueChange;
      const { value } = await valueOf(name);
      return value === from
        ? { safe: true, reason: `"${name}" is still "${from}", so nothing was applied` }
        : { safe: false, reason: `"${name}" moved to "${value}", so the click did land` };
    }
    if (expect.appears) {
      const matches = await findAll(expect.appears);
      return matches.length === 0
        ? { safe: true, reason: `"${expect.appears}" is still absent` }
        : { safe: false, reason: `"${expect.appears}" is present, so the click did land` };
    }
    if (expect.gone) {
      const matches = await findAll(expect.gone);
      return matches.length > 0
        ? { safe: true, reason: `"${expect.gone}" is still present` }
        : { safe: false, reason: `"${expect.gone}" disappeared, so the click did land` };
    }
    return { safe: false, reason: 'this expectation cannot prove a miss' };
  };

  /**
   * Click a node, and prove the click did what it was for.
   *
   * Three things make this more than `xdotool click`:
   *
   * 1. **The window can move under the driver** (`refreshOrigin`), so the
   *    origin is re-derived before every pointer event.
   * 2. **The tree a caller holds can be seconds old.** The node is re-found by
   *    id - by name if the widget was rebuilt - in a fresh dump before every
   *    attempt, so the rect aimed at is the one the app publishes now.
   * 3. **A retry must be provably safe.** A click that did nothing may be
   *    repeated; a click that changed the screen may not, because the change
   *    may *be* the action (a charge that already went through). So the screen
   *    is fingerprinted before the press and compared after a refused
   *    expectation, and any difference stops the retry and says what moved.
   */
  const clickNode = async (node, { expect, label = null, shotName = null, attempts = 3 } = {}) => {
    if (!expect)
      throw new Error('clickNode requires an expectation; a silent miss is not allowed.');
    // A value-change expectation that does not name the starting value is
    // filled in from the app, not from the caller's memory of it. Passing a
    // stale `from` is not caught by a `value !== from` test, so a click that
    // moved a counter by one would sail through against a wrong baseline.
    if (expect.valueChange && expect.valueChange.from === undefined) {
      expect.valueChange.from = await baselineValue(expect.valueChange.name);
    }
    const name = nameOf(node) || label || `node#${node.id}`;
    const targetId = node.id;
    const started = Date.now();
    const moves = [];
    const retries = [];
    let outcome = null;
    let used = 0;
    let phases = { focus: 0, click: 0, verify: 0 };
    let screen = null;
    let logical = null;
    let resolution = null;
    let scroll = null;
    let settled = null;
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      used = attempt;
      const drift = refreshOrigin(`before clicking "${name}"`);
      if (drift) moves.push({ kind: 'window', ...drift });
      const lookup = async () => {
        const fresh = await tree();
        return {
          fresh,
          live:
            fresh.find((candidate) => candidate.id === targetId) ??
            // A rebuilt widget keeps its name and loses its id.
            fresh.find((candidate) => normalise(nameOf(candidate)) === normalise(nameOf(node))) ??
            null,
        };
      };
      let { fresh, live } = await lookup();
      // The engine publishes no named nodes at all for a frame or two while a
      // route changes. That is a transition, not the target leaving, and
      // treating it as gone made a click that followed another click fail
      // spuriously ("left the screen before it could be clicked; screen offers
      // []"). Only an empty tree is retried, and only briefly.
      const settleLookup = Date.now() + 2000;
      while (!live && !fresh.some((candidate) => nameOf(candidate)) && Date.now() < settleLookup) {
        await sleep(150);
        ({ fresh, live } = await lookup());
      }
      // Only the first press waits. A retry happens only when the screen was
      // proven unchanged, and waiting again would just spend time re-learning
      // that nothing is moving.
      //
      // AND IT WAITS BEFORE THE COORDINATES ARE RESOLVED. That ordering is the
      // fix, not a tidy-up. A menu that is still opening moves its own items,
      // and a position measured from the pre-settle tree is exactly the
      // "position the driver cannot justify" that `resolveTarget` exists to
      // refuse. Worse, clicking one is not a miss the driver can even detect:
      // the press lands on the backdrop, the menu closes, and the only symptom
      // is an expectation that timed out with nothing on the wire. That is how
      // the account menu's "Bloquear operador" failed while the API log held no
      // lock request at all - the item was measured mid-animation, then clicked
      // after it, into the backdrop that had taken its place.
      if (attempt === 1) {
        settled = await waitSettled({ first: fingerprintOf(fresh) });
        // The screen is allowed to have changed while it settled, so the target
        // is read again rather than trusted from before the wait.
        ({ fresh, live } = await lookup());
      }
      if (!live) {
        const gone = windowMissing
          ? ' The POS window itself is gone (no X window matches), which on a shared workstation ' +
            'usually means another launcher killed this instance.'
          : '';
        const error = new Error(
          `"${name}" left the screen before it could be clicked; ${await screenSummary()}.${gone}`,
        );
        error.clickVerdict = 'target-gone';
        const file = shots ? await shot(`${name}-GONE`) : null;
        throw file ? new Error(`${error.message} Screenshot: ${file}`) : error;
      }
      // Everything goes through `resolveTarget`: a target that is off screen or
      // whose accumulated position cannot be trusted gets measured and scrolled
      // into view first, so no click is ever aimed with a position the driver
      // cannot justify.
      const target = await resolveTarget(live, { label: name });
      screen = target.screen;
      logical = target.logical;
      resolution = target.method;
      scroll = target.scroll ?? null;
      const before = Date.now();
      focus();
      const focused = Date.now();
      clickRaw(screen.x, screen.y);
      const clicked = Date.now();
      try {
        outcome = await checkExpectation(expect);
        phases = {
          focus: focused - before,
          click: clicked - focused,
          verify: Date.now() - clicked,
        };
        break;
      } catch (error) {
        lastError = error;
        phases = {
          focus: focused - before,
          click: clicked - focused,
          verify: Date.now() - clicked,
        };
        if (attempt === attempts) break;
        const moved = fingerprintDiff(settled.fingerprint, await fingerprint());
        const verdict = await nothingHappened(expect);
        if (moved.length || !verdict.safe) {
          const why = moved.length
            ? `the screen changed: ${moved.slice(0, 6).join(', ')}`
            : verdict.reason;
          const unsafe = new Error(
            `${error.message} A retry is unsafe because ${why}. ` +
              'The press had an effect, so repeating it would risk a doubled action.',
          );
          unsafe.clickVerdict = 'screen-changed';
          if (shots) await shot(`${name}-NOT-RETRIED`);
          throw unsafe;
        }
        retries.push({ attempt, reason: 'the screen is unchanged, so the press did not land' });
        say(
          `  retry ${attempt}: nothing on the screen changed, so the click did not land; ` +
            `re-resolving "${name}" before pressing again`,
        );
      }
    }
    if (!outcome) {
      // The pointer events did happen, so they are recorded as steps that were
      // not verified rather than dropped. Otherwise a click the app answered by
      // changing screen out from under the expectation - the last PIN digit,
      // which submits on its own - would vanish from the tap count and
      // under-report the operator's real work.
      const file = shots ? await shot(`${name}-FAILED`) : null;
      const inert = new Error(`${lastError.message}${file ? ` (screenshot: ${file})` : ''}`);
      // Every attempt left the screen untouched, so the press provably did
      // nothing: a caller may safely try a different target.
      inert.clickVerdict = 'inert';
      record({
        action: 'click',
        target: name,
        nodeId: targetId,
        logical,
        screen,
        resolution,
        scroll,
        outcome: `unverified: ${lastError.message}`,
        attempts: used,
        retries,
        moves,
        ms: Date.now() - started,
        phases,
      });
      throw inert;
    }
    await sleep(settle);
    const step = record({
      action: 'click',
      target: name,
      nodeId: targetId,
      logical,
      screen,
      resolution,
      scroll,
      outcome,
      attempts: used,
      retries,
      moves,
      settled: settled ? { stable: settled.stable, waitedMs: settled.waitedMs } : null,
      ms: Date.now() - started,
      phases,
    });
    say(
      `  click "${step.target}"\n` +
        `        logical (${step.logical.x.toFixed(1)}, ${step.logical.y.toFixed(1)}) -> ` +
        `screen (${screen.x}, ${screen.y}) [${step.resolution}` +
        `${step.scroll ? `, scrolled to ${step.scroll.position}` : ''}]\n` +
        `        ${outcome} in ${step.ms}ms after ${used} attempt(s) ` +
        `(focus ${step.phases.focus}, pointer ${step.phases.click}, verify ${step.phases.verify})` +
        `${step.settled && !step.settled.stable ? `, the screen never settled (waited ${step.settled.waitedMs}ms)` : ''}` +
        `${step.moves.length ? `, ${step.moves.length} re-measure(s)` : ''}`,
    );
    const file = shotName ? await shot(shotName) : null;
    return { ...step, screenshot: file };
  };

  const clickText = async (name, options = {}) => {
    const actionable = options.actionable !== false;
    let node;
    try {
      node = await find(name, { actionable, index: options.index });
    } catch (error) {
      if (options.scrollToFind === false) throw error;
      const found = await scrollToFind(name, { actionable });
      if (!found) throw error;
      say(`  found "${name}" after scrolling`);
      node = found;
    }
    return clickNode(node, options);
  };

  const clickAt = async (x, y, { expect, label = 'pointer', attempts = 3 } = {}) => {
    if (!expect) throw new Error('clickAt requires an expectation.');
    if (expect.valueChange && expect.valueChange.from === undefined) {
      expect.valueChange.from = (await valueOf(expect.valueChange.name)).value;
    }
    const started = Date.now();
    let outcome = null;
    let used = 0;
    let phases = { focus: 0, click: 0, verify: 0 };
    let screen = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      used = attempt;
      // The window can be re-placed after the driver attaches; a stale origin
      // would put this pointer somewhere the caller never asked for.
      refreshOrigin(`before clicking ${label}`);
      screen = toScreen(x, y);
      const settled = await waitSettled();
      const before = Date.now();
      focus();
      const focused = Date.now();
      clickRaw(screen.x, screen.y);
      const clicked = Date.now();
      try {
        outcome = await checkExpectation(expect);
        phases = {
          focus: focused - before,
          click: clicked - focused,
          verify: Date.now() - clicked,
        };
        break;
      } catch (error) {
        phases = {
          focus: focused - before,
          click: clicked - focused,
          verify: Date.now() - clicked,
        };
        if (attempt === attempts) throw error;
        const moved = fingerprintDiff(settled.fingerprint, await fingerprint());
        const verdict = await nothingHappened(expect);
        if (moved.length || !verdict.safe) {
          throw new Error(
            `${error.message} A retry is unsafe because ` +
              `${moved.length ? `the screen changed: ${moved.slice(0, 6).join(', ')}` : verdict.reason}. ` +
              'Stopping rather than risking a doubled action.',
          );
        }
        say(`  retry ${attempt}: ${verdict.reason}; clicking (${screen.x}, ${screen.y}) again`);
      }
    }
    await sleep(settle);
    const step = record({
      action: 'click',
      target: label,
      logicalRect: null,
      logical: { x, y },
      screen,
      outcome,
      attempts: used,
      ms: Date.now() - started,
      phases,
    });
    say(
      `  click ${label} at logical (${x}, ${y}) -> screen (${screen.x}, ${screen.y})\n` +
        `        ${outcome} in ${step.ms}ms after ${used} attempt(s) ` +
        `(focus ${step.phases.focus}, pointer ${step.phases.click}, verify ${step.phases.verify})`,
    );
    return step;
  };

  const typeText = async (text, { delay = 60 } = {}) => {
    const started = Date.now();
    focus();
    run('xdotool', ['type', '--delay', String(delay), text], { display });
    await sleep(settle);
    const step = record({ action: 'type', text, ms: Date.now() - started });
    say(`  type  "${text}" in ${step.ms}ms`);
    return step;
  };

  const pressKey = async (key) => {
    const started = Date.now();
    focus();
    run('xdotool', ['key', key], { display });
    await sleep(settle);
    const step = record({ action: 'key', key, ms: Date.now() - started });
    say(`  key   ${key}`);
    return step;
  };

  const scroll = async (direction = 'down', { times = 1 } = {}) => {
    const button = direction === 'up' ? '4' : '5';
    const started = Date.now();
    focus();
    for (let i = 0; i < times; i += 1) run('xdotool', ['click', button], { display });
    await sleep(settle);
    const step = record({ action: 'scroll', direction, times, ms: Date.now() - started });
    say(`  scroll ${direction} x${times} in ${step.ms}ms`);
    return step;
  };

  /**
   * Move the pointer without pressing anything.
   *
   * The wheel goes to whatever is under the pointer, so scrolling a panel means
   * parking the pointer over it first. Clicking there instead would be a
   * different action with side effects - and using a click to "aim" would make
   * the flow a lie about what the operator did.
   */
  const hover = async (x, y) => {
    const screen = toScreen(x, y);
    movePointer(screen.x, screen.y);
    const step = record({ action: 'hover', logical: { x, y }, screen });
    say(`  hover logical (${x}, ${y}) -> screen (${screen.x}, ${screen.y})`);
    return step;
  };

  /** Scroll with the pointer parked over a logical point. */
  const scrollAt = async (x, y, direction = 'down', { times = 1 } = {}) => {
    await hover(x, y);
    return scroll(direction, { times });
  };

  /**
   * Is this node's accumulated position trustworthy?
   *
   * A Flutter semantics rect is relative to the parent, and a parent that is
   * scroll-clipped publishes the *clipped* rectangle rather than its true one.
   * The opening-float card reports `top: 0` when its real top is -265, so
   * accumulating through it put "Abrir turno de caja" at y=881 when the button
   * renders at y=616. A node whose own rect is not inside its parent's reported
   * rect is a symptom of exactly that, so it is treated as unknown rather than
   * trusted - and an unknown position is resolved by measurement, never by
   * guessing.
   */
  const isTrustworthy = (node) => {
    let current = node;
    while (current.parent) {
      const parent = current.parent;
      // The child's rect is in the parent's own coordinate space, whose extent
      // is the parent's *size* - not the parent's rect, which is expressed in
      // the grandparent's space. Comparing the two rects directly is what first
      // made the plainly-visible "Cobrar" button look untrustworthy.
      const width = parent.rect?.width ?? 0;
      const height = parent.rect?.height ?? 0;
      if (
        current.rect &&
        parent.rect &&
        (current.rect.left < -0.5 ||
          current.rect.top < -0.5 ||
          current.rect.right > width + 0.5 ||
          current.rect.bottom > height + 0.5)
      ) {
        return false;
      }
      current = parent;
    }
    return true;
  };

  /** The nearest ancestor (or self) that can scroll. */
  const scrollerFor = (node) => {
    let current = node;
    while (current) {
      if (current.actions.some((action) => action.startsWith('scroll'))) return current;
      current = current.parent;
    }
    return null;
  };

  const scrollerState = async (scrollerId) => {
    const found = (await nodes()).find((node) => node.id === scrollerId);
    if (!found) throw new Error(`Scroller #${scrollerId} vanished.`);
    return {
      node: found,
      position: found.scrollPosition ?? 0,
      max: found.scrollExtentMax ?? 0,
      // The scroller's own rect is a viewport, not a clipped child, so its
      // centre is a safe place to park the pointer for wheel events.
      park: {
        x: Math.min(Math.max((found.absolute.left + found.absolute.right) / 2, 8), size.width - 8),
        y: Math.min(Math.max((found.absolute.top + found.absolute.bottom) / 2, 8), size.height - 8),
      },
    };
  };

  /** Drive a scroller to a logical offset, using the app's own position as feedback. */
  const setScroll = async (scrollerId, target) => {
    // One wheel click is worth an amount the driver does not control, so the
    // loop steps coarsely and then finely, and settles for the closest offset
    // it reached rather than insisting on an exact one it cannot hit. Callers
    // read the offset back out of the returned state, so a near miss is safe.
    let closest = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const state = await scrollerState(scrollerId);
      const wanted = Math.min(Math.max(target, 0), state.max);
      const delta = wanted - state.position;
      if (closest === null || Math.abs(delta) < Math.abs(closest.delta)) closest = { delta, state };
      if (Math.abs(delta) <= 12) return state;
      await scrollAt(state.park.x, state.park.y, delta > 0 ? 'down' : 'up', {
        times: Math.abs(delta) > 200 ? 6 : Math.abs(delta) > 80 ? 3 : 1,
      });
    }
    return closest.state;
  };

  /**
   * Work out where a node really is, and put it on screen if it is not.
   *
   * Fast path: the accumulated position is trustworthy and on screen.
   * Slow path: scroll the enclosing scroller to offset 0 - the one position
   * where no ancestor is clipped, so every rect is exact - measure there, then
   * scroll to the offset that brings the node into view and translate by that
   * known offset. Returns the point to click plus the evidence.
   */
  const resolveTarget = async (node, { label = null } = {}) => {
    const centreOf = (rect) => ({
      x: Math.round(origin.x + (rect.left + rect.right) / 2),
      y: Math.round(origin.y + (rect.top + rect.bottom) / 2),
    });
    const owner = scrollerFor(node);
    // A scrolled container is the dangerous case: its direct child can be
    // clipped at the top, which shifts every descendant's accumulated position
    // by an amount the dump does not reveal. Rather than try to detect that
    // per node, any target inside a scrolled container is resolved by
    // measurement. Scrolling to 0 makes every rect exact, because nothing can
    // be clipped above the fold at offset 0.
    const isScrolled = owner ? (owner.scrollPosition ?? 0) > 0 : false;
    // The accumulated position is preferred whenever the node is actually on
    // screen: for a node inside a scrolled panel it is already correct, and the
    // scroll-0 detour exists only for nodes the accumulation cannot place - the
    // clipped case, where the node is off screen and its reported rect is not
    // where it renders.
    if (isVisible(node) && (!isScrolled || isTrustworthy(node))) {
      return {
        node,
        logical: {
          x: (node.absolute.left + node.absolute.right) / 2,
          y: (node.absolute.top + node.absolute.bottom) / 2,
        },
        screen: centreOf(node.absolute),
        method: 'accumulated',
      };
    }
    const scroller = owner;
    if (!scroller) {
      // Nothing can scroll it, so there is no better measurement to take. Use
      // the accumulated position if it is on screen, and record that it was not
      // cross-checked; a click that misses still fails loudly downstream.
      if (!isVisible(node)) {
        const where = `${node.absolute.top.toFixed(0)}..${node.absolute.bottom.toFixed(0)}`;
        throw new Error(
          `${label ?? nameOf(node) ?? `node#${node.id}`} is not reachable: it sits at y ${where} in a ` +
            `view ${size.height} tall and no ancestor can scroll.`,
        );
      }
      return {
        node,
        logical: {
          x: (node.absolute.left + node.absolute.right) / 2,
          y: (node.absolute.top + node.absolute.bottom) / 2,
        },
        screen: centreOf(node.absolute),
        method: 'accumulated-unverifiable',
      };
    }
    const before = { position: (await scrollerState(scroller.id)).position };
    await setScroll(scroller.id, 0);
    const anchor = (await nodes()).find((candidate) => candidate.id === node.id);
    if (!anchor) {
      // A lazily built list only materialises the rows near the viewport, so
      // scrolling to the top can delete the very node being measured. Put the
      // scroll back and fall back to the accumulated position, labelled as
      // unverified rather than presented as a measurement.
      await setScroll(scroller.id, before.position);
      if (!isVisible(node)) {
        throw new Error(
          `${label ?? nameOf(node) ?? `node#${node.id}`} is off screen at y=${node.absolute.top.toFixed(0)} ` +
            'and scrolling away from it removes it from the semantics tree, so it cannot be measured.',
        );
      }
      return {
        node,
        logical: {
          x: (node.absolute.left + node.absolute.right) / 2,
          y: (node.absolute.top + node.absolute.bottom) / 2,
        },
        screen: centreOf(node.absolute),
        method: 'accumulated-unverified',
      };
    }
    /*
     * Bring the node into view by watching it, not by aiming at an offset.
     *
     * A wheel click moves a fixed number of pixels that the driver does not
     * control, so asking for an exact scroll offset overshoots and then
     * oscillates around it. What matters is only that the node ends up on
     * screen, and that is directly computable: the anchor's position measured at
     * offset 0, minus the offset the app reports now.
     */
    const margin = 8;
    let state = await scrollerState(scroller.id);
    // The node has to fit inside the *scroller's own box*, not merely inside
    // the window: a button 2px past a panel's bottom edge is inside the view and
    // still invisible, and stopping there put the click on the navigation bar
    // underneath instead of on the button.
    const box = state.node.absolute;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const renderedTop = anchor.absolute.top - state.position;
      const upper = box.top + margin;
      const lower = box.bottom - margin;
      if (renderedTop >= upper && renderedTop + anchor.absolute.height <= lower) break;
      const below = renderedTop + anchor.absolute.height > lower || renderedTop < upper;
      const remaining = Math.abs(
        renderedTop < upper && renderedTop + anchor.absolute.height <= lower
          ? upper - renderedTop
          : renderedTop + anchor.absolute.height - lower,
      );
      const direction =
        renderedTop < upper && renderedTop + anchor.absolute.height <= lower ? 'up' : 'down';
      await scrollAt(state.park.x, state.park.y, direction, {
        times: remaining > 120 ? 4 : remaining > 40 ? 2 : 1,
      });
      state = await scrollerState(scroller.id);
    }
    const renderedTop = anchor.absolute.top - state.position;
    if (
      renderedTop < box.top + margin ||
      renderedTop + anchor.absolute.height > box.bottom - margin
    ) {
      throw new Error(
        `Could not bring ${label ?? nameOf(anchor)} into view: it sits at y=${renderedTop.toFixed(0)} ` +
          `inside a panel running ${box.top.toFixed(0)}..${box.bottom.toFixed(0)}, ` +
          `with the scroller at ${state.position} of ${state.max}.`,
      );
    }
    const logicalTop = anchor.absolute.top - state.position;
    const logicalLeft = anchor.absolute.left;
    const logical = {
      x: (logicalLeft + anchor.absolute.right) / 2,
      y: logicalTop + anchor.absolute.height / 2,
    };
    if (logical.y < 0 || logical.y > size.height) {
      throw new Error(
        `After scrolling to ${state.position}, ${label ?? nameOf(anchor) ?? `node#${anchor.id}`} ` +
          `landed at y=${logical.y.toFixed(0)}, outside the 0..${size.height} view.`,
      );
    }
    return {
      node: anchor,
      logical,
      screen: centreOf({
        left: logicalLeft,
        right: anchor.absolute.right,
        top: logicalTop,
        bottom: logicalTop + anchor.absolute.height,
      }),
      method: 'measured-at-scroll-0',
      scroll: { position: state.position, max: state.max, anchorTop: anchor.absolute.top },
    };
  };

  /** The scroller that owns the on-screen content, for lazy lists. */
  const primaryScroller = async () => {
    const all = await nodes();
    const candidates = all.filter((node) =>
      node.actions.some((action) => action.startsWith('scroll')),
    );
    return (
      candidates.find((node) => isVisible(node) && node.absolute.height > size.height / 3) ??
      candidates[0] ??
      null
    );
  };

  /**
   * Find a name that only exists once its list has been scrolled near it.
   *
   * A lazily built list does not put off-screen rows in the semantics tree at
   * all, so "Cobrar · MXN 55.00" simply is not there until the tender body has
   * been scrolled down. Searching downwards and then back upwards is bounded,
   * reported, and gives up with the names it did see.
   */
  const scrollToFind = async (name, { sweeps = 12, times = 3, actionable = false } = {}) => {
    const visibleMatch = async () => (await findAll(name, { actionable })).find(isVisible) ?? null;
    const anyMatch = async () => (await findAll(name, { actionable }))[0] ?? null;
    if (await visibleMatch()) return visibleMatch();
    for (const direction of ['down', 'up']) {
      for (let attempt = 0; attempt < sweeps; attempt += 1) {
        const scroller = await primaryScroller();
        if (!scroller) return null;
        const park = {
          x: Math.min(
            Math.max((scroller.absolute.left + scroller.absolute.right) / 2, 8),
            size.width - 8,
          ),
          y: Math.min(
            Math.max((scroller.absolute.top + scroller.absolute.bottom) / 2, 8),
            size.height - 8,
          ),
        };
        const present = await anyMatch();
        // Once the row exists, keep nudging it in the direction that will bring
        // it on screen rather than walking past it.
        const way = present ? (present.absolute.top > size.height / 2 ? 'down' : 'up') : direction;
        await scrollAt(park.x, park.y, way, { times });
        const visible = await visibleMatch();
        if (visible) return visible;
      }
    }
    return null;
  };

  return {
    connection,
    // `facts` and `origin` are read by callers at any time during a run, so
    // they are exposed as live views of the current geometry rather than as
    // the values measured once at attach time.
    get facts() {
      return facts;
    },
    get origin() {
      return origin;
    },
    originDrift,
    get windowMissing() {
      return windowMissing;
    },
    get viewSize() {
      return size;
    },
    steps,
    display,
    reconnect,
    tree,
    nodes,
    fingerprint,
    fingerprintOf,
    fingerprintDiff,
    waitSettled,
    refreshOrigin,
    screenSummary,
    find,
    findAll,
    waitFor,
    waitReady,
    valueOf,
    snapshot,
    clickNode,
    clickText,
    clickAt,
    typeText,
    pressKey,
    scroll,
    hover,
    scrollAt,
    scrollIntoView,
    scrollToFind,
    primaryScroller,
    isVisible,
    isTrustworthy,
    resolveTarget,
    setScroll,
    shot,
    toScreen,
    verifyOrigin: () => verifyOrigin(display, origin),
  };
}

export { sleep, rpc };

// ---------------------------------------------------------------- command line

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}

const has = (name) => process.argv.includes(`--${name}`);

function positional() {
  const out = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const token = process.argv[index];
    if (token.startsWith('--')) {
      index += 1;
      continue;
    }
    out.push(token);
  }
  return out;
}

/**
 * The mapping's own test.
 *
 * Resolves the PIN keypad's "1", clicks it, and requires the digit counter to
 * move, printing the accumulated rect and the screen coordinate so the
 * arithmetic is auditable. Then it clicks an inert spot and requires the
 * counter *not* to move: without that control, a counter that changed for some
 * unrelated reason would look like a successful mapping.
 */
async function selfTest(driver) {
  await driver.waitReady({ until: 'Ingresa tu PIN' });
  const key = await driver.find('1', { actionable: true });
  process.stdout.write(
    `resolved key "1": node#${key.id} parent-relative ${rect(key.rect)} absolute ${rect(key.absolute)}\n`,
  );
  const pin = await driver.find('PIN');
  process.stdout.write(`PIN value before: "${pin.value}"\n`);

  await driver.clickText('1', {
    actionable: true,
    expect: { valueChange: { name: 'PIN', from: pin.value } },
    shotName: 'self-test-after-key-1',
  });

  // Negative control: same row as the keypad, but to the left of the key grid
  // (keys start at x=416). A click there must move nothing. If this control
  // ever starts "succeeding", the mapping has drifted and the click above
  // proved nothing.
  const stillOnKeypad = await driver
    .findAll('Ingresa tu PIN')
    .then((nodes) => nodes.some((node) => driver.isVisible(node)));
  if (!stillOnKeypad) {
    // The keypad submits once the PIN is long enough, and on a resumed session
    // it can go in a single digit. The control cannot run against a screen that
    // is no longer there, so it is reported as skipped rather than as a pass.
    process.stdout.write(
      'negative control: skipped - the till left the keypad after the first digit\n',
    );
    return { key, pin, inert: null, negativeControl: 'skipped-keypad-advanced' };
  }
  const after = await driver.find('PIN');
  const inert = await driver.clickAt(300, (key.absolute.top + key.absolute.bottom) / 2, {
    expect: { unchanged: { name: 'PIN', value: after.value } },
    label: 'inert spot left of the keypad',
  });
  process.stdout.write(
    `negative control: pointer at screen (${inert.screen.x}, ${inert.screen.y}) changed nothing\n`,
  );
  return { key, pin, inert };
}

async function main() {
  const [command, ...args] = positional();
  const shots = flag('shots', '/tmp/ux/pos-native-shots');
  const driver = await createDriver({
    vm: flag('vm'),
    log: flag('log', DEFAULT_LOG),
    windowName: flag('window', DEFAULT_WINDOW),
    shots: has('no-shots') ? null : shots,
  });
  const { origin, facts } = driver;
  process.stdout.write(
    `vm      ${driver.connection.base}\n` +
      `window  ${facts.windowId} frame ${facts.frame.width}x${facts.frame.height} at (${facts.frame.x}, ${facts.frame.y})\n` +
      `extents ${JSON.stringify(facts.extents)} -> view ${origin.width}x${origin.height}, header bar ${origin.headerBar}px\n` +
      `origin  (${origin.x}, ${origin.y});  screen = origin + logical\n`,
  );

  switch (command) {
    case 'probe': {
      const evidence = await driver.verifyOrigin();
      process.stdout.write(
        `pixel probes at the derived view edges:\n${JSON.stringify(evidence.probes, null, 2)}\n`,
      );
      break;
    }
    case 'tree': {
      const grep = flag('grep');
      for (const node of await driver.nodes()) {
        if (grep && !normalise(`${nameOf(node)} ${node.value}`).includes(normalise(grep))) continue;
        process.stdout.write(
          `#${String(node.id).padStart(3)} d${node.depth} abs ${rect(node.absolute).padEnd(28)} ` +
            `name="${nameOf(node)}" value="${node.value}" actions=[${node.actions.join(',')}]\n`,
        );
      }
      break;
    }
    case 'self-test':
      await selfTest(driver);
      break;
    case 'click': {
      const expectValueChange = flag('expect-value-change');
      const appears = flag('appears');
      const gone = flag('gone');
      const expect = expectValueChange
        ? {
            valueChange: {
              name: flag('node', 'PIN'),
              // No value given means "read it from the app first", which is the
              // only baseline that cannot be stale.
              from: expectValueChange === true ? undefined : expectValueChange,
            },
          }
        : appears
          ? { appears }
          : gone
            ? { gone }
            : null;
      if (!expect) throw new Error('Pass --expect-value-change, --appears or --gone.');
      await driver.clickText(args[0], { expect, index: Number(flag('index', 0)) });
      break;
    }
    case 'click-at': {
      const [x, y] = args.map(Number);
      const appears = flag('appears');
      if (!appears) throw new Error('click-at needs --appears NAME for its expectation.');
      await driver.clickAt(x, y, { expect: { appears }, label: flag('label', 'pointer') });
      break;
    }
    case 'type':
      await driver.typeText(args[0]);
      break;
    case 'key':
      await driver.pressKey(args[0]);
      break;
    case 'scroll':
      await driver.scroll(args[0] ?? 'down', { times: Number(flag('times', 1)) });
      break;
    case 'wait':
      await driver.waitFor(args[0], {
        timeout: Number(flag('timeout', 10000)),
        gone: has('gone'),
        actionable: has('actionable'),
      });
      process.stdout.write(`"${args[0]}" is ${has('gone') ? 'gone' : 'present'}\n`);
      break;
    case 'ready':
      await driver.waitReady({ timeout: Number(flag('timeout', 30000)) });
      process.stdout.write('the screen is settled\n');
      break;
    case 'shot': {
      process.stdout.write(`${await driver.shot(args[0] ?? 'shot')}\n`);
      break;
    }
    default:
      throw new Error(`Unknown command "${command}". See the header for usage.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
}
