/**
 * Safe error logging — logs tag + message only, never full stack traces or
 * error objects that may contain sensitive data (request bodies, tokens, etc.).
 */
export function logError(tag: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${tag}]`, message);
}
