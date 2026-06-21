import type { BusinessConfig } from '../_shared/business-config.ts'
import { fetchBusinessConfigRow } from '../_shared/business-config.ts'

export const BUSINESS_TIME_ZONE = 'America/Mazatlan'
export const ORDER_CUTOFF_BUFFER_MINUTES = 30

type WeekdayName = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'

interface LegacyHoursDay {
  closed?: boolean
  open?: string
  close?: string
}

interface BusinessRow {
  name?: string
  config?: BusinessConfig | null
}

interface BusinessHoursWindow {
  dayName: WeekdayName
  timezone: string
  openMinutes: number
  closeMinutes: number
}

const WEEKDAY_NAMES: WeekdayName[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

const WEEKDAY_LABELS: Record<WeekdayName, string> = {
  sunday: 'Domingo',
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
}

const DEFAULT_CONFIG: BusinessConfig = {
  timezone: BUSINESS_TIME_ZONE,
  accepts_whatsapp_orders: true,
  special_notice: null,
  order_cutoff_time: null,
  hours: {
    sunday: { closed: true },
    monday: { open: '07:00', close: '19:00' },
    tuesday: { open: '07:00', close: '19:00' },
    wednesday: { open: '07:00', close: '19:00' },
    thursday: { open: '07:00', close: '19:00' },
    friday: { open: '07:00', close: '19:00' },
    saturday: { open: '08:00', close: '14:00' },
  },
}

function formatMinutes(minutes: number): string {
  const hours24 = Math.floor(minutes / 60)
  const mins = minutes % 60
  const suffix = hours24 >= 12 ? 'pm' : 'am'
  const hours12 = hours24 % 12 || 12
  return `${hours12}:${mins.toString().padStart(2, '0')}${suffix}`
}

function parseTimeString(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return fallback

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) return fallback

  return hours * 60 + minutes
}

function getMergedConfig(config: BusinessConfig | null | undefined): BusinessConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    hours: {
      ...DEFAULT_CONFIG.hours,
      ...(config?.hours ?? {}),
    },
  }
}

async function getBusinessRow(supabase: any, businessId: string): Promise<BusinessRow> {
  const data = await fetchBusinessConfigRow(supabase, businessId)
  return (data as BusinessRow | null) ?? {}
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
}

// Uses Intl.DateTimeFormat.formatToParts — reads hours/minutes/weekday directly
// in the target timezone without constructing a fake local Date, which is unreliable
// in edge runtimes (UTC) and breaks around DST transitions.
function getLocalTimeParts(timezone: string, now = new Date()): { dayIndex: number; totalMinutes: number } {
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
  )
  // hour12:false returns '24' for midnight in some V8 versions — normalize
  const hours = parseInt(parts.hour, 10) % 24
  const minutes = parseInt(parts.minute, 10)
  return {
    dayIndex: WEEKDAY_INDEX[parts.weekday] ?? 0,
    totalMinutes: hours * 60 + minutes,
  }
}

function resolveBusinessHoursWindow(config: BusinessConfig, dayIndex: number): BusinessHoursWindow | null {
  const dayName = WEEKDAY_NAMES[dayIndex]
  const dayConfig = config.hours?.[dayName]
  if (!dayConfig || dayConfig.closed) return null

  const openMinutes = parseTimeString(dayConfig.open, 7 * 60)
  const closeMinutes = parseTimeString(dayConfig.close, 19 * 60)
  if (closeMinutes <= openMinutes) return null

  return {
    dayName,
    timezone: config.timezone || BUSINESS_TIME_ZONE,
    openMinutes,
    closeMinutes,
  }
}

function formatDayHours(dayName: WeekdayName, dayConfig?: LegacyHoursDay): string {
  if (!dayConfig || dayConfig.closed) return `${WEEKDAY_LABELS[dayName]}: cerrado`
  const openMinutes = parseTimeString(dayConfig.open, 7 * 60)
  const closeMinutes = parseTimeString(dayConfig.close, 19 * 60)
  return `${WEEKDAY_LABELS[dayName]}: ${formatMinutes(openMinutes)} - ${formatMinutes(closeMinutes)}`
}

export async function getBusinessInfo(supabase: any, businessId: string) {
  const row = await getBusinessRow(supabase, businessId)
  const config = getMergedConfig(row.config)

  return {
    name: row.name ?? 'el café',
    address: config.address ?? 'Chapule, Culiacán, Sinaloa',
    whatsapp: config.whatsapp ?? null,
    paymentMethods: config.payment_methods ?? [],
    timezone: config.timezone || BUSINESS_TIME_ZONE,
    weeklyHours: WEEKDAY_NAMES.map((day) => formatDayHours(day, config.hours?.[day])),
    acceptsWhatsappOrders: config.accepts_whatsapp_orders !== false,
    specialNotice: config.special_notice ?? null,
  }
}

export async function getBusinessHours(supabase: any, businessId: string, now = new Date(), phone?: string) {
  const row = await getBusinessRow(supabase, businessId)
  const config = getMergedConfig(row.config)
  const phoneIsBypassed = phone ? (config.bypass_phones ?? []).includes(phone) : false
  const timezone = config.timezone || BUSINESS_TIME_ZONE
  const { dayIndex, totalMinutes } = getLocalTimeParts(timezone, now)
  const window = resolveBusinessHoursWindow(config, dayIndex)

  const specialNotice = config.special_notice ?? null

  if (!window) {
    return {
      isOpen: false,
      isOpenToday: false,
      isAcceptingOrders: phoneIsBypassed,
      timezone,
      today: `${WEEKDAY_LABELS[WEEKDAY_NAMES[dayIndex]]}: cerrado`,
      closeTime: null,
      orderCutoff: null,
      orderCutoffTime: null,
      storeClose: null,
      weeklyHours: WEEKDAY_NAMES.map((day) => formatDayHours(day, config.hours?.[day])),
      specialNotice,
      message: `${row.name ?? 'El café'} está cerrado hoy.`,
    }
  }

  const orderCutoffMinutes = config.order_cutoff_time
    ? parseTimeString(config.order_cutoff_time, window.closeMinutes - ORDER_CUTOFF_BUFFER_MINUTES)
    : window.closeMinutes - ORDER_CUTOFF_BUFFER_MINUTES
  const isAcceptingOrders = phoneIsBypassed || (totalMinutes >= window.openMinutes && totalMinutes < orderCutoffMinutes)

  return {
    isOpen: totalMinutes >= window.openMinutes && totalMinutes < window.closeMinutes,
    isOpenToday: true,
    isAcceptingOrders,
    timezone,
    today: `${WEEKDAY_LABELS[window.dayName]}: ${formatMinutes(window.openMinutes)} - ${formatMinutes(window.closeMinutes)}`,
    closeTime: formatMinutes(window.closeMinutes),
    orderCutoff: formatMinutes(orderCutoffMinutes),
    orderCutoffTime: formatMinutes(orderCutoffMinutes),
    storeClose: formatMinutes(window.closeMinutes),
    weeklyHours: WEEKDAY_NAMES.map((day) => formatDayHours(day, config.hours?.[day])),
    specialNotice,
    message: isAcceptingOrders
      ? `${row.name ?? 'El café'} recibe pedidos por WhatsApp hoy hasta las ${formatMinutes(orderCutoffMinutes)}. El local cierra a las ${formatMinutes(window.closeMinutes)}.`
      : `${row.name ?? 'El café'} ya cerró pedidos por WhatsApp hoy. El corte fue a las ${formatMinutes(orderCutoffMinutes)} y el local cierra a las ${formatMinutes(window.closeMinutes)}.`,
  }
}

export async function isWithinOrderHours(
  supabase: any,
  businessId: string,
  now = new Date(),
  phone?: string,
): Promise<boolean> {
  const hours = await getBusinessHours(supabase, businessId, now, phone)
  return hours.isAcceptingOrders
}

export async function checkOrderingEnabled(
  supabase: any,
  businessId: string,
): Promise<{ enabled: boolean; disabledMessage: string | null }> {
  const row = await getBusinessRow(supabase, businessId)
  const config = getMergedConfig(row.config)
  if (config.accepts_whatsapp_orders === false) {
    return {
      enabled: false,
      disabledMessage: 'Los pedidos por WhatsApp están temporalmente pausados. Para más información comunícate directamente con el café.',
    }
  }
  return { enabled: true, disabledMessage: null }
}

export async function getOrdersClosedMessage(supabase: any, businessId: string): Promise<string> {
  const hours = await getBusinessHours(supabase, businessId)
  if (!hours.isOpenToday) {
    return 'Estamos fuera del horario del local por hoy. Escríbenos mañana y con gusto te ayudamos.'
  }

  if (!hours.orderCutoff || !hours.storeClose) {
    return 'Estamos fuera del horario de pedidos por WhatsApp. Los pedidos se cierran 30 minutos antes del cierre del local.'
  }

  return `Estamos fuera del horario de pedidos por WhatsApp hoy. Los pedidos cerraron a las ${hours.orderCutoff}. El local sigue abierto hasta las ${hours.storeClose} si quieres pasar directamente.`
}
