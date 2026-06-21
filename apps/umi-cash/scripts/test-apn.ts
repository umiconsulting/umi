/**
 * APN key sanity check — signs a JWT with APPLE_APN_KEY and pings Apple
 * with a bogus device token. Apple's response tells us whether the key
 * itself is valid.
 *
 *   BadDeviceToken       → key is valid ✅
 *   InvalidProviderToken → key / keyId / teamId mismatch ❌
 *   ExpiredProviderToken → JWT signing issue (clock or malformed key) ❌
 *
 * Run:
 *   npx tsx scripts/test-apn.ts                      # uses .env.local
 *   APPLE_APN_KEY=... npx tsx scripts/test-apn.ts    # override inline
 */

import http2 from 'http2';
import { SignJWT } from 'jose';
import { createPrivateKey } from 'crypto';
import fs from 'fs';
import path from 'path';

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    process.env[k] = raw.replace(/^['"]|['"]$/g, '');
  }
}
loadDotEnv(path.join(process.cwd(), '.env.local'));
loadDotEnv(path.join(process.cwd(), '.env'));

const keyId = process.env.APPLE_APN_KEY_ID?.trim();
const teamId = process.env.APPLE_TEAM_ID?.trim();
const passTypeId = process.env.APPLE_PASS_TYPE_ID?.trim();
const keyB64 = process.env.APPLE_APN_KEY?.trim();

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

if (!keyId) fail('APPLE_APN_KEY_ID is not set');
if (!teamId) fail('APPLE_TEAM_ID is not set');
if (!passTypeId) fail('APPLE_PASS_TYPE_ID is not set');
if (!keyB64) fail('APPLE_APN_KEY is not set (should be base64-encoded .p8)');

console.log('→ keyId:      ', keyId);
console.log('→ teamId:     ', teamId);
console.log('→ passTypeId: ', passTypeId);
console.log('→ key length: ', keyB64!.length, 'chars (base64)');

async function main() {
  let privateKey;
  try {
    const pem = Buffer.from(keyB64!, 'base64').toString('utf8');
    privateKey = createPrivateKey({ key: pem, format: 'pem' });
  } catch (e) {
    fail(`Could not decode APPLE_APN_KEY as a PEM-format .p8: ${(e as Error).message}`);
  }

  let jwt: string;
  try {
    jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId! })
      .setIssuer(teamId!)
      .setIssuedAt()
      .sign(privateKey);
  } catch (e) {
    fail(`JWT signing failed: ${(e as Error).message}`);
  }
  console.log('✓ Signed JWT ok');

  const bogusToken = 'a'.repeat(64);
  const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const client = http2.connect('https://api.push.apple.com');
    client.on('error', reject);

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${bogusToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': passTypeId!,
      'apns-push-type': 'background',
      'apns-priority': '5',
    });

    let statusCode = 0;
    let data = '';
    req.on('response', (headers) => { statusCode = Number(headers[':status']); });
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      client.close();
      resolve({ status: statusCode, body: data });
    });
    req.on('error', reject);
    req.end('{}');
  });

  console.log(`→ Apple responded: HTTP ${status}`);
  console.log(`→ Body: ${body || '(empty)'}`);

  const reason = (() => { try { return JSON.parse(body).reason; } catch { return null; } })();

  if (reason === 'BadDeviceToken') {
    console.log('\n✅ Key is VALID — Apple accepted the JWT and only rejected our fake device token, which is expected.');
    process.exit(0);
  }
  if (reason === 'InvalidProviderToken') {
    console.log('\n❌ Key is INVALID — check that APPLE_APN_KEY_ID matches the key, and APPLE_TEAM_ID is your 10-char team ID.');
    process.exit(2);
  }
  if (reason === 'ExpiredProviderToken') {
    console.log('\n❌ Token rejected as expired — check system clock, or the key may be malformed (stray newline in base64?).');
    process.exit(2);
  }
  console.log(`\n⚠️  Unexpected response (${reason ?? status}). If status is 200 or 410, the key is probably fine.`);
  process.exit(status === 200 || reason === 'Unregistered' ? 0 : 2);
}

main().catch((err) => {
  console.error('❌ Test crashed:', err);
  process.exit(1);
});
