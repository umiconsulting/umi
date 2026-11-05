'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface LocationData {
  id?: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
}

type HoursGrid = Record<string, { open: boolean; from: string; to: string }>;

interface TenantEditData {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  primaryColor: string;
  secondaryColor: string | null;
  cardPrefix: string;
  selfRegistration: boolean;
  topupEnabled: boolean;
  businessHours: HoursGrid | null;
  timezone: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  rewardConfig: { visitsRequired: number; rewardName: string } | null;
  locations: LocationData[];
}

export default function EditTenantPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<TenantEditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const DAY_NAMES: Record<string, string> = { mon: 'Lun', tue: 'Mar', wed: 'Mié', thu: 'Jue', fri: 'Vie', sat: 'Sáb', sun: 'Dom' };
  const defaultHours: HoursGrid = {};

  const [form, setForm] = useState({
    name: '',
    city: '',
    primaryColor: '#B5605A',
    secondaryColor: '',
    selfRegistration: true,
    topupEnabled: true,
    businessHours: defaultHours,
    timezone: 'America/Mexico_City',
    subscriptionStatus: 'ACTIVE',
    rewardName: '',
    visitsRequired: 10,
  });
  const [locations, setLocations] = useState<{ id?: string; name: string; address: string; latitude: string; longitude: string }[]>([]);
  const [geocoding, setGeocoding] = useState<number | null>(null);

  async function geocodeAddress(index: number) {
    const loc = locations[index];
    if (!loc.address || loc.address.length < 3) return;
    setGeocoding(index);
    try {
      const res = await fetch(`/api/umi/geocode?address=${encodeURIComponent(loc.address)}`);
      if (!res.ok) { setError('No se encontró la dirección'); return; }
      const { location: data } = await res.json();
      if (!data) { setError('No se encontró la dirección'); return; }
      const next = [...locations];
      next[index] = { ...loc, latitude: String(data.latitude), longitude: String(data.longitude), address: data.formattedAddress || loc.address };
      setLocations(next);
    } catch {
      setError('Error al geocodificar');
    } finally {
      setGeocoding(null);
    }
  }

  useEffect(() => {
    fetch(`/api/umi/tenants/${id}`)
      .then((r) => r.json())
      .then((d: TenantEditData) => {
        setData(d);
        setForm({
          name: d.name,
          city: d.city ?? '',
          primaryColor: d.primaryColor,
          secondaryColor: d.secondaryColor ?? '',
          selfRegistration: d.selfRegistration,
          topupEnabled: d.topupEnabled,
          businessHours: d.businessHours || defaultHours,
          timezone: d.timezone || 'America/Mexico_City',
          subscriptionStatus: d.subscriptionStatus,
          rewardName: d.rewardConfig?.rewardName ?? 'Bebida gratis',
          visitsRequired: d.rewardConfig?.visitsRequired ?? 10,
        });
        setLocations(
          d.locations.length > 0
            ? d.locations.map((l) => ({
                id: l.id,
                name: l.name,
                address: l.address ?? '',
                latitude: l.latitude != null ? String(l.latitude) : '',
                longitude: l.longitude != null ? String(l.longitude) : '',
              }))
            : [{ name: '', address: '', latitude: '', longitude: '' }]
        );
        setLoading(false);
      })
      .catch(() => { setError('Error al cargar datos'); setLoading(false); });
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    const validLocations = locations
      .filter((l) => l.name.trim())
      .map((l) => ({
        ...(l.id ? { id: l.id } : {}),
        name: l.name.trim(),
        address: l.address.trim() || null,
        latitude: l.latitude ? parseFloat(l.latitude) : null,
        longitude: l.longitude ? parseFloat(l.longitude) : null,
      }));

    try {
      const res = await fetch(`/api/umi/tenants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          city: form.city,
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor || null,
          selfRegistration: form.selfRegistration,
          topupEnabled: form.topupEnabled,
          businessHours: form.businessHours,
          timezone: form.timezone,
          subscriptionStatus: form.subscriptionStatus,
          // Only send reward fields if changed from what was loaded
          ...(data?.rewardConfig && (form.rewardName !== data.rewardConfig.rewardName || form.visitsRequired !== data.rewardConfig.visitsRequired)
            ? { rewardName: form.rewardName, visitsRequired: form.visitsRequired }
            : {}),
          locations: validLocations,
        }),
      });

      const result = await res.json();
      if (res.ok) {
        setSuccess('Guardado correctamente');
        router.refresh();
      } else {
        setError(result.error ?? 'Error al guardar');
      }
      setSaving(false);
    } catch {
      setError('No se pudo conectar con Umi. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: '#F5F7FC' }}>
        <div className="max-w-2xl mx-auto px-6 py-10 animate-pulse space-y-4">
          <div className="h-8 rounded-xl w-1/3" style={{ background: '#D4DFEF' }} />
          <div className="h-64 rounded-2xl" style={{ background: '#D4DFEF' }} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: '#F5F7FC' }}>
      <header className="px-6 py-4" style={{ background: '#fff', borderBottom: '1px solid #D4DFEF' }}>
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/umi/admin" className="text-sm transition-colors" style={{ color: '#5A6378' }}>
            ← Master Admin
          </Link>
          <span style={{ color: '#D4DFEF' }}>/</span>
          <p className="font-semibold" style={{ color: '#223979' }}>{data?.name}</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="u-fade-up mb-8">
          <div className="u-eyebrow mb-2" style={{ color: '#7692CB' }}>Configuración · {data?.slug}</div>
          <h1 className="u-display" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: '#223979', margin: 0 }}>
            Editar cafetería
          </h1>
        </div>
        <form onSubmit={handleSave} className="space-y-6">

          {/* Business info */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="u-display" style={{ fontSize: 18, fontWeight: 600, color: '#1A1F33', margin: 0 }}>Información del negocio</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" required maxLength={100} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Ciudad</label>
                <input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" maxLength={100} placeholder="Culiacán, Sinaloa" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Slug</label>
                <input type="text" value={data?.slug ?? ''} readOnly
                  className="w-full border border-gray-100 rounded-xl px-3 py-2.5 text-sm font-mono bg-gray-50 text-gray-400 cursor-not-allowed" />
                <p className="text-xs text-gray-400 mt-1">No se puede cambiar</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Prefijo de tarjeta</label>
                <input type="text" value={data?.cardPrefix ?? ''} readOnly
                  className="w-full border border-gray-100 rounded-xl px-3 py-2.5 text-sm font-mono bg-gray-50 text-gray-400 cursor-not-allowed" />
              </div>
            </div>
          </div>

          {/* Branding */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="u-display" style={{ fontSize: 18, fontWeight: 600, color: '#1A1F33', margin: 0 }}>Apariencia</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Color principal</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                    className="w-10 h-9 rounded-lg border border-gray-200 cursor-pointer" />
                  <input type="text" value={form.primaryColor} onChange={(e) => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setForm({ ...form, primaryColor: e.target.value }); }}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" maxLength={7} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Color secundario <span className="text-gray-400 font-normal">(opcional)</span></label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.secondaryColor || form.primaryColor} onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                    className="w-10 h-9 rounded-lg border border-gray-200 cursor-pointer" />
                  <input type="text" value={form.secondaryColor} onChange={(e) => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setForm({ ...form, secondaryColor: e.target.value }); }}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="Sin degradado" maxLength={7} />
                </div>
              </div>
            </div>

            {/* Live preview */}
            <div className="rounded-xl p-3 flex gap-1" style={{ background: form.primaryColor }}>
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-2 flex-1 rounded-full" style={{ background: i < 4 ? (form.secondaryColor || 'rgba(255,255,255,0.9)') : 'rgba(255,255,255,0.2)' }} />
              ))}
            </div>
          </div>

          {/* Loyalty program */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="u-display" style={{ fontSize: 18, fontWeight: 600, color: '#1A1F33', margin: 0 }}>Programa de lealtad</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Visitas para recompensa</label>
                <input type="number" value={form.visitsRequired} onChange={(e) => setForm({ ...form, visitsRequired: parseInt(e.target.value) || 1 })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" min={1} max={50} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre de la recompensa</label>
                <input type="text" value={form.rewardName} onChange={(e) => setForm({ ...form, rewardName: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" maxLength={100} />
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
              <div key={loc.id ?? `new-${i}`} className="space-y-3 p-4 bg-gray-50 rounded-xl">
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
                    <div className="flex gap-2">
                      <input type="text" value={loc.address} onChange={(e) => { const next = [...locations]; next[i] = { ...loc, address: e.target.value }; setLocations(next); }}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="Av. Álvaro Obregón 123" maxLength={200} />
                      <button type="button" onClick={() => geocodeAddress(i)} disabled={geocoding === i || !loc.address}
                        className="px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                        title="Obtener coordenadas de Google Maps">
                        {geocoding === i ? '...' : 'GPS'}
                      </button>
                    </div>
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

          {/* Subscription & options */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="u-display" style={{ fontSize: 18, fontWeight: 600, color: '#1A1F33', margin: 0 }}>Suscripción y opciones</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Estado de suscripción</label>
              <select value={form.subscriptionStatus} onChange={(e) => setForm({ ...form, subscriptionStatus: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
                <option value="ACTIVE">Activo</option>
                <option value="TRIAL">Prueba</option>
                <option value="SUSPENDED">Suspendido</option>
              </select>
            </div>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-gray-700">Registro abierto</p>
                <p className="text-xs text-gray-400 mt-0.5">Los clientes pueden registrarse en /{data?.slug}/register</p>
              </div>
              <button type="button" onClick={() => setForm({ ...form, selfRegistration: !form.selfRegistration })}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${form.selfRegistration ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${form.selfRegistration ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-gray-700">Monedero (saldo)</p>
                <p className="text-xs text-gray-400 mt-0.5">Recargas de saldo, cobros y balance en wallet</p>
              </div>
              <button type="button" onClick={() => setForm({ ...form, topupEnabled: !form.topupEnabled })}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${form.topupEnabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${form.topupEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </label>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Horarios por día</label>
                <input aria-label="Zona horaria" className="text-xs border rounded px-2 py-1" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} required />
              </div>
              <div className="space-y-2">
                {['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((key, day) => {
                  const hours = form.businessHours[key] ?? { open: false, from: '08:00', to: '20:00' };
                  const setHours = (patch: Partial<typeof hours>) => setForm({ ...form,
                    businessHours: { ...form.businessHours, [key]: { ...hours, ...patch } } });
                  return <div key={key} className="flex items-center gap-2">
                    <label className="w-20 text-xs font-medium flex gap-2">
                      <input type="checkbox" checked={hours.open} onChange={(e) => setHours({ open: e.target.checked })} />
                      {DAY_NAMES[day]}
                    </label>
                    {hours.open ? <>
                      <input aria-label={`Apertura ${DAY_NAMES[day]}`} type="time" value={hours.from} onChange={(e) => setHours({ from: e.target.value })} required />
                      <span className="text-xs text-gray-400">a</span>
                      <input aria-label={`Cierre ${DAY_NAMES[day]}`} type="time" value={hours.to} onChange={(e) => setHours({ to: e.target.value })} required />
                    </> : <span className="text-xs text-gray-400">Cerrado</span>}
                  </div>;
                })}
              </div>
              <p className="text-xs text-gray-400 mt-2">Este formulario muestra el primer turno del día. Los turnos adicionales y las fechas especiales se conservan.</p>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          {success && <p className="text-sm text-green-600 text-center">{success}</p>}

          <div className="flex gap-3">
            <Link href="/umi/admin" className="flex-1 text-center border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors">
              Cancelar
            </Link>
            <button type="submit" disabled={saving}
              className="flex-1 text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ background: '#223979' }}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
