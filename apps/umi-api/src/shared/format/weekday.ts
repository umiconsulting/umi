/**
 * The local weekday of a café, as a number.
 *
 * `0` is Sunday, to match the `open-hours` DAY_KEYS order and the Postgres `dow`
 * field. Two callers need it: the scan path decides if the café is open, and the
 * wallet decides if a promotion shows today. They must agree, so the table and
 * the lookup live here.
 *
 * `Intl` gives the correct answer across a daylight-saving change, which is why
 * this does not do arithmetic on UTC offsets.
 */
export const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/** Weekday 0..6 in `timezone`. Falls back to the server day for a bad zone. */
export function weekdayInZone(timezone: string | null | undefined, at: Date = new Date()): number {
  if (!timezone) return at.getDay();
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(
      at,
    );
    return WEEKDAY_INDEX[name] ?? at.getDay();
  } catch {
    return at.getDay();
  }
}
