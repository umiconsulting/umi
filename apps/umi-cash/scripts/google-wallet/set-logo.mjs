/**
 * Set a loyalty class's programLogo (the circular logo on the card).
 *
 *   SLUG=kalalacafe LOGO=kalala-logo-square.png node scripts/google-wallet/set-logo.mjs      # DRY-RUN
 *   SLUG=kalalacafe LOGO=kalala-logo-square.png APPLY=1 node scripts/google-wallet/set-logo.mjs
 *
 * LOGO is a filename under /public/logos (resolved against NEXT_PUBLIC_APP_URL) or a full https URL.
 * The asset must already be deployed/public — Google fetches it server-side. Editing an approved
 * class requires reviewStatus UNDER_REVIEW (existing passes keep working through re-review).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from '../../node_modules/googleapis/build/src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.env.APPLY === '1';
const SLUG = process.env.SLUG;
const LOGO = process.env.LOGO;
if (!SLUG || !LOGO) { console.error('Set SLUG and LOGO env vars.'); process.exit(1); }

const raw = fs.readFileSync(path.join(HERE, '../../.env.vercel.production'), 'utf8');
const env = {};
for (const l of raw.split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); env[m[1]] = v; }
if (!env.GOOGLE_WALLET_ISSUER_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
  console.error('Missing GOOGLE_WALLET_ISSUER_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in .env.vercel.production');
  process.exit(1);
}

const ISSUER = env.GOOGLE_WALLET_ISSUER_ID;
const PREFIX = (env.GOOGLE_WALLET_CLASS_ID || 'loyalty_v2').trim();
const APP_URL = (env.NEXT_PUBLIC_APP_URL || 'https://cash.umiconsulting.co').replace(/\/$/, '');
const logoUri = /^https?:\/\//.test(LOGO) ? LOGO : `${APP_URL}/logos/${LOGO}`;
const classId = `${ISSUER}.${SLUG}_${PREFIX}`;

const auth = new google.auth.GoogleAuth({ credentials: { client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n') }, scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'] });
const client = await auth.getClient();
const tok = (await client.getAccessToken()).token;
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

const body = {
  reviewStatus: 'UNDER_REVIEW',
  programLogo: { sourceUri: { uri: logoUri }, contentDescription: { defaultValue: { language: 'es-MX', value: `Logo ${SLUG}` } } },
};

console.log(`class:  ${classId}`);
console.log(`logo:   ${logoUri}`);
if (!APPLY) { console.log('(dry-run — set APPLY=1 to patch)'); process.exit(0); }

const r = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${encodeURIComponent(classId)}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
console.log('PATCH', r.status, r.status === 200 ? 'OK' : await r.text());
