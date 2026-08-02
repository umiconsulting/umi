import { Injectable } from '@nestjs/common';
import { BusinessConfigService } from './business-config.service';
import { BusinessHoursService } from '../business-hours/business-hours.service';
import {
  activeWindowAt,
  timeToMinutes,
  windowsOn,
  type HoursInterval,
  type OpenHours,
} from '../business-hours/open-hours';
import { canonicalizePhone } from '../business-hours/ordering-settings.repository';

/**
 * The WhatsApp channel's ORDERING WINDOW — when this channel takes an order, which is
 * narrower than when the doors are open. A thin consumer of `modules/business-hours`,
 * which owns the hours themselves.
 *
 * The two are separate on purpose, and the industry agrees: Google Business Profile
 * carries per-service hours in `moreHours` beside `regularHours`, Toast serves online
 * ordering from a separate `/orderingSchedule`, schema.org hangs `hoursAvailable` off
 * the Service rather than the Place, and DoorDash derives ordering hours by subtracting
 * a fixed buffer from store close. Ours is that buffer: `orderCutoffMinutes` off the
 * close, plus the pause switch and the bypass list. Keeping it here is what stops
 * `open_hours` from growing a nesting level for every channel we add.
 *
 * It does not evaluate the document itself. `business-hours/open-hours.ts` owns "is it
 * open", so the bot, the register and the dashboard cannot drift apart on what a missing
 * day, a split shift, a holiday or a window past midnight means. There are no hardcoded
 * café defaults: an unset day is unknown and therefore CLOSED.
 *
 * Timezone math uses `Intl.DateTimeFormat.formatToParts` (DST-correct).
 */

export const ORDER_CUTOFF_BUFFER_MINUTES = 30;

// dow 0=Sun..6=Sat, matching open-hours DAY_KEYS and getLocalTimeParts.
const WEEKDAY_LABELS: string[] = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function formatMinutes(minutes: number): string {
  // Wrap into the day: a window that runs past midnight is carried as 1560, and
  // "26:00pm" is not a time anyone recognizes.
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  const suffix = hours24 >= 12 ? 'pm' : 'am';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${mins.toString().padStart(2, '0')}${suffix}`;
}

function getLocalTimeParts(
  timezone: string,
  now = new Date(),
): { dayIndex: number; totalMinutes: number; localDate: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const hours = parseInt(parts.hour, 10) % 24;
  const minutes = parseInt(parts.minute, 10);
  return {
    dayIndex: WEEKDAY_INDEX[parts.weekday] ?? 0,
    totalMinutes: hours * 60 + minutes,
    // The local CALENDAR date, which is what a date exception is keyed by. Taking it
    // from the same formatToParts call as the weekday keeps the two in step across a
    // timezone or DST boundary.
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** `08:00 - 20:00`, or `08:00 - 14:00 y 17:00 - 22:00` for a split shift. */
function formatWindows(windows: HoursInterval[]): string {
  return windows
    .map(
      (w) =>
        `${formatMinutes(timeToMinutes(w.open) ?? 0)} - ${formatMinutes(timeToMinutes(w.close) ?? 0)}`,
    )
    .join(' y ');
}

/** Build the Spanish weekly-hours list in dow order (Sun..Sat). */
function buildWeeklyHours(hours: OpenHours): string[] {
  return WEEKDAY_LABELS.map((label, dow) => {
    const windows = windowsOn(hours, dow);
    if (!windows || windows.length === 0) return `${label}: cerrado`;
    return `${label}: ${formatWindows(windows)}`;
  });
}

export interface OrderingWindowResult {
  isOpen: boolean;
  isOpenToday: boolean;
  isAcceptingOrders: boolean;
  timezone: string;
  today: string;
  closeTime: string | null;
  orderCutoff: string | null;
  orderCutoffTime: string | null;
  storeClose: string | null;
  weeklyHours: string[];
  specialNotice: string | null;
  message: string;
}

@Injectable()
export class OrderingWindowService {
  constructor(
    private readonly hours: BusinessHoursService,
    private readonly businessConfig: BusinessConfigService,
  ) {}

  async getBusinessInfo(
    tenantId: string,
    locationId: string | null = null,
  ): Promise<{
    name: string;
    address: string | null;
    whatsapp: string | null;
    paymentMethods: string[];
    timezone: string;
    weeklyHours: string[];
    acceptsWhatsappOrders: boolean;
    specialNotice: string | null;
  }> {
    const [bot, row] = await Promise.all([
      this.hours.getEffectiveHoursForBot(tenantId, locationId),
      this.businessConfig.fetchConfigRow(tenantId),
    ]);
    const config = row?.config ?? {};

    return {
      name: row?.name ?? 'el café',
      address: config.address ?? null,
      whatsapp: config.whatsapp ?? null,
      paymentMethods: config.payment_methods ?? [],
      timezone: bot.timezone,
      weeklyHours: buildWeeklyHours(bot.hours),
      acceptsWhatsappOrders: bot.ordering.acceptsOrders,
      specialNotice: bot.ordering.specialNotice,
    };
  }

  async getOrderingWindow(
    tenantId: string,
    locationId: string | null = null,
    now = new Date(),
    phone?: string,
  ): Promise<OrderingWindowResult> {
    const [bot, row] = await Promise.all([
      this.hours.getEffectiveHoursForBot(tenantId, locationId),
      this.businessConfig.fetchConfigRow(tenantId),
    ]);
    const name = row?.name ?? 'El café';
    const tz = bot.timezone;
    const { dayIndex, totalMinutes, localDate } = getLocalTimeParts(tz, now);
    // Compare canonicalized, both sides. The list is stored `+<digits>` and an inbound
    // number arrives the same way; comparing raw would silently never match, and a
    // bypass that never fires produces no error for anyone to notice.
    const phoneIsBypassed = phone
      ? bot.ordering.bypassPhones.includes(canonicalizePhone(phone))
      : false;
    const specialNotice = bot.ordering.specialNotice;
    const weeklyHours = buildWeeklyHours(bot.hours);

    const todaysWindows = windowsOn(bot.hours, dayIndex, localDate) ?? [];
    // The window in progress — which may be one that opened YESTERDAY and has not
    // closed. `isOpen` follows it, so a café serving at 00:30 is open at 00:30.
    const active = activeWindowAt(bot.hours, dayIndex, totalMinutes, localDate);

    if (todaysWindows.length === 0 && !active) {
      return {
        isOpen: false,
        isOpenToday: false,
        isAcceptingOrders: phoneIsBypassed,
        timezone: tz,
        today: `${WEEKDAY_LABELS[dayIndex]}: cerrado`,
        closeTime: null,
        orderCutoff: null,
        orderCutoffTime: null,
        storeClose: null,
        weeklyHours,
        specialNotice,
        message: `${name} está cerrado hoy.`,
      };
    }

    // The narrative window: the one in progress, else today's last — which is what
    // "el local cierra a las X" means to someone asking before opening time.
    const lastToday = todaysWindows[todaysWindows.length - 1];
    const narrative =
      active ??
      (lastToday
        ? {
            openMinutes: timeToMinutes(lastToday.open) ?? 0,
            closeMinutes: timeToMinutes(lastToday.close) ?? 0,
          }
        : { openMinutes: 0, closeMinutes: 0 });
    const openMinutes = narrative.openMinutes;
    const closeMinutes = narrative.closeMinutes;
    const buffer = bot.ordering.orderCutoffMinutes ?? ORDER_CUTOFF_BUFFER_MINUTES;
    const orderCutoffMinutes = closeMinutes - buffer;
    const isAcceptingOrders =
      phoneIsBypassed || (totalMinutes >= openMinutes && totalMinutes < orderCutoffMinutes);

    return {
      isOpen: active !== null,
      isOpenToday: todaysWindows.length > 0,
      isAcceptingOrders,
      timezone: tz,
      today: `${WEEKDAY_LABELS[dayIndex]}: ${formatMinutes(openMinutes)} - ${formatMinutes(closeMinutes)}`,
      closeTime: formatMinutes(closeMinutes),
      orderCutoff: formatMinutes(orderCutoffMinutes),
      orderCutoffTime: formatMinutes(orderCutoffMinutes),
      storeClose: formatMinutes(closeMinutes),
      weeklyHours,
      specialNotice,
      message: isAcceptingOrders
        ? `${name} recibe pedidos por WhatsApp hoy hasta las ${formatMinutes(orderCutoffMinutes)}. El local cierra a las ${formatMinutes(closeMinutes)}.`
        : `${name} ya cerró pedidos por WhatsApp hoy. El corte fue a las ${formatMinutes(orderCutoffMinutes)} y el local cierra a las ${formatMinutes(closeMinutes)}.`,
    };
  }

  async isWithinOrderHours(
    tenantId: string,
    locationId: string | null = null,
    now = new Date(),
    phone?: string,
  ): Promise<boolean> {
    const hours = await this.getOrderingWindow(tenantId, locationId, now, phone);
    return hours.isAcceptingOrders;
  }

  /** The pause flag (accepts_whatsapp_orders) — independent of the hours window. */
  async checkOrderingEnabled(
    tenantId: string,
  ): Promise<{ enabled: boolean; disabledMessage: string | null }> {
    const bot = await this.hours.getEffectiveHoursForBot(tenantId, null);
    if (!bot.ordering.acceptsOrders) {
      return {
        enabled: false,
        disabledMessage:
          'Los pedidos por WhatsApp están temporalmente pausados. Para más información comunícate directamente con el café.',
      };
    }
    return { enabled: true, disabledMessage: null };
  }

  async getOrdersClosedMessage(
    tenantId: string,
    locationId: string | null = null,
  ): Promise<string> {
    const hours = await this.getOrderingWindow(tenantId, locationId);
    if (!hours.isOpenToday) {
      return 'Estamos fuera del horario del local por hoy. Escríbenos mañana y con gusto te ayudamos.';
    }
    if (!hours.orderCutoff || !hours.storeClose) {
      return 'Estamos fuera del horario de pedidos por WhatsApp. Los pedidos se cierran 30 minutos antes del cierre del local.';
    }
    return `Estamos fuera del horario de pedidos por WhatsApp hoy. Los pedidos cerraron a las ${hours.orderCutoff}. El local sigue abierto hasta las ${hours.storeClose} si quieres pasar directamente.`;
  }
}
