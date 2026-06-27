import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * Per-business voice + operating config. Ported from `_shared/business-config.ts`
 * and rebound to the canonical `ops.businesses` row (`config` jsonb), per the
 * preflight §3 — legacy `businesses.config.voice` is the same shape. Read on the
 * worker pool: the WhatsApp path is unauthenticated (no member user → no RLS
 * tenant context), and every query carries an explicit `tenant_id` predicate.
 *
 * `requireVoiceConfig` throws PER REQUEST (preflight §7): one tenant missing its
 * voice config must never 500 the shared process — the caller catches and drops
 * just that turn.
 */

export interface VoiceConfig {
  assistant_name: string;
  locale: string;
  tone: string;
  style_notes?: string[];
}

export interface BusinessConfig {
  address?: string;
  whatsapp?: string;
  payment_methods?: string[];
  timezone?: string;
  accepts_whatsapp_orders?: boolean;
  special_notice?: string | null;
  order_cutoff_time?: string | null;
  hours?: Record<string, { open?: string; close?: string; closed?: boolean }>;
  bypass_phones?: string[];
  voice?: Partial<VoiceConfig> | null;
}

export interface BusinessConfigRow {
  id: string;
  name: string | null;
  config: BusinessConfig | null;
}

export function normalizeVoiceConfig(
  config: Partial<VoiceConfig> | null | undefined,
): VoiceConfig | null {
  if (!config) return null;

  const assistantName =
    typeof config.assistant_name === 'string' ? config.assistant_name.trim() : '';
  const locale = typeof config.locale === 'string' ? config.locale.trim() : '';
  const tone = typeof config.tone === 'string' ? config.tone.trim() : '';
  const styleNotes = Array.isArray(config.style_notes)
    ? config.style_notes.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : [];

  if (!assistantName || !locale || !tone) return null;

  return {
    assistant_name: assistantName,
    locale,
    tone,
    style_notes: styleNotes.length > 0 ? styleNotes : undefined,
  };
}

export function requireVoiceConfig(
  config: BusinessConfig | null | undefined,
  tenantId: string,
): VoiceConfig {
  const voice = normalizeVoiceConfig(config?.voice);
  if (!voice) {
    throw new Error(`Missing businesses.config.voice for tenant ${tenantId}`);
  }
  return voice;
}

@Injectable()
export class BusinessConfigService {
  constructor(private readonly pg: PgService) {}

  /**
   * Load the tenant's business config row (the single business per tenant in the
   * current model). Returns null when the tenant has no `ops.businesses` row.
   */
  async fetchConfigRow(tenantId: string): Promise<BusinessConfigRow | null> {
    const { rows } = await this.pg.query<{
      id: string;
      name: string | null;
      config: BusinessConfig | null;
    }>(
      `SELECT id::text, name, config
         FROM ops.businesses
        WHERE tenant_id = $1
        ORDER BY created_at ASC
        LIMIT 1`,
      [tenantId],
    );
    return rows[0] ?? null;
  }
}
