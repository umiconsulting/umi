import { Virtuoso } from 'react-virtuoso';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatDateTime } from '@/lib/format.js';
import { formatWhatsApp } from '@/lib/whatsapp-format.jsx';
import { useConversationMessages } from '@/data.jsx';

function senderLabel(sender, t) {
  if (sender === 'customer') return t`Cliente`;
  if (sender === 'bot') return 'Umi';
  if (sender === 'staff') return t`Equipo`;
  return t`Sistema`;
}

function bubbleTime(value) {
  if (!value) return '';
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MessageBubble({ message }) {
  const { t } = useLingui();
  // The customer is inbound (left); the bot/staff replies are outbound (right).
  // System notes read as a centered aside, not a bubble.
  if (message.sender === 'system') {
    return (
      <div className="msg-row system">
        <span className="msg-system">
          {message.body || '—'} · {bubbleTime(message.occurredAt)}
        </span>
      </div>
    );
  }
  const outbound = message.sender !== 'customer';
  return (
    <div className={'msg-row ' + (outbound ? 'out' : 'in')}>
      <div className={'msg-bubble sender-' + message.sender}>
        {message.body ? (
          <span className="msg-body">{formatWhatsApp(message.body)}</span>
        ) : (
          <span className="msg-body msg-empty">{t`(sin texto)`}</span>
        )}
        <span className="msg-meta">
          <span className="msg-sender">{senderLabel(message.sender, t)}</span>
          <time>{bubbleTime(message.occurredAt)}</time>
          {message.deliveryStatus && <span className="msg-status">{message.deliveryStatus}</span>}
        </span>
      </div>
    </div>
  );
}

function TranscriptHeader({ context }) {
  if (!context?.isFetchingOlder) return null;
  return (
    <div className="transcript-older">
      <Trans>Cargando mensajes anteriores…</Trans>
    </div>
  );
}

export default function CustomerTranscript({ customerId, conversationId }) {
  const { t } = useLingui();
  const {
    messages,
    firstItemIndex,
    fetchOlder,
    hasOlder,
    isFetchingOlder,
    isLoading,
    isError,
    error,
  } = useConversationMessages(customerId, conversationId);

  if (isLoading) {
    return (
      <div className="transcript-state">
        <span className="pulse" />
        <Trans>Cargando conversación…</Trans>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="transcript-state danger-state">
        <I.AlertTriangle size={22} />
        <span>{error?.message || t`No se pudo cargar la conversación.`}</span>
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <div className="transcript-state">
        <I.WhatsApp size={24} />
        <Trans>Sin mensajes en esta conversación.</Trans>
      </div>
    );
  }

  return (
    <div className="transcript">
      <Virtuoso
        style={{ height: '100%' }}
        data={messages}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={messages.length - 1}
        followOutput="auto"
        startReached={() => {
          if (hasOlder && !isFetchingOlder) fetchOlder();
        }}
        context={{ isFetchingOlder }}
        components={{ Header: TranscriptHeader }}
        itemContent={(_index, message) => <MessageBubble message={message} />}
      />
    </div>
  );
}
