import { Injectable } from '@nestjs/common';
import { TenantsRepository } from '../tenants/tenants.repository';
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
  | { kind: 'needs_selection'; branches: LocationRef[] }
  | { kind: 'none' };

/**
 * The single domain policy that answers "which branch is this order for?".
 *
 * Behavior is a pure function of tenant/channel/conversation DATA — there is no
 * rollout flag. A single-branch café can never reach the selection path; a
 * multi-branch one always does. Precedence:
 *
 *   1. ByChannel   — the inbound WhatsApp number is bound to a branch
 *                    (`tenant.whatsapp_number.branch_id`, surfaced as the turn's
 *                    location). Defined but dormant today (tenants use one number);
 *                    when a tenant adopts per-branch numbers it works with no code
 *                    change.
 *   2. BySole      — the tenant has exactly one active branch.
 *   3. BySelection — multi-branch, and the customer already chose (durable
 *                    `runtime.conversation_state.selected_location_id`).
 *   4. NeedsSel    — multi-branch, no valid choice yet → ask once.
 *   5. None        — the tenant has no active branch (degenerate/misconfigured).
 *
 * This replaces the scattered active-location count checks and the
 * `BRANCH_RESOLUTION_ENABLED` flag: the write path, the prompt path, and the
 * `set_branch` tool all read the same policy.
 */
@Injectable()
export class OrderLocationResolver {
  constructor(
    private readonly tenants: TenantsRepository,
    private readonly conversations: ConversationsRepository,
  ) {}

  async resolve(params: {
    tenantId: string;
    conversationId: string;
    channelLocationId: string | null;
  }): Promise<OrderLocation> {
    const locations = await this.tenants.listActiveLocationsWorker(params.tenantId);
    if (locations.length === 0) return { kind: 'none' };

    // 1. ByChannel — the number is bound to a (valid, active) branch.
    if (params.channelLocationId) {
      const bound = locations.find((l) => l.id === params.channelLocationId);
      if (bound) {
        return { kind: 'resolved', locationId: bound.id, source: 'channel', name: bound.name };
      }
    }

    // 2. BySole — a single-branch tenant has nothing to choose.
    if (locations.length === 1) {
      const only = locations[0];
      return { kind: 'resolved', locationId: only.id, source: 'sole', name: only.name };
    }

    // 3. BySelection — multi-branch, the customer already chose.
    const selectedId = await this.conversations.getSelectedLocationWorker(
      params.conversationId,
    );
    if (selectedId) {
      const chosen = locations.find((l) => l.id === selectedId);
      if (chosen) {
        return { kind: 'resolved', locationId: chosen.id, source: 'selection', name: chosen.name };
      }
    }

    // 4. NeedsSelection — multi-branch, ask once.
    return { kind: 'needs_selection', branches: locations };
  }
}
