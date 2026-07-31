import { Injectable } from '@nestjs/common';
import { MerchantsRepository } from '../merchants/merchants.repository';
import { ConversationsRepository } from './conversations.repository';

export interface LocationRef {
  id: string;
  name: string;
}

/**
 * Where a WhatsApp order is fulfilled. A discriminated result, not a bare id, so
 * every caller must handle "the customer still has to choose".
 */
export type OrderLocation =
  | {
      kind: 'resolved';
      locationId: string;
      source: 'channel' | 'sole' | 'selection';
      name: string;
    }
  | { kind: 'needs_selection'; locations: LocationRef[] }
  | { kind: 'none' };

/**
 * The single domain policy that answers "which location is this order for?".
 *
 * Behavior is a pure function of merchant/channel/conversation DATA — there is no
 * rollout flag. A single-location café can never reach the selection path; a
 * multi-location one always does. Precedence:
 *
 *   1. ByChannel   — the inbound WhatsApp number is bound to a location
 *                    (`merchant.whatsapp_number.location_id`, surfaced as the turn's
 *                    location). Defined but dormant today (merchants use one number);
 *                    when a merchant adopts per-location numbers it works with no code
 *                    change.
 *   2. BySole      — the merchant has exactly one active location.
 *   3. BySelection — multi-location, and the customer already chose (durable
 *                    `runtime.conversation_state.selected_location_id`).
 *   4. NeedsSel    — multi-location, no valid choice yet → ask once.
 *   5. None        — the merchant has no active location (degenerate/misconfigured).
 *
 * This replaces the scattered active-location count checks and the
 * `LOCATION_RESOLUTION_ENABLED` flag: the write path, the prompt path, and the
 * `set_location` tool all read the same policy.
 */
@Injectable()
export class OrderLocationResolver {
  constructor(
    private readonly merchants: MerchantsRepository,
    private readonly conversations: ConversationsRepository,
  ) {}

  async resolve(params: {
    merchantId: string;
    conversationId: string;
    channelLocationId: string | null;
  }): Promise<OrderLocation> {
    const locations = await this.merchants.listActiveLocationsWorker(params.merchantId);
    if (locations.length === 0) return { kind: 'none' };

    // 1. ByChannel — the number is bound to a (valid, active) location.
    if (params.channelLocationId) {
      const bound = locations.find((l) => l.id === params.channelLocationId);
      if (bound) {
        return { kind: 'resolved', locationId: bound.id, source: 'channel', name: bound.name };
      }
    }

    // 2. BySole — a single-location merchant has nothing to choose.
    if (locations.length === 1) {
      const only = locations[0];
      return { kind: 'resolved', locationId: only.id, source: 'sole', name: only.name };
    }

    // 3. BySelection — multi-location, the customer already chose.
    const selectedId = await this.conversations.getSelectedLocationWorker(params.conversationId);
    if (selectedId) {
      const chosen = locations.find((l) => l.id === selectedId);
      if (chosen) {
        return { kind: 'resolved', locationId: chosen.id, source: 'selection', name: chosen.name };
      }
    }

    // 4. NeedsSelection — multi-location, ask once.
    return { kind: 'needs_selection', locations: locations };
  }
}
