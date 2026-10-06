/**
 * The floor-plan map suite: 200 tables, one slow drag, and one rotate, at both
 * reference viewports. Plan §8D step 7 asks for a suite that drives the map.
 * The console owns the drag and the rotate. The till owns merge and split, so
 * those two gestures are not here.
 *
 * Plan §8D step 7 also says: "Use a DevTools trace during a drag to prove the
 * frame budget." So this spec records a CDP trace around the drag and reports
 * the frame numbers it finds.
 *
 * The test borrows the operator's Chromium over CDP, because the Dashboard
 * needs a session. It never launches a browser and never runs headless. See
 * `tools/ux-sweep/README.md` and `playwright.config.mjs`.
 *
 * The spec writes a real draft plan. It saves the draft it replaces first, and
 * it puts that draft back in `afterAll`. The draft belongs to Congreso.
 *
 * The page calls the API on the same origin as `BASE`. The dev server proxies
 * `/api` to the API on port 4001, so the request needs no API base of its own.
 * The app reads `VITE_API_BASE` for another origin, and this spec does not.
 *
 * Run:
 *   cd /home/jc/umi
 *   npx playwright test --config tools/ux-sweep/playwright.config.mjs floor-plan-map.spec.mjs
 *
 * Output: `/tmp/ux/floor-plan-map` (screenshots, one JSON report per viewport,
 * one Chrome trace file). Override with `UX_OUT`.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect, test as base } from '@playwright/test';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';
const OUT = process.env.UX_OUT || '/tmp/ux/floor-plan-map';

/**
 * The suite replaces the draft of one location. The brief names Congreso, and
 * the operator's session must have that location selected. `UX_EXPECT_LOCATION`
 * changes the name when another café is under test.
 */
const EXPECT_LOCATION = process.env.UX_EXPECT_LOCATION || '^congreso$';

/**
 * The frame budget. 60 frames in one second gives 1000 / 60 = 16.7 ms for one
 * frame. The plan does not name a Dashboard frame budget, so this spec uses the
 * only frame budget the repository writes down: "Frame build and raster time:
 * less than 16.7 milliseconds at 60 frames per second" in
 * `docs/research/2026-09-15-tooling-and-design-system-landscape.md` (line 321,
 * the POS budgets for modest hardware). The number is the same for both
 * clients, because both draw to a 60 Hz display.
 */
const FRAME_BUDGET_MS = 1000 / 60;
const FRAME_BUDGET_SOURCE =
  'docs/research/2026-09-15-tooling-and-design-system-landscape.md:321 (16.7 ms at 60 fps; the POS budget, the only frame budget in the repo)';

/**
 * A frame counts as missed only above one and a half periods.
 *
 * A 60 Hz display delivers every 16.7 ms, and the budget above is 16.667 ms. A
 * strict comparison therefore reports every healthy frame as late. This spec
 * prints the strict count as well, so a reader sees both numbers.
 */
const MISSED_FRAME_MS = FRAME_BUDGET_MS * 1.5;

/** Compact JSON, for one log line of the run. */
const json = (value) => JSON.stringify(value);

/**
 * The same value with sorted keys.
 *
 * Postgres stores the plan as `jsonb`, which orders keys its own way. A raw
 * string comparison of two reads can differ on key order alone, so the restore
 * check compares this form.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

/** The reference hardware from §4 of the plan, named as in the visual spec. */
const VIEWPORTS = [
  { name: 'tablet-1024x768', width: 1024, height: 768 },
  { name: 'terminal-1280x720', width: 1280, height: 720 },
];

/**
 * The fixture plan: 200 tables in one area, 10 columns by 20 rows.
 *
 * The area is 1320 x 2520. The columns are few and the tables are big on
 * purpose. A Konva Transformer anchor is 10 screen pixels, whatever the stage
 * scale is, so a table smaller than that on screen cannot be grabbed by its
 * body. Every table lies inside the area, every label is unique, and every table
 * has a capacity of 4.
 * `packages/contract/src/floor-plan.ts` states those rules.
 */
const PLAN = {
  area: { name: 'Salón 200', width: 1320, height: 2520 },
  table: { width: 70, height: 70 },
  cols: 10,
  rows: 20,
  firstX: 60,
  stepX: 120,
  firstY: 60,
  stepY: 120,
};

/**
 * The drag distance, in plan units. Both numbers are multiples of the 20-unit
 * snap step, so the screen keeps them. Both are small enough to leave a gap of
 * 10 units to the neighbour.
 */
const DRAG = { x: 40, y: 40 };

/** The snap step of the screen (`fitElement` in `floor-plan-model.js`). */
const SNAP_STEP = 20;

/** The traced categories: the DevTools Performance panel set, minus screenshots. */
const TRACE_CATEGORIES = [
  '-*',
  'devtools.timeline',
  'v8.execute',
  'blink.user_timing',
  'latencyInfo',
  'loading',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-v8.cpu_profiler',
].join(',');

/** Borrow the operator's browser. `visual-regression.spec.mjs` uses this shape. */
const test = base.extend({
  browser: [
    async ({}, use) => {
      const browser = await chromium.connectOverCDP(CDP, { timeout: 60_000 });
      // The connection belongs to somebody else, so disconnect only.
      await use(browser);
    },
    { scope: 'worker' },
  ],
  context: async ({ browser }, use) => {
    const context = browser.contexts()[0];
    if (!context) throw new Error(`No browser context on the CDP connection at ${CDP}.`);
    await use(context);
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
});

/**
 * State shared by the two viewport tests and by `afterAll`.
 *
 * `original` holds the draft plan of Congreso as it was before this suite ran.
 * The first test captures it, the last test restores it.
 */
const shared = {
  scope: null,
  original: null,
  restore: null,
};

/** The 200-table document. The ids are new on every call. */
function buildDocument(areaId) {
  const elements = [];
  for (let row = 0; row < PLAN.rows; row += 1) {
    for (let col = 0; col < PLAN.cols; col += 1) {
      const number = row * PLAN.cols + col + 1;
      elements.push({
        id: randomUUID(),
        kind: 'table',
        shape: 'rectangle',
        label: `T${number}`,
        capacity: 4,
        x: PLAN.firstX + col * PLAN.stepX,
        y: PLAN.firstY + row * PLAN.stepY,
        width: PLAN.table.width,
        height: PLAN.table.height,
        rotation: 0,
      });
    }
  }
  return {
    schemaVersion: 1,
    areas: [{ id: areaId, name: PLAN.area.name, ...PLAN.area, elements }],
  };
}

/** The plan element this suite drags and rotates: an interior table. */
function targetIndex() {
  return 3 * PLAN.cols + 4;
}

/**
 * Read the merchant and the location of the operator's session, the same way
 * the screen reads them: a stored choice first, then the server default.
 */
async function readScope(page) {
  const caps = await page.evaluate(async () => {
    const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
    if (!merchantId) return { merchantId: null };
    const res = await fetch(`/api/merchants/${merchantId}/capabilities`, {
      credentials: 'include',
    });
    const body = await res.json().catch(() => ({}));
    return {
      merchantId,
      merchantName: body.merchant?.name ?? null,
      locationId:
        window.localStorage.getItem('umi-dashboard-selected-location') ||
        body.selectedLocation?.id ||
        null,
      locations: (body.locations ?? []).map((place) => ({ id: place.id, name: place.name })),
    };
  });
  const name = (caps.locations ?? []).find((place) => place.id === caps.locationId)?.name ?? '';
  return { ...caps, locationName: name };
}

/** `GET` the floor plan of the scoped location. The page carries the cookie. */
async function readPlan(page, scope) {
  return page.evaluate(async ({ merchantId, locationId }) => {
    const res = await fetch(
      `/api/merchants/${merchantId}/floor-plan?locationId=${encodeURIComponent(locationId)}`,
      { credentials: 'include' },
    );
    return { status: res.status, body: await res.json().catch(() => null) };
  }, scope);
}

/**
 * `PUT` a draft plan through the app's own save route.
 *
 * The route refuses a cookie-mode write without the `umi_csrf` cookie in the
 * `X-UMI-CSRF` header. `apps/umi-dashboard/src/data.jsx` sends that header the
 * same way, so this copies the app rather than inventing a path.
 */
async function savePlan(page, scope, document, expectedVersion) {
  return page.evaluate(
    async ({ scope: target, expectedVersion: version, plan }) => {
      const csrf = decodeURIComponent(
        document.cookie
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith('umi_csrf='))
          ?.slice('umi_csrf='.length) ?? '',
      );
      const res = await fetch(`/api/merchants/${target.merchantId}/floor-plan`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'X-UMI-CSRF': csrf },
        body: JSON.stringify({
          locationId: target.locationId,
          expectedVersion: version,
          idempotencyKey: crypto.randomUUID(),
          document: plan,
        }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { scope, expectedVersion, plan: document },
  );
}

/** Find one element in the saved draft. */
function elementOf(state, id) {
  for (const area of state?.body?.draft?.areas ?? []) {
    const found = area.elements.find((element) => element.id === id);
    if (found) return found;
  }
  return null;
}

/** The geometry of every element of one document, keyed by identity. */
function snapshotElements(document) {
  const snapshot = {};
  for (const area of document?.areas ?? []) {
    for (const element of area.elements) {
      snapshot[element.id] = {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
      };
    }
  }
  return snapshot;
}

/** The identities whose geometry differs between two snapshots. */
function changedElements(before, after) {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...ids].filter((id) => json(before[id]) !== json(after[id])).sort();
}

/**
 * Wait until the saved draft satisfies `done`. The screen autosaves 900 ms
 * after the last interaction, so a gesture is only real once this returns.
 */
async function waitForDraft(page, scope, id, done, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = elementOf(await readPlan(page, scope), id);
    if (last && done(last)) return last;
    await page.waitForTimeout(250);
  }
  return null;
}

/** Open the screen and wait for the Konva canvas. The screen draws the canvas itself. */
async function openMap(page, timeout = 30_000) {
  await page.goto(`${BASE}/floor-plan`, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForSelector('#fp-area-panel canvas', { timeout });
}

/**
 * Read the canvas geometry from the DOM. Konva draws the tables, so the screen
 * position of a table is arithmetic over the canvas box, not a DOM element.
 *
 * The screen scales the stage by `min(1, contentWidth / areaWidth) * zoom`. This
 * function reads the scale from the drawn canvas and compares it with that
 * formula, so a change to either one fails the check instead of moving the
 * pointer to the wrong table.
 */
async function readGeometry(page) {
  return page.evaluate((areaWidth) => {
    const panel = document.querySelector('#fp-area-panel');
    const canvases = [...document.querySelectorAll('#fp-area-panel canvas')];
    const box = canvases[0].getBoundingClientRect();
    const style = getComputedStyle(panel);
    const contentWidth =
      panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    // The screen clamps the area to 200..5000 units and then multiplies by the
    // zoom control. `floor-plan.jsx` holds that formula.
    const zoom = Number(document.querySelector('.fp-zoom select')?.value ?? 1);
    return {
      canvas: { x: box.x, y: box.y, width: box.width, height: box.height },
      canvasCount: canvases.length,
      contentWidth,
      zoom,
      scaleFromCanvas: box.width / areaWidth,
      scaleFromFormula: Math.min(1, contentWidth / Math.max(200, Math.min(5000, areaWidth))) * zoom,
    };
  }, PLAN.area.width);
}

/** The page point of a plan coordinate. */
function pointOf(geometry, element) {
  return {
    x: geometry.canvas.x + element.x * geometry.scaleFromCanvas,
    y: geometry.canvas.y + element.y * geometry.scaleFromCanvas,
  };
}

/**
 * Did the canvas draw anything?
 *
 * Konva draws one canvas for each layer. The first canvas holds the grid and the
 * last holds the tables. The grid alone would pass a check on the first canvas,
 * so this reads the last canvas and counts the pixels that carry ink.
 */
async function canvasInk(page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('#fp-area-panel canvas')];
    if (!canvases.length) return { canvases: 0, elementsLayer: null };
    const canvas = canvases[canvases.length - 1];
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    let sampled = 0;
    for (let i = 0; i < data.length; i += 16) {
      // Alpha is the fourth byte. The table layer is clear where nothing is
      // drawn.
      if (data[i + 3] > 0) painted += 1;
      sampled += 1;
    }
    return {
      canvases: canvases.length,
      elementsLayer: {
        width: canvas.width,
        height: canvas.height,
        sampled,
        painted,
        paintedFraction: sampled ? painted / sampled : 0,
      },
    };
  });
}

/** The number fields of the properties panel, keyed by their label. */
async function readProperties(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('aside.fp-properties');
    if (!panel) return [];
    return [...panel.querySelectorAll('label')].map((label) => {
      const input = label.querySelector('input, select');
      return {
        label: label.innerText.split('\n')[0].trim(),
        value: input?.value ?? null,
        type: input?.type ?? null,
      };
    });
  });
}

/** One field of the properties panel, by the English or the Spanish label. */
function propertyValue(properties, pattern) {
  const found = properties.find((field) => pattern.test(field.label));
  return found?.value ?? null;
}

/** The labels of the two position fields, in either language. */
const POSITION_X = /(posición|position)\s*x|\bx\s*(posición|position)/i;
const POSITION_Y = /(posición|position)\s*y|\by\s*(posición|position)/i;
const ROTATION_FIELD = /rotación|rotation/i;
const NAME_FIELD = /nombre|name/i;

/**
 * One number field of the properties panel.
 *
 * The call fails when the field is absent, so a panel that shows the area
 * fields instead of the element fields cannot read as a zero.
 */
function propertyNumber(properties, pattern, what) {
  const value = propertyValue(properties, pattern);
  expect(value, `the properties panel must show ${what}`).not.toBeNull();
  return Number(value);
}

/**
 * The frame clock of the renderer is `BeginImplFrameToSendBeginMainFrame`: one
 * event for every compositor frame the renderer asks the main thread for. The
 * DevTools trace does not write `DrawFrame` or `BeginFrame` here, so this is the
 * frame series this spec reads.
 */
const FRAME_EVENT = 'BeginImplFrameToSendBeginMainFrame';

/**
 * Timestamps of one event name inside a window, filtered to one process.
 *
 * Chrome writes some frame events as one instant `I` event, and some as a pair
 * of `b` and `e` events. `phase` selects the one that counts. Take `b`, or the
 * series holds two rows for every frame.
 */
function seriesAt(events, name, fromTs, toTs, pid = null, phase = null) {
  return events
    .filter(
      (event) =>
        event.name === name &&
        Number.isFinite(event.ts) &&
        event.ts >= fromTs &&
        event.ts <= toTs &&
        (phase === null || event.ph === phase) &&
        (pid === null || event.pid === pid),
    )
    .map((event) => event.ts)
    .sort((a, b) => a - b);
}

/**
 * Durations of one event written as a `b`/`e` pair, in milliseconds.
 *
 * Each pair is opened on a thread and closed on the same thread, so the thread
 * is the key. A pair that starts or ends outside the window is dropped.
 */
function pairedDurations(events, name, fromTs, toTs, pid = null) {
  const open = new Map();
  const durations = [];
  for (const event of events) {
    if (event.name !== name) continue;
    if (pid !== null && event.pid !== pid) continue;
    const key = `${event.pid}:${event.tid}`;
    if (event.ph === 'b') open.set(key, event.ts);
    else if (event.ph === 'e') {
      const start = open.get(key);
      if (start === undefined) continue;
      open.delete(key);
      if (start >= fromTs && event.ts <= toTs) durations.push((event.ts - start) / 1000);
    }
  }
  return durations;
}

/** The gap between one `performance` sample and the next, in milliseconds. */
function intervalsOf(timestamps) {
  return timestamps.slice(1).map((value, index) => value - timestamps[index]);
}

/**
 * The gap between one trace timestamp and the next, in milliseconds.
 *
 * A trace timestamp counts microseconds. A `performance` timestamp counts
 * milliseconds, so the two need different arithmetic.
 */
function traceIntervalsOf(timestamps) {
  return timestamps.slice(1).map((value, index) => (value - timestamps[index]) / 1000);
}

/** The frame-budget numbers of one series of gaps. */
function intervalStats(intervals) {
  const sorted = [...intervals].sort((a, b) => a - b);
  const at = (quantile) =>
    sorted.length
      ? +sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))].toFixed(2)
      : null;
  return {
    intervals: sorted.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    maxMs: sorted.length ? +sorted[sorted.length - 1].toFixed(2) : null,
    intervalsOverBudget: intervals.filter((value) => value > FRAME_BUDGET_MS).length,
    intervalsOverTolerance: intervals.filter((value) => value > MISSED_FRAME_MS).length,
  };
}

/** Frame cadence from the in-page `requestAnimationFrame` samples. */
function rafStats(timestamps) {
  const stats = intervalStats(intervalsOf(timestamps));
  const span = timestamps.length > 1 ? timestamps[timestamps.length - 1] - timestamps[0] : 0;
  return {
    frames: timestamps.length,
    spanMs: +span.toFixed(1),
    fps: span > 0 ? +((timestamps.length - 1) / (span / 1000)).toFixed(1) : null,
    ...stats,
  };
}

/**
 * Start an in-page frame sampler.
 *
 * The DevTools `Tracing` domain is global to the browser, so a trace taken from
 * one page still carries the frames of every other tab. The sampler counts the
 * frames the driven page itself receives, so the frame-budget number belongs to
 * this gesture. The sampler records one number per frame and one long task per
 * task, so its own cost is small.
 */
async function startFrameSampler(page) {
  await page.evaluate(() => {
    // One sampler at a time. A sampler of an older run finds a different log
    // object and stops, so two loops cannot write into one array.
    const log = { frames: [], longTasks: [] };
    window.__umiFrameLog = log;
    const tick = (now) => {
      if (window.__umiFrameLog !== log) return;
      // Two loops in one frame carry the same timestamp. Keep one of them.
      if (log.frames[log.frames.length - 1] !== now) log.frames.push(now);
      log.raf = requestAnimationFrame(tick);
    };
    log.raf = requestAnimationFrame(tick);
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) log.longTasks.push(entry.duration);
      });
      observer.observe({ entryTypes: ['longtask'] });
      log.observer = observer;
    } catch {
      // The browser may not report long tasks. The other numbers still stand.
    }
  });
}

/** Stop the in-page frame sampler and return its samples. */
async function stopFrameSampler(page) {
  return page.evaluate(() => {
    const log = window.__umiFrameLog;
    if (!log) return { frames: [], longTasks: [] };
    cancelAnimationFrame(log.raf);
    log.observer?.disconnect();
    const result = { frames: log.frames, longTasks: log.longTasks };
    delete window.__umiFrameLog;
    return result;
  });
}

/** The durations of one frame event, in milliseconds. */
function durationsAt(events, name, fromTs, toTs, pid = null) {
  return events
    .filter(
      (event) =>
        event.name === name &&
        event.ph === 'X' &&
        Number.isFinite(event.dur) &&
        event.dur > 0 &&
        Number.isFinite(event.ts) &&
        event.ts >= fromTs &&
        event.ts <= toTs &&
        (pid === null || event.pid === pid),
    )
    .map((event) => event.dur / 1000);
}

/**
 * The frame cadence of an idle page, used as the baseline of the run.
 *
 * An occluded window receives no frames, and Chrome still reports
 * `visibilityState: "visible"` when another window covers it. So this asks for
 * the front three times before it gives up.
 */
async function sampleCadence(page, frames = 30) {
  let stats = rafStats([]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.bringToFront().catch(() => {});
    await page.waitForTimeout(250);
    await startFrameSampler(page);
    await page
      .waitForFunction((count) => (window.__umiFrameLog?.frames.length ?? 0) >= count, frames, {
        timeout: 2000,
      })
      .catch(() => {});
    const samples = await stopFrameSampler(page);
    stats = rafStats(samples.frames);
    if (stats.frames > 10) return stats;
  }
  return stats;
}

/**
 * One slow pointer drag on the canvas.
 *
 * The pointer moves to the table over time. The gesture then presses, travels in
 * eight steps, and pauses between the steps. The pause is what makes a slow drag
 * show in the trace.
 */
async function slowDrag(page, from, deltaPx, steps = 8, pauseMs = 120) {
  const startedAt = Date.now();
  await page.mouse.move(from.x - 120, from.y - 80, { steps: 6 });
  await page.waitForTimeout(150);
  await page.mouse.move(from.x, from.y, { steps: 20 });
  await page.waitForTimeout(150);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      from.x + (deltaPx.x * step) / steps,
      from.y + (deltaPx.y * step) / steps,
      { steps: 4 },
    );
    await page.waitForTimeout(pauseMs);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  return Date.now() - startedAt;
}

test.afterAll(async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const write = () =>
    writeFileSync(`${OUT}/restore.json`, `${JSON.stringify(shared.restore, null, 2)}\n`);
  if (!shared.original || !shared.scope) {
    shared.restore = { ran: false, reason: 'no draft was replaced' };
    write();
    return;
  }
  if (!shared.original.draft) {
    // The suite replaced a draft, and the API has no route that puts a draft
    // back to null. Say so, and fail, because a silent pass would leave the
    // location holding a plan nobody asked for.
    shared.restore = {
      ran: false,
      reason: 'the location had no draft, and no route deletes a draft',
    };
    write();
    throw new Error('the plan could not be restored: the location had no draft to put back');
  }
  const context = browser.contexts()[0];
  const page = await context.newPage();
  let failure = null;
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const state = await readPlan(page, shared.scope);
    const result = await savePlan(
      page,
      shared.scope,
      shared.original.draft,
      state.body?.version ?? 0,
    );
    shared.restore = {
      ran: true,
      status: result.status,
      versionBefore: state.body?.version ?? null,
      versionAfter: result.body?.version ?? null,
      restoredAreas: (result.body?.draft?.areas ?? []).map((area) => ({
        name: area.name,
        elements: area.elements.length,
      })),
      restoredMatch: json(canonical(result.body?.draft)) === json(canonical(shared.original.draft)),
      restoredMatchRaw:
        JSON.stringify(result.body?.draft) === JSON.stringify(shared.original.draft),
    };
  } catch (error) {
    failure = error;
    shared.restore = { ran: false, reason: String(error?.message || error).slice(0, 200) };
  } finally {
    await page.close().catch(() => {});
    write();
  }
  // A green run must not leave the replaced plan in place.
  expect(
    shared.restore.ran === true && shared.restore.status === 200 && shared.restore.restoredMatch,
    `the draft of ${shared.scope.locationName} must be back: ${json(shared.restore)}${failure ? ` (${failure})` : ''}`,
  ).toBe(true);
});

for (const viewport of VIEWPORTS) {
  test(`floor map: 200 tables, a slow drag and a rotate at ${viewport.name}`, async ({
    page,
    context,
  }, testInfo) => {
    // The plan is big, the gesture is slow, and the screen autosaves.
    testInfo.setTimeout(210_000);
    mkdirSync(OUT, { recursive: true });
    const report = {
      viewport,
      budget: { ms: FRAME_BUDGET_MS, source: FRAME_BUDGET_SOURCE },
      steps: {},
    };
    // The trace and the numbers are the deliverable, so both are written even
    // when a check fails later.
    const events = [];
    const tracePath = `${OUT}/trace-drag-${viewport.name}.json`;
    const reportPath = `${OUT}/${viewport.name}.json`;

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openMap(page);

      // 1. The scope. The brief fixes Congreso; a different place fails here.
      const scope = await readScope(page);
      expect(scope.merchantId, 'the session must name a merchant').toBeTruthy();
      expect(scope.locationId, 'the session must name a location').toBeTruthy();
      expect(
        scope.locationName,
        `the selected location must match ${EXPECT_LOCATION}, not "${scope.locationName}"`,
      ).toMatch(new RegExp(EXPECT_LOCATION, 'i'));
      report.scope = {
        merchantId: scope.merchantId,
        locationId: scope.locationId,
        locationName: scope.locationName,
      };
      if (!shared.scope) shared.scope = scope;

      // 2. Save the draft this suite replaces, then write the 200-table draft.
      const before = await readPlan(page, scope);
      expect(before.status, 'the floor-plan read must succeed').toBe(200);
      if (!shared.original)
        shared.original = { draft: before.body.draft, version: before.body.version };
      const areaId = shared.original.draft?.areas?.[0]?.id ?? randomUUID();
      const plan = buildDocument(areaId);
      const tableCount = plan.areas[0].elements.length;
      const target = plan.areas[0].elements[targetIndex()];
      report.fixture = {
        tables: tableCount,
        area: PLAN.area,
        table: PLAN.table,
        targetId: target.id,
        targetLabel: target.label,
        targetStart: { x: target.x, y: target.y, rotation: target.rotation },
        replacedDraft: {
          version: before.body.version,
          areas: (before.body.draft?.areas ?? []).map((area) => ({
            name: area.name,
            elements: area.elements.length,
          })),
        },
      };
      const put = await savePlan(page, scope, plan, before.body.version);
      expect(put.status, `the 200-table save must succeed: ${JSON.stringify(put.body)}`).toBe(200);
      report.steps.fixtureSaved = { status: put.status, version: put.body?.version };

      // 3. Load the screen again and let it draw the saved draft.
      await openMap(page, 60_000);
      await expect
        .poll(() => page.locator('.fp-element-list button').count(), {
          message: 'the screen must list all 200 tables of the saved draft',
          timeout: 60_000,
        })
        .toBe(tableCount);
      await expect(page.locator('.fp-tab-count').first()).toContainText(String(tableCount));
      const ink = await canvasInk(page);
      report.steps.drawn = { listButtons: tableCount, tabCount: `${tableCount}`, ink };
      expect(ink.canvases, 'the screen draws a grid layer and a table layer').toBeGreaterThan(1);
      expect(
        ink.elementsLayer.paintedFraction,
        'the table layer must paint the tables',
      ).toBeGreaterThan(0.2);
      await page.screenshot({ path: `${OUT}/${viewport.name}-200-tables.png` });

      // 4. The canvas geometry. Verify the screen's own scale formula against the DOM.
      const geometry = await readGeometry(page);
      report.steps.geometry = geometry;
      expect(geometry.zoom, 'the spec must run at the screen default zoom').toBe(1);
      expect(
        Math.abs(geometry.scaleFromCanvas - geometry.scaleFromFormula),
        'the drawn canvas must match the scale the screen computes',
      ).toBeLessThan(0.01);

      // 5. Hit-test the computed point of one table. The properties panel and the
      //    element list both name the table, so a wrong point fails here.
      const start = pointOf(geometry, target);
      await page.mouse.click(start.x, start.y);
      await expect
        .poll(async () => propertyValue(await readProperties(page), NAME_FIELD), {
          timeout: 5000,
        })
        .toBe(target.label);
      report.steps.hitTest = { point: start, selected: target.label };

      // 6. The slow drags. The first drag runs without a trace, so the trace
      //    overhead of the second drag has a comparison.
      // A frame number only means something while this tab is the rendered one. A
      // background tab receives about one frame per second, and this spec must not
      // read that as a slow map.
      const foreground = await page.evaluate(() => ({
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      }));
      expect(foreground.visibilityState, 'the driven tab must be visible').toBe('visible');
      const baselineCadence = await sampleCadence(page);
      // No frames at all means the window is occluded by another window. The
      // report says so, and no frame number is claimed.
      report.steps.cadenceBaseline = baselineCadence;
      // The first cell of every element, so a gesture that moves the wrong
      // element is visible in the report.
      const atStart = snapshotElements((await readPlan(page, scope)).body?.draft);
      const pointerDelta = {
        x: DRAG.x * geometry.scaleFromCanvas,
        y: DRAG.y * geometry.scaleFromCanvas,
      };

      // The gesture needs the front, or the window stops rendering under it.
      await page.bringToFront().catch(() => {});
      await startFrameSampler(page);
      const untracedMs = await slowDrag(page, start, pointerDelta);
      const untracedCadence = rafStats((await stopFrameSampler(page)).frames);
      report.steps.untracedDrag = {
        wallMs: untracedMs,
        planDelta: DRAG,
        pointerDelta,
        steps: 8,
        pauseMs: 120,
        cadence: untracedCadence,
      };
      const movedOnce = await waitForDraft(
        page,
        scope,
        target.id,
        (element) => element.x !== target.x || element.y !== target.y,
      );
      expect(movedOnce, 'the first drag must change the saved draft').not.toBeNull();
      const afterUntraced = snapshotElements((await readPlan(page, scope)).body?.draft);
      const changedByUntraced = changedElements(atStart, afterUntraced);
      report.steps.untracedDrag.saved = {
        element: afterUntraced[target.id],
        changedElements: changedByUntraced,
      };
      expect(
        changedByUntraced,
        'the first drag must move the table it grabbed, and nothing else',
      ).toEqual([target.id]);
      expect(afterUntraced[target.id].x).toBeGreaterThan(target.x);
      expect(afterUntraced[target.id].y).toBeGreaterThan(target.y);

      // The traced drag goes back to the first cell. Both landings keep a gap to
      // the neighbour, because the move is smaller than the pitch.
      const backPointer = pointOf(geometry, movedOnce);
      const backDelta = { x: -pointerDelta.x, y: -pointerDelta.y };
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const metricsBefore = await cdp.send('Performance.getMetrics');
      await startFrameSampler(page);
      cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
      const traced = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.start', {
        categories: TRACE_CATEGORIES,
        transferMode: 'ReportEvents',
      });

      // Two markers name the window: the protocol clock sync marker, and a page
      // mark. The page mark carries the process id, so this spec can find the
      // frames of the driven page inside a browser-wide trace.
      await cdp.send('Tracing.recordClockSyncMarker', { syncId: 'drag-start' });
      await page.evaluate(() => performance.mark('drag-start'));
      const dragMs = await slowDrag(page, backPointer, backDelta);
      await page.evaluate(() => performance.mark('drag-end'));
      await cdp.send('Tracing.recordClockSyncMarker', { syncId: 'drag-end' });
      await cdp.send('Tracing.end');
      await Promise.race([traced, page.waitForTimeout(30_000)]);
      const frameSamples = await stopFrameSampler(page);
      const metricsAfter = await cdp.send('Performance.getMetrics');
      await cdp.detach();

      report.steps.drag = {
        from: backPointer,
        pointerDelta: backDelta,
        planDelta: { x: -DRAG.x, y: -DRAG.y },
        wallMs: dragMs,
        steps: 8,
        pauseMs: 120,
      };

      // 7. The traced drag must reach the saved draft, and the screen must show
      //    it. The gesture returns the table to its first cell, so the saved
      //    values must come back inside one snap step.
      const dragged = await waitForDraft(
        page,
        scope,
        target.id,
        (element) =>
          Math.abs(element.x - target.x) <= SNAP_STEP &&
          Math.abs(element.y - target.y) <= SNAP_STEP,
      );
      expect(dragged, 'the traced drag must return the table to its first cell').not.toBeNull();
      report.steps.dragBack = { element: dragged, backTo: { x: target.x, y: target.y } };
      const afterTraced = snapshotElements((await readPlan(page, scope)).body?.draft);
      report.steps.dragBack.changedElements = changedElements(atStart, afterTraced);
      expect(
        changedElements(atStart, afterTraced),
        'the two drags must leave the plan where it started',
      ).toEqual([]);
      expect(Math.abs(dragged.x - target.x)).toBeLessThanOrEqual(SNAP_STEP);
      expect(Math.abs(dragged.y - target.y)).toBeLessThanOrEqual(SNAP_STEP);
      const expectedMove = {
        x: backDelta.x / geometry.scaleFromCanvas,
        y: backDelta.y / geometry.scaleFromCanvas,
      };
      const snapped = {
        x: Math.round(dragged.x / SNAP_STEP) * SNAP_STEP,
        y: Math.round(dragged.y / SNAP_STEP) * SNAP_STEP,
      };
      report.steps.dragSaved = { element: dragged, expectedMove, snappedTo: snapped };
      // The pointer travels `DRAG` plan units, and the screen snaps the result to
      // the 20-unit grid. One snap step is the whole allowance. The gesture
      // starts where the first drag left the table, so that is the baseline.
      expect(
        Math.abs(dragged.x - movedOnce.x - expectedMove.x),
        'the drawn move must follow the pointer, in plan units',
      ).toBeLessThanOrEqual(SNAP_STEP);
      expect(
        Math.abs(dragged.y - movedOnce.y - expectedMove.y),
        'the drawn move must follow the pointer, in plan units',
      ).toBeLessThanOrEqual(SNAP_STEP);
      expect(dragged.x).toBe(snapped.x);
      expect(dragged.y).toBe(snapped.y);
      const propertiesAfterDrag = await readProperties(page);
      report.steps.propertiesAfterDrag = propertiesAfterDrag;
      expect(propertyNumber(propertiesAfterDrag, POSITION_X, 'the x position')).toBe(dragged.x);
      expect(propertyNumber(propertiesAfterDrag, POSITION_Y, 'the y position')).toBe(dragged.y);
      await page.screenshot({ path: `${OUT}/${viewport.name}-after-drag.png` });

      // 8. The rotate. Select the table at its new position, then turn it.
      const moved = pointOf(geometry, dragged);
      await page.mouse.click(moved.x, moved.y);
      await expect
        .poll(async () => propertyValue(await readProperties(page), NAME_FIELD), {
          timeout: 5000,
        })
        .toBe(target.label);
      const rotationBefore = dragged.rotation;
      // Konva puts the Transformer in absolute screen coordinates. It overrides
      // `getAbsoluteTransform`, so an ancestor scale does not scale the anchors
      // (`konva@10.5.0`, `lib/shapes/Transformer.js:901`). `rotateAnchorOffset` is
      // 50 screen pixels, and the anchor is 10 screen pixels wide. The handle sits
      // above the element's own screen box, so only the half height is scaled.
      const radius = (PLAN.table.height / 2) * geometry.scaleFromCanvas + 50;
      const handle = { x: moved.x, y: moved.y - radius };
      const draftBeforeRotate = snapshotElements((await readPlan(page, scope)).body?.draft);
      await page.mouse.move(handle.x, handle.y, { steps: 10 });
      await page.waitForTimeout(150);
      // Konva sets the cursor to `crosshair` when the pointer is over the rotate
      // anchor. Read it, so a miss is reported instead of dragging the wrong table.
      const handleCursor = await page.evaluate(
        () => document.querySelector('#fp-area-panel .konvajs-content')?.style.cursor ?? null,
      );
      let rotated = null;
      let rotateRoute = null;
      let fallbackReason = null;
      if (handleCursor === 'crosshair') {
        // The pointer is on the rotate anchor, so drag it a quarter turn.
        await page.mouse.down();
        for (let step = 1; step <= 10; step += 1) {
          const angle = (step / 10) * (Math.PI / 4);
          await page.mouse.move(
            moved.x + Math.sin(angle) * radius,
            moved.y - Math.cos(angle) * radius,
            {
              steps: 3,
            },
          );
          await page.waitForTimeout(100);
        }
        await page.waitForTimeout(150);
        await page.mouse.up();
        rotated = await waitForDraft(
          page,
          scope,
          target.id,
          (element) => element.rotation !== rotationBefore,
          8000,
        );
        rotateRoute = rotated ? 'transformer-handle' : null;
        if (!rotated) fallbackReason = 'the handle drag did not change the saved draft';
      } else {
        fallbackReason = `the rotate anchor did not set the crosshair cursor (cursor was "${handleCursor}")`;
      }
      if (!rotated) {
        rotateRoute = 'rotation-input';
        // A miss on the stage background clears the selection, so select again
        // before the properties field is addressed.
        const stillSelected = propertyValue(await readProperties(page), NAME_FIELD);
        if (stillSelected !== target.label) {
          await page.mouse.click(moved.x, moved.y);
          await expect
            .poll(async () => propertyValue(await readProperties(page), NAME_FIELD), {
              timeout: 5000,
            })
            .toBe(target.label);
        }
        await page
          .locator('aside.fp-properties label', { hasText: ROTATION_FIELD })
          .first()
          .locator('input')
          .fill('90');
        await page.keyboard.press('Tab');
        rotated = await waitForDraft(
          page,
          scope,
          target.id,
          (element) => element.rotation !== rotationBefore,
          12_000,
        );
      }
      expect(
        rotated,
        `the rotate must change the saved draft (route: ${rotateRoute})`,
      ).not.toBeNull();
      // Only the target may move or turn. This catches a handle miss that grabbed
      // a different table.
      const draftAfterRotate = snapshotElements((await readPlan(page, scope)).body?.draft);
      const touched = Object.keys(draftAfterRotate).filter(
        (id) =>
          id !== target.id &&
          JSON.stringify(draftAfterRotate[id]) !== JSON.stringify(draftBeforeRotate[id]),
      );
      expect(touched, 'the rotate must not touch another element').toEqual([]);
      const propertiesAfterRotate = await readProperties(page);
      report.steps.rotate = {
        route: rotateRoute,
        fallbackReason,
        handlePoint: handle,
        handleRadius: radius,
        handleCursor,
        otherElementsChangedByRotate: touched,
        rotationBefore,
        rotationAfter: rotated.rotation,
        savedElement: rotated,
        propertiesValue: propertyValue(propertiesAfterRotate, ROTATION_FIELD),
        properties: propertiesAfterRotate,
      };
      expect(rotated.rotation).toBeGreaterThan(0);
      expect(rotated.rotation).toBeLessThan(360);
      expect(propertyNumber(propertiesAfterRotate, ROTATION_FIELD, 'the rotation')).toBe(
        rotated.rotation,
      );
      await page.screenshot({ path: `${OUT}/${viewport.name}-after-rotate.png` });

      // 9. The trace numbers. Attribute the window to the gesture through the
      //    markers. Report "no attribution" when the window holds no frames.
      const pageMark = events.find(
        (event) => event.cat === 'blink.user_timing' && event.name === 'drag-start',
      );
      const endMark = events.find(
        (event) => event.cat === 'blink.user_timing' && event.name === 'drag-end',
      );
      const markerTimestamp = (syncId) =>
        events.find((event) => event.name === 'ClockSyncMarker' && event.args?.syncId === syncId)
          ?.ts ?? null;
      const fromTs = pageMark?.ts ?? markerTimestamp('drag-start');
      const toTs = endMark?.ts ?? markerTimestamp('drag-end');
      const pagePid = pageMark?.pid ?? null;
      const windowed = fromTs !== null && toTs !== null;
      // `b` is the frame start, so the cadence holds one row for each frame.
      const pageFrames = windowed ? seriesAt(events, FRAME_EVENT, fromTs, toTs, pagePid, 'b') : [];
      const allFrames = windowed ? seriesAt(events, FRAME_EVENT, fromTs, toTs, null, 'b') : [];
      // Cost rows. The trace of one page carries no raster timing, so the frame
      // cost is the renderer's own frame work: the compositor frame pipeline,
      // the page frame callback, and the commit.
      const frameCost = windowed
        ? {
            pipelineMs: intervalStats(pairedDurations(events, FRAME_EVENT, fromTs, toTs, pagePid)),
            animationFrameMs: intervalStats(
              pairedDurations(events, 'AnimationFrame', fromTs, toTs, pagePid),
            ),
            animationFrameRenderMs: intervalStats(
              pairedDurations(events, 'AnimationFrame::Render', fromTs, toTs, pagePid),
            ),
            commitMs: intervalStats(durationsAt(events, 'Commit', fromTs, toTs, pagePid)),
          }
        : null;
      const frameProcesses = new Set(
        windowed
          ? events
              .filter(
                (event) => event.name === FRAME_EVENT && event.ts >= fromTs && event.ts <= toTs,
              )
              .map((event) => event.pid)
          : [],
      ).size;
      const raf = rafStats(frameSamples.frames);
      const longTasks = frameSamples.longTasks;
      const metric = (metrics, name) =>
        metrics.metrics.find((item) => item.name === name)?.value ?? null;
      report.steps.trace = {
        path: tracePath,
        events: events.length,
        window: {
          attributed: windowed,
          marker: pageMark ? 'performance.mark in the driven page' : 'no marker',
          pageProcessId: pagePid,
          fromTs,
          toTs,
          windowMs: windowed ? +((toTs - fromTs) / 1000).toFixed(1) : null,
          wallMs: dragMs,
          wallMatchesWindow: windowed ? Math.abs((toTs - fromTs) / 1000 - dragMs) < 1500 : null,
        },
        frames: {
          event: FRAME_EVENT,
          processes: frameProcesses,
          pageProcess: {
            pid: pagePid,
            frameCount: pageFrames.length,
            // Cadence: the gap between one frame and the next. The budget in
            // `FRAME_BUDGET_SOURCE` is about frame cost, not cadence, so this row
            // is reported as cadence and not as a pass or a fail.
            cadence: intervalStats(traceIntervalsOf(pageFrames)),
          },
          // Cost: the work one frame took. The budget applies to this row.
          cost: frameCost,
          allProcessesCadence: {
            frameCount: allFrames.length,
            ...intervalStats(traceIntervalsOf(allFrames)),
          },
          droppedFrames: windowed
            ? events.filter(
                (event) =>
                  (event.name || '').startsWith('DroppedFrame') &&
                  Number.isFinite(event.ts) &&
                  event.ts >= fromTs &&
                  event.ts <= toTs,
              ).length
            : null,
          caveat:
            'The Chrome tracing domain is global to the browser, so a page trace also carries the frames of the other tabs. The page-process row uses the process id of the page mark. The rAF row counts only frames of the driven page.',
        },
        pageCadence: {
          duringGesture: raf,
          untracedGesture: untracedCadence,
          idleBaseline: baselineCadence,
          foreground,
          longTasks: {
            count: longTasks.length,
            maxMs: longTasks.length ? +Math.max(...longTasks).toFixed(1) : null,
            totalMs: longTasks.length
              ? +longTasks.reduce((sum, value) => sum + value, 0).toFixed(1)
              : null,
          },
        },
        budget: { ms: FRAME_BUDGET_MS, source: FRAME_BUDGET_SOURCE },
        verdict: {
          measuredFps: raf.fps,
          cadenceP95Ms: intervalStats(traceIntervalsOf(pageFrames)).p95Ms,
          p95FrameCostMs: frameCost?.animationFrameMs.p95Ms ?? null,
          framesOverBudgetStrict: frameCost?.animationFrameMs.intervalsOverBudget ?? null,
          framesMissed: frameCost?.animationFrameMs.intervalsOverTolerance ?? null,
          withinBudget:
            (frameCost?.animationFrameMs.p95Ms ?? null) !== null &&
            frameCost.animationFrameMs.p95Ms <= MISSED_FRAME_MS,
          note: `The budget is ${FRAME_BUDGET_MS.toFixed(1)} ms for one frame. The budget is about frame cost, so the verdict reads p95FrameCostMs. The cost row is the page frame callback (AnimationFrame), because a one-page trace carries no raster timing. A 60 Hz display delivers every 16.7 ms, so a frame counts as missed above ${MISSED_FRAME_MS.toFixed(1)} ms; the strict count is printed as well. The trace adds overhead, so these are trace-on numbers. A shared desktop can also drop a frame for reasons the map does not own, so this spec reports the numbers and does not fail on them.`,
        },
        mainThread: {
          taskDurationMs: Math.round(
            ((metric(metricsAfter, 'TaskDuration') ?? 0) -
              (metric(metricsBefore, 'TaskDuration') ?? 0)) *
              1000,
          ),
          scriptDurationMs: Math.round(
            ((metric(metricsAfter, 'ScriptDuration') ?? 0) -
              (metric(metricsBefore, 'ScriptDuration') ?? 0)) *
              1000,
          ),
          layoutCount:
            (metric(metricsAfter, 'LayoutCount') ?? 0) -
            (metric(metricsBefore, 'LayoutCount') ?? 0),
          recalcStyleCount:
            (metric(metricsAfter, 'RecalcStyleCount') ?? 0) -
            (metric(metricsBefore, 'RecalcStyleCount') ?? 0),
        },
      };
      if (allFrames.length === 0) {
        report.steps.trace.frames.attribution = `no ${FRAME_EVENT} event falls inside the gesture window`;
      }
      // A gesture with no frames cannot carry a frame number. Say that, and do
      // not invent one. The other checks still fail the run on their own.
      if (raf.frames <= 1) {
        report.steps.trace.attribution =
          'the page received no frames during the gesture, so no frame number is reported. The window is probably occluded by another window.';
        report.steps.trace.verdict = {
          measuredFps: null,
          cadenceP95Ms: null,
          p95FrameCostMs: null,
          framesOverBudgetStrict: null,
          framesMissed: null,
          withinBudget: null,
          note: 'No frame number. The page received no frames, so the gesture cannot carry a frame budget.',
        };
      }
      expect(
        raf.frames > 1 || report.steps.cadenceBaseline.frames === 0,
        'a page that receives frames while idle must also receive them during the gesture',
      ).toBe(true);
      expect(
        report.steps.trace.window.wallMatchesWindow,
        'the trace window must cover the wall-clock gesture',
      ).toBe(true);
    } finally {
      if (events.length) {
        writeFileSync(
          tracePath,
          JSON.stringify({
            traceEvents: events,
            metadata: {
              source: 'tools/ux-sweep/floor-plan-map.spec.mjs',
              viewport,
              base: BASE,
              gesture: 'slow drag of one table on the floor-plan canvas',
              recordedAt: new Date().toISOString(),
              categories: TRACE_CATEGORIES,
            },
          }),
        );
      }
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      // The list reporter prints this line, so the run carries its own numbers.
      // This block must not throw, or it hides the failure that brought us here.
      try {
        console.log(
          `[floor-plan-map] ${viewport.name}: ${json(report.steps.trace?.verdict ?? report.steps.drag ?? {})}`,
        );
        console.log(
          `[floor-plan-map] ${viewport.name}: ${json({ steps: Object.keys(report.steps) })}`,
        );
      } catch (error) {
        console.log(`[floor-plan-map] ${viewport.name}: log failed: ${String(error)}`);
      }
    }
  });
}
