import { floorElementBounds } from '@umi/contract/floor-plan';

/**
 * Seating affordances for one table, in the same shape the POS draws them:
 * a bold label band on top, a hairline divider, and the seat dots below it.
 *
 * Capacities up to four seats read best on one row, up to eight on two, and
 * anything larger wraps to three rows, so the dots stay centered instead of
 * stretching into a single thin line.
 */
export const SEAT_DOT_MAX_DIAMETER = 12;

// Below this the label band and the seat band stop being legible, so the
// element falls back to a centered label only. The numbers are the POS
// thresholds: the POS measures the rendered element, the editor measures floor
// units, so the two agree at 100% zoom and the editor degrades on element size
// instead of on zoom.
export const TABLE_DETAIL_MIN_WIDTH = 28;
export const TABLE_DETAIL_MIN_HEIGHT = 32;

export function createLayout(name) {
  return {
    schemaVersion: 1,
    areas: [{ id: crypto.randomUUID(), name, width: 1200, height: 800, elements: [] }],
  };
}

/** Tables placed in one area. Walls, counters, doors and text are not tables. */
export function areaTableCount(area) {
  return (area?.elements ?? []).filter((element) => element.kind === 'table').length;
}

export function seatRowCount(capacity) {
  const count = Math.floor(Number(capacity) || 0);
  if (count <= 0) return 0;
  return count <= 4 ? 1 : count <= 8 ? 2 : 3;
}

/**
 * Centers `capacity` seat dots inside a `width` x `height` band and returns them
 * in local coordinates with the band's top-left at the origin. Pure geometry, so
 * the editor, the published preview, and the tests all agree on one layout.
 */
export function seatDotLayout(capacity, { width, height }) {
  const count = Math.floor(Number(capacity) || 0);
  const empty = { rows: 0, perRow: 0, dots: [] };
  if (count <= 0 || !(width > 0) || !(height > 0)) return empty;
  const rows = seatRowCount(count);
  const perRow = Math.ceil(count / rows);
  const diameter = Math.min(height / (rows * 1.7), width / (perRow * 2.2), SEAT_DOT_MAX_DIAMETER);
  // A dot thinner than a pixel and a half reads as noise, so drop the row.
  if (diameter < 1.5) return { rows, perRow, dots: [] };
  const gap = diameter * 0.8;
  const pitch = diameter + gap;
  const dots = [];
  let remaining = count;
  const top = (height - (rows * diameter + (rows - 1) * gap)) / 2;
  for (let row = 0; row < rows && remaining > 0; row += 1) {
    const inRow = Math.min(perRow, remaining);
    remaining -= inRow;
    const left = (width - (inRow * diameter + (inRow - 1) * gap)) / 2;
    for (let dot = 0; dot < inRow; dot += 1) {
      dots.push({
        x: left + dot * pitch + diameter / 2,
        y: top + row * pitch + diameter / 2,
        radius: diameter / 2,
      });
    }
  }
  return { rows, perRow, dots };
}

/** Does this element have room for the label band, divider, and seat dots? */
export function tableShowsDetail(element) {
  return (
    element?.kind === 'table' &&
    element.width >= TABLE_DETAIL_MIN_WIDTH &&
    element.height >= TABLE_DETAIL_MIN_HEIGHT
  );
}

/** Bold label size for an element, kept inside its band and floored at 7. */
export function elementLabelFontSize(element) {
  const band = tableShowsDetail(element) ? element.height / 2 : element.height;
  return Math.min(26, Math.max(7, Math.min(band * 0.55, element.width * 0.4)));
}

export function fitElement(element, area, snap = false) {
  const { halfWidth, halfHeight } = floorElementBounds(element);
  const step = snap ? 20 : 1;
  return {
    ...element,
    x: Math.min(area.width - halfWidth, Math.max(halfWidth, Math.round(element.x / step) * step)),
    y: Math.min(
      area.height - halfHeight,
      Math.max(halfHeight, Math.round(element.y / step) * step),
    ),
  };
}

export function nextTableLabel(elements) {
  const labels = new Set(
    elements.filter((e) => e.kind === 'table').map((e) => e.label.toLowerCase()),
  );
  let number = 1;
  while (labels.has(`t${number}`)) number += 1;
  return `T${number}`;
}

export function duplicateElement(element, area) {
  return fitElement(
    {
      ...element,
      id: crypto.randomUUID(),
      x: element.x + 40,
      y: element.y + 40,
      label: element.kind === 'table' ? nextTableLabel(area.elements) : element.label,
    },
    area,
  );
}

export function layoutHistory(state, action) {
  if (action.type === 'canonical') return { ...state, present: action.document };
  if (action.type === 'reset') return { past: [], present: action.document, future: [] };
  if (action.type === 'undo' && state.past.length)
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1),
      future: [state.present, ...state.future],
    };
  if (action.type === 'redo' && state.future.length)
    return {
      past: [...state.past, state.present],
      present: state.future[0],
      future: state.future.slice(1),
    };
  if (action.type === 'edit' && JSON.stringify(action.document) !== JSON.stringify(state.present))
    return {
      past: [...state.past, state.present].slice(-60),
      present: action.document,
      future: [],
    };
  return state;
}
