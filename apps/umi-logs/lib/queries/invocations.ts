import { supabase } from '@/lib/supabase'
import type { EdgeFunctionLog } from '@/types/domain'
import type { CursorPage, CursorParams } from '@/types/api'

export interface InvocationFilters {
  fnFilter?: string | null
  statusFilter?: string | null
  timeRange?: '1h' | '6h' | '24h' | '7d'
}

function getTimeRangeStart(range: '1h' | '6h' | '24h' | '7d' = '24h'): string {
  const ms: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  }
  return new Date(Date.now() - ms[range]).toISOString()
}

const PAGE_SIZE = 50

/**
 * Cursor-paginated invocations. Cursor is a composite `${created_at}::${id}`.
 */
export async function fetchInvocationsPage(
  { cursor, limit = PAGE_SIZE }: CursorParams,
  filters: InvocationFilters = {}
): Promise<CursorPage<EdgeFunctionLog>> {
  const since = getTimeRangeStart(filters.timeRange)

  let q = supabase
    .from('edge_function_logs')
    .select('id, function_name, status, duration_ms, error_message, created_at, request_id')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (filters.fnFilter) q = q.eq('function_name', filters.fnFilter)
  if (filters.statusFilter) q = q.eq('status', filters.statusFilter)

  // Decode composite cursor: `${created_at}||${id}`
  if (cursor) {
    const [cursorAt, cursorId] = cursor.split('||')
    q = q.or(`created_at.lt.${cursorAt},and(created_at.eq.${cursorAt},id.lt.${cursorId})`)
  }

  const { data, error } = await q
  if (error) throw error

  const rows = (data ?? []) as EdgeFunctionLog[]
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  let nextCursor: string | null = null
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1]
    nextCursor = `${last.created_at}||${last.id}`
  }

  return { data: page, nextCursor }
}

export async function fetchInvocationById(id: string): Promise<EdgeFunctionLog | null> {
  const { data } = await supabase
    .from('edge_function_logs')
    .select('id, function_name, status, duration_ms, error_message, created_at, request_id')
    .eq('id', id)
    .single()
  return (data as EdgeFunctionLog | null) ?? null
}
