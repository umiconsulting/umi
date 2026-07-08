import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { ChannelRepository } from './channel.repository';

export interface ResolvedTenant {
  tenantId: string;
  locationId: string | null;
  /** Null when resolved via the DEFAULT_TENANT_ID fallback (no channel account). */
  channelAccountId: string | null;
  source: 'channel_account' | 'default';
}

/**
 * Resolves the tenant for an inbound WhatsApp message from the Twilio `To` field
 * (the business's own WhatsApp number). This replaces ConversaFlow's module-load
 * `BUSINESS_ID` global (single-tenant) with per-request resolution (owner decision,
 * 2026-06-25): `tenant.whatsapp_number.provider_account_id` → tenant.
 *
 * Fallback: when no channel account matches and `DEFAULT_TENANT_ID` is configured,
 * resolve to it (keeps the single live tenant working before its number is seeded
 * in channel_accounts). With no fallback and no match, returns null and the caller
 * drops the message.
 */
@Injectable()
export class TenantResolutionService {
  private readonly logger = new Logger(TenantResolutionService.name);
  private readonly defaultTenantId?: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly channels: ChannelRepository,
  ) {
    this.defaultTenantId = config.get('DEFAULT_TENANT_ID', { infer: true });
  }

  /**
   * @param toAddress the raw Twilio `To` value, e.g. `whatsapp:+14155238886`.
   */
  async resolveInboundTenant(toAddress: string): Promise<ResolvedTenant | null> {
    const bare = normalizeAddress(toAddress);
    // An empty/whitespace `To` is never a valid business number — drop it
    // rather than letting it fall through to the DEFAULT_TENANT_ID catch-all
    // (which would mis-route junk into the live tenant).
    if (!bare) {
      this.logger.error('inbound WhatsApp message with empty To — dropping');
      return null;
    }
    const prefixed = `whatsapp:${bare}`;

    const account = await this.channels.findWhatsappAccount(bare, prefixed);
    if (account) {
      return {
        tenantId: account.tenantId,
        locationId: account.locationId,
        channelAccountId: account.channelAccountId,
        source: 'channel_account',
      };
    }

    if (this.defaultTenantId) {
      this.logger.warn(
        `no channel_account for inbound number "${bare}"; falling back to DEFAULT_TENANT_ID`,
      );
      return {
        tenantId: this.defaultTenantId,
        locationId: null,
        channelAccountId: null,
        source: 'default',
      };
    }

    this.logger.error(
      `unresolved inbound WhatsApp number "${bare}" and no DEFAULT_TENANT_ID set — dropping`,
    );
    return null;
  }
}

/**
 * Strip the Twilio channel prefix (`whatsapp:`) and surrounding whitespace, leaving
 * the bare address (normally `+E164`). Returns '' for empty/whitespace input.
 */
export function normalizeAddress(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^whatsapp:/i, '').trim();
}
