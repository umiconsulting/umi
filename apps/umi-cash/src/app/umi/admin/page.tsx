import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getTenantConfig } from '@/lib/tenant';
import { requireUmiAdmin } from '@/lib/umi-auth';
import { LogoutButton } from './_components/LogoutButton';
import { TenantRow } from './_components/TenantRow';

export const dynamic = 'force-dynamic';

export default async function UmiMasterAdmin() {
  await requireUmiAdmin();

  // The legacy single `Tenant` row is fanned out across core.tenants +
  // loyalty.programs + ops.businesses + grow.subscriptions. Reassemble the legacy
  // row shape that <TenantRow> expects, plus the user/card counts.
  const tenantRows = await prisma.tenants.findMany({ orderBy: { created_at: 'asc' } });

  const tenants = await Promise.all(
    tenantRows.map(async (t) => {
      const [config, userCount, cardCount, rewardConfig] = await Promise.all([
        getTenantConfig(t.slug),
        prisma.tenant_memberships.count({ where: { tenant_id: t.id } }),
        prisma.cards.count({ where: { tenant_id: t.id } }),
        prisma.reward_configs.findFirst({
          where: { tenant_id: t.id, is_active: true },
          orderBy: { activated_at: 'desc' },
        }),
      ]);

      return {
        id: t.id,
        name: t.name,
        city: config?.city ?? null,
        slug: t.slug,
        cardPrefix: config?.cardPrefix ?? '',
        primaryColor: config?.primaryColor ?? '#B5605A',
        subscriptionStatus: config?.subscriptionStatus ?? 'ACTIVE',
        suspendedAt: config?.suspendedAt ?? null,
        trialEndsAt: config?.trialEndsAt ?? null,
        _count: { users: userCount, cards: cardCount },
        rewardConfigs: rewardConfig
          ? [{ rewardName: rewardConfig.reward_name, visitsRequired: rewardConfig.visits_required }]
          : [],
      };
    })
  );

  const totalUsers = tenants.reduce((sum, t) => sum + t._count.users, 0);
  const totalCards = tenants.reduce((sum, t) => sum + t._count.cards, 0);
  const activeCount = tenants.filter((t) => t.subscriptionStatus === 'ACTIVE').length;
  const suspendedCount = tenants.filter((t) => t.subscriptionStatus === 'SUSPENDED').length;

  const UMI = { navy: '#223979', blue: '#7692CB', surface: '#F5F7FC', surfaceDark: '#D4DFEF', ink: '#1A1F33', inkLight: '#5A6378' };

  return (
    <main className="min-h-screen" style={{ background: UMI.surface }}>
      {/* Header */}
      <header className="px-6 py-4" style={{ background: '#fff', borderBottom: `1px solid ${UMI.surfaceDark}` }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="28" height="28" viewBox="0 0 120 80" fill="none" aria-hidden>
              <path d="M30 22 L60 4 L90 22" stroke={UMI.navy} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
              <text x="60" y="68" textAnchor="middle" fontFamily='"Domus", "Quicksand", system-ui, sans-serif' fontSize="38" fontWeight="600" fill={UMI.navy} letterSpacing="-1">umi</text>
            </svg>
            <div className="flex items-baseline gap-2">
              <span className="u-display" style={{ fontSize: 18, fontWeight: 600, color: UMI.navy, letterSpacing: '-0.01em' }}>Umi Cash</span>
              <span className="u-eyebrow" style={{ color: UMI.blue, fontSize: 10 }}>Master Admin</span>
            </div>
          </div>
          <LogoutButton />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="u-fade-up mb-8">
          <div className="u-eyebrow mb-2" style={{ color: UMI.blue }}>Panel interno · {tenants.length} cafeterías</div>
          <h1 className="u-display" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', color: UMI.navy, margin: 0 }}>
            Buen día
          </h1>
        </div>

        {/* Stats summary */}
        <div className="u-fade-up d1 grid grid-cols-4 gap-4 mb-10">
          {[
            { label: 'Cafeterías', value: tenants.length },
            { label: 'Activas', value: activeCount, accent: true },
            { label: 'Suspendidas', value: suspendedCount },
            { label: 'Usuarios totales', value: totalUsers },
          ].map(({ label, value, accent }) => (
            <div key={label} className="rounded-2xl px-5 py-4" style={{ background: '#fff', border: `1px solid ${UMI.surfaceDark}` }}>
              <p className="u-stat-num" style={{ fontSize: 32, color: accent ? UMI.navy : UMI.ink }}>{value}</p>
              <p className="u-eyebrow mt-1.5" style={{ color: UMI.inkLight, fontSize: 10 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Tenant table */}
        <div className="u-fade-up d2 flex items-center justify-between mb-4">
          <h2 className="u-display" style={{ fontSize: 20, fontWeight: 600, color: UMI.ink, margin: 0 }}>Cafeterías</h2>
          <Link
            href="/umi/admin/new"
            className="u-btn"
            style={{ background: UMI.navy, color: '#fff', height: 40, padding: '0 16px', fontSize: 13 }}
          >
            + Nueva cafetería
          </Link>
        </div>

        <div className="u-fade-up d3 rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${UMI.surfaceDark}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: `1px solid ${UMI.surfaceDark}` }}>
                {['Negocio', 'Slug / Prefijo', 'Usuarios', 'Tarjetas', 'Estado'].map((h, i) => (
                  <th
                    key={h}
                    className={`px-4 py-3 u-eyebrow ${i === 2 || i === 3 ? 'text-right' : 'text-left'}`}
                    style={{ color: UMI.inkLight, fontSize: 10 }}
                  >
                    {h}
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: UMI.surfaceDark }}>
              {tenants.map((tenant) => {
                let trialDaysRemaining: number | null = null;
                if (tenant.subscriptionStatus === 'TRIAL' && tenant.trialEndsAt) {
                  const msRemaining = tenant.trialEndsAt.getTime() - Date.now();
                  trialDaysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
                }
                return (
                  <TenantRow key={tenant.id} tenant={tenant} trialDaysRemaining={trialDaysRemaining} />
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs mt-4 text-center" style={{ color: UMI.inkLight }}>
          MRR estimado: <span className="font-semibold" style={{ color: UMI.navy }}>${(activeCount * 350).toLocaleString('es-MX')} MXN/mes</span>
          {' '}· {activeCount} cliente{activeCount !== 1 ? 's' : ''} activo{activeCount !== 1 ? 's' : ''} × $350
        </p>
      </div>
    </main>
  );
}
