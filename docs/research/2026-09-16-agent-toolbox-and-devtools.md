# Agent toolbox and DevTools research

Date: 2026-09-16. Time zone: America/Mazatlan.

Scope: the tools that an agent must use for the Umi workspace. The document
covers browser inspection, Flutter, the API, the database, deployment, history
search, and agent ergonomics. The owner asked for Chrome DevTools in depth.
Section 2 gives that answer.

Method: every command in this document comes from a local run or from an
official source. A local run shows the real output in the verification log
(Section 12). A claim without a source is marked UNVERIFIED. This document does
not install or change anything.

Style: this document follows ASD-STE100 Simplified Technical English.

Relation to other research: `docs/research/2026-09-15-tooling-and-design-system-landscape.md`
compares tools and recommends versions. This document is the operator manual. It
gives the exact command for each recurring task.

Legend:

- VERIFIED means an agent ran the command on this machine on 2026-09-16.
- DOCUMENTED means an official source or a local skill file shows the command.
- UNVERIFIED means no source or run confirms the claim.

The evidence labels map to `docs/agents/tool-and-research-doctrine.md`: a
VERIFIED run and a DOCUMENTED source are documented facts, and an inference is
marked as an inference at the point of use.

## 0. Step 0: the five questions

The doctrine in `docs/agents/tool-and-research-doctrine.md` asks five questions
before the first command. These are the answers for this document.

| Question                              | Answer                                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does a proven tool already do this?   | Yes for every task in Section 1. One exception: the POS semantics tree. `tools/ux-sweep/pos-semantics-inventory.mjs` is the only tool with that output shape. Section 9 gives the reason.                                                                         |
| Is it installed here?                 | Mostly. Section 10 lists what is present. Missing: `vercel`, `pgcli`, `caddy`, `kubectl`, and the browser bundle `chromium_headless_shell-1237`.                                                                                                                  |
| Can an agent drive it with no prompt? | Yes, with the flags in Section 8.3. Two tools break that rule today: interactive `flutter run`, and `playwright-cli open`. The fallbacks are `dart mcp-server` and `playwright-cli attach --cdp`.                                                                 |
| What does adoption cost?              | Low for the `npx` one-shot tools. Medium for the `@playwright/cli` version bump, which needs a browser download. Medium for an OpenAPI generator, which needs a script and a page.                                                                                |
| What is the fallback?                 | `playwright-cli` falls back to the `@playwright/test` library. `chrome-devtools-mcp` falls back to `npx lighthouse` plus a small CDP script. The Vercel CLI falls back to the REST API with a token. The Cloudflare CLI falls back to `gh run view --log-failed`. |

## 1. Task to tool

Use this table first. Every row names one tool and one command. Section 2 and
later sections give the full explanation.

| Task                                    | Tool                               | Exact command                                                                                                                                | Source                                                                   |
| --------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Attach to the open Chrome               | `playwright-cli` 0.1.18            | `./node_modules/.bin/playwright-cli attach --cdp=http://127.0.0.1:9222`                                                                      | https://github.com/microsoft/playwright-cli                              |
| Find the clickable controls on a screen | `playwright-cli`                   | `./node_modules/.bin/playwright-cli -s=default snapshot`                                                                                     | `.agents/skills/playwright-cli/SKILL.md`                                 |
| Trace one flow                          | Playwright `context.tracing`       | `context.tracing.start({screenshots:true,snapshots:true}); ...; context.tracing.stop({path:'/tmp/umi-trace.zip'})`                           | https://playwright.dev/docs/trace-viewer                                 |
| Show one trace                          | `playwright-cli`                   | `./node_modules/.bin/playwright show-trace /tmp/umi-trace.zip`                                                                               | https://playwright.dev/docs/trace-viewer                                 |
| Get JS and CSS coverage for one screen  | Playwright `page.coverage`         | `await page.coverage.startJSCoverage(); await page.coverage.startCSSCoverage();`                                                             | https://playwright.dev/docs/api/class-coverage                           |
| Get the raw JS coverage counts          | CDP `Profiler`                     | `cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true})`                                                                   | https://chromedevtools.github.io/devtools-protocol/                      |
| Run a Lighthouse audit                  | `lighthouse` 13.4.1                | `npx -y lighthouse@13.4.1 http://127.0.0.1:4000/login --quiet --output=json --output-path=/tmp/lh.json`                                      | https://developer.chrome.com/docs/lighthouse/                            |
| Read performance counters               | CDP `Performance`                  | `await cdp.send('Performance.enable'); await cdp.send('Performance.getMetrics')`                                                             | https://chromedevtools.github.io/devtools-protocol/                      |
| Read the network waterfall              | Page resource timing               | `await page.evaluate(() => performance.getEntriesByType('resource'))`                                                                        | https://www.w3.org/TR/resource-timing/                                   |
| Read console errors                     | `playwright-cli`                   | `./node_modules/.bin/playwright-cli -s=default console error`                                                                                | `.agents/skills/playwright-cli/SKILL.md`                                 |
| Measure memory growth                   | CDP `Performance` + `HeapProfiler` | `cdp.send('Performance.getMetrics')`, then `cdp.send('HeapProfiler.takeHeapSnapshot',{})`                                                    | https://chromedevtools.github.io/devtools-protocol/                      |
| Emulate a slow network                  | CDP `Network`                      | `cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:400000,uploadThroughput:400000})`                 | https://chromedevtools.github.io/devtools-protocol/                      |
| Emulate a slow CPU                      | CDP `Emulation`                    | `cdp.send('Emulation.setCPUThrottlingRate',{rate:4})`                                                                                        | https://chromedevtools.github.io/devtools-protocol/                      |
| Emulate a phone                         | CDP `Emulation`                    | `cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true})`                                      | https://chromedevtools.github.io/devtools-protocol/                      |
| Stream the screen as frames             | CDP `Page`                         | `cdp.send('Page.startScreencast',{format:'jpeg',quality:40})`                                                                                | https://chromedevtools.github.io/devtools-protocol/                      |
| Read the accessibility tree             | CDP `Accessibility`                | `await cdp.send('Accessibility.getFullAXTree')`                                                                                              | https://chromedevtools.github.io/devtools-protocol/                      |
| Read the DOM in one call                | CDP `DOMSnapshot`                  | `await cdp.send('DOMSnapshot.captureSnapshot',{computedStyles:[]})`                                                                          | https://chromedevtools.github.io/devtools-protocol/                      |
| Give an agent DevTools tools            | `chrome-devtools-mcp` 1.9.0        | `npx -y chrome-devtools-mcp@1.9.0 --browserUrl http://127.0.0.1:9222`                                                                        | https://github.com/ChromeDevTools/chrome-devtools-mcp                    |
| Run an audit from an agent              | `chrome-devtools-mcp`              | tool `lighthouse_audit`                                                                                                                      | https://github.com/ChromeDevTools/chrome-devtools-mcp                    |
| Record a trace from an agent            | `chrome-devtools-mcp`              | tools `performance_start_trace`, `performance_stop_trace`                                                                                    | https://github.com/ChromeDevTools/chrome-devtools-mcp                    |
| Run the dashboard in a browser          | Vite                               | `pnpm --filter @umi/dashboard dev`                                                                                                           | `apps/umi-dashboard/package.json`                                        |
| Hot reload the POS                      | `flutter run`                      | `cd apps/umi-pos && flutter run -d linux`                                                                                                    | https://docs.flutter.dev/tools/hot-reload                                |
| Hot reload from an agent                | `dart mcp-server`                  | `dart mcp-server`, then the tool `hot_reload`                                                                                                | https://dart.dev/tools/mcp-server                                        |
| Read the Dart VM service                | Dart VM service                    | `curl -s "http://127.0.0.1:PORT/TOKEN/getVM"`                                                                                                | https://github.com/dart-lang/sdk/blob/main/runtime/vm/service/service.md |
| Read the POS semantics tree             | Flutter engine extension           | `curl -s "http://127.0.0.1:PORT/TOKEN/ext.flutter.debugDumpSemanticsTreeInTraversalOrder?isolateId=ISOLATE"`                                 | `packages/flutter/lib/src/rendering/service_extensions.dart`             |
| Read the POS widget tree                | Flutter inspector extension        | `curl -s "http://127.0.0.1:PORT/TOKEN/ext.flutter.inspector.getRootWidgetSummaryTree?isolateId=ISOLATE&objectGroup=group"`                   | `packages/flutter/lib/src/widgets/widget_inspector.dart`                 |
| Run a POS integration test              | `flutter drive`                    | `cd apps/umi-pos && flutter drive --driver=test_driver/driver_main.dart --target=integration_test/native_offline_journal_test.dart -d linux` | https://docs.flutter.dev/testing/integration-tests                       |
| Check the POS code                      | `flutter analyze`                  | `cd apps/umi-pos && flutter analyze --no-fatal-infos`                                                                                        | https://docs.flutter.dev/reference/flutter-cli                           |
| Read the API health                     | `curl` + `jq`                      | `curl -s http://127.0.0.1:4001/health \| jq`                                                                                                 | `apps/umi-api/src/modules/health/health.controller.ts`                   |
| Read the API release                    | `curl` + `jq`                      | `curl -s http://127.0.0.1:4001/health/release \| jq`                                                                                         | `apps/umi-api/src/modules/health/health.controller.ts`                   |
| Open a database shell                   | `psql` 16.15                       | `psql "$DATABASE_URL_APP"`                                                                                                                   | https://www.postgresql.org/docs/16/app-psql.html                         |
| Profile a slow query                    | `EXPLAIN (ANALYZE, BUFFERS)`       | `psql "$DATABASE_URL_APP" -c "explain (analyze, buffers) <query>"`                                                                           | https://www.postgresql.org/docs/16/sql-explain.html                      |
| Find the worst queries                  | `pg_stat_statements`               | `select * from pg_stat_statements order by total_exec_time desc limit 10;`                                                                   | https://www.postgresql.org/docs/16/pgstatstatements.html                 |
| Read a failed Vercel build              | `vercel` 59.19.0                   | `npx -y vercel@59.19.0 inspect <url> --logs`                                                                                                 | https://vercel.com/docs/cli/inspect                                      |
| Read Vercel runtime logs                | `vercel`                           | `npx -y vercel@59.19.0 logs <url> --json --level error -x`                                                                                   | https://vercel.com/docs/cli/logs                                         |
| Roll back Vercel                        | `vercel`                           | `npx -y vercel@59.19.0 rollback <url> --yes`                                                                                                 | https://vercel.com/docs/cli/rollback                                     |
| List Cloudflare Pages deployments       | `wrangler` 4.129.0                 | `wrangler pages deployment list --project-name umi-dashboard --json`                                                                         | https://developers.cloudflare.com/workers/wrangler/commands/             |
| Stream Pages Function logs              | `wrangler`                         | `wrangler pages deployment tail`                                                                                                             | https://developers.cloudflare.com/workers/wrangler/commands/             |
| Read a failed GitHub Actions job        | `gh` 2.45.0                        | `gh run view <run-id> --log-failed`                                                                                                          | https://cli.github.com/manual/gh_run_view                                |
| Verify a deploy                         | `curl`                             | `curl -fsS https://api.umiconsulting.co/health \| jq '.status, .schema.compatible'`                                                          | `apps/umi-api/src/modules/health/health.controller.ts`                   |
| Read service logs                       | `docker compose`                   | `docker compose -f apps/umi-api/docker-compose.yml logs --tail=200 -f umi-api`                                                               | https://docs.docker.com/reference/cli/docker/compose/logs/               |
| Find a lost feature                     | `git log -S`                       | `git log --all --oneline -S"<text>"`                                                                                                         | https://git-scm.com/docs/git-log                                         |
| Find a change by pattern                | `git log -G`                       | `git log --all --oneline -G"<regexp>"`                                                                                                       | https://git-scm.com/docs/git-log                                         |
| Find a branch that never merged         | `git log`                          | `git log --oneline origin/main..<branch>`                                                                                                    | https://git-scm.com/docs/git-log                                         |
| Find a closed or open PR                | `gh`                               | `gh pr list --state all --search "<text>" --limit 20`                                                                                        | https://cli.github.com/manual/gh_pr_list                                 |
| Search the code without a clone         | `gh`                               | `gh search code "<text>" --repo umiconsulting/umi`                                                                                           | https://cli.github.com/manual/gh_search_code                             |
| Work on two branches at once            | `git worktree`                     | `git worktree add ../umi-fix <branch>`                                                                                                       | https://git-scm.com/docs/git-worktree                                    |
| Find a symbol fast                      | `codegraph` 1.6.0                  | `codegraph query "<symbol>"`                                                                                                                 | https://github.com/colbymchenry/codegraph                                |
| Get small context for a task            | `codegraph`                        | `codegraph context "<task>"`                                                                                                                 | https://github.com/colbymchenry/codegraph                                |

## 2. Chrome DevTools and the Chrome DevTools Protocol

### 2.1 What is on this machine

| Item             | Value                                                               | Evidence                                          |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| Browser          | Google Chrome for Testing 152.0.7977.8                              | `chrome --version`                                |
| Browser path     | `/home/jc/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome` | wrapper script                                    |
| Wrapper          | `/home/jc/.local/bin/chromium`                                      | starts Chrome with `--remote-debugging-port=9222` |
| Debug port       | `http://127.0.0.1:9222` returns HTTP 200                            | curl probe                                        |
| Protocol version | `Protocol-Version: 1.3`, V8 15.2.124.1                              | `curl http://127.0.0.1:9222/json/version`         |
| Headless shell   | `chromium_headless_shell-1234` only. Version 1237 is absent.        | `ls ~/.cache/ms-playwright`                       |

The wrapper starts a full Chrome with a persistent profile. The profile keeps the
login cookie for the dashboard. The debug port is open on the loopback address.
The port gives the owner the normal F12 tools. An agent can attach to the same
browser.

Caution: the debug port has no authentication. Any local process can read the
open tabs and the cookies of that profile. Stop the wrapper when the owner uses
the profile for sensitive work.

### 2.2 The CDP domains that matter

The Chrome DevTools Protocol uses one WebSocket. A client sends a method with a
domain prefix. The protocol has four parts: stable, experimental, deprecated,
and total. Use the stable part.

Open the protocol reference at https://chromedevtools.github.io/devtools-protocol/tot/
and select the "stable" filter. The list below gives the domain, the key methods,
and the Umi task.

| Domain          | Key methods                                                                            | Umi task                                           |
| --------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `Performance`   | `enable`, `getMetrics`, `setTimeDomain`                                                | Counters for a screen. JS heap, DOM nodes, layout. |
| `Tracing`       | `start`, `end`, `getCategories`, `requestMemoryDump`                                   | A timeline with categories.                        |
| `Profiler`      | `enable`, `startPreciseCoverage`, `takePreciseCoverage`, `start`, `stop`               | JS coverage and a CPU profile.                     |
| `CSS`           | `enable`, `startRuleUsageTracking`, `stopRuleUsageTracking`, `getComputedStyleForNode` | CSS coverage and computed style.                   |
| `Network`       | `enable`, `emulateNetworkConditions`, `getResponseBody`, `setCacheDisabled`            | Waterfall data, slow network, response bodies.     |
| `Runtime`       | `enable`, `evaluate`, `consoleAPICalled`, `exceptionThrown`                            | Console errors and ad-hoc JavaScript.              |
| `Log`           | `enable`, `entryAdded`                                                                 | Browser-level warnings that `Runtime` misses.      |
| `DOM`           | `getDocument`, `querySelectorAll`, `getBoxModel`, `describeNode`                       | Node identity and geometry.                        |
| `DOMSnapshot`   | `captureSnapshot`, `getSnapshot`                                                       | One flat copy of the DOM with layout and style.    |
| `Memory`        | `getDOMCounters`, `startSampling`, `prepareForLeakDetection`                           | DOM counters and allocation sampling.              |
| `HeapProfiler`  | `takeHeapSnapshot`, `startSampling`, `getHeapObjectId`                                 | Heap snapshots for a memory leak.                  |
| `Emulation`     | `setDeviceMetricsOverride`, `setCPUThrottlingRate`, `setUserAgentOverride`             | Phone size and slow CPU.                           |
| `Page`          | `navigate`, `captureScreenshot`, `startScreencast`, `screencastFrame`                  | Navigation, screenshots, and a live screen stream. |
| `Accessibility` | `enable`, `getFullAXTree`, `getPartialAXTree`                                          | The tree that a screen reader and an agent read.   |
| `Fetch`         | `enable`, `fulfillRequest`, `continueRequest`                                          | Request interception with a response rewrite.      |

VERIFIED on 2026-09-16: one Playwright run used `Performance`,
`Accessibility`, `DOMSnapshot`, `Emulation`, `Network`, and `Page` without an
error. See the verification log.

The `Page.screencastFrame` event carries base64 image data. The client must
answer every frame with `Page.screencastFrameAck`. Without the answer, Chrome
stops the stream.

### 2.3 chrome-devtools-mcp

`chrome-devtools-mcp` is the official Google MCP server. The npm page is
https://www.npmjs.com/package/chrome-devtools-mcp. The source is
https://github.com/ChromeDevTools/chrome-devtools-mcp.

Version on 2026-09-16: 1.9.0. The npm registry gave 1.9.0. The local run of
`npx -y chrome-devtools-mcp@1.9.0 --help` gave the same version.

Connect to the running Chrome:

```bash
npx -y chrome-devtools-mcp@1.9.0 --browserUrl http://127.0.0.1:9222
```

Start an isolated Chrome instead:

```bash
npx -y chrome-devtools-mcp@1.9.0 --headless --isolated
```

The server gave 29 tools with the default flags. VERIFIED on 2026-09-16 by an
MCP `tools/list` call:

```text
click, close_page, drag, emulate, evaluate_script, fill, fill_form,
get_console_message, get_network_request, handle_dialog, hover, lighthouse_audit,
list_console_messages, list_network_requests, list_pages, navigate_page, new_page,
performance_analyze_insight, performance_start_trace, performance_stop_trace,
press_key, resize_page, select_page, take_heapsnapshot, take_screenshot,
take_snapshot, type_text, upload_file, wait_for
```

Three tools in that list answer three Umi questions with one call each:

- `lighthouse_audit` answers "how fast is this screen".
- `performance_start_trace` and `performance_stop_trace` answer "what happened in
  this flow".
- `take_heapsnapshot` answers "where did the memory go".

Useful flags from the local `--help` output:

| Flag                         | Effect                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| `--browserUrl <url>`         | Attach to a Chrome that is already open.                        |
| `--wsEndpoint <url>`         | Attach with a WebSocket address instead of an HTTP address.     |
| `--headless`                 | Run without a window.                                           |
| `--isolated`                 | Use a temporary profile and delete it at the end.               |
| `--slim`                     | Expose three tools only: navigation, script, screenshot.        |
| `--memoryDebugging`          | Enable the memory debugging tools.                              |
| `--experimentalScreencast`   | Enable a screen recording tool. It needs `ffmpeg`.              |
| `--screenshotMaxWidth <px>`  | Shrink screenshots and reduce the context cost.                 |
| `--pageIdRouting`            | Route each tool call by page ID. Use it for two agent sessions. |
| `--blockedUrlPattern <glob>` | Block requests by pattern.                                      |
| `--allowedUrlPattern <glob>` | Allow requests by pattern. It needs Chrome 149 or later.        |

Caution: Google collects usage data by default. Set `--usageStatistics=false` or
the environment variable `CI=1` to stop the collection.

Note: `take_heapsnapshot` was in the default list of 29 tools, without the
`--memoryDebugging` flag. That flag adds further memory tools.

### 2.4 Playwright MCP against chrome-devtools-mcp

Both servers are MCP servers. They answer different questions.

| Question                           | Playwright MCP                           | chrome-devtools-mcp        |
| ---------------------------------- | ---------------------------------------- | -------------------------- |
| Main purpose                       | Drive the page as a user                 | Inspect the browser engine |
| Default tool count                 | 24                                       | 29                         |
| Trace support                      | `--caps=devtools` adds tracing and video | `performance_start_trace`  |
| Lighthouse                         | No                                       | `lighthouse_audit`         |
| Heap snapshot                      | No                                       | `take_heapsnapshot`        |
| Network request details            | `browser_network_request`                | `get_network_request`      |
| Accessibility snapshot for a model | `browser_snapshot`                       | `take_snapshot`            |
| Cross-browser                      | Chromium, Firefox, WebKit, Edge          | Chrome only                |
| Connect to an open Chrome          | `--cdp-endpoint <url>`                   | `--browserUrl <url>`       |

VERIFIED on 2026-09-16: the local `@playwright/mcp` 0.0.80 gave 24 tools. The
same server with `--caps=devtools` gave 37 tools. The extra 13 tools add
`browser_start_tracing`, `browser_stop_tracing`, `browser_start_video`,
`browser_stop_video`, `browser_highlight`, `browser_annotate`,
`browser_start_recording`, `browser_stop_recording`, `browser_resume`,
`browser_hide_highlight`, `browser_video_chapter`, `browser_video_show_actions`,
and `browser_video_hide_actions`.

Decision rule:

- Use Playwright MCP for a user flow, a screenshot, and a form.
- Use chrome-devtools-mcp for a performance trace, a Lighthouse audit, a heap
  snapshot, and a raw CDP method.
- Use both at the same time on the port 9222 browser when one task needs both.

### 2.5 Playwright and CDP

Three facts from the installed type definitions of Playwright 1.62.1:

1. `browser.newContext({cdpEndpoint})` does NOT exist. A search for
   `cdpEndpoint` in `playwright-core/types/types.d.ts` found no result. The
   correct call is `chromium.connectOverCDP('http://127.0.0.1:9222')`.
2. `page.metrics()` does NOT exist. The string `metrics` does not appear in the
   Playwright type file. Use the CDP method `Performance.getMetrics` instead.
3. The correct names are `context.newCDPSession(page)` (Chromium only),
   `browser.newBrowserCDPSession()`, `page.coverage`, and `context.tracing`.

A near name exists in `@playwright/mcp` 0.0.80: the flag `--cdp-endpoint
<endpoint>`. VERIFIED on 2026-09-16 from the local `--help` output. Do not mix
the API name and the flag name. `--cdp-endpoint` is a server flag, and
`connectOverCDP` is a library call.

Available Playwright performance tooling:

| Tool                          | What it gives                                                              |
| ----------------------------- | -------------------------------------------------------------------------- |
| `context.tracing.start/stop`  | A zip file with DOM snapshots, screenshots, network, and console           |
| `page.coverage`               | `startJSCoverage`, `stopJSCoverage`, `startCSSCoverage`, `stopCSSCoverage` |
| `context.newCDPSession(page)` | Any CDP method, including `Performance.getMetrics`                         |
| `page.evaluate`               | `performance.getEntriesByType('resource')` for waterfall timings           |
| `chromium.connectOverCDP`     | Attach to the browser on port 9222                                         |

Limit of `page.coverage`: the property `text` was empty for all 77 JavaScript
entries of the dashboard, in both a launched browser and an attached browser.
VERIFIED on 2026-09-16. The function ranges and the call counts were present.
The source text was not. Use the CDP route in recipe b for source bytes.

### 2.6 The seven recipes

Every recipe uses the dashboard. Change the URL and the flow for the POS web
build. The POS web build runs on port 4002. The click line in each recipe is a
placeholder. Replace it with the step that you measure.

The dashboard needs a login. Use `--persistent` in `playwright-cli`, or the
profile of the port 9222 browser, to keep the session cookie.

**a. A performance trace of one flow**

```bash
cd /home/jc/umi
node -e '
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4000/login", { waitUntil: "load" });
  await page.getByRole("button", { name: "<control>" }).click(); // the step that you measure
  await context.tracing.stop({ path: "/tmp/umi-trace.zip" });
  await browser.close();
})();
'
```

VERIFIED on 2026-09-16: the same script with a local page in place of the
dashboard step wrote `/tmp/umi-trace.zip` with 5202 bytes. The trace methods and
the zip file are confirmed. UNVERIFIED: an agent did not run this script against
the dashboard login on 2026-09-16. Use `playwright-cli snapshot` to get the real
control name for the line with `<control>`.

Open the trace with the viewer:

```bash
cd /home/jc/umi && ./node_modules/.bin/playwright show-trace /tmp/umi-trace.zip
```

For long flows, use `context.tracing.startChunk()` and
`context.tracing.stopChunk({path})` around each step. The two methods exist in
Playwright 1.62.1. VERIFIED from the type definitions and from a runtime probe.

**b. JS and CSS coverage for one screen**

Playwright coverage gives function ranges. The source text was empty for the
dashboard. Use the CDP route for source bytes:

```bash
cd /home/jc/umi
node -e '
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Debugger.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  const scripts = new Map();
  cdp.on("Debugger.scriptParsed", (e) => scripts.set(e.scriptId, e.url));
  await page.goto("http://127.0.0.1:4000/login", { waitUntil: "load" });
  await page.waitForTimeout(3000);
  const cov = await cdp.send("Profiler.takePreciseCoverage");
  let bytes = 0, scripts4000 = 0;
  for (const s of cov.result) {
    const url = scripts.get(s.scriptId) || "";
    if (!url.startsWith("http://127.0.0.1:4000")) continue;
    scripts4000++;
    bytes += (await cdp.send("Debugger.getScriptSource", { scriptId: s.scriptId })).scriptSource.length;
  }
  console.log("app scripts:", scripts4000, "source bytes:", bytes);
  await browser.close();
})();
'
```

VERIFIED on 2026-09-16: 77 app scripts and 6483596 source bytes.

Do not read that number as a production weight. The Vite development server
sends each module as a separate file. Run the same code against `pnpm build` and
`vite preview` for a real number.

For CSS coverage, use the CDP domain `CSS` with `startRuleUsageTracking` and
`stopRuleUsageTracking`. UNVERIFIED: an agent did not run the CSS route on
2026-09-16.

**c. A Lighthouse audit**

```bash
cd /tmp && npx -y lighthouse@13.4.1 http://127.0.0.1:4000/login \
  --quiet --chrome-flags="--headless=new --no-sandbox" \
  --output=json --output-path=/tmp/lh.json \
  --only-categories=performance,accessibility --max-wait-for-load=15000
jq '{perf: .categories.performance.score, a11y: .categories.accessibility.score}' /tmp/lh.json
```

VERIFIED on 2026-09-16 against a local static page: version 13.4.1, score 1.0
for performance, score 0.95 for accessibility. The full result is in the
verification log.

From an agent, call the tool `lighthouse_audit` on `chrome-devtools-mcp`. That
tool removes the need for a local `lighthouse` install.

**d. Network waterfall timings**

The field `request.timing()` of Playwright gave `-1` for requests that were
still open. VERIFIED on 2026-09-16. Use the resource timing of the page instead.
The command below uses the attached session. UNVERIFIED: the agent ran the same
code through Node `page.evaluate`, not through this exact `eval` line.

```bash
cd /home/jc/umi && ./node_modules/.bin/playwright-cli -s=default --raw \
  eval "JSON.stringify(performance.getEntriesByType('resource').map(r => ({n: r.name.slice(-40), start: Math.round(r.startTime), end: Math.round(r.responseEnd), size: r.transferSize})))" | jq 'sort_by(-.end) | .[:10]'
```

VERIFIED on 2026-09-16: the login screen gave 77 resource entries. The four
slowest were `devices.jsx` (481 ms), `settings.jsx` (476 ms), `route-table.ts`
(449 ms), and a vendor chunk (441 ms).

For request and response bodies on one URL, use the CDP method
`Network.getResponseBody` or the tool `get_network_request`.

**e. Console errors**

```bash
cd /home/jc/umi && ./node_modules/.bin/playwright-cli -s=default console error
```

DOCUMENTED in `.agents/skills/playwright-cli/SKILL.md`. The library form is
`page.on('console', ...)` with `message.type() === 'error'`.

The attached dashboard login page gave 3 messages and 0 errors. VERIFIED on
2026-09-16.

Add the CDP domain `Log` to catch browser-level warnings. UNVERIFIED: an agent
did not use the `Log` domain on 2026-09-16.

**f. Memory growth over a shift**

Caution: `page.metrics()` does not exist in Playwright. Use the CDP method
`Performance.getMetrics`:

```bash
cd /home/jc/umi && node -e '
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const page = await browser.contexts()[0].newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  for (let i = 0; i < 5; i++) {
    const m = await cdp.send("Performance.getMetrics");
    const map = Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
    console.log(new Date().toISOString(), "heap MB:", Math.round(map.JSHeapUsedSize / 1048576), "nodes:", map.Nodes);
    await page.waitForTimeout(60000);
  }
  await browser.close();
})();
'
```

VERIFIED on 2026-09-16: `Performance.getMetrics` returned 36 metrics. The login
screen used 8 MB of heap and 123 DOM nodes. UNVERIFIED: the agent did not run
the five-minute loop. Run it during a real shift, and compare the first line
with the last line.

For a leak, take two snapshots with `HeapProfiler.takeHeapSnapshot` and compare
them. The MCP tool `take_heapsnapshot` does the same. UNVERIFIED: an agent did
not compare two heap snapshots on 2026-09-16.

**g. A throttled 3G run**

```bash
cd /home/jc/umi && node -e '
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 150, downloadThroughput: 400000, uploadThroughput: 400000,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto("http://127.0.0.1:4000/login", { waitUntil: "load" });
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return { ttfb: Math.round(n.responseStart), load: Math.round(n.loadEventEnd) };
  });
  console.log(nav);
  await browser.close();
})();
'
```

VERIFIED on 2026-09-16: both CDP methods returned without an error. The numbers
`150` ms, `400000` bytes per second, and rate `4` are the standard 3G numbers of
the Chrome DevTools throttle presets. UNVERIFIED: this document does not prove
that those numbers equal the "Fast 3G" preset exactly.

Emulate a phone at the same time. Use
`Emulation.setDeviceMetricsOverride` with
`{width:390,height:844,deviceScaleFactor:3,mobile:true}`.

### 2.7 The live screen stream

`Page.startScreencast` sends JPEG frames to the client. This is useful for a
remote or a headless run. VERIFIED on 2026-09-16: one frame of 8616 base64
characters arrived in 1.2 seconds.

The client must answer each frame:

```javascript
cdp.on("Page.screencastFrame", (f) => {
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 40 });
```

For a recording, use the tool `browser_start_video` in Playwright MCP with
`--caps=devtools`, or `--experimentalScreencast` in `chrome-devtools-mcp` with
`ffmpeg` on the path. `ffmpeg` 6.1.1 is installed on this machine.

## 3. Browser automation and agent driving

### 3.1 The candidates

| Tool                | Version on 2026-09-16  | Start command                                                           | Best job                                             |
| ------------------- | ---------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Playwright          | 1.62.1                 | `./node_modules/.bin/playwright test`                                   | A repeatable test with a trace and a report.         |
| `playwright-cli`    | 0.1.18 (0.1.20 latest) | `./node_modules/.bin/playwright-cli attach --cdp=http://127.0.0.1:9222` | Quick agent work from a shell.                       |
| Playwright MCP      | 0.0.80 (0.0.81 latest) | `./node_modules/.bin/playwright-mcp`                                    | A long agent session with many small steps.          |
| chrome-devtools-mcp | 1.9.0                  | `npx -y chrome-devtools-mcp@1.9.0 --browserUrl http://127.0.0.1:9222`   | Performance, Lighthouse, heap, and raw CDP.          |
| Puppeteer           | 25.11.0                | `npm i puppeteer`                                                       | A small Chromium-only script with direct CDP access. |
| Stagehand           | 4.1.0                  | `npm i @browserbasehq/stagehand`                                        | Natural-language actions over Playwright.            |
| browser-use         | 0.13.10                | `uvx browser-use` (PyPI)                                                | A Python agent that plans its own steps.             |
| Midscene            | 1.12.8                 | `npm i @midscene/web`                                                   | Visual assertions and coordinate actions.            |
| Skyvern             | 1.0.48                 | `uvx skyvern` (PyPI)                                                    | A browser workflow that adapts to layout changes.    |

Every version above comes from the npm registry, the PyPI API, or the pub.dev
API on 2026-09-16. UNVERIFIED: the agent did not run Puppeteer, Stagehand,
browser-use, Midscene, or Skyvern on this machine.

Source URLs:

- Playwright: https://playwright.dev
- `playwright-cli`: https://github.com/microsoft/playwright-cli
- Playwright MCP: https://github.com/microsoft/playwright-mcp
- chrome-devtools-mcp: https://github.com/ChromeDevTools/chrome-devtools-mcp
- Puppeteer: https://pptr.dev
- Stagehand: https://github.com/browserbase/stagehand
- browser-use: https://docs.browser-use.com
- Midscene: https://midscenejs.com
- Skyvern: https://github.com/Skyvern-AI/skyvern

### 3.2 Which one for which job

- Use Playwright for a product test. It gives a trace, a video, a report, and a
  stable API. The workspace has a `postgresql-best-practices` skill and a
  `playwright-cli` skill. Read the skill before a new test.
- Use `playwright-cli` when an agent needs five actions and one screenshot. The
  output is small. The flag `--raw` returns the value only.
- Use Playwright MCP for a long session with many steps. The MCP server keeps
  the browser between calls.
- Use chrome-devtools-mcp when the question is about performance, memory, or a
  protocol method.
- Use Puppeteer only for a Chromium-only script that needs a raw CDP method and
  no Playwright install. Prefer `page.coverage` and `context.newCDPSession` in
  Playwright for the same result.
- Use Stagehand, Midscene, or Skyvern when the target changes often and a fixed
  selector is a poor fit. These tools trade speed and cost for flexibility.
- Do not use a vision-driven agent for a form that a role selector can fill.
  The token cost is high and the result is less stable.

### 3.3 The local state of `playwright-cli`

The command `playwright-cli open` FAILS on this machine today. VERIFIED on
2026-09-16:

```text
Error: Browser "chromium" is not installed; expected executable at
/home/jc/.cache/ms-playwright/chromium_headless_shell-1237/chrome-headless-shell-linux64/chrome-headless-shell.
Run `playwright-cli install-browser chromium` to install
```

The cause is a version gap. `@playwright/cli` 0.1.18 uses
`playwright-core` 1.63.0-alpha, and that build wants the browser bundle 1237.
The machine has `chromium-1237` (the full browser) and
`chromium_headless_shell-1234`. The package `chromium_headless_shell-1237` is
absent. UNVERIFIED: the agent did not run `playwright-cli install-browser`.

Three ways to continue:

1. Attach to the browser on port 9222. This route works today. VERIFIED on
   2026-09-16:

   ```bash
   cd /home/jc/umi && ./node_modules/.bin/playwright-cli attach --cdp=http://127.0.0.1:9222
   ```

   The command answered `Session default created, attached to
http://127.0.0.1:9222` and listed the open tabs.

2. Run `playwright-cli install-browser chromium`. This action downloads the
   missing bundle. It is a local download into `~/.cache/ms-playwright`. It is
   not a global package install.

3. Use `@playwright/test` from Node. The library uses `chromium-1237`, and that
   bundle is present. Every Playwright recipe in Section 2 uses this route.

### 3.4 Guard rails for agent browser work

- Use one named session per job: `playwright-cli -s=perf <command>`.
- Use `--raw` to keep the output small.
- Do not leave tabs open. The port 9222 browser held 9 tabs on 2026-09-16:
  seven login screens, one POS page, and one blank page.
- Do not use the owner profile for a test that writes data. Use
  `chromium.launch()` with a new context.
- Prefer a role selector over a pixel coordinate.
- Keep the browser on the loopback address only.

## 4. Flutter development

### 4.1 The local facts

| Item             | Value                                                             | Evidence                    |
| ---------------- | ----------------------------------------------------------------- | --------------------------- |
| Flutter          | 3.44.6 stable, revision `ee80f08bbf`                              | `flutter --version`         |
| Dart             | 3.12.2                                                            | `dart --version`            |
| DevTools         | 2.57.0                                                            | `flutter --version`         |
| Devices          | `Linux (desktop) linux-x64`                                       | `flutter devices`           |
| POS app          | `apps/umi-pos`, package `umi_pos` 0.1.0+1                         | `apps/umi-pos/pubspec.yaml` |
| POS test files   | `test/`, plus `integration_test/native_offline_journal_test.dart` | directory listing           |
| POS driver       | `test_driver/driver_main.dart`                                    | directory listing           |
| POS dependencies | `integration_test`, `flutter_driver`, `flutter_test`              | `apps/umi-pos/pubspec.yaml` |
| POS web server   | port 4002, started with `--release`                               | `ps aux`                    |

The POS web server on port 4002 runs in release mode. VERIFIED on 2026-09-16
from the process list:

```text
flutter_tools.snapshot run --release -d web-server --web-hostname 127.0.0.1 --web-port 4002
```

DOCUMENTED: the debugger and hot reload work in a debug build only. For
introspection, start a debug build. Source:
https://docs.flutter.dev/tools/hot-reload

### 4.2 `flutter run` and hot reload

Start the POS on the Linux desktop:

```bash
cd /home/jc/umi && pnpm umi-pos:linux
```

That script runs `flutter run -d linux`. The run is interactive. Press `r` for a
hot reload. Press `R` for a hot restart. Press `q` to stop.

For an agent, `flutter run` in a pipe is a poor control path. Use one of these
two routes instead.

Route 1, the Dart MCP server:

```bash
dart mcp-server
```

VERIFIED on 2026-09-16 from `dart mcp-server --help`. The server exposes these
tools and features:

```text
analyze_files, create_project, dart_fix, dart_format, dtd, flutter_driver_command,
get_active_location, get_app_logs, get_runtime_errors, hot_reload, hot_restart,
launch_app, list_devices, list_running_apps, lsp, pub, pub_dev_search,
read_package_uris, rip_grep_packages, roots, run_tests, stop_app, widget_inspector,
flutter_driver_user_journey_test
```

The tools `launch_app`, `hot_reload`, `hot_restart`, `get_app_logs`,
`get_runtime_errors`, `widget_inspector`, `run_tests`, and `stop_app` cover the
full loop. The workspace `.mcp.json` already starts this server with the command
`dart mcp-server`. Source: https://dart.dev/tools/mcp-server

Route 2, a pinned VM service port:

```bash
cd /home/jc/umi/apps/umi-pos && flutter run -d linux --device-vmservice-port=8181 --dds-port=8182
```

VERIFIED on 2026-09-16 from `flutter run --help`: both flags exist.

### 4.3 The Dart VM service over HTTP

The VM service answers a JSON-RPC request over an HTTP GET. The URL shape is
`http://<host>:<port>/<auth-token>/<method>?<parameter>=<value>`.

VERIFIED on 2026-09-16 against a Dart program started with
`dart run --observe=8182`:

```text
BASE=http://127.0.0.1:8182/J3Tt0x9XQJA=/
GET /getVersion                -> {"type":"Version","major":4,"minor":21}
GET /getVM                     -> isolates/5982490152440871
GET /getIsolate?isolateId=...  -> {"type":"Isolate","name":"main","pauseKind":"Resume","libs":22}
```

The auth token is in the startup line of the run:

```text
The Dart VM service is listening on http://127.0.0.1:8182/J3Tt0x9XQJA=/
```

That line comes from a Dart program. `flutter run` prints its own message. Read
the token from the log with the same shape. The repo script
`tools/ux-sweep/pos-semantics-inventory.mjs` greps the log with the regular
expression `http://127\.0\.0\.1:\d+\/[A-Za-z0-9_=-]+\//` and takes the last
match.

Do not use `--disable-service-auth-codes`. That flag is deprecated and it lets
any local process control the app. Source:
https://github.com/dart-lang/sdk/blob/main/runtime/vm/service/service.md

The Flutter framework adds its own methods. The prefix rule is in the SDK:

```text
packages/flutter/lib/src/foundation/binding.dart:834        'extension': 'ext.flutter.$name'
packages/flutter/lib/src/widgets/widget_inspector.dart:933  'extension': 'ext.flutter.inspector.$name'
```

The names below are in the installed SDK:

| Need                | Method                                                    | SDK location                            |
| ------------------- | --------------------------------------------------------- | --------------------------------------- |
| Semantics tree      | `ext.flutter.debugDumpSemanticsTreeInTraversalOrder`      | `rendering/service_extensions.dart:130` |
| Hit-test order tree | `ext.flutter.debugDumpSemanticsTreeInInverseHitTestOrder` | `rendering/service_extensions.dart:139` |
| Widget tree summary | `ext.flutter.inspector.getRootWidgetSummaryTree`          | `widgets/widget_inspector.dart:1262`    |
| Widget tree, full   | `ext.flutter.inspector.getRootWidgetTree`                 | `widgets/widget_inspector.dart:1272`    |
| One subtree         | `ext.flutter.inspector.getDetailsSubtree`                 | `widgets/widget_inspector.dart:1277`    |
| The selected widget | `ext.flutter.inspector.getSelectedWidget`                 | `widgets/widget_inspector.dart:1292`    |

A working call for the semantics tree:

```bash
BASE=$(grep -oE "http://127\.0\.0\.1:[0-9]+/[A-Za-z0-9_=-]+/" /tmp/umi-pos.log | tail -1)
ISO=$(curl -sS "${BASE}getVM" | jq -r '.result.isolates[0].id')
curl -sS "${BASE}ext.flutter.debugDumpSemanticsTreeInTraversalOrder?isolateId=$ISO" | jq -r '.result.data' | head -40
```

A working call for the widget tree:

```bash
curl -sS "${BASE}ext.flutter.inspector.getRootWidgetSummaryTree?isolateId=$ISO&objectGroup=umi" | jq .
```

DOCUMENTED: the repo script `tools/ux-sweep/pos-semantics-inventory.mjs` uses
exactly this route. It reads `getVM` and
`ext.flutter.debugDumpSemanticsTreeInTraversalOrder`, then parses the text tree
into nodes with a label, a rectangle, and an action list.

UNVERIFIED: an agent did not complete a live semantics or widget call against the
POS on 2026-09-16. The first attempt failed for two reasons. The port 4002
instance runs in release mode. A new debug instance on port 4911 did not open
its port inside four minutes. Section 14 records this limit.

### 4.4 DevTools for Flutter

Start DevTools against a running app:

```bash
dart devtools http://127.0.0.1:PORT/TOKEN/
```

VERIFIED on 2026-09-16 from `dart devtools --help`: the command accepts the
service protocol URI. The flag `--machine` gives JSON output. The flag
`--dtd-uri=<uri>` connects to a Dart Tooling Daemon. The flag
`--no-launch-browser` stops the automatic browser start.

DevTools panels that matter for the POS:

| Panel            | Use                                                 | Source                                              |
| ---------------- | --------------------------------------------------- | --------------------------------------------------- |
| Widget inspector | Widget tree, layout errors, and the semantics tree. | https://docs.flutter.dev/tools/devtools/inspector   |
| Performance      | Frame chart and the performance overlay.            | https://docs.flutter.dev/tools/devtools/performance |
| Timeline         | Frame events with a category.                       | https://docs.flutter.dev/tools/devtools/timeline    |
| Memory           | Heap growth and a leak check.                       | https://docs.flutter.dev/tools/devtools/memory      |
| Network          | HTTP requests from the Dart `http` client.          | https://docs.flutter.dev/tools/devtools/network     |

The performance overlay is a runtime switch. Set
`showPerformanceOverlay: true` in the app for a build, or use the DevTools
button.

UNVERIFIED: the agent did not open a DevTools panel on 2026-09-16.

### 4.5 Tests

Unit and widget tests run without a device:

```bash
cd /home/jc/umi/apps/umi-pos && flutter test test/checkout_test.dart
```

Integration tests need a device:

```bash
cd /home/jc/umi/apps/umi-pos && flutter test integration_test/native_offline_journal_test.dart -d linux
```

The driver form:

```bash
cd /home/jc/umi/apps/umi-pos && flutter drive \
  --driver=test_driver/driver_main.dart \
  --target=integration_test/native_offline_journal_test.dart -d linux
```

VERIFIED on 2026-09-16 from `flutter drive --help` and `flutter test --help`:
both commands accept `-d`, `--dart-define`, `--profile`, and `--release`. The
command `flutter test` also accepts `--coverage`, `--coverage-path`, and
`--reporter`. Source: https://docs.flutter.dev/testing/integration-tests

For a machine-readable run, use `flutter test --reporter json` or
`flutter test --machine`. UNVERIFIED: the agent did not run the POS test suite on
2026-09-16.

### 4.6 Patrol

Patrol 4.10.0 is on pub.dev. It adds native dialogs, permission prompts, and a
`patrol` CLI to a Flutter integration test. Source: https://patrol.leancode.co

The POS does not use Patrol on 2026-09-16. A search of
`apps/umi-pos/pubspec.yaml` found no `patrol` entry. Add it only when a test must
touch a permission dialog or a system prompt. A permission dialog on the Linux
desktop build is a rare case.

### 4.7 Analyze and build

```bash
cd /home/jc/umi/apps/umi-pos && flutter analyze --no-fatal-infos
cd /home/jc/umi/apps/umi-pos && flutter build linux --release
```

VERIFIED on 2026-09-16 from the help output: `flutter analyze` accepts
`--no-fatal-infos`, `--no-fatal-warnings`, `--watch`, and `--write=<file>`.
`flutter build linux` accepts `--release`, `--debug`, `--dart-define`, and
`--analyze-size`. Source: https://docs.flutter.dev/reference/flutter-cli

The workspace wrapper for the desktop run is `pnpm umi-pos:linux`. The wrapper
for the release manifest is `pnpm umi-pos:generate` and
`node scripts/generate-release-manifest.mjs`.

## 5. API and database work

### 5.1 Inspect the running NestJS API

The API answers on port 4001. VERIFIED on 2026-09-16: `curl -s
http://127.0.0.1:4001/health` returned HTTP 200. These are the important fields,
with the long values shortened:

```json
{
  "status": "ok",
  "state": "Healthy",
  "db": true,
  "redis": true,
  "release": { "application": "umi-api", "version": "development", "contractVersion": "2.13.0" },
  "schema": { "current": "build-v3-62", "expected": "build-v3-62", "compatible": true }
}
```

The controller `apps/umi-api/src/modules/health/health.controller.ts` gives five
routes:

| Route                     | Use                                                | Guard                            |
| ------------------------- | -------------------------------------------------- | -------------------------------- |
| `GET /health/live`        | Process is alive.                                  | None.                            |
| `GET /health`             | Alias of `ready`.                                  | None.                            |
| `GET /health/ready`       | Database and Redis check. HTTP 503 when not ready. | None.                            |
| `GET /health/release`     | Release identity and contract version.             | None.                            |
| `GET /health/diagnostics` | Deep diagnostics.                                  | Header `x-umi-operations-token`. |

The `diagnostics` route needs the config value `OPERATIONS_TOKEN`. That value is
optional in `apps/umi-api/src/shared/config/config.schema.ts:40`. It is NOT in
`apps/umi-api/.env` on 2026-09-16. The controller raises `ForbiddenException`
without the header. UNVERIFIED: an agent did not call that route on 2026-09-16.

Useful one-liners:

```bash
curl -s http://127.0.0.1:4001/health | jq '{status, db, redis, schema}'
curl -s http://127.0.0.1:4001/health/release | jq
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4001/health/ready
```

The API writes JSON logs through `JsonLogger`. Read the NestJS watch log in the
terminal that runs `pnpm dev`, or read the container log with `docker compose
logs`.

### 5.2 OpenAPI

The workspace has NO OpenAPI document and NO `@nestjs/swagger` dependency on
2026-09-16. VERIFIED: a recursive search of `apps/umi-api/src` and
`packages/contract/src` for the strings `swagger` and `openapi` returned no
file. A search of `apps/umi-api/package.json` for those names returned no entry.

Two honest options:

1. Add `@nestjs/swagger` 12.0.1 and decorate the controllers. The package
   version comes from the npm registry on 2026-09-16. Source:
   https://docs.nestjs.com/openapi/introduction
2. Generate the document from the Zod contract. The document
   `docs/research/2026-09-15-tooling-and-design-system-landscape.md` recommends
   `@asteasolutions/zod-to-openapi` 9.1.0 with `@scalar/api-reference` 1.68.0.
   That route has one schema source: `packages/contract`.

Prefer option 2. The contract already generates TypeScript and Dart. A second
schema source in decorators will drift.

### 5.3 The Postgres CLI workflow

The API `.env` holds two connection strings. Use them directly. Do not retype a
password.

```bash
cd /home/jc/umi
eval "$(grep -E '^DATABASE_URL_APP=' apps/umi-api/.env | sed 's/^/export /')"
psql "$DATABASE_URL_APP" -c "select current_database(), current_user, version();"
```

VERIFIED on 2026-09-16:

```text
current_database: umi_transition_rehearsal_20260901
current_user:     api_login
server:           PostgreSQL 17.10 (Debian)
client:           psql 16.15
```

The local stack is defined in `deploy/local/compose.yml`. The database image is
`pgvector/pgvector:0.8.5-pg17-bookworm`. The port is `127.0.0.1:4003`. The
settings include `max_connections=60` and `shared_buffers=128MB`.

Useful psql flags for an agent:

| Flag                 | Effect                                         |
| -------------------- | ---------------------------------------------- |
| `-c "<sql>"`         | Run one statement and stop.                    |
| `-A -t`              | Unaligned output, tuples only. Cheap to parse. |
| `-F,`                | Comma separator with `-A`.                     |
| `-v ON_ERROR_STOP=1` | Stop at the first error.                       |
| `-f <file>`          | Run a file.                                    |

`pgcli` is NOT installed on this machine. The npm registry does not hold it. The
PyPI version is 4.6.0 on 2026-09-16. Source: https://www.pgcli.com

### 5.4 Profile a slow query

Step 1, get the plan with buffers:

```bash
psql "$DATABASE_URL_APP" -c "explain (analyze, buffers) <your query>"
```

VERIFIED on 2026-09-16: `explain (analyze, buffers) select 1;` returned a plan
with `Planning Time: 0.158 ms` and `Execution Time: 0.050 ms`.

`EXPLAIN ANALYZE` runs the statement. Do not run it on an `UPDATE` or a
`DELETE` outside a transaction. Wrap the statement:

```bash
psql "$DATABASE_URL_APP" -c "begin; explain (analyze, buffers) <write query>; rollback;"
```

Step 2, read the counters across the whole server. The extension
`pg_stat_statements` is the tool:

```sql
select calls, round(total_exec_time::numeric, 1) as total_ms,
       round(mean_exec_time::numeric, 2) as mean_ms, rows, query
from pg_stat_statements
order by total_exec_time desc
limit 10;
```

Source: https://www.postgresql.org/docs/16/pgstatstatements.html

State on this machine on 2026-09-16:

- The local development database does NOT have `pg_stat_statements`. VERIFIED:
  `select extname from pg_extension` returned `plpgsql, pg_trgm, pgcrypto,
unaccent, vector`.
- `show shared_preload_libraries` returned an empty value on the local stack.
  The extension needs that setting at server start.
- The pilot and preview definitions DO create it.
  `db/preview/002_schema.sql:100` runs `CREATE EXTENSION IF NOT EXISTS
"pg_stat_statements" WITH SCHEMA "extensions";`. `docs/migration/build-v3/security_gate.sql:248`
  records the same extension in the target database.

Step 3, find one slow statement in the server log. The repository already
documents the trigger. `docs/migration/build-v3/security_gate.sql:326-337`
discusses `log_min_duration_statement = 500ms` as the request-path trigger. The
pilot compose file sets `log_min_duration_statement=-1` at
`deploy/pilot/compose.yml:38`, and `deploy/pilot/postgres-init.sh:25` sets the
same value for the roles `umi_api_login` and `umi_worker_login`. A value of `-1`
disables the log. A positive value in milliseconds enables it for statements
above that cost.

### 5.5 Connection pooling

`apps/umi-api/src/shared/database/pg.service.ts` holds two pools:

```text
line 199:  readonly app: Pool;
line 200:  readonly worker: Pool;
line 211:  this.app = new Pool({
line 212:    connectionString: config.get('DATABASE_URL_APP', { infer: true }),
line 215:  this.worker = new Pool({
line 216:    connectionString: config.get('DATABASE_URL_WORKER', { infer: true }),
```

The file sets no `max` value. The default of `node-postgres` is 10 clients for
each pool. Source: https://node-postgres.com/apis/pool

The local Postgres allows 60 connections. Two API processes with two pools each
can use 40 connections. Check the live count before you add a pool:

```sql
select count(*), state from pg_stat_activity group by state;
```

The file also enforces the pool roles at boot. The comment at
`apps/umi-api/src/shared/database/pg.service.ts:242` names the boot guard
`assertPoolRoles()`. Read that function before you change a role.

### 5.6 Migrations

The state on 2026-09-16:

| Path                                | Content                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `docs/migration/build-v3/*.sql`     | 33 build-v3 definition files, `00` to `61`, plus `90_rls.sql` and `99_verify.sql`. |
| `docs/migration/build-v3/00_run.sh` | The runner. Root script: `pnpm db:build-v3`.                                       |
| `apps/umi-api/db/roles/*.sql`       | The login roles and grants, `001` to `004`.                                        |
| `apps/umi-api/db/migrations/`       | Empty. One file only: `.gitkeep`. VERIFIED.                                        |
| `supabase/migrations`               | Does NOT exist in the checkout on 2026-09-16. VERIFIED.                            |

The root `AGENTS.md` states the rule: approved post-cutover migrations belong in
`supabase/migrations`. That directory is absent today. A migration tool is
therefore a real gap.

Options:

- `kysely` 0.29.6 for typed query code, per
  `docs/research/2026-09-15-tooling-and-design-system-landscape.md`. Source:
  https://kysely.dev
- `@pgtyped/cli` 2.4.3 for types generated from SQL files. Source:
  https://pgtyped.dev
- The raw SQL runner that exists today: `pnpm db:build-v3`.

Do not add Prisma. The registry version on 2026-09-16 is `8.0.0-rc.15`, a
release candidate. The API uses `pg` directly, and the roles carry RLS rules.
A generator that hides the SQL adds risk for no gain.

## 6. Deployment and infrastructure

### 6.1 The targets in this repository

| Target           | Mechanism                                                  | Source file                                                             |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cloudflare Pages | GitHub Actions calls `wrangler pages deploy`               | `.github/workflows/deploy-dashboard.yml`                                |
| Vercel           | A linked project, superseded by Cloudflare Pages           | `.vercel/repo.json`                                                     |
| VPS with Caddy   | GitHub Actions builds the image, the VPS pulls it over SSH | `.github/workflows/deploy-backend.yml`, `apps/umi-api/deploy/deploy.sh` |
| Supabase         | A Postgres host. The migration directory is absent today.  | `AGENTS.md`                                                             |
| Railway          | Not an active target. A report and one doc mention it.     | `docs/reports/2026-07-26-*.md`                                          |
| Kubernetes       | Not used. `kubectl` is NOT installed on this machine.      | `command -v kubectl`                                                    |

The header of `.github/workflows/deploy-dashboard.yml` states the change
directly: "This REPLACES Vercel's Git integration for the dashboard."

`.vercel/repo.json` still holds a linked project. It names the project
`umi-dashboard` in the directory `apps/umi-dashboard`. Vercel can still build in
parallel until somebody disconnects the project. A failed Vercel build is
therefore still possible. Section 6.2 shows how to read it.

The VPS deploy is a pull deploy. The workflow typechecks, builds, and tests. It
then pushes an image to GHCR. Then it runs `apps/umi-api/deploy/deploy.sh` over
SSH. That script resets the checkout to the branch, pins the image tag in
`.env`, and runs `docker compose pull` and `docker compose up -d`. The box never
builds the image. Source file: `apps/umi-api/deploy/deploy.sh`.

### 6.2 Read a failed Vercel build from the terminal

This is the answer to the failure that consumed one hour.

The Vercel CLI is NOT installed on this machine. VERIFIED: `command -v vercel`
returned nothing. The registry version is 59.19.0. Run it through `npx`:

Step 1, find the failed deployment:

```bash
cd /home/jc/umi/apps/umi-dashboard
npx -y vercel@59.19.0 ls --status ERROR --json | jq '.[] | {url, state, createdAt}'
```

VERIFIED on 2026-09-16 from `vercel ls --help`: the flag `--status` accepts a
comma-separated list, for example `--status BUILDING,READY`. The flag `--json`
gives JSON.

Step 2, read the BUILD LOG. This is the important command:

```bash
npx -y vercel@59.19.0 inspect <deployment-url> --logs
```

VERIFIED on 2026-09-16 from `vercel inspect --help`: the description of `-l,
--logs` is "Prints the build logs instead of the deployment summary". The
command also accepts `--json` and `--wait`.

Step 3, read the RUNTIME log when the build passed and the site still fails:

```bash
npx -y vercel@59.19.0 logs <deployment-url> --json --level error -x
```

VERIFIED on 2026-09-16 from `vercel logs --help`: `--json` gives JSON Lines,
`--level` accepts `error, warning, info, fatal`, and `-x, --expand` shows the
full message below each line. The flag `-f, --follow` streams live logs.

Step 4, use the REST API when the CLI is not available. The two endpoints:

```bash
# List deployments for a project. Needs a token.
curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=<id>&limit=5" | jq '.deployments[] | {uid, url, readyState}'

# Read the build events of one deployment.
curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v2/deployments/<id>/events?builds=1" | jq '.[] | {type, text}'
```

VERIFIED on 2026-09-16 without a token: `/v6/deployments` answered HTTP 403 with
`{"error":{"code":"forbidden","message":"The request is missing an
authentication token"}}`. `/v2/deployments/<id>/events` answered HTTP 404 with
`Deployment not found`. Both answers prove that the paths are correct.

No token exists on this machine. VERIFIED: `VERCEL_TOKEN` is unset. UNVERIFIED:
an agent did not read a real Vercel build log on 2026-09-16.

Other useful Vercel commands, all VERIFIED from the CLI help on 2026-09-16:

| Command                              | Use                                            |
| ------------------------------------ | ---------------------------------------------- |
| `vercel rollback <url> --yes`        | Revert to a previous deployment.               |
| `vercel redeploy <url>`              | Rebuild a previous deployment.                 |
| `vercel promote <url>`               | Move a deployment to production.               |
| `vercel deploy --dry --json`         | Show the detected framework and the file list. |
| `vercel build`                       | Build locally into `./vercel/output`.          |
| `vercel api <endpoint>`              | Call the API with the stored token.            |
| `vercel httpstat <path>`             | Show HTTP timing statistics.                   |
| `vercel --non-interactive <command>` | Stop every prompt.                             |

The global flag `--non-interactive` is the best agent flag. The help text says:
"Run without interactive prompts; when an agent is detected this is the
default."

### 6.3 Cloudflare Pages

`wrangler` 4.129.0 is installed. VERIFIED commands:

```bash
cd /home/jc/umi
wrangler pages project list --json
wrangler pages deployment list --project-name umi-dashboard --json
wrangler pages deployment list --project-name umi-dashboard --environment production --json
wrangler pages deployment tail
wrangler pages deploy dist --project-name umi-dashboard
```

VERIFIED on 2026-09-16 from the local help output: `wrangler pages deployment`
has the subcommands `list`, `create`, `tail`, and `delete`. `tail` is described
as "Start a tailing session for a project's deployment and livestream logs from
your Functions". The flag `--json` exists on `project list` and on `deployment
list`.

`CLOUDFLARE_API_TOKEN` is unset on this machine. UNVERIFIED: an agent did not
call the Cloudflare API on 2026-09-16.

For the build log of a Pages deployment, read the GitHub Actions run that built
it. The workflow is `.github/workflows/deploy-dashboard.yml`. Use Section 6.4.

### 6.4 GitHub Actions and `gh`

`gh` 2.45.0 is installed and authenticated as `umi-juanlopez`. VERIFIED on
2026-09-16.

```bash
cd /home/jc/umi
gh run list --limit 10 --json databaseId,name,status,conclusion,event --jq '.[] | [.databaseId, .conclusion, .name] | @tsv'
gh run view <run-id> --log-failed
gh run view <run-id> --json jobs --jq '.jobs[] | select(.conclusion=="failure") | .name'
gh run watch <run-id> --exit-status
```

VERIFIED on 2026-09-16 from the local help and from a live call:
`gh run view --help` lists `-l, --log`, `--log-failed`, `-j, --job`, `--json`,
and `--exit-status`. `gh run list` returned five runs, all `completed`
`success`, including `deploy dashboard (cloudflare pages)`.

Note: `gh run view --log-failed` is the fastest way to read a failed CI build.
The workflow copies the build output into the job log.

### 6.5 Docker

```bash
cd /home/jc/umi
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker compose -f deploy/local/compose.yml logs --tail=100 -f postgres
docker compose -f apps/umi-api/docker-compose.yml logs --tail=200 -f umi-api
docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
docker compose -f deploy/local/compose.yml exec postgres psql -U postgres -c '\l'
```

VERIFIED on 2026-09-16: `docker ps` showed
`umi-buildv3-local-postgres-1` and `umi-buildv3-local-redis-1`, both `healthy`.
`docker stats --no-stream` showed 60.57 MiB for Postgres and 3.777 MiB for
Redis. `docker compose logs --tail=3 postgres` returned real log lines.

Docker version: 29.1.3. Docker Compose version: 2.40.3.

### 6.6 Caddy

The `caddy` binary is NOT installed on this machine. VERIFIED:
`command -v caddy` returned nothing. Caddy runs inside the VPS container stack.
The service is real. VERIFIED on 2026-09-16: `docker compose -f
apps/umi-api/docker-compose.yml config --services` returned `redis`, `umi-api`,
`caddy`, and `umi-worker`. The compose file names the image
`caddy:2.10.2-alpine` at line 72, and it mounts `./Caddyfile` at
`/etc/caddy/Caddyfile` at line 89.

Two config files exist in the repository:

- `apps/umi-api/Caddyfile`
- `deploy/pilot/Caddyfile`

The SSH target is a repository secret, not a local name. VERIFIED on
2026-09-16: `.github/workflows/deploy-backend.yml:132-135` reads
`VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`, and `VPS_SSH_PORT`. Use your own SSH
alias in the commands below.

Read the config from the running container:

```bash
ssh <vps-alias> "docker compose -f ~/umi/apps/umi-api/docker-compose.yml exec caddy cat /etc/caddy/Caddyfile"
ssh <vps-alias> "docker compose -f ~/umi/apps/umi-api/docker-compose.yml logs --tail=200 caddy"
```

Reload Caddy after a config change:

```bash
ssh <vps-alias> "docker compose -f ~/umi/apps/umi-api/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile"
```

UNVERIFIED: an agent did not run a Caddy command on 2026-09-16. The service
name `caddy` and the config path come from the compose file. Confirm both with
`docker compose config` before you use the commands.

### 6.7 Verify a deploy, and roll it back

Verify with three checks:

```bash
curl -fsS https://api.umiconsulting.co/health | jq '{status, db, redis, schema, release}'
curl -fsS https://api.umiconsulting.co/health/release | jq '.gitCommit, .buildTimestamp'
curl -fsS -o /dev/null -w "%{http_code}\n" https://api.umiconsulting.co/health/ready
```

The production API host comes from `apps/umi-api/Caddyfile`. The comment there
names the VPS value: `API_DOMAIN=api.umiconsulting.co`. The same file shows the
staging host `api-staging.umiconsulting.co`. The pilot stack uses
`{$PILOT_DOMAIN}`.

The health body carries `release.gitCommit` and `schema.current`. Compare
`schema.current` with `schema.expected`. Compare `gitCommit` with the commit of
the deploy. UNVERIFIED: an agent did not call the production URL on 2026-09-16.

Roll back the API by image tag. The script `apps/umi-api/deploy/deploy.sh` pins
the running tag in `.env` as `UMI_API_TAG`. To roll back, set the previous tag
and start the container again:

```bash
ssh <vps-alias> "cd ~/umi/apps/umi-api && sed -i 's/^UMI_API_TAG=.*/UMI_API_TAG=sha-<previous>/' .env && docker compose up -d --remove-orphans && docker compose ps"
```

Roll back the dashboard on Cloudflare Pages. Use `wrangler pages deployment
list --json` for the deployment IDs, then redeploy the previous directory or
re-run the GitHub workflow for the previous commit. UNVERIFIED: an agent did not
perform a Pages rollback on 2026-09-16.

### 6.8 Health and log inspection without a browser

| Question                          | Command                                                                     |
| --------------------------------- | --------------------------------------------------------------------------- |
| Is the API alive?                 | `curl -fsS http://127.0.0.1:4001/health/live`                               |
| Is the database reachable?        | `curl -fsS http://127.0.0.1:4001/health/ready \| jq .db`                    |
| Which release runs?               | `curl -fsS http://127.0.0.1:4001/health/release \| jq`                      |
| Which schema runs?                | `curl -fsS http://127.0.0.1:4001/health \| jq .schema`                      |
| Are the local containers healthy? | `docker compose -f deploy/local/compose.yml ps`                             |
| Why did the API stop?             | `docker compose -f apps/umi-api/docker-compose.yml logs --tail=200 umi-api` |
| Why did CI fail?                  | `gh run view <id> --log-failed`                                             |
| Why did the Vercel build fail?    | `npx -y vercel@59.19.0 inspect <url> --logs`                                |

## 7. Repository archaeology

The workspace holds more work than one branch shows. On 2026-09-16 the checkout
`/home/jc/umi` was on `build-v3` at commit `338fba6`. The branch `build-v3` held
356 commits that `main` did not have. VERIFIED:

```bash
git log --oneline main..build-v3 | wc -l   # 356
```

### 7.1 Search history by content

`git log -S` finds a commit that changes the COUNT of a string. `git log -G`
finds a commit that changes a line that MATCHES a pattern. Source:
https://git-scm.com/docs/git-log

```bash
cd /home/jc/umi

# Where did the string floor_plan appear or disappear?
git log --all --oneline -S"floor_plan"

# Where did any line that matches "incoming. rder" change?
git log --all --oneline -G"incoming.?rder"

# Search every branch for a word in the commit message.
git log --all --oneline --grep="table map" -i

# Show the branch that introduced each commit.
git log --all --source --oneline -S"<text>"
```

VERIFIED on 2026-09-16. The `-G` search returned four commits, including
`4e7ecd0 feat(pos): incoming-orders screen and channel-wedge wiring`. The `-S`
search for `floor_plan` returned `15cb8fb feat: add Konva floor-plan editor and
published POS map`.

Two cautions:

- `-S` measures the count. A commit that moves a line does not change the
  count.
- Both flags read the whole history. Add a path or a date range to stay fast:
  `git log --all --oneline -S"<text>" -- apps/umi-pos`.

### 7.2 Branches, stashes, and worktrees

```bash
cd /home/jc/umi
git branch -a                          # every local and remote branch
git branch -a --contains <sha>         # which branch holds a commit
git stash list                         # stashed work
git worktree list                      # the extra checkouts
git log --oneline origin/main..<branch> # commits that main does not have
```

VERIFIED on 2026-09-16:

- `git stash list` was empty. The count was 0.
- `git worktree list` showed three checkouts: `/home/jc/umi` on `build-v3`,
  `/home/jc/umi-pr167` on `feat/reportes-ia`, and `/home/jc/umi-table-map` on
  `feat/table-map`.
- `git branch -a --contains 2fdaeb4` showed `feat/table-map` and
  `remotes/origin/feat/table-map` only. That commit is the floor plan editor.

Create a worktree for a parallel task. Do not switch the branch of the main
checkout, because another agent may work there:

```bash
cd /home/jc/umi && git worktree add ../umi-fix-<topic> <branch-or-new-branch>
```

Source: https://git-scm.com/docs/git-worktree

### 7.3 Find a feature that was never merged

Use four checks in this order:

1. Search every branch by content or message.

   ```bash
   git log --all --oneline -S"<feature text>"
   git log --all --oneline --grep="<feature name>" -i
   ```

2. Compare the branch with `main`.

   ```bash
   git log --oneline origin/main..<branch> | head -30
   ```

3. Look for a pull request, open or closed, that never merged.

   ```bash
   gh pr list --state all --search "<feature name>" --limit 20
   gh pr list --state open --limit 50 --json number,title,headRefName
   ```

4. Look for a remote branch that only exists on another machine.

   ```bash
   git fetch --all --prune
   git branch -r --no-merged origin/main
   ```

VERIFIED on 2026-09-16: `gh pr list --state closed --limit 5` returned PRs 168,
167, 166, 165, and 164, all `MERGED`. `gh pr list --state all --search
"reportes"` returned 167, 165, 166, 160, and 150.

Caution: `gh search prs --state merged` FAILS. VERIFIED on 2026-09-16:

```text
invalid argument "merged" for "--state" flag: valid values are {open|closed}
```

Use `--state closed`, then read the `merged` field, or use `gh pr list`.

### 7.4 Search code without a clone

```bash
gh search code "channel" --repo umiconsulting/umi --limit 20 --json path
gh search prs "floor plan" --repo umiconsulting/umi --limit 10
gh search commits "incoming orders" --repo umiconsulting/umi --limit 10
gh api repos/umiconsulting/umi --jq '.full_name, .default_branch'
```

VERIFIED on 2026-09-16: `gh search code "channel"` returned
`apps/umi-api/src/modules/conversations/channel.repository.ts`, `WORKSPACE.md`,
and `AGENTS.md`. `gh api repos/umiconsulting/umi` returned
`umiconsulting/umi` and `main`. Source: https://cli.github.com/manual/gh_search_code

The authenticated account is `umi-juanlopez` with the scopes `gist`,
`read:org`, and `repo`. VERIFIED with `gh auth status`.

### 7.5 CodeGraph for symbols and small context

`codegraph` 1.6.0 is installed at `/home/jc/.local/bin/codegraph`. The package
is `@colbymchenry/codegraph`. Source:
https://github.com/colbymchenry/codegraph

The index for `/home/jc/umi` exists at `.codegraph/codegraph.db`. VERIFIED on
2026-09-16 with `codegraph status`:

```text
Files: 1,183   Nodes: 22,844   Edges: 58,978   DB Size: 82.38 MB
route nodes: 332   method nodes: 4,959   function nodes: 2,506
```

Commands:

```bash
cd /home/jc/umi
codegraph status                 # is the index current?
codegraph sync                   # update after a change
codegraph query "pg.service"     # find a symbol
codegraph context "<task>"       # small, task-shaped context
codegraph node <name>            # one symbol with callers and callees
codegraph explore "<area>"       # symbols plus call paths
```

VERIFIED on 2026-09-16: `codegraph query "pg.service"` returned the file
`apps/umi-api/src/shared/database/pg.service.ts:1` and the importers
`apps/umi-api/src/modules/cash/customer-session.service.ts:5` and
`apps/umi-api/src/modules/conversations/merchant-config.service.ts:2`.

Use CodeGraph before a broad file read. It returns a small answer with file
lines. The next section explains the context cost.

### 7.6 A short recipe that answers most history questions

```bash
cd /home/jc/umi
git fetch --all --prune
git log --all --oneline --grep="<word>" -i --max-count=20
git log --all --oneline -S"<word>" --max-count=20
git branch -r --no-merged origin/main
gh pr list --state all --search "<word>" --limit 20 --json number,title,state
gh search code "<word>" --repo umiconsulting/umi --limit 20 --json path
```

### 7.7 One worked example

The question: "does the POS have a table map and a floor plan editor?"

The answer from the local checkout on 2026-09-16 was "no" in three places. The
answer from the remote was "yes". The steps below show the difference.

```bash
cd /home/jc/umi
git log --oneline -1                      # 338fba6 (PR 166)
git log --oneline -1 origin/build-v3      # e155e85 (PR 167)
git rev-list --count build-v3..origin/build-v3   # 8
ls docs/migration/build-v3 | grep 62      # no result
git log --all --oneline -G"incoming.?rder"        # found the channel work
gh pr view 168 --json number,title,state,mergedAt,baseRefName,mergeCommit
```

The `gh pr view 168` answer:

```json
{
  "number": 168,
  "title": "feat(tables): floor-plan editor and the POS table map",
  "state": "MERGED",
  "mergedAt": "2026-09-16T07:36:46Z",
  "baseRefName": "build-v3",
  "mergeCommit": "ce0d3c9c13037fde1faf00cef0ec3aa09c6331d2"
}
```

The merge commit was absent from the local clone. The file
`docs/migration/build-v3/62_floor_plan.sql` arrives with that merge. Run
`git fetch --all` first. Then the local answer and the remote answer agree.

## 8. Agent ergonomics

### 8.1 MCP servers for this repository

The file `.mcp.json` starts seven servers on 2026-09-16. Review of each entry:

| Entry            | Line | Status on 2026-09-16                                             | Action                 |
| ---------------- | ---- | ---------------------------------------------------------------- | ---------------------- |
| `azure-devops`   | 3    | The current tracker. `AGENTS.md:139` names Azure Boards.         | Keep.                  |
| `plane`          | 21   | `AGENTS.md:145` says "Trello and Plane are retired as trackers." | Remove.                |
| `playwright-mcp` | 33   | Useful. Runs `@playwright/mcp@latest`.                           | Keep. Pin the version. |
| `puppeteer`      | 42   | The npm package is deprecated. See Section 8.2.                  | Remove.                |
| `deepseek`       | 51   | Not part of the toolchain question.                              | Owner decision.        |
| `nano-banana`    | 63   | Not part of the toolchain question.                              | Owner decision.        |
| `dart`           | 74   | Correct. `dart mcp-server` gives the Flutter loop.               | Keep.                  |

Servers that are worth adding:

```json
{
  "chrome-devtools": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "chrome-devtools-mcp@1.9.0", "--browserUrl", "http://127.0.0.1:9222"]
  }
}
```

That entry adds the Lighthouse tool, the trace tools, and the heap tool to an
agent. The version is fixed, because `@latest` changes under the agent.

Caution: `npx -y <package>@latest` in `.mcp.json` installs a new version on
every machine at a random time. Pin `@playwright/mcp@0.0.81` for the same
reason.

`codegraph` also speaks MCP. Its `explore` and `node` commands say they give
"the same output as the `codegraph_explore` MCP tool". Add the CodeGraph MCP
server when an agent must read a large area of the repository.

### 8.2 Do not use the Puppeteer MCP server

VERIFIED on 2026-09-16:

```text
npm registry, @modelcontextprotocol/server-puppeteer
  dist-tags.latest: 2025.5.12
  deprecated: "Package no longer supported. Contact Support at
               https://www.npmjs.com/support for more info."

GitHub, modelcontextprotocol/servers, contents of src/
  everything, fetch, filesystem, git, memory, sequentialthinking, time
  (no puppeteer directory)
```

The package is deprecated, and the source directory is gone from the reference
server repository. Use `playwright-mcp` or `chrome-devtools-mcp` instead.

### 8.3 Non-interactive flags for common CLIs

| Tool           | Flag                         | Effect                                                   |
| -------------- | ---------------------------- | -------------------------------------------------------- |
| `vercel`       | `--non-interactive`          | Stop every prompt. The default when it detects an agent. |
| `vercel`       | `--yes` / `-y`               | Accept the default answer.                               |
| `vercel`       | `--json`                     | JSON output.                                             |
| `npx`          | `-y`                         | Skip the install prompt.                                 |
| `gh`           | `--json <fields>`            | JSON output.                                             |
| `gh`           | `--jq '<filter>'`            | Filter the output in the tool.                           |
| `gh api`       | `--paginate`                 | Fetch every page.                                        |
| `gh run list`  | `-L, --limit`                | Cap the row count. `--paginate` is NOT available here.   |
| `wrangler`     | `--json`                     | JSON output on `project list` and `deployment list`.     |
| `docker ps`    | `--format '{{.Names}}'`      | One field per line.                                      |
| `docker stats` | `--no-stream`                | One sample and stop.                                     |
| `psql`         | `-A -t -F,`                  | Unaligned, tuples only, comma separator.                 |
| `flutter`      | `--suppress-analytics`       | No telemetry for one call.                               |
| `dart`         | `--disable-analytics`        | No telemetry for one call.                               |
| `git`          | `--no-pager`                 | No interactive pager.                                    |
| `playwright`   | `PLAYWRIGHT_HTML_OPEN=never` | Do not open the HTML report.                             |
| `pnpm`         | `--filter <name>`            | Target one workspace package.                            |

VERIFIED on 2026-09-16: `gh api --help` shows `--paginate`, `gh run list --help`
shows `-L, --limit` and no `--paginate`, `flutter run --help` shows
`--suppress-analytics`, and `git --no-pager log --oneline -1` printed one line.
Source: https://cli.github.com/manual/

### 8.4 Output that is cheap to parse

- Add `--json` and `--jq` to every `gh` command. The filter runs in `gh`, so the
  agent never sees the full body.
- Add `| jq -c` to a JSON stream. One compact line per item costs less than an
  indented block.
- Use `playwright-cli --raw`. The flag removes the page status, the generated
  code, and the snapshot from the output. The skill file documents it.
- Use `chrome-devtools-mcp --slim` for a small task. It exposes three tools.
- Use `--screenshotMaxWidth` on `chrome-devtools-mcp`. The token cost of an
  image follows the pixel count, not the byte count.
- Use `git log --format='%h %ad %s' --date=short` instead of the default log.
- Write a large result to a file, then read it with `rg` or `jq`. Do not paste
  the whole file into the context.

### 8.5 Keep the context small

Rules that pay for themselves on this repository:

1. Start with `codegraph query` or `rg -n`. Do not open a file to find a symbol.
2. Read a range, not a file: `sed -n '199,240p' <file>`.
3. Give `rg` a path and a file type: `rg -n "pattern" apps/umi-pos/lib -t dart`.
4. Ask one question per tool call. A combined command hides the answer.
5. Keep a scratch file in `/tmp` for a JSON result. Reference the path in the
   answer.
6. Prefer the local source over the open web. The checkout answers most
   questions faster and without a fetch.
7. Verify a version before you write it in a document. The registry is one
   request away.

## 9. What else would have saved the hour

This section is honest about the cause of the lost hour and about the cheap
fixes.

**The repository already held the answer.** `.agents/skills/playwright-cli/SKILL.md`
is 420 lines and documents `snapshot`, `console`, `requests`, `tracing-start`,
`tracing-stop`, `attach --cdp`, and `--raw`. The skill already names
`test-generation`, `tracing`, and `video-recording` reference files. An agent
that reads the skill before a browser task does not write a CDP client.

**The hand-rolled code duplicates three tool calls.** The directory
`tools/ux-sweep/` holds 605 lines across three scripts, written on 2026-09-13
and 2026-09-14:

| File                                      | What it does                                                           | Existing tool that replaces it                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `devtools-probe.mjs` (156 lines)          | `Performance.getMetrics`, JS and CSS coverage, console, slow responses | `chrome-devtools-mcp`: `performance_start_trace`, `performance_stop_trace`, `list_console_messages`, `get_network_request` |
| `click-inventory.mjs` (310 lines)         | Walks routes and records every control                                 | `playwright-cli snapshot`, or the Playwright MCP tool `browser_snapshot`                                                   |
| `pos-semantics-inventory.mjs` (139 lines) | Reads the VM service semantics tree                                    | Keep this one. No off-the-shelf tool gives the POS tree in the same shape.                                                 |

The first two scripts answer questions that one MCP tool call answers. The third
script is good work, and it is the only local source for the POS semantics
route.

**The Vercel failure had no terminal path.** The dashboard was still linked to a
Vercel project (`.vercel/repo.json`), and the Vercel CLI was not installed.
`npx -y vercel@59.19.0 inspect <url> --logs` prints the build log. That single
command replaces an hour of guessing.

**A browser bug cost time.** `playwright-cli open` fails on this machine,
because the bundle `chromium_headless_shell-1237` is absent. The working route
is `attach --cdp=http://127.0.0.1:9222`, and it works today.

**The work already existed on another branch.** `feat/table-map` holds commit
`2fdaeb4 feat(tables): finish the floor plan editor and the POS table map`. Pull
Request 168 merged it into `build-v3` at 2026-09-16T07:36:46Z, with merge commit
`ce0d3c9c`. Two extra worktrees exist: `/home/jc/umi-pr167` and
`/home/jc/umi-table-map`. Run `git worktree list` and `git branch -a --contains
<sha>` before a rebuild.

**The local clone was 8 commits behind the remote.** VERIFIED on 2026-09-16: the
local `build-v3` was at `338fba6` (PR 166), and `origin/build-v3` was at
`e155e85` (PR 167). The merge commit of PR 168 was not in the local clone, so
`git branch -a --contains ce0d3c9c` failed with "malformed object name". The
file `docs/migration/build-v3/62_floor_plan.sql` exists on the branch
`feat/table-map` and not in the local `docs/migration/build-v3/`. Run
`git fetch --all` before you conclude that a feature is absent.

**Duplicate state was left in the shared browser.** The port 9222 browser held
nine tabs on 2026-09-16, and seven of them showed the same login screen. The
directory `.playwright-cli/` holds 74 console logs. The first log is from
2026-09-01. Use one named session and close it at the end.

**The database could not answer "which query is slow".** `pg_stat_statements`
is absent from the local stack, and `shared_preload_libraries` is empty. A
local compose change that adds `shared_preload_libraries=pg_stat_statements` and
`CREATE EXTENSION pg_stat_statements` turns that gap into a one-line query.

**The API had no published shape.** No OpenAPI document exists, so an agent must
read the controllers to learn a route. The Zod contract in `packages/contract`
already holds the shapes. One generator closes that gap.

**Five commands answer most "is it working" questions.** An agent should try
these before a deep investigation:

```bash
cd /home/jc/umi
curl -fsS http://127.0.0.1:4001/health | jq '{status, db, redis, schema}'
docker compose -f deploy/local/compose.yml ps
git worktree list && git status --short
codegraph status | head -12
npx -y lighthouse@13.4.1 <url> --quiet --output=json --output-path=/tmp/lh.json
```

## 10. Install these

This document does not install anything. The list below gives the exact package
name, the version, and the reason. Fix the version. Do not use `@latest` inside
`.mcp.json`.

Root workspace, as `devDependencies`:

| Package            | Version | Reason                                                        |
| ------------------ | ------- | ------------------------------------------------------------- |
| `@playwright/cli`  | 0.1.20  | The installed 0.1.18 wants a browser bundle that is absent.   |
| `@playwright/mcp`  | 0.0.81  | The version in `package.json` is 0.0.80. Pin the new version. |
| `@playwright/test` | 1.62.1  | Installed. It matches browser bundle 1237.                    |

One-shot commands through `npx`. No global install:

| Package               | Version | Reason                                                           |
| --------------------- | ------- | ---------------------------------------------------------------- |
| `chrome-devtools-mcp` | 1.9.0   | Lighthouse, performance traces, and heap snapshots for an agent. |
| `lighthouse`          | 13.4.1  | A local performance and accessibility audit.                     |
| `vercel`              | 59.19.0 | Read a failed Vercel build and roll it back.                     |

Optional, per the decision in
`docs/research/2026-09-15-tooling-and-design-system-landscape.md`:

| Package                          | Version | Reason                                               |
| -------------------------------- | ------- | ---------------------------------------------------- |
| `@asteasolutions/zod-to-openapi` | 9.1.0   | One OpenAPI document from the Zod contract.          |
| `@scalar/api-reference`          | 1.68.0  | Render that document for a person and an agent.      |
| `@nestjs/swagger`                | 12.0.1  | The alternative route, with decorators.              |
| `kysely`                         | 0.29.6  | Typed SQL for new query code.                        |
| `@pgtyped/cli`                   | 2.4.3   | Types generated from SQL files.                      |
| `pgcli`                          | 4.6.0   | A friendlier `psql`, from PyPI. It is not installed. |
| `patrol`                         | 4.10.0  | Flutter tests with native dialogs, from pub.dev.     |

Local machine, already present and verified on 2026-09-16: Node 22.23.2, pnpm
10.29.3, Flutter 3.44.6, Dart 3.12.2, Docker 29.1.3, `gh` 2.45.0, `wrangler`
4.129.0, `psql` 16.15, `ffmpeg` 6.1.1, `codegraph` 1.6.0, Chrome for Testing
152.0.7977.8, Playwright browser bundle 1237.

Missing on this machine: `kubectl`, `caddy`, `pgcli`, `vercel`, and the
Playwright bundle `chromium_headless_shell-1237`.

## 11. Do not use

| Item                                           | Reason                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/server-puppeteer`       | Deprecated on npm on 2026-09-16, and removed from the reference server repository. It is still in `.mcp.json:42`. |
| `plane-mcp-server` in `.mcp.json:21`           | `AGENTS.md:145` says "Trello and Plane are retired as trackers." Azure Boards is the tracker.                     |
| `kubectl` and Kubernetes manifests             | `kubectl` is not installed, and the repository uses Docker Compose on one VPS.                                    |
| `page.metrics()` in Playwright                 | The method does not exist in Playwright 1.62.1. Use CDP `Performance.getMetrics`.                                 |
| `browser.newContext({cdpEndpoint})`            | The option does not exist in Playwright. Use `chromium.connectOverCDP(url)` and `context.newCDPSession(page)`.    |
| `gh search prs --state merged`                 | `merged` is not a valid value. The valid values are `open` and `closed`.                                          |
| `playwright-cli open` before a bundle fix      | It fails on 2026-09-16. Use `attach --cdp`, or install the missing bundle.                                        |
| `flutter run --release` for introspection      | A release build has no Dart VM service, so no widget tree and no semantics tree.                                  |
| `pnpm dlx` / `npx @latest` inside `.mcp.json`  | An unpinned server changes without warning. Pin the version.                                                      |
| `npx lighthouse` against the Vite dev server   | The dev server sends each module as a separate file. The score is not the product score.                          |
| `--disable-service-auth-codes`                 | Deprecated by Flutter, and it opens the app to a local process.                                                   |
| `pkill -f "<pattern>"` in this workspace       | The pattern can match the agent's own shell. It killed one shell on 2026-09-16.                                   |
| `git reset --hard` in the working checkout     | The VPS deploy script runs it on the VPS checkout. Do not run it on a dirty local tree.                           |
| An unauthenticated debug port on a public host | Port 9222 has no authentication. Keep it on the loopback address only.                                            |

## 12. Verification log

Every result below came from this machine on 2026-09-16.

Versions:

```text
node v22.23.2        pnpm 10.29.3
Flutter 3.44.6       Dart 3.12.2       DevTools 2.57.0
Docker 29.1.3        Docker Compose 2.40.3
gh 2.45.0            wrangler 4.129.0  psql 16.15   ffmpeg 6.1.1
codegraph 1.6.0
Google Chrome for Testing 152.0.7977.8
@playwright/test 1.62.1   @playwright/mcp 0.0.80   @playwright/cli 0.1.18
```

Registry versions read on 2026-09-16:

```text
chrome-devtools-mcp 1.9.0     @playwright/mcp 0.0.81    playwright 1.63.0
puppeteer 25.11.0             @browserbasehq/stagehand 4.1.0
@midscene/core 1.12.8         lighthouse 13.4.1         vercel 59.19.0
kysely 0.29.6                 @pgtyped/cli 2.4.3        @nestjs/swagger 12.0.1
browser-use 0.13.10 (PyPI)    skyvern 1.0.48 (PyPI)     pgcli 4.6.0 (PyPI)
patrol 4.10.0 (pub.dev)       integration_test 1.0.2+3 (pub.dev)
```

Chrome:

```text
$ curl -s http://127.0.0.1:9222/json/version
{"Browser":"Chrome/152.0.7977.8","Protocol-Version":"1.3","V8-Version":"15.2.124.1", ...}
```

One Playwright run used six CDP domains:

```text
JS coverage entries: 1
CSS coverage entries: 1
Performance.getMetrics count: 36
Accessibility.getFullAXTree nodes: 9
DOMSnapshot.captureSnapshot documents: 1 strings: 16
screencastFrame base64 length: 8616
typeof page.metrics: undefined | typeof page.coverage: object
typeof context.tracing.start: function | typeof tracing.startChunk: function
```

Dashboard coverage through the CDP route:

```text
CDP app scripts: 77 | source bytes: 6483596
page.coverage entries with text: 0 of 77
```

Resource timing on the dashboard login screen:

```text
B resource timing entries: 77
B slowest: [{"n":"devices.jsx","t":708,"d":481,"s":300},
            {"n":"settings.jsx","t":706,"d":476,"s":300},
            {"n":"route-table.ts","t":738,"d":449,"s":300}]
C navigation timing: {"domContentLoaded":1732,"load":1735,"ttfb":22,"transfer":300}
```

Trace:

```text
$ node -e '<playwright tracing probe>'
trace bytes: 5202
```

Lighthouse 13.4.1 against a local static page:

```json
{
  "lighthouseVersion": "13.4.1",
  "perf": 1,
  "a11y": 0.95,
  "fcp": "0.7 s",
  "lcp": "0.8 s",
  "tbt": "0 ms",
  "cls": "0"
}
```

`playwright-cli attach`:

```text
### Session `default` created, attached to `http://127.0.0.1:9222`.
### Open tabs
- 0: (current) [Umi · Dash — Owner Console](http://127.0.0.1:4000/login)
- 2: [UmiPOS](http://127.0.0.1:4002/)
```

`playwright-cli console` on the login page:

```text
Total messages: 3 (Errors: 0, Warnings: 0)
```

API:

```text
$ curl -s http://127.0.0.1:4001/health
{"status":"ok","state":"Healthy","db":true,"redis":true,
 "release":{"application":"umi-api","version":"development","contractVersion":"2.13.0"},
 "schema":{"current":"build-v3-62","expected":"build-v3-62","compatible":true}}
```

Database:

```text
current_database: umi_transition_rehearsal_20260901
current_user:     api_login
server:           PostgreSQL 17.10 (Debian 17.10-1.pgdg12+1)
explain (analyze, buffers) select 1;  ->  Planning Time: 0.158 ms, Execution Time: 0.050 ms
shared_preload_libraries              ->  (empty)
pg_extension                          ->  plpgsql, pg_trgm, pgcrypto, unaccent, vector
```

CLI help that confirmed a flag:

```text
vercel inspect --help      ->  -l, --logs  Prints the build logs instead of the deployment summary
vercel logs --help         ->  -j, --json  -x, --expand  --level error|warning|info|fatal
vercel inspect --help      ->  --non-interactive  Run without interactive prompts
wrangler pages deployment  ->  list, create, tail, delete
gh run view --help         ->  --log-failed
gh search prs --state merged -> invalid argument "merged" for "--state" flag: valid values are {open|closed}
flutter run --help         ->  --device-vmservice-port, --dds-port, --suppress-analytics
flutter analyze --help     ->  --no-fatal-infos, --no-fatal-warnings, --watch, --write=<file>
dart mcp-server --help     ->  hot_reload, hot_restart, widget_inspector, run_tests, flutter_driver_command
dart devtools --help       ->  --machine, --dtd-uri, --no-launch-browser
```

MCP tool counts:

```text
chrome-devtools-mcp@1.9.0        -> 29 tools
@playwright/mcp 0.0.80           -> 24 tools
@playwright/mcp --caps=devtools  -> 37 tools
```

Repository:

```text
git commit               338fba6 on build-v3
git log main..build-v3   356 commits
git stash list           empty
git worktree list        /home/jc/umi, /home/jc/umi-pr167, /home/jc/umi-table-map
codegraph status         1,183 files, 22,844 nodes, 58,978 edges, 82.38 MB
gh run list              5 runs, all completed success
gh auth status           umi-juanlopez, scopes: gist, read:org, repo
```

## 13. Primary sources

Browser and DevTools:

- Chrome DevTools Protocol, stable domains: https://chromedevtools.github.io/devtools-protocol/tot/
- `chrome-devtools-mcp` source: https://github.com/ChromeDevTools/chrome-devtools-mcp
- `chrome-devtools-mcp` on npm: https://www.npmjs.com/package/chrome-devtools-mcp
- Playwright `Coverage`: https://playwright.dev/docs/api/class-coverage
- Playwright `CDPSession`: https://playwright.dev/docs/api/class-cdpsession
- Playwright `Tracing`: https://playwright.dev/docs/api/class-tracing
- Playwright trace viewer: https://playwright.dev/docs/trace-viewer
- Playwright MCP: https://github.com/microsoft/playwright-mcp
- `playwright-cli`: https://github.com/microsoft/playwright-cli
- Resource Timing: https://www.w3.org/TR/resource-timing/
- Lighthouse: https://developer.chrome.com/docs/lighthouse/

Browser automation:

- Playwright: https://playwright.dev
- Puppeteer: https://pptr.dev
- Stagehand: https://github.com/browserbase/stagehand
- browser-use: https://docs.browser-use.com
- Midscene: https://midscenejs.com
- Skyvern: https://github.com/Skyvern-AI/skyvern
- Model Context Protocol: https://modelcontextprotocol.io

Flutter and Dart:

- Dart MCP server: https://dart.dev/tools/mcp-server
- Dart VM service protocol: https://github.com/dart-lang/sdk/blob/main/runtime/vm/service/service.md
- Flutter hot reload: https://docs.flutter.dev/tools/hot-reload
- Flutter integration tests: https://docs.flutter.dev/testing/integration-tests
- Flutter CLI reference: https://docs.flutter.dev/reference/flutter-cli
- Flutter DevTools overview: https://docs.flutter.dev/tools/devtools/overview
- Widget inspector: https://docs.flutter.dev/tools/devtools/inspector
- Performance view: https://docs.flutter.dev/tools/devtools/performance
- Timeline view: https://docs.flutter.dev/tools/devtools/timeline
- Memory view: https://docs.flutter.dev/tools/devtools/memory
- Patrol: https://patrol.leancode.co

API and database:

- NestJS OpenAPI: https://docs.nestjs.com/openapi/introduction
- `psql`: https://www.postgresql.org/docs/16/app-psql.html
- `EXPLAIN`: https://www.postgresql.org/docs/16/sql-explain.html
- `pg_stat_statements`: https://www.postgresql.org/docs/16/pgstatstatements.html
- `node-postgres` pool: https://node-postgres.com/apis/pool
- `pgcli`: https://www.pgcli.com
- Kysely: https://kysely.dev
- PgTyped: https://pgtyped.dev

Deployment:

- Vercel CLI: https://vercel.com/docs/cli
- Vercel `inspect`: https://vercel.com/docs/cli/inspect
- Vercel `logs`: https://vercel.com/docs/cli/logs
- Vercel `rollback`: https://vercel.com/docs/cli/rollback
- Cloudflare Pages: https://developers.cloudflare.com/pages/
- Wrangler commands: https://developers.cloudflare.com/workers/wrangler/commands/
- GitHub CLI manual: https://cli.github.com/manual/
- `gh run view`: https://cli.github.com/manual/gh_run_view
- Docker Compose logs: https://docs.docker.com/reference/cli/docker/compose/logs/
- Caddy command line: https://caddyserver.com/docs/command-line

Repository and agent tools:

- `git log`: https://git-scm.com/docs/git-log
- `git worktree`: https://git-scm.com/docs/git-worktree
- `gh pr list`: https://cli.github.com/manual/gh_pr_list
- `gh search code`: https://cli.github.com/manual/gh_search_code
- CodeGraph: https://github.com/colbymchenry/codegraph

Local sources in this workspace:

- `.agents/skills/playwright-cli/SKILL.md` and its `references/`
- `tools/ux-sweep/devtools-probe.mjs`, `click-inventory.mjs`, `pos-semantics-inventory.mjs`
- `docs/research/2026-09-15-tooling-and-design-system-landscape.md`
- `apps/umi-api/src/modules/health/health.controller.ts`
- `apps/umi-api/src/shared/database/pg.service.ts`
- `deploy/local/compose.yml`, `deploy/pilot/compose.yml`, `deploy/pilot/postgres-init.sh`
- `.github/workflows/deploy-dashboard.yml`, `.github/workflows/deploy-backend.yml`
- `apps/umi-api/deploy/deploy.sh`

## 14. Limits of this document

The agent could not verify these items on 2026-09-16:

1. A live Flutter VM service call against the POS. The port 4002 instance runs in
   release mode, and a new debug instance on port 4911 did not open its port
   inside four minutes. The method names come from the installed Flutter SDK,
   and a Dart program proved the HTTP shape of `getVersion`, `getVM`, and
   `getIsolate`.
2. A real Vercel build log. No `VERCEL_TOKEN` exists on this machine. The CLI
   help and two API paths were verified without a token.
3. A real Cloudflare Pages build log. No `CLOUDFLARE_API_TOKEN` exists on this
   machine.
4. A Caddy command. The `caddy` binary is absent. The service name comes from
   the compose file.
5. The exact Chrome DevTools throttle presets. The method calls were verified.
   The numeric equality with the "Fast 3G" preset was not.
6. The CSS coverage route through the CDP domain `CSS`.
7. The runtime behavior of Stagehand, browser-use, Midscene, Skyvern, and
   Patrol. Only the registry versions were verified.
8. `playwright-cli install-browser chromium`. The agent did not run it.
9. The security_gate rule text about `log_min_duration_statement`. The agent read
   the file and quoted the line numbers, and did not run the gate.

Two claims in this document are inferences from the code, not measurements:

- The 10-client default of `node-postgres` comes from the library documentation,
  because `pg.service.ts` sets no `max` value.
- The release-mode statement for the POS web server comes from the process list
  plus the Flutter documentation. The agent did not query its VM service and
  receive a refusal.
