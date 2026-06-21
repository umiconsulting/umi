import { NextRequest, NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import { timingSafeEqual } from 'crypto';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

// Dedicated secret for platform super-admin sessions — kept separate from
// JWT_ACCESS_SECRET so tenant access tokens can never be replayed as umi_session.
function getSecret(): Uint8Array {
  const secret = process.env.UMI_ADMIN_JWT_SECRET;
  if (!secret) throw new Error('Missing UMI_ADMIN_JWT_SECRET');
  if (secret.length < 32) throw new Error('UMI_ADMIN_JWT_SECRET must be at least 32 characters');
  return new TextEncoder().encode(secret);
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = rateLimit(`umi-login:${ip}`, 5, 10 * 60 * 1000); // 5 attempts per 10 min
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const { password } = await req.json().catch(() => ({ password: '' }));
  const expected = process.env.UMI_ADMIN_PASSWORD;
  if (!expected) return NextResponse.json({ error: 'Not configured' }, { status: 503 });

  let valid = false;
  try {
    const a = Buffer.from(password ?? '');
    const b = Buffer.from(expected);
    // Pad to same length to avoid length-based timing leak
    const len = Math.max(a.length, b.length);
    valid = a.length === b.length && timingSafeEqual(
      Buffer.concat([a, Buffer.alloc(len - a.length)]),
      Buffer.concat([b, Buffer.alloc(len - b.length)])
    );
  } catch {
    valid = false;
  }

  if (!valid) {
    return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 });
  }

  const token = await new SignJWT({ sub: 'umi-admin', role: 'UMI_ADMIN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('4h')
    .sign(getSecret());

  const res = NextResponse.json({ ok: true });
  res.cookies.set('umi_session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 60 * 60 * 4,
    path: '/',
  });
  return res;
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get('umi_session')?.value;
  if (!token) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    await jwtVerify(token, getSecret());
  } catch {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set('umi_session', '', { maxAge: 0, path: '/', secure: true, httpOnly: true });
  return res;
}

