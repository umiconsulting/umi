/** Conserva el instante y expresa la hora en la zona del negocio. */
export function receiptTimeInZone(timestamp: string, timezone: string): string {
  const at = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(at);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === name)!.value;
  const zone = part('timeZoneName');
  const offset = zone === 'GMT' ? '+00:00' : zone.replace('GMT', '');
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}.${String(at.getUTCMilliseconds()).padStart(3, '0')}${offset}`;
}
