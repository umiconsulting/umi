'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { AdminCustomer } from '@/types/api';
import { useTenant } from '@/context/TenantContext';
import { authedFetch } from '@/lib/authed-fetch';

const INACTIVE_DAYS = 30;
const NEW_ACCOUNT_GRACE_DAYS = 7;

function isInactive(customer: AdminCustomer): boolean {
  const now = Date.now();
  if (customer.lastVisit) {
    const daysSince = (now - new Date(customer.lastVisit).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > INACTIVE_DAYS;
  }
  // No visits: only flag if account is older than grace period
  const accountAgeDays = (now - new Date(customer.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return accountAgeDays > NEW_ACCOUNT_GRACE_DAYS;
}

export default function CustomersPage() {
  const { slug } = useParams<{ slug: string }>();
  const tenant = useTenant();
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [loading, setLoading] = useState(true);

  async function loadCustomers(p = 1, q = search, s = sort) {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '20', search: q, sort: s });
    const res = await authedFetch(slug, `/api/${slug}/admin/customers?${params}`);
    const data = await res.json();
    setCustomers(data.customers || []);
    setTotal(data.total || 0);
    setTotalPages(data.totalPages || 1);
    setPage(p);
    setLoading(false);
  }

  useEffect(() => { loadCustomers(); }, [slug]);

  function handleSearch(e: React.FormEvent) { e.preventDefault(); loadCustomers(1, search, sort); }

  async function handleExport() {
    const res = await authedFetch(slug, `/api/${slug}/admin/export`);
    if (!res.ok) { alert('Error al exportar'); return; }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/csv') && !contentType.includes('application/octet-stream')) {
      alert('Respuesta inesperada del servidor');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes-${slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="px-5 py-5 max-w-lg mx-auto">
      <div className="u-fade-up mb-4">
        <div className="u-eyebrow mb-1.5">{total} registrados</div>
        <div className="flex items-center justify-between">
          <h1 className="u-display" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-ink)', margin: 0 }}>
            Clientes
          </h1>
          <button
            onClick={handleExport}
            className="text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ background: '#fff', border: '1px solid var(--color-surface-dark)', color: 'var(--color-ink)' }}
          >
            ↓ CSV
          </button>
        </div>
      </div>

      <form onSubmit={handleSearch} className="u-fade-up d1 flex gap-2 mb-4">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nombre, teléfono..." className="u-input flex-1" />
        <button type="submit" className="u-btn u-btn-primary px-4">Buscar</button>
      </form>

      <div className="u-fade-up d2 flex gap-2 mb-4 overflow-x-auto pb-1">
        {[
          { value: 'recent', label: 'Recientes' },
          { value: 'visits', label: 'Más visitas' },
          ...(tenant.topupEnabled ? [{ value: 'balance', label: 'Mayor saldo' }, { value: 'ltv', label: 'Mayor LTV' }] : []),
          { value: 'inactive', label: 'Sin visitas 30d' },
        ].map((s) => (
          <button
            key={s.value}
            onClick={() => { setSort(s.value); loadCustomers(1, search, s.value); }}
            className={`u-chip ${sort === s.value ? 'active' : ''}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: 'var(--color-surface-dark)' }} />)}
        </div>
      ) : customers.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--color-ink-light)' }}><p>No se encontraron clientes</p></div>
      ) : (
        <div className="space-y-2 u-fade-up d3">
          {customers.map((c) => (
            <Link key={c.id} href={`/${slug}/admin/customers/${c.id}`}
              className="u-surface p-4 flex items-center justify-between hover:shadow-md transition-shadow">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold truncate" style={{ color: 'var(--color-ink)' }}>{c.name || 'Sin nombre'}</p>
                  {isInactive(c) && (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap" style={{ background: 'var(--color-surface-dark)', color: 'var(--color-ink-light)' }}>
                      sin visitas
                    </span>
                  )}
                </div>
                <p className="text-xs" style={{ color: 'var(--color-ink-light)' }}>{c.phone || c.email || c.cardNumber}</p>
                {c.device && <p className="text-[10px]" style={{ color: 'var(--color-ink-light)', opacity: 0.7 }}>{c.device}{c.os ? ` · ${c.os}` : ''}</p>}
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs" style={{ color: 'var(--color-ink-light)' }}>{c.totalVisits} visitas</span>
                  {tenant.topupEnabled && <span className="text-xs" style={{ color: 'var(--color-ink-light)' }}>Saldo: {c.balanceMXN}</span>}
                  {tenant.topupEnabled && c.ltvCentavos > 0 && (
                    <span className="text-xs font-medium" style={{ color: 'var(--color-brand)' }}>LTV {c.ltvMXN}</span>
                  )}
                  {c.pendingRewards > 0 && (
                    <span className="u-badge u-badge-accent">{c.pendingRewards} recompensa{c.pendingRewards > 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              <span className="ml-2" style={{ color: 'var(--color-ink-light)' }}>›</span>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button onClick={() => loadCustomers(page - 1)} disabled={page <= 1} className="u-btn u-btn-secondary px-4 py-2 text-sm">← Anterior</button>
          <span className="text-sm" style={{ color: 'var(--color-ink-light)' }}>{page} / {totalPages}</span>
          <button onClick={() => loadCustomers(page + 1)} disabled={page >= totalPages} className="u-btn u-btn-secondary px-4 py-2 text-sm">Siguiente →</button>
        </div>
      )}
    </div>
  );
}
