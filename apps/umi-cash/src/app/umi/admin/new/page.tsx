'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NewTenantPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    slug: '',
    name: '',
    city: '',
    cardPrefix: '',
    primaryColor: '#B5605A',
    secondaryColor: '',
    adminEmail: '',
    adminPassword: '',
    visitsRequired: 10,
    rewardName: 'Bebida gratis',
  });
  const [locations, setLocations] = useState([{ name: '', address: '', latitude: '', longitude: '' }]);
  const [trialEnabled, setTrialEnabled] = useState(false);
  const [trialDays, setTrialDays] = useState(30);

  function field(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: key === 'visitsRequired' ? parseInt(e.target.value) || 0 : e.target.value });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const validLocations = locations
      .filter((l) => l.name.trim())
      .map((l) => ({
        name: l.name.trim(),
        address: l.address.trim() || null,
        latitude: l.latitude ? parseFloat(l.latitude) : null,
        longitude: l.longitude ? parseFloat(l.longitude) : null,
      }));

    const body: Record<string, unknown> = {
      ...form,
      cardPrefix: form.cardPrefix.toUpperCase(),
      locations: validLocations,
    };

    if (trialEnabled) {
      const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
      body.trialEndsAt = trialEndsAt.toISOString();
    }

    const res = await fetch('/api/umi/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      router.push('/umi/admin');
    } else {
      setError(data.error || 'Error al crear cafetería');
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen" style={{ background: '#F5F7FC' }}>
      <header className="px-6 py-4" style={{ background: '#fff', borderBottom: '1px solid #D4DFEF' }}>
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/umi/admin" className="text-sm" style={{ color: '#5A6378' }}>← Master Admin</Link>
          <span style={{ color: '#D4DFEF' }}>/</span>
          <p className="font-semibold" style={{ color: '#223979' }}>Nueva cafetería</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="u-fade-up mb-6">
          <div className="u-eyebrow mb-2" style={{ color: '#7692CB' }}>Onboarding</div>
          <h1 className="u-display" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', color: '#223979', margin: 0 }}>
            Nueva cafetería
          </h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Business info */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="u-display" style={{ fontSize: 18, fontWeight: 600, color: '#1A1F33', margin: 0 }}>Información del negocio</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre</label>
                <input type="text" value={form.name} onChange={field('name')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="El Gran Ribera" required maxLength={100} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Ciudad</label>
                <input type="text" value={form.city} onChange={field('city')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="Culiacán, Sinaloa" maxLength={100} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Slug <span className="text-gray-400 font-normal">(URL: /{'{slug}'})</span>
                </label>
                <input type="text" value={form.slug} onChange={field('slug')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="elgranribera" required maxLength={30} pattern="[a-z0-9-]+" />
                <p className="text-xs text-gray-400 mt-1">Solo minúsculas, números y guiones</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Prefijo de tarjeta <span className="text-gray-400 font-normal">(EGR, KLC…)</span>
                </label>
                <input type="text" value={form.cardPrefix} onChange={field('cardPrefix')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="EGR" required maxLength={5} pattern="[A-Za-z]+" />
                <p className="text-xs text-gray-400 mt-1">Solo letras, se guarda en mayúsculas</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Colores de la tarjeta</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1.5">Principal</p>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form.primaryColor} onChange={field('primaryColor')} className="w-10 h-9 rounded-lg border border-gray-200 cursor-pointer" />
                    <input type="text" value={form.primaryColor} onChange={field('primaryColor')} className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" maxLength={7} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1.5">Secundario <span className="text-gray-400">(opcional)</span></p>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form.secondaryColor || form.primaryColor} onChange={field('secondaryColor')} className="w-10 h-9 rounded-lg border border-gray-200 cursor-pointer" />
                    <input type="text" value={form.secondaryColor} onChange={field('secondaryColor')} className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="Sin degradado" maxLength={7} />
                  </div>
                </div>
              </div>
              <div className="mt-2 rounded-xl p-3 flex gap-1" style={{ background: form.primaryColor }}>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i < 4 ? (form.secondaryColor || 'rgba(255,255,255,0.9)') : 'rgba(255,255,255,0.2)' }} />
                ))}
              </div>
            </div>
          </div>

          {/* Loyalty config */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="u-display" style={{ fontSize: 18, fontWeight: 600, color: '#1A1F33', margin: 0 }}>Programa de lealtad</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Visitas para recompensa</label>
                <input type="number" value={form.visitsRequired} onChange={field('visitsRequired')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" min={1} max={50} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre de la recompensa</label>
                <input type="text" value={form.rewardName} onChange={field('rewardName')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="Bebida gratis" required maxLength={100} />
              </div>
            </div>
          </div>

          {/* Locations */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="u-display" style={{ fontSize: 18, fontWeight: 600, color: '#1A1F33', margin: 0 }}>Sucursales</h2>
              <button type="button" onClick={() => setLocations([...locations, { name: '', address: '', latitude: '', longitude: '' }])}
                className="text-xs text-gray-500 hover:text-gray-900 transition-colors">+ Agregar sucursal</button>
            </div>
            {locations.map((loc, i) => (
              <div key={i} className="space-y-3 p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-500">Sucursal {i + 1}</p>
                  {locations.length > 1 && (
                    <button type="button" onClick={() => setLocations(locations.filter((_, j) => j !== i))}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors">Eliminar</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Nombre</label>
                    <input type="text" value={loc.name} onChange={(e) => { const next = [...locations]; next[i] = { ...loc, name: e.target.value }; setLocations(next); }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="Sucursal Centro" maxLength={100} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Dirección</label>
                    <input type="text" value={loc.address} onChange={(e) => { const next = [...locations]; next[i] = { ...loc, address: e.target.value }; setLocations(next); }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="Av. Álvaro Obregón 123" maxLength={200} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Latitud</label>
                    <input type="text" inputMode="decimal" value={loc.latitude} onChange={(e) => { const next = [...locations]; next[i] = { ...loc, latitude: e.target.value }; setLocations(next); }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="24.8049" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Longitud</label>
                    <input type="text" inputMode="decimal" value={loc.longitude} onChange={(e) => { const next = [...locations]; next[i] = { ...loc, longitude: e.target.value }; setLocations(next); }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="-107.3940" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Admin account */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="u-display" style={{ fontSize: 18, fontWeight: 600, color: '#1A1F33', margin: 0 }}>Cuenta de administrador</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email del admin</label>
              <input type="email" value={form.adminEmail} onChange={field('adminEmail')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="admin@negocio.mx" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Contraseña inicial</label>
              <input type="password" value={form.adminPassword} onChange={field('adminPassword')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="Mín. 8 caracteres" required minLength={8} />
              <p className="text-xs text-gray-400 mt-1">El cliente puede cambiarla desde su panel</p>
            </div>
          </div>

          {/* Trial period */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="u-display" style={{ fontSize: 18, fontWeight: 600, color: '#1A1F33', margin: 0 }}>Período de prueba</h2>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={trialEnabled}
                onChange={(e) => setTrialEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
              />
              <span className="text-sm font-medium text-gray-700">Cuenta de prueba</span>
            </label>
            {trialEnabled && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Días de prueba</label>
                <input
                  type="number"
                  value={trialDays}
                  onChange={(e) => setTrialDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 30)))}
                  className="w-32 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  min={1}
                  max={90}
                />
                <p className="text-xs text-gray-400 mt-1">
                  La cuenta expirará el {new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600 text-center">{error}</p>}

          <div className="flex gap-3">
            <Link href="/umi/admin" className="flex-1 text-center border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors">
              Cancelar
            </Link>
            <button type="submit" disabled={saving} className="flex-1 text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50" style={{ background: '#223979' }}>
              {saving ? 'Creando...' : 'Crear cafetería'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
