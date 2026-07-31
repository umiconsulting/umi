import { BadRequestException, Injectable } from '@nestjs/common';
import { BusinessHoursRepository } from './business-hours.repository';
import {
  OrderingSettingsRepository,
  type OrderingSettings,
  type OrderingPatch,
} from './ordering-settings.repository';
import { MerchantsRepository } from '../merchants/merchants.repository';
import { DAY_KEYS, fromGrid, toGrid, type HoursGrid, type OpenHours } from './open-hours';

/**
 * Business hours — the SINGLE source every consumer reads: the dashboard Hours screen,
 * the WhatsApp bot (through `conversations/ordering-window.service`), and the register.
 * Weekly hours come from `merchant.merchant.open_hours` with the `merchant.location.open_hours`
 * override (BusinessHoursRepository), the timezone from `merchant.merchant.timezone`
 * (MerchantsRepository), and the per-channel ordering knobs from the typed
 * `merchant.whatsapp_*` columns (OrderingSettingsRepository). Nothing here is
 * café-specific or hardcoded.
 *
 * `business_hours` is Square's name for the field (`Location.business_hours`). The column
 * stays `open_hours` because `merchant.business_hours` would stutter, and `open-hours.ts`
 * is named for the column it serializes.
 *
 * We take the NAME from Square, not the PLACEMENT — see `20_merchant.sql` for why the
 * document sits on the merchant with a location override, which is not what Square, Google,
 * Toast or DoorDash do.
 */

const DEFAULT_TZ = 'America/Mexico_City';

export type { HoursGrid as HoursMap };

export interface UpdateAllInput {
  hours?: HoursGrid;
  timezone?: string;
  ordering?: OrderingPatch;
}

/** Everything the WhatsApp bot needs to decide open/closed + ordering window. */
export interface BotHours {
  timezone: string;
  /**
   * The document, not a flattened per-day summary. The bot evaluates it with
   * `open-hours.ts` — the same functions the register uses — so a split shift or a
   * window past midnight cannot mean one thing here and another there.
   */
  hours: OpenHours;
  ordering: OrderingSettings;
}

/**
 * What the Hours screen shows for a day the café has never configured. A SUGGESTION
 * for a form, and deliberately not what any consumer sees: the bot gets the raw
 * document, where an unset day is unknown and therefore closed.
 */
function suggestedGrid(): HoursGrid {
  const out: HoursGrid = {};
  for (const key of DAY_KEYS) out[key] = { open: true, from: '08:00', to: '20:00' };
  return out;
}

@Injectable()
export class BusinessHoursService {
  constructor(
    private readonly repo: BusinessHoursRepository,
    private readonly ordering: OrderingSettingsRepository,
    private readonly merchants: MerchantsRepository,
  ) {}

  /** Dashboard GET: weekly grid + timezone + ordering settings. */
  async getHours(
    merchantId: string,
    locationId: string | null,
    merchantTimezone: string | null,
  ): Promise<{
    hours: HoursGrid;
    timezone: string;
    merchantId: string;
    ordering: OrderingSettings;
    /** Whether this location keeps its own hours or inherits the café's. */
    hoursLevel: 'location' | 'merchant';
  }> {
    const [effective, ordering] = await Promise.all([
      this.repo.read(merchantId, locationId),
      this.ordering.read(merchantId),
    ]);
    return {
      hours: { ...suggestedGrid(), ...toGrid(effective.hours) },
      timezone: merchantTimezone || DEFAULT_TZ,
      merchantId,
      ordering,
      hoursLevel: effective.level,
    };
  }

  /** Weekly-hours-only write (kept for back-compat callers). */
  async updateHours(merchantId: string, locationId: string | null, hours: unknown): Promise<void> {
    await this.writeHours(merchantId, locationId, hours);
  }

  /**
   * Dashboard PATCH: persist any combination of weekly hours, timezone, and ordering
   * settings through their canonical homes.
   *
   * CONTRACT: the three blocks are INDEPENDENT and each is idempotent. This is a
   * settings form, not a money path — full cross-repo atomicity would mean threading
   * one transaction through three repositories that do not share a pool. If a later
   * block fails the earlier ones stay saved; the caller surfaces the error and the
   * user re-saves, which is a no-op for whatever already landed.
   */
  async updateAll(
    merchantId: string,
    locationId: string | null,
    input: UpdateAllInput,
  ): Promise<void> {
    if (input.hours !== undefined) {
      await this.writeHours(merchantId, locationId, input.hours);
    }
    if (input.timezone) {
      // Reuse the existing merchant-settings writer (merchant.merchant.timezone) — DRY.
      await this.merchants.updateMerchantSettings(merchantId, { timezone: input.timezone });
    }
    if (input.ordering !== undefined) {
      await this.ordering.updateOrdering(merchantId, input.ordering);
    }
  }

  private async writeHours(
    merchantId: string,
    locationId: string | null,
    hours: unknown,
  ): Promise<void> {
    if (!hours || typeof hours !== 'object') {
      throw new BadRequestException('hours required');
    }
    // Read-modify-write, because the grid is a LOSSY view of the document: it shows
    // one window per day and no exceptions. `fromGrid` folds the submitted days onto
    // what is stored, so a partial save leaves untouched days alone and a full save
    // still cannot delete a holiday closure or the evening half of a split shift.
    const existing = await this.repo.read(merchantId, locationId);
    const next = fromGrid(hours as HoursGrid, existing.hours);
    await this.repo.write(merchantId, locationId, next);
  }

  /**
   * Bot path (worker pool, unauthenticated). Resolves the SAME location the dashboard
   * writes to, then returns the effective document + timezone + ordering settings.
   * No café default: a café that has set nothing reads as having no windows, and every
   * consumer treats that as closed.
   */
  async getEffectiveHoursForBot(
    merchantId: string,
    requestedLocationId: string | null,
  ): Promise<BotHours> {
    const locationId = await this.merchants.resolveLocationIdWorker(
      merchantId,
      requestedLocationId,
    );
    const [effective, ordering, tz] = await Promise.all([
      this.repo.readWorker(merchantId, locationId),
      this.ordering.readWorker(merchantId),
      this.merchants.getMerchantTimezoneWorker(merchantId),
    ]);
    return { timezone: tz || DEFAULT_TZ, hours: effective.hours, ordering };
  }
}
