/**
 * Bring the live Google Wallet loyalty CLASSES in line with the native-fields design.
 *
 *   node scripts/google-wallet/patch-classes.mjs            # DRY-RUN (default mode)
 *   MODE=default  APPLY=1 node scripts/google-wallet/patch-classes.mjs
 *   MODE=explicit APPLY=1 node scripts/google-wallet/patch-classes.mjs
 *
 * MODE=default (recommended): removes the hand-authored cardTemplateOverride so the
 *   class uses Google's DEFAULT template, which natively renders accountName +
 *   loyaltyPoints (Visitas) + secondaryLoyaltyPoints (Saldo) + heroImage (stamps) +
 *   text modules — nothing to forget, which is exactly what caused the missing balance.
 *
 * MODE=explicit: keeps a custom two-row template that references the native fields.
 *   Use only if the default layout isn't acceptable after previewing.
 *
 * Always backs up each class's current classTemplateInfo before writing, and is a
 * no-op unless APPLY=1.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from '../../node_modules/googleapis/build/src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.env.APPLY === '1';
const MODE = (process.env.MODE || 'default').toLowerCase();

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

// Explicit fallback template: two native rows. Row 1 = Visitas | Saldo, Row 2 = reward status.
const EXPLICIT_TEMPLATE = {
  cardTemplateOverride: {
    cardRowTemplateInfos: [
      { twoItems: {
          startItem: { firstValue: { fields: [{ fieldPath: 'object.loyaltyPoints.balance' }] } },
          endItem:   { firstValue: { fields: [{ fieldPath: 'object.secondaryLoyaltyPoints.balance' }] } },
      } },
      { oneItem: {
          item: { firstValue: { fields: [
            { fieldPath: "object.textModulesData['pending_rewards']" },
            { fieldPath: "object.textModulesData['next_reward']" },
          ] } },
      } },
    ],
  },
};

const auth = new google.auth.GoogleAuth({
  credentials: { client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n') },
  scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
});
const client = await auth.getClient();
const tok = (await client.getAccessToken()).token;
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

console.log(`MODE=${MODE}  APPLY=${APPLY}\n`);
for (const slug of SLUGS) {
  const id = `${ISSUER}.${slug}_${PREFIX}`;
  const g = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${encodeURIComponent(id)}`, { headers: H });
  if (g.status !== 200) { console.log(`SKIP ${id} (GET ${g.status})`); continue; }
  const cls = await g.json();
  fs.writeFileSync(path.join(HERE, `backup-${slug}.json`), JSON.stringify(cls.classTemplateInfo || {}, null, 2));

  // MODE=default clears the override (null); MODE=explicit installs the native template.
  // Editing an already-approved class requires resubmitting it (reviewStatus UNDER_REVIEW);
  // existing saved passes keep working through re-review.
  const body = {
    reviewStatus: 'UNDER_REVIEW',
    classTemplateInfo: MODE === 'explicit' ? EXPLICIT_TEMPLATE : null,
  };
  console.log(`=== ${id} ===`);
  console.log(MODE === 'explicit' ? 'set explicit native template' : 'clear override -> Google default template');
  if (!APPLY) { console.log('(dry-run)\n'); continue; }
  const p = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: H, body: JSON.stringify(body),
  });
  console.log('PATCH', p.status, p.status === 200 ? 'OK\n' : (await p.text()) + '\n');
}
