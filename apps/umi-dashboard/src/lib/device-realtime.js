import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
// The zero-dep entry, never the package root: the root re-exports the zod schemas,
// and the Vercel build of this app has no zod (see packages/contract/src/index.ts).
import {
  DASHBOARD_EVENT_DEVICES_CHANGED,
  DASHBOARD_REALTIME_NAMESPACE,
} from '@umi/contract/realtime-channels';
import { apiUrl } from './config.js';

export const REALTIME_STATE = Object.freeze({
  CONNECTING: 'connecting',
  LIVE: 'live',
  POLLING: 'polling', // the socket is down; the screen runs on the 10 s REST poll
});

/**
 * The devices realtime socket. It is a wake-up channel, not a delivery gate: the
 * backend says only "the device list moved" and the caller re-reads the list
 * over REST. The payload never travels on the socket.
 *
 * Returns one of REALTIME_STATE. On any connection failure the socket logs the
 * error LOUDLY and the screen falls back to the 10 s REST poll. `onChanged`
 * fires on each wake-up so the caller can refresh the list immediately.
 */
export function useDevicesRealtime({ merchantId, enabled, onChanged }) {
  const [status, setStatus] = useState(() =>
    enabled && merchantId ? REALTIME_STATE.CONNECTING : REALTIME_STATE.POLLING,
  );
  const onChangedRef = useRef(onChanged);

  useEffect(
    function () {
      onChangedRef.current = onChanged;
    },
    [onChanged],
  );

  useEffect(
    function () {
      if (!enabled || !merchantId) return undefined;

      const base = apiUrl('') || window.location.origin;
      const url = base + DASHBOARD_REALTIME_NAMESPACE;

      const socket = io(url, {
        withCredentials: true,
        transports: ['websocket'],
        auth: { merchantId },
        reconnectionAttempts: 5,
        timeout: 8_000,
      });

      socket.on('connect', function () {
        setStatus(REALTIME_STATE.LIVE);
      });

      socket.on(DASHBOARD_EVENT_DEVICES_CHANGED, function () {
        if (onChangedRef.current) onChangedRef.current();
      });

      socket.on('connect_error', function (err) {
        // FAIL LOUDLY: the live channel is down, so the screen runs on the fallback poll.
        console.error('[devices] realtime connection failed — falling back to 10 s REST poll', err);
        setStatus(REALTIME_STATE.POLLING);
      });

      socket.on('disconnect', function (reason) {
        if (reason === 'io client disconnect') return; // deliberate close; ignore
        console.error('[devices] realtime disconnected — falling back to 10 s REST poll', reason);
        setStatus(REALTIME_STATE.POLLING);
      });

      return function () {
        socket.disconnect();
      };
    },
    [enabled, merchantId],
  );

  return enabled && merchantId ? status : REALTIME_STATE.POLLING;
}
