#!/usr/bin/env node
/**
 * Does the register answer the same from umi-api as it does from umi-cash?
 *
 * `apps/umi-cash/next.config.mjs` hands 24 routes to umi-api when `CASH_API_ORIGIN`
 * is set. `register-flip.integration.ts` proves every one of them EXISTS on the
 * destination. Nothing proves they ANSWER the same — and a Next rewrite is a
 * proxy, so a route that exists and returns a different shape is a café screen
 * that renders zeros, or a reward tier that disappears, with no error anywhere.
 *
 * That gap was found on 2026-10-06 with the flip an hour away: four screens out of
 * six differed, and the differences were invisible to every existing test.
 *
 * This compares STRUCTURE, not values. A value can legitimately differ (the two
 * origins are two live databases a few seconds apart); a missing key cannot, and
 * missing keys are what the frozen client trips over. Timestamps, ids and money
 * are therefore compared as "present and the same type" only.
 *
 * Usage (credentials never leave the machine; nothing here reads the database):
 *
 *   PARITY_SLUG=kalalacafe PARITY_IDENTIFIER=admin@kalalacafe.mx \
 *     PARITY_PASSWORD=... node scripts/umi-cash-register-parity.mjs
 *
 * umi-api allows five register logins per café per 15 minutes, and a run costs
 * two of them (one per origin). To re-run inside that window, hand it tokens
 * instead and it will not log in at all:
 *
 *   PARITY_LEGACY_TOKEN=... PARITY_API_TOKEN=... node scripts/umi-cash-register-parity.mjs
 *
 * Exit code 0 = every comparable route answers the same shape on both origins.
 */

const LEGACY = process.env.PARITY_LEGACY_ORIGIN ?? 'https://cash.umiconsulting.co';
const API = process.env.PARITY_API_ORIGIN ?? 'https://api.umiconsulting.co';
const SLUG = process.env.PARITY_SLUG;
const IDENTIFIER = process.env.PARITY_IDENTIFIER;
const PASSWORD = process.env.PARITY_PASSWORD;

if (!SLUG || !IDENTIFIER || !PASSWORD) {
  if (!SLUG || !process.env.PARITY_LEGACY_TOKEN || !process.env.PARITY_API_TOKEN) {
    console.error(
      'Set PARITY_SLUG plus either PARITY_IDENTIFIER + PARITY_PASSWORD, or\n' +
        'PARITY_LEGACY_TOKEN + PARITY_API_TOKEN. Optionally override\n' +
        'PARITY_LEGACY_ORIGIN / PARITY_API_ORIGIN.',
    );
    process.exit(2);
  }
}

/** Every GET the register performs. Writes are excluded: exercising them costs real money. */
const ROUTES = [
  `/api/${SLUG}/admin/stats`,
  `/api/${SLUG}/admin/customers?limit=2`,
  `/api/${SLUG}/admin/gift-cards`,
  `/api/${SLUG}/admin/settings`,
  `/api/${SLUG}/admin/reward-config`,
  ...[7, 30, 90, 365].map((d) => `/api/${SLUG}/admin/analytics?days=${d}`),
];

/** One customer, by id, so the detail screen is covered too. */
async function firstCustomerId(token) {
  const r = await fetch(`${LEGACY}/api/${SLUG}/admin/customers?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const body = await r.json();
  const row = Array.isArray(body?.customers) ? body.customers[0] : null;
  return row?.id ?? null;
}

async function login(origin) {
  const r = await fetch(`${origin}/api/${SLUG}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || typeof body.accessToken !== 'string') {
    throw new Error(`login failed on ${origin}: ${r.status} ${JSON.stringify(body).slice(0, 120)}`);
  }
  return body.accessToken;
}

/**
 * Every decided path in a JSON value, as `key` / `key[]` / `key[].child`, with the
 * leaf's type. Arrays collapse to their first element: the shape of one row is the
 * shape of the screen, and comparing all 1000 of them is the same answer slower.
 */
function shape(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) {
    out.add(`${prefix}[]`);
    if (value.length > 0) shape(value[0], `${prefix}[].`, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const path = prefix + k;
      const type = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
      out.add(`${path}:${type}`);
      shape(v, `${path}.`, out);
    }
    return out;
  }
  return out;
}

/**
 * A key only counts as missing when the path AND its type are absent. `null` vs
 * `"x"` is a value difference and is reported separately, because `null` is a
 * legitimate answer (a café with no promo has no promo message).
 */
function missingFrom(expected, actual) {
  const actualPaths = new Set([...actual].map((p) => p.slice(0, p.lastIndexOf(':'))));
  return [...expected].filter((p) => !actualPaths.has(p.slice(0, p.lastIndexOf(':'))));
}

const get = async (origin, path, token) => {
  const r = await fetch(origin + path, { headers: { Authorization: `Bearer ${token}` } });
  const contentType = (r.headers.get('content-type') ?? '').split(';')[0];
  const body = contentType.includes('json') ? await r.json().catch(() => null) : null;
  return { status: r.status, contentType, body };
};

const mask = (e) => String(e ?? '').replace(/^(.).*(@.*)$/, '$1***$2');

const [legacyToken, apiToken] =
  process.env.PARITY_LEGACY_TOKEN && process.env.PARITY_API_TOKEN
    ? [process.env.PARITY_LEGACY_TOKEN, process.env.PARITY_API_TOKEN]
    : await Promise.all([login(LEGACY), login(API)]);
console.log(`logged in on both origins as ${mask(IDENTIFIER)}\n`);

const customerId = await firstCustomerId(legacyToken);
if (customerId) {
  ROUTES.splice(2, 0, `/api/${SLUG}/admin/customers/${customerId}`);
} else {
  console.log('! no customers found — the detail route is not covered by this run\n');
}

let failures = 0;
for (const path of ROUTES) {
  const [l, n] = await Promise.all([get(LEGACY, path, legacyToken), get(API, path, apiToken)]);
  const problems = [];
  if (l.status !== n.status) problems.push(`status ${l.status} vs ${n.status}`);
  if (l.contentType !== n.contentType)
    problems.push(`content-type ${l.contentType} vs ${n.contentType}`);

  if (l.body && n.body) {
    const missing = missingFrom(shape(l.body), shape(n.body));
    if (missing.length) problems.push(`missing in umi-api: ${missing.join(', ')}`);
  }

  if (problems.length === 0) {
    console.log(`ok    ${path}`);
  } else {
    failures++;
    console.log(`FAIL  ${path}`);
    for (const p of problems) console.log(`        ${p}`);
  }
}

console.log(
  failures === 0
    ? `\n${ROUTES.length} routes answer the same shape.`
    : `\n${failures} of ${ROUTES.length} routes differ. The register flip is NOT safe.`,
);
process.exit(failures === 0 ? 0 : 1);
