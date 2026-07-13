import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/** The voice sub-object as stored in `tenant.business.config.voice` (jsonb). */
export interface StoredVoice {
  assistant_name?: string;
  locale?: string;
  tone_preset?: string;
  tone?: string;
  style_notes?: string[];
}

/**
 * The single accessor for the tenant VOICE config that lives under
 * `tenant.business.config.voice` (one business per tenant). Sibling of
 * OrderingSettingsRepository — same nested-jsonb-merge upsert, but it writes
 * UNDER `config.voice` so the hours/ordering keys in `config` are untouched.
 *
 * Both the dashboard read and write run on the RLS app pool (`withTenant`): a
 * voice save is an authenticated staff action with a member user. The bot/worker
 * path reads voice through BusinessConfigService.fetchConfigRow, not this repo.
 */
@Injectable()
export class VoiceSettingsRepository {
  constructor(private readonly pg: PgService) {}

  /** RLS app-pool read (dashboard GET). Returns the stored voice sub-object (or
   *  null) plus the business-name fallback for the assistant_name default. */
  async read(
    tenantId: string,
  ): Promise<{ businessName: string | null; voice: StoredVoice | null }> {
    const rows = await this.pg.withTenant((c) =>
      c
        .query<{ business_name: string | null; voice: StoredVoice | null }>(
          `SELECT COALESCE(b.name, t.name) AS business_name,
                  b.config -> 'voice'      AS voice
             FROM tenant.business t
             LEFT JOIN LATERAL (
               SELECT name, config FROM tenant.business
                WHERE tenant_id = t.id ORDER BY created_at ASC LIMIT 1
             ) b ON true
            WHERE t.id = $1::uuid`,
          [tenantId],
        )
        .then((r) => r.rows),
    );
    return {
      businessName: rows[0]?.business_name ?? null,
      voice: rows[0]?.voice ?? null,
    };
  }

  /**
   * Nested merge-write into `tenant.business.config.voice`. Single atomic upsert on
   * the `businesses_tenant_id_key` UNIQUE(tenant_id) (same as
   * OrderingSettingsRepository) — no UPDATE-then-INSERT race. Creates the business
   * row with the tenant's real name when absent. The `||` jsonb operator shallow-
   * merges the patch into the existing `voice` object, so a `tone: null` in the
   * patch OVERWRITES a stale freeform override (the clear-override mechanism).
   */
  async write(
    tenantId: string,
    voicePatch: Record<string, unknown>,
  ): Promise<void> {
    const json = JSON.stringify(voicePatch);
    await this.pg.withTenant((c) =>
      c.query(
        `INSERT INTO tenant.business (tenant_id, name, config)
         VALUES ($1::uuid,
                 COALESCE((SELECT name FROM tenant.business WHERE id = $1::uuid), 'Negocio'),
                 jsonb_build_object('voice', $2::jsonb))
         ON CONFLICT (tenant_id) DO UPDATE
           SET config = jsonb_set(
                 COALESCE(tenant.business.config, '{}'::jsonb),
                 '{voice}',
                 COALESCE(tenant.business.config -> 'voice', '{}'::jsonb) || (EXCLUDED.config -> 'voice')
               ),
               updated_at = now()`,
        [tenantId, json],
      ),
    );
  }
}
