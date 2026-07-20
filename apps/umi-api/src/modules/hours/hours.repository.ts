import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface BusinessHourRow {
  day_of_week: number;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: boolean;
}

export interface DayInput {
  dow: number;
  opens: string;
  closes: string;
  isClosed: boolean;
}

@Injectable()
export class HoursRepository {
  constructor(private readonly pg: PgService) {}

  /** Per-day rows for a tenant/location (branch_id may be NULL). */
  async read(
    tenantId: string,
    locationId: string | null,
  ): Promise<BusinessHourRow[]> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<BusinessHourRow>(
        `SELECT day_of_week, opens_at::text AS opens_at,
                closes_at::text AS closes_at, is_closed
         FROM tenant.open_hours
         WHERE business_id = $1::uuid
           AND branch_id IS NOT DISTINCT FROM $2::uuid`,
        [tenantId, locationId],
      ),
    );
    return rows;
  }

  /**
   * Worker-pool (BYPASSRLS) variant of read() — same query, for the
   * unauthenticated WhatsApp bot path (no member user → can't use withTenant).
   * Isolation is the explicit business_id predicate.
   */
  async readWorker(
    tenantId: string,
    locationId: string | null,
  ): Promise<BusinessHourRow[]> {
    const { rows } = await this.pg.query<BusinessHourRow>(
      `SELECT day_of_week, opens_at::text AS opens_at,
              closes_at::text AS closes_at, is_closed
       FROM tenant.open_hours
       WHERE business_id = $1::uuid
         AND branch_id IS NOT DISTINCT FROM $2::uuid`,
      [tenantId, locationId],
    );
    return rows;
  }

  /** Atomic replace: delete + reinsert the day rows in one transaction. */
  async replace(
    tenantId: string,
    locationId: string | null,
    days: DayInput[],
  ): Promise<void> {
    await this.pg.withTenant(async (c) => {
      await c.query(
        `DELETE FROM tenant.open_hours
         WHERE business_id = $1::uuid
           AND branch_id IS NOT DISTINCT FROM $2::uuid`,
        [tenantId, locationId],
      );
      for (const d of days) {
        await c.query(
          `INSERT INTO tenant.open_hours
             (business_id, branch_id, day_of_week, opens_at, closes_at, is_closed)
           VALUES ($1::uuid, $2::uuid, $3, $4::time, $5::time, $6)`,
          [tenantId, locationId, d.dow, d.opens, d.closes, d.isClosed],
        );
      }
    });
  }
}
