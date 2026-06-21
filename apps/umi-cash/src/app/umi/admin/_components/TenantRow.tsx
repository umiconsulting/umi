'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface TenantRowProps {
  tenant: {
    id: string;
    name: string;
    city: string | null;
    slug: string;
    cardPrefix: string;
    primaryColor: string;
    subscriptionStatus: string;
    suspendedAt: Date | null;
    trialEndsAt: Date | null;
    _count: { users: number; cards: number };
    rewardConfigs: { rewardName: string; visitsRequired: number }[];
  };
  trialDaysRemaining: number | null;
}

export function TenantRow({ tenant, trialDaysRemaining }: TenantRowProps) {
  const router = useRouter();

  // Toggle state
  const [active, setActive] = useState(tenant.subscriptionStatus !== 'SUSPENDED');
  const [toggleLoading, setToggleLoading] = useState(false);
  const [toggleError, setToggleError] = useState('');

  // Trial state
  const [showTrial, setShowTrial] = useState(false);
  const [trialDays, setTrialDays] = useState(30);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState('');

  // Delete state
  const [showDelete, setShowDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function toggle() {
    if (toggleLoading) return;
    const next = active ? 'SUSPENDED' : 'ACTIVE';
    setActive(!active);
    setToggleError('');
    setToggleLoading(true);

    try {
      const res = await fetch(`/api/umi/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionStatus: next }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setActive(active);
        setToggleError(data.error ?? `Error ${res.status}`);
      }
    } catch {
      setActive(active);
      setToggleError('Error de conexión');
    } finally {
      setToggleLoading(false);
    }
  }

  async function setTrial() {
    setTrialLoading(true);
    setTrialError('');
    try {
      const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
      const res = await fetch(`/api/umi/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionStatus: 'TRIAL', trialEndsAt }),
      });
      if (res.ok) {
        setShowTrial(false);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setTrialError(data.error ?? `Error ${res.status}`);
      }
    } catch {
      setTrialError('Error de conexión');
    } finally {
      setTrialLoading(false);
    }
  }

  async function deleteTenant() {
    setDeleteLoading(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/umi/tenants/${tenant.id}`, { method: 'DELETE' });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error ?? `Error ${res.status}`);
        setDeleteLoading(false);
      }
    } catch {
      setDeleteError('Error de conexión');
      setDeleteLoading(false);
    }
  }

  const STATUS_STYLES: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-700',
    SUSPENDED: 'bg-red-100 text-red-700',
    TRIAL: 'bg-amber-100 text-amber-700',
  };
  const STATUS_LABELS: Record<string, string> = {
    ACTIVE: 'Activo', SUSPENDED: 'Suspendido', TRIAL: 'Prueba',
  };
  const currentStatus = active
    ? (tenant.subscriptionStatus === 'TRIAL' ? 'TRIAL' : 'ACTIVE')
    : 'SUSPENDED';

  return (
    <>
      <tr className="hover:bg-gray-50 transition-colors">
        <td className="px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex-shrink-0" style={{ background: tenant.primaryColor }} />
            <div>
              <p className="font-medium text-gray-900">{tenant.name}</p>
              <p className="text-xs text-gray-400">{tenant.city ?? '—'}</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-4 font-mono text-gray-500 text-xs">
          <p>/{tenant.slug}</p>
          <p className="text-gray-400">{tenant.cardPrefix}</p>
        </td>
        <td className="px-4 py-4 text-right text-gray-700">{tenant._count.users}</td>
        <td className="px-4 py-4 text-right text-gray-700">{tenant._count.cards}</td>
        <td className="px-4 py-4 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <button
              onClick={toggle}
              disabled={toggleLoading}
              title={active ? 'Suspender acceso' : 'Reactivar acceso'}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-60 ${
                active ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${active ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
            <span className={`text-xs font-medium ${STATUS_STYLES[currentStatus] ?? ''} px-1.5 py-0.5 rounded-full`}>
              {toggleLoading ? '...' : STATUS_LABELS[currentStatus] ?? currentStatus}
            </span>
            {currentStatus === 'TRIAL' && trialDaysRemaining !== null && (
              trialDaysRemaining > 0
                ? <span className="text-xs font-medium bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{trialDaysRemaining}d</span>
                : <span className="text-xs font-medium bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">Exp.</span>
            )}
          </div>
        </td>
        <td className="px-4 py-4">
          <div className="flex items-center gap-2 justify-end whitespace-nowrap">
            <Link href={`/${tenant.slug}/admin`} className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-colors">
              Admin
            </Link>
            <Link href={`/umi/admin/${tenant.id}/edit`} className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
              Editar
            </Link>
            <button
              onClick={() => { setShowTrial(!showTrial); setTrialError(''); }}
              className="text-xs border border-amber-200 text-amber-600 px-3 py-1.5 rounded-lg hover:bg-amber-50 transition-colors"
            >
              Prueba
            </button>
            <Link href={`/${tenant.slug}`} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
              Ver →
            </Link>
            <button
              onClick={() => { setShowDelete(true); setDeleteInput(''); setDeleteError(''); }}
              className="text-xs text-gray-300 hover:text-red-500 transition-colors p-1"
              title="Eliminar cafetería"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
              </svg>
            </button>
          </div>
        </td>
      </tr>

      {/* Inline trial setter */}
      {showTrial && (
        <tr>
          <td colSpan={6} className="px-5 py-4 bg-amber-50 border-b border-amber-100">
            <div className="flex items-center gap-4">
              <p className="text-sm font-semibold text-amber-800">Período de prueba para {tenant.name}</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={trialDays}
                  onChange={(e) => setTrialDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 30)))}
                  className="w-20 text-sm border border-amber-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  min={1}
                  max={90}
                />
                <span className="text-sm text-amber-700">días</span>
                <span className="text-xs text-amber-600">
                  (expira el {new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })})
                </span>
              </div>
              <div className="flex gap-2 ml-auto">
                <button onClick={() => setShowTrial(false)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
                  Cancelar
                </button>
                <button onClick={setTrial} disabled={trialLoading} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-40 transition-colors">
                  {trialLoading ? 'Guardando...' : 'Activar prueba'}
                </button>
              </div>
            </div>
            {trialError && <p className="text-xs text-red-600 mt-2">{trialError}</p>}
          </td>
        </tr>
      )}

      {/* Inline delete confirmation */}
      {showDelete && (
        <tr>
          <td colSpan={6} className="px-5 py-4 bg-red-50 border-b border-red-100">
            <div className="max-w-md">
              <p className="text-sm font-semibold text-red-800 mb-1">¿Eliminar {tenant.name}?</p>
              <p className="text-xs text-red-600 mb-3">
                Esto eliminará <strong>todos</strong> los clientes, tarjetas, visitas y datos. Esta acción no se puede deshacer.
              </p>
              <p className="text-xs text-red-700 mb-2">Escribe <strong>{tenant.name}</strong> para confirmar:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  placeholder={tenant.name}
                  className="flex-1 text-sm border border-red-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                  autoFocus
                />
                <button
                  onClick={() => setShowDelete(false)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={deleteTenant}
                  disabled={deleteInput !== tenant.name || deleteLoading}
                  className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-40 transition-colors"
                >
                  {deleteLoading ? 'Eliminando...' : 'Eliminar'}
                </button>
              </div>
              {deleteError && <p className="text-xs text-red-600 mt-2">{deleteError}</p>}
            </div>
          </td>
        </tr>
      )}

      {toggleError && (
        <tr>
          <td colSpan={6} className="px-5 py-2 bg-red-50">
            <p className="text-xs text-red-600">{tenant.name}: {toggleError}</p>
          </td>
        </tr>
      )}
    </>
  );
}
