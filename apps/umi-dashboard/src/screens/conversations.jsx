import React, { useState } from 'react';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatNumber, formatTime } from '@/lib/format.js';
import { RegionHead, XSep } from '@/shell.jsx';
import { useConversationsData } from '@/data.jsx';

const ConversationsScreen = () => {
  const { t } = useLingui();
  const [page, setPage] = useState(1);
  const { data, loading } = useConversationsData({ page });
  const conversations = data?.conversations || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const active = conversations.filter((c) => c.status === 'active').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <RegionHead
        title={t`Conversaciones WhatsApp`}
        note={
          loading ? (
            <Trans>Cargando…</Trans>
          ) : (
            <Plural
              value={active}
              one="# conversación activa ahora mismo."
              other="# conversaciones activas ahora mismo."
            />
          )
        }
        count={{ value: formatNumber(total), label: t`en total` }}
      />

      <div className="log-list">
        {conversations.length === 0 && !loading && (
          <div
            className="card"
            style={{ padding: '42px 28px', textAlign: 'center', color: 'var(--ink-3)' }}
          >
            <I.WhatsApp size={30} style={{ opacity: 0.35, marginBottom: 10 }} />
            <div style={{ fontWeight: 600 }}>
              <Trans>No hay conversaciones.</Trans>
            </div>
          </div>
        )}
        {conversations.map((conversation) => (
          <div className="log-row" key={conversation.id}>
            <span className="t">
              {conversation.lastMessageAt ? formatTime(conversation.lastMessageAt) : '—'}
            </span>
            <span
              className={'marker ' + (conversation.status === 'active' ? 'info' : 'warn')}
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
              >
                <line x1="4" y1="4" x2="20" y2="20" />
                <line x1="20" y1="4" x2="4" y2="20" />
              </svg>
            </span>
            <div className="body">
              <div>
                <b>{conversation.customerName || t`Cliente WhatsApp`}</b>
                <span
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', marginLeft: 10 }}
                >
                  {conversation.customerPhone || ''}
                </span>
              </div>
              <div className="meta">
                {conversation.summary || conversation.currentState || t`Sin resumen`}
                <XSep />{' '}
                <Plural value={conversation.messageCount || 0} one="# mensaje" other="# mensajes" />
              </div>
            </div>
            <span
              className={
                'badge ' + (conversation.status === 'active' ? 'badge-admin' : 'badge-staff')
              }
            >
              {conversation.status || t`desconocido`}
            </span>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <I.ChevronLeft size={14} /> <Trans>Anterior</Trans>
          </button>
          <span
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-2)', alignSelf: 'center' }}
          >
            {page} / {totalPages}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <Trans>Siguiente</Trans> <I.ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export default ConversationsScreen;
