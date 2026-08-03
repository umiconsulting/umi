import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { parseOpenHours, type OpenHours } from './open-hours';

/**
 * Reads and writes `open_hours`, resolving the location override.
 *
 * WHAT CHANGED FROM THE ROW TABLE. This used to read `merchant.open_hours`, one row per
 * `(merchant, location, day_of_week)` — a mechanical rename of the live
 * `ops.business_hours`. build-v3 makes hours an attribute instead: a jsonb column on
 * `merchant.merchant`, overridden per location by `merchant.location.open_hours` where NULL
 * means inherit. See `open-hours.ts` for the shape and why.
 *
 * WHERE A WRITE LANDS. Not simply "the location the dashboard sent" — the Hours screen
 * always sends one, because `resolveLocationId` fills in the default location when the
 * user has not picked any. Writing the location unconditionally would therefore create
 * an override on the very first save at every café, and `merchant.open_hours` would
 * never be written again. So the rule is **write where the value already lives**: the
 * location when it has an override, the merchant otherwise. A location starts sharing the
 * café's hours and diverges only when something deliberately makes it diverge.
 */

export interface EffectiveHours {
  hours: OpenHours;
  /** Which level the document came from — the dashboard shows this, the bot ignores it. */
  level: 'location' | 'merchant';
}

interface HoursRow {
  open_hours: unknown;
  from_location: boolean;
}

/**
 * `LEFT JOIN` on the location, so a NULL/absent/foreign `locationId` yields the merchant
 * document rather than no row. `from_location` is what makes the two indistinguishable
 * jsonb values ("the location overrides with X" vs "the location inherits X") tell apart.
 */
const EFFECTIVE_SQL = `
  SELECT COALESCE(br.open_hours, b.open_hours) AS open_hours,
         (br.open_hours IS NOT NULL)           AS from_location
    FROM merchant.merchant b
    LEFT JOIN merchant.location br
           ON br.merchant_id = b.id
          AND br.id = $2::uuid
   WHERE b.id = $1::uuid`;

function toEffective(row: HoursRow | undefined): EffectiveHours {
  return {
    hours: parseOpenHours(row?.open_hours ?? null),
    level: row?.from_location ? 'location' : 'merchant',
  };
}

@Injectable()
export class BusinessHoursRepository {
  constructor(private readonly pg: PgService) {}

  /** RLS app-pool read (dashboard). */
  async read(merchantId: string, locationId: string | null): Promise<EffectiveHours> {
    const rows = await this.pg.withMerchant((c) =>
      c.query<HoursRow>(EFFECTIVE_SQL, [merchantId, locationId]).then((r) => r.rows),
    );
    return toEffective(rows[0]);
  }

  /**
   * Worker-pool (BYPASSRLS) read, for the unauthenticated WhatsApp bot — it has no
   * member user, so it cannot satisfy RLS. Isolation is the explicit `b.id = $1`
   * predicate, which is also what scopes the joined location.
   */
  async readWorker(merchantId: string, locationId: string | null): Promise<EffectiveHours> {
    const { rows } = await this.pg.query<HoursRow>(EFFECTIVE_SQL, [merchantId, locationId]);
    return toEffective(rows[0]);
  }

  /**
   * Persist the whole document where it already lives (see the class comment). One
   * transaction, so the "did the location own it" test and the write cannot disagree.
   */
  async write(merchantId: string, locationId: string | null, hours: OpenHours): Promise<void> {
    const doc = JSON.stringify(hours);
    await this.pg.withMerchant(async (c) => {
      if (locationId) {
        const res = await c.query(
          `UPDATE merchant.location
              SET open_hours = $3::jsonb, updated_at = now()
            WHERE merchant_id = $1::uuid
              AND id = $2::uuid
              AND open_hours IS NOT NULL`,
          [merchantId, locationId, doc],
        );
        if ((res.rowCount ?? 0) > 0) return;
      }
      await c.query(
        `UPDATE merchant.merchant
            SET open_hours = $2::jsonb, updated_at = now()
          WHERE id = $1::uuid`,
        [merchantId, doc],
      );
    });
  }

  /**
   * Make a location keep its own hours, or give them up. This is the only way an
   * override is created or removed, and it is deliberately separate from `write` — a
   * routine save must never change WHICH café-or-location it is saving.
   *
   * Passing `null` drops the override and the location inherits again.
   */
  async setLocationOverride(
    merchantId: string,
    locationId: string,
    hours: OpenHours | null,
  ): Promise<boolean> {
    const res = await this.pg.withMerchant((c) =>
      c.query(
        `UPDATE merchant.location
            SET open_hours = $3::jsonb, updated_at = now()
          WHERE merchant_id = $1::uuid AND id = $2::uuid`,
        [merchantId, locationId, hours === null ? null : JSON.stringify(hours)],
      ),
    );
    return (res.rowCount ?? 0) > 0;
  }
}
