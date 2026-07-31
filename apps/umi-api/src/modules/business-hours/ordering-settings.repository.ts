import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * The ordering-window settings for the conversational channel — the four knobs the bot
 * needs beyond the weekly grid: pause/resume, the minutes-before-close cutoff, a notice,
 * and the numbers allowed to order outside the window.
 *
 * WHAT CHANGED. These were the last four keys of the n8n-era `config` blob on
 * `ops.businesses`, and build-v3 dissolves that blob into typed columns rather than
 * restoring it (CONVERSATION_MODEL.md §2c). They are now
 * `merchant.merchant.whatsapp_*`.
 *
 * The rename to build-v3 had left this file reading a table that no longer works that
 * way. It looked up `merchant.merchant WHERE merchant_id = $1 ORDER BY created_at LIMIT 1`
 * and upserted `ON CONFLICT (merchant_id)` — the shape of `ops.businesses`, which was a
 * CHILD of `core.tenants`, so a merchant could in principle have several and you took the
 * oldest. **In build-v3 the merchant IS the merchant**: `merchant.merchant.id` is the merchant
 * id, there is no `merchant_id` column on it, and there is exactly one row. So the
 * lookup, the ordering, the LIMIT and the create-if-missing upsert were all answering a
 * question that no longer exists. Reads and writes are now keyed on `id`.
 */

export interface OrderingSettings {
  acceptsOrders: boolean;
  /** Minutes-before-close buffer. Always present — the column is NOT NULL DEFAULT 30. */
  orderCutoffMinutes: number;
  specialNotice: string | null;
  bypassPhones: string[];
}

export interface OrderingPatch {
  acceptsOrders?: boolean;
  orderCutoffMinutes?: number;
  specialNotice?: string | null;
  bypassPhones?: string[];
}

interface SettingsRow {
  whatsapp_ordering_enabled: boolean;
  whatsapp_order_cutoff_minutes: number;
  whatsapp_ordering_notice: string | null;
  whatsapp_bypass_phone: string[] | null;
}

const SELECT_SQL = `
  SELECT whatsapp_ordering_enabled,
         whatsapp_order_cutoff_minutes,
         whatsapp_ordering_notice,
         whatsapp_bypass_phone
    FROM merchant.merchant
   WHERE id = $1::uuid`;

/** Mirrors the DDL defaults, for the "no such merchant" case only. */
const FALLBACK: OrderingSettings = {
  acceptsOrders: true,
  orderCutoffMinutes: 30,
  specialNotice: null,
  bypassPhones: [],
};

function toSettings(row: SettingsRow | undefined): OrderingSettings {
  if (!row) return { ...FALLBACK };
  return {
    acceptsOrders: row.whatsapp_ordering_enabled,
    orderCutoffMinutes: row.whatsapp_order_cutoff_minutes,
    specialNotice: row.whatsapp_ordering_notice,
    bypassPhones: Array.isArray(row.whatsapp_bypass_phone) ? row.whatsapp_bypass_phone : [],
  };
}

/**
 * `+` followed by digits, nothing else. An operator types `+52 667 312 4480` into the
 * dashboard; the number the bot compares it against arrives as `whatsapp:+526673124480`.
 * Stored any other way the list silently never matches, which is the worst possible
 * failure for a bypass — it fails OPEN-looking (nothing happens) and nobody reports it.
 *
 * This is deliberately a formatting strip, NOT country inference: it never adds a
 * dialling code. Real normalization (`normalize_phone`) is a P1 item and has a known
 * bug relabelling US numbers as +52; a bypass list must not inherit it.
 */
export function canonicalizePhone(raw: string): string {
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

@Injectable()
export class OrderingSettingsRepository {
  constructor(private readonly pg: PgService) {}

  /** Worker-pool read (bot path — unauthenticated, explicit merchant predicate). */
  async readWorker(merchantId: string): Promise<OrderingSettings> {
    const { rows } = await this.pg.query<SettingsRow>(SELECT_SQL, [merchantId]);
    return toSettings(rows[0]);
  }

  /** RLS app-pool read (dashboard GET). */
  async read(merchantId: string): Promise<OrderingSettings> {
    const rows = await this.pg.withMerchant((c) =>
      c.query<SettingsRow>(SELECT_SQL, [merchantId]).then((r) => r.rows),
    );
    return toSettings(rows[0]);
  }

  /**
   * Patch the settings the caller actually sent, in one statement.
   *
   * `COALESCE` carries an absent field through unchanged. The notice cannot use it —
   * clearing the notice means writing NULL, which COALESCE would read as "not sent" —
   * so a separate "was it provided" flag drives it.
   */
  async updateOrdering(merchantId: string, patch: OrderingPatch): Promise<void> {
    const noticeProvided = patch.specialNotice !== undefined;
    const phones =
      patch.bypassPhones === undefined
        ? null
        : patch.bypassPhones.map(canonicalizePhone).filter(Boolean);

    await this.pg.withMerchant((c) =>
      c.query(
        `UPDATE merchant.merchant
            SET whatsapp_ordering_enabled     = COALESCE($2::boolean, whatsapp_ordering_enabled),
                whatsapp_order_cutoff_minutes = COALESCE($3::integer, whatsapp_order_cutoff_minutes),
                whatsapp_ordering_notice      = CASE WHEN $4::boolean
                                                     THEN $5::text
                                                     ELSE whatsapp_ordering_notice END,
                whatsapp_bypass_phone         = COALESCE($6::text[], whatsapp_bypass_phone),
                updated_at = now()
          WHERE id = $1::uuid`,
        [
          merchantId,
          patch.acceptsOrders ?? null,
          patch.orderCutoffMinutes ?? null,
          noticeProvided,
          patch.specialNotice ?? null,
          phones,
        ],
      ),
    );
  }
}
