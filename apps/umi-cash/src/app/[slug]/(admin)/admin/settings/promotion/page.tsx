'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { loadSettings, saveSettings } from '../_shared';
import { SettingsSubpageHeader, StatusMessage } from '../_header';

export default function PromotionSettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [form, setForm] = useState({
    promoMessage: '',
    promoStartsAt: '',
    promoEndsAt: '',
    promoDays: '',
  });

  useEffect(() => {
    loadSettings(slug).then((s) => {
      if (s) {
        setForm({
          promoMessage: s.promoMessage ?? '',
          promoStartsAt: s.promoStartsAt ? s.promoStartsAt.slice(0, 16) : '',
          promoEndsAt: s.promoEndsAt ? s.promoEndsAt.slice(0, 16) : '',
          promoDays: s.promoDays ?? '',
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
      promoMessage: form.promoMessage,
      promoStartsAt: form.promoStartsAt ? new Date(form.promoStartsAt).toISOString() : null,
      promoEndsAt: form.promoEndsAt ? new Date(form.promoEndsAt).toISOString() : null,
      promoDays: form.promoDays || null,
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
      <SettingsSubpageHeader title="Promoción especial" subtitle="Los clientes recibirán una notificación cuando actives o cambies la promoción" />

      <form onSubmit={handleSave} className="space-y-4">
        <div className="u-surface p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-coffee-dark mb-1.5">Mensaje de la promoción</label>
            <input
              type="text"
              value={form.promoMessage}
              onChange={(e) => setForm({ ...form, promoMessage: e.target.value })}
              className="u-input"
              placeholder="Ej: 2x1 en bebidas frías"
              maxLength={200}
            />
            <p className="text-xs text-coffee-light mt-1">Déjalo vacío para desactivar la promoción</p>
          </div>

          {form.promoMessage && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-coffee-dark mb-1.5">Inicia</label>
                  <input
                    type="datetime-local"
                    value={form.promoStartsAt}
                    onChange={(e) => setForm({ ...form, promoStartsAt: e.target.value })}
                    className="u-input"
                  />
                  <p className="text-xs text-coffee-light mt-1">Vacío = ya activa</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-coffee-dark mb-1.5">Expira</label>
                  <input
                    type="datetime-local"
                    value={form.promoEndsAt}
                    onChange={(e) => setForm({ ...form, promoEndsAt: e.target.value })}
                    className="u-input"
                  />
                  <p className="text-xs text-coffee-light mt-1">Vacío = sin expiración</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-coffee-dark mb-2">Días válidos</label>
                <div className="flex gap-1.5">
                  {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day, i) => {
                    const selected = form.promoDays ? form.promoDays.split(',').includes(String(i)) : false;
                    const allEmpty = !form.promoDays;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          const current = form.promoDays ? form.promoDays.split(',').filter(Boolean) : [];
                          const next = selected
                            ? current.filter((d) => d !== String(i))
                            : [...current, String(i)];
                          setForm({ ...form, promoDays: next.join(',') });
                        }}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                          selected ? 'bg-coffee-dark text-white' : allEmpty ? 'bg-coffee-pale/60 text-coffee-medium' : 'bg-coffee-pale/30 text-coffee-light'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-coffee-light mt-1.5">Sin selección = todos los días</p>
              </div>
            </>
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
