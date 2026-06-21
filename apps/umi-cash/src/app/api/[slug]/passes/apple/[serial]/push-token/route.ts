import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string; serial: string } }
) {
  const authToken = req.headers.get('authorization')?.replace('ApplePass ', '');
  if (!authToken) return new NextResponse(null, { status: 401 });

  // Pass identity lives on loyalty.passes (provider='apple'); device push tokens
  // attach to that pass via loyalty.pass_devices.
  const pass = await prisma.passes.findFirst({
    where: { provider: 'apple', serial_number: params.serial, auth_token: authToken },
  });
  if (!pass) return new NextResponse(null, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const pushToken = body.pushToken;
  if (!pushToken) return new NextResponse(null, { status: 400 });

  await prisma.pass_devices.upsert({
    where: { pass_id_device_token: { pass_id: pass.id, device_token: pushToken } },
    update: { push_token: pushToken },
    create: { tenant_id: pass.tenant_id, pass_id: pass.id, device_token: pushToken, push_token: pushToken },
  });

  return new NextResponse(null, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { slug: string; serial: string } }
) {
  const authToken = req.headers.get('authorization')?.replace('ApplePass ', '');
  if (!authToken) return new NextResponse(null, { status: 401 });

  const pass = await prisma.passes.findFirst({
    where: { provider: 'apple', serial_number: params.serial, auth_token: authToken },
  });
  if (!pass) return new NextResponse(null, { status: 401 });

  const deviceId = req.nextUrl.searchParams.get('deviceId') || '';

  await prisma.pass_devices.deleteMany({
    where: { pass_id: pass.id, device_token: deviceId },
  }).catch(() => null);

  return new NextResponse(null, { status: 200 });
}
