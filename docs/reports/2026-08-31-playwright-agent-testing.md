# Playwright setup for Umi agent tests

Date: 2026-08-31  
Time zone: America/Mazatlan  
Scope: Firefox Dashboard and Flutter web POS tests

## Result

Use Playwright MCP for the current interactive debug session.
Use Playwright Test for the permanent POS registration test.

The stable Playwright release is `1.62.1`.
The stable Playwright MCP release is `0.0.80` at the local date cutoff.

Sources:

- [Playwright `1.62.1` release](https://github.com/microsoft/playwright/releases/tag/v1.62.1)
- [Playwright MCP `0.0.80` release](https://github.com/microsoft/playwright-mcp/releases/tag/v0.0.80)

## Important Firefox constraint

Playwright uses its patched Firefox build.
It cannot control the installed branded Firefox build.

The MCP browser extension supports Chrome and Edge only.
Therefore, use a dedicated Playwright Firefox profile for this work.

Source: [Playwright browser support](https://playwright.dev/docs/browsers#firefox) and the [MCP extension option](https://github.com/microsoft/playwright-mcp#configuration-file).

## Direct Playwright and MCP

| Need                     | Playwright Test                         | Playwright MCP                                        |
| ------------------------ | --------------------------------------- | ----------------------------------------------------- |
| Live exploration         | Requires test code or `page.pause()`    | The agent can explore directly                        |
| Browser state            | Fixtures control each test              | A profile can keep state                              |
| Console and network data | Tests, traces, and UI Mode provide data | Core tools provide data during the session            |
| Cookie inspection        | Code uses the browser context           | The `storage` capability exposes cookie tools         |
| Repeatable checks        | Best option                             | Useful for discovery, but not the final test artifact |
| Agent context cost       | Test code is compact                    | Tool schemas and snapshots use more context           |

Playwright MCP uses accessibility snapshots for deterministic element access.
Its official README recommends CLI skills for high-throughput coding agents.
MCP remains useful for persistent exploration and detailed page inspection.

Sources:

- [Playwright MCP guide](https://playwright.dev/docs/getting-started-mcp)
- [Official MCP comparison](https://github.com/microsoft/playwright-mcp#playwright-mcp-vs-playwright-cli)
- [Playwright UI Mode](https://playwright.dev/docs/test-ui-mode)
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer)

## Recommended Umi installation

Install Playwright Test in the Dashboard package.
Install only the Firefox browser.

```sh
pnpm --filter @umi/dashboard add -D @playwright/test@1.62.1
pnpm --filter @umi/dashboard exec playwright install firefox
pnpm --filter @umi/dashboard exec playwright --version
```

The browser command installs the exact browser build for Playwright.
Run it again after a Playwright version update.

Source: [Playwright browser installation](https://playwright.dev/docs/browsers#install-browsers).

## Recommended Codex MCP setup

Create one profile outside the repository.
This profile keeps the local login and device test state.

```sh
install -d /home/jc/.cache/umi-playwright/firefox
codex mcp add umi-firefox npx "-y" "@playwright/mcp@0.0.80" "--browser=firefox" "--user-data-dir=/home/jc/.cache/umi-playwright/firefox" "--caps=devtools" "--allowed-origins=http://127.0.0.1:4000;http://127.0.0.1:4001;http://127.0.0.1:8080"
```

Restart Codex after the MCP configuration changes.
Then open these pages in the same MCP browser context:

1. Open `http://127.0.0.1:4000/devices`.
2. Open `http://127.0.0.1:8080` in a second tab.
3. Start a trace before the registration flow.
4. Record console messages and failed network requests.
5. Inspect the auth cookies without exposing their values.
6. Stop the trace after the POS connects.

Core MCP tools provide storage, console, and network inspection.
The `devtools` capability adds tracing and action recording.

Source: [Playwright MCP options and tools](https://github.com/microsoft/playwright-mcp#configuration-file).

## Permanent test workflow

Create one Firefox project after the manual flow succeeds.
Keep Dashboard and POS in one browser context when shared state is required.
Use two pages for the Dashboard and POS tabs.

Prefer role, label, text, and test ID locators.
Use web-first assertions for all state changes.
Save a trace on the first retry.

Run the test with these commands:

```sh
pnpm --filter @umi/dashboard exec playwright test --project=firefox
pnpm --filter @umi/dashboard exec playwright test --project=firefox --ui
pnpm --filter @umi/dashboard exec playwright test --project=firefox --debug
```

Sources:

- [Playwright locator guidance](https://playwright.dev/docs/best-practices#use-locators)
- [Playwright web-first assertions](https://playwright.dev/docs/best-practices#use-web-first-assertions)
- [Playwright test debug modes](https://playwright.dev/docs/running-tests)

## Flutter web caution

Start with accessibility snapshots and normal locators.
Flutter web can expose fewer useful elements than the React Dashboard.
This is a Umi-specific risk, not a documented Playwright limit.

If the POS snapshot lacks controls, add the MCP `vision` capability.
Use screenshots only for the controls that have no stable accessible element.

## Later agent setup

Playwright includes planner, generator, and healer agent definitions.
Add them only after the first stable test and seed fixture exist.

```sh
pnpm --filter @umi/dashboard exec playwright init-agents --loop=codex
```

Regenerate the definitions after each Playwright update.

Source: [Playwright Test Agents](https://playwright.dev/docs/test-agents).
