/**
 * Client-side JWT utilities — decode and check expiration without verification
 * (verification happens server-side; this is just for UX).
 */

/** Decode JWT payload without signature verification */
function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch {
    return null;
  }
}

/** Returns true if the token exists and is not expired (with 30s margin) */
export function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  const payload = decodePayload(token);
  if (!payload || typeof payload.exp !== 'number') return false;
  return payload.exp > Date.now() / 1000 + 30; // 30s buffer
}

/** Get remaining seconds until token expires, or 0 if expired/invalid */
export function tokenSecondsLeft(token: string | null): number {
  if (!token) return 0;
  const payload = decodePayload(token);
  if (!payload || typeof payload.exp !== 'number') return 0;
  return Math.max(0, Math.floor(payload.exp - Date.now() / 1000));
}
