import { BadRequestException, Injectable } from '@nestjs/common';
import { HoursRepository, type DayInput } from './hours.repository';
import {
  OrderingSettingsRepository,
  type OrderingSettings,
  type OrderingPatch,
} from './ordering-settings.repository';
import { TenantsRepository } from '../tenants/tenants.repository';

/**
 * Business hours + ordering-window settings — the SINGLE source of truth shared
 * by the dashboard Hours screen and the WhatsApp bot. Weekly hours live in
 * `tenant.open_hours` (HoursRepository), timezone in `tenant.business.timezone`
 * (TenantsRepository), ordering scalars in `tenant.business.config`
 * (OrderingSettingsRepository). Nothing here is café-specific or hardcoded.
 */

const DAY_NUM_TO_ID: Record<string, string> = {
  '0': 'sun',
  '1': 'mon',
  '2': 'tue',
  '3': 'wed',
  '4': 'thu',
  '5': 'fri',
  '6': 'sat',
};
const DAY_ID_TO_NUM: Record<string, string> = {
  sun: '0',
  mon: '1',
  tue: '2',
  wed: '3',
  thu: '4',
  fri: '5',
  sat: '6',
};

const DEFAULT_TZ = 'America/Mexico_City';

export interface DayHours {
  open: boolean;
  from: string;
  to: string;
}
export type HoursMap = Record<string, DayHours>;

export interface UpdateAllInput {
  hours?: HoursMap;
  timezone?: string;
  ordering?: OrderingPatch;
}

/** Per-day window for the bot, sourced from tenant.open_hours (dow 0=Sun..6=Sat). */
export interface BotDayWindow {
  dow: number;
  isClosed: boolean;
  openMinutes: number | null;
  closeMinutes: number | null;
}

/** Everything the WhatsApp bot needs to decide open/closed + ordering window. */
export interface BotHours {
  timezone: string;
  days: BotDayWindow[];
  ordering: OrderingSettings;
}

function defaultHours(): HoursMap {
  const out: HoursMap = {};
  for (const id of Object.values(DAY_NUM_TO_ID)) {
    out[id] = { open: true, from: '08:00', to: '20:00' };
  }
  return out;
}

/** 'HH:MM[:SS]' → minutes since midnight, or null if unparseable. */
function timeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

@Injectable()
export class HoursService {
  constructor(
    private readonly repo: HoursRepository,
    private readonly ordering: OrderingSettingsRepository,
    private readonly tenants: TenantsRepository,
  ) {}

  /** Dashboard GET: weekly grid + timezone + ordering settings. */
  async getHours(
    tenantId: string,
    locationId: string | null,
    tenantTimezone: string | null,
  ): Promise<{
    hours: HoursMap;
    timezone: string;
    businessId: string;
    ordering: OrderingSettings;
  }> {
    const [rows, ordering] = await Promise.all([
      this.repo.read(tenantId, locationId),
      this.ordering.read(tenantId),
    ]);
    const hours = defaultHours();
    for (const r of rows) {
      const id = DAY_NUM_TO_ID[String(r.day_of_week)];
      if (!id) continue;
      hours[id] = r.is_closed
        ? { open: false, from: '00:00', to: '00:00' }
        : {
            open: true,
            from: (r.opens_at || '08:00').slice(0, 5),
            to: (r.closes_at || '20:00').slice(0, 5),
          };
    }
    return {
      hours,
      timezone: tenantTimezone || DEFAULT_TZ,
      businessId: tenantId,
      ordering,
    };
  }

  /** Weekly-hours-only write (kept for back-compat callers). */
  async updateHours(tenantId: string, locationId: string | null, hours: unknown): Promise<void> {
    await this.writeHours(tenantId, locationId, hours);
  }

  /**
   * Dashboard PATCH: persist any combination of weekly hours, timezone, and
   * ordering settings through their single canonical homes.
   *
   * CONTRACT: the three blocks are INDEPENDENT and each is idempotent. This is a
   * settings form, not a money path — full cross-repo atomicity would require
   * threading one transaction through HoursRepository (RLS pool),
   * TenantsRepository, and OrderingSettingsRepository, which they don't share. If
   * a later block fails the earlier ones stay saved; the caller surfaces the error
   * and the user re-saves (a no-op for the already-persisted blocks).
   */
  async updateAll(
    tenantId: string,
    locationId: string | null,
    input: UpdateAllInput,
  ): Promise<void> {
    if (input.hours !== undefined) {
      await this.writeHours(tenantId, locationId, input.hours);
    }
    if (input.timezone) {
      // Reuse the existing tenant-settings writer (tenant.business.timezone) — DRY.
      await this.tenants.updateTenantSettings(tenantId, {
        timezone: input.timezone,
      });
    }
    if (input.ordering !== undefined) {
      await this.ordering.updateOrdering(tenantId, input.ordering);
    }
  }

  private async writeHours(
    tenantId: string,
    locationId: string | null,
    hours: unknown,
  ): Promise<void> {
    if (!hours || typeof hours !== 'object') {
      throw new BadRequestException('hours required');
    }
    const submitted = hours as Record<string, DayHours>;

    // repo.replace() rewrites the WHOLE week, so a partial payload (e.g. just
    // {mon}) would wipe the untouched days. Merge the submitted days onto the
    // existing schedule first; days neither submitted nor previously set stay
    // absent (no invented default windows).
    const merged: HoursMap = {};
    for (const r of await this.repo.read(tenantId, locationId)) {
      const id = DAY_NUM_TO_ID[String(r.day_of_week)];
      if (!id) continue;
      merged[id] = r.is_closed
        ? { open: false, from: '00:00', to: '00:00' }
        : {
            open: true,
            from: (r.opens_at || '08:00').slice(0, 5),
            to: (r.closes_at || '20:00').slice(0, 5),
          };
    }
    for (const [id, raw] of Object.entries(submitted)) {
      if (DAY_ID_TO_NUM[id] === undefined || !raw) continue;
      merged[id] = raw;
    }

    const days: DayInput[] = Object.entries(merged).map(([id, h]) => ({
      dow: parseInt(DAY_ID_TO_NUM[id], 10),
      opens: h.open ? h.from || '08:00' : '00:00',
      closes: h.open ? h.to || '20:00' : '00:00',
      isClosed: !h.open,
    }));
    await this.repo.replace(tenantId, locationId, days);
  }

  /**
   * Bot path (worker pool, unauthenticated). Resolves the SAME effective location
   * the dashboard writes to, then returns the canonical weekly windows + timezone
   * + ordering settings. No café default — a tenant with no rows reads as having
   * no windows (the consumer fails closed).
   */
  async getEffectiveHoursForBot(
    tenantId: string,
    requestedLocationId: string | null,
  ): Promise<BotHours> {
    const locationId = await this.tenants.resolveLocationIdWorker(tenantId, requestedLocationId);
    const [rows, ordering, tz] = await Promise.all([
      this.repo.readWorker(tenantId, locationId),
      this.ordering.readWorker(tenantId),
      this.tenants.getTenantTimezoneWorker(tenantId),
    ]);

    const days: BotDayWindow[] = rows.map((r) => {
      const openMinutes = timeToMinutes(r.opens_at);
      const closeMinutes = timeToMinutes(r.closes_at);
      return {
        dow: r.day_of_week,
        // Fail closed when flagged closed OR the times are missing/unparseable.
        isClosed: r.is_closed || openMinutes === null || closeMinutes === null,
        openMinutes,
        closeMinutes,
      };
    });

    return { timezone: tz || DEFAULT_TZ, days, ordering };
  }
}
