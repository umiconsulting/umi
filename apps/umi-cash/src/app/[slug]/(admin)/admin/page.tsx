'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';
import { Surface, Eyebrow, KPICard } from '@/components/ui';
import { authedFetch } from '@/lib/authed-fetch';

interface DashboardData {
  totalCustomers: number;
  activeReward: { rewardName: string; visitsRequired: number } | null;
  visitsToday: number;
  topupsTodayCount: number;
  topupsTodayMXN: string;
  pendingRewards: number;
}

export default function AdminDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const tenant = useTenant();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      authedFetch(slug, `/api/${slug}/admin/customers?limit=1`).then((r) => r.json()),
      authedFetch(slug, `/api/${slug}/admin/reward-config`).then((r) => r.json()),
      authedFetch(slug, `/api/${slug}/admin/stats`).then((r) => r.json()),
    ])
      .then(([customers, rewards, stats]) => {
        setData({
          totalCustomers: customers.total || 0,
          activeReward: rewards.active
            ? { rewardName: rewards.active.rewardName, visitsRequired: rewards.active.visitsRequired }
            : null,
          visitsToday: stats.visitsToday ?? 0,
          topupsTodayCount: stats.topupsTodayCount ?? 0,
          topupsTodayMXN: stats.topupsTodayMXN ?? '$0.00',
          pendingRewards: stats.pendingRewards ?? 0,
        });
      })
      .finally(() => setLoading(false));

    const interval = setInterval(() => {
      authedFetch(slug, `/api/${slug}/admin/stats`)
        .then((r) => r.json())
        .then((stats) => {
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  visitsToday: stats.visitsToday ?? prev.visitsToday,
                  topupsTodayMXN: stats.topupsTodayMXN ?? prev.topupsTodayMXN,
                  pendingRewards: stats.pendingRewards ?? prev.pendingRewards,
                }
              : prev
          );
        })
        .catch(() => {/* ignore refresh errors */});
    }, 30_000);

    return () => clearInterval(interval);
  }, [slug]);

  const fmt = (n: number | undefined) => (loading ? '...' : String(n ?? 0));

  const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <div className="px-5 py-5 max-w-lg mx-auto">
      <div className="u-fade-up mb-5">
        <div className="u-eyebrow mb-1.5">Resumen de hoy · {today}</div>
        <h1 className="u-display" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.05, color: 'var(--color-ink)', margin: 0 }}>
          Panel de control
        </h1>
      </div>

      {/* Hero CTA — Escanear */}
      <Link href={`/${slug}/admin/scan`} className="u-fade-up d1 u-hero-cta mb-4">
        <div className="u-hero-cta-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </div>
        <div style={{ flex: 1, color: '#fff' }}>
          <div className="u-eyebrow" style={{ color: 'rgba(255,255,255,0.75)' }}>Hoy</div>
          <div className="u-display" style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>Escanear cliente</div>
        </div>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </Link>

      {/* Today's metrics */}
      <div className={`u-fade-up d2 grid ${tenant.topupEnabled ? 'grid-cols-3' : 'grid-cols-2'} gap-3 mb-4`}>
        <KPICard label="Visitas hoy" value={fmt(data?.visitsToday)} />
        {tenant.topupEnabled && (
          <KPICard label="Recargado hoy" value={loading ? '...' : (data?.topupsTodayMXN ?? '$0.00')} />
        )}
        <KPICard
          label="Por canjear"
          value={
            <span style={{ color: data?.pendingRewards ? 'var(--color-brand)' : undefined }}>
              {fmt(data?.pendingRewards)}
            </span>
          }
        />
      </div>

      {/* Feature grid */}
      <div className="u-fade-up d3 grid grid-cols-2 gap-3 mb-4">
        {tenant.topupEnabled && (
          <DashCard href={`/${slug}/admin/topup`} title="Recargar saldo" sub="Agregar saldo regalo" />
        )}
        <DashCard
          href={`/${slug}/admin/customers`}
          title="Clientes"
          sub={loading ? '...' : `${data?.totalCustomers ?? 0} registrados`}
        />
        <DashCard href={`/${slug}/admin/rewards`} title="Recompensas" sub="Configurar" />
      </div>

      {data?.activeReward && (
        <Surface className="p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <Eyebrow>Recompensa activa</Eyebrow>
              <div className="font-semibold mt-1" style={{ color: 'var(--color-ink)' }}>
                {data.activeReward.rewardName}
              </div>
              <div className="text-sm" style={{ color: 'var(--color-ink-light)' }}>
                Cada {data.activeReward.visitsRequired} visitas
              </div>
            </div>
            <Link
              href={`/${slug}/admin/rewards`}
              className="text-sm underline"
              style={{ color: 'var(--color-ink-light)' }}
            >
              Cambiar
            </Link>
          </div>
        </Surface>
      )}

      <div
        className="rounded-xl p-4 text-sm"
        style={{ background: 'var(--color-surface-dark)', color: 'var(--color-ink-light)' }}
      >
        <div className="font-semibold mb-1" style={{ color: 'var(--color-ink)' }}>
          Para registrar una visita
        </div>
        <p>Ve a <strong>Escanear QR</strong> y pídele al cliente que muestre su código desde el teléfono.</p>
      </div>
    </div>
  );
}

function DashCard({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      className="block rounded-[var(--radius-card)] p-4 border transition-shadow hover:shadow-md"
      style={{ background: '#fff', borderColor: 'var(--color-surface-dark)' }}
    >
      <div className="font-semibold" style={{ color: 'var(--color-ink)' }}>{title}</div>
      <div className="text-xs mt-1" style={{ color: 'var(--color-ink-light)' }}>{sub}</div>
    </Link>
  );
}
