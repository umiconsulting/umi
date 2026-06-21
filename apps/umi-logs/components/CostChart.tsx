'use client'

import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

interface DailyCost {
  date: string
  cost: number
}

interface TokensByType {
  response_type: string
  tokens: number
}

export function DailyCostChart({ data }: { data: DailyCost[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
        <Tooltip formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Cost']} />
        <Line type="monotone" dataKey="cost" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function TokensByTypeChart({ data }: { data: TokensByType[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="response_type" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="tokens" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Anthropic comparison chart ──────────────────────────────────────────────

interface ComparisonPoint {
  date: string
  computed: number   // from ai_turn_logs
  official: number   // from Anthropic cost_report
}

export function CostComparisonChart({ data }: { data: ComparisonPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
        <Tooltip formatter={(v) => `$${Number(v).toFixed(5)}`} />
        <Legend />
        <Line type="monotone" dataKey="computed" name="Computed (logs)" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="official" name="Official (Anthropic)" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="4 2" />
      </LineChart>
    </ResponsiveContainer>
  )
}

interface TokenStackPoint {
  date: string
  input: number
  output: number
  cache_read: number
  cache_creation: number
}

export function TokenStackChart({ data }: { data: TokenStackPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="input"          name="Input"          stackId="a" fill="#6366f1" />
        <Bar dataKey="output"         name="Output"         stackId="a" fill="#8b5cf6" />
        <Bar dataKey="cache_read"     name="Cache read"     stackId="a" fill="#06b6d4" />
        <Bar dataKey="cache_creation" name="Cache creation" stackId="a" fill="#0ea5e9" radius={[3,3,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
