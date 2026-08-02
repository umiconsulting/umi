import { describe, expect, it } from 'vitest';
import {
  activeWindowAt,
  fromGrid,
  isOpenAt,
  parseOpenHours,
  toGrid,
  windowsOn,
  type OpenHours,
} from './open-hours';

/**
 * These are the tests that matter for this cluster. `open_hours` is a jsonb document,
 * so the database no longer rejects a bad time for us — the guarantees the row table's
 * `time` columns used to give have to be earned here instead.
 */

const MON = 1;
const TUE = 2;
const SAT = 6;

describe('parseOpenHours', () => {
  it('keeps well-formed intervals and drops the rest', () => {
    const hours = parseOpenHours({
      mon: [
        { open: '08:00', close: '20:00' },
        { open: '25:00', close: '26:00' }, // not a time
        { open: '10:00' }, // half an interval
        'nonsense',
      ],
    });
    expect(hours.mon).toEqual([{ open: '08:00', close: '20:00' }]);
  });

  it('keeps a window that runs past midnight', () => {
    expect(parseOpenHours({ sat: [{ open: '20:00', close: '02:00' }] }).sat).toEqual([
      { open: '20:00', close: '02:00' },
    ]);
  });

  it("drops the row table's old 00:00 → 00:00 closed encoding", () => {
    // A zero-length window is not a window. In this shape a closed day is `[]`.
    expect(parseOpenHours({ sun: [{ open: '00:00', close: '00:00' }] }).sun).toEqual([]);
  });

  it('survives a column that is not a document at all', () => {
    expect(parseOpenHours(null)).toEqual({});
    expect(parseOpenHours('closed')).toEqual({});
    expect(parseOpenHours([{ open: '08:00', close: '20:00' }])).toEqual({});
  });

  it('keeps only exceptions with a real date', () => {
    const hours = parseOpenHours({
      exceptions: [
        { date: '2026-12-25', closed: true },
        { date: 'christmas', closed: true },
        { closed: true },
      ],
    });
    expect(hours.exceptions).toEqual([{ date: '2026-12-25', closed: true }]);
  });
});

describe('the three states of a day', () => {
  it('tells "never set" apart from "stated closed"', () => {
    const hours = parseOpenHours({ mon: [] });
    expect(windowsOn(hours, MON)).toEqual([]); // stated closed
    expect(windowsOn(hours, TUE)).toBeNull(); // unknown
  });

  it('reads both of them as closed', () => {
    const hours = parseOpenHours({ mon: [] });
    expect(isOpenAt(hours, MON, 12 * 60)).toBe(false);
    expect(isOpenAt(hours, TUE, 12 * 60)).toBe(false);
  });
});

describe('isOpenAt', () => {
  const hours = parseOpenHours({
    mon: [{ open: '08:00', close: '20:00' }],
    tue: [
      { open: '08:00', close: '14:00' },
      { open: '17:00', close: '22:00' },
    ],
    sat: [{ open: '20:00', close: '02:00' }],
  });

  it('is open inside the window and closed outside it', () => {
    expect(isOpenAt(hours, MON, 12 * 60)).toBe(true);
    expect(isOpenAt(hours, MON, 7 * 60 + 59)).toBe(false);
    expect(isOpenAt(hours, MON, 21 * 60)).toBe(false);
  });

  it('treats opening time as open and closing time as closed', () => {
    expect(isOpenAt(hours, MON, 8 * 60)).toBe(true);
    expect(isOpenAt(hours, MON, 20 * 60)).toBe(false);
  });

  it('closes during the gap in a split shift', () => {
    expect(isOpenAt(hours, TUE, 9 * 60)).toBe(true);
    expect(isOpenAt(hours, TUE, 15 * 60)).toBe(false); // siesta
    expect(isOpenAt(hours, TUE, 18 * 60)).toBe(true);
  });

  it('stays open after midnight on a window that crosses it', () => {
    expect(isOpenAt(hours, SAT, 23 * 60)).toBe(true); // Saturday night
    // 00:30 is SUNDAY, and Sunday has no hours of its own — but Saturday's window
    // is still running. Without the yesterday pass this reads closed.
    expect(isOpenAt(hours, 0, 30)).toBe(true);
    expect(isOpenAt(hours, 0, 2 * 60 + 1)).toBe(false); // after it closes
  });

  it('does not leak a non-crossing window into the next day', () => {
    expect(isOpenAt(hours, TUE, 30)).toBe(false); // Monday closed at 20:00
  });
});

describe('date exceptions', () => {
  const hours = parseOpenHours({
    fri: [{ open: '08:00', close: '20:00' }],
    exceptions: [
      { date: '2026-12-25', closed: true },
      { date: '2026-05-01', open: '10:00', close: '14:00' },
      { date: '2026-07-04', open: 'noon' }, // malformed
    ],
  });

  it('closes the café on an exception date even though the weekday is open', () => {
    expect(isOpenAt(hours, 5, 12 * 60, '2026-12-25')).toBe(false);
    expect(isOpenAt(hours, 5, 12 * 60, '2026-12-24')).toBe(true);
  });

  it('replaces the weekday window with the exception window', () => {
    expect(isOpenAt(hours, 5, 9 * 60, '2026-05-01')).toBe(false); // weekday would be open
    expect(isOpenAt(hours, 5, 11 * 60, '2026-05-01')).toBe(true);
  });

  it('falls through to the weekday when the exception is malformed', () => {
    // It states neither a closure nor a usable window, so inventing hours from it
    // would be worse than ignoring it.
    expect(isOpenAt(hours, 5, 12 * 60, '2026-07-04')).toBe(true);
  });
});

describe('activeWindowAt', () => {
  it('places a crossing window on one number line', () => {
    const hours = parseOpenHours({ sat: [{ open: '20:00', close: '02:00' }] });
    expect(activeWindowAt(hours, SAT, 23 * 60)).toEqual({
      openMinutes: 1200,
      closeMinutes: 1560, // 02:00 next day
      crossesMidnight: true,
    });
  });

  it('gives a window that started yesterday a negative opening', () => {
    const hours = parseOpenHours({ sat: [{ open: '20:00', close: '02:00' }] });
    expect(activeWindowAt(hours, 0, 30)).toEqual({
      openMinutes: -240, // 20:00 yesterday
      closeMinutes: 120,
      crossesMidnight: true,
    });
  });
});

describe('toGrid / fromGrid', () => {
  it('omits days the café never set, so the caller decides what to show', () => {
    expect(toGrid(parseOpenHours({ mon: [{ open: '08:00', close: '20:00' }] }))).toEqual({
      mon: { open: true, from: '08:00', to: '20:00' },
    });
  });

  it('shows a stated closure as closed', () => {
    expect(toGrid(parseOpenHours({ wed: [] })).wed).toEqual({
      open: false,
      from: '00:00',
      to: '00:00',
    });
  });

  it('round-trips a simple week unchanged', () => {
    const doc: OpenHours = { mon: [{ open: '08:00', close: '20:00' }], sun: [] };
    expect(fromGrid(toGrid(doc), doc)).toEqual(doc);
  });

  it('preserves what the grid cannot show', () => {
    const doc: OpenHours = {
      tue: [
        { open: '08:00', close: '14:00' },
        { open: '17:00', close: '22:00' },
      ],
      exceptions: [{ date: '2026-12-25', closed: true }],
    };
    const next = fromGrid({ tue: { open: true, from: '09:00', to: '13:00' } }, doc);
    expect(next.tue).toEqual([
      { open: '09:00', close: '13:00' },
      { open: '17:00', close: '22:00' },
    ]);
    expect(next.exceptions).toEqual([{ date: '2026-12-25', closed: true }]);
  });

  it('drops every window when the day is marked closed', () => {
    const doc: OpenHours = {
      tue: [
        { open: '08:00', close: '14:00' },
        { open: '17:00', close: '22:00' },
      ],
    };
    expect(fromGrid({ tue: { open: false, from: '00:00', to: '00:00' } }, doc).tue).toEqual([]);
  });
});
