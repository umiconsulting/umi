import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { parseOpenHours, type OpenHours } from './open-hours';

/**
 * Reads and writes `open_hours`, resolving the branch override.
 *
 * WHAT CHANGED FROM THE ROW TABLE. This used to read `tenant.open_hours`, one row per
 * `(business, branch, day_of_week)` — a mechanical rename of the live
 * `ops.business_hours`. build-v3 makes hours an attribute instead: a jsonb column on
 * `tenant.business`, overridden per branch by `tenant.branch.open_hours` where NULL
 * means inherit. See `open-hours.ts` for the shape and why.
 *
 * WHERE A WRITE LANDS. Not simply "the branch the dashboard sent" — the Hours screen
 * always sends one, because `resolveLocationId` fills in the default branch when the
 * user has not picked any. Writing the branch unconditionally would therefore create
 * an override on the very first save at every café, and `business.open_hours` would
 * never be written again. So the rule is **write where the value already lives**: the
 * branch when it has an override, the business otherwise. A branch starts sharing the
 * café's hours and diverges only when something deliberately makes it diverge.
 */

export interface EffectiveHours {
  hours: OpenHours;
  /** Which level the document came from — the dashboard shows this, the bot ignores it. */
  level: 'branch' | 'business';
}

interface HoursRow {
  open_hours: unknown;
  from_branch: boolean;
}

/**
 * `LEFT JOIN` on the branch, so a NULL/absent/foreign `branchId` yields the business
 * document rather than no row. `from_branch` is what makes the two indistinguishable
 * jsonb values ("the branch overrides with X" vs "the branch inherits X") tell apart.
 */
const EFFECTIVE_SQL = `
  SELECT COALESCE(br.open_hours, b.open_hours) AS open_hours,
         (br.open_hours IS NOT NULL)           AS from_branch
    FROM tenant.business b
    LEFT JOIN tenant.branch br
           ON br.business_id = b.id
          AND br.id = $2::uuid
   WHERE b.id = $1::uuid`;

function toEffective(row: HoursRow | undefined): EffectiveHours {
  return {
    hours: parseOpenHours(row?.open_hours ?? null),
    level: row?.from_branch ? 'branch' : 'business',
  };
}

@Injectable()
export class BusinessHoursRepository {
  constructor(private readonly pg: PgService) {}

  /** RLS app-pool read (dashboard). */
  async read(businessId: string, branchId: string | null): Promise<EffectiveHours> {
    const rows = await this.pg.withTenant((c) =>
      c.query<HoursRow>(EFFECTIVE_SQL, [businessId, branchId]).then((r) => r.rows),
    );
    return toEffective(rows[0]);
  }

  /**
   * Worker-pool (BYPASSRLS) read, for the unauthenticated WhatsApp bot — it has no
   * member user, so it cannot satisfy RLS. Isolation is the explicit `b.id = $1`
   * predicate, which is also what scopes the joined branch.
   */
  async readWorker(businessId: string, branchId: string | null): Promise<EffectiveHours> {
    const { rows } = await this.pg.query<HoursRow>(EFFECTIVE_SQL, [businessId, branchId]);
    return toEffective(rows[0]);
  }

  /**
   * Persist the whole document where it already lives (see the class comment). One
   * transaction, so the "did the branch own it" test and the write cannot disagree.
   */
  async write(businessId: string, branchId: string | null, hours: OpenHours): Promise<void> {
    const doc = JSON.stringify(hours);
    await this.pg.withTenant(async (c) => {
      if (branchId) {
        const res = await c.query(
          `UPDATE tenant.branch
              SET open_hours = $3::jsonb, updated_at = now()
            WHERE business_id = $1::uuid
              AND id = $2::uuid
              AND open_hours IS NOT NULL`,
          [businessId, branchId, doc],
        );
        if ((res.rowCount ?? 0) > 0) return;
      }
      await c.query(
        `UPDATE tenant.business
            SET open_hours = $2::jsonb, updated_at = now()
          WHERE id = $1::uuid`,
        [businessId, doc],
      );
    });
  }

  /**
   * Make a branch keep its own hours, or give them up. This is the only way an
   * override is created or removed, and it is deliberately separate from `write` — a
   * routine save must never change WHICH café-or-branch it is saving.
   *
   * Passing `null` drops the override and the branch inherits again.
   */
  async setBranchOverride(
    businessId: string,
    branchId: string,
    hours: OpenHours | null,
  ): Promise<boolean> {
    const res = await this.pg.withTenant((c) =>
      c.query(
        `UPDATE tenant.branch
            SET open_hours = $3::jsonb, updated_at = now()
          WHERE business_id = $1::uuid AND id = $2::uuid`,
        [businessId, branchId, hours === null ? null : JSON.stringify(hours)],
      ),
    );
    return (res.rowCount ?? 0) > 0;
  }
}
