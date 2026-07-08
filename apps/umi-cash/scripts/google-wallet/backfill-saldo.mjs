/**
 * One-time backfill: add the `saldo` STRING text module to every existing Google Wallet
 * object so the card-face override row can show the balance (money-type
 * secondaryLoyaltyPoints does NOT render inside a card row — see patch-classes.mjs).
 *
 *   node scripts/google-wallet/backfill-saldo.mjs            # DRY-RUN
 *   APPLY=1 node scripts/google-wallet/backfill-saldo.mjs
 *
 * SEQUENCE: deploy the app first (so future scans keep emitting the `saldo` module),
 * run this backfill, THEN apply the override (MODE=explicit patch-classes.mjs). Applying
 * the override before objects have the module would show a blank Saldo on the face.
 *
 * Value is derived from each object's secondaryLoyaltyPoints.money.micros (no DB):
 * centavos = micros / 10_000, formatted es-MX MXN to match the app's formatMXN exactly.
 * Objects without secondaryLoyaltyPoints (loyalty-only, no topup) are skipped. Idempotent.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from '../../node_modules/googleapis/build/src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.env.APPLY === '1';
const raw = fs.readFileSync(path.join(HERE, '../../.env.vercel.production'), 'utf8');
const env = {};
for (const l of raw.split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); env[m[1]] = v; }

if (!env.GOOGLE_WALLET_ISSUER_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
  console.error('Missing GOOGLE_WALLET_ISSUER_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in .env.vercel.production');
  process.exit(1);
}

const ISSUER = env.GOOGLE_WALLET_ISSUER_ID;
const PREFIX = (env.GOOGLE_WALLET_CLASS_ID || 'loyalty_v2').trim();
const SLUGS = ['northwestcafe', 'kalalacafe', 'elgranribera'];

// Mirror src/lib/currency.ts formatMXN(centavos) so backfilled strings match the app byte-for-byte.
const formatMXN = (centavos) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(centavos / 100);

const auth = new google.auth.GoogleAuth({ credentials: { client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n') }, scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'] });
const client = await auth.getClient();
const tok = (await client.getAccessToken()).token;
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

let patched = 0, skipped = 0;
for (const slug of SLUGS) {
  const classId = `${ISSUER}.${slug}_${PREFIX}`;
  let pageToken = '';
  do {
    const url = `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject?classId=${encodeURIComponent(classId)}&maxResults=200${pageToken ? `&token=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: H });
    if (res.status !== 200) { console.log(`SKIP class ${classId} (list ${res.status})`); break; }
    const body = await res.json();
    for (const obj of body.resources || []) {
      const micros = obj.secondaryLoyaltyPoints?.balance?.money?.micros;
      if (micros == null) { skipped++; continue; } // no topup → no Saldo line
      const saldoBody = formatMXN(Number(micros) / 10_000);
      // Replace any existing saldo module, keep the rest, in a stable order.
      const modules = (obj.textModulesData || []).filter((m) => m.id !== 'saldo');
      modules.push({ header: 'SALDO', body: saldoBody, id: 'saldo' });
      if (!APPLY) { patched++; if (patched <= 3) console.log(`[dry] ${obj.id} -> Saldo ${saldoBody}`); continue; }
      const p = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(obj.id)}`, { method: 'PATCH', headers: H, body: JSON.stringify({ textModulesData: modules }) });
      if (p.status === 200) patched++; else { skipped++; console.log(`FAIL ${obj.id}: ${p.status} ${await p.text()}`); }
    }
    pageToken = body.pagination?.nextPageToken || '';
  } while (pageToken);
}
console.log(`\n${APPLY ? 'PATCHED' : 'WOULD PATCH'}: ${patched}   skipped (no topup): ${skipped}`);
