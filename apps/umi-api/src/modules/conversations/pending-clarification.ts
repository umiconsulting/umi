/**
 * Pending-clarification expiry. Verbatim port of `_shared/pending-clarification.ts`.
 */
export function isPendingClarificationExpired(
  pendingClarification: Record<string, unknown> | null | undefined,
  now = new Date(),
): boolean {
  const expiresAt = pendingClarification?.expires_at;
  if (typeof expiresAt !== 'string' || !expiresAt) return false;
  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs <= now.getTime();
}

export function getActivePendingClarification(
  pendingClarification: Record<string, unknown> | null | undefined,
  now = new Date(),
): Record<string, unknown> | null {
  if (!pendingClarification) return null;
  return isPendingClarificationExpired(pendingClarification, now)
    ? null
    : pendingClarification;
}
