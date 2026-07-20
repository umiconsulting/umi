import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * The single accessor for the tenant ORDERING-WINDOW scalars that live in
 * `tenant.business.config` jsonb (one business per tenant). These are the
 * settings the WhatsApp bot needs beyond the weekly grid:
 *   - accepts_whatsapp_orders (pause/resume)
 *   - order_cutoff_minutes    (minutes-before-close buffer; the dashboard slider)
 *   - special_notice
 *   - bypass_phones
 *
 * Reads run on the worker pool (the bot is unauthenticated; explicit tenant
 * predicate). Writes run on the RLS app pool (dashboard, has a member user).
 * On write we also null out the LEGACY absolute `order_cutoff_time` so it can
 * never silently override the slider (KISS: one cutoff source of truth).
 */

export interface OrderingSettings {
  acceptsOrders: boolean;
  /** Minutes-before-close buffer; null → caller's default (30). */
  orderCutoffMinutes: number | null;
  specialNotice: string | null;
  bypassPhones: string[];
}

export interface OrderingPatch {
  acceptsOrders?: boolean;
  orderCutoffMinutes?: number;
  specialNotice?: string | null;
  bypassPhones?: string[];
}

interface RawConfig {
  accepts_whatsapp_orders?: boolean;
  order_cutoff_minutes?: number | null;
  special_notice?: string | null;
  bypass_phones?: string[];
}

function toSettings(config: RawConfig | null): OrderingSettings {
  return {
    acceptsOrders: config?.accepts_whatsapp_orders !== false, // default true
    orderCutoffMinutes:
      typeof config?.order_cutoff_minutes === 'number'
        ? config.order_cutoff_minutes
        : null,
    specialNotice: config?.special_notice ?? null,
    bypassPhones: Array.isArray(config?.bypass_phones) ? config.bypass_phones : [],
  };
}

@Injectable()
export class OrderingSettingsRepository {
  constructor(private readonly pg: PgService) {}

  /** Worker-pool read (bot path). */
  async readWorker(tenantId: string): Promise<OrderingSettings> {
    const { rows } = await this.pg.query<{ config: RawConfig | null }>(
      `SELECT config FROM tenant.business
        WHERE business_id = $1::uuid
        ORDER BY created_at ASC
        LIMIT 1`,
      [tenantId],
    );
    return toSettings(rows[0]?.config ?? null);
  }

  /** RLS app-pool read (dashboard GET). */
  async read(tenantId: string): Promise<OrderingSettings> {
    const rows = await this.pg.withTenant((c) =>
      c
        .query<{ config: RawConfig | null }>(
          `SELECT config FROM tenant.business
            WHERE business_id = $1::uuid
            ORDER BY created_at ASC
            LIMIT 1`,
          [tenantId],
        )
        .then((r) => r.rows),
    );
    return toSettings(rows[0]?.config ?? null);
  }

  /**
   * Merge-write the ordering scalars into `tenant.business.config` (shallow jsonb
   * merge). Single atomic upsert on the `businesses_business_id_key` UNIQUE(business_id)
   * — no UPDATE-then-INSERT race. If no business row exists yet, one is created
   * with the tenant's real name (never a blank), not a synthetic empty string.
   * Clears legacy `order_cutoff_time` whenever the buffer is set.
   */
  async updateOrdering(tenantId: string, patch: OrderingPatch): Promise<void> {
    const merge: Record<string, unknown> = {};
    if (patch.acceptsOrders !== undefined) {
      merge.accepts_whatsapp_orders = patch.acceptsOrders;
    }
    if (patch.orderCutoffMinutes !== undefined) {
      merge.order_cutoff_minutes = patch.orderCutoffMinutes;
      merge.order_cutoff_time = null; // kill the legacy absolute override
    }
    if (patch.specialNotice !== undefined) merge.special_notice = patch.specialNotice;
    if (patch.bypassPhones !== undefined) merge.bypass_phones = patch.bypassPhones;
    if (Object.keys(merge).length === 0) return;

    const mergeJson = JSON.stringify(merge);
    await this.pg.withTenant((c) =>
      c.query(
        `INSERT INTO tenant.business (business_id, name, config)
         VALUES ($1::uuid,
                 COALESCE((SELECT name FROM tenant.business WHERE id = $1::uuid), 'Negocio'),
                 $2::jsonb)
         ON CONFLICT (business_id) DO UPDATE
           SET config = COALESCE(tenant.business.config, '{}'::jsonb) || EXCLUDED.config,
               updated_at = now()`,
        [tenantId, mergeJson],
      ),
    );
  }
}
