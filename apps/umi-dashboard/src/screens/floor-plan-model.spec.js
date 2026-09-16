import { describe, expect, it } from 'vitest';
import {
  areaTableCount,
  duplicateElement,
  elementLabelFontSize,
  fitElement,
  layoutHistory,
  seatDotLayout,
  seatRowCount,
  tableShowsDetail,
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
});
