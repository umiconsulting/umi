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

/**
 * A conversation gained a message. It carries only which conversation moved; the
 * dashboard re-reads the thread tail over REST. Like the device nudge, the socket
 * is a wake-up, not a delivery gate — the message body never rides it.
 */
export const DASHBOARD_EVENT_CONVERSATION_MESSAGE = 'dashboard.conversation.message';

/** Room name that scopes a dashboard nudge to one merchant. */
export function dashboardRoom(merchantId: string): string {
  return `dashboard:${merchantId}`;
}

/**
 * A tender attempt at a card terminal moved. It carries IDS ONLY — the amount, the
 * provider's own status and the proof are read from the attempt over REST, so the
 * socket can never disagree with the row. The till follows the attempt by
 * `commandIdentity`, which is the identity its own capture used (plan D5 and §4
 * Phase 3 step 3), and the dashboard room is the room a merchant's surfaces already
 * join. The terminal's answer arrives in its own time, up to forty seconds after the
 * customer was asked, which is the whole reason a nudge exists here.
 *
 * IT GOES TO TWO ROOMS, AND THE SECOND ONE IS THE TILL'S. `dashboardRoom` is where a
 * merchant's browser surfaces listen; `deviceRoom` is where the paired tills listen, and
 * until that room existed the till learned the terminal's answer only by asking at
 * `queryAfterSeconds` — the vendor's own forty-second window, which is why §5's "under 2 s
 * after the notification" budget measured nothing (plan §11.4 item 2).
 */
export const REALTIME_EVENT_TENDER_ATTEMPT_CHANGED = 'tender.attempt.changed';

/**
 * Room name that scopes a nudge to ONE MERCHANT'S PAIRED DEVICES — the tills at the counter.
 *
 * WHY IT IS A ROOM OF ITS OWN rather than the dashboard's: a dashboard session and a paired
 * register are different principals with different credentials, and a room both can join is a
 * room whose membership says nothing. The device joins it by proving its DEVICE CREDENTIAL
 * (`DevicesService.authenticate`, the same check its REST calls pass), and the room key is the
 * merchant that credential resolved to — so a till cannot ask for another café's counter.
 */
export function deviceRoom(merchantId: string): string {
  return `device:${merchantId}`;
}
