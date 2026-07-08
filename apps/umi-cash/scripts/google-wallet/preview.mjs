/**
 * Isolated Google Wallet preview harness — see the card render without touching any
 * live tenant class or customer object.
 *
 *   node scripts/google-wallet/preview.mjs
 *   MODE=explicit STATE=7-10 TENANT=elgranribera HERO_BASE=https://<preview>.vercel.app \
 *     node scripts/google-wallet/preview.mjs
 *
 * It (1) ensures a throwaway `preview_umicash_loyalty_v2` class exists, cloning branding
 * from a live tenant class, (2) mints a FRESH sample object id each run so Google can't
 * serve a cached/ignored object, and (3) prints a pay.google.com save link. Open that
 * link in desktop Chrome to see Google's own render (hero stamps, Visitas, Saldo).
 *
 * NOTE: heroImage must be a PUBLIC url for Google to fetch it in the preview. Locally the
 * stamp route isn't reachable, so set HERO_BASE to your Vercel preview/prod origin once the
 * branch is deployed. Default is NEXT_PUBLIC_APP_URL.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SignJWT, importPKCS8 } from '../../node_modules/jose/dist/node/esm/index.js';
import { google } from '../../node_modules/googleapis/build/src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = fs.readFileSync(path.join(HERE, '../../.env.vercel.production'), 'utf8');
const env = {};
for (const l of raw.split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let v = m[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); env[m[1]] = v; }

const ISSUER = env.GOOGLE_WALLET_ISSUER_ID;
const EMAIL = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const KEY = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n');
const APP_URL = (env.NEXT_PUBLIC_APP_URL || 'https://cash.umiconsulting.co').replace(/\/$/, '');

const MODE = (process.env.MODE || 'default').toLowerCase();
const TENANT = process.env.TENANT || 'kalalacafe';                 // whose branding + stamp art
const STATE = process.env.STATE || '4-10';                          // filled-required for the hero
const HERO_BASE = (process.env.HERO_BASE || APP_URL).replace(/\/$/, '');
const [filled, required] = STATE.split('-').map((n) => parseInt(n, 10));

const PREVIEW_CLASS = `${ISSUER}.preview_umicash_loyalty_v2`;

const EXPLICIT_TEMPLATE = {
  cardTemplateOverride: { cardRowTemplateInfos: [
    { twoItems: {
        startItem: { firstValue: { fields: [{ fieldPath: 'object.loyaltyPoints.balance' }] } },
        endItem:   { firstValue: { fields: [{ fieldPath: 'object.secondaryLoyaltyPoints.balance' }] } },
    } },
    { oneItem: { item: { firstValue: { fields: [
      { fieldPath: "object.textModulesData['pending_rewards']" },
      { fieldPath: "object.textModulesData['next_reward']" },
    ] } } } },
  ] },
};

const auth = new google.auth.GoogleAuth({ credentials: { client_email: EMAIL, private_key: KEY }, scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'] });
const client = await auth.getClient();
const tok = (await client.getAccessToken()).token;
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

// Clone branding from a live tenant class so the preview looks real.
const live = await (await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${encodeURIComponent(`${ISSUER}.${TENANT}_umicash_loyalty_v2`)}`, { headers: H })).json();

const classBody = {
  id: PREVIEW_CLASS,
  issuerName: live.issuerName || 'Umi',
  programName: live.programName || 'Umi Cash (preview)',
  reviewStatus: 'underReview',
  ...(live.programLogo ? { programLogo: live.programLogo } : {}),
  ...(live.hexBackgroundColor ? { hexBackgroundColor: live.hexBackgroundColor } : {}),
  ...(MODE === 'explicit' ? { classTemplateInfo: EXPLICIT_TEMPLATE.cardTemplateOverride ? EXPLICIT_TEMPLATE : undefined } : {}),
};

// Upsert the preview class.
const exists = (await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${encodeURIComponent(PREVIEW_CLASS)}`, { headers: H })).status === 200;
const cRes = await fetch(
  exists
    ? `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${encodeURIComponent(PREVIEW_CLASS)}`
    : `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass`,
  { method: exists ? 'PUT' : 'POST', headers: H, body: JSON.stringify(classBody) },
);
console.log(`preview class ${exists ? 'updated' : 'created'} (${cRes.status}) mode=${MODE}`);
if (cRes.status >= 300) console.log(await cRes.text());

// Fresh object id each run so Google always renders THIS object (never a cached one).
const objectId = `${ISSUER}.preview_card_${Date.now()}`;
const heroUri = `${HERO_BASE}/api/${TENANT}/stamp-strip/${filled}-${required}.png`;
const object = {
  id: objectId,
  classId: PREVIEW_CLASS,
  state: 'active',
  accountId: 'UMI-PREVIEW-0001',
  accountName: 'María González',
  heroImage: { sourceUri: { uri: heroUri }, contentDescription: { defaultValue: { language: 'es-MX', value: `Progreso: ${filled} de ${required}` } } },
  loyaltyPoints: { label: 'Visitas', balance: { string: `${filled} / ${required}` } },
  secondaryLoyaltyPoints: { label: 'Saldo', balance: { money: { currencyCode: 'MXN', micros: String(15000 * 10000) } } },
  barcode: { type: 'qrCode', value: 'PREVIEW-0001', alternateText: 'UMI-0001' },
  textModulesData: [{ header: 'PRÓXIMA RECOMPENSA', body: `${required - filled} visitas para Café gratis`, id: 'next_reward' }],
};

const pk = await importPKCS8(KEY, 'RS256');
const jwt = await new SignJWT({ iss: EMAIL, aud: 'google', typ: 'savetowallet', iat: Math.floor(Date.now() / 1000), origins: [APP_URL], payload: { loyaltyObjects: [object] } })
  .setProtectedHeader({ alg: 'RS256' })
  .sign(pk);

console.log(`\nheroImage: ${heroUri}`);
console.log(`\n=== OPEN THIS IN DESKTOP CHROME TO SEE THE RENDER ===\nhttps://pay.google.com/gp/v/save/${jwt}\n`);
