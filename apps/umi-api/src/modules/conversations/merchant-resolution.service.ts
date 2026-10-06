import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { ChannelRepository } from './channel.repository';

export interface ResolvedMerchant {
  merchantId: string;
  locationId: string | null;
  /** Null when resolved via the DEFAULT_MERCHANT_ID fallback (no channel account). */
  channelAccountId: string | null;
  source: 'channel_account' | 'default';
}

/**
 * Resolves the merchant for an inbound WhatsApp message from the Twilio `To` field
 * (the merchant's own WhatsApp number). This replaces ConversaFlow's module-load
 * `MERCHANT_ID` global (single-merchant) with per-request resolution (owner decision,
 * 2026-06-25): `merchant.whatsapp_number.provider_account_id` → merchant.
 *
 * Fallback: when no channel account matches and `DEFAULT_MERCHANT_ID` is configured,
 * resolve to it (keeps the single live merchant working before its number is seeded
 * in channel_accounts). With no fallback and no match, returns null and the caller
 * drops the message.
 */
@Injectable()
export class MerchantResolutionService {
  private readonly logger = new Logger(MerchantResolutionService.name);
  private readonly defaultMerchantId?: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly channels: ChannelRepository,
  ) {
    this.defaultMerchantId = config.get('DEFAULT_MERCHANT_ID', { infer: true });
  }

  /**
   * @param toAddress the raw Twilio `To` value, e.g. `whatsapp:+14155238886`.
   */
  async resolveInboundMerchant(toAddress: string): Promise<ResolvedMerchant | null> {
    const bare = normalizeAddress(toAddress);
    // An empty/whitespace `To` is never a valid merchant number — drop it
    // rather than letting it fall through to the DEFAULT_MERCHANT_ID catch-all
    // (which would mis-route junk into the live merchant).
    if (!bare) {
      this.logger.error('inbound WhatsApp message with empty To — dropping');
      return null;
    }
    const prefixed = `whatsapp:${bare}`;

    const account = await this.channels.findWhatsappAccount(bare, prefixed);
    if (account) {
      return {
        merchantId: account.merchantId,
        locationId: account.locationId,
        channelAccountId: account.channelAccountId,
        source: 'channel_account',
      };
    }

    if (this.defaultMerchantId) {
      this.logger.warn(
        `no channel_account for inbound number "${bare}"; falling back to DEFAULT_MERCHANT_ID`,
      );
      return {
        merchantId: this.defaultMerchantId,
        locationId: null,
        channelAccountId: null,
        source: 'default',
      };
    }

    this.logger.error(
      `unresolved inbound WhatsApp number "${bare}" and no DEFAULT_MERCHANT_ID set — dropping`,
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
  return raw
    .trim()
    .replace(/^whatsapp:/i, '')
    .trim();
}
