/**
 * Realtime channel names: Socket.IO namespaces, event names, and room builders.
 *
 * ZERO-DEP ON PURPOSE. `realtime.ts` also declares the zod payload schemas, and the
 * dashboard consumed those names through the package root — which re-exports every
 * schema and pulls zod into the browser build. Vercel installs the dashboard with
 * `npm install` in the app directory, where zod is not present, so the production
 * build failed with "Rollup failed to resolve import zod". The names live here, and
 * the browser imports this entry. `realtime.ts` re-exports them, so the API and the
 * package root keep the same surface. A test guards that this file stays zod-free.
 */

/** The Socket.IO namespace that carries every realtime channel. */
export const REALTIME_NAMESPACE = '/rt';

/**
 * The pairing nudge. It says only that the pairing state moved; the device then
 * calls the poll route once to collect the credential. The credential never
 * travels on a socket: `pollPairing` is the single delivery gate, because it is
 * the transition that stamps `credential_delivered_at` and releases the plaintext.
 */
export const REALTIME_EVENT_PAIRING_CHANGED = 'device.pairing.changed';

/** Room name that scopes a nudge to one pairing session. */
export function pairingRoom(pairingSessionId: string): string {
  return `pairing:${pairingSessionId}`;
}

/** The Socket.IO namespace for the owner dashboard realtime channel. */
export const DASHBOARD_REALTIME_NAMESPACE = '/rt/dashboard';

/**
 * The device list moved. It says only that the dashboard should re-read the
 * device list; the payload always travels over the REST route, and the socket
 * never carries it. Like the pairing nudge, the socket is a wake-up, not a
 * delivery gate.
 */
export const DASHBOARD_EVENT_DEVICES_CHANGED = 'dashboard.devices.changed';

/** Room name that scopes a dashboard nudge to one merchant. */
export function dashboardRoom(merchantId: string): string {
  return `dashboard:${merchantId}`;
}
