'use client'

import { useRef, useCallback, useEffect, type ReactNode } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type Row,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'

interface VirtualTableProps<T> {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  onRowSelect?: (row: T) => void
  selectedRowId?: string | null
  getRowId?: (row: T) => string
  onLoadMore?: () => void
  hasNextPage?: boolean
  isLoading?: boolean
  expandedContent?: (row: Row<T>) => ReactNode
  expandedRowIds?: Set<string>
}

export function VirtualTable<T>({
  data,
  columns,
  onRowSelect,
  selectedRowId,
  getRowId,
  onLoadMore,
  hasNextPage,
  isLoading,
  expandedContent,
  expandedRowIds,
}: VirtualTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
  })

  const rows = table.getRowModel().rows

  // Build flat list of items (rows + expanded content rows)
  const flatRows: Array<{ type: 'row'; row: Row<T> } | { type: 'expanded'; rowId: string; row: Row<T> }> = []
  for (const row of rows) {
    flatRows.push({ type: 'row', row })
    if (expandedRowIds?.has(row.id) && expandedContent) {
      flatRows.push({ type: 'expanded', rowId: row.id, row })
    }
  }

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      const item = flatRows[i]
      if (!item) return 32
      return item.type === 'expanded' ? 160 : 32
    },
    overscan: 5,
  })

  // Load more sentinel via IntersectionObserver
  const observerRef = useRef<IntersectionObserver | null>(null)
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && onLoadMore && !isLoading) {
      onLoadMore()
    }
  }, [hasNextPage, onLoadMore, isLoading])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    observerRef.current?.disconnect()
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) handleLoadMore()
      },
      { threshold: 0.1 }
    )
    observerRef.current.observe(el)
    return () => observerRef.current?.disconnect()
  }, [handleLoadMore])

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent, rowId: string) {
    if (e.key === 'Enter' && onRowSelect) {
      const row = rows.find((r) => r.id === rowId)
      if (row) onRowSelect(row.original)
    }
  }

  return (
    <div
      className="overflow-hidden font-mono"
      style={{ border: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div
        style={{
          background: 'var(--surface-1)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {table.getHeaderGroups().map((hg) => (
          <div key={hg.id} className="flex">
            {hg.headers.map((header) => (
              <div
                key={header.id}
                className="px-3 py-2 text-[10px] uppercase tracking-wider"
                style={{
                  color: 'var(--text-dim)',
                  width: header.getSize() ? `${header.getSize()}px` : undefined,
                  flex: header.getSize() ? undefined : '1',
                  minWidth: 0,
                }}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Virtualized body */}
      <div
        ref={parentRef}
        style={{ maxHeight: '600px', overflowY: 'auto', overflowX: 'hidden' }}
      >
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const item = flatRows[vItem.index]
            if (!item) return null

            if (item.type === 'expanded') {
              return (
                <div
                  key={`expanded-${item.rowId}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    transform: `translateY(${vItem.start}px)`,
                    width: '100%',
                    background: 'var(--surface-2)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  {expandedContent!(item.row)}
                </div>
              )
            }

            const row = item.row
            const isSelected = selectedRowId === row.id

            return (
              <div
                key={row.id}
                role="row"
                tabIndex={0}
                onClick={() => onRowSelect?.(row.original)}
                onKeyDown={(e) => handleKeyDown(e, row.id)}
                style={{
                  position: 'absolute',
                  top: 0,
                  transform: `translateY(${vItem.start}px)`,
                  width: '100%',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  cursor: onRowSelect ? 'pointer' : 'default',
                  background: isSelected ? 'var(--surface-3)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: isSelected ? '2px solid var(--status-active)' : '2px solid transparent',
                  transition: 'background 100ms ease-out',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent'
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    className="px-3 text-xs truncate"
                    style={{
                      width: cell.column.getSize() ? `${cell.column.getSize()}px` : undefined,
                      flex: cell.column.getSize() ? undefined : '1',
                      minWidth: 0,
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* Sentinel for infinite scroll */}
        {hasNextPage && (
          <div ref={sentinelRef} style={{ height: '1px' }} />
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div
            className="flex items-center justify-center py-3 text-xs"
            style={{ color: 'var(--text-dim)' }}
          >
            loading…
          </div>
        )}
      </div>
    </div>
  )
}
