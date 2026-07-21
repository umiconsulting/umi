import { Injectable } from '@nestjs/common';
import { IdentityResolver } from '../identity/identity.resolver';

/**
 * WhatsApp-ingress identity, thin adapter over the canonical {@link IdentityResolver}
 * (build-v2). The dropped `core.resolve_contact` SECURITY DEFINER RPC and the old
 * `core.people` / `core.contact_methods` reads are gone: resolution now writes the
 * federated graph `tenant.contact ← tenant.contact_identity`, `tenant.contact ←
 * tenant.customer` deterministically on the BYPASSRLS worker pool.
 *
 * The id this returns is the resolved `tenant.customer.id` — the value the turn
 * engine threads as `person_id` in job payloads (a customer id, not the legacy
 * `core.people.id`). Kept as a facade so the ingress/turn call sites stay put
 * while the graph moves underneath them.
 */
@Injectable()
export class IdentityRepository {
  constructor(private readonly resolver: IdentityResolver) {}

  /**
   * Resolve-or-create the customer for an inbound channel value.
   * @param kind channel key, e.g. `'whatsapp'` (dispatches `tenant.normalize_identity`).
   * @returns the `tenant.customer.id`, or null if resolution failed.
   */
  async resolveContact(params: {
    tenantId: string;
    kind: string;
    rawValue: string;
    displayName?: string | null;
  }): Promise<string | null> {
    const resolved = await this.resolver.resolveIdentity({
      tenantId: params.tenantId,
      channelKey: params.kind,
      rawValue: params.rawValue,
      displayName: params.displayName ?? null,
    });
    return resolved?.customerId ?? null;
  }

  /** Fetch a customer's display name (for prompt context). */
  async getPersonName(
    tenantId: string,
    customerId: string,
  ): Promise<string | null> {
    const ctx = await this.resolver.getReplyContext(tenantId, customerId);
    return ctx?.name ?? null;
  }

  /**
   * Customer display name + phones. `phone` is the canonical E.164 anchor
   * (`tenant.contact_identity.normalized_value`) used for identity/prompt.
   * `replyAddress` is the WhatsApp channel address AS RECEIVED
   * (`tenant.contact_identity.display_value`, channel 'whatsapp') — that, not the
   * normalized anchor, is what Twilio must reply to. Mexican mobiles arrive as
   * `+521…` (WhatsApp's extra `1`) but normalize to `+52…`; replying to the
   * normalized form fails Twilio **63015** ("number hasn't joined the sandbox").
   * Falls back to the canonical value when there is no WhatsApp reachability row.
   */
  async getPerson(
    tenantId: string,
    customerId: string,
  ): Promise<{
    displayName: string | null;
    phone: string | null;
    replyAddress: string | null;
  } | null> {
    const ctx = await this.resolver.getReplyContext(tenantId, customerId);
    if (!ctx) return null;
    return {
      displayName: ctx.name,
      phone: ctx.canonicalValue,
      replyAddress: ctx.replyAddress,
    };
  }
}
