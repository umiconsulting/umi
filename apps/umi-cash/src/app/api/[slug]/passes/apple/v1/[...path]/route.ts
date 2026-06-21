/**
 * Apple Wallet Web Service endpoints (catch-all).
 *
 * Apple sends requests to {webServiceURL}/v1/... — this route handles:
 *   POST   /devices/{deviceId}/registrations/{passTypeId}/{serial}  — register device
 *   DELETE  /devices/{deviceId}/registrations/{passTypeId}/{serial}  — unregister
 *   GET    /devices/{deviceId}/registrations/{passTypeId}           — list updated serials
 *   GET    /passes/{passTypeId}/{serial}                            — serve latest pass
 *   POST   /log                                                     — device error log
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateApplePass, isAppleWalletConfigured } from '@/lib/pass-apple';
import { getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';
import { DEFAULT_CUSTOMER_NAME } from '@/lib/constants';
import { getTenant, getActivePromo } from '@/lib/tenant';

function matchRoute(segments: string[]): { handler: string; params: Record<string, string> } | null {
  // POST /log
  if (segments.length === 1 && segments[0] === 'log') {
    return { handler: 'log', params: {} };
  }
  // GET /passes/{passTypeId}/{serial}
  if (segments.length === 3 && segments[0] === 'passes') {
    return { handler: 'getPass', params: { passTypeId: segments[1], serial: segments[2] } };
  }
  // GET /devices/{deviceId}/registrations/{passTypeId}
  if (segments.length === 4 && segments[0] === 'devices' && segments[2] === 'registrations') {
    return { handler: 'listSerials', params: { deviceId: segments[1], passTypeId: segments[3] } };
  }
  // POST|DELETE /devices/{deviceId}/registrations/{passTypeId}/{serial}
  if (segments.length === 5 && segments[0] === 'devices' && segments[2] === 'registrations') {
    return {
      handler: 'registration',
      params: { deviceId: segments[1], passTypeId: segments[3], serial: segments[4] },
    };
  }
  return null;
}

function getAuthToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('ApplePass ')) return null;
  return header.slice(10);
}

/**
 * Verify a pass auth token against loyalty.passes (provider='apple') and return
 * the pass plus its card (with the customer via account → person). Pass identity
 * has moved off the card onto loyalty.passes.
 */
async function verifyPassAuth(serial: string, authToken: string) {
  return prisma.passes.findFirst({
    where: { provider: 'apple', serial_number: serial, auth_token: authToken },
    include: { cards: { include: { accounts: { include: { people: true } } } } },
  });
}

export async function GET(req: NextRequest, { params }: { params: { slug: string; path: string[] } }) {
  const route = matchRoute(params.path);
  if (!route) return new NextResponse(null, { status: 404 });

  if (route.handler === 'getPass') {
    return handleGetPass(req, params.slug, route.params.serial);
  }
  if (route.handler === 'listSerials') {
    return handleListSerials(req, params.slug, route.params.deviceId, route.params.passTypeId);
  }
  return new NextResponse(null, { status: 404 });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string; path: string[] } }) {
  const route = matchRoute(params.path);
  if (!route) return new NextResponse(null, { status: 404 });

  if (route.handler === 'log') {
    const body = await req.json().catch(() => null);
    console.log('[Apple Pass Log]', JSON.stringify(body));
    return new NextResponse(null, { status: 200 });
  }
  if (route.handler === 'registration') {
    return handleRegister(req, route.params.deviceId, route.params.serial);
  }
  return new NextResponse(null, { status: 404 });
}

export async function DELETE(req: NextRequest, { params }: { params: { slug: string; path: string[] } }) {
  const route = matchRoute(params.path);
  if (!route || route.handler !== 'registration') return new NextResponse(null, { status: 404 });
  return handleUnregister(req, route.params.deviceId, route.params.serial);
}

// ─── Register device for push updates ────────────────────────────────────────

async function handleRegister(req: NextRequest, deviceId: string, serial: string) {
  const authToken = getAuthToken(req);
  if (!authToken) return new NextResponse(null, { status: 401 });

  const pass = await verifyPassAuth(serial, authToken);
  if (!pass) return new NextResponse(null, { status: 401 });

  const body = await req.json().catch(() => null);
  const pushToken = body?.pushToken;
  if (!pushToken) return new NextResponse(null, { status: 400 });

  const existing = await prisma.pass_devices.findUnique({
    where: { pass_id_device_token: { pass_id: pass.id, device_token: deviceId } },
  });

  await prisma.pass_devices.upsert({
    where: { pass_id_device_token: { pass_id: pass.id, device_token: deviceId } },
    update: { push_token: pushToken },
    create: { tenant_id: pass.tenant_id, pass_id: pass.id, device_token: deviceId, push_token: pushToken },
  });

  // 200 = already registered, 201 = new registration
  return new NextResponse(null, { status: existing ? 200 : 201 });
}

// ─── Unregister device ───────────────────────────────────────────────────────

async function handleUnregister(req: NextRequest, deviceId: string, serial: string) {
  const authToken = getAuthToken(req);
  if (!authToken) return new NextResponse(null, { status: 401 });

  const pass = await verifyPassAuth(serial, authToken);
  if (!pass) return new NextResponse(null, { status: 401 });

  await prisma.pass_devices.deleteMany({
    where: { pass_id: pass.id, device_token: deviceId },
  });

  return new NextResponse(null, { status: 200 });
}

// ─── List updated serial numbers ─────────────────────────────────────────────

async function handleListSerials(req: NextRequest, slug: string, deviceId: string, passTypeId: string) {
  const tenant = await getTenant(slug);
  if (!tenant) return new NextResponse(null, { status: 404 });

  const since = req.nextUrl.searchParams.get('passesUpdatedSince');
  const sinceDate = since ? new Date(parseInt(since) * 1000) : new Date(0);

  // Find the device's registered passes scoped to the current tenant, via
  // pass_devices → passes (provider='apple') → card.
  const registrations = await prisma.pass_devices.findMany({
    where: {
      device_token: deviceId,
      passes: { tenant_id: tenant.id, provider: 'apple' },
    },
    include: { passes: { include: { cards: true } } },
  });

  const serials = registrations
    .filter((r) => r.passes.serial_number && r.passes.cards.updated_at > sinceDate)
    .map((r) => r.passes.serial_number!);

  if (serials.length === 0) return new NextResponse(null, { status: 204 });

  return NextResponse.json({
    serialNumbers: serials,
    lastUpdated: String(Math.floor(Date.now() / 1000)),
  });
}

// ─── Serve latest pass ───────────────────────────────────────────────────────

async function handleGetPass(req: NextRequest, slug: string, serial: string) {
  const authToken = getAuthToken(req);
  if (!authToken) return new NextResponse(null, { status: 401 });

  const pass = await verifyPassAuth(serial, authToken);
  if (!pass || !pass.cards) return new NextResponse(null, { status: 401 });
  const card = pass.cards;

  if (!isAppleWalletConfigured()) return new NextResponse(null, { status: 500 });

  const tenant = await getTenant(slug);
  if (!tenant) return new NextResponse(null, { status: 404 });

  const [rewardConfig, locations] = await Promise.all([
    getActiveRewardConfig(tenant.id),
    prisma.locations.findMany({ where: { tenant_id: tenant.id, status: 'active', lat: { not: null }, lng: { not: null } } }),
  ]);
  const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);
  const customerName = card.accounts?.people?.display_name || DEFAULT_CUSTOMER_NAME;
  const cardMeta = (card.metadata as Record<string, unknown>) ?? {};
  const lifecycleMessage = (cardMeta.lifecycle_message as string) ?? null;

  console.log(`[Apple Pass GET] serial=${serial} lifecycleMessage=${lifecycleMessage ? JSON.stringify(lifecycleMessage.slice(0, 60)) : 'null'}`);

  try {
    const { buffer } = await generateApplePass({
      cardId: card.id,
      cardNumber: card.card_number,
      customerName,
      balanceCentavos: card.balance_cents,
      visitsThisCycle: card.visits_this_cycle,
      visitsRequired,
      pendingRewards: card.pending_rewards,
      rewardName,
      totalVisits: card.total_visits,
      serial: pass.serial_number!,
      authToken: pass.auth_token!,
      tenantName: tenant.name,
      tenantSlug: slug,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      logoUrl: tenant.logoUrl,
      stripImageUrl: tenant.stripImageUrl,
      passStyle: tenant.passStyle,
      promoMessage: getActivePromo(tenant),
      lifecycleMessage,
      locations: locations.map((l) => ({ latitude: l.lat!, longitude: l.lng!, relevantText: `¡Bienvenido a ${tenant.name}!` })),
      topupEnabled: tenant.topupEnabled,
    });

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Last-Modified': card.updated_at.toUTCString(),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[Apple Pass Update]', err instanceof Error ? err.message : String(err));
    return new NextResponse(null, { status: 500 });
  }
}
