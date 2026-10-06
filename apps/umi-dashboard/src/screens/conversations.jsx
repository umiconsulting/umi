import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatDateTime, formatNumber } from '@/lib/format.js';
import { RegionHead } from '@/shell.jsx';
import { useTriageData } from '@/data.jsx';

function waitingLabel(value) {
  if (!value) return '—';
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The attention queue: WhatsApp conversations where the customer is waiting on a
 * reply — oldest-waiting first, so the most overdue is on top. The AI handles most
 * chats; this surfaces the ones a human should look at. A row opens the customer.
 */
const TriageScreen = () => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { data, loading } = useTriageData();
  const conversations = data?.conversations || [];
  const total = data?.total || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <RegionHead
        title={t`Atención`}
        note={
          loading ? (
            <Trans>Cargando…</Trans>
          ) : (
            <Plural
              value={total}
              one="# cliente espera respuesta."
              other="# clientes esperan respuesta."
            />
          )
        }
        count={{ value: formatNumber(total), label: t`en espera` }}
      />

      <div className="log-list">
        {conversations.length === 0 && !loading && (
          <div
            className="card"
            style={{ padding: '42px 28px', textAlign: 'center', color: 'var(--ink-3)' }}
          >
            <I.Check size={30} style={{ opacity: 0.35, marginBottom: 10 }} />
            <div style={{ fontWeight: 600 }}>
              <Trans>Nadie espera respuesta. Umi está al día.</Trans>
            </div>
          </div>
        )}
        {conversations.map((conversation) => (
          <button
            type="button"
            className="log-row triage-row focusable"
            key={conversation.id}
            onClick={() =>
              navigate('/customers/' + encodeURIComponent(conversation.customerId || ''))
            }
          >
            <span className="t">{waitingLabel(conversation.waitingSince)}</span>
            <span className="marker warn" aria-hidden="true">
              <I.WhatsApp size={13} />
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
                {conversation.lastMessage || conversation.summary || t`Sin resumen`}
              </div>
            </div>
            <span className="badge badge-trial">
              <Trans>Espera</Trans>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default TriageScreen;
