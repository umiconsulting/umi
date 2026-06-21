import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'
import Link from 'next/link'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

export const revalidate = 60

export default async function CustomersPage() {
  const businessId = await getActiveBusinessId()
  const { data: customers } = await supabase
    .from('customers')
    .select(`
      id, name, phone, created_at,
      conversations ( id, status ),
      conversation_outcomes ( total_cost_usd )
    `)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(100)

  const rows = (customers ?? []).map((c) => {
    const convos = Array.isArray(c.conversations) ? c.conversations : []
    const outcomes = Array.isArray(c.conversation_outcomes) ? c.conversation_outcomes : []
    const totalSpend = outcomes.reduce(
      (s: number, o: { total_cost_usd: number | null }) => s + (o.total_cost_usd ?? 0),
      0
    )
    return {
      ...c,
      totalConversations: convos.length,
      totalSpend,
    }
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Customers</h1>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)', opacity: 0.5 }}>— conversations · spend</span>
      </div>

      <div className="border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Conversations</TableHead>
              <TableHead>Total spend</TableHead>
              <TableHead>Since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No customers</TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id} className="cursor-pointer">
                <TableCell>
                  <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                    {c.name ?? 'Unknown'}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{c.phone}</TableCell>
                <TableCell>{c.totalConversations}</TableCell>
                <TableCell>{c.totalSpend > 0 ? `$${c.totalSpend.toFixed(4)}` : '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
