const blocked =
  /(?:authorization|cookie|password|secret|token|pin|credential|api[-_]?key|phone|email|contact|gift[-_]?card)/i;

export function redactSupportValue(value, depth = 0) {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => redactSupportValue(item, depth + 1));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? value.slice(0, 512) : value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 200)
      .map(([key, child]) => [
        key,
        blocked.test(key) ? '[REDACTED]' : redactSupportValue(child, depth + 1),
      ]),
  );
}
