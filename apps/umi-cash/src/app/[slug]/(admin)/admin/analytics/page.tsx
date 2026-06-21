'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';
import { authedFetch } from '@/lib/authed-fetch';

interface VisitDay {
  date: string;
  count: number;
}

interface WeekEntry {
  week: string;
  count: number;
}

interface TopCustomer {
  id: string;
  name: string;
  cardNumber: string;
  totalVisits: number;
  balanceMXN: string;
}

interface Profitability {
  avgTicketMXN: string;
  revenuePerCycleMXN: string;
  rewardCostMXN: string;
  marginPerCycleMXN: string;
  marginPercent: number | null;
  visitsRequired: number;
  rewardCostConfigured: boolean;
}

interface AnalyticsData {
  visitsByDay: VisitDay[];
  topCustomers: TopCustomer[];
  newCustomersByWeek: WeekEntry[];
  totalBalance: string;
  topupsThisMonth: string;
  rewardsRedeemedThisMonth: number;
  avgVisitsPerCustomer: number;
  retentionRate: number;
  profitability: Profitability;
}

type Range = 7 | 30 | 90 | 365;

function Stat({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="u-surface p-4">
      <p className="u-stat-num" style={{ fontSize: 26, color: accent ? 'var(--color-brand)' : 'var(--color-ink)' }}>{value}</p>
      <p className="u-eyebrow mt-1.5">{label}</p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--color-ink-light)' }}>{sub}</p>}
    </div>
  );
}

function LoadingStat() {
  return (
    <div className="u-surface p-4">
      <div className="h-7 rounded animate-pulse w-1/2" style={{ background: 'var(--color-surface-dark)' }} />
      <div className="h-3 rounded animate-pulse w-2/3 mt-2" style={{ background: 'var(--color-surface-dark)' }} />
    </div>
  );
}

function initialsFrom(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '·';
}

function TrendChart({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }}>
      {values.map((v, i) => {
        const h = Math.max((v / max) * 100, v > 0 ? 4 : 0);
        const isLast = i === values.length - 1;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${h}%`,
              background: isLast
                ? 'var(--color-brand)'
                : 'color-mix(in oklab, var(--color-brand) 22%, var(--color-surface-dark))',
              borderRadius: 2,
            }}
          />
        );
      })}
    </div>
  );
}

export default function AnalyticsPage() {
  const { slug } = useParams<{ slug: string }>();
  const tenant = useTenant();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(30);

  useEffect(() => {
    authedFetch(slug, `/api/${slug}/admin/analytics`)
      .then((r) => {
        if (!r.ok) throw new Error('Error al cargar analíticas');
        return r.json();
      })
      .then((d: AnalyticsData) => setData(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Error desconocido'))
      .finally(() => setLoading(false));
  }, [slug]);

  const trendValues = (data?.visitsByDay ?? []).slice(-range).map((v) => v.count);
  const visitsTotal = trendValues.reduce((s, v) => s + v, 0);

  const prevTrend = (data?.visitsByDay ?? []).slice(-range * 2, -range).map((v) => v.count);
  const prevTotal = prevTrend.reduce((s, v) => s + v, 0);
  const delta = prevTotal > 0 ? Math.round(((visitsTotal - prevTotal) / prevTotal) * 100) : null;

  const rangeLabel: Record<Range, string> = { 7: '7d', 30: '30d', 90: '90d', 365: 'Año' };

  return (
    <div className="px-5 py-6 max-w-lg mx-auto pb-24">
      <div className="u-fade-up mb-5">
        <div className="u-eyebrow mb-2">Métricas del negocio</div>
        <h1 className="u-display" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-ink)', margin: 0 }}>
          Analíticas
        </h1>
      </div>

      {error && (
        <div
          className="rounded-xl p-3 mb-4 text-sm"
          style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
        >
          {error}
        </div>
      )}

      {/* Range chips */}
      <div className="u-fade-up flex gap-1.5 mb-5">
        {([7, 30, 90, 365] as Range[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`u-chip ${range === r ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}
          >
            {rangeLabel[r]}
          </button>
        ))}
      </div>

      {/* KPI 2×2 */}
      <div className="u-fade-up d1 grid grid-cols-2 gap-3 mb-4">
        {loading ? (
          <><LoadingStat /><LoadingStat /><LoadingStat /><LoadingStat /></>
        ) : (
          <>
            <Stat
              label="Visitas"
              value={visitsTotal}
              sub={delta !== null ? `${delta > 0 ? '+' : ''}${delta}% vs. ant.` : undefined}
            />
            <Stat
              label="Retención"
              value={`${data?.retentionRate ?? 0}%`}
              sub={`${data?.avgVisitsPerCustomer ?? 0} vis/cliente`}
              accent
            />
            <Stat label="Canjes (mes)" value={data?.rewardsRedeemedThisMonth ?? 0} />
            {tenant.topupEnabled ? (
              <Stat label="Recargas (mes)" value={data?.topupsThisMonth ?? '$0'} sub={`Saldo: ${data?.totalBalance ?? '$0'}`} />
            ) : (
              <Stat label="Nuevos (sem)" value={(data?.newCustomersByWeek ?? []).slice(-1)[0]?.count ?? 0} />
            )}
          </>
        )}
      </div>

      {/* Trend chart */}
      <div className="u-fade-up d2 u-surface p-5 mb-5">
        <div className="flex items-baseline justify-between mb-3">
          <div className="u-eyebrow">Visitas · {rangeLabel[range]}</div>
          {delta !== null && (
            <div className="text-xs font-semibold" style={{ color: delta >= 0 ? 'var(--color-brand)' : 'var(--color-danger)' }}>
              {delta > 0 ? '+' : ''}{delta}%
            </div>
          )}
        </div>
        {loading ? (
          <div className="h-[120px] rounded animate-pulse" style={{ background: 'var(--color-surface-dark)' }} />
        ) : trendValues.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: 'var(--color-ink-light)' }}>Sin datos aún</p>
        ) : (
          <TrendChart values={trendValues} />
        )}
      </div>

      {/* Profitability */}
      <div className="u-fade-up d3 u-surface p-5 mb-5">
        <div className="u-eyebrow mb-3">Rentabilidad del programa</div>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-6 rounded animate-pulse" style={{ background: 'var(--color-surface-dark)' }} />
            ))}
          </div>
        ) : !data?.profitability.rewardCostConfigured ? (
          <div className="text-center py-3 text-sm" style={{ color: 'var(--color-ink-light)' }}>
            Configura el costo del regalo en{' '}
            <Link href={`/${slug}/admin/rewards`} className="underline font-medium" style={{ color: 'var(--color-brand)' }}>
              Recompensas
            </Link>{' '}
            para ver la rentabilidad.
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--color-ink-light)' }}>Ticket promedio</span>
              <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>{data.profitability.avgTicketMXN}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--color-ink-light)' }}>Ingresos/ciclo ({data.profitability.visitsRequired} vis.)</span>
              <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>{data.profitability.revenuePerCycleMXN}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--color-ink-light)' }}>Costo del regalo</span>
              <span className="font-semibold" style={{ color: 'var(--color-danger)' }}>-{data.profitability.rewardCostMXN}</span>
            </div>
            <div className="h-px" style={{ background: 'var(--color-surface-dark)' }} />
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>Margen por ciclo</span>
              <div className="text-right">
                <span
                  className="u-stat-num"
                  style={{ fontSize: 20, color: (data.profitability.marginPercent ?? 0) >= 0 ? 'var(--color-success-ink)' : 'var(--color-danger)' }}
                >
                  {data.profitability.marginPerCycleMXN}
                </span>
                {data.profitability.marginPercent !== null && (
                  <p className="text-xs" style={{ color: 'var(--color-ink-light)' }}>{data.profitability.marginPercent}%</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Top customers */}
      <div className="u-fade-up d3">
        <div className="u-eyebrow mb-2.5">Clientes top</div>
        <div className="u-surface" style={{ padding: '4px 0' }}>
          {loading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 rounded-xl animate-pulse" style={{ background: 'var(--color-surface-dark)' }} />
              ))}
            </div>
          ) : (data?.topCustomers ?? []).length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--color-ink-light)' }}>Sin datos aún</p>
          ) : (
            (data?.topCustomers ?? []).slice(0, 10).map((c, i) => (
              <Link
                key={c.id}
                href={`/${slug}/admin/customers/${c.id}`}
                className="flex items-center gap-3"
                style={{
                  padding: '12px 16px',
                  borderTop: i ? '1px solid var(--color-surface-dark)' : 'none',
                }}
              >
                <div
                  className="u-display"
                  style={{
                    width: 24,
                    textAlign: 'center',
                    fontSize: 15,
                    fontWeight: 600,
                    color: i === 0 ? 'var(--color-brand)' : 'var(--color-ink-light)',
                  }}
                >
                  {i + 1}
                </div>
                <div
                  className="u-display flex items-center justify-center flex-shrink-0"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: 'var(--color-accent, var(--color-surface-dark))',
                    color: 'var(--color-brand-dark)',
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  {initialsFrom(c.name || '·')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--color-ink)' }}>{c.name || 'Sin nombre'}</p>
                  <p className="text-xs" style={{ color: 'var(--color-ink-light)' }}>{c.cardNumber}</p>
                </div>
                <div className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--color-brand)' }}>
                  {c.totalVisits}
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
