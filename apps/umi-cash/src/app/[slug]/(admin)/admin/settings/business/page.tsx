'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { loadSettings, saveSettings } from '../_shared';
import { SettingsSubpageHeader, StatusMessage } from '../_header';

export default function BusinessSettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [form, setForm] = useState({
    name: '',
    city: '',
    logoUrl: '',
    stripImageUrl: '',
    passStyle: 'default' as 'default' | 'stamps',
  });

  useEffect(() => {
    loadSettings(slug).then((s) => {
      if (s) {
        setForm({
          name: s.name,
          city: s.city ?? '',
          logoUrl: s.logoUrl ?? '',
          stripImageUrl: s.stripImageUrl ?? '',
          passStyle: s.passStyle ?? 'default',
        });
      }
      setLoading(false);
    });
  }, [slug]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    const result = await saveSettings(slug, form);
    if (result.ok) { setMessage('Cambios guardados'); setIsSuccess(true); }
    else { setMessage(result.error); setIsSuccess(false); }
    setSaving(false);
  }

  if (loading) {
    return <div className="px-5 py-6 max-w-lg mx-auto"><div className="animate-pulse h-40 bg-coffee-pale rounded-2xl" /></div>;
  }

  return (
    <div className="px-5 py-6 max-w-lg mx-auto">
      <SettingsSubpageHeader title="Información del negocio" subtitle="Nombre, ubicación e imágenes" />

      <form onSubmit={handleSave} className="space-y-4">
        <div className="u-surface p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-coffee-dark mb-1.5">Nombre</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="u-input" maxLength={100} required />
          </div>

          <div>
            <label className="block text-sm font-medium text-coffee-dark mb-1.5">Ciudad</label>
            <input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="u-input" placeholder="Culiacán, Sinaloa" maxLength={100} />
          </div>

          <div>
            <label className="block text-sm font-medium text-coffee-dark mb-1.5">URL del logo (opcional)</label>
            <input type="text" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} className="u-input" placeholder="/logos/mi-logo.png o https://..." />
          </div>

          <div>
            <label className="block text-sm font-medium text-coffee-dark mb-1.5">Imagen decorativa para tarjeta (opcional)</label>
            <p className="text-xs text-coffee-medium mb-1.5">Banner que aparece en la tarjeta de wallet. Tamaño recomendado: 1125×369px</p>
            <input type="text" value={form.stripImageUrl} onChange={(e) => setForm({ ...form, stripImageUrl: e.target.value })} className="u-input" placeholder="/logos/mi-strip.png o https://..." />
          </div>

          <div>
            <label className="block text-sm font-medium text-coffee-dark mb-1.5">Estilo de la tarjeta de wallet</label>
            <p className="text-xs text-coffee-medium mb-2">Al cambiar, se enviará una actualización a todos los clientes.</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'default', label: 'Sellos', hint: 'Miembro + ●○○○' },
                { value: 'stamps', label: 'Visitas faltantes', hint: 'N visitas para…' },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm({ ...form, passStyle: opt.value })}
                  className={`u-chip ${form.passStyle === opt.value ? 'active' : ''}`}
                  style={{ flexDirection: 'column', padding: '10px 8px', alignItems: 'flex-start', gap: 2 }}
                >
                  <span style={{ fontWeight: 600 }}>{opt.label}</span>
                  <span className="text-xs" style={{ color: 'var(--color-ink-light)' }}>{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <StatusMessage message={message} isSuccess={isSuccess} />

        <button type="submit" disabled={saving} className="u-btn u-btn-primary w-full">
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  );
}
