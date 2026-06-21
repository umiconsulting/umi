'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { loadSettings, saveSettings } from '../_shared';
import { SettingsSubpageHeader, StatusMessage } from '../_header';

export default function BirthdaySettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [form, setForm] = useState({
    birthdayRewardEnabled: false,
    birthdayRewardName: 'Regalo de cumpleaños',
  });

  useEffect(() => {
    loadSettings(slug).then((s) => {
      if (s) {
        setForm({
          birthdayRewardEnabled: s.birthdayRewardEnabled,
          birthdayRewardName: s.birthdayRewardName,
        });
      }
      setLoading(false);
    });
  }, [slug]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    const result = await saveSettings(slug, {
      birthdayRewardEnabled: form.birthdayRewardEnabled,
      birthdayRewardName: form.birthdayRewardName || 'Regalo de cumpleaños',
    });
    if (result.ok) { setMessage('Cambios guardados'); setIsSuccess(true); }
    else { setMessage(result.error); setIsSuccess(false); }
    setSaving(false);
  }

  if (loading) {
    return <div className="px-5 py-6 max-w-lg mx-auto"><div className="animate-pulse h-40 bg-coffee-pale rounded-2xl" /></div>;
  }

  return (
    <div className="px-5 py-6 max-w-lg mx-auto">
      <SettingsSubpageHeader title="Recompensas de cumpleaños" subtitle="El cliente recibe una notificación el 1º del mes de su cumpleaños con un regalo canjeable durante el mes" />

      <form onSubmit={handleSave} className="space-y-4">
        <div className="u-surface p-5 space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-coffee-dark">Activar recompensas de cumpleaños</p>
              <p className="text-xs text-coffee-medium mt-0.5">Requiere que los clientes tengan fecha de nacimiento registrada</p>
            </div>
            <div
              onClick={() => setForm({ ...form, birthdayRewardEnabled: !form.birthdayRewardEnabled })}
              className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${form.birthdayRewardEnabled ? 'bg-coffee-brand' : 'bg-coffee-pale'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.birthdayRewardEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </div>
          </label>

          {form.birthdayRewardEnabled && (
            <div>
              <label className="block text-sm font-medium text-coffee-dark mb-1.5">Nombre del regalo</label>
              <input
                type="text"
                value={form.birthdayRewardName}
                onChange={(e) => setForm({ ...form, birthdayRewardName: e.target.value })}
                className="u-input"
                placeholder="Ej: Café gratis, Postre de cortesía"
                maxLength={100}
              />
              <p className="text-xs text-coffee-light mt-1">Aparece en la tarjeta wallet y en la pantalla de escaneo</p>
            </div>
          )}
        </div>

        <StatusMessage message={message} isSuccess={isSuccess} />

        <button type="submit" disabled={saving} className="u-btn u-btn-primary w-full">
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  );
}
