const MX_TZ = 'America/Mexico_City';

export function formatDateMX(date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: MX_TZ, ...options }).format(date);
}

export function formatDateTimeMX(date: Date): string {
  return formatDateMX(date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatDateShortMX(date: Date): string {
  return formatDateMX(date, { day: 'numeric', month: 'short' });
}

export function formatMonthYearMX(date: Date): string {
  return formatDateMX(date, { month: 'long', year: 'numeric' });
}

export function formatFullDateMX(date: Date): string {
  return formatDateMX(date, { day: 'numeric', month: 'long', year: 'numeric' });
}
