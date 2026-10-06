#!/usr/bin/env node
/**
 * Screen recording — Step F6 of the ultimate platform plan, the row
 * "Screen recording | `Page.startScreencast`".
 *
 * Records one flow as a sequence of frames plus an index, so a change that is
 * easier to *watch* than to tabulate (a layout jump, a flash of empty state, a
 * modal that opens and closes) can be reviewed after the fact.
 *
 * DevTools' screencast is not a video file: it emits one image per rendered
 * frame, and the consumer decides what to do with them. Keeping the frames as
 * images is deliberate — it is what `Page.startScreencast` gives, and it means
 * each frame can be inspected, diffed, or handed to an image model. `index.json`
 * carries the timestamps, URL, and byte size of each frame, which is what a
 * video would have carried in its container.
 *
 * Usage:
 *   UX_CDP=http://127.0.0.1:9222 UX_BASE=http://127.0.0.1:4000 \
 *     node tools/ux-sweep/trace-screencast.mjs --dir /tmp/ux/screencast
 *
 * Flags:
 *   --screencast          Explicit opt-in (the flag the plan names). The script
 *                         is the screencast mode, so this is redundant.
 *   --dir <path>          Output directory. Default /tmp/ux/screencast.
 *   --flow <name>         Which flow to record. `dashboard-nav` (default).
 *   --format jpeg|png     Default jpeg (smaller frames, faster to write).
 *   --quality N           JPEG quality 0-100. Default 70.
 *   --max-frames N        Stop capturing after N frames. Default 600: a bound,
 *                         so a wedged flow cannot fill the disk.
 *   --delay <ms>          Pause between steps. Default 1500.
 *   --viewport WxH        Default 1280x720, the reference terminal.
 *   --out / --md          Summary report paths.
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { applyViewport, arg, hasFlag, parseViewport } from './lib/collect.mjs';

const WORKSPACE = process.env.UX_WORKSPACE || '/home/jc/umi';
const require = createRequire(`${WORKSPACE}/`);
const { chromium } = require('@playwright/test');

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';

const SCREENCAST_FLAG = hasFlag('--screencast');
const DIR = arg('--dir', '/tmp/ux/screencast');
const OUT = arg('--out', '/tmp/ux/screencast.json');
const MD = arg('--md', '/tmp/ux/screencast.md');
const FORMAT = arg('--format', 'jpeg');
const QUALITY = Number(arg('--quality', '70'));
const MAX_FRAMES = Number(arg('--max-frames', '600'));
const DELAY = Number(arg('--delay', '1500'));
const VIEWPORT = parseViewport(arg('--viewport', '1280x720'));
const FLOW_NAME = arg('--flow', 'dashboard-nav');

const FLOWS = {
  'dashboard-nav': [
    { kind: 'goto', route: '/' },
    // A parent group in the Dashboard sidebar is a pure disclosure toggle; only
    // a nested subitem navigates. Expand the group, then click its child.
    { kind: 'click', label: 'Reports', expand: true },
    { kind: 'click', label: 'Sales', subitem: true },
    { kind: 'click', label: 'Orders' },
    { kind: 'click', label: 'Overview' },
  ],
};

const STEPS = FLOWS[FLOW_NAME];
if (!STEPS) {
  process.stderr.write(`unknown --flow "${FLOW_NAME}"; known: ${Object.keys(FLOWS).join(', ')}\n`);
  process.exit(2);
}
if (!['jpeg', 'png'].includes(FORMAT)) {
  process.stderr.write(`--format must be jpeg or png, got "${FORMAT}"\n`);
  process.exit(2);
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context on the CDP connection.');
  const page = await context.newPage();
  const previousViewport = await applyViewport(page, VIEWPORT);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');

  let rateLimited = 0;
  const onResponse = (r) => {
    if (r.status() === 429) rateLimited += 1;
  };
  page.on('response', onResponse);

  await mkdir(DIR, { recursive: true });

  const frames = [];
  const writes = [];
  let stopped = false;
  const onFrame = (frame) => {
    if (stopped || frames.length >= MAX_FRAMES) return;
    const index = frames.length;
    const ext = FORMAT === 'png' ? 'png' : 'jpg';
    const file = `frame-${String(index).padStart(4, '0')}.${ext}`;
    const buffer = Buffer.from(frame.data, 'base64');
    frames.push({
      index,
      file,
      timestamp: frame.timestamp ?? null,
      sessionId: frame.sessionId,
      bytes: buffer.length,
      // The page's URL at capture time is not in the frame payload; the flow
      // steps record it, and the index is joined to those by timestamp.
      metadata: frame.metadata ?? null,
    });
    // Ack first: Chrome only sends the next frame after the last one is acked,
    // so a slow write must not hold up the capture.
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    writes.push(writeFile(join(DIR, file), buffer).catch(() => {}));
  };
  cdp.on('Page.screencastFrame', onFrame);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('button.side-item, form, .card', { timeout: 15000 }).catch(() => {});

  await cdp.send('Page.startScreencast', {
    format: FORMAT,
    quality: FORMAT === 'jpeg' ? QUALITY : undefined,
    maxWidth: VIEWPORT?.width,
    maxHeight: VIEWPORT?.height,
    everyNthFrame: 1,
  });

  const startedAt = Date.now();
  const steps = [];
  for (const step of STEPS) {
    const t0 = Date.now();
    const urlBefore = page.url();
    let ok = true;
    let detail = null;
    try {
      if (step.kind === 'goto') {
        await page.goto(`${BASE}${step.route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        const selector = step.subitem
          ? 'button.side-item.side-subitem'
          : 'button.side-item:not(.side-subitem)';
        await page
          .locator(selector)
          .filter({ hasText: new RegExp(`^\\s*${step.label}\\s*$`, 'i') })
          .first()
          .click({ timeout: 10000 });
      }
      await page.waitForTimeout(2000);
      detail = page.url();
    } catch (error) {
      ok = false;
      detail = (error?.message || String(error)).slice(0, 200);
    }
    steps.push({
      ...step,
      ok,
      detail,
      urlBefore,
      navigated: page.url() !== urlBefore,
      ms: Date.now() - t0,
      framesSoFar: frames.length,
    });
    process.stderr.write(
      `${step.kind === 'goto' ? 'goto ' : 'click'} ${step.route || step.label}: ${ok ? 'ok' : `FAILED ${detail}`} (${frames.length} frames)\n`,
    );
    if (DELAY > 0) await page.waitForTimeout(DELAY);
  }

  // Let the last screen settle so its final painted state is captured.
  await page.waitForTimeout(1500);
  stopped = true;
  await cdp.send('Page.stopScreencast').catch(() => {});
  await Promise.all(writes);
  const captureMs = Date.now() - startedAt;

  const totalBytes = frames.reduce((a, f) => a + f.bytes, 0);
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    flow: FLOW_NAME,
    screencastFlagAccepted: SCREENCAST_FLAG,
    dir: DIR,
    format: FORMAT,
    quality: FORMAT === 'jpeg' ? QUALITY : null,
    viewport: VIEWPORT,
    frameCount: frames.length,
    captureMs,
    framesPerSecond: captureMs > 0 ? +((frames.length / captureMs) * 1000).toFixed(2) : null,
    totalMB: +(totalBytes / 1048576).toFixed(2),
    truncatedAtMaxFrames: frames.length >= MAX_FRAMES,
    steps,
    rateLimit429s: rateLimited,
    index: join(DIR, 'index.json'),
    frames,
  };

  await writeFile(join(DIR, 'index.json'), JSON.stringify({ ...report, frames }, null, 2));
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));

  if (MD) {
    const lines = [
      '# Screen recording',
      '',
      `Generated: ${report.generatedAt}`,
      `Flow: \`${FLOW_NAME}\` · format ${FORMAT}${report.quality ? ` q${report.quality}` : ''} · viewport ${VIEWPORT?.width}x${VIEWPORT?.height}`,
      `**${frames.length} frames** in ${captureMs} ms (${report.framesPerSecond}/s), ${report.totalMB} MB total`,
      `Directory: \`${DIR}\` · index: \`${report.index}\``,
      report.truncatedAtMaxFrames
        ? `**Truncated at --max-frames ${MAX_FRAMES}.** Later frames were dropped; raise the flag for a longer flow.`
        : '',
      rateLimited > 0
        ? `**Rate limit: ${rateLimited} response(s) came back 429 during the flow** — part of the recording is the app failing to fetch.`
        : 'Rate limit: no 429 seen.',
      '',
      '| Step | Result | URL | ms | Frames by then |',
      '| --- | --- | --- | --- | --- |',
      ...steps.map(
        (s) =>
          `| ${s.kind} ${s.route || s.label} | ${s.ok ? 'ok' : 'FAILED'} | ${s.detail} | ${s.ms} | ${s.framesSoFar} |`,
      ),
      '',
      'Frames are individual `Page.startScreencast` images, not a video container. Chrome sends one when the page visibly changes, so frame count tracks repaints, not wall clock.',
    ];
    await mkdir(dirname(MD), { recursive: true });
    await writeFile(MD, `${lines.filter((l) => l !== '').join('\n')}\n`);
    process.stderr.write(`wrote ${MD}\n`);
  }

  process.stderr.write(
    `\nscreencast: ${frames.length} frames in ${captureMs} ms (${report.framesPerSecond}/s), ${report.totalMB} MB -> ${DIR}\n` +
      `index: ${report.index}\nwrote ${OUT}\n`,
  );

  cdp.off('Page.screencastFrame', onFrame);
  page.off('response', onResponse);
  if (VIEWPORT && previousViewport) await page.setViewportSize(previousViewport).catch(() => {});
  await page.close().catch(() => {});
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
