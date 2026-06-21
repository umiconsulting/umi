'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { RewardConfig } from '@/types/api';
import { formatFullDateMX } from '@/lib/intl';
import { Button, Input, Label, Surface, Eyebrow } from '@/components/ui';
import { authedFetch } from '@/lib/authed-fetch';

export default function RewardsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [active, setActive] = useState<RewardConfig | null>(null);
  const [history, setHistory] = useState<RewardConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ visitsRequired: 10, rewardName: '', rewardDescription: '', rewardCostMXN: '' });
  const [message, setMessage] = useState('');
  const [messageIsSuccess, setMessageIsSuccess] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => { setRole(localStorage.getItem('userRole')); loadConfig(); }, [slug]);

  async function loadConfig() {
    const res = await authedFetch(slug, `/api/${slug}/admin/reward-config`);
    const data = await res.json();
    setActive(data.active);
    setHistory(data.history || []);
    if (data.active) setForm({
      visitsRequired: data.active.visitsRequired,
      rewardName: data.active.rewardName,
      rewardDescription: data.active.rewardDescription || '',
      rewardCostMXN: data.active.rewardCostCentavos > 0 ? String(data.active.rewardCostCentavos / 100) : '',
    });
    setLoading(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (role !== 'ADMIN') { setMessage('Solo los administradores pueden cambiar las recompensas.'); return; }
    if (!confirm(`¿Cambiar la recompensa a "${form.rewardName}"?\n\nEl progreso de los clientes se conserva.`)) return;
    setSaving(true);
    setMessage('');

    const res = await authedFetch(slug, `/api/${slug}/admin/reward-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        rewardCostCentavos: form.rewardCostMXN ? Math.round(parseFloat(form.rewardCostMXN) * 100) : 0,
      }),
    });
    const data = await res.json();
    if (res.ok) { setMessage('Recompensa actualizada'); setMessageIsSuccess(true); await loadConfig(); }
    else { setMessage(data.error); setMessageIsSuccess(false); }
    setSaving(false);
  }

  const PRESETS = ['Cookie de temporada', 'Americano helado', 'Latte helado', 'Café de la casa', 'Croissant', 'Pan de temporada'];

  if (loading) {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <div className="animate-pulse space-y-4 mt-8">
          <div className="h-8 rounded-xl w-1/2" style={{ background: 'var(--color-surface-dark)' }} />
          <div className="h-40 rounded-2xl" style={{ background: 'var(--color-surface-dark)' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 py-6 max-w-lg mx-auto">
      <h1 className="u-display text-[28px] font-semibold tracking-tight mb-1" style={{ color: 'var(--color-ink)' }}>Recompensas</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-ink-light)' }}>
        Configura qué reciben los clientes al completar su ciclo de visitas
      </p>

      {active && (
        <div className="loyalty-card rounded-2xl p-6 text-white mb-6 relative z-10">
          <Eyebrow style={{ color: 'rgba(255,255,255,0.8)' }}>Recompensa activa</Eyebrow>
          <div className="u-display text-2xl font-semibold mt-2">{active.rewardName}</div>
          <div className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.85)' }}>
            Cada {active.visitsRequired} visitas
          </div>
          {active.rewardDescription && (
            <div className="text-xs mt-3" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {active.rewardDescription}
            </div>
          )}
        </div>
      )}

      {role === 'ADMIN' ? (
        <form onSubmit={handleSave} className="space-y-4">
          <Surface className="p-4">
            <Label>Visitas para ganar recompensa</Label>
            <Input
              type="number"
              value={form.visitsRequired}
              onChange={(e) => setForm({ ...form, visitsRequired: parseInt(e.target.value) })}
              min={1}
              max={100}
              required
            />
          </Surface>

          <Surface className="p-4">
            <Label>Nombre de la recompensa</Label>
            <div className="flex flex-wrap gap-2 mb-3">
              {PRESETS.map((p) => {
                const on = form.rewardName === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setForm({ ...form, rewardName: p })}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                    style={{
                      background: on ? 'var(--color-ink)' : 'var(--color-surface-dark)',
                      color: on ? '#fff' : 'var(--color-ink-light)',
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <Input
              type="text"
              value={form.rewardName}
              onChange={(e) => setForm({ ...form, rewardName: e.target.value })}
              placeholder="Cookie de temporada"
              required
              maxLength={100}
            />
          </Surface>

          <Surface className="p-4">
            <Label>Costo del regalo (MXN)</Label>
            <p className="text-xs mb-2" style={{ color: 'var(--color-ink-light)' }}>
              Usado para calcular la rentabilidad del programa
            </p>
            <Input
              type="number"
              value={form.rewardCostMXN}
              onChange={(e) => setForm({ ...form, rewardCostMXN: e.target.value })}
              placeholder="Ej. 85"
              min="0"
              max="10000"
              step="0.01"
            />
          </Surface>

          <Surface className="p-4">
            <Label>Descripción (opcional)</Label>
            <textarea
              value={form.rewardDescription}
              onChange={(e) => setForm({ ...form, rewardDescription: e.target.value })}
              placeholder="Descripción para los clientes..."
              className="u-input"
              style={{ height: 'auto', padding: '14px 16px', resize: 'vertical' }}
              rows={3}
              maxLength={300}
            />
          </Surface>

          {message && (
            <div
              className="text-center text-sm font-medium"
              style={{ color: messageIsSuccess ? 'var(--color-success-ink)' : 'var(--color-danger)' }}
            >
              {message}
            </div>
          )}

          <Button type="submit" disabled={saving || !form.rewardName} fullWidth>
            {saving ? 'Guardando...' : 'Guardar recompensa'}
          </Button>
        </form>
      ) : (
        <Surface className="p-4">
          <p className="text-sm" style={{ color: 'var(--color-ink-light)' }}>
            Solo los administradores pueden cambiar la configuración de recompensas.
          </p>
        </Surface>
      )}

      {history.length > 0 && (
        <div className="mt-8">
          <Eyebrow className="mb-3">Recompensas anteriores</Eyebrow>
          <Surface className="divide-y" style={{ borderColor: 'var(--color-surface-dark)' }}>
            {history.map((h) => (
              <div key={h.id} className="flex justify-between items-center px-4 py-3 text-sm">
                <div>
                  <div className="font-medium" style={{ color: 'var(--color-ink)' }}>{h.rewardName}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--color-ink-light)' }}>
                    Cada {h.visitsRequired} visitas
                  </div>
                </div>
                <div className="text-right text-xs" style={{ color: 'var(--color-ink-light)' }}>
                  {formatFullDateMX(new Date(h.activatedAt))}
                </div>
              </div>
            ))}
          </Surface>
        </div>
      )}
    </div>
  );
}
