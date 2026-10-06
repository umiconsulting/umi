const SENSITIVE_KEY =
  /(?:authorization|cookie|password|secret|token|pin|credential|enrollment.*code|api[-_]?key|private[-_]?key|card[-_]?number|cvv|receipt[-_]?access)/i;

export function redactLogString(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+(@)/gi, '$1[REDACTED]$2')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(
      /([?&](?:token|secret|password|pin|credential|api[-_]?key)=)[^&#\s]+/gi,
      '$1[REDACTED]',
    )
    .slice(0, 2_000);
}

export function redactTelemetry(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => redactTelemetry(item, depth + 1));
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    const redacted = redactLogString(value);
    return value.length > 2_000 ? `${redacted}[TRUNCATED]` : redacted;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 200)
      .map(([key, child]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactTelemetry(child, depth + 1),
      ]),
  );
}

export function errorCategory(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(code)
    ? `${error.constructor.name}:${code}`
    : error.constructor.name;
}
