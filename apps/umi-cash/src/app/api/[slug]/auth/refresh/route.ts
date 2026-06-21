import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signAccessToken, verifyRefreshToken } from '@/lib/auth';
import { findSessionByToken } from '@/lib/identity';
import { getTenant } from '@/lib/tenant';

// Map canonical role keys → legacy role (owner/admin → ADMIN, staff/cashier → STAFF).
function legacyRole(roleKeys: string[]): 'ADMIN' | 'STAFF' | null {
  if (roleKeys.some((k) => k === 'owner' || k === 'admin')) return 'ADMIN';
  if (roleKeys.some((k) => k === 'staff' || k === 'cashier')) return 'STAFF';
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const refreshToken = req.cookies.get('refreshToken')?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }

  const [session, tenant] = await Promise.all([
    findSessionByToken(refreshToken),
    getTenant(params.slug),
  ]);

  if (!session || session.expires_at < new Date()) {
    return NextResponse.json({ error: 'Sesión expirada' }, { status: 401 });
  }

  // Enforce tenant isolation — the session must belong to this tenant's slug, and be a
  // staff/admin (user-owned) session.
  if (!tenant || session.tenant_id !== tenant.id || !session.user_id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  // Re-derive the role from the user's active membership roles in this tenant.
  const membership = await prisma.tenant_memberships.findFirst({
    where: { tenant_id: tenant.id, user_id: session.user_id, status: 'active' },
    include: { membership_roles: { include: { roles: true } } },
  });
  const roleKeys = (membership?.membership_roles ?? []).map((mr) => mr.roles.key);
  const role = legacyRole(roleKeys);
  if (!role) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const accessToken = await signAccessToken(session.user_id, role, tenant.id);
  return NextResponse.json({ accessToken });
}
