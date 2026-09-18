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
  DASHBOARD_EVENT_CONVERSATION_MESSAGE,
  dashboardRoom,
  deviceRoom,
  REALTIME_EVENT_TENDER_ATTEMPT_CHANGED,
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

export const DashboardConversationMessageEvent = z
  .object({
    merchantId: Uuid,
    conversationId: Uuid,
  })
  .strict();
export type DashboardConversationMessageEvent = z.infer<typeof DashboardConversationMessageEvent>;

/**
 * A tender attempt resolved at the terminal. Ids only, by the same rule as its
 * neighbours: the till re-reads the attempt over REST (`pos.tenderAttempt`) with the
 * command identity it captured under, so the socket is a wake-up rather than a second
 * source of truth about money.
 */
export const TenderAttemptChangedEvent = z
  .object({
    merchantId: Uuid,
    attemptId: Uuid,
    commandIdentity: Uuid.nullable(),
    cartId: Uuid,
  })
  .strict();
export type TenderAttemptChangedEvent = z.infer<typeof TenderAttemptChangedEvent>;

export const realtimeModels = {
  DevicePairingRealtimeEvent,
  DashboardDevicesChangedEvent,
  DashboardConversationMessageEvent,
  TenderAttemptChangedEvent,
} as const;
