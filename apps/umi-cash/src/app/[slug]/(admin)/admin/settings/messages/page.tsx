'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { loadSettings, saveSettings, type TenantSettings } from '../_shared';
import { SettingsSubpageHeader, StatusMessage } from '../_header';

export default function MessagesSettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [lifecycleCopy, setLifecycleCopy] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSettings(slug).then((s) => {
      if (s) {
        setSettings(s);
        setLifecycleCopy({ ...(s.lifecycleCopy ?? {}) });
      }
      setLoading(false);
    });
  }, [slug]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    const result = await saveSettings(slug, { lifecycleCopy });
    if (result.ok) { setMessage('Cambios guardados'); setIsSuccess(true); }
    else { setMessage(result.error); setIsSuccess(false); }
    setSaving(false);
  }

  if (loading || !settings) {
    return <div className="px-5 py-6 max-w-lg mx-auto"><div className="animate-pulse h-40 bg-coffee-pale rounded-2xl" /></div>;
  }

  return (
    <div className="px-5 py-6 max-w-lg mx-auto">
      <SettingsSubpageHeader
        title="Mensajes automáticos"
        subtitle="Personaliza los textos que se envían a la wallet del cliente. Déjalos vacíos para usar el texto por defecto."
      />

      <form onSubmit={handleSave} className="space-y-4">
        <div className="u-surface p-5 space-y-4">
          {settings.lifecycleJourneys.map((journey) => {
            const current = lifecycleCopy[journey.key] ?? '';
            const defaultText = settings.lifecycleDefaults[journey.key] ?? '';
            const vars = settings.lifecycleVariables?.[journey.key] ?? [];
            const isOverride = current.trim().length > 0;

            return (
              <div key={journey.key}>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-sm font-medium text-coffee-dark">{journey.label}</label>
                  {isOverride && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...lifecycleCopy };
                        delete next[journey.key];
                        setLifecycleCopy(next);
                      }}
                      className="text-xs text-coffee-medium hover:text-coffee-dark underline"
                    >
                      Restaurar
                    </button>
                  )}
                </div>
                <p className="text-xs text-coffee-medium mb-1.5">{journey.description}</p>
                <textarea
                  value={current}
                  onChange={(e) => setLifecycleCopy({ ...lifecycleCopy, [journey.key]: e.target.value })}
                  className="u-input"
                  rows={2}
                  maxLength={300}
                  placeholder={defaultText}
                />
                {vars.length > 0 && (
                  <p className="text-xs text-coffee-light mt-1">
                    Variables: <span className="font-mono">{vars.join(' · ')}</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <StatusMessage message={message} isSuccess={isSuccess} />

        <button type="submit" disabled={saving} className="u-btn u-btn-primary w-full">
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  );
}
