export const RESOURCE_LIMITS = {
  httpBodyBytes: 1_048_576,
  httpRequestMs: 15_000,
  httpConnectionMs: 10_000,
  paginationItems: 100,
  exportRows: 10_000,
  queueDepth: 10_000,
  assistantConcurrentTools: 0,
} as const;
