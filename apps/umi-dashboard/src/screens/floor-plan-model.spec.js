import { describe, expect, it } from 'vitest';
import {
  areaTableCount,
  duplicateElement,
  elementLabelFontSize,
  fitElement,
  formatTableTurn,
  groupRegions,
  layoutHistory,
  readTableRoom,
  seatDotLayout,
  seatRowCount,
  serverNowMs,
  tableBandFonts,
  tableEntry,
  tableGroupSize,
  tablePartyPresent,
  tableShowsDetail,
  tableStateVisual,
  tableTurnMs,
  tintFill,
} from './floor-plan-model';

describe('floor-plan edits', () => {
  const element = {
    id: 'original',
    kind: 'table',
    shape: 'rectangle',
    label: 'T1',
    capacity: 4,
    x: 30,
    y: 30,
    width: 100,
    height: 60,
    rotation: 90,
  };
  const area = { width: 500, height: 400, elements: [element] };
  it('keeps rotated elements within the area after snapping', () => {
    expect(fitElement({ ...element, x: 499, y: -10 }, area, true)).toMatchObject({ x: 470, y: 50 });
  });
  it('duplicates with a new table identity and available label', () => {
    const copy = duplicateElement(element, area);
    expect(copy.id).not.toBe(element.id);
    expect(copy.label).toBe('T2');
    expect(copy.capacity).toBe(4);
  });
  it('undoes and redoes a complete edit, and discards the abandoned future', () => {
    const original = { areas: [] };
    const edited = { areas: [area] };
    let history = layoutHistory(
      { past: [], present: original, future: [] },
      { type: 'edit', document: edited },
    );
    history = layoutHistory(history, { type: 'undo' });
    expect(history.present).toEqual(original);
    expect(layoutHistory(history, { type: 'redo' }).present).toEqual(edited);
    history = layoutHistory(history, { type: 'edit', document: { areas: [area, area] } });
    expect(history.future).toEqual([]);
  });
  describe('area table count', () => {
    it('counts tables and ignores walls, counters, doors and text', () => {
      const withFixtures = {
        elements: [
          { kind: 'table' },
          { kind: 'table' },
          { kind: 'counter' },
          { kind: 'wall' },
          { kind: 'door' },
          { kind: 'label' },
        ],
      };
      expect(areaTableCount(withFixtures)).toBe(2);
    });
    it('reads an empty or missing area as zero tables', () => {
      expect(areaTableCount({ elements: [] })).toBe(0);
      expect(areaTableCount(undefined)).toBe(0);
    });
  });
  describe('seat dots', () => {
    const band = { width: 100, height: 35 };
    it('wraps capacity into one, two, or three rows', () => {
      expect([0, 1, 4, 5, 8, 9, 12, 100].map(seatRowCount)).toEqual([0, 1, 1, 2, 2, 3, 3, 3]);
    });
    it('places one dot per seat inside the band', () => {
      const layout = seatDotLayout(7, band);
      expect(layout.rows).toBe(2);
      expect(layout.dots).toHaveLength(7);
      for (const dot of layout.dots) {
        expect(dot.x - dot.radius).toBeGreaterThanOrEqual(-0.001);
        expect(dot.x + dot.radius).toBeLessThanOrEqual(band.width + 0.001);
        expect(dot.y - dot.radius).toBeGreaterThanOrEqual(-0.001);
        expect(dot.y + dot.radius).toBeLessThanOrEqual(band.height + 0.001);
      }
    });
    it('keeps the rows centered and equal in size', () => {
      const layout = seatDotLayout(4, band);
      const radius = layout.dots[0].radius;
      expect(layout.dots).toHaveLength(4);
      expect(layout.dots.every((dot) => dot.radius === radius)).toBe(true);
      const first = layout.dots[0].x - radius;
      const last = layout.dots[3].x + radius;
      expect(band.width - last).toBeCloseTo(first, 6);
    });
    it('drops the dots when the band is too small to draw them', () => {
      expect(seatDotLayout(12, { width: 100, height: 3 }).dots).toEqual([]);
      expect(seatDotLayout(0, band).dots).toEqual([]);
      expect(seatDotLayout(4, { width: 0, height: 0 }).dots).toEqual([]);
    });
  });
  describe('table detail', () => {
    it('keeps the divider and dots only for tables with room for them', () => {
      expect(tableShowsDetail({ ...element, width: 100, height: 70 })).toBe(true);
      // The POS thresholds: 28 wide by 32 high.
      expect(tableShowsDetail({ ...element, width: 28, height: 32 })).toBe(true);
      expect(tableShowsDetail({ ...element, width: 27, height: 70 })).toBe(false);
      expect(tableShowsDetail({ ...element, width: 200, height: 20 })).toBe(false);
      expect(tableShowsDetail({ ...element, kind: 'wall', width: 200, height: 60 })).toBe(false);
    });
    it('sizes the label inside the band and never below the readable floor', () => {
      expect(elementLabelFontSize({ kind: 'table', width: 100, height: 70 })).toBeCloseTo(19.25, 2);
      expect(elementLabelFontSize({ kind: 'table', width: 1200, height: 900 })).toBe(26);
      expect(elementLabelFontSize({ kind: 'wall', width: 200, height: 12 })).toBe(7);
    });
  });

  describe('the room', () => {
    const LOCATION = '758c505d-5559-e877-bd01-9d5a41ffa9b4';
    const T1 = '8738b8d4-7872-45e9-8c28-0fdbdb161a7f';
    const T2 = '0bce4dfe-fc60-4633-9922-792bedebcd35';
    const read = (states, serverTime = '2026-09-17T00:00:00.000Z') => ({
      locationId: LOCATION,
      serverTime,
      states,
    });

    it('indexes the room by table and parses it through the contract', () => {
      const room = readTableRoom(
        read([
          {
            tableId: T1,
            state: 'seated',
            seatedAt: '2026-09-17T00:00:00.000Z',
            partySize: 2,
            groupId: null,
          },
        ]),
      );
      expect(tableEntry(room, T1).state).toBe('seated');
      expect(tablePartyPresent(tableEntry(room, T1))).toBe(true);
    });

    it('refuses a state the contract does not publish', () => {
      // The console is not allowed to invent a seventh state, and it cannot: the
      // contract rejects the payload before any of it reaches the canvas.
      const payload = read([
        { tableId: T1, state: 'reserved', seatedAt: null, partySize: null, groupId: null },
      ]);
      expect(() => readTableRoom(payload)).toThrow();
    });

    it('reads a table the room does not mention as free rather than unknown', () => {
      const room = readTableRoom(read([]));
      expect(tableEntry(room, T2)).toMatchObject({ state: 'open', seatedAt: null });
      expect(tablePartyPresent(tableEntry(room, T2))).toBe(false);
      expect(tableEntry(null, T2).state).toBe('open');
    });

    it('measures a turn against the server clock, not this machine clock', () => {
      // The room says the server's now is 00:00:05 and it arrived 5 s ago. A
      // workstation whose clock is an hour fast must still report a 5 s turn.
      const room = readTableRoom(
        read(
          [
            {
              tableId: T1,
              state: 'seated',
              seatedAt: '2026-09-17T00:00:00.000Z',
              partySize: 2,
              groupId: null,
            },
          ],
          '2026-09-17T00:00:05.000Z',
        ),
      );
      const receivedAt = 1_000_000;
      const now = serverNowMs(room, receivedAt, receivedAt + 5_000);
      expect(tableTurnMs(tableEntry(room, T1), now)).toBe(10_000);
      // A clock an hour ahead moves `receivedAt` and `localNowMs` together, and
      // the answer does not move with it.
      const skewed = serverNowMs(room, receivedAt + 3_600_000, receivedAt + 3_605_000);
      expect(tableTurnMs(tableEntry(room, T1), skewed)).toBe(10_000);
    });

    it('never reports a negative turn for a seated_at in the future', () => {
      const entry = { state: 'seated', seatedAt: '2026-09-17T01:00:00.000Z' };
      expect(tableTurnMs(entry, Date.parse('2026-09-17T00:00:00.000Z'))).toBe(0);
    });

    it('phrases a turn in the three shapes the till uses', () => {
      expect(formatTableTurn(40_000)).toBe('40 s');
      expect(formatTableTurn(12 * 60_000 + 30_000)).toBe('12 min');
      expect(formatTableTurn((3600 + 5 * 60) * 1000)).toBe('1:05 h');
      expect(formatTableTurn(-1)).toBe('0 s');
    });

    it('gives every state an accent and a badge glyph except free', () => {
      const states = ['seated', 'ordered', 'served', 'awaiting_payment', 'dirty'];
      for (const state of states) {
        const visual = tableStateVisual({ state, seatedAt: null }, false);
        expect(visual.accent, state).toMatch(/^#[0-9a-f]{6}$/);
        expect(visual.glyph, state).toBeTruthy();
      }
      // A free table is the absence of a state, so it carries no mark at all.
      const open = tableStateVisual({ state: 'open', seatedAt: null }, false);
      expect(open.accent).toBeNull();
      expect(open.glyph).toBeNull();
      expect(open.hatched).toBe(false);
      // Only the table that needs wiping is hatched.
      expect(tableStateVisual({ state: 'dirty' }, false).hatched).toBe(true);
      expect(tableStateVisual({ state: 'seated' }, false).hatched).toBe(false);
    });

    it('marks a party present on every state that holds one', () => {
      for (const state of ['seated', 'ordered', 'served', 'awaiting_payment']) {
        const visual = tableStateVisual({ state, seatedAt: '2026-09-17T00:00:00.000Z' }, false);
        expect(visual.present, state).toBe(true);
      }
      expect(tableStateVisual({ state: 'dirty', seatedAt: null }, false).present).toBe(false);
    });

    it('washes an occupied table with the same tint and leaves a free one alone', () => {
      // 6% of the till's green over white. One wash for every occupied state:
      // the accent and the badge say WHICH state, the wash only says "not free".
      expect(tintFill('#ffffff', '#1b7f4b', 0.06)).toBe('#f1f7f4');
      const visual = tableStateVisual({ state: 'seated' }, false);
      expect(visual.tintAlpha).toBe(0.06);
      expect(tintFill('#ffffff', visual.tint, visual.tintAlpha)).toBe('#f1f7f4');
      // The dark theme washes its own surface, and washes it harder.
      expect(tintFill('#25272e', '#1f9e63', 0.13)).toBe('#243635');
    });

    it('shrinks the name to make room for the timer, and only then', () => {
      const table = { kind: 'table', width: 100, height: 70 };
      expect(tableBandFonts(table, false).label).toBe(elementLabelFontSize(table));
      expect(tableBandFonts(table, true).label).toBeLessThan(tableBandFonts(table, false).label);
      expect(tableBandFonts(table, true).turn).toBeGreaterThanOrEqual(6);
      expect(tableBandFonts({ kind: 'table', width: 1200, height: 900 }, true).turn).toBe(15);
    });

    it('draws one outline around a merged party and none around a lone table', () => {
      const area = {
        elements: [
          { id: T1, kind: 'table', x: 100, y: 100, width: 80, height: 60 },
          { id: T2, kind: 'table', x: 220, y: 100, width: 80, height: 60 },
        ],
      };
      const merged = readTableRoom(
        read([
          {
            tableId: T1,
            state: 'seated',
            seatedAt: '2026-09-17T00:00:00.000Z',
            partySize: 6,
            groupId: 'b1f0f6a6-0000-4000-8000-000000000001',
          },
          {
            tableId: T2,
            state: 'seated',
            seatedAt: '2026-09-17T00:00:00.000Z',
            partySize: 6,
            groupId: 'b1f0f6a6-0000-4000-8000-000000000001',
          },
        ]),
      );
      const regions = groupRegions(area, merged);
      expect(regions).toHaveLength(1);
      // Both tables, plus 14 of air on every side.
      expect(regions[0]).toMatchObject({ x: 46, y: 56, width: 228, height: 88 });
      expect(tableGroupSize(merged, tableEntry(merged, T1))).toBe(2);
      // Two tables seated but never merged are two parties, not one group.
      const separate = readTableRoom(
        read([
          {
            tableId: T1,
            state: 'seated',
            seatedAt: '2026-09-17T00:00:00.000Z',
            partySize: 2,
            groupId: null,
          },
          {
            tableId: T2,
            state: 'seated',
            seatedAt: '2026-09-17T00:00:00.000Z',
            partySize: 2,
            groupId: null,
          },
        ]),
      );
      expect(groupRegions(area, separate)).toEqual([]);
      expect(groupRegions(area, null)).toEqual([]);
    });
  });
});
