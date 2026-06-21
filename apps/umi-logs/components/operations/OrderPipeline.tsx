'use client'

import { OrderCard } from './OrderCard'

interface Order {
  id: string
  customerName: string
  itemCount: number
  total: number
  status: string
  createdAt: string
}

interface OrderPipelineProps {
  orders: Order[]
}

const COLUMNS: { key: string; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Completed' },
]

export function OrderPipeline({ orders }: OrderPipelineProps) {
  const grouped = COLUMNS.map((col) => ({
    ...col,
    orders: orders.filter((o) => o.status === col.key),
  }))

  return (
    <div className="grid grid-cols-4 gap-4">
      {grouped.map((col) => (
        <div key={col.key}>
          <p
            className="text-[10px] uppercase tracking-[0.12em] mb-2"
            style={{ color: 'var(--text-dim)' }}
          >
            {col.label}
            <span className="ml-1" style={{ color: 'var(--text-secondary)' }}>
              {col.orders.length}
            </span>
          </p>
          <div className="flex flex-col gap-2">
            {col.orders.length === 0 && (
              <div
                className="absence-cell"
                style={{ padding: '16px 8px' }}
              >
                ---
              </div>
            )}
            {col.orders.map((order) => (
              <OrderCard
                key={order.id}
                customerName={order.customerName}
                itemCount={order.itemCount}
                total={order.total}
                createdAt={order.createdAt}
                status={order.status}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
