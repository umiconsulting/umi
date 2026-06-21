'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { authedFetch } from '@/lib/authed-fetch';

const JOURNEY_LABELS: Record<string, string> = {
  welcome_no_visit: 'Bienvenida',
  winback_14: 'Recuperación 14d',
  winback_30: 'Recuperación 30d',
  winback_60: 'Recuperación 60d',
  streak_3w: 'Racha 3 sem',
  streak_6w: 'Racha 6 sem',
  streak_12w: 'Racha 12 sem',
};

function journeyLabel(key: string): string {
  if (key.startsWith('reward_expiring_')) return `Recompensa por expirar (${key.slice('reward_expiring_'.length)})`;
  return JOURNEY_LABELS[key] || key;
}

type EventRow = {
  id: string;
  journey: string;
  body: string | null;
  sentAt: string;
  customer: { cardId: string; cardNumber: string; name: string | null; phone: string | null };
};

type Response = {
  page: number;
  limit: number;
  total: number;
  counts: Record<string, number>;
  events: EventRow[];
};

export default function MessagesPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => { load(); }, [slug, filter, page]);

  async function load() {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), limit: '50' });
    if (filter) qs.set('journey', filter);
    const res = await authedFetch(slug, `/api/${slug}/admin/messages?${qs}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const countEntries = data ? Object.entries(data.counts).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="px-5 py-6 max-w-2xl mx-auto">
      <div className="u-fade-up mb-6">
        <div className="u-eyebrow mb-2">Bitácora</div>
        <h1 className="u-display" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-ink)', margin: 0 }}>
          Mensajes enviados
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-ink-light)' }}>
          Notificaciones automáticas que se han enviado a la wallet de tus clientes
        </p>
      </div>

      {/* Counters / filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => { setFilter(null); setPage(1); }}
          className={`u-chip ${filter === null ? 'active' : ''}`}
        >
          Todos ({data?.total ?? 0})
        </button>
        {countEntries.map(([key, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => { setFilter(key); setPage(1); }}
            className={`u-chip ${filter === key ? 'active' : ''}`}
          >
            {journeyLabel(key)} ({count})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="u-surface p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : !data || data.events.length === 0 ? (
        <div className="u-surface p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--color-ink-light)' }}>
            Aún no se han enviado mensajes automáticos.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.events.map((e) => (
            <div key={e.id} className="u-surface p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <span className="u-eyebrow" style={{ color: 'var(--color-brand)' }}>{journeyLabel(e.journey)}</span>
                  <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--color-ink)' }}>
                    {e.customer.name || 'Cliente'}
                    <span className="font-mono text-xs ml-2" style={{ color: 'var(--color-ink-light)' }}>
                      {e.customer.cardNumber}
                    </span>
                  </p>
                </div>
                <time className="text-xs whitespace-nowrap" style={{ color: 'var(--color-ink-light)' }}>
                  {formatRelative(e.sentAt)}
                </time>
              </div>
              {e.body && (
                <p className="text-sm leading-snug" style={{ color: 'var(--color-ink)' }}>
                  {e.body}
                </p>
              )}
            </div>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="u-btn"
              >
                Anterior
              </button>
              <span className="text-xs" style={{ color: 'var(--color-ink-light)' }}>
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="u-btn"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}
