'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { loadSettings, saveSettings } from '../_shared';
import { SettingsSubpageHeader, StatusMessage } from '../_header';

export default function OptionsSettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [cardPrefix, setCardPrefix] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [form, setForm] = useState({ selfRegistration: true });

  useEffect(() => {
    loadSettings(slug).then((s) => {
      if (s) {
        setForm({ selfRegistration: s.selfRegistration });
        setCardPrefix(s.cardPrefix);
        setTenantSlug(s.slug);
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
      <SettingsSubpageHeader title="Opciones" />

      <form onSubmit={handleSave} className="space-y-4">
        <div className="u-surface p-5 space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-coffee-dark">Registro abierto</p>
              <p className="text-xs text-coffee-medium mt-0.5">Los clientes pueden registrarse solos en /{tenantSlug}/register</p>
            </div>
            <div
              onClick={() => setForm({ ...form, selfRegistration: !form.selfRegistration })}
              className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${form.selfRegistration ? 'bg-coffee-brand' : 'bg-coffee-pale'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.selfRegistration ? 'translate-x-6' : 'translate-x-1'}`} />
            </div>
          </label>

          <div>
            <label className="block text-sm font-medium text-coffee-dark mb-1">Prefijo de tarjeta</label>
            <p className="text-xs text-coffee-medium mb-1.5">Se asigna al crear la cuenta — no se puede cambiar después</p>
            <input type="text" value={cardPrefix} className="u-input font-mono bg-coffee-pale/50" readOnly />
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
