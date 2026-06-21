import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, verifyPassword } from '@/lib/auth';
import { findLoginUser } from '@/lib/identity';
import { getTenant } from '@/lib/tenant';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

const LoginSchema = z.object({
  identifier: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

function setRefreshCookie(response: NextResponse, refreshToken: string, _slug: string) {
  response.cookies.set('refreshToken', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });
}

// Map canonical role keys → legacy role (owner/admin → ADMIN, staff/cashier → STAFF).
function legacyRole(roleKeys: string[]): 'ADMIN' | 'STAFF' | null {
  if (roleKeys.some((k) => k === 'owner' || k === 'admin')) return 'ADMIN';
  if (roleKeys.some((k) => k === 'staff' || k === 'cashier')) return 'STAFF';
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = rateLimit(`login:${params.slug}:${ip}`, 10, 15 * 60 * 1000); // 10 per 15 min
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  try {
    const body = await req.json();
    const { identifier, password } = LoginSchema.parse(body);

    // Per-account lockout: 5 failed attempts per email per 15 min (prevents distributed brute force)
    const accountRl = rateLimit(`login-account:${params.slug}:${identifier.toLowerCase()}`, 5, 15 * 60 * 1000);
    if (!accountRl.allowed) return rateLimitResponse(accountRl.resetAt);

    // Find the staff/admin user with an active membership in this tenant, plus role keys.
    const login = await findLoginUser(tenant.id, identifier);
    if (!login || !login.user.password_hash) {
      return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
    }

    const { user, roleKeys } = login;
    const role = legacyRole(roleKeys);
    if (!role) {
      // No staff/admin role in this tenant — not a login user.
      return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
    }

    // Reconstruct the stored password string for verifyPassword. scrypt → "scrypt:salt:hash",
    // legacy sha256 → "salt:hash". password_salt/hash live on core.users.
    // Any 'scrypt*' label means the hash is scrypt and must be rebuilt with the
    // 'scrypt:' prefix; only a true legacy ('salt:hash') hash uses the bare form.
    // (Migration once tagged scrypt as 'scrypt-v1' — don't let a label variant
    // silently send a scrypt hash down the SHA256 path again.)
    const stored = user.password_algorithm?.startsWith('scrypt')
      ? `scrypt:${user.password_salt}:${user.password_hash}`
      : `${user.password_salt}:${user.password_hash}`;
    if (!verifyPassword(password, stored)) {
      return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
    }

    const { accessToken, refreshToken } = await createSession(user.id, role, tenant.id);
    const response = NextResponse.json({
      accessToken,
      user: { id: user.id, name: user.display_name, role, email: user.email },
    });
    setRefreshCookie(response, refreshToken, params.slug);
    return response;
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Login]', msg);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
