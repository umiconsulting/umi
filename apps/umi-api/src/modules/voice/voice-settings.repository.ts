import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/** The voice knobs stored as typed `merchant.merchant` columns. */
export interface StoredVoice {
  assistant_name?: string;
  tone_preset?: string;
}

/**
 * The single accessor for the merchant VOICE config, now the typed
 * `merchant.merchant.assistant_name` / `assistant_tone` columns (was the dissolved
 * `config.voice` jsonb). One merchant per merchant. Both the dashboard read and write
 * run on the RLS app pool (`withMerchant`): a voice save is an authenticated staff
 * action with a member user. The bot/worker path reads voice through
 * MerchantConfigService.fetchConfigRow, not this repo.
 */
@Injectable()
export class VoiceSettingsRepository {
  constructor(private readonly pg: PgService) {}

  /** RLS app-pool read (dashboard GET). Returns the stored voice knobs (or null)
   *  plus the merchant-name fallback for the assistant_name default. */
  async read(
    merchantId: string,
  ): Promise<{ businessName: string | null; voice: StoredVoice | null }> {
    const rows = await this.pg.withMerchant((c) =>
      c
        .query<{
          business_name: string | null;
          assistant_name: string | null;
          assistant_tone: string | null;
        }>(
          `SELECT name AS business_name, assistant_name, assistant_tone
             FROM merchant.merchant
            WHERE id = $1::uuid`,
          [merchantId],
        )
        .then((r) => r.rows),
    );
    const r = rows[0];
    if (!r) return { businessName: null, voice: null };
    const voice: StoredVoice = {};
    if (r.assistant_name != null) voice.assistant_name = r.assistant_name;
    if (r.assistant_tone != null) voice.tone_preset = r.assistant_tone;
    return {
      businessName: r.business_name ?? null,
      voice: Object.keys(voice).length > 0 ? voice : null,
    };
  }

  /**
   * Partial-update write into the typed columns. A key present in the patch is
   * written (a `null` clears it back to the default — merchant name / friendly
   * preset); a key absent is left untouched (static-CASE partial update, same idiom
   * as loyalty_program.updateProgram). The merchant row always exists (the
   * merchant root), so this is a plain UPDATE — no upsert.
   */
  async write(
    merchantId: string,
    patch: { assistant_name?: string | null; tone_preset?: string | null },
  ): Promise<void> {
    const hasName = 'assistant_name' in patch;
    const hasTone = 'tone_preset' in patch;
    await this.pg.withMerchant((c) =>
      c.query(
        `UPDATE merchant.merchant SET
           assistant_name = CASE WHEN $2 THEN $3 ELSE assistant_name END,
           assistant_tone = CASE WHEN $4 THEN $5 ELSE assistant_tone END,
           updated_at = now()
         WHERE id = $1::uuid`,
        [merchantId, hasName, patch.assistant_name ?? null, hasTone, patch.tone_preset ?? null],
      ),
    );
  }
}
