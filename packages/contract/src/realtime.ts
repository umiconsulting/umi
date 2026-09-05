import { z } from 'zod';
import { Uuid, IsoTimestamp } from './platform';
import { DevicePairingPollResponse } from './device';

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

export const DevicePairingRealtimeEvent = z
  .object({
    pairingSessionId: Uuid,
    // Reuses the poll response enum object so the two can never drift apart.
    state: DevicePairingPollResponse.shape.state,
    occurredAt: IsoTimestamp,
  })
  .strict();
export type DevicePairingRealtimeEvent = z.infer<typeof DevicePairingRealtimeEvent>;

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

export const DashboardDevicesChangedEvent = z
  .object({
    merchantId: Uuid,
    locationId: Uuid.nullable().optional(),
    occurredAt: IsoTimestamp,
  })
  .strict();
export type DashboardDevicesChangedEvent = z.infer<typeof DashboardDevicesChangedEvent>;

export const realtimeModels = {
  DevicePairingRealtimeEvent,
  DashboardDevicesChangedEvent,
} as const;
