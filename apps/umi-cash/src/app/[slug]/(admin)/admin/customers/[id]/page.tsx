'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatMXN, COMMON_TOPUP_AMOUNTS, centavosFromPesos } from '@/lib/currency';
import { useTenant } from '@/context/TenantContext';
import { formatDateShortMX, formatDateTimeMX } from '@/lib/intl';
import { authedFetch } from '@/lib/authed-fetch';

interface CustomerDetail {
  id: string; name: string | null; phone: string | null; email: string | null; device: string | null; os: string | null; birthDate: string | null;
  cardNumber: string; cardId: string; balanceMXN: string; balanceCentavos: number;
  totalVisits: number; visitsThisCycle: number; visitsRequired: number; pendingRewards: number;
  lastVisit: string | null; createdAt: string;
  ltvCentavos: number; ltvMXN: string;
  totalTopupCentavos: number; totalTopupMXN: string;
  recentVisits: { id: string; scannedAt: string }[];
  recentTransactions: { id: string; type: string; amountCentavos: number; description: string | null; createdAt: string }[];
}

function initialsFrom(name: string | null) {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '·';
}

export default function CustomerDetailPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const router = useRouter();
  const tenant = useTenant();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);
  const [redeemLoading, setRedeemLoading] = useState(false);

  // Stable per-top-up idempotency token: reused on a re-tap after a lost response
  // (server dedups), reset on success or when the amount changes.
  const topupKeyRef = useRef<string>('');
  useEffect(() => { topupKeyRef.current = ''; }, [topupAmount]);
  const [message, setMessage] = useState('');
  const [messageIsSuccess, setMessageIsSuccess] = useState(false);
  const [confirmRedeem, setConfirmRedeem] = useState(false);

  async function loadCustomer() {
    const res = await authedFetch(slug, `/api/${slug}/admin/customers/${id}`);
    if (res.ok) setCustomer(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadCustomer(); }, [slug, id]);

  async function handleTopUp(e: React.FormEvent) {
    e.preventDefault();
    if (!customer || !topupAmount) return;
    setTopupLoading(true);
    setMessage('');

    try {
      const centavos = centavosFromPesos(topupAmount);
      if (!topupKeyRef.current) topupKeyRef.current = crypto.randomUUID();
      const res = await authedFetch(slug, `/api/${slug}/admin/topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: customer.cardId, amountCentavos: centavos, idempotencyKey: topupKeyRef.current }),
      });
      const data = await res.json();
      if (res.ok) {
        topupKeyRef.current = '';
        setMessage(`Recarga de ${data.amountMXN}. Nuevo saldo: ${data.newBalanceMXN}`);
        setMessageIsSuccess(true);
        setTopupAmount('');
        loadCustomer();
      } else {
        setMessage(data.error); setMessageIsSuccess(false);
      }
    } catch { setMessage('Error de conexión'); setMessageIsSuccess(false); }
    finally { setTopupLoading(false); }
  }

  async function handleRedeem() {
    if (!customer) return;
    setRedeemLoading(true);
    setMessage('');

    try {
      const res = await authedFetch(slug, `/api/${slug}/admin/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrPayload: customer.cardNumber, action: 'REDEEM' }),
      });
      const data = await res.json();
      if (res.ok) { setMessage(data.message); setMessageIsSuccess(true); loadCustomer(); }
      else { setMessage(data.error || data.message); setMessageIsSuccess(false); }
    } catch {
      setMessage('Error de conexión'); setMessageIsSuccess(false);
    } finally {
      // Always clear the loading flag so the button can never get stuck disabled.
      setRedeemLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="px-5 py-6 max-w-lg mx-auto animate-pulse space-y-4">
        <div className="h-8 rounded-xl w-1/2" style={{ background: 'var(--color-surface-dark)' }} />
        <div className="h-40 rounded-2xl" style={{ background: 'var(--color-surface-dark)' }} />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="px-5 py-10 text-center">
        <p style={{ color: 'var(--color-ink-light)' }}>Cliente no encontrado</p>
        <button onClick={() => router.back()} className="u-btn u-btn-secondary mt-4">← Volver</button>
      </div>
    );
  }

  const progressPct = Math.min(100, (customer.visitsThisCycle / customer.visitsRequired) * 100);

  return (
    <div className="px-5 py-6 max-w-lg mx-auto pb-8">
      <button
        onClick={() => router.back()}
        className="u-eyebrow mb-4"
        style={{ color: 'var(--color-ink-light)' }}
      >
        ← Volver
      </button>

      <div className="u-fade-up flex items-center gap-4 mb-5">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center u-display"
          style={{ background: 'var(--color-surface-dark)', color: 'var(--color-brand-dark)', fontSize: 20, fontWeight: 600 }}
        >
          {initialsFrom(customer.name)}
        </div>
        <div className="min-w-0">
          <h1 className="u-display truncate" style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-ink)', margin: 0 }}>
            {customer.name || 'Sin nombre'}
          </h1>
          <p className="text-sm truncate" style={{ color: 'var(--color-ink-light)' }}>
            {customer.phone || customer.email || '—'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-ink-light)' }}>
            {customer.cardNumber}
            {customer.birthDate && ` · ${new Date(customer.birthDate + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}`}
          </p>
        </div>
      </div>

      <div className="u-fade-up d1 u-surface p-5 mb-4">
        <div className="u-eyebrow mb-2">Progreso de visitas</div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="u-stat-num" style={{ color: 'var(--color-ink)' }}>
            {customer.visitsThisCycle}/{customer.visitsRequired}
          </span>
          {customer.pendingRewards > 0 && (
            <span className="u-badge u-badge-accent">{customer.pendingRewards} recompensa{customer.pendingRewards > 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="u-progress-track">
          <div className="u-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className={`u-fade-up d2 grid gap-3 mb-4 ${tenant.topupEnabled ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="u-surface p-4 text-center">
          <p className="u-stat-num" style={{ fontSize: 22, color: 'var(--color-ink)' }}>{customer.totalVisits}</p>
          <p className="u-eyebrow mt-1">Visitas</p>
        </div>
        <div className="u-surface p-4 text-center">
          <p className="u-stat-num" style={{ fontSize: 22, color: 'var(--color-ink)' }}>{customer.pendingRewards}</p>
          <p className="u-eyebrow mt-1">Premios</p>
        </div>
        {tenant.topupEnabled && (
          <div className="u-surface p-4 text-center">
            <p className="u-stat-num" style={{ fontSize: 22, color: 'var(--color-brand)' }}>{customer.balanceMXN}</p>
            <p className="u-eyebrow mt-1">Saldo</p>
          </div>
        )}
      </div>

      {tenant.topupEnabled && (
        <div className="u-fade-up d3 u-surface p-4 text-center mb-4">
          <div className="u-eyebrow mb-1">Valor de vida (LTV)</div>
          <p className="u-display" style={{ fontSize: 28, fontWeight: 600, color: 'var(--color-ink)', margin: 0 }}>
            {customer.ltvMXN}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-ink-light)' }}>
            Total gastado · Recargado: {customer.totalTopupMXN}
          </p>
        </div>
      )}

      {message && (
        <div
          className="rounded-xl p-3 mb-4 text-sm font-medium text-center"
          style={{
            background: messageIsSuccess ? 'var(--color-success-soft)' : 'var(--color-danger-soft)',
            color: messageIsSuccess ? 'var(--color-success-ink)' : 'var(--color-danger)',
          }}
        >
          {message}
        </div>
      )}

      {customer.pendingRewards > 0 && (
        <div className="u-surface p-5 mb-4" style={{ borderColor: 'var(--color-brand)' }}>
          <div className="u-eyebrow mb-2" style={{ color: 'var(--color-brand)' }}>Recompensa disponible</div>
          <p className="u-display mb-3" style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-ink)', margin: 0 }}>
            {customer.pendingRewards} recompensa{customer.pendingRewards > 1 ? 's' : ''} pendiente{customer.pendingRewards > 1 ? 's' : ''}
          </p>
          {confirmRedeem ? (
            <div className="space-y-2 mt-3">
              <p className="text-sm text-center" style={{ color: 'var(--color-ink)' }}>¿Confirmar canjeo para {customer.name}?</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmRedeem(false)} className="u-btn u-btn-secondary" style={{ flex: 1 }}>
                  Cancelar
                </button>
                <button
                  onClick={() => { setConfirmRedeem(false); handleRedeem(); }}
                  disabled={redeemLoading}
                  className="u-btn u-btn-primary"
                  style={{ flex: 1 }}
                >
                  {redeemLoading ? 'Canjeando…' : 'Sí, canjear'}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmRedeem(true)} disabled={redeemLoading} className="u-btn u-btn-primary" style={{ width: '100%' }}>
              Canjear recompensa
            </button>
          )}
        </div>
      )}

      {tenant.topupEnabled && (
        <div className="u-surface p-5 mb-4">
          <div className="u-eyebrow mb-3">Recargar saldo</div>
          <form onSubmit={handleTopUp} className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              {COMMON_TOPUP_AMOUNTS.map(({ label, centavos }) => {
                const on = topupAmount === String(centavos / 100);
                return (
                  <button
                    key={centavos}
                    type="button"
                    onClick={() => setTopupAmount(String(centavos / 100))}
                    className="py-2 rounded-xl text-sm font-medium transition-colors"
                    style={{
                      background: on ? 'var(--color-ink)' : 'var(--color-surface-dark)',
                      color: on ? '#fff' : 'var(--color-ink-light)',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                placeholder="Otro monto"
                className="u-input flex-1"
                min="1"
                max="10000"
              />
              <button type="submit" disabled={topupLoading || !topupAmount} className="u-btn u-btn-primary">
                {topupLoading ? '…' : 'Recargar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {customer.recentVisits?.length > 0 && (
        <div className="u-surface p-5 mb-4">
          <div className="u-eyebrow mb-3">Últimas visitas</div>
          <div className="space-y-2">
            {customer.recentVisits.map((v) => (
              <div key={v.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
                    style={{ background: 'var(--color-success-soft)', color: 'var(--color-success-ink)' }}
                  >
                    ✓
                  </span>
                  <span style={{ color: 'var(--color-ink)' }}>Visita registrada</span>
                </div>
                <span style={{ color: 'var(--color-ink-light)' }}>{formatDateTimeMX(new Date(v.scannedAt))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tenant.topupEnabled && customer.recentTransactions?.length > 0 && (
        <div className="u-surface p-5">
          <div className="u-eyebrow mb-3">Movimientos de saldo</div>
          <div className="space-y-2">
            {customer.recentTransactions.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <div>
                  <p style={{ color: 'var(--color-ink)' }}>{t.description || 'Movimiento'}</p>
                  <p className="text-xs" style={{ color: 'var(--color-ink-light)' }}>{formatDateShortMX(new Date(t.createdAt))}</p>
                </div>
                <span
                  className="font-semibold"
                  style={{ color: t.amountCentavos > 0 ? 'var(--color-success-ink)' : 'var(--color-danger)' }}
                >
                  {t.amountCentavos > 0 ? '+' : ''}{formatMXN(t.amountCentavos)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
