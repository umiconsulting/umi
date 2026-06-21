import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'

export interface PipelineOrder {
  id: string
  customerName: string
  itemCount: number
  total: number
  status: string
  createdAt: string
}

function parseAmount(val: number | string | null): number {
  if (val == null) return 0
  const n = typeof val === 'string' ? Number.parseFloat(val) : val
  return Number.isFinite(n) ? n : 0
}

export async function fetchOpenOrders(): Promise<PipelineOrder[]> {
  const businessId = await getActiveBusinessId()
  const { data } = await supabase
    .from('transactions')
    .select('id, status, total_amount, details, created_at, customers(name)')
    .eq('business_id', businessId)
    .in('status', ['pending', 'in_progress', 'ready', 'completed'])
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })

  return (data ?? []).map((row: any) => {
    const items = row.details?.items ?? []
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
    return {
      id: row.id,
      customerName: customer?.name ?? 'Unknown',
      itemCount: items.reduce((s: number, i: any) => s + (i.quantity ?? 1), 0),
      total: parseAmount(row.total_amount),
      status: row.status,
      createdAt: row.created_at,
    }
  })
}
