'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { RewardConfig, RewardConfigResponse } from '@/types/api';
import { formatFullDateMX } from '@/lib/intl';
import { Button, Input, Label, Surface, Eyebrow } from '@/components/ui';
import { authedFetch } from '@/lib/authed-fetch';

type TierForm = { visitsRequired: number; rewardName: string; rewardDescription: string; rewardCostMXN: string };

const EMPTY_TIER: TierForm = { visitsRequired: 10, rewardName: '', rewardDescription: '', rewardCostMXN: '' };

function tierFormFrom(c: RewardConfig): TierForm {
  return {
    visitsRequired: c.visitsRequired,
    rewardName: c.rewardName,
    rewardDescription: c.rewardDescription || '',
    rewardCostMXN: c.rewardCostCentavos > 0 ? String(c.rewardCostCentavos / 100) : '',
  };
}

function tierPayload(t: TierForm) {
  return {
    visitsRequired: t.visitsRequired,
    rewardName: t.rewardName,
    rewardDescription: t.rewardDescription,
    rewardCostCentavos: t.rewardCostMXN ? Math.round(parseFloat(t.rewardCostMXN) * 100) : 0,
  };
}

export default function RewardsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [active, setActive] = useState<RewardConfig | null>(null);
  const [upgrade, setUpgrade] = useState<RewardConfig | null>(null);
  const [history, setHistory] = useState<RewardConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TierForm>(EMPTY_TIER);
  // Optional upper tier of a two-tier ladder (e.g. 7 = capuccino, 9 = bebida rocas).
  const [upgradeOn, setUpgradeOn] = useState(false);
  const [upgradeForm, setUpgradeForm] = useState<TierForm>({ ...EMPTY_TIER, visitsRequired: 12 });
  const [message, setMessage] = useState('');
  const [messageIsSuccess, setMessageIsSuccess] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => { setRole(localStorage.getItem('userRole')); loadConfig(); }, [slug]);

  async function loadConfig() {
    const res = await authedFetch(slug, `/api/${slug}/admin/reward-config`);
    const data: RewardConfigResponse = await res.json();
    setActive(data.active);
    setUpgrade(data.upgrade ?? null);
    setHistory(data.history || []);
    if (data.active) setForm(tierFormFrom(data.active));
    if (data.upgrade) {
      setUpgradeOn(true);
      setUpgradeForm(tierFormFrom(data.upgrade));
    } else {
      setUpgradeOn(false);
      setUpgradeForm({ ...EMPTY_TIER, visitsRequired: (data.active?.visitsRequired ?? 10) + 2 });
    }
    setLoading(false);
  }

  const upgradeInvalid = upgradeOn && upgradeForm.visitsRequired <= form.visitsRequired;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (role !== 'ADMIN') { setMessage('Solo los administradores pueden cambiar las recompensas.'); return; }
    if (upgradeInvalid) { setMessage('El segundo nivel debe requerir más visitas que el primero.'); setMessageIsSuccess(false); return; }
    const summary = upgradeOn
      ? `¿Cambiar a "${form.rewardName}" a las ${form.visitsRequired} visitas y "${upgradeForm.rewardName}" a las ${upgradeForm.visitsRequired}?`
      : `¿Cambiar la recompensa a "${form.rewardName}"?`;
    if (!confirm(`${summary}\n\nEl progreso de los clientes se conserva.`)) return;
    setSaving(true);
    setMessage('');

    const res = await authedFetch(slug, `/api/${slug}/admin/reward-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...tierPayload(form),
        upgrade: upgradeOn ? tierPayload(upgradeForm) : null,
      }),
    });
    const data = await res.json();
    if (res.ok) { setMessage('Recompensa actualizada'); setMessageIsSuccess(true); await loadConfig(); }
    else { setMessage(data.error); setMessageIsSuccess(false); }
    setSaving(false);
  }

  const PRESETS = ['Cookie de temporada', 'Americano helado', 'Latte helado', 'Café de la casa', 'Croissant', 'Pan de temporada'];
  const UPGRADE_PRESETS = ['Bebida rocas, frappé o caliente', 'Frappé grande', 'Bebida de especialidad', 'Postre + café'];

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
          <Eyebrow style={{ color: 'rgba(255,255,255,0.8)' }}>{upgrade ? 'Recompensas activas' : 'Recompensa activa'}</Eyebrow>
          <div className="u-display text-2xl font-semibold mt-2">{active.rewardName}</div>
          <div className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {upgrade ? `A las ${active.visitsRequired} visitas` : `Cada ${active.visitsRequired} visitas`}
          </div>
          {active.rewardDescription && (
            <div className="text-xs mt-3" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {active.rewardDescription}
            </div>
          )}
          {upgrade && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.25)' }}>
              <div className="u-display text-xl font-semibold">{upgrade.rewardName}</div>
              <div className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.85)' }}>
                O sigue hasta las {upgrade.visitsRequired} visitas
              </div>
              {upgrade.rewardDescription && (
                <div className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {upgrade.rewardDescription}
                </div>
              )}
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

          {/* Second tier — optional ladder above the standard reward */}
          <Surface className="p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={upgradeOn}
                onChange={(e) => setUpgradeOn(e.target.checked)}
                className="w-5 h-5 mt-0.5 rounded accent-coffee-dark flex-shrink-0"
              />
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>Segundo nivel (opcional)</div>
                <p className="text-xs mt-1" style={{ color: 'var(--color-ink-light)' }}>
                  Al llegar a {form.visitsRequired || '…'} visitas el cliente puede canjear {form.rewardName || 'la recompensa'} o seguir
                  acumulando hasta el segundo nivel por una recompensa mayor. Los sellos extra se ven de otro color en su tarjeta.
                </p>
              </div>
            </label>

            {upgradeOn && (
              <div className="mt-4 space-y-4">
                <div>
                  <Label>Visitas para el segundo nivel</Label>
                  <Input
                    type="number"
                    value={upgradeForm.visitsRequired}
                    onChange={(e) => setUpgradeForm({ ...upgradeForm, visitsRequired: parseInt(e.target.value) })}
                    min={form.visitsRequired + 1}
                    max={100}
                    required
                  />
                  {upgradeInvalid && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-danger)' }}>
                      Debe ser mayor que {form.visitsRequired}.
                    </p>
                  )}
                </div>
                <div>
                  <Label>Recompensa del segundo nivel</Label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {UPGRADE_PRESETS.map((p) => {
                      const on = upgradeForm.rewardName === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setUpgradeForm({ ...upgradeForm, rewardName: p })}
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
                    value={upgradeForm.rewardName}
                    onChange={(e) => setUpgradeForm({ ...upgradeForm, rewardName: e.target.value })}
                    placeholder="Bebida rocas, frappé o caliente"
                    required={upgradeOn}
                    maxLength={100}
                  />
                </div>
                <div>
                  <Label>Costo del regalo (MXN)</Label>
                  <Input
                    type="number"
                    value={upgradeForm.rewardCostMXN}
                    onChange={(e) => setUpgradeForm({ ...upgradeForm, rewardCostMXN: e.target.value })}
                    placeholder="Ej. 110"
                    min="0"
                    max="10000"
                    step="0.01"
                  />
                </div>
                <div>
                  <Label>Descripción (opcional)</Label>
                  <textarea
                    value={upgradeForm.rewardDescription}
                    onChange={(e) => setUpgradeForm({ ...upgradeForm, rewardDescription: e.target.value })}
                    placeholder="Ej. Cualquier bebida en las rocas, frappé o caliente del menú"
                    className="u-input"
                    style={{ height: 'auto', padding: '14px 16px', resize: 'vertical' }}
                    rows={2}
                    maxLength={300}
                  />
                </div>
              </div>
            )}
          </Surface>

          {message && (
            <div
              className="text-center text-sm font-medium"
              style={{ color: messageIsSuccess ? 'var(--color-success-ink)' : 'var(--color-danger)' }}
            >
              {message}
            </div>
          )}

          <Button type="submit" disabled={saving || !form.rewardName || (upgradeOn && !upgradeForm.rewardName) || upgradeInvalid} fullWidth>
            {saving ? 'Guardando...' : upgradeOn ? 'Guardar recompensas' : 'Guardar recompensa'}
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
