import { clampScale, formatScaled } from './inventory-model.js';

/**
 * The count session model (redesign plan D9, phase 2.1).
 *
 * A count is a session, not a grid. The person picks the areas, counts one item
 * at a time, and reviews the result. This module holds every rule of that
 * session. The module holds no JSX, so a unit test can drive a whole session.
 *
 * THE BLIND RULE. The draft holds no system on-hand. The console reads the
 * balances one time only, when the person opens the summary. A screen that
 * cannot read a number cannot show that number.
 *
 * THE ZERO RULE (inventory-model.js §1). An item with no entry is NOT zero. The
 * summary reports that item as uncounted, and `countedLines` leaves it out.
 */

export const DRAFT_VERSION = 1;

/** The three steps of one count session, in order. */
export const STEP_KEYS = ['areas', 'count', 'summary'];

/** The quick-level buttons. A fraction of ONE base unit. */
export const QUICK_LEVELS = [0, 0.25, 0.5, 0.75, 1];

/** The resume key of one location. The id keeps two branches apart. */
export function storageKey(locationId) {
  return `umi.dashboard.inventory.count.${String(locationId || 'no-location')}`;
}

/**
 * The value of one typed entry. A comma is the decimal mark of a Spanish reader.
 * The answer is null when the text is not a quantity.
 */
export function parseQuantity(text) {
  const raw = String(text ?? '').trim();
  if (raw === '') return null;
  const normalised = raw.replace(',', '.');
  if (!/^\d*\.?\d*$/.test(normalised)) return null;
  if (normalised === '.') return null;
  const value = Number(normalised);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** The count of decimal digits in a typed entry. */
export function decimalPlaces(text) {
  const raw = String(text ?? '')
    .trim()
    .replace(',', '.');
  const dot = raw.indexOf('.');
  if (dot === -1) return 0;
  return raw.length - dot - 1;
}

/**
 * The minor units of one typed entry, at the scale of the item. The API holds a
 * quantity as a bare integer at that scale (contract ItemScaleQuantity), so
 * "2.5" on a scale-3 item is 2500. The answer is null when the text is not a
 * quantity, when the text carries more decimals than the scale, or when the
 * value leaves the safe integer range.
 */
export function quantityFrom(text, scale) {
  const value = parseQuantity(text);
  if (value === null) return null;
  const digits = clampScale(scale);
  if (decimalPlaces(text) > digits) return null;
  const minor = Math.round(value * 10 ** digits);
  if (!Number.isSafeInteger(minor)) return null;
  return minor;
}

/**
 * The helper that decides whether a typed entry is a quantity. The scale is
 * optional: without it, the check ignores the decimals of the item.
 */
export function isValidQuantity(text, scale) {
  if (scale === null || scale === undefined) return parseQuantity(text) !== null;
  return quantityFrom(text, scale) !== null;
}

/** The step that follows one step. The last step repeats. */
export function nextStep(step) {
  const index = STEP_KEYS.indexOf(step);
  if (index === -1) return STEP_KEYS[0];
  return STEP_KEYS[Math.min(index + 1, STEP_KEYS.length - 1)];
}

/** The step that comes before one step. The first step repeats. */
export function previousStep(step) {
  const index = STEP_KEYS.indexOf(step);
  if (index === -1) return STEP_KEYS[0];
  return STEP_KEYS[Math.max(index - 1, 0)];
}

function normaliseAreas(areas) {
  return (Array.isArray(areas) ? areas : [])
    .map((area) => ({
      id: String(area?.id ?? ''),
      name: String(area?.name ?? ''),
      note: area?.note == null ? null : String(area.note),
      type: area?.type == null ? null : String(area.type),
      eligible: area?.eligible !== false,
    }))
    .filter((area) => area.id !== '');
}

function normaliseItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: String(item?.id ?? ''),
      name: String(item?.name ?? ''),
      unit: String(item?.unit ?? 'unit'),
      scale: clampScale(item?.scale),
      areaId: item?.areaId == null ? null : String(item.areaId),
    }))
    .filter((item) => item.id !== '');
}

/**
 * The first state of a session. The areas are every area at the location. The
 * items are the catalog. The person selects the areas in step 1.
 */
export function createDraft(input = {}) {
  const { locationId, areas, items } = input || {};
  return {
    version: DRAFT_VERSION,
    locationId: String(locationId ?? ''),
    step: 'areas',
    areas: normaliseAreas(areas),
    selectedAreaIds: [],
    items: normaliseItems(items),
    cursor: 0,
    entries: {},
    counts: {},
  };
}

/** The id of the item after the cursor. Null at the last item. */
export function nextItemId(draft) {
  const items = itemsInScope(draft);
  const next = items[draft?.cursor + 1];
  return next ? next.id : null;
}

/** The id of the item before the cursor. Null at the first item. */
export function previousItemId(draft) {
  const items = itemsInScope(draft);
  const previous = draft?.cursor - 1;
  return previous >= 0 && items[previous] ? items[previous].id : null;
}

/** The items the session counts. One area per item, in the order of the areas. */
export function itemsInScope(draft) {
  if (!draft) return [];
  const selected = new Set(draft.selectedAreaIds || []);
  const mapped = (draft.items || []).filter((item) => item.areaId !== null);
  if (mapped.length === 0) return [...(draft.items || [])];
  if (selected.size === 0) return mapped;
  return mapped.filter((item) => selected.has(item.areaId));
}

/** The item at the cursor. Null when the scope is empty. */
export function currentItem(draft) {
  const items = itemsInScope(draft);
  return items[draft?.cursor] || null;
}

/** The running "N de M" of the count step. */
export function position(draft) {
  const items = itemsInScope(draft);
  return {
    index: items.length === 0 ? 0 : Math.min(draft?.cursor ?? 0, items.length - 1) + 1,
    total: items.length,
  };
}

/** One area of the session, by id. */
export function areaById(draft, areaId) {
  return (draft?.areas || []).find((area) => area.id === areaId) || null;
}

/** Select or clear one area. Without `selected`, the function toggles the area. */
export function selectArea(draft, areaId, selected) {
  const id = String(areaId);
  const has = (draft?.selectedAreaIds || []).includes(id);
  const wanted = selected === undefined || selected === null ? !has : selected === true;
  let ids = draft?.selectedAreaIds || [];
  if (wanted && !has) ids = [...ids, id];
  if (!wanted && has) ids = ids.filter((value) => value !== id);
  return { ...draft, selectedAreaIds: ids };
}

/** Move the session to one step. An unknown step does not change the draft. */
export function setStep(draft, step) {
  if (!STEP_KEYS.includes(step)) return draft;
  const items = itemsInScope({ ...draft, step });
  const cursor = Math.min(Math.max(0, draft?.cursor ?? 0), Math.max(0, items.length - 1));
  return { ...draft, step, cursor };
}

/** Move the cursor to one item, by index. */
export function setCursor(draft, index) {
  const items = itemsInScope(draft);
  const cursor = Math.min(
    Math.max(0, Math.trunc(Number(index) || 0)),
    Math.max(0, items.length - 1),
  );
  return { ...draft, cursor };
}

/** Move the cursor to one item, by id. */
export function moveToItem(draft, itemId) {
  const items = itemsInScope(draft);
  const index = items.findIndex((item) => item.id === String(itemId));
  if (index === -1) return draft;
  return { ...draft, cursor: index };
}

/**
 * Record one typed entry. The draft keeps the RAW text, because "12.", "12" and
 * "" are three different inputs while the person types.
 */
export function setCount(draft, itemId, text) {
  const id = String(itemId);
  const raw = text === null || text === undefined ? '' : String(text);
  const entries = { ...(draft?.entries || {}) };
  if (raw === '') delete entries[id];
  else entries[id] = raw;
  return { ...draft, entries };
}

/** One entry of the draft, with its parsed value and its validity. */
export function entryFor(draft, itemId) {
  const item = (draft?.items || []).find((value) => value.id === String(itemId));
  if (!item) return null;
  const has = Object.prototype.hasOwnProperty.call(draft?.entries || {}, item.id);
  if (!has) return null;
  const text = draft.entries[item.id];
  const value = quantityFrom(text, item.scale);
  return { item, text, value, valid: value !== null };
}

/** The items with a valid entry, in the count order. */
export function countedItems(draft) {
  return itemsInScope(draft)
    .map((item) => {
      const entry = entryFor(draft, item.id);
      return entry && entry.valid ? { item, text: entry.text, value: entry.value } : null;
    })
    .filter(Boolean);
}

/**
 * The submitted shape: one line per counted item, and nothing for an item with
 * no entry. The count scope is the set of these lines, so an uncounted item is
 * never sent as zero.
 */
export function countedLines(draft) {
  return countedItems(draft).map(({ item, value }) => ({
    inventoryItemId: item.id,
    counted: { value, scale: item.scale, unit: item.unit },
    note: null,
  }));
}

/** The item ids of one area, in the count order. */
export function countedItemIdsInArea(draft, areaId) {
  const id = String(areaId);
  return countedItems(draft)
    .filter(({ item }) => item.areaId === id)
    .map(({ item }) => item.id);
}

/** The counted lines of one area. */
export function countedLinesInArea(draft, areaId) {
  const id = String(areaId);
  return countedItems(draft)
    .filter(({ item }) => item.areaId === id)
    .map(({ item, value }) => ({
      inventoryItemId: item.id,
      counted: { value, scale: item.scale, unit: item.unit },
      note: null,
    }));
}

function systemAmount(of, itemId) {
  if (of instanceof Map) {
    const value = of.get(itemId);
    return value === null || value === undefined ? null : Number(value);
  }
  const value = Object.prototype.hasOwnProperty.call(of || {}, itemId) ? of[itemId] : null;
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * The lines of the summary. The delta is SIGNED and it is counted minus system.
 * An item with no balance row reports `system: null` and `delta: null`, because
 * an absent row is not a zero.
 */
export function summary(draft, onHandByItemId = {}) {
  const scope = itemsInScope(draft);
  const lines = [];
  const uncounted = [];
  const invalid = [];
  for (const item of scope) {
    const entry = entryFor(draft, item.id);
    const area = areaById(draft, item.areaId);
    if (entry && entry.valid) {
      const system = systemAmount(onHandByItemId, item.id);
      const delta = system === null ? null : entry.value - system;
      lines.push({
        itemId: item.id,
        name: item.name,
        unit: item.unit,
        scale: item.scale,
        areaId: item.areaId,
        areaName: area ? area.name : null,
        counted: entry.value,
        system,
        delta,
        countedText: formatScaled(entry.value, item.scale),
        systemText: system === null ? null : formatScaled(system, item.scale),
        deltaText: delta === null ? null : formatScaled(delta, item.scale),
      });
      continue;
    }
    const row = {
      itemId: item.id,
      name: item.name,
      areaId: item.areaId,
      areaName: area ? area.name : null,
      text: entry ? entry.text : null,
    };
    if (entry) invalid.push(row);
    uncounted.push({ ...row, invalid: Boolean(entry) });
  }
  return {
    lines,
    countedCount: lines.length,
    totalCount: scope.length,
    uncounted,
    uncountedCount: uncounted.length,
    invalid,
  };
}

/** Attach the balance holdings of each area to the items. The first area wins. */
export function applyAreaAssignments(draft, assignments) {
  const rows = Array.isArray(assignments) ? assignments : [];
  if (rows.length === 0) return draft;
  const known = new Map((draft?.items || []).map((item) => [item.id, item]));
  for (const row of rows) {
    if (!row || row.id === undefined || row.id === null) continue;
    const id = String(row.id);
    if (known.has(id)) continue;
    known.set(
      id,
      normaliseItems([
        {
          id,
          name: row.name,
          unit: row.unit,
          scale: row.scale,
          areaId: row.areaId,
        },
      ])[0],
    );
  }
  const order = new Map((draft?.areas || []).map((area, index) => [area.id, index]));
  const items = [];
  for (const item of known.values()) {
    const areaId = rows.find((row) => String(row?.id) === item.id)?.areaId;
    if (areaId === undefined || areaId === null) {
      items.push({ ...item, areaId: null });
      continue;
    }
    const next = { ...item, areaId: String(areaId) };
    const index = items.findIndex((value) => value.id === next.id);
    if (index === -1) items.push(next);
  }
  items.sort((left, right) => {
    const leftArea = order.has(left.areaId) ? order.get(left.areaId) : Number.MAX_SAFE_INTEGER;
    const rightArea = order.has(right.areaId) ? order.get(right.areaId) : Number.MAX_SAFE_INTEGER;
    if (leftArea !== rightArea) return leftArea - rightArea;
    if (left.name !== right.name) return left.name < right.name ? -1 : 1;
    return left.id < right.id ? -1 : 1;
  });
  return { ...draft, items, cursor: 0 };
}

const COUNT_PHASES = ['created', 'submitted', 'done'];

function normaliseVariances(variances) {
  return (Array.isArray(variances) ? variances : [])
    .map((variance) => ({
      inventoryItemId: String(variance?.inventoryItemId ?? ''),
      absolute: Number(variance?.absolute?.value ?? variance?.absolute ?? 0),
    }))
    .filter((variance) => variance.inventoryItemId !== '');
}

/**
 * Keep the progress of one area, so a retry does not create a second count and
 * does not submit a count that the server already took. The lost count is the
 * worst failure of the category (plan §3, D9).
 */
export function recordCount(draft, inventoryLocationId, count) {
  if (!count || typeof count.id !== 'string' || count.id === '') return draft;
  return {
    ...draft,
    counts: {
      ...(draft?.counts || {}),
      [String(inventoryLocationId)]: {
        id: count.id,
        attempt: count.attempt ?? null,
        snapshotLedgerSequence: count.snapshotLedgerSequence ?? null,
        phase: COUNT_PHASES.includes(count.phase) ? count.phase : 'created',
        variances: normaliseVariances(count.variances),
      },
    },
  };
}

/** The created count of one area, or null. */
export function countFor(draft, inventoryLocationId) {
  const row = (draft?.counts || {})[String(inventoryLocationId)];
  return row && typeof row.id === 'string' ? row : null;
}

/** The draft as one string for `sessionStorage`. */
export function serialise(draft) {
  return JSON.stringify(draft);
}

function validStep(step) {
  return STEP_KEYS.includes(step);
}

/**
 * A draft from one stored string. The answer is null for anything malformed, so
 * a broken payload starts a new session and never throws at the screen.
 */
export function deserialise(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.version !== DRAFT_VERSION) return null;
  if (typeof parsed.locationId !== 'string') return null;
  if (!validStep(parsed.step)) return null;
  if (!Array.isArray(parsed.areas) || !Array.isArray(parsed.items)) return null;
  if (!Array.isArray(parsed.selectedAreaIds)) return null;
  if (!parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
    return null;
  }
  const areas = normaliseAreas(parsed.areas);
  if (areas.length !== parsed.areas.length) return null;
  const items = normaliseItems(parsed.items);
  if (items.length !== parsed.items.length) return null;
  const areaIds = new Set(areas.map((area) => area.id));
  const selectedAreaIds = parsed.selectedAreaIds.map((value) => String(value));
  if (selectedAreaIds.some((id) => !areaIds.has(id))) return null;
  for (const item of items) {
    if (item.areaId !== null && !areaIds.has(item.areaId)) item.areaId = null;
  }
  const entries = {};
  for (const [key, value] of Object.entries(parsed.entries)) {
    if (typeof value !== 'string') return null;
    entries[String(key)] = value;
  }
  const counts = {};
  const storedCounts = parsed.counts && typeof parsed.counts === 'object' ? parsed.counts : {};
  for (const [key, value] of Object.entries(storedCounts)) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string') continue;
    counts[String(key)] = {
      id: value.id,
      attempt: Number.isInteger(value.attempt) ? value.attempt : null,
      snapshotLedgerSequence: Number.isInteger(value.snapshotLedgerSequence)
        ? value.snapshotLedgerSequence
        : null,
      phase: COUNT_PHASES.includes(value.phase) ? value.phase : 'created',
      variances: normaliseVariances(value.variances),
    };
  }
  const cursor = Number.isInteger(parsed.cursor) && parsed.cursor >= 0 ? parsed.cursor : 0;
  return {
    version: DRAFT_VERSION,
    locationId: parsed.locationId,
    step: parsed.step,
    areas,
    selectedAreaIds,
    items,
    cursor,
    entries,
    counts,
  };
}
