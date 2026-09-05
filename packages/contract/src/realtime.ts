import { z } from 'zod';
import { Uuid, IsoTimestamp } from './platform';
import { DevicePairingPollResponse } from './device';

// Channel names live in the zero-dep `realtime-channels` entry so the browser can
// import them without zod. Re-exported here to keep this module's surface whole.
export {
  REALTIME_NAMESPACE,
  REALTIME_EVENT_PAIRING_CHANGED,
  pairingRoom,
  DASHBOARD_REALTIME_NAMESPACE,
  DASHBOARD_EVENT_DEVICES_CHANGED,
  dashboardRoom,
} from './realtime-channels';

export const DevicePairingRealtimeEvent = z
  .object({
    pairingSessionId: Uuid,
    // Reuses the poll response enum object so the two can never drift apart.
    state: DevicePairingPollResponse.shape.state,
    occurredAt: IsoTimestamp,
  })
  .strict();
export type DevicePairingRealtimeEvent = z.infer<typeof DevicePairingRealtimeEvent>;

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
