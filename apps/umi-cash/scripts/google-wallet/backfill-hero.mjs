/**
 * One-time backfill: give every existing Google Wallet object the new shape so stamps
 * (heroImage) appear immediately for ALL current customers, not just those who happen to
 * transact after the deploy.
 *
 *   node scripts/google-wallet/backfill-hero.mjs            # DRY-RUN
 *   APPLY=1 node scripts/google-wallet/backfill-hero.mjs
 *   APPLY=1 HERO_BASE=https://cash.umiconsulting.co node ...
 *
 * PRE-REQ: the app must already be DEPLOYED to prod so the stamp-strip route resolves —
 * Google fetches the heroImage URL server-side. Run this AFTER the deploy is live.
 *
 * Everything is derived from each object itself (no DB): filled/required from loyaltyPoints,
 * modules filtered to drop the now-redundant member_name / stamp_progress. Idempotent — the
 * hero URL is content-addressed, so re-running is a no-op for unchanged cards.
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
const HERO_BASE = (process.env.HERO_BASE || env.NEXT_PUBLIC_APP_URL || 'https://cash.umiconsulting.co').replace(/\/$/, '');
const SLUGS = ['northwestcafe', 'kalalacafe', 'elgranribera'];
const DROP_MODULE_IDS = new Set(['member_name', 'stamp_progress']);

const auth = new google.auth.GoogleAuth({ credentials: { client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n') }, scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'] });
const client = await auth.getClient();
const tok = (await client.getAccessToken()).token;
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

/** Parse "4 / 10" (new) or balance "4" + label "Visitas (meta: 10)" (old). */
function parseState(lp) {
  const s = String(lp?.balance?.string ?? '').trim();
  let m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return { filled: +m[1], required: +m[2] };
  const filled = parseInt(s, 10);
  const lm = String(lp?.label ?? '').match(/(\d+)/);
  if (Number.isInteger(filled) && lm) return { filled, required: +lm[1] };
  return null;
}

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
      const st = parseState(obj.loyaltyPoints);
      if (!st) { skipped++; console.log(`skip ${obj.id} (unparseable loyaltyPoints)`); continue; }
      const heroUri = `${HERO_BASE}/api/${slug}/stamp-strip/${st.filled}-${st.required}.png`;
      const modules = (obj.textModulesData || []).filter((m) => !DROP_MODULE_IDS.has(m.id));
      const patch = {
        heroImage: { sourceUri: { uri: heroUri }, contentDescription: { defaultValue: { language: 'es-MX', value: `Progreso: ${st.filled} de ${st.required} visitas` } } },
        loyaltyPoints: { label: 'Visitas', balance: { string: `${st.filled} / ${st.required}` } },
        textModulesData: modules,
      };
      if (!APPLY) { patched++; if (patched <= 3) console.log(`[dry] ${obj.id} -> ${heroUri}`); continue; }
      const p = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(obj.id)}`, { method: 'PATCH', headers: H, body: JSON.stringify(patch) });
      if (p.status === 200) patched++; else { skipped++; console.log(`FAIL ${obj.id}: ${p.status} ${await p.text()}`); }
    }
    pageToken = body.pagination?.nextPageToken || '';
  } while (pageToken);
}
console.log(`\n${APPLY ? 'PATCHED' : 'WOULD PATCH'}: ${patched}   skipped: ${skipped}   heroBase: ${HERO_BASE}`);
