import { SignJWT, jwtVerify } from 'jose';
import { createHash, createHmac, randomBytes, timingSafeEqual, scryptSync } from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from './prisma';

function requireSecret(name: string, value: string | undefined): Uint8Array {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  if (value.length < 32) throw new Error(`${name} must be at least 32 characters`);
  return new TextEncoder().encode(value);
}

const ACCESS_SECRET = requireSecret('JWT_ACCESS_SECRET', process.env.JWT_ACCESS_SECRET);
const REFRESH_SECRET = requireSecret('JWT_REFRESH_SECRET', process.env.JWT_REFRESH_SECRET);
const QR_SECRET = requireSecret('APP_QR_SECRET', process.env.APP_QR_SECRET);

export type JWTPayload = {
  sub: string;
  role: string;
  tenantId: string;
  iat?: number;
  exp?: number;
};

export function generateRandomToken(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

export function generatePassSerial(): string {
  return randomBytes(8).toString('hex').toUpperCase();
}

export async function signAccessToken(userId: string, role: string, tenantId: string): Promise<string> {
  // Short-lived: the stateless access token carries no server-side revocation, so a
  // 15-min TTL makes /auth/refresh (which re-derives role + membership from the DB)
  // the effective revocation point. authedFetch refreshes transparently on 401, so
  // this is invisible to operators but bounds a removed/compromised token to ~15 min.
  return new SignJWT({ sub: userId, role, tenantId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(ACCESS_SECRET);
}

export async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(REFRESH_SECRET);
}

export async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
    return payload as JWTPayload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, REFRESH_SECRET, { algorithms: ['HS256'] });
    return payload as { sub: string };
  } catch {
    return null;
  }
}

// Opportunistic session cleanup — runs at most once per 10 minutes
let lastSessionCleanup = 0;
function maybeCleanExpiredSessions() {
  const now = Date.now();
  if (now - lastSessionCleanup < 10 * 60 * 1000) return;
  lastSessionCleanup = now;
  prisma.sessions.deleteMany({ where: { expires_at: { lt: new Date() } } })
    .then((r) => { if (r.count > 0) console.log(`[Auth] Cleaned ${r.count} expired sessions`); })
    .catch(() => {});
}

export async function getAuthUser(req: NextRequest): Promise<JWTPayload | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  maybeCleanExpiredSessions();
  return verifyAccessToken(authHeader.slice(7));
}

export function requireAuth(roles?: string[]) {
  return async (req: NextRequest): Promise<JWTPayload | null> => {
    const user = await getAuthUser(req);
    if (!user) return null;
    if (roles && !roles.includes(user.role)) return null;
    return user;
  };
}

// scrypt-based password hashing (memory-hard, resistant to GPU attacks)
// Format: "scrypt:salt:hash" — detected by prefix
// Legacy SHA256 format: "salt:hash" (no prefix) — supported for read, never written
export function hashPassword(password: string): string {
  const salt = generateRandomToken(16);
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    if (stored.startsWith('scrypt:')) {
      const parts = stored.split(':');
      if (parts.length !== 3) return false;
      const [, salt, expectedHash] = parts;
      const computedHash = scryptSync(password, salt, 64);
      return timingSafeEqual(Buffer.from(expectedHash, 'hex'), computedHash);
    }
    // Legacy SHA256 format
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const computed = createHash('sha256').update(password + salt).digest('hex');
    const hashBuf = Buffer.from(hash, 'hex');
    const computedBuf = Buffer.from(computed, 'hex');
    if (hashBuf.length !== computedBuf.length) return false;
    return timingSafeEqual(hashBuf, computedBuf);
  } catch {
    return false;
  }
}

/**
 * Create a refresh session on the canonical `core.sessions`. `subjectId` is the
 * authenticated principal: a `core.users.id` for staff/admin, or a `core.people.id`
 * for a CUSTOMER. Routed to the correct owner column by role; tenant_id required.
 */
export async function createSession(
  subjectId: string,
  role: string,
  tenantId: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(subjectId, role, tenantId),
    signRefreshToken(subjectId),
  ]);
  const isCustomer = role === 'CUSTOMER';
  await prisma.sessions.create({
    data: {
      tenant_id: tenantId,
      token: refreshToken,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      user_id: isCustomer ? null : subjectId,
      person_id: isCustomer ? subjectId : null,
    },
  });
  return { accessToken, refreshToken };
}

export async function signQRPayload(cardId: string, qrToken: string): Promise<string> {
  return new SignJWT({ sub: cardId, tok: qrToken, type: 'SCAN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(QR_SECRET);
}

/**
 * Sign a card number for use in wallet barcodes (Apple/Google Wallet).
 * Format: "cardNumber.hmac" — HMAC prevents forging scans with guessed card numbers.
 */
export function signWalletBarcode(cardNumber: string): string {
  const secret = process.env.APP_QR_SECRET;
  if (!secret) throw new Error('Missing APP_QR_SECRET');
  const hmac = createHmac('sha256', secret).update(cardNumber).digest('hex').slice(0, 16);
  return `${cardNumber}.${hmac}`;
}

function verifyWalletBarcode(payload: string): string | null {
  const secret = process.env.APP_QR_SECRET;
  if (!secret) return null;
  const dotIndex = payload.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const cardNumber = payload.slice(0, dotIndex);
  const providedHmac = payload.slice(dotIndex + 1);
  if (!cardNumber || !providedHmac) return null;
  const expectedHmac = createHmac('sha256', secret).update(cardNumber).digest('hex').slice(0, 16);
  // Constant-time comparison
  if (providedHmac.length !== expectedHmac.length) return null;
  if (!timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac))) return null;
  return cardNumber;
}

export async function verifyQRPayload(
  payload: string
): Promise<{ cardId: string; qrToken: string; isWalletScan: boolean } | null> {
  try {
    const { payload: p } = await jwtVerify(payload, QR_SECRET, { algorithms: ['HS256'] });
    const data = p as { sub: string; tok: string; type: string };
    return { cardId: data.sub, qrToken: data.tok, isWalletScan: false };
  } catch {
    // Try HMAC-signed wallet barcode (new format: "CARD-123.hmac")
    const cardNumber = verifyWalletBarcode(payload);
    if (cardNumber) {
      return { cardId: cardNumber, qrToken: '', isWalletScan: true };
    }
    // Legacy: accept bare card number format for already-issued passes (will be phased out)
    if (/^[A-Z]+-\d+$/.test(payload)) {
      return { cardId: payload, qrToken: '', isWalletScan: true };
    }
    return null;
  }
}
