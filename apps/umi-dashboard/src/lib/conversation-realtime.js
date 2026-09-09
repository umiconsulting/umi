import { io } from 'socket.io-client';
// The zero-dep entry, never the package root (the root pulls in zod, which this
// app's build does not have) — same rule as device-realtime.js.
import {
  DASHBOARD_EVENT_CONVERSATION_MESSAGE,
  DASHBOARD_REALTIME_NAMESPACE,
} from '@umi/contract/realtime-channels';
import { apiUrl } from './config.js';

/**
 * Subscribe to WhatsApp message nudges for ONE conversation. The socket is a
 * wake-up, not a delivery gate: on a matching nudge the caller re-reads the
 * thread tail over REST. Returns an unsubscribe function.
 *
 * Reuses the dashboard realtime namespace and the same cookie/JWT handshake the
 * device channel uses; the per-merchant room is joined server-side.
 */
export function subscribeConversationMessages({ merchantId, conversationId, onNudge }) {
  if (!merchantId || !conversationId) return () => {};

  const base = apiUrl('') || window.location.origin;
  const socket = io(base + DASHBOARD_REALTIME_NAMESPACE, {
    withCredentials: true,
    transports: ['websocket'],
    auth: { merchantId },
    reconnectionAttempts: 5,
    timeout: 8_000,
  });

  socket.on(DASHBOARD_EVENT_CONVERSATION_MESSAGE, (event) => {
    // The room is per-merchant, so filter down to the open conversation.
    if (event && event.conversationId === conversationId) onNudge();
  });

  socket.on('connect_error', (err) => {
    console.error('[transcript] realtime connection failed', err);
  });

  return () => socket.disconnect();
}
