'use client'

import { DepthProvider, DepthToggle, DepthGate } from '@/components/depth'
import { AbsenceCell } from '@/components/certainty'
import { VirtualMessageThread } from './VirtualMessageThread'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import Link from 'next/link'

interface CustomerFacts {
  preferences?: string[]
  dislikes?: string[]
  typical_order?: string | null
  allergies?: string[]
  notes?: string | null
}

interface ConversationDepthViewProps {
  conversation: any
  history: any[]
  turns: any[]
  messagesData: any[]
  facts: CustomerFacts | null
  tier1Active: boolean
  tier2Active: boolean
  tier3Active: boolean
  msgCount: number
  withEmbedding: number
  missingEmbedding: number
}

export function ConversationDepthView({
  conversation,
  history,
  turns,
  messagesData,
  facts,
  tier1Active,
  tier2Active,
  tier3Active,
  msgCount,
  withEmbedding,
  missingEmbedding,
}: ConversationDepthViewProps) {
  const paneHeight = 600

  return (
    <DepthProvider>
      <DepthToggle />

      {/* ── SURFACE depth ── */}
      <DepthGate level="surface">
        <div className="mt-4">
          {/* Memory context panel */}
          <div className="mb-4" style={{ border: '1px solid var(--border)', borderLeft: '3px solid var(--event-memory)' }}>
            <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-1)' }}>
              <p className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-dim)' }}>Memory Context</p>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-4 gap-2 mb-3">
                <div className="p-2" style={{ background: 'var(--surface-1)', borderLeft: `2px solid ${tier1Active ? 'var(--event-memory)' : 'var(--border)'}` }}>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>T1 · Summary</p>
                  <p className="text-xs font-mono" style={{ color: tier1Active ? 'var(--status-active)' : 'var(--text-dim)' }}>
                    {tier1Active ? 'active' : 'pending'}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>after 8 turns</p>
                </div>
                <div className="p-2" style={{ background: 'var(--surface-1)', borderLeft: `2px solid ${tier2Active ? 'var(--event-memory)' : 'var(--border)'}` }}>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>T2 · Semantic</p>
                  <p className="text-xs font-mono" style={{ color: tier2Active ? 'var(--status-active)' : 'var(--text-dim)' }}>
                    {tier2Active ? 'active' : `${Math.max(0, 10 - msgCount)} to go`}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{msgCount} / 10 msgs</p>
                </div>
                <div className="p-2" style={{ background: 'var(--surface-1)', borderLeft: `2px solid ${tier3Active ? 'var(--event-memory)' : 'var(--border)'}` }}>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>T3 · Facts</p>
                  <p className="text-xs font-mono" style={{ color: tier3Active ? 'var(--status-active)' : 'var(--text-dim)' }}>
                    {tier3Active ? 'extracted' : 'none yet'}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>preferences</p>
                </div>
                <div className="p-2" style={{ background: missingEmbedding > 0 ? 'color-mix(in srgb, var(--status-error), transparent 94%)' : 'var(--surface-1)', borderLeft: `2px solid ${missingEmbedding > 0 ? 'var(--status-error)' : 'var(--status-active)'}` }}>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Embeddings</p>
                  <p className="text-xs font-mono" style={{ color: missingEmbedding > 0 ? 'var(--status-error)' : 'var(--status-active)' }}>
                    {withEmbedding} / {msgCount}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
                    {missingEmbedding > 0 ? `${missingEmbedding} missing` : 'all embedded'}
                  </p>
                </div>
              </div>

              {tier1Active && (
                <div className="border border-border p-3 mb-2" style={{ borderLeft: '2px solid var(--event-memory)' }}>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Rolling Summary · Tier 1</p>
                  <p className="text-xs font-mono leading-relaxed" style={{ color: 'var(--foreground)' }}>{conversation.summary}</p>
                </div>
              )}

              {tier3Active && facts && (
                <div className="border border-border p-3" style={{ borderLeft: '2px solid var(--event-memory)' }}>
                  <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>Customer Facts · Tier 3</p>
                  <div className="flex flex-wrap gap-3 text-xs font-mono">
                    {(facts.preferences ?? []).length > 0 && (
                      <div>
                        <span className="mr-1" style={{ color: 'var(--text-dim)' }}>likes:</span>
                        {facts.preferences!.map((p) => (
                          <span key={p} className="inline-block px-1 py-px mr-1" style={{ border: '1px solid var(--status-active)', color: 'var(--status-active)', background: 'color-mix(in srgb, var(--status-active), transparent 92%)' }}>{p}</span>
                        ))}
                      </div>
                    )}
                    {(facts.allergies ?? []).length > 0 && (
                      <div>
                        <span className="mr-1" style={{ color: 'var(--text-dim)' }}>allergies:</span>
                        {facts.allergies!.map((a) => (
                          <span key={a} className="inline-block px-1 py-px mr-1" style={{ border: '1px solid var(--status-pending)', color: 'var(--status-pending)', background: 'color-mix(in srgb, var(--status-pending), transparent 92%)' }}>{a}</span>
                        ))}
                      </div>
                    )}
                    {facts.typical_order && (
                      <div>
                        <span className="mr-1" style={{ color: 'var(--text-dim)' }}>typical order:</span>
                        <span style={{ color: 'var(--foreground)' }}>{facts.typical_order}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Chat thread */}
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>
                    Conversation history
                    {messagesData.length > 0 && (
                      <span className="ml-2 opacity-50">({messagesData.length} msgs)</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <VirtualMessageThread
                    messages={history}
                    showEmbeddingBadge={messagesData.length > 0}
                    height={paneHeight}
                  />
                </CardContent>
              </Card>
            </div>
            <div className="col-span-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>AI turns</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-y-auto" style={{ height: paneHeight }}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-4">Type</TableHead>
                          <TableHead>Tokens</TableHead>
                          <TableHead>Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {turns.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground py-6 text-sm">No AI turns</TableCell>
                          </TableRow>
                        )}
                        {turns.map((t: any) => (
                          <TableRow key={t.id}>
                            <TableCell className="pl-4">
                              {t.response_type ? <StatusBadge status={t.response_type} /> : '—'}
                            </TableCell>
                            <TableCell className="text-xs">{t.total_tokens ?? '—'}</TableCell>
                            <TableCell className="text-xs">
                              {t.cost_usd != null ? `$${Number(t.cost_usd).toFixed(5)}` : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </DepthGate>

      {/* ── SYSTEM depth ── */}
      <DepthGate level="system">
        <div className="mt-4">
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              fontSize: 'var(--depth-system-font)',
            }}
          >
            <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <p className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-dim)' }}>
                Message Analysis · System View
              </p>
            </div>
            <table className="w-full" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-log-sm)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left px-3 py-1.5 text-[10px] uppercase" style={{ color: 'var(--text-dim)' }}>Role</th>
                  <th className="text-left px-3 py-1.5 text-[10px] uppercase" style={{ color: 'var(--text-dim)' }}>Content</th>
                  <th className="text-right px-3 py-1.5 text-[10px] uppercase" style={{ color: 'var(--text-dim)' }}>Tokens</th>
                  <th className="text-right px-3 py-1.5 text-[10px] uppercase" style={{ color: 'var(--text-dim)' }}>Latency</th>
                  <th className="text-center px-3 py-1.5 text-[10px] uppercase" style={{ color: 'var(--text-dim)' }}>Type</th>
                  <th className="text-center px-3 py-1.5 text-[10px] uppercase" style={{ color: 'var(--text-dim)' }}>T2</th>
                  <th className="text-center px-3 py-1.5 text-[10px] uppercase" style={{ color: 'var(--text-dim)' }}>T3</th>
                  <th className="text-center px-3 py-1.5 text-[10px] uppercase" style={{ color: 'var(--text-dim)' }}>Embed</th>
                </tr>
              </thead>
              <tbody>
                {history.map((msg, i) => {
                  const role = msg.role ?? msg.sender ?? 'unknown'
                  const isUser = role === 'user' || role === 'customer'
                  const matchingTurn = !isUser ? turns[Math.floor(i / 2)] : null
                  const hasEmbed = msg.embedding != null
                  const borderColor = isUser ? 'var(--event-incoming)' : 'var(--event-claude)'

                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', borderLeft: `2px solid ${borderColor}` }}>
                      <td className="px-3 py-1" style={{ color: isUser ? 'var(--status-info)' : 'var(--event-claude)', whiteSpace: 'nowrap' }}>
                        {role}
                      </td>
                      <td className="px-3 py-1" style={{ color: 'var(--text-secondary)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {msg.content.slice(0, 80)}{msg.content.length > 80 ? '…' : ''}
                      </td>
                      <td className="px-3 py-1 text-right" style={{ color: 'var(--foreground)' }}>
                        {matchingTurn?.total_tokens ?? <AbsenceCell />}
                      </td>
                      <td className="px-3 py-1 text-right" style={{ color: 'var(--foreground)' }}>
                        {matchingTurn?.latency_ms != null ? `${matchingTurn.latency_ms}ms` : <AbsenceCell />}
                      </td>
                      <td className="px-3 py-1 text-center">
                        {matchingTurn?.response_type ? (
                          <StatusBadge status={matchingTurn.response_type} />
                        ) : <AbsenceCell />}
                      </td>
                      <td className="px-3 py-1 text-center">
                        <CertaintyDot value={tier2Active && !isUser ? 0.9 : 0} color="var(--event-memory)" />
                      </td>
                      <td className="px-3 py-1 text-center">
                        <CertaintyDot value={tier3Active && !isUser ? 0.9 : 0} color="var(--event-memory)" />
                      </td>
                      <td className="px-3 py-1 text-center">
                        <CertaintyDot value={hasEmbed ? 1 : 0} color={hasEmbed ? 'var(--status-active)' : 'var(--status-error)'} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </DepthGate>

      {/* ── TRACE depth ── */}
      <DepthGate level="trace">
        <div className="mt-4">
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              fontSize: 'var(--depth-trace-font)',
              padding: '12px',
            }}
          >
            <p className="text-[10px] uppercase tracking-[0.12em] mb-3" style={{ color: 'var(--text-dim)' }}>
              Request Flow · Trace View
            </p>
            {turns.length === 0 ? (
              <div className="absence-cell" style={{ padding: '24px' }}>
                No trace data — AI turns have no request_id linked to this conversation
              </div>
            ) : (
              <div className="space-y-0">
                {turns.map((turn: any, i: number) => {
                  const requestId = turn.request_id
                  return (
                    <div key={turn.id}>
                      <div
                        className="flex items-center gap-3 px-3 py-1.5"
                        style={{
                          borderLeft: '2px solid var(--event-claude)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        <span style={{ color: 'var(--text-dim)', width: '60px', flexShrink: 0 }}>
                          {new Date(turn.created_at).toLocaleTimeString('en', { hour12: false })}
                        </span>
                        <span style={{ color: 'var(--event-claude)', width: '100px', flexShrink: 0 }}>
                          {turn.response_type ?? 'claude_call'}
                        </span>
                        <span style={{ color: 'var(--foreground)' }}>
                          {turn.total_tokens ?? 0} tok · {turn.latency_ms ?? '?'}ms · ${Number(turn.cost_usd ?? 0).toFixed(5)}
                        </span>
                        {requestId && (
                          <Link
                            href={`/trace/${requestId}`}
                            className="ml-auto px-1"
                            style={{
                              color: 'var(--text-dim)',
                              fontSize: 'var(--text-log-xs)',
                              textDecoration: 'none',
                            }}
                          >
                            {requestId.slice(0, 8)}…
                          </Link>
                        )}
                      </div>
                      {i < turns.length - 1 && (
                        <div style={{ borderLeft: '1px solid var(--border)', marginLeft: '1px', height: '4px' }} />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DepthGate>
    </DepthProvider>
  )
}

// Import needed for System depth
function CertaintyDot({ value, color }: { value: number; color?: string }) {
  const opacity = value >= 0.9 ? 'var(--certainty-full)'
    : value >= 0.7 ? 'var(--certainty-high)'
    : value >= 0.4 ? 'var(--certainty-medium)'
    : value >= 0.2 ? 'var(--certainty-low)'
    : 'var(--certainty-absent)'

  return (
    <span
      style={{
        display: 'inline-block',
        width: '6px',
        height: '6px',
        background: color ?? 'var(--status-active)',
        opacity,
      }}
    />
  )
}
