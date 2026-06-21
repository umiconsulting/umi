'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { loadSettings, saveSettings } from '../_shared';
import { SettingsSubpageHeader, StatusMessage } from '../_header';

export default function AppearanceSettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [name, setName] = useState('');
  const [form, setForm] = useState({ primaryColor: '#B5605A', secondaryColor: '' });

  useEffect(() => {
    loadSettings(slug).then((s) => {
      if (s) {
        setName(s.name);
        setForm({ primaryColor: s.primaryColor, secondaryColor: s.secondaryColor ?? '' });
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
      <SettingsSubpageHeader title="Apariencia" subtitle="Colores de la marca y vista previa" />

      <form onSubmit={handleSave} className="space-y-4">
        <div className="u-surface p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-coffee-dark mb-1.5">Color principal</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.primaryColor}
                  onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                  className="w-10 h-10 rounded-lg border border-coffee-pale cursor-pointer flex-shrink-0"
                />
                <input
                  type="text"
                  value={form.primaryColor}
                  onChange={(e) => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setForm({ ...form, primaryColor: e.target.value }); }}
                  className="u-input font-mono"
                  placeholder="#B5605A"
                  maxLength={7}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-coffee-dark mb-1.5">
                Color secundario <span className="font-normal text-coffee-light">(opcional)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.secondaryColor || form.primaryColor}
                  onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                  className="w-10 h-10 rounded-lg border border-coffee-pale cursor-pointer flex-shrink-0"
                />
                <input
                  type="text"
                  value={form.secondaryColor}
                  onChange={(e) => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setForm({ ...form, secondaryColor: e.target.value }); }}
                  className="u-input font-mono"
                  placeholder="Sin color"
                  maxLength={7}
                />
              </div>
            </div>
          </div>

          {/* Live card preview */}
          <div>
            <p className="text-xs text-coffee-medium mb-2">Vista previa de la tarjeta</p>
            <div className="rounded-2xl p-4 text-white overflow-hidden" style={{ background: form.primaryColor }}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-white/50 text-[9px] uppercase tracking-widest">Miembro</p>
                  <p className="text-white font-semibold text-sm mt-0.5">{name}</p>
                </div>
                <div className="text-right">
                  <p className="text-white/50 text-[9px] uppercase tracking-widest">Saldo</p>
                  <p className="text-white font-bold text-sm mt-0.5">$150.00</p>
                </div>
              </div>
              <div className="flex gap-1 mt-2">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-2 flex-1 rounded-full transition-colors"
                    style={{ background: i < 4 ? (form.secondaryColor || 'rgba(255,255,255,0.9)') : 'rgba(255,255,255,0.2)' }}
                  />
                ))}
              </div>
              {form.secondaryColor && (
                <p className="text-white/40 text-[9px] mt-2 text-right">Acentos en color secundario</p>
              )}
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
