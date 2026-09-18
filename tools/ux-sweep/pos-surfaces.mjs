#!/usr/bin/env node
/**
 * POS surface sweep - every actionable node, on every surface the app reaches.
 *
 * NOT THE RUNTIME OF RECORD. This drives the Flutter **web** build, and the POS
 * is a native application (`docs/architecture/2026-09-16-pos-is-a-native-app.md`).
 * It is kept as a development aid - it is quick to point at a layout while
 * iterating - and it must not be used to claim that a POS surface, a touch
 * target, or a flow has been verified. The native instrument is
 * `pos-native-driver.mjs` plus `pos-native-flows.mjs`, which click the real
 * Linux window; every POS figure that matters should come from there. The
 * runtime drift that produced this warning is recorded in that document.
 *
 * WHY THIS IS HAND-ROLLED INSTEAD OF `patrol`
 *
 * Plan step F2 names `patrol` as the driver. Patrol cannot drive this app. The
 * published platform table for patrol 4.10.0 lists `android, ios, macos, web`;
 * there is no Linux entry, so patrol cannot attach to the Linux desktop POS the
 * plan's section 3.2 measured. Source: https://pub.dev/api/packages/patrol
 * (`latest.pubspec.platforms`, read 2026-09-16); `patrol_cli` is 4.8.0. The
 * patrol-web path is reachable in principle but needs a chromedriver built for
 * the Chromium that Playwright pins, which is a second browser to keep in sync
 * with the rest of the sweep for no extra coverage. That reason is why this
 * file exists instead of a patrol suite, as docs/agents/tool-and-research-
 * doctrine.md requires.
 *
 * What we drive instead is the surface the rest of this sweep already uses: the
 * Flutter web build that `pnpm umi-pos:firefox` serves. Flutter web paints into
 * a canvas and only publishes an accessibility tree after the engine's
 * `flt-semantics-placeholder` ("Enable accessibility") is activated. Once it
 * is, the tree is real DOM: every node carries a role, a bounding box, and its
 * label - the same columns the Dashboard click inventory records.
 *
 * The sweep is driven, not scripted from source: it reads the bottom navigation
 * out of the live semantics tree, clicks each destination, and reports whatever
 * surface actually appeared, including a blank one.
 *
 * USAGE
 *
 *   1. Start the API and the POS web build:
 *        bash scripts/umi-pos-firefox.sh        # serves http://127.0.0.1:4002
 *   2. Start (or reuse) a Chromium with remote debugging on port 9222.
 *   3. node tools/ux-sweep/pos-surfaces.mjs
 *
 * FLAGS
 *
 *   --out <path>     JSON report.      Default /tmp/ux/pos-surfaces.json
 *   --md <path>      Markdown summary. Default /tmp/ux/pos-surfaces.md
 *   --shots <dir>    One screenshot per surface. Default /tmp/ux/pos-surfaces
 *   --delay <ms>     Pause between surface transitions. Default 1200. The API
 *                    allows 300 requests/minute per IP; one sweep is small, but
 *                    the pause keeps a loop of runs from tripping it.
 *   --viewport WxH   Viewport to measure at. Default 1024x768, the cafe tablet
 *                    in the plan's section 4. 1280x720 is the counter terminal.
 *   --keep-open      Leave the harness's tab open on exit (debugging only).
 *   --fresh-device   Clear the POS's stored device credential before the run,
 *                    so the sweep starts at the enrolment surface and walks the
 *                    whole pairing flow. Creates one new device row and one new
 *                    enrolment request in the database; both are reported.
 *   --self-test      Do not touch the app. Inject a known fixture into a blank
 *                    page and prove that the 44px check still fails a genuinely
 *                    small control while passing one a fold cut in half. See
 *                    "JUDGING A NODE'S SIZE" below.
 *
 * ENVIRONMENT (all optional; the defaults are the local development stack)
 *
 *   UMI_POS_URL          http://127.0.0.1:4002/
 *   UMI_API_URL          http://127.0.0.1:4001
 *   UX_CDP               http://127.0.0.1:9222
 *   UMI_SWEEP_EMAIL      admin@kalalacafe.mx     (local development login)
 *   UMI_SWEEP_PASSWORD   Umi2026!                (local development login)
 *   UMI_SWEEP_MERCHANT   1860305f-e864-d745-29e6-fb8830926cc6 (Kalala Cafe)
 *   UMI_SWEEP_LOCATION   7cb0a615-45e2-7e8e-b756-f95b295ec356 (Chapultepec)
 *   UMI_SWEEP_PIN        an operator PIN that works in the target database.
 *                        Default 1234, which is the local rehearsal operator
 *                        "Umi Consulting" (owner at Kalala Cafe). Local
 *                        development only; override it anywhere else.
 *
 * The exit code is 0 only when every surface it reached had zero unnamed
 * actionable nodes and zero actionable nodes under 44x44 once they have been
 * brought into view.
 *
 * JUDGING A NODE'S SIZE (why a node gets measured twice)
 *
 * A Flutter web semantics node is not always published at its own size. The
 * engine publishes `semanticsClipRect INTERSECT semanticBounds`, intersected
 * again with the ancestor `paintClipRect`, so a row that a list viewport cuts
 * in half is published as the visible remainder. Read on 2026-09-16 against the
 * release build: the category rail's scroll container is `flt-semantics
 * [role=group]` at 380,80,172,584 with `overflow: scroll` and `scrollHeight`
 * 936; setting its `scrollTop = 280` re-measures the same node, `POSTRES`, at
 * 172x72 after it had been read as 172x8. On `nav-caja` the two quantity
 * steppers on the row the card's viewport cut read 48x37 and re-measure at
 * 48x48, and the whole of the row that was reported was reported at its
 * visible remainder. The app is right and the instrument was wrong, which is
 * why the sweep scrolls before it judges instead of making the app smaller to
 * suit it.
 *
 * So for every actionable node whose published box is under the floor, the
 * extractor:
 *
 *   1. finds the nearest ancestor that actually scrolls (any element with
 *      `overflow: auto|scroll|overlay` whose content overflows - in this app
 *      that is a `flt-semantics` group, and the fixture in `--self-test` is a
 *      plain div, so the rule is written generically);
 *   2. scrolls that ancestor to bring the node into view, in whichever
 *      direction and on whichever axis it is cut - a node clipped at the
 *      bottom, or published entirely above the container's top edge, both
 *      count, and a node flush with a clip edge is probed too, because
 *      Flutter publishes the *intersection*, which lands exactly on that edge;
 *   3. re-measures after the frames settle, and repeats at up to three scroll
 *      positions, taking the largest box it saw on each axis.
 *
 * The node keeps both boxes, and the gate judges the larger one:
 *
 *   rectBeforeScroll   the box as published, with the page untouched. This is
 *                      what the report used to call `width`/`height`, and it
 *                      is still what `x`/`y` point at, because that is where
 *                      the screenshot was taken and where a click lands.
 *   rectAfterScroll    the box after the last reveal attempt.
 *   clipped            true when revealing grew the box, i.e. a clip cut it.
 *   scrolledToMeasure  true when an ancestor was scrolled to judge this node.
 *   judgedWidth/Height the number the 44px floor is applied to.
 *
 * Per surface and in the totals, `subtouch` and `subtouchAfterScroll` are the
 * same count of nodes still under the floor after the reveal - `subtouch` is
 * the gate, `subtouchAfterScroll` names it in the terms of the change - and
 * `subtouchBeforeScroll` preserves the number the instrument used to report, so
 * a reader can see the correction rather than take it on trust.
 *
 * To convince yourself the undersized path still fails a small control, run
 * `node tools/ux-sweep/pos-surfaces.mjs --self-test`. It builds three controls
 * on a blank page: a 20x20 one, and two 48x48 ones that an `overflow: scroll`
 * ancestor has cut - one at its bottom edge, one entirely above its top edge,
 * the shape a node published off-screen has. It asserts the 20x20 node is still
 * flagged after the reveal, the two 48x48 nodes are not, and that all three are
 * flagged when the floor is inflated to 200px, which proves the comparison is
 * live rather than exempted. It needs no app and no API.
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const WORKSPACE = process.env.UX_WORKSPACE || '/home/jc/umi';
const require = createRequire(`${WORKSPACE}/`);
const { chromium } = require('@playwright/test');

/* args ------------------------------------------------------------------- */

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
const hasFlag = (flag) => process.argv.includes(flag);

const OUT = arg('--out', '/tmp/ux/pos-surfaces.json');
const MD = arg('--md', '/tmp/ux/pos-surfaces.md');
const SHOTS = arg('--shots', '/tmp/ux/pos-surfaces');
const DELAY = Number(arg('--delay', '1200'));
const KEEP_OPEN = hasFlag('--keep-open');
const FRESH_DEVICE = hasFlag('--fresh-device');
const SELF_TEST = hasFlag('--self-test');

/** `--viewport 1280x720`; the plan's section 4 names the tablet and the counter. */
function parseViewport(raw) {
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(String(raw || '').trim());
  if (!match) {
    throw new Error(
      `--viewport expects WxH in pixels, for example 1280x720; got "${raw}". ` +
        'Accepted: 1024x768 (cafe tablet, the default) or 1280x720 (counter terminal).',
    );
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

const VIEWPORT = parseViewport(arg('--viewport', '1024x768'));
const VIEWPORT_FLAG = arg('--viewport');

if (hasFlag('--help') || hasFlag('-h')) {
  process.stdout.write(
    'node tools/ux-sweep/pos-surfaces.mjs [--out PATH] [--md PATH] [--shots DIR]\n' +
      '  [--delay MS] [--viewport WxH] [--keep-open] [--fresh-device] [--self-test]\n\n' +
      'Drives the running POS web build over CDP, walks every surface it can\n' +
      'reach, and writes a JSON report plus a markdown summary. Exits non-zero\n' +
      'when an actionable node is unnamed or smaller than 44x44 after being\n' +
      'brought into view. --self-test proves that check still fails a small\n' +
      'control; it needs no app and touches no database.\n',
  );
  process.exit(0);
}

const POS_URL = process.env.UMI_POS_URL || 'http://127.0.0.1:4002/';
const API_BASE = process.env.UMI_API_URL || 'http://127.0.0.1:4001';
const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const EMAIL = process.env.UMI_SWEEP_EMAIL || 'admin@kalalacafe.mx';
const PASSWORD = process.env.UMI_SWEEP_PASSWORD || 'Umi2026!';
const MERCHANT = process.env.UMI_SWEEP_MERCHANT || '1860305f-e864-d745-29e6-fb8830926cc6';
const LOCATION = process.env.UMI_SWEEP_LOCATION || '7cb0a615-45e2-7e8e-b756-f95b295ec356';
const OPERATOR_PIN = process.env.UMI_SWEEP_PIN || '1234';

/** The 44 px pointer-target floor, from the plan's design tokens. */
const MIN_TARGET = 44;

/* api client -------------------------------------------------------------- */

/**
 * The admin endpoints the sweep needs are cookie-authenticated with a CSRF
 * header, so the client keeps its own jar. The POS pairing endpoints are
 * `@Public()` and need no cookie at all.
 */
function apiClient() {
  const jar = new Map();
  return {
    cookieHeader: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    /**
     * One call, with a short retry for a transport failure. The API runs under
     * `nest start --watch` in this workspace, so it drops its listener for a
     * few seconds whenever a source file changes; a sweep that dies on that is
     * reporting the editor, not the POS.
     */
    async call(method, path, body, attempts = 4) {
      const headers = { accept: 'application/json', cookie: this.cookieHeader() };
      if (body) headers['content-type'] = 'application/json';
      if (jar.get('umi_csrf')) headers['x-umi-csrf'] = jar.get('umi_csrf');
      let res = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          res = await fetch(`${API_BASE}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          break;
        } catch (error) {
          if (attempt === attempts) throw error;
          await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
        }
      }
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const i = pair.indexOf('=');
        jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = text.slice(0, 400);
      }
      return { status: res.status, ok: res.ok, json };
    },
  };
}

const uuid = () => crypto.randomUUID();

/* extractor --------------------------------------------------------------- */

/**
 * Runs in the page. Returns every node the POS exposes as interactive.
 *
 * Flutter web publishes labels two ways: on the node itself (`aria-label`, or
 * the element's own text) and, for text fields, on a real `<input>` child
 * carrying `data-semantics-role`. A parent never inherits a child's label, so
 * text belonging to a nested semantics node is excluded from the parent's own
 * text.
 *
 * "Actionable" means the engine gave the node an interactive role, a
 * `data-semantics-role`, or a real form tag. A node that is merely readable
 * text (the enrolment counter, the PIN dot row) is recorded as `kind: "text"`
 * and stays out of the actionable counts - the native harness draws the same
 * line by asking the tree for a tap action.
 */
const EXTRACT = async (opts = {}) => {
  const MIN_TARGET = Number.isFinite(opts.minTarget) ? opts.minTarget : 44;
  const REMEASURE = opts.remeasure === true;
  const SELF_TEST = opts.selfTest === true;
  const rootEl = document.querySelector(opts.root || 'flt-semantics-host') || document.body;

  const INTERACTIVE_ROLES = new Set([
    'button',
    'link',
    'tab',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'checkbox',
    'radio',
    'switch',
    'combobox',
    'slider',
    'spinbutton',
    'textbox',
    'searchbox',
    'option',
    'listbox',
    'treeitem',
    'gridcell',
  ]);
  const FORM_TAGS = new Set(['INPUT', 'BUTTON', 'A', 'SELECT', 'TEXTAREA']);

  const ownText = (el) => {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.textContent;
      else if (node.nodeType === 1 && node.tagName !== 'FLT-SEMANTICS') text += node.textContent;
    }
    return text.replace(/\s+/g, ' ').trim();
  };

  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      if (node.id) {
        parts.unshift(`#${node.id}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  /* measurement ------------------------------------------------------------ */

  const round = (value) => Math.round(value);
  const rawRect = (el) => el.getBoundingClientRect();
  const boxOf = (rect) => ({
    x: round(rect.left),
    y: round(rect.top),
    width: round(rect.width),
    height: round(rect.height),
  });

  /**
   * A frame, with a timer as the backstop. The shared headless Chromium holds
   * several pages, and a background page can have its animation frames
   * throttled; waiting on `requestAnimationFrame` alone would hang the sweep.
   */
  const nextFrame = () =>
    new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 80);
    });

  const settle = async (frames = 3) => {
    for (let i = 0; i < frames; i += 1) await nextFrame();
  };

  /**
   * The nearest ancestor that can actually scroll, i.e. one whose content
   * overflows it. Written against `overflow` on both axes rather than against
   * `flt-semantics`, because the clip rule this undoes is Flutter's, not the
   * DOM's: the fixture `--self-test` injects is a plain div.
   */
  const scrollAncestorOf = (el) => {
    let node = el.parentElement;
    while (node && node instanceof Element && node !== rootEl) {
      if (node !== document.body && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const scrollable = /(auto|scroll|overlay)/.test(`${style.overflowX} ${style.overflowY}`);
        const overflowing =
          node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
        if (scrollable && overflowing) return node;
      }
      node = node.parentElement;
    }
    return null;
  };

  const describeAncestor = (el, before) => {
    const rect = boxOf(rawRect(el));
    return {
      selector: cssPath(el),
      role: el.getAttribute('role'),
      rect,
      clientWidth: round(el.clientWidth),
      clientHeight: round(el.clientHeight),
      scrollWidth: round(el.scrollWidth),
      scrollHeight: round(el.scrollHeight),
      scrollTopBefore: before ? round(before.scrollTop) : null,
      scrollLeftBefore: before ? round(before.scrollLeft) : null,
      scrollTopAfter: round(el.scrollTop),
      scrollLeftAfter: round(el.scrollLeft),
    };
  };

  /**
   * Bring the node in `state` into view by scrolling ancestors only, then
   * re-measure. Returns the boxes measured at each scroll position. A node
   * Flutter cut by the fold is published with its edge exactly flush with the
   * clip edge, and whatever the engine did not draw it also did not report - so
   * the only way to learn the real size is to move the content and read again.
   */
  const reveal = async (state, touched) => {
    // Flutter can replace a semantics element while probing, and an orphan's
    // rectangle stops moving with the container. Re-resolve by id when that
    // happens rather than measuring a detached node.
    const resolve = () => {
      if (state.el.isConnected) return state.el;
      const again = state.id ? document.getElementById(state.id) : null;
      if (again) state.el = again;
      return again;
    };

    const container = scrollAncestorOf(state.el);
    if (!container) return { container: null, before: null, boxes: [], scrolled: false };
    if (!touched.has(container)) {
      touched.set(container, {
        el: container,
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
      });
    }
    const origin = touched.get(container);
    const before = { scrollTop: origin.scrollTop, scrollLeft: origin.scrollLeft };

    const maxTopOf = () => Math.max(0, container.scrollHeight - container.clientHeight);
    const maxLeftOf = () => Math.max(0, container.scrollWidth - container.clientWidth);
    const scrollTo = async (top, left) => {
      const nextTop = Math.max(0, Math.min(maxTopOf(), top));
      const nextLeft = Math.max(0, Math.min(maxLeftOf(), left));
      if (nextTop === container.scrollTop && nextLeft === container.scrollLeft) return false;
      container.scrollTop = nextTop;
      container.scrollLeft = nextLeft;
      container.dispatchEvent(new Event('scroll'));
      await settle();
      return true;
    };

    // Every probe starts from the position the node was published at, because
    // probing an earlier node on the same container will have moved it.
    await scrollTo(origin.scrollTop, origin.scrollLeft);

    /**
     * Wait for the engine to republish the node's box, then return it.
     *
     * Scrolling the container moves the element, but the *size* it reports is
     * the engine's clip, and the engine republishes that on its own schedule.
     * Measured on the release build at 1280x720: scrolling the cart list to the
     * end revealed `Disminuir cantidad` as 48x48 immediately, while `Aumentar
     * cantidad` in the same row still read 48x41 three frames later and needed
     * longer - so a fixed number of frames makes this gate flip between runs.
     */
    const waitForRepublish = async (el, baseline, budget = 15) => {
      for (let i = 0; i < budget; i += 1) {
        await nextFrame();
        const live = resolve();
        if (!live) return null;
        const now = boxOf(rawRect(live));
        if (now.width !== baseline.width || now.height !== baseline.height) return now;
      }
      const last = resolve();
      return last ? boxOf(rawRect(last)) : null;
    };

    const boxes = [];
    let scrolled = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let el = resolve();
      if (!el) break;
      const cRect = rawRect(container);
      const eRect = rawRect(el);
      // What clips the node is the container's client box - the padding box
      // minus the scrollbars - not its border box. On this app the two are the
      // same size, which is why the first version of this looked right and was
      // not: the self-test's fixture has a visible scrollbar.
      const band = {
        top: cRect.top,
        left: cRect.left,
        bottom: cRect.top + container.clientHeight,
        right: cRect.left + container.clientWidth,
      };
      let targetTop = container.scrollTop;
      let targetLeft = container.scrollLeft;
      let dy = 0;
      let dx = 0;
      if (attempt === 0) {
        // Flush with an edge of the band, or outside it: both mean a clip is in
        // play. Putting the published top-left corner on the band's top-left
        // corner shows as much of the node as the band can hold, whichever side
        // the clip cut and without needing to know the node's real size. The
        // one case this cannot fix is a node cut at the band's own top-left
        // edge, where the move is a no-op; the fallback probes below try the
        // ends of the scroll range for that.
        if (eRect.bottom >= band.bottom - 1 || eRect.top < band.top) {
          dy = eRect.top - band.top;
        }
        if (eRect.right >= band.right - 1 || eRect.left < band.left) {
          dx = eRect.left - band.left;
        }
        targetTop += dy;
        targetLeft += dx;
      } else {
        // Still under the floor after centring. Either the cut is on the far
        // side or the first position was clamped, so try the ends of the
        // scrollable range. The largest box measured wins, so a probe that
        // moves the node out of view cannot make a small control pass.
        targetTop = attempt === 1 ? maxTopOf() : 0;
        targetLeft = attempt === 1 ? maxLeftOf() : 0;
      }
      if (targetTop === container.scrollTop && targetLeft === container.scrollLeft) break;
      if (!(await scrollTo(targetTop, targetLeft))) break;
      scrolled = true;
      el = resolve();
      if (!el) break;
      const measured = await waitForRepublish(el, boxOf(eRect));
      if (!measured) break;
      boxes.push({
        attempt: attempt + 1,
        scrollTop: round(container.scrollTop),
        scrollLeft: round(container.scrollLeft),
        rect: measured,
      });
      const seen = boxes[boxes.length - 1].rect;
      if (seen.width >= MIN_TARGET && seen.height >= MIN_TARGET) break;
    }
    return { container, before, boxes, scrolled };
  };

  /**
   * The `--self-test` fixture. Flutter publishes a clipped node as the visible
   * remainder, so the fixture reproduces exactly that rule: the element's own
   * height is set to the slice its scrollable ancestor shows. That makes the
   * reveal path testable without waiting for the real app to happen to cut a
   * control at the right height.
   */
  const buildSelfTestFixture = () => {
    const box = document.createElement('div');
    box.id = 'ux-sweep-selftest';
    box.style.cssText =
      'position:fixed;left:0;top:0;width:240px;height:120px;overflow:scroll;' +
      'z-index:2147483647;background:#111;';
    const spacer = document.createElement('div');
    spacer.style.cssText = 'height:420px;width:120px;';
    box.append(spacer);
    const specs = [
      { id: 'small', label: 'SELF-TEST small 20x20', size: 20, contentTop: 100 },
      { id: 'below', label: 'SELF-TEST clipped at the bottom 48x48', size: 48, contentTop: 180 },
      { id: 'above', label: 'SELF-TEST published above the top 48x48', size: 48, contentTop: 40 },
    ];
    const parts = specs.map((spec) => {
      const el = document.createElement('button');
      el.id = `ux-sweep-selftest-${spec.id}`;
      el.setAttribute('aria-label', spec.label);
      el.style.cssText =
        `position:absolute;left:0;width:${spec.size}px;padding:0;border:0;display:block;` +
        'background:#333;color:#fff;';
      el.style.top = `${spec.contentTop}px`;
      el.style.height = `${spec.size}px`;
      box.append(el);
      return { ...spec, el };
    });
    const applyClip = () => {
      for (const part of parts) {
        const visibleTop = Math.max(part.contentTop, box.scrollTop);
        const visibleBottom = Math.min(
          part.contentTop + part.size,
          box.scrollTop + box.clientHeight,
        );
        part.el.style.top = `${part.contentTop}px`;
        part.el.style.height = `${Math.max(0, visibleBottom - visibleTop)}px`;
      }
    };
    box.addEventListener('scroll', applyClip);
    document.body.append(box);
    const initial = { scrollTop: 80, scrollLeft: 0 };
    box.scrollTop = initial.scrollTop;
    applyClip();
    return {
      made: parts,
      snapshot: () => describeAncestor(box, initial),
      teardown: () => {
        box.removeEventListener('scroll', applyClip);
        box.remove();
      },
    };
  };

  const fixture = SELF_TEST ? buildSelfTestFixture() : null;
  const touched = new Map();
  const selector = 'flt-semantics, input, button, a[href], textarea, select';
  const nodes = [];
  let index = 0;
  const undersized = [];
  // Pass 1, with the page exactly as the screenshot found it. Every node is
  // read here because the box a node is published with depends on where its
  // container is scrolled to: probing one node and then reading the next would
  // describe the surface at a scroll position nobody ever saw.
  for (const el of rootEl.querySelectorAll(selector)) {
    const rect = rawRect(el);
    if (rect.width <= 0 || rect.height <= 0) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const role = el.getAttribute('role');
    const dsr = el.getAttribute('data-semantics-role');
    const name = el.getAttribute('aria-label') || ownText(el);
    const label = name.replace(/\s+/g, ' ');
    const actionable =
      (role !== null && INTERACTIVE_ROLES.has(role)) ||
      (dsr !== null && dsr !== 'container') ||
      FORM_TAGS.has(el.tagName);
    if (!actionable && !label) continue;
    const disabled = el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled');
    const esc = (value) => String(value).replace(/["\\]/g, '\\$&');
    const query = role
      ? `flt-semantics[role="${esc(role)}"]${name ? `[aria-label="${esc(name)}"]` : ''}`
      : el.tagName.toLowerCase();

    const published = boxOf(rect);
    // Only a node that fails the floor needs the second look; a box that is
    // already large enough cannot be hiding a smaller control.
    const underFloor = published.width < MIN_TARGET || published.height < MIN_TARGET;
    const node = {
      index: index++,
      kind: actionable ? 'actionable' : 'text',
      label: label.slice(0, 120),
      role: dsr || role || el.tagName.toLowerCase(),
      width: published.width,
      height: published.height,
      x: published.x + Math.round(rect.width / 2),
      y: published.y + Math.round(rect.height / 2),
      disabled,
      selector: cssPath(el),
      querySelector: query,
      rectBeforeScroll: published,
      // Overwritten in pass 2 for a node that gets probed; until then the
      // published box is the only measurement there is.
      rectAfterScroll: null,
      judgedWidth: published.width,
      judgedHeight: published.height,
      clipped: false,
      scrolledToMeasure: false,
      clipAncestor: null,
      clipProbes: [],
      rectKey: [published.x, published.y, published.width, published.height].join(':'),
    };
    nodes.push(node);
    if (REMEASURE && actionable && underFloor) undersized.push({ node, el, id: el.id || null });
  }

  // Pass 2: judge each undersized node from the published state, so its box is
  // the one it was published with, then from whatever the container can reveal.
  for (const { node, el, id } of undersized) {
    const probe = await reveal({ el, id }, touched);
    if (!probe.container) continue;
    const measured = [node.rectBeforeScroll, ...probe.boxes.map((b) => b.rect)];
    node.judgedWidth = Math.max(...measured.map((r) => r.width));
    node.judgedHeight = Math.max(...measured.map((r) => r.height));
    node.clipped = node.judgedWidth > node.width || node.judgedHeight > node.height;
    node.rectAfterScroll = probe.boxes.length ? probe.boxes[probe.boxes.length - 1].rect : null;
    node.scrolledToMeasure = probe.scrolled;
    node.clipAncestor = describeAncestor(probe.container, probe.before);
    node.clipProbes = probe.boxes;
  }

  // Put every container back where it was found, so the screenshot and any
  // click the caller makes afterwards see the surface as a person finds it.
  for (const entry of touched.values()) {
    entry.el.scrollTop = entry.scrollTop;
    entry.el.scrollLeft = entry.scrollLeft;
  }
  if (touched.size) await settle(1);
  const selfTest = fixture ? { container: fixture.snapshot() } : null;
  fixture?.teardown();

  // Flutter nests a tappable semantics node inside a same-size wrapper often
  // enough that geometry alone double-counts a control. Collapse nodes that
  // share an exact rectangle into one entry, keeping a labelled member: a
  // control that repeats its own target at the same size is one target, and the
  // nameless half is an artefact of the nesting, not an unnamed button.
  const byRect = new Map();
  for (const node of nodes) {
    const group = byRect.get(node.rectKey) ?? [];
    group.push(node);
    byRect.set(node.rectKey, group);
  }
  const dropped = new Set();
  for (const group of byRect.values()) {
    if (group.length < 2) continue;
    const labels = new Set(group.map((n) => n.label).filter(Boolean));
    if (labels.size > 1) continue; // two different controls that happen to overlap
    const keep = group.find((n) => n.label) ?? group[0];
    for (const node of group) if (node !== keep) dropped.add(node.index);
  }
  return {
    nodes: nodes.filter((n) => !dropped.has(n.index)),
    duplicates: dropped.size,
    selfTest,
  };
};

/* browser side ------------------------------------------------------------ */

async function loadPos(page) {
  // Always navigate to the root, never `reload()`: the web build routes by URL,
  // so reloading on `.../#/inventory` restores the inventory surface instead of
  // the entry flow the sweep needs to start from.
  await page.goto(POS_URL, { waitUntil: 'load' });
  // Flutter web takes a beat to mount and to paint its first frame.
  await page.waitForTimeout(5000);
  // The engine only builds the semantics tree once the placeholder is
  // activated. `.click({ force: true })` fails here: the placeholder has zero
  // size, so Playwright reports "element is outside of the viewport". A DOM
  // click is what the engine listens for.
  await page.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click());
  // The semantics tree is rebuilt as the app renders; give it a moment to
  // reach a steady surface before anything tries to read or click it.
  for (let i = 0; i < 6; i += 1) {
    const surface = classify(await readNodes(page));
    if (surface !== 'unknown') return surface;
    await page.waitForTimeout(1500);
  }
  return 'unknown';
}

const readTree = (page) => page.evaluate(EXTRACT);
const readNodes = async (page) => (await readTree(page)).nodes;
const labelsOf = (nodes) =>
  nodes
    .map((n) => n.label)
    .filter(Boolean)
    .join(' | ');

/** Which surface is on screen, decided from what the app itself published. */
function classify(nodes) {
  const text = labelsOf(nodes);
  const actionable = nodes.filter((n) => n.kind === 'actionable');
  if (/Registrar este dispositivo/.test(text)) return 'entry:enrollment';
  if (/Se requiere la aprobación del administrador/.test(text)) return 'entry:approval-pending';
  if (/PIN de operador/.test(text)) return 'entry:operator-pin';
  if (/Iniciar sesión en UmiPOS/.test(text)) return 'entry:password';
  // The catalog is the only surface that carries the navigation bar, so the
  // bar's own first destination is the signal; a label like "Ventas" alone
  // matches the sales screen as well.
  if (actionable.some((n) => n.role === 'tab' && /^(Comanda|Order)$/.test(n.label))) {
    return 'catalog';
  }
  if (actionable.length && actionable.every((n) => n.role === 'menuitem')) return 'overflow-menu';
  if (/Centro de caja/.test(text)) return 'cash-center';
  if (/Ventas suspendidas|Ventas completadas recientes/.test(text)) return 'sales-history';
  if (/Actualizar/.test(text) && /Cocina/.test(text)) return 'kitchen-board';
  if (/Pedidos entrantes/.test(text)) return 'incoming-orders';
  if (/Centro de hardware/.test(text)) return 'hardware-center';
  if (/Centro de clientes/.test(text)) return 'customer-center';
  if (/Operaciones de inventario/.test(text)) return 'inventory';
  if (/Centro de recuperación/.test(text)) return 'recovery-center';
  if (/Bloquear operador/.test(text)) return 'settings-sheet';
  return 'unknown';
}

/** Click a node by its centre, the way a finger on a counter tablet would. */
async function clickNode(page, node) {
  await page.mouse.click(node.x, node.y);
  await page.waitForTimeout(500);
}

/** A label turned into a stable, filesystem-safe stem. */
function slugify(label) {
  return (
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\W+/g, '-')
      .replace(/^-+|-+$/g, '') || 'surface'
  );
}

async function findNode(page, predicate, tries = 10) {
  for (let i = 0; i < tries; i += 1) {
    const nodes = await readNodes(page);
    const hit = nodes.find(predicate);
    if (hit) return hit;
    await page.waitForTimeout(500);
  }
  return null;
}

/* the flow ---------------------------------------------------------------- */

async function ensureOperator(page, api, log, report) {
  let nodes = await readNodes(page);
  let surface = classify(nodes);
  log(`entry surface: ${surface}`);
  // The entry surfaces are surfaces too, and the plan's section 3.2 baseline
  // was measured on one of them. Record the first sighting of each so a rerun
  // lands while already signed in is still comparable.
  if (report && surface !== 'catalog' && surface !== 'unknown') {
    if (!report.surfaces.some((s) => s.surface === surface)) {
      await record(page, surface, report);
    }
  }

  if (surface === 'entry:enrollment') {
    const begun = await api.call('POST', `/api/v1/merchants/${MERCHANT}/devices/enrollment`, {
      locationId: LOCATION,
      displayName: 'UX sweep POS',
      type: 'pos_terminal',
      // The claim sends `kIsWeb ? 'web' : defaultTargetPlatform.name`, and the
      // API refuses a claim whose platform differs from the request's, so the
      // request has to be opened for the platform that will claim it.
      platform: 'web',
      mobility: 'static',
      idempotencyKey: uuid(),
    });
    if (!begun.ok) {
      throw new Error(`enrollment begin failed: ${begun.status} ${JSON.stringify(begun.json)}`);
    }
    const { setupCode, enrollmentRequestId } = begun.json;
    log(`enrollment opened: ${enrollmentRequestId} code ${setupCode}`);
    // Everything the sweep creates is named here, so a later run can clean up
    // after this one without guessing which rows are its own.
    report?.created?.enrollmentRequestIds.push(enrollmentRequestId);

    // The code field is published as a real `<input data-semantics-role=
    // "text-field">`, so it is the only node on this surface with that role.
    const codeField = await findNode(
      page,
      (n) => n.role === 'text-field' || n.querySelector.startsWith('input'),
    );
    if (!codeField) throw new Error('no enrolment code field on the enrolment surface');
    // Type until the screen says the code is complete. The field publishes a
    // live "Quedan N caracteres" counter, so this loop proves the keystrokes
    // reached the app instead of assuming they did - which is exactly how the
    // first version of this harness "clicked Continuar" on an empty box.
    let typed = false;
    for (let attempt = 0; attempt < 4 && !typed; attempt += 1) {
      await clickNode(page, codeField);
      await page.keyboard.type(setupCode, { delay: 60 });
      await page.waitForTimeout(800);
      const counter = (await readNodes(page)).find((n) => /Quedan \d+ caracteres/.test(n.label));
      typed = counter ? /Quedan 0 caracteres/.test(counter.label) : true;
      if (!typed) {
        log(`enrolment code entry attempt ${attempt + 1} did not register; retrying`);
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(300);
      }
    }
    const submit = await findNode(page, (n) => n.label === 'Continuar' && n.kind === 'actionable');
    if (!submit) throw new Error('no Continuar button on the enrolment surface');
    if (submit.disabled) throw new Error('Continuar is still disabled after typing the code');
    await clickNode(page, submit);
    await page.waitForTimeout(2500);

    const approved = await api.call(
      'POST',
      `/api/v1/merchants/${MERCHANT}/devices/enrollment-requests/${enrollmentRequestId}/approve`,
      { idempotencyKey: uuid() },
    );
    log(`enrollment approve: ${approved.status}`);
    if (!approved.ok) {
      throw new Error(`approve failed: ${approved.status} ${JSON.stringify(approved.json)}`);
    }
  }

  // An approval can be delivered by the poll loop or the socket nudge; either
  // way the device credential lands and the app moves on by itself.
  for (let i = 0; i < 25; i += 1) {
    nodes = await readNodes(page);
    surface = classify(nodes);
    if (surface !== 'entry:enrollment' && surface !== 'entry:approval-pending') break;
    await page.waitForTimeout(1000);
  }
  log(`after approval: ${surface}`);

  if (surface === 'entry:operator-pin') {
    // The plan's baseline (section 3.2) was taken on this screen, so it belongs
    // in the report even though the sweep immediately signs in past it.
    if (report && !report.surfaces.some((s) => s.surface === surface)) {
      await record(page, surface, report);
    }
    surface = await enterPin(page, log);
  }
  return surface;
}

/**
 * Enter the operator PIN. Two real interaction paths, both of which an
 * operator has: tapping the on-screen keypad, and typing on a physical
 * keyboard, which the screen's KeyboardListener accepts. The dots are not
 * exposed through `aria-label`, so success is proven by the screen changing
 * rather than by reading the field back.
 */
async function enterPin(page, log) {
  const wait = async (ms) => page.waitForTimeout(ms);
  const tap = async () => {
    for (const digit of OPERATOR_PIN) {
      const key = await findNode(
        page,
        (n) => n.kind === 'actionable' && n.label === digit && n.width < 300 && n.height < 200,
        4,
      );
      if (!key) return false;
      await clickNode(page, key);
    }
    const submit = await findNode(
      page,
      (n) => n.kind === 'actionable' && n.label === 'Continuar',
      4,
    );
    if (submit) await clickNode(page, submit);
    await wait(4000);
    return true;
  };
  const type = async () => {
    const clear = await findNode(
      page,
      (n) => n.kind === 'actionable' && /Borrar todo/.test(n.label),
      3,
    );
    if (clear) await clickNode(page, clear);
    await page.keyboard.type(OPERATOR_PIN, { delay: 120 });
    await wait(600);
    await page.keyboard.press('Enter');
    await wait(4000);
  };

  const settle = async () => {
    for (let i = 0; i < 20; i += 1) {
      const surface = classify(await readNodes(page));
      if (surface !== 'entry:operator-pin') return surface;
      await wait(1000);
    }
    return 'entry:operator-pin';
  };

  // One attempt per strategy: a rejected PIN is counted against the device, so
  // the harness does not retry into a lockout.
  let surface = classify(await readNodes(page));
  if (surface !== 'entry:operator-pin') return surface;
  await tap();
  surface = await settle();
  if (surface !== 'entry:operator-pin') {
    log(`after operator PIN (keypad): ${surface}`);
    return surface;
  }
  await type();
  surface = await settle();
  log(`after operator PIN: ${surface}`);
  return surface;
}

/**
 * The bottom navigation, read out of the live tree rather than the source.
 *
 * Flutter's `NavigationBar` publishes each destination with `role="tab"`. That
 * role is the whole filter: the catalog's category chips and product tiles sit
 * in a scrollable body that reaches into the same y-range as the bar, so a
 * geometry-only rule reports "Americano" as a destination.
 */
function navDestinations(nodes, viewport) {
  return nodes.filter(
    (n) => n.kind === 'actionable' && n.role === 'tab' && n.y > viewport.height - 130 && n.label,
  );
}

async function record(page, surface, report) {
  // Picture first: judging a node's size scrolls its list container, and the
  // screenshot should show the surface as a person finds it, not mid-probe.
  const screenshot = join(SHOTS, `${surface.replace(/\W+/g, '_')}.png`);
  await page.screenshot({ path: screenshot });
  const { nodes, duplicates } = await page.evaluate(EXTRACT, {
    remeasure: true,
    minTarget: MIN_TARGET,
  });
  const actionable = nodes.filter((n) => n.kind === 'actionable');
  const judgedUnder = (n) => n.judgedWidth < MIN_TARGET || n.judgedHeight < MIN_TARGET;
  const publishedUnder = (n) =>
    n.rectBeforeScroll.width < MIN_TARGET || n.rectBeforeScroll.height < MIN_TARGET;
  const text = nodes.filter((n) => n.kind === 'text').map((n) => ({ label: n.label }));
  // A surface that rendered an error state is a real observation, but it is not
  // a screen anyone can work on. It is recorded and named as exactly that
  // rather than counted as a working surface.
  //
  // The retry button is what separates "this screen failed" from "a toast slid
  // past on top of a healthy screen": the failure banner carries a Reintentar
  // action, the toast does not.
  const refused = text.find((t) => /No fue posible|No se pudo/i.test(t.label));
  const retry = actionable.some((n) => /^(Reintentar|Retry)$/i.test(n.label.trim()));
  const unavailable = text.find((t) => /no está disponible|not available/i.test(t.label));
  const state = retry && refused ? 'error' : unavailable ? 'unavailable' : 'ok';
  const entry = {
    surface,
    capturedAt: new Date().toISOString(),
    state,
    stateText:
      state === 'error'
        ? refused.label.slice(0, 200)
        : state === 'unavailable'
          ? unavailable.label.slice(0, 200)
          : null,
    toast: state === 'ok' && refused ? refused.label.slice(0, 160) : null,
    nodeCount: nodes.length,
    duplicateNodes: duplicates,
    actionableCount: actionable.length,
    unnamed: actionable.filter((n) => !n.label).length,
    // `subtouch` is the gate: under the floor after the reveal. The other two
    // are the audit trail - `subtouchAfterScroll` names the same number in the
    // terms of the change, and `subtouchBeforeScroll` is what this instrument
    // reported before it learned to scroll, so the correction is visible.
    subtouch: actionable.filter(judgedUnder).length,
    subtouchAfterScroll: actionable.filter(judgedUnder).length,
    subtouchBeforeScroll: actionable.filter(publishedUnder).length,
    clipped: actionable.filter((n) => n.clipped).length,
    scrolledToMeasure: actionable.filter((n) => n.scrolledToMeasure).length,
    disabled: actionable.filter((n) => n.disabled).length,
    empty: actionable.length === 0,
    screenshot,
    nodes: actionable.map((n) => ({ ...n, surface })),
    text,
  };
  report.surfaces.push(entry);
  process.stderr.write(
    `${surface}: ${entry.actionableCount} actionable (${entry.unnamed} unnamed, ` +
      `${entry.subtouch} under ${MIN_TARGET}px, ${entry.subtouchBeforeScroll} as published, ` +
      `${entry.clipped} clipped, ${entry.disabled} disabled)` +
      `${state === 'ok' ? '' : ` [${state.toUpperCase()}: ${entry.stateText}]`}` +
      `${entry.toast ? ` [TOAST: ${entry.toast}]` : ''}\n`,
  );
  return entry;
}

/** The money path: catalog to a completed charge, counted in taps. */
function moneyPath(report) {
  const catalog = report.surfaces.find((s) => s.surface === 'catalog');
  const product = catalog?.nodes.find((n) => n.width > 80 && n.label && n.y > 150 && n.y < 600);
  if (!product) {
    return {
      status: 'not-yet-instrumented',
      reason: 'no product tile was exposed as an actionable node on the catalog surface',
      taps: null,
    };
  }
  const cash = report.surfaces.find((s) => s.surface === 'nav-caja');
  const noShift = cash?.nodes.some((n) => /Abre un turno de caja/.test(n.label));
  return {
    status: 'not-yet-instrumented',
    reason:
      'the sweep stops before tendering. Two reasons, both measured: ' +
      (noShift
        ? 'the cash centre reports no open shift ("Abre un turno de caja antes de aceptar ' +
          'efectivo"), so a cash charge cannot complete; and '
        : '') +
      'committing any charge writes an order and a payment row into the shared rehearsal ' +
      'database that another workstream is verifying. The tap count up to the tender sheet ' +
      'is not instrumented either, because the sweep never taps a tile and so never reaches it.',
    taps: null,
    firstTap: { label: product.label, at: [product.x, product.y] },
  };
}

/* markdown ---------------------------------------------------------------- */

function markdown(report) {
  const lines = [
    '# POS surface sweep',
    '',
    `Generated: ${report.generatedAt}`,
    `POS: ${report.posUrl} at ${report.viewport.width}x${report.viewport.height}` +
      ` (${report.viewportSource})`,
    `Driver: ${report.driver}`,
    '',
    // Two size columns on purpose: the published box is what Flutter reported
    // with the page untouched, the judged one is after the sweep scrolled each
    // undersized node into view. Only the judged column is a finding.
    '| Surface | State | Actionable | Unnamed | Under 44px (published) | Under 44px (judged) | Clipped | Disabled | Screenshot |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const s of report.surfaces) {
    lines.push(
      `| \`${s.surface}\` | ${s.state}${s.stateText ? ` (${s.stateText})` : ''} | ` +
        `${s.actionableCount} | ${s.unnamed} | ${s.subtouchBeforeScroll} | ${s.subtouch} | ` +
        `${s.clipped} | ${s.disabled} | ${s.screenshot} |`,
    );
  }
  const t = report.totals ?? {};
  lines.push(
    '',
    `Totals: ${t.surfaces} surfaces, ${t.actionable} actionable, ${t.unnamed} unnamed, ` +
      `${t.subtouch} under 44px judged after ${t.scrolledToMeasure} nodes were brought into ` +
      `view, ${t.subtouchBeforeScroll} under 44px as published, ${t.clipped} boxes grew ` +
      'when they were revealed.',
    '',
    ...(t.undersizedAfterScroll?.length
      ? [
          'Still under 44px after being scrolled fully into view, so these are real:',
          '',
          ...t.undersizedAfterScroll.map(
            (n) =>
              `- \`${n.surface}\` ${n.label || '(unnamed)'} - ${n.judged.width}x${n.judged.height}`,
          ),
          '',
        ]
      : ['No actionable node is under 44px after being brought into view.', '']),
    `Money path: ${report.moneyPath.status} - ${report.moneyPath.reason}`,
    '',
    '## Notes',
    '',
    ...(report.notes.length ? report.notes.map((n) => `- ${n}`) : ['- none']),
    '',
  );
  return lines.join('\n');
}

/* main -------------------------------------------------------------------- */

/**
 * `--self-test`: prove the 44px check still fails a genuinely small control,
 * and that the two controls it now passes are passed because they were
 * re-measured, not because the check was loosened. Runs on a blank page, so it
 * needs neither the POS nor the API and cannot be confused by app state.
 *
 * The fixture (built inside `EXTRACT`) publishes a clipped node the way Flutter
 * does, as the visible remainder, so the three cases are:
 *
 *   a 20x20 control, fully visible     -> must stay under the floor
 *   a 48x48 control cut at the fold    -> published 48x20, must clear the floor
 *   a 48x48 control above the viewport -> published 48x8, must clear the floor
 *
 * and then the same three at a 200px floor, where all of them must be flagged.
 */
async function selfTest() {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('no browser context on the CDP connection');
  const page = await context.newPage();
  const out = [];
  const say = (line) => out.push(line);
  const failures = [];
  try {
    await page.setViewportSize(VIEWPORT);
    await page.goto('about:blank');
    const run = (minTarget) =>
      page.evaluate(EXTRACT, { selfTest: true, remeasure: true, minTarget, root: 'body' });
    const strict = await run(MIN_TARGET);
    const inflatedFloor = 200;
    const inflated = await run(inflatedFloor);

    const pick = (result, needle) => result.nodes.find((n) => n.label.includes(needle));
    const cases = [
      { needle: 'small 20x20', expect: 'fails' },
      { needle: 'clipped at the bottom', expect: 'passes' },
      { needle: 'published above the top', expect: 'passes' },
    ];
    const shape = (r) => (r ? `${r.width}x${r.height}@${r.x},${r.y}` : '-');

    say(`POS surface sweep self-test at ${VIEWPORT.width}x${VIEWPORT.height}`);
    say(
      `floor ${MIN_TARGET}px; fixture scroll container ${JSON.stringify(strict.selfTest?.container)}`,
    );
    say('');
    say(
      'node                                        published         after reveal      judged     clipped scrolled',
    );
    for (const testCase of cases) {
      const node = pick(strict, testCase.needle);
      if (!node) {
        failures.push(`fixture node "${testCase.needle}" was not published at all`);
        continue;
      }
      const judged = `${node.judgedWidth}x${node.judgedHeight}`;
      say(
        `${node.label.padEnd(42)} ${shape(node.rectBeforeScroll).padEnd(17)} ` +
          `${shape(node.rectAfterScroll).padEnd(17)} ${judged.padEnd(10)} ` +
          `${String(node.clipped).padEnd(7)} ${node.scrolledToMeasure}`,
      );
      const flagged = node.judgedWidth < MIN_TARGET || node.judgedHeight < MIN_TARGET;
      if (testCase.expect === 'fails' && !flagged) {
        failures.push(`a genuinely small ${judged} control was NOT flagged`);
      }
      if (testCase.expect === 'passes') {
        if (flagged) {
          failures.push(`${node.label}: still ${judged} after being brought into view`);
        }
        if (!node.clipped || !node.scrolledToMeasure) {
          failures.push(`${node.label}: was never re-measured, so the pass proves nothing`);
        }
        if (!node.clipAncestor) failures.push(`${node.label}: no clip ancestor recorded`);
      }
    }

    const inflatedFlagged = inflated.nodes.filter(
      (n) => n.judgedWidth < inflatedFloor || n.judgedHeight < inflatedFloor,
    ).length;
    say('');
    say(
      `same fixture at a ${inflatedFloor}px floor: ${inflatedFlagged} of ${inflated.nodes.length} ` +
        'nodes flagged, so the floor comparison is live and the two passes above come from ' +
        'the reveal, not from an exemption',
    );
    if (inflatedFlagged !== inflated.nodes.length) {
      failures.push(
        `the ${inflatedFloor}px floor flagged ${inflatedFlagged}/${inflated.nodes.length} nodes`,
      );
    }
    say('');
    for (const failure of failures) say(`FAIL ${failure}`);
    say(failures.length === 0 ? 'SELF-TEST PASS' : `SELF-TEST FAIL (${failures.length})`);
  } finally {
    await page.close().catch(() => {});
  }
  process.stdout.write(`${out.join('\n')}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}

async function main() {
  if (SELF_TEST) {
    await selfTest();
    return;
  }
  await mkdir(SHOTS, { recursive: true });
  const api = apiClient();
  const login = await api.call('POST', '/api/auth/local/login', {
    username: EMAIL,
    password: PASSWORD,
  });
  if (!login.ok) {
    throw new Error(`dashboard login failed: ${login.status} ${JSON.stringify(login.json)}`);
  }

  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('no browser context on the CDP connection');
  const page = await context.newPage();
  const viewport = VIEWPORT;
  await page.setViewportSize(viewport);

  if (FRESH_DEVICE) {
    // The device credential lives in the browser's web storage. Clearing it is
    // the only way to exercise the enrolment surface without hand-editing the
    // database, and it leaves the previously enrolled device untouched.
    const session = await context.newCDPSession(page);
    await session.send('Storage.clearDataForOrigin', {
      origin: new URL(POS_URL).origin,
      // Only the two stores that hold device identity. Dropping the code cache
      // or the service worker has nothing to do with pairing and has left the
      // release build unable to boot.
      storageTypes: 'local_storage,indexeddb',
    });
    await session.detach();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    posUrl: POS_URL,
    viewport,
    viewportSource: VIEWPORT_FLAG
      ? `--viewport ${VIEWPORT_FLAG}`
      : 'default 1024x768, the plan section 4 cafe tablet',
    minTarget: MIN_TARGET,
    merchantId: MERCHANT,
    locationId: LOCATION,
    driver: 'flutter-web-semantics (patrol 4.10.0 has no linux platform; see header)',
    created: { enrollmentRequestIds: [], devices: [] },
    surfaces: [],
    moneyPath: { status: 'not-yet-instrumented', reason: 'not attempted yet', taps: null },
    notes: [],
  };
  const log = (line) => process.stderr.write(`${line}\n`);

  try {
    await loadPos(page);
    let surface = await ensureOperator(page, api, log, report);
    // A storage reset can land the very first boot on the app's own "cannot
    // start safely" screen, which a second cold start clears. One retry, then
    // the surface is reported as it stands.
    if (FRESH_DEVICE && surface === 'unknown') {
      log('first boot after the storage reset did not settle; loading again');
      await loadPos(page);
      surface = await ensureOperator(page, api, log, report);
    }
    if (surface !== 'catalog') {
      const blocked = await record(page, `blocked-${surface.replace(/\W+/g, '-')}`, report);
      const visible = blocked.text.map((t) => t.label).join(' / ');
      throw new Error(
        `the POS never reached the catalog surface (stuck on ${surface}). ` +
          `On screen: ${visible || '(nothing)'}`,
      );
    }

    const destinations = navDestinations(await readNodes(page), viewport);
    report.notes.push(
      `bottom navigation discovered live: ${destinations.map((d) => d.label).join(', ') || 'none'}`,
    );
    await record(page, 'catalog', report);

    // One sub-surface the catalog itself opens, so the sweep is not only the
    // six tabs: the "Más" menu in the top bar.
    const more = (await readNodes(page)).find(
      (n) => n.kind === 'actionable' && /^(Más|More)$/.test(n.label),
    );
    if (more) {
      await clickNode(page, more);
      await page.waitForTimeout(2500);
      const opened = classify(await readNodes(page));
      const menu = await record(page, 'catalog-more', report);
      report.notes.push(`catalog "Más" -> ${opened}`);
      if (DELAY > 0) await page.waitForTimeout(DELAY);
      await loadPos(page);
      await ensureOperator(page, api, log, report);

      // Every menu entry behind "Más" is a real surface. The two that move
      // money backwards are named and skipped, the same rule the Dashboard
      // audit uses; the rest are opened and recorded.
      for (const item of menu.nodes.filter((n) => !/suspender|cancelar/i.test(n.label))) {
        await loadPos(page);
        await ensureOperator(page, api, log, report);
        const reopen = await findNode(
          page,
          (n) => n.kind === 'actionable' && /^(Más|More)$/.test(n.label),
        );
        if (!reopen) break;
        await clickNode(page, reopen);
        await page.waitForTimeout(2000);
        const entry = await findNode(
          page,
          (n) => n.kind === 'actionable' && n.label === item.label,
        );
        if (!entry) {
          report.notes.push(`catalog menu ${item.label}: not found when re-opened`);
          continue;
        }
        if (DELAY > 0) await page.waitForTimeout(DELAY);
        await clickNode(page, entry);
        await page.waitForTimeout(3000);
        const reached = classify(await readNodes(page));
        await record(page, `more-${slugify(item.label)}`, report);
        report.notes.push(`catalog menu ${item.label} -> surface ${reached}`);
      }
    }

    // Walk each destination the app actually published. The catalog is only
    // reachable by falling back to a cold start, so the harness reloads rather
    // than guessing at a back affordance that may not exist.
    for (const destination of destinations) {
      const slug = slugify(destination.label);
      if (slug === 'comanda' || slug === 'order') continue; // already home
      if (DELAY > 0) await page.waitForTimeout(DELAY);
      // A cold start is the only reliable way home: the bar's first
      // destination has no `onTap`, and a pushed route may have no back
      // affordance at all.
      await loadPos(page);
      await ensureOperator(page, api, log, report);
      const target = await findNode(
        page,
        (n) =>
          n.kind === 'actionable' && n.label === destination.label && n.y > viewport.height - 130,
      );
      if (!target) {
        report.notes.push(`destination ${destination.label}: not found when re-read`);
        continue;
      }
      await clickNode(page, target);
      await page.waitForTimeout(2500);
      const found = classify(await readNodes(page));
      await record(page, `nav-${slug}`, report);
      report.notes.push(`destination ${destination.label} -> surface ${found}`);
    }

    report.moneyPath = moneyPath(report);

    // Record the rows this run added, so the identifiers are in the report
    // instead of only in a shell history.
    const devices = await api.call('GET', `/api/v1/merchants/${MERCHANT}/devices`);
    report.created.devices = (devices.json?.devices ?? [])
      .filter((d) => d.displayName === 'UX sweep POS')
      .map((d) => ({
        id: d.id,
        publicId: d.publicId,
        locationId: d.locationId,
        name: d.displayName,
      }));
  } finally {
    if (!KEEP_OPEN) await page.close().catch(() => {});
  }

  const actionable = report.surfaces.flatMap((s) => s.nodes);
  const judgedUnder = (n) => n.judgedWidth < MIN_TARGET || n.judgedHeight < MIN_TARGET;
  report.totals = {
    surfaces: report.surfaces.length,
    actionable: actionable.length,
    unnamed: actionable.filter((n) => !n.label).length,
    // See the header: `subtouch` and `subtouchAfterScroll` are the same count
    // by construction, both judged after the reveal; `subtouchBeforeScroll` is
    // the number the instrument reported when it measured the published box
    // only, kept so the correction can be audited.
    subtouch: actionable.filter(judgedUnder).length,
    subtouchAfterScroll: actionable.filter(judgedUnder).length,
    subtouchBeforeScroll: actionable.filter(
      (n) => n.rectBeforeScroll.width < MIN_TARGET || n.rectBeforeScroll.height < MIN_TARGET,
    ).length,
    clipped: actionable.filter((n) => n.clipped).length,
    scrolledToMeasure: actionable.filter((n) => n.scrolledToMeasure).length,
    undersizedAfterScroll: actionable.filter(judgedUnder).map((n) => ({
      surface: n.surface,
      label: n.label,
      role: n.role,
      judged: { width: n.judgedWidth, height: n.judgedHeight },
      rectBeforeScroll: n.rectBeforeScroll,
      rectAfterScroll: n.rectAfterScroll,
    })),
    disabled: actionable.filter((n) => n.disabled).length,
    emptySurfaces: report.surfaces.filter((s) => s.empty).map((s) => s.surface),
    errorSurfaces: report.surfaces.filter((s) => s.state === 'error').map((s) => s.surface),
    unavailableSurfaces: report.surfaces
      .filter((s) => s.state === 'unavailable')
      .map((s) => s.surface),
  };

  report.notes.push(
    `size judged after reveal: ${report.totals.scrolledToMeasure} nodes were scrolled into view ` +
      `before being measured, ${report.totals.clipped} of them reported a box that grew once ` +
      `revealed; ${report.totals.subtouchBeforeScroll} read as under ${MIN_TARGET}px in the ` +
      `published box and ${report.totals.subtouch} are under it after the reveal`,
  );

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`);
  await mkdir(dirname(MD), { recursive: true });
  await writeFile(MD, markdown(report));
  process.stderr.write(`\nwrote ${OUT}\nwrote ${MD}\n${JSON.stringify(report.totals)}\n`);

  const blocking = report.totals.unnamed + report.totals.subtouch;
  process.exit(blocking > 0 ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
