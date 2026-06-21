/**
 * Apple Push Notifications for Wallet pass updates.
 * Uses native HTTP/2 with .p8 token-based auth (no external deps).
 *
 * Apple's APN endpoint requires HTTP/2 — Node's fetch uses HTTP/1.1,
 * so we must use the http2 module directly.
 */

import http2 from 'http2';
import { SignJWT } from 'jose';
import { createPrivateKey } from 'crypto';
import { prisma } from './prisma';

const APN_HOST = 'https://api.push.apple.com';

let cachedToken: { jwt: string; expiresAt: number } | null = null;

function getApnKey(): Buffer | null {
  if (process.env.APPLE_APN_KEY) {
    return Buffer.from(process.env.APPLE_APN_KEY, 'base64');
  }
  try {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(process.cwd(), 'passes', 'apple', 'apn_key.p8'));
  } catch {
    return null;
  }
}

async function getApnToken(): Promise<string | null> {
  const keyId = process.env.APPLE_APN_KEY_ID?.trim();
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  if (!keyId || !teamId) {
    console.log('[APN] Missing env vars — keyId:', !!keyId, 'teamId:', !!teamId);
    return null;
  }

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.jwt;
  }

  const key = getApnKey();
  if (!key) {
    console.log('[APN] Could not load APN key — APPLE_APN_KEY:', !!process.env.APPLE_APN_KEY);
    return null;
  }

  const privateKey = createPrivateKey({ key, format: 'pem' });

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(privateKey);

  cachedToken = { jwt, expiresAt: Date.now() + 50 * 60 * 1000 };
  return jwt;
}

function sendPush(token: string, pushToken: string, topic: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = http2.connect(APN_HOST);
    client.on('error', (err) => {
      console.warn(`[APN] Connection error: ${err.message}`);
      resolve(false);
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${pushToken}`,
      authorization: `bearer ${token}`,
      'apns-topic': topic,
      'apns-push-type': 'background',
      'apns-priority': '5',
    });

    req.end('{}');

    let responseData = '';
    let statusCode: number | undefined;
    req.on('data', (chunk) => { responseData += chunk; });

    req.on('response', (headers) => {
      statusCode = Number(headers[':status']);
      if (statusCode !== 200) {
        console.warn(`[APN] Push failed for ${pushToken.slice(0, 8)}...: status ${statusCode}`);
      }
    });

    req.on('end', () => {
      if (responseData) {
        console.warn(`[APN] Response body: ${responseData}`);
      }
      client.close();
    });

    req.on('error', (err) => {
      console.warn(`[APN] Request error: ${err.message}`);
      client.close();
      resolve(false);
    });

    // Resolve on close, reflecting the real APN status (200 = delivered).
    // Anything else — e.g. 410 BadDeviceToken, 403 bad cert — counts as failure.
    client.on('close', () => resolve(statusCode === 200));

    req.setTimeout(10000, () => {
      console.warn('[APN] Request timed out');
      req.close();
      client.close();
      resolve(false);
    });
  });
}

/**
 * Push update to all devices registered for a single card.
 *
 * On the canonical schema the device push tokens live on `loyalty.pass_devices`,
 * reached via the card's Apple `loyalty.passes` row (provider='apple'). Each
 * `pass_devices.push_token` is the APNs device token we POST to.
 */
export async function sendApplePushUpdate(cardId: string): Promise<{ sent: number; failed: number }> {
  const passTypeId = process.env.APPLE_PASS_TYPE_ID;
  if (!passTypeId) { console.log('[APN] No APPLE_PASS_TYPE_ID set, skipping push'); return { sent: 0, failed: 0 }; }

  const token = await getApnToken();
  if (!token) { console.log('[APN] Could not get APN token, skipping push'); return { sent: 0, failed: 0 }; }

  const registrations = await prisma.pass_devices.findMany({
    where: { passes: { loyalty_card_id: cardId, provider: 'apple' }, push_token: { not: null } },
  });
  if (registrations.length === 0) { console.log(`[APN] No registered devices for card ${cardId}`); return { sent: 0, failed: 0 }; }

  console.log(`[APN] Sending push to ${registrations.length} device(s) for card ${cardId}`);
  let sent = 0, failed = 0;
  for (const reg of registrations) {
    const ok = await sendPush(token, reg.push_token!, passTypeId);
    ok ? sent++ : failed++;
    console.log(`[APN] Push to ${reg.push_token!.slice(0, 8)}...: ${ok ? 'success' : 'failed'}`);
  }
  return { sent, failed };
}

/**
 * Push update to ALL cards for a tenant (e.g., when reward config changes).
 *
 * "Has an Apple pass" is now "has a `loyalty.passes` row with provider='apple'
 * and a serial_number", replacing the old card-level apple pass serial filter.
 */
export async function sendApplePushUpdateForTenant(tenantId: string): Promise<void> {
  const passes = await prisma.passes.findMany({
    where: { tenant_id: tenantId, provider: 'apple', serial_number: { not: null } },
    select: { loyalty_card_id: true },
  });

  console.log(`[APN] Updating ${passes.length} card(s) for tenant ${tenantId}`);
  for (const pass of passes) {
    await sendApplePushUpdate(pass.loyalty_card_id);
  }
}
