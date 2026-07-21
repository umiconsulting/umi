import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * Per-business voice + operating config. Ported from `_shared/business-config.ts`
 * and rebound to the `tenant.business` row (`config` jsonb) — legacy
 * `businesses.config.voice` is the same shape. Read on the
 * worker pool: the WhatsApp path is unauthenticated (no member user → no RLS
 * tenant context), and every query carries an explicit `business_id` predicate.
 *
 * `resolveVoiceConfig` NEVER throws: it fills sane defaults (assistant name from
 * the business name, locale `es-MX`, tone from the tenant's preset or a friendly
 * default) so a tenant that has not configured a voice can no longer dead-letter
 * a turn. Tone is tenant-configurable via `tone_preset` (the dashboard chips) with
 * a freeform `tone` advanced override; see TONE_PRESETS.
 */

/** The resolved/strict voice shape consumed by prompts.ts (always fully populated). */
export interface VoiceConfig {
  assistant_name: string;
  locale: string;
  tone: string;
  style_notes?: string[];
}

export type TonePreset = 'casual' | 'friendly' | 'formal';

/** Single source of truth for tone presets — consumed by BOTH the engine
 *  (resolveVoiceConfig → prompts.ts) and the dashboard voice GET (chip labels). */
export const TONE_PRESETS: Record<TonePreset, { label: string; tone: string }> = {
  casual: {
    label: 'Casual',
    tone: 'Relajado y cercano: tutea al cliente, usa lenguaje cotidiano y ligero, frases cortas y algún emoji ocasional cuando venga al caso. Evita sonar acartonado.',
  },
  friendly: {
    label: 'Amigable',
    tone: 'Cálido y servicial: tutea al cliente con amabilidad, muestra entusiasmo genuino por ayudar y mantén un trato humano y positivo sin exagerar.',
  },
  formal: {
    label: 'Formal',
    tone: 'Cortés y profesional: trata al cliente de usted, usa lenguaje pulido y respetuoso, sin modismos ni emojis, manteniendo cercanía y claridad.',
  },
};

export const TONE_PRESET_KEYS = Object.keys(TONE_PRESETS) as TonePreset[];
export const DEFAULT_TONE_PRESET: TonePreset = 'friendly';
export const DEFAULT_LOCALE = 'es-MX';
export const DEFAULT_ASSISTANT_NAME = 'Asistente';

/** Defensive LENGTH caps for tenant-controlled voice text read on the worker
 *  path, where legacy / hand-seeded rows bypass the DTO's MaxLength bounds.
 *  These bound length only (not content): voice is first-party config a tenant
 *  sets for their OWN assistant, so it is not a cross-tenant injection boundary
 *  (unlike sanitizeCustomerFacts, which also content-filters). */
const MAX_ASSISTANT_NAME_CHARS = 60;
const MAX_LOCALE_CHARS = 20;
const MAX_TONE_CHARS = 280;
const MAX_STYLE_NOTES = 8;
const MAX_STYLE_NOTE_CHARS = 200;

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
  voice?: (Partial<VoiceConfig> & { tone_preset?: TonePreset }) | null;
}

export interface BusinessConfigRow {
  id: string;
  name: string | null;
  config: BusinessConfig | null;
}

/**
 * Resolve the tone TEXT fed to the LLM. Precedence:
 *   1. explicit freeform `tone` (advanced override; ALSO the legacy {tone} shape)
 *   2. `tone_preset` → its Spanish guidance
 *   3. friendly default
 * Backward-compatible: a hand-seeded {assistant_name, locale, tone} row keeps its
 * freeform tone verbatim (case 1).
 */
function resolveToneText(
  voice: (Partial<VoiceConfig> & { tone_preset?: unknown }) | null | undefined,
): string {
  const freeform = typeof voice?.tone === 'string' ? voice.tone.trim() : '';
  if (freeform) return freeform.slice(0, MAX_TONE_CHARS);
  const key =
    typeof voice?.tone_preset === 'string' ? (voice.tone_preset.trim() as TonePreset) : undefined;
  if (key && TONE_PRESETS[key]) return TONE_PRESETS[key].tone;
  return TONE_PRESETS[DEFAULT_TONE_PRESET].tone;
}

/**
 * Never-throw voice resolver (replaces the old `requireVoiceConfig`). Always
 * returns a VoiceConfig with NON-EMPTY assistant_name/locale/tone so prompts.ts
 * never interpolates `undefined`. A tenant with no voice config can no longer
 * dead-letter a turn.
 */
export function resolveVoiceConfig(
  config: BusinessConfig | null | undefined,
  businessName: string | null | undefined,
  _tenantId: string, // kept for call-site symmetry/future logging; never used to throw
): VoiceConfig {
  const voice = (config?.voice ?? null) as
    (Partial<VoiceConfig> & { tone_preset?: unknown }) | null;

  // Cap to the same bounds as UpdateVoiceDto (assistant_name 60, locale 20) so a
  // long business name or hand-seeded legacy row resolves to a value that still
  // round-trips cleanly back through the dashboard PATCH validator.
  const assistant_name = (
    (typeof voice?.assistant_name === 'string' && voice.assistant_name.trim()) ||
    (typeof businessName === 'string' && businessName.trim()) ||
    DEFAULT_ASSISTANT_NAME
  ).slice(0, MAX_ASSISTANT_NAME_CHARS);

  const locale = (
    (typeof voice?.locale === 'string' && voice.locale.trim()) ||
    DEFAULT_LOCALE
  ).slice(0, MAX_LOCALE_CHARS);

  const tone = resolveToneText(voice);

  const style_notes = Array.isArray(voice?.style_notes)
    ? voice.style_notes
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .slice(0, MAX_STYLE_NOTES)
        .map((s) => s.slice(0, MAX_STYLE_NOTE_CHARS))
    : [];

  return {
    assistant_name,
    locale,
    tone,
    style_notes: style_notes.length > 0 ? style_notes : undefined,
  };
}

@Injectable()
export class BusinessConfigService {
  constructor(private readonly pg: PgService) {}

  /**
   * Load the tenant's business config row (the single business per tenant in the
   * current model). Returns null when the tenant has no `tenant.business` row.
   */
  async fetchConfigRow(tenantId: string): Promise<BusinessConfigRow | null> {
    const { rows } = await this.pg.query<{
      id: string;
      name: string | null;
      config: BusinessConfig | null;
    }>(
      `SELECT id::text, name, config
         FROM tenant.business
        WHERE business_id = $1
        ORDER BY created_at ASC
        LIMIT 1`,
      [tenantId],
    );
    return rows[0] ?? null;
  }
}
