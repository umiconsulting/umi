import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'
import { StatusBadge } from '@/components/StatusBadge'
import Link from 'next/link'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

export const revalidate = 30

export default async function ConversationsPage() {
  const businessId = await getActiveBusinessId()
  const { data: conversations } = await supabase
    .from('conversations')
    .select(`
      id, status, created_at, last_message_at,
      customers ( name, phone ),
      ai_turn_logs ( cost_usd )
    `)
    .eq('business_id', businessId)
    .order('last_message_at', { ascending: false })
    .limit(100)

  const rows = (conversations ?? []).map((c) => {
    const turns = Array.isArray(c.ai_turn_logs) ? c.ai_turn_logs : []
    const totalCost = turns.reduce((s: number, t: { cost_usd: number | null }) => s + (t.cost_usd ?? 0), 0)
    const customer = Array.isArray(c.customers) ? c.customers[0] : c.customers
    return {
      ...c,
      turnCount: turns.length,
      totalCost,
      customerName: customer?.name ?? '—',
      customerPhone: customer?.phone ?? '—',
    }
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Conversations</h1>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)', opacity: 0.5 }}>— ai turns · costs</span>
      </div>

      <div className="border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Turns</TableHead>
              <TableHead>Total cost</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No conversations found</TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id} className="cursor-pointer">
                <TableCell>
                  <Link href={`/conversations/${c.id}`} className="font-medium hover:underline">
                    {c.customerName}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{c.customerPhone}</TableCell>
                <TableCell>{c.turnCount}</TableCell>
                <TableCell>{c.totalCost > 0 ? `$${c.totalCost.toFixed(4)}` : '—'}</TableCell>
                <TableCell><StatusBadge status={c.status ?? 'active'} /></TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
