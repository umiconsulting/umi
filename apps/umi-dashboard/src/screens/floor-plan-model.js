import { floorElementBounds } from '@umi/contract/floor-plan';
import { TableStateMap } from '@umi/contract/table-state';

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

/**
 * Type sizes for a table's upper band, in the two sizes the till draws.
 *
 * The till stacks the table's name over its turn timer in the same half-band, so
 * the name gives up room when a timer joins it — `T12` and `1:05 h` both have to
 * be readable inside half a table. A table with no party keeps the roomy name it
 * has always had, so adding a timer to one table does not shrink the rest.
 */
export function tableBandFonts(element, hasTurn) {
  const label = elementLabelFontSize(element);
  const band = tableShowsDetail(element) ? element.height / 2 : element.height;
  return {
    label: hasTurn ? Math.max(7, label * 0.62) : label,
    turn: Math.min(15, Math.max(6, Math.min(band * 0.32, element.width * 0.3))),
  };
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

// ── The room (workstream D, steps 3 and 5) ───────────────────────────────────
//
// The document the editor holds is the LAYOUT: which tables exist, where they
// are, how big they are. The room is a second read with a second lifetime: who
// is sitting where right now, and for how long. A layout is edited and published
// and lasts for months; a seating is over in ninety minutes.
//
// Everything the console draws about the room is decided here, so the screen,
// the tests and the element list all read one room one way. The rule that shapes
// all of it is the plan's: **colour alone must not carry a state** (§8D step 3).
// Each state therefore carries three things — an accent, a badge glyph, and a
// change in the seat band — and they are the same three the till draws, because
// the manager and the operator are looking at the same room.

/** How often the console re-reads the room. The till polls on the same beat. */
export const TABLE_STATE_POLL_MS = 15_000;

/**
 * A table the room has never mentioned is `open`, not "unknown". The layout says
 * the table exists and nothing has happened on it, so no state row was ever
 * created. Every reader defaults the same way, or a free table reads as a fault.
 */
export const OPEN_TABLE_ENTRY = Object.freeze({
  state: 'open',
  seatedAt: null,
  partySize: null,
  groupId: null,
});

/**
 * Parse a room read into a lookup by table id.
 *
 * The CONTRACT parses it. That is the point: a state the server is not allowed
 * to publish throws here instead of reaching the canvas as a seventh colour, so
 * the console cannot invent a state the till has never heard of.
 */
export function readTableRoom(payload) {
  const map = TableStateMap.parse(payload);
  const byTable = new Map();
  for (const entry of map.states) byTable.set(entry.tableId, entry);
  return { locationId: map.locationId, serverTime: map.serverTime, byTable };
}

/** One table's state, defaulting to `open` when the room has no row for it. */
export function tableEntry(room, tableId) {
  return room?.byTable.get(tableId) ?? OPEN_TABLE_ENTRY;
}

/** A table holds a party exactly when the server set its seating time. */
export function tablePartyPresent(entry) {
  return entry?.seatedAt != null;
}

/** How many tables share this table's group. One means "not merged". */
export function tableGroupSize(room, entry) {
  if (!entry?.groupId || !room) return 1;
  let size = 0;
  for (const other of room.byTable.values()) if (other.groupId === entry.groupId) size += 1;
  return size;
}

/**
 * One outline per merged group, in plan coordinates, covering every table the
 * group holds. A merged party is one party on several tables, and a manager
 * reading the room has to see that without counting seats.
 *
 * A single table carrying a `groupId` is not a group: `groupId` is set exactly
 * while a group has more than one table, so a lone member is not drawn.
 */
export function groupRegions(area, room, inflate = 14) {
  if (!room?.byTable.size || !area) return [];
  const byGroup = new Map();
  for (const element of area.elements) {
    if (element.kind !== 'table') continue;
    const groupId = tableEntry(room, element.id).groupId;
    if (!groupId) continue;
    const left = element.x - element.width / 2;
    const top = element.y - element.height / 2;
    const current = byGroup.get(groupId);
    byGroup.set(groupId, {
      groupId,
      count: (current?.count ?? 0) + 1,
      left: current ? Math.min(current.left, left) : left,
      top: current ? Math.min(current.top, top) : top,
      right: current ? Math.max(current.right, left + element.width) : left + element.width,
      bottom: current ? Math.max(current.bottom, top + element.height) : top + element.height,
    });
  }
  return [...byGroup.values()]
    .filter((group) => group.count > 1)
    .map((group) => ({
      groupId: group.groupId,
      x: group.left - inflate,
      y: group.top - inflate,
      width: group.right - group.left + inflate * 2,
      height: group.bottom - group.top + inflate * 2,
    }));
}

/**
 * The server's now, moved forward by the time this tab has been open.
 *
 * Turn times are measured against the server's clock and never the
 * workstation's, so a tablet with a wrong clock reports the same turn as every
 * other device in the room — and a tablet whose clock is an hour out does not
 * show a table that has been busy for ten minutes as busy for seventy.
 */
export function serverNowMs(room, receivedAtMs, localNowMs) {
  const anchor = Date.parse(room?.serverTime ?? '');
  if (Number.isNaN(anchor)) return null;
  return anchor + Math.max(0, localNowMs - receivedAtMs);
}

/** How long a party has held a table, in milliseconds. Null when there is none. */
export function tableTurnMs(entry, nowMs) {
  if (!entry?.seatedAt || nowMs == null) return null;
  const seated = Date.parse(entry.seatedAt);
  if (Number.isNaN(seated)) return null;
  return Math.max(0, nowMs - seated);
}

/**
 * A turn timer short enough for a table on a map: `1:05 h`, `12 min`, `40 s`.
 * The three shapes are the till's, so one turn is phrased one way on both
 * screens. Seconds are shown only in the first minute, when they are the only
 * digit that changes.
 */
export function formatTableTurn(turnMs) {
  const seconds = Math.max(0, Math.floor((turnMs ?? 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  // `h` is a unit, not a sentence: the till writes all three shapes this way
  // (`1:05 h`, `12 min`, `40 s`) and none of them changes between the product's
  // languages. The console rounds a turn exactly as the till rounds it.
  // eslint-disable-next-line lingui/no-unlocalized-strings
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')} h`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds} s`;
}

/**
 * The accent per state, taken from the till's own palette. `open` has none: a
 * free table is not a state, it is the absence of one, and it draws as the plain
 * surface every element already draws as.
 */
export const TABLE_STATE_ACCENT = {
  light: {
    seated: '#1b7f4b',
    ordered: '#1d4ed8',
    served: '#6d28d9',
    awaiting_payment: '#b45309',
    dirty: '#c2410c',
  },
  dark: {
    seated: '#7fd0a6',
    ordered: '#8fc4ff',
    served: '#c9b6ff',
    awaiting_payment: '#ffd479',
    dirty: '#ffb078',
  },
};

/**
 * The wash an occupied table carries — the same one for every state, because the
 * accent, the glyph and the seat band already say which state it is. The tint
 * only has to say "somebody is on this one".
 */
export const TABLE_STATE_TINT = { light: '#1b7f4b', dark: '#1f9e63' };
export const TABLE_STATE_TINT_ALPHA = { light: 0.06, dark: 0.13 };

/**
 * The badge glyph per state: 24x24 path data in the app's own icon language
 * (Lucide, as `icons.jsx`). The till uses Material icons in Flutter and cannot
 * share a font with a canvas, so the GLYPH is not the shared thing — the rule is.
 * Each state gets a mark a person can name, so a state survives a greyscale
 * print, a washed-out screen, and the commonest form of colour blindness.
 *
 * `open` has no glyph, exactly as in the till: a free table carries no badge.
 */
/* eslint-disable lingui/no-unlocalized-strings -- These are SVG path commands for
   the badge glyphs, drawn onto a canvas. Path data is geometry, not prose: there
   is no sentence here to translate. */
export const TABLE_STATE_GLYPH = {
  // users — a party is sitting here
  seated:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 0-8 0a4 4 0 1 0 8 0' +
    'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  // receipt-text — an order has been taken
  ordered:
    'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z' +
    'M14 8H8M16 12H8M13 16H8',
  // utensils — the food has arrived
  served:
    'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7',
  // banknote — the bill is on the table
  awaiting_payment:
    'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' +
    'M14 12a2 2 0 1 0-4 0a2 2 0 1 0 4 0M6 12h.01M18 12h.01',
  // sparkles — the table needs wiping before it can seat anyone
  dirty:
    'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936' +
    'A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937' +
    'l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135' +
    'a.5.5 0 0 1-.963 0z',
};
/* eslint-enable lingui/no-unlocalized-strings */

/** Is this a theme the accent table knows? Anything else is the light theme. */
function themeKey(dark) {
  return dark ? 'dark' : 'light';
}

/** Mix `tint` into `base` at `alpha`. Both are `#rrggbb`. */
export function tintFill(base, tint, alpha) {
  const channel = (hex, at) => parseInt(hex.slice(at, at + 2), 16);
  const mix = (at) => Math.round(channel(tint, at) * alpha + channel(base, at) * (1 - alpha));
  const pair = (value) => value.toString(16).padStart(2, '0');
  return `#${pair(mix(1))}${pair(mix(3))}${pair(mix(5))}`;
}

/**
 * Everything the canvas needs to draw one table's state, in one place.
 * `accent` is null for a free table — that null IS the "no state" case, and the
 * screen uses it to leave a free table exactly as it draws today.
 */
export function tableStateVisual(entry, dark) {
  const key = themeKey(dark);
  const named = entry?.state ?? 'open';
  return {
    state: named,
    present: tablePartyPresent(entry),
    accent: TABLE_STATE_ACCENT[key][named] ?? null,
    glyph: TABLE_STATE_GLYPH[named] ?? null,
    hatched: named === 'dirty',
    tint: TABLE_STATE_TINT[key],
    tintAlpha: TABLE_STATE_TINT_ALPHA[key],
  };
}
