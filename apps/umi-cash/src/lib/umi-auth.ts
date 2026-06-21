import { jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

// Platform super-admin sessions are signed with a DEDICATED secret — never the
// tenant access-token secret. This prevents a tenant STAFF/ADMIN access token
// (signed with JWT_ACCESS_SECRET) from being replayed as a umi_session cookie
// to escalate to platform super-admin.
function getSecret(): Uint8Array {
  const secret = process.env.UMI_ADMIN_JWT_SECRET;
  if (!secret) throw new Error('Missing UMI_ADMIN_JWT_SECRET');
  if (secret.length < 32) throw new Error('UMI_ADMIN_JWT_SECRET must be at least 32 characters');
  return new TextEncoder().encode(secret);
}

/** Verify a umi_session token: valid signature (dedicated secret) AND the UMI_ADMIN role claim. */
async function verifyUmiToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
    return (payload as JWTPayload & { role?: string }).role === 'UMI_ADMIN';
  } catch {
    return false;
  }
}

export async function requireUmiAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('umi_session')?.value;
  if (!(await verifyUmiToken(token))) redirect('/umi/login');
}

export async function verifyUmiSession(req: NextRequest): Promise<boolean> {
  return verifyUmiToken(req.cookies.get('umi_session')?.value);
}
