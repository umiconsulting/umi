/**
 * Shared collection core for the ux-sweep harnesses.
 *
 * Three scripts drive the Dashboard over CDP and all three need the same two
 * things: the route list, and a faithful record of every interactive element.
 * Keeping that in one module is what stops `click-inventory.mjs` and
 * `click-audit.mjs` from drifting into two different ideas of "a control".
 *
 * What lives here:
 *   - DEFAULT_ROUTES: the Dashboard surfaces the sweep walks.
 *   - COLLECT: a page function that returns every interactive element with its
 *     accessible name, role, geometry, stable CSS path, and (on request) a
 *     destructive/safe classification.
 *   - DESTRUCTIVE_PATTERNS: the one place a "do not click this" rule is written.
 *   - Small helpers for CLI flags, stable filenames, and page diagnostics.
 *
 * The module never clicks anything. Clicking lives in click-audit.mjs.
 */

export const DEFAULT_ROUTES = [
  '/login',
  '/',
  '/operations',
  '/orders',
  '/kitchen',
  '/reportes',
  '/reportes/reembolsos',
  '/cash-shifts',
  '/cash-shifts/registros',
  '/products',
  '/inventory',
  '/floor-plan',
  '/staff',
  '/devices',
  '/customers',
  '/conversations',
  '/loyalty-value',
  '/triage',
  '/hours',
  '/settings',
  '/products-billing',
  '/cafes',
  '/profile',
  '/diagnostics',
];

/** Everything the sweep treats as a control. Order is DOM order. */
export const CONTROL_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="option"]',
  '[role="combobox"]',
  '[contenteditable="true"]',
  '[onclick]',
  'summary',
].join(',');

/**
 * The destructive-control list. One rule, one place.
 *
 * A click on any of these families changes money, destroys a record, ends a
 * session, or writes to the database — so the audit never clicks them without a
 * human having said "disposable database" out loud. Each entry documents the
 * family and why a click is not safe to fire blind:
 *
 *   - delete/remove (eliminar, borrar): destroys a stored record.
 *   - void/refund (anular, reembolsar): moves money backwards and writes an
 *     irreversible ledger entry. Re-doing it is not the same as not doing it.
 *   - cancel/close (cancelar, cerrar): ends a shift, an order, or a sale in
 *     progress. The state it was in is gone.
 *   - sign out/log out (salir): kills the session the harness is riding. The
 *     run then cannot see anything else, and the browser was logged in on
 *     purpose.
 *   - pay/charge/pagar: takes money from a real card or terminal.
 *   - submit/send/save (enviar, guardar): persists whatever is on screen —
 *     including a half-filled form — and can email or print.
 *   - confirm/approve (aprobar): the second half of a two-step destructive
 *     action. This is the one that actually commits.
 *   - form submit: `<button type="submit">` inside a `<form>` inherits the
 *     form's write action even when its label says nothing about it.
 *   - danger styling: a control the codebase itself painted as dangerous. The
 *     class is the author's own statement that the button is not routine.
 *
 * `name` matches the accessible name and the accessible role, case-insensitive,
 * as whole words — a Unicode-aware boundary, because `\b` treats "á" as a
 * separator and would read the customer name "Payán" as the verb "pay".
 * `selector` matches the element in the DOM.
 */
const word = (...words) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'iu');

export const DESTRUCTIVE_PATTERNS = [
  {
    family: 'delete/remove',
    name: word('delete', 'remove', 'eliminar', 'borrar'),
    why: 'Destroys a stored record; the UI has no undo.',
  },
  {
    family: 'void/refund',
    name: word('void', 'refund', 'anular', 'reembolsar'),
    why: 'Moves money backwards and writes a ledger entry that cannot be un-written.',
  },
  {
    family: 'cancel/close',
    name: word('cancel', 'close', 'cancelar', 'cerrar'),
    why: 'Ends a shift, ticket, or draft; the state it was in is not recoverable.',
  },
  {
    family: 'sign out',
    name: word('sign out', 'log out', 'logout', 'salir'),
    why: 'Kills the session the harness is riding, blinding every later route.',
  },
  {
    family: 'pay/charge',
    name: word('pay', 'charge', 'pagar'),
    why: 'Takes real money through a gateway or a physical terminal.',
  },
  {
    family: 'submit/send/save',
    name: word('submit', 'send', 'save', 'enviar', 'guardar'),
    why: 'Persists whatever is on screen, including a half-filled form, and may notify third parties.',
  },
  {
    family: 'confirm/approve',
    name: word('confirm', 'approve', 'aprobar', 'confirmar'),
    why: 'The committing half of a two-step action; the click that actually writes.',
  },
  {
    family: 'form submit',
    selector: 'form button[type="submit"], form input[type="submit"]',
    why: 'A submit button inherits the form write action even when its label hides it.',
  },
  {
    family: 'publish',
    name: word('publish', 'publicar'),
    why:
      'Promotes a draft to the document every till renders and every printed map shows. ' +
      'The floor plan is the case that named it: Publish is one click, and no later click ' +
      'in the sweep takes it back.',
  },
  {
    family: 'plan mutation',
    selector: '.fp-palette fieldset button, .fp-add-area, .fp-properties button',
    why:
      "Edits the café's drafted floor plan, which the editor autosaves to the database about " +
      'a second later — so a click sweep would redraw a real dining room one table at a time. ' +
      'The element LIST (selecting a table) is deliberately not matched: selecting writes nothing.',
  },
  {
    family: 'danger styling',
    selector: '.danger, .destructive, [data-variant="danger"], [data-variant="destructive"]',
    why: 'The codebase painted this control as dangerous; treat the author as correct.',
  },
];

/** Patterns are shipped into the page, where RegExp is not cloneable. */
function serializablePatterns() {
  return DESTRUCTIVE_PATTERNS.map((p) => ({
    family: p.family,
    why: p.why,
    source: p.name ? p.name.source : null,
    flags: p.name ? p.name.flags : null,
    selector: p.selector || null,
  }));
}

/* ------------------------------------------------------------------ CLI --- */

/** `--flag value`, or the fallback. */
export function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

/** `--flag` presence. */
export function hasFlag(flag) {
  return process.argv.includes(flag);
}

/** Split a comma list into trimmed, non-empty routes. */
export function parseRoutes(value, fallback = DEFAULT_ROUTES) {
  return String(value || fallback.join(','))
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

/** A route turned into a stable, filesystem-safe filename stem. */
export function routeSlug(route) {
  return route.replace(/^\/+|\/+$/g, '').replace(/\W+/g, '_') || 'root';
}

/**
 * `--viewport WxH`, parsed. Undefined means "leave the browser's own size
 * alone". Pinning matters because the Dashboard swaps its sidebar for a drawer
 * below 1080 px, which changes how many controls are on screen — the number the
 * harness reports should be a property of the app, not of the window that
 * happened to be open.
 */
export function parseViewport(spec) {
  if (!spec) return null;
  const m = /^(\d+)x(\d+)$/.exec(String(spec).trim());
  if (!m) throw new Error(`--viewport must look like 1280x720, got "${spec}"`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

export async function applyViewport(page, viewport) {
  if (!viewport) return null;
  const previous = page.viewportSize();
  await page.setViewportSize(viewport);
  return previous;
}

/* ----------------------------------------------------------- collection --- */

/**
 * Runs in the page. Returns one record per visible control, in DOM order.
 *
 * Call it bare (`page.evaluate(COLLECT)`) for the inventory shape. Pass
 * `{ extended: true }` to add `className`, `auditIndex`, `destructive`, and
 * `destructiveReason`, and to stamp `data-ux-audit="<index>"` on each control
 * so a later click can address it by index rather than by a CSS path that may
 * not be unique.
 */
export const COLLECT = (options) => {
  const extended = Boolean(options && options.extended);
  const patterns = (options && options.patterns) || [];

  // Repeated inside the page function on purpose: page.evaluate serialises this
  // function alone, so a module-level constant would be undefined in the page.
  const SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="option"]',
    '[role="combobox"]',
    '[contenteditable="true"]',
    '[onclick]',
    'summary',
  ].join(',');

  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += `#${node.id}`;
        parts.unshift(part);
        break;
      }
      const cls = (node.className || '').toString().trim().split(/\s+/).filter(Boolean)[0];
      if (cls) part += `.${cls}`;
      const parent = node.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const nameOf = (el) => {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ')
        .trim();
      if (text) return text;
    }
    const direct =
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('alt') ||
      (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA'
        ? el.getAttribute('name') || el.id || ''
        : '') ||
      (el.innerText || '').trim() ||
      (el.value || '').toString().trim();
    if (direct) return direct.replace(/\s+/g, ' ').slice(0, 120);
    const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    if (label?.textContent) return label.textContent.trim().replace(/\s+/g, ' ').slice(0, 120);
    const wrapping = el.closest('label');
    if (wrapping?.textContent)
      return wrapping.textContent.trim().replace(/\s+/g, ' ').slice(0, 120);
    return '';
  };

  const classify = (el, name, role) => {
    for (const p of patterns) {
      const re = p.source ? new RegExp(p.source, p.flags || '') : null;
      const textHit = re && (re.test(name) || re.test(role));
      let selectorHit = false;
      if (p.selector) {
        try {
          selectorHit = el.matches(p.selector) || Boolean(el.closest(p.selector));
        } catch {
          selectorHit = false;
        }
      }
      if (textHit || selectorHit) {
        return {
          destructive: true,
          reason: `${p.family}: ${p.why}${selectorHit && !textHit ? ` (matched ${p.selector})` : ''}`,
          family: p.family,
        };
      }
    }
    return { destructive: false, reason: null, family: null };
  };

  document.querySelectorAll('[data-ux-audit]').forEach((el) => el.removeAttribute('data-ux-audit'));

  let auditIndex = -1;
  return [...document.querySelectorAll(SELECTOR)]
    .filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const role =
        el.getAttribute('role') ||
        ({ A: 'link', BUTTON: 'button', INPUT: 'input', SELECT: 'combobox', TEXTAREA: 'textbox' }[
          el.tagName
        ] ??
          el.tagName.toLowerCase());
      const interactiveInput =
        el.tagName === 'INPUT' ? el.getAttribute('type') || 'text' : undefined;
      const name = nameOf(el);
      const record = {
        name,
        role,
        inputType: interactiveInput,
        tag: el.tagName.toLowerCase(),
        selector: cssPath(el),
        disabled:
          el.disabled === true ||
          el.getAttribute('aria-disabled') === 'true' ||
          el.hasAttribute('disabled'),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        href: el.getAttribute('href') || null,
        testId: el.getAttribute('data-testid') || null,
      };
      if (extended) {
        auditIndex += 1;
        el.setAttribute('data-ux-audit', String(auditIndex));
        const verdict = classify(el, name, role);
        record.className = (el.className || '').toString().slice(0, 200);
        record.auditIndex = auditIndex;
        record.destructive = verdict.destructive;
        record.destructiveReason = verdict.reason;
        record.destructiveFamily = verdict.family;
      }
      return record;
    });
};

/** Arguments for an extended collection. */
export function extendedCollectArgs() {
  return { extended: true, patterns: serializablePatterns() };
}

/* --------------------------------------------------------- diagnostics --- */

/**
 * Attach console/pageerror/requestfailed listeners to a page. One collector per
 * navigation; call `reset()` between navigations and `detach()` when done.
 */
export function attachDiagnostics(page) {
  const state = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  const onConsole = (m) => {
    if (m.type() === 'error') state.consoleErrors.push(m.text().slice(0, 300));
  };
  const onPageError = (e) => state.pageErrors.push(String(e).slice(0, 300));
  const onFailed = (r) =>
    state.failedRequests.push(
      `${r.method()} ${r.url()} ${r.failure()?.errorText || ''}`.slice(0, 300),
    );
  const onDialog = (d) => {
    state.dialogs.push({ type: d.type(), message: d.message().slice(0, 300) });
    // Dismiss by default: a confirm() left open stalls the whole run.
    d.dismiss().catch(() => {});
  };
  state.dialogs = [];
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onFailed);
  page.on('dialog', onDialog);
  return {
    state,
    reset() {
      state.consoleErrors.length = 0;
      state.pageErrors.length = 0;
      state.failedRequests.length = 0;
      state.dialogs.length = 0;
    },
    detach() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onFailed);
      page.off('dialog', onDialog);
    },
  };
}

/**
 * Load one route and collect its controls.
 *
 * Returns the same entry shape click-inventory.mjs has always written, so the
 * inventory's JSON stays byte-comparable across the refactor.
 */
export async function collectRoute(
  page,
  {
    route,
    base,
    diagnostics,
    extended = false,
    settleMs = 1500,
    flutter = false,
    timeout = 30000,
    // The Dashboard mounts the shell only after the merchant context resolves,
    // so a collection that runs too early sees the topbar and nothing else.
    // Waiting for a real control first is what makes the count a property of
    // the screen instead of a race with the first render.
    readySelector = 'button.side-item, form, .card',
    readyTimeout = 10000,
    attempts = 2,
  },
) {
  const url = `${base}${route}`;
  // Every signed-in Dashboard screen carries the sidebar. When the API behind
  // the merchant context is slow or 500s, the app renders a shell without it —
  // a real state, but not the screen this harness is measuring. Retry that
  // load rather than reporting a five-control reportes page.
  const shellExpected = !flutter && route !== '/login';
  let lastEntry = null;

  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    if (diagnostics) diagnostics.reset();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      if (flutter) {
        await page.waitForTimeout(4000);
        const placeholder = page.locator('flt-semantics-placeholder');
        if (await placeholder.count()) {
          await placeholder
            .first()
            .click({ force: true, timeout: 5000 })
            .catch(() => {});
        }
        await page.waitForTimeout(1500);
      } else {
        await page.waitForSelector(readySelector, { timeout: readyTimeout }).catch(() => {});
        await page.waitForTimeout(settleMs);
      }
      const elements = await page.evaluate(COLLECT, extended ? extendedCollectArgs() : undefined);
      const heading = await page
        .locator('h1, h2, [role="heading"]')
        .first()
        .innerText()
        .catch(() => '');
      lastEntry = {
        ok: true,
        route,
        url: page.url(),
        title: await page.title(),
        heading: heading.replace(/\s+/g, ' ').slice(0, 120),
        redirectedTo: page.url() !== url ? page.url() : null,
        clickableCount: elements.length,
        unnamed: elements.filter((e) => !e.name).length,
        smallTargets: elements.filter((e) => e.width < 44 || e.height < 44).length,
        disabledCount: elements.filter((e) => e.disabled).length,
        consoleErrors: diagnostics ? [...diagnostics.state.consoleErrors] : [],
        pageErrors: diagnostics ? [...diagnostics.state.pageErrors] : [],
        failedRequests: diagnostics ? [...diagnostics.state.failedRequests] : [],
        elements,
      };
      if (!shellExpected) return lastEntry;
      const sidebar = await page
        .locator('button.side-item')
        .count()
        .catch(() => 0);
      if (sidebar > 0) return lastEntry;
    } catch (error) {
      lastEntry = {
        route,
        url,
        ok: false,
        error: (error?.stack || error?.message || String(error)).slice(0, 600),
      };
      if (!shellExpected) return lastEntry;
    }
  }

  // Return the last reading, but say it is the degraded shell so a reader is not
  // misled into thinking the screen only has that much on it.
  if (lastEntry?.ok) lastEntry.degradedShell = true;
  return lastEntry;
}
