/**
 * `open_hours` — the jsonb document, and the only place its meaning is written down.
 *
 * build-v3 makes hours an ATTRIBUTE, not a table: `merchant.merchant.open_hours`, with
 * `merchant.location.open_hours` overriding it (NULL = inherit, exactly like
 * `location.timezone` one line above it in the DDL). This module owns the shape so the
 * dashboard, the WhatsApp bot and the cash register cannot each decide separately what
 * "closed" means — which is what happened with the row table it replaces, where a
 * missing row meant "closed" in one reader and "unset" in another.
 *
 * ```json
 * {
 *   "mon": [{"open": "08:00", "close": "20:00"}],
 *   "tue": [{"open": "08:00", "close": "14:00"},
 *           {"open": "17:00", "close": "22:00"}],
 *   "wed": [],
 *   "exceptions": [{"date": "2026-12-25", "closed": true},
 *                  {"date": "2026-05-10", "open": "10:00", "close": "14:00"}]
 * }
 * ```
 *
 * THE THREE STATES OF A DAY, which the row table could not tell apart:
 *   - key ABSENT  → unknown. Fail closed. (A merchant that has never set hours.)
 *   - key `[]`    → the café states it is closed that day.
 *   - key `[…]`   → open during those intervals.
 * Absent and `[]` both read as closed; they differ only in what a writer may assume,
 * and `toGrid` shows the difference to the dashboard.
 *
 * TWO THINGS THE ROW TABLE COULD NOT EXPRESS, both now representable:
 *   - more than one interval per day. The 2026-06-26 migration added a UNIQUE index on
 *     `(merchant, location, day_of_week)`, so a split shift was not merely unimplemented,
 *     it was forbidden.
 *   - date exceptions. "Closed on Christmas" had nowhere to live at all.
 */

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/** One open window. `HH:MM`, local to the location/merchant timezone. */
export interface HoursInterval {
  open: string;
  close: string;
}

/** A single date that overrides its weekday. `closed` wins over `open`/`close`. */
export interface HoursException {
  /** `YYYY-MM-DD` in the local timezone — a calendar date, never an instant. */
  date: string;
  closed?: boolean;
  open?: string;
  close?: string;
}

export type OpenHours = Partial<Record<DayKey, HoursInterval[]>> & {
  exceptions?: HoursException[];
};

/** Postgres `extract(dow)` and `Date.getDay()` are both 0=Sunday. So is DAY_KEYS. */
export function dayKeyFor(dow: number): DayKey | null {
  return DAY_KEYS[dow] ?? null;
}

/** `HH:MM[:SS]` → minutes since midnight, or null when unparseable. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

function isInterval(v: unknown): v is HoursInterval {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as HoursInterval).open === 'string' &&
    typeof (v as HoursInterval).close === 'string'
  );
}

/**
 * Coerce whatever the column holds into the documented shape. The column is
 * `jsonb not null default '{}'`, so it is never SQL NULL — but it can hold `{}`, and
 * a hand-edited row can hold anything. Everything unrecognized is dropped rather than
 * guessed at: a malformed day must read as "unknown", which fails closed, never as
 * "open all day".
 */
export function parseOpenHours(raw: unknown): OpenHours {
  const out: OpenHours = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const doc = raw as Record<string, unknown>;

  for (const key of DAY_KEYS) {
    const value = doc[key];
    if (!Array.isArray(value)) continue; // absent, or not a list → unknown
    out[key] = value.filter(isInterval).filter((i) => {
      const open = timeToMinutes(i.open);
      const close = timeToMinutes(i.close);
      // close < open is legal: the window crosses midnight (see `crossesMidnight`).
      // close === open is not — it is the row table's old "closed" encoding
      // (00:00→00:00), which in this shape is `[]`, and a zero-length window
      // otherwise means nothing.
      return open !== null && close !== null && open !== close;
    });
  }

  if (Array.isArray(doc.exceptions)) {
    out.exceptions = doc.exceptions.filter(
      (e): e is HoursException =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as HoursException).date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test((e as HoursException).date),
    );
  }
  return out;
}

/**
 * The intervals that apply on a given local date. An exception for that exact date
 * replaces the weekday entirely — a café that is closed on 25 December is closed even
 * though `thu` says it opens at eight.
 *
 * Returns `null` for "unknown" (the weekday key is absent and no exception applies),
 * which every caller must treat as closed. An empty array is a STATED closure.
 */
export function windowsOn(
  hours: OpenHours,
  dow: number,
  localDate?: string | null,
): HoursInterval[] | null {
  if (localDate) {
    const hit = hours.exceptions?.find((e) => e.date === localDate);
    if (hit) {
      if (hit.closed) return [];
      const open = timeToMinutes(hit.open);
      const close = timeToMinutes(hit.close);
      // An exception that neither closes the day nor states a usable window is
      // malformed. Fall through to the weekday rather than inventing hours.
      if (open !== null && close !== null && close > open) {
        return [{ open: hit.open as string, close: hit.close as string }];
      }
    }
  }
  const key = dayKeyFor(dow);
  if (!key) return null;
  return hours[key] ?? null;
}

/**
 * Does this window run past midnight? `20:00 → 02:00` is a real café, and the schema
 * already concedes the point: `merchant.merchant.business_day_start` exists precisely so
 * a sale at 01:00 can belong to the previous trading day. Hours have to agree with it,
 * or a late-night merchant reads as closed during half its service.
 */
export function crossesMidnight(w: HoursInterval): boolean {
  const open = timeToMinutes(w.open);
  const close = timeToMinutes(w.close);
  return open !== null && close !== null && close < open;
}

/** `YYYY-MM-DD` → the calendar day before it. Pure string/UTC math, no timezone. */
function previousDate(localDate: string | null | undefined): string | null {
  if (!localDate) return null;
  const d = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A window placed on a single number line whose origin is TODAY's local midnight.
 *
 * That frame is what makes the awkward cases arithmetic instead of special cases:
 * `closeMinutes` is always greater than `openMinutes`, a window that runs past midnight
 * simply has `closeMinutes > 1440`, and one that STARTED yesterday has a negative
 * `openMinutes`. Callers compare `minutes` against the pair and nothing else.
 */
export interface ActiveWindow {
  openMinutes: number;
  closeMinutes: number;
  crossesMidnight: boolean;
}

function place(w: HoursInterval, dayOffsetMinutes: number): ActiveWindow | null {
  const open = timeToMinutes(w.open);
  const close = timeToMinutes(w.close);
  if (open === null || close === null || open === close) return null;
  const crosses = close < open;
  return {
    openMinutes: open + dayOffsetMinutes,
    closeMinutes: (crosses ? close + 1440 : close) + dayOffsetMinutes,
    crossesMidnight: crosses,
  };
}

/**
 * The window in progress at `minutes` past local midnight, or null.
 *
 * Two passes, because a window can outlive its own day: today's windows, then
 * YESTERDAY's that cross midnight and have not closed. Without the second pass a bar
 * open 20:00–02:00 reads as closed at 00:30 — on the night it is busiest — and the
 * register would flag every late sale as after-hours.
 */
export function activeWindowAt(
  hours: OpenHours,
  dow: number,
  minutes: number,
  localDate?: string | null,
): ActiveWindow | null {
  for (const w of windowsOn(hours, dow, localDate) ?? []) {
    const placed = place(w, 0);
    if (placed && minutes >= placed.openMinutes && minutes < placed.closeMinutes) return placed;
  }
  for (const w of windowsOn(hours, (dow + 6) % 7, previousDate(localDate)) ?? []) {
    if (!crossesMidnight(w)) continue;
    const placed = place(w, -1440); // started yesterday → negative openMinutes
    if (placed && minutes >= placed.openMinutes && minutes < placed.closeMinutes) return placed;
  }
  return null;
}

/** Is the café open at `minutes` past local midnight on this weekday/date? */
export function isOpenAt(
  hours: OpenHours,
  dow: number,
  minutes: number,
  localDate?: string | null,
): boolean {
  return activeWindowAt(hours, dow, minutes, localDate) !== null;
}

/** The dashboard's single-interval row for one day. */
export interface GridDay {
  open: boolean;
  from: string;
  to: string;
}
export type HoursGrid = Record<string, GridDay>;

/**
 * Project the document onto the dashboard's one-window-per-day grid. Days the café has
 * never set are omitted; the caller decides what to show for them (the Hours screen
 * fills a suggestion, the bot does not).
 *
 * A day with several intervals is shown as its FIRST — see `fromGrid`, which is the
 * half that keeps this from destroying the rest.
 */
export function toGrid(hours: OpenHours): HoursGrid {
  const grid: HoursGrid = {};
  for (const key of DAY_KEYS) {
    const windows = hours[key];
    if (!windows) continue; // unknown — not the same as closed
    grid[key] = windows[0]
      ? { open: true, from: windows[0].open, to: windows[0].close }
      : { open: false, from: '00:00', to: '00:00' };
  }
  return grid;
}

/**
 * Fold a dashboard grid back into the document, on top of what is already stored.
 *
 * Two things are DELIBERATELY preserved, because the dashboard cannot see them and so
 * cannot have meant to delete them:
 *   - `exceptions`. A weekly-grid save must not silently cancel "closed on Christmas".
 *   - intervals beyond the first. The grid edits window one; a split shift's evening
 *     window survives it.
 *
 * Days absent from the grid keep whatever they had. That is what makes a partial save
 * (the pause toggle sending no grid at all) safe.
 */
export function fromGrid(grid: HoursGrid, existing: OpenHours): OpenHours {
  const next: OpenHours = { ...existing };
  for (const [key, day] of Object.entries(grid)) {
    if (!DAY_KEYS.includes(key as DayKey)) continue; // ignore keys we do not model
    if (!day || typeof day !== 'object') continue;
    const dayKey = key as DayKey;
    if (!day.open) {
      // Stated closed. Any extra intervals go with it — the café said "not this day".
      next[dayKey] = [];
      continue;
    }
    const rest = (existing[dayKey] ?? []).slice(1);
    next[dayKey] = [{ open: day.from, close: day.to }, ...rest];
  }
  return next;
}
