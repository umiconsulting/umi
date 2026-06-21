'use client'

import { useState, useCallback, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { VirtualTable } from '@/components/data/VirtualTable'
import { invocationColumns } from '@/components/data/VirtualTable/columns'
import type { EdgeFunctionLog } from '@/types/domain'
import type { CursorPage } from '@/types/api'
import type { ColumnDef } from '@tanstack/react-table'
import { StatusBadge } from '@/components/StatusBadge'
import { CorrelationBadge } from '@/components/forensic/CorrelationBadge'

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

interface InvocationsTableClientProps {
  initialData: EdgeFunctionLog[]
  initialCursor: string | null
  filters: {
    fnFilter?: string | null
    statusFilter?: string | null
    timeRange?: string
  }
}

async function fetchPage(cursor: string | undefined, filters: InvocationsTableClientProps['filters']): Promise<CursorPage<EdgeFunctionLog>> {
  const params = new URLSearchParams()
  if (cursor) params.set('cursor', cursor)
  if (filters.fnFilter) params.set('fn', filters.fnFilter)
  if (filters.statusFilter) params.set('status', filters.statusFilter)
  if (filters.timeRange) params.set('range', filters.timeRange)
  params.set('limit', '50')

  const res = await fetch(`/api/invocations?${params}`)
  if (!res.ok) throw new Error(`Failed to fetch invocations: ${res.status}`)
  return res.json()
}

export function InvocationsTableClient({
  initialData,
  initialCursor,
  filters,
}: InvocationsTableClientProps) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['invocations', filters],
    queryFn: ({ pageParam }) => fetchPage(pageParam as string | undefined, filters),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialData: {
      pages: [{ data: initialData, nextCursor: initialCursor }],
      pageParams: [undefined],
    },
    staleTime: 30_000,
  })

  const allRows = data?.pages.flatMap((p) => p.data) ?? []

  // Compute p95 latency for anomaly highlighting
  const p95 = useMemo(() => {
    const durations = allRows
      .filter((r) => r.duration_ms != null)
      .map((r) => r.duration_ms as number)
    return percentile(durations, 95)
  }, [allRows])

  // Build augmented columns with anomaly indicator
  const anomalyColumns = useMemo((): ColumnDef<EdgeFunctionLog, unknown>[] => {
    return invocationColumns.map((col) => {
      if (col.id === 'duration_ms') {
        return {
          ...col,
          cell: ({ getValue, row }) => {
            const v = getValue() as number | null
            const isAnomaly = v != null && p95 > 0 && v > p95 * 1.5
            return (
              <span
                className="font-mono text-xs flex items-center gap-1"
                style={{ color: isAnomaly ? 'var(--status-pending)' : v != null ? 'var(--foreground)' : 'var(--text-dim)' }}
              >
                {isAnomaly && <span title={`p95: ${p95}ms`}>⚡</span>}
                {v != null ? `${v} ms` : '—'}
              </span>
            )
          },
        }
      }
      return col
    })
  }, [p95])

  const handleRowSelect = useCallback((row: EdgeFunctionLog) => {
    setSelectedId(row.id)
    router.push(`/invocations/${row.id}`)
  }, [router])

  const handleLoadMore = useCallback(() => {
    if (!isFetchingNextPage) fetchNextPage()
  }, [fetchNextPage, isFetchingNextPage])

  return (
    <VirtualTable
      data={allRows}
      columns={anomalyColumns}
      onRowSelect={handleRowSelect}
      selectedRowId={selectedId}
      getRowId={(row) => row.id}
      onLoadMore={handleLoadMore}
      hasNextPage={hasNextPage}
      isLoading={isFetchingNextPage}
    />
  )
}
