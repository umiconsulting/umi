// ── Paginated response shapes ────────────────────────────────────────────────

export interface CursorPage<T> {
  data: T[]
  nextCursor: string | null
  total?: number
}

export interface CursorParams {
  cursor?: string | null
  limit?: number
}
