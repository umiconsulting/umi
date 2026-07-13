import { Injectable } from '@nestjs/common';
import { BusinessConfigService } from './business-config.service';
import { HoursService, type BotDayWindow } from '../hours/hours.service';

/**
 * Business hours + ordering-window logic for the WhatsApp bot. This is now a
 * THIN consumer of the canonical source (HoursService): weekly hours from
 * `tenant.open_hours`, timezone from `tenant.business.timezone`, and ordering
 * scalars (accepts/cutoff/notice/bypass) from `tenant.business.config` — the SAME
 * data the dashboard Hours screen writes. There are no hardcoded café defaults:
 * a day with no row / is_closed / null times is CLOSED (fail-closed), and the
 * order-cutoff buffer is tenant-configurable (the dashboard slider), with 30 as
 * the last-resort default only. Contact info (name/address/whatsapp/payment)
 * still comes from BusinessConfigService — a different concern from hours.
 *
 * Timezone math uses `Intl.DateTimeFormat.formatToParts` (DST-correct).
 */

export const ORDER_CUTOFF_BUFFER_MINUTES = 30;

// dow 0=Sun..6=Sat, matching tenant.open_hours.day_of_week and getLocalTimeParts.
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
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours24 >= 12 ? 'pm' : 'am';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${mins.toString().padStart(2, '0')}${suffix}`;
}

function getLocalTimeParts(
  timezone: string,
  now = new Date(),
): { dayIndex: number; totalMinutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
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
  };
}

/** Build the Spanish weekly-hours list in dow order (Sun..Sat). */
function buildWeeklyHours(days: BotDayWindow[]): string[] {
  const byDow = new Map(days.map((d) => [d.dow, d]));
  return WEEKDAY_LABELS.map((label, dow) => {
    const d = byDow.get(dow);
    if (!d || d.isClosed || d.openMinutes === null || d.closeMinutes === null) {
      return `${label}: cerrado`;
    }
    return `${label}: ${formatMinutes(d.openMinutes)} - ${formatMinutes(d.closeMinutes)}`;
  });
}

export interface BusinessHoursResult {
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
export class BusinessHoursService {
  constructor(
    private readonly hours: HoursService,
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
      weeklyHours: buildWeeklyHours(bot.days),
      acceptsWhatsappOrders: bot.ordering.acceptsOrders,
      specialNotice: bot.ordering.specialNotice,
    };
  }

  async getBusinessHours(
    tenantId: string,
    locationId: string | null = null,
    now = new Date(),
    phone?: string,
  ): Promise<BusinessHoursResult> {
    const [bot, row] = await Promise.all([
      this.hours.getEffectiveHoursForBot(tenantId, locationId),
      this.businessConfig.fetchConfigRow(tenantId),
    ]);
    const name = row?.name ?? 'El café';
    const tz = bot.timezone;
    const { dayIndex, totalMinutes } = getLocalTimeParts(tz, now);
    const phoneIsBypassed = phone
      ? bot.ordering.bypassPhones.includes(phone)
      : false;
    const specialNotice = bot.ordering.specialNotice;
    const weeklyHours = buildWeeklyHours(bot.days);

    const day = bot.days.find((d) => d.dow === dayIndex);
    const closedToday =
      !day || day.isClosed || day.openMinutes === null || day.closeMinutes === null;

    if (closedToday) {
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

    const openMinutes = day!.openMinutes!;
    const closeMinutes = day!.closeMinutes!;
    const buffer = bot.ordering.orderCutoffMinutes ?? ORDER_CUTOFF_BUFFER_MINUTES;
    const orderCutoffMinutes = closeMinutes - buffer;
    const isAcceptingOrders =
      phoneIsBypassed ||
      (totalMinutes >= openMinutes && totalMinutes < orderCutoffMinutes);

    return {
      isOpen: totalMinutes >= openMinutes && totalMinutes < closeMinutes,
      isOpenToday: true,
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
    const hours = await this.getBusinessHours(tenantId, locationId, now, phone);
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
    const hours = await this.getBusinessHours(tenantId, locationId);
    if (!hours.isOpenToday) {
      return 'Estamos fuera del horario del local por hoy. Escríbenos mañana y con gusto te ayudamos.';
    }
    if (!hours.orderCutoff || !hours.storeClose) {
      return 'Estamos fuera del horario de pedidos por WhatsApp. Los pedidos se cierran 30 minutos antes del cierre del local.';
    }
    return `Estamos fuera del horario de pedidos por WhatsApp hoy. Los pedidos cerraron a las ${hours.orderCutoff}. El local sigue abierto hasta las ${hours.storeClose} si quieres pasar directamente.`;
  }
}
