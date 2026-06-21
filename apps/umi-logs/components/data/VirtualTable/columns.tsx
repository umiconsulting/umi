import type { ColumnDef } from '@tanstack/react-table'
import type { EdgeFunctionLog, Conversation, SecurityLog } from '@/types/domain'
import { StatusBadge } from '@/components/StatusBadge'
import { CorrelationBadge } from '@/components/forensic/CorrelationBadge'

// ── Invocations table columns ────────────────────────────────────────────────

export const invocationColumns: ColumnDef<EdgeFunctionLog, unknown>[] = [
  {
    id: 'function_name',
    header: 'Function',
    accessorKey: 'function_name',
    size: 180,
    cell: ({ getValue }) => (
      <span className="font-mono text-xs truncate" style={{ color: 'var(--foreground)' }}>
        {String(getValue())}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    accessorKey: 'status',
    size: 80,
    cell: ({ getValue }) => <StatusBadge status={String(getValue())} />,
  },
  {
    id: 'duration_ms',
    header: 'Duration',
    accessorKey: 'duration_ms',
    size: 90,
    cell: ({ getValue }) => {
      const v = getValue() as number | null
      return (
        <span className="font-mono text-xs" style={{ color: v != null ? 'var(--foreground)' : 'var(--text-dim)' }}>
          {v != null ? `${v} ms` : '—'}
        </span>
      )
    },
  },
  {
    id: 'error_message',
    header: 'Error',
    accessorKey: 'error_message',
    cell: ({ getValue }) => {
      const v = getValue() as string | null
      if (!v) return <span style={{ color: 'var(--text-dim)' }}>—</span>
      return (
        <span className="text-xs truncate" style={{ color: 'var(--status-error)' }} title={v}>
          {v}
        </span>
      )
    },
  },
  {
    id: 'request_id',
    header: 'Trace',
    accessorKey: 'request_id',
    size: 100,
    cell: ({ getValue }) => {
      const v = getValue() as string | null
      if (!v) return <span style={{ color: 'var(--text-dim)' }}>—</span>
      return <CorrelationBadge requestId={v} />
    },
  },
  {
    id: 'created_at',
    header: 'Time',
    accessorKey: 'created_at',
    size: 140,
    cell: ({ getValue }) => (
      <span className="font-mono text-[10px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
        {new Date(String(getValue())).toLocaleString()}
      </span>
    ),
  },
]

// ── Conversations table columns ──────────────────────────────────────────────

export const conversationColumns: ColumnDef<Conversation, unknown>[] = [
  {
    id: 'customer',
    header: 'Customer',
    accessorKey: 'customers',
    cell: ({ getValue }) => {
      const c = getValue() as { name?: string; phone?: string } | null
      return (
        <span className="font-mono text-xs" style={{ color: 'var(--foreground)' }}>
          {c?.name ?? c?.phone ?? '—'}
        </span>
      )
    },
  },
  {
    id: 'status',
    header: 'Status',
    accessorKey: 'status',
    size: 80,
    cell: ({ getValue }) => <StatusBadge status={String(getValue())} />,
  },
  {
    id: 'current_state',
    header: 'State',
    accessorKey: 'current_state',
    size: 100,
    cell: ({ getValue }) => {
      const v = getValue() as string | null
      return (
        <span className="text-xs" style={{ color: v ? 'var(--foreground)' : 'var(--text-dim)' }}>
          {v ?? '—'}
        </span>
      )
    },
  },
  {
    id: 'created_at',
    header: 'Started',
    accessorKey: 'created_at',
    size: 140,
    cell: ({ getValue }) => (
      <span className="font-mono text-[10px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
        {new Date(String(getValue())).toLocaleString()}
      </span>
    ),
  },
]

// ── Security events table columns ────────────────────────────────────────────

export const securityColumns: ColumnDef<SecurityLog, unknown>[] = [
  {
    id: 'event_type',
    header: 'Event',
    accessorKey: 'event_type',
    cell: ({ getValue }) => (
      <span className="font-mono text-xs" style={{ color: 'var(--status-error)' }}>
        {String(getValue())}
      </span>
    ),
  },
  {
    id: 'failure_category',
    header: 'Category',
    accessorKey: 'failure_category',
    size: 120,
    cell: ({ getValue }) => {
      const v = getValue() as string | null
      return (
        <span className="text-xs" style={{ color: v ? 'var(--status-pending)' : 'var(--text-dim)' }}>
          {v ?? '—'}
        </span>
      )
    },
  },
  {
    id: 'request_id',
    header: 'Trace',
    accessorKey: 'request_id',
    size: 100,
    cell: ({ getValue }) => {
      const v = getValue() as string | null
      if (!v) return <span style={{ color: 'var(--text-dim)' }}>—</span>
      return <CorrelationBadge requestId={v} />
    },
  },
  {
    id: 'created_at',
    header: 'Time',
    accessorKey: 'created_at',
    size: 140,
    cell: ({ getValue }) => (
      <span className="font-mono text-[10px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
        {new Date(String(getValue())).toLocaleString()}
      </span>
    ),
  },
]
