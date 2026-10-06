import { describe, expect, it } from 'vitest';
import {
  applyAreaAssignments,
  countFor,
  countedItemIdsInArea,
  countedLines,
  createDraft,
  currentItem,
  deserialise,
  entryFor,
  isValidQuantity,
  itemsInScope,
  moveToItem,
  nextItemId,
  position,
  previousItemId,
  quantityFrom,
  recordCount,
  selectArea,
  serialise,
  setCount,
  setStep,
  storageKey,
  summary,
} from './inventory-count-model.js';

const AREAS = [
  { id: 'area-walk-in', name: 'Walk-in', type: 'stock_room' },
  { id: 'area-bar', name: 'Barra', type: 'bar_storage' },
];

const ITEMS = [
  { id: 'item-milk', name: 'Leche entera', unit: 'liter', scale: 3, areaId: 'area-walk-in' },
  { id: 'item-pork', name: 'Chicharrón', unit: 'kilogram', scale: 3, areaId: 'area-walk-in' },
  { id: 'item-beer', name: 'Cerveza', unit: 'unit', scale: 0, areaId: 'area-bar' },
];

function draftWithAreas() {
  let draft = createDraft({ locationId: 'loc-1', areas: AREAS, items: ITEMS });
  draft = selectArea(draft, 'area-walk-in');
  draft = selectArea(draft, 'area-bar');
  return setStep(draft, 'count');
}

describe('the typed quantity', () => {
  it('keeps "12." as a quantity while the person types', () => {
    expect(isValidQuantity('12.')).toBe(true);
    expect(quantityFrom('12.', 0)).toBe(12);
    expect(isValidQuantity('12.')).toBe(true);
  });

  it('reads a comma as a decimal mark', () => {
    expect(isValidQuantity('1,5')).toBe(true);
    expect(quantityFrom('1,5', 1)).toBe(15);
  });

  it('refuses an empty entry, a lone dot, a negative number and a second dot', () => {
    expect(isValidQuantity('')).toBe(false);
    expect(isValidQuantity('.')).toBe(false);
    expect(isValidQuantity('-3')).toBe(false);
    expect(isValidQuantity('1.2.3')).toBe(false);
    expect(isValidQuantity('doce')).toBe(false);
  });

  it('scales the typed decimal onto the minor units of the item', () => {
    expect(quantityFrom('2.5', 3)).toBe(2500);
    expect(quantityFrom('2.5', 0)).toBe(null);
    expect(quantityFrom('12', 0)).toBe(12);
  });

  it('refuses more decimals than the item scale holds', () => {
    expect(isValidQuantity('1.234', 2)).toBe(false);
    expect(isValidQuantity('1.234', 3)).toBe(true);
    expect(isValidQuantity('1.234')).toBe(true);
  });
});

describe('the session key', () => {
  it('names the merchant location, so two branches do not share a draft', () => {
    expect(storageKey('loc-1')).toContain('loc-1');
    expect(storageKey('loc-1')).not.toBe(storageKey('loc-2'));
  });
});

describe('the first state', () => {
  it('opens on the area step with no selection and no entry', () => {
    const draft = createDraft({ locationId: 'loc-1', areas: AREAS, items: ITEMS });
    expect(draft.step).toBe('areas');
    expect(draft.selectedAreaIds).toEqual([]);
    expect(draft.entries).toEqual({});
    expect(draft.cursor).toBe(0);
  });

  it('survives missing argument', () => {
    const draft = createDraft();
    expect(draft.areas).toEqual([]);
    expect(draft.items).toEqual([]);
    expect(draft.locationId).toBe('');
  });
});

describe('the area selection', () => {
  it('toggles one area without touching the others', () => {
    let draft = createDraft({ locationId: 'loc-1', areas: AREAS, items: ITEMS });
    draft = selectArea(draft, 'area-bar');
    expect(draft.selectedAreaIds).toEqual(['area-bar']);
    draft = selectArea(draft, 'area-bar');
    expect(draft.selectedAreaIds).toEqual([]);
  });

  it('keeps the selection the caller asks for', () => {
    const draft = selectArea(
      createDraft({ locationId: 'loc-1', areas: AREAS, items: ITEMS }),
      'area-bar',
      true,
    );
    expect(draft.selectedAreaIds).toEqual(['area-bar']);
  });
});

describe('one item at a time', () => {
  it('keeps the raw text of a partial entry', () => {
    const draft = setCount(draftWithAreas(), 'item-milk', '12.');
    expect(draft.entries['item-milk']).toBe('12.');
  });

  it('does not change the draft that it reads', () => {
    const before = draftWithAreas();
    const after = setCount(before, 'item-milk', '3');
    expect(before.entries).toEqual({});
    expect(after.entries).toEqual({ 'item-milk': '3' });
  });

  it('clears an entry when the text is empty', () => {
    let draft = setCount(draftWithAreas(), 'item-milk', '3');
    draft = setCount(draft, 'item-milk', '');
    expect(draft.entries).toEqual({});
  });

  it('reports the position and the neighbours of the cursor', () => {
    const draft = draftWithAreas();
    expect(position(draft)).toEqual({ index: 1, total: 3 });
    expect(currentItem(draft).id).toBe('item-milk');
    expect(nextItemId(draft)).toBe('item-pork');
    expect(previousItemId(draft)).toBe(null);
    const second = moveToItem(draft, 'item-milk');
    expect(second.cursor).toBe(0);
    expect(previousItemId(second)).toBe(null);
  });

  it('stops at the end of the scope', () => {
    const draft = moveToItem(draftWithAreas(), 'item-beer');
    expect(nextItemId(draft)).toBe(null);
    expect(previousItemId(draft)).toBe('item-pork');
    expect(currentItem(draft).id).toBe('item-beer');
  });
});

describe('the scope of the count', () => {
  it('holds only the items of the selected areas', () => {
    let draft = createDraft({ locationId: 'loc-1', areas: AREAS, items: ITEMS });
    draft = selectArea(draft, 'area-bar');
    expect(itemsInScope(draft).map((item) => item.id)).toEqual(['item-beer']);
  });

  it('places an item in the first area that holds a balance', () => {
    const draft = applyAreaAssignments(createDraft({ locationId: 'loc-1', areas: AREAS }), [
      { id: 'item-milk', name: 'Leche entera', unit: 'liter', scale: 3, areaId: 'area-walk-in' },
      { id: 'item-milk', name: 'Leche entera', unit: 'liter', scale: 3, areaId: 'area-bar' },
      { id: 'item-beer', name: 'Cerveza', unit: 'unit', scale: 0, areaId: 'area-bar' },
    ]);
    expect(draft.items.map((item) => [item.id, item.areaId])).toEqual([
      ['item-milk', 'area-walk-in'],
      ['item-beer', 'area-bar'],
    ]);
  });
});

describe('the submitted lines', () => {
  it('holds one line per counted item, at the scale of the item', () => {
    let draft = draftWithAreas();
    draft = setCount(draft, 'item-milk', '2.5');
    expect(countedLines(draft)).toEqual([
      {
        inventoryItemId: 'item-milk',
        counted: { value: 2500, scale: 3, unit: 'liter' },
        note: null,
      },
    ]);
  });

  it('leaves out an uncounted item instead of treating it as zero', () => {
    const draft = setCount(draftWithAreas(), 'item-milk', '2.5');
    const lines = countedLines(draft);
    expect(lines).toHaveLength(1);
    expect(lines.some((line) => line.inventoryItemId === 'item-pork')).toBe(false);
  });

  it('leaves out an entry that the item scale cannot hold', () => {
    const draft = setCount(draftWithAreas(), 'item-beer', '0.5');
    expect(entryFor(draft, 'item-beer').valid).toBe(false);
    expect(countedLines(draft)).toEqual([]);
  });

  it('groups the ids by area for one count per area', () => {
    let draft = draftWithAreas();
    draft = setCount(draft, 'item-milk', '2.5');
    draft = setCount(draft, 'item-beer', '12');
    expect(countedItemIdsInArea(draft, 'area-walk-in')).toEqual(['item-milk']);
    expect(countedItemIdsInArea(draft, 'area-bar')).toEqual(['item-beer']);
  });
});

describe('the summary', () => {
  it('signs the delta against the system amount', () => {
    const draft = setCount(draftWithAreas(), 'item-milk', '9');
    const result = summary(draft, { 'item-milk': 12000 });
    expect(result.lines[0]).toMatchObject({
      itemId: 'item-milk',
      counted: 9000,
      system: 12000,
      delta: -3000,
      deltaText: '-3',
    });
  });

  it('reports an increase as a positive delta', () => {
    const draft = setCount(draftWithAreas(), 'item-milk', '15');
    const result = summary(draft, { 'item-milk': 12000 });
    expect(result.lines[0].delta).toBe(3000);
    expect(result.lines[0].deltaText).toBe('3');
  });

  it('reports an absent balance as no read, not as a zero', () => {
    const draft = setCount(draftWithAreas(), 'item-milk', '9');
    const result = summary(draft, {});
    expect(result.lines[0].system).toBe(null);
    expect(result.lines[0].delta).toBe(null);
    expect(result.lines[0].systemText).toBe(null);
  });

  it('names every uncounted item', () => {
    const draft = setCount(draftWithAreas(), 'item-milk', '9');
    const result = summary(draft, { 'item-milk': 12000 });
    expect(result.countedCount).toBe(1);
    expect(result.totalCount).toBe(3);
    expect(result.uncounted.map((row) => row.itemId)).toEqual(['item-pork', 'item-beer']);
    expect(result.uncountedCount).toBe(2);
  });

  it('marks an entry that the item scale cannot hold', () => {
    const draft = setCount(draftWithAreas(), 'item-beer', '0.5');
    const result = summary(draft, {});
    expect(result.invalid.map((row) => row.itemId)).toEqual(['item-beer']);
    expect(result.uncounted.find((row) => row.itemId === 'item-beer').invalid).toBe(true);
    expect(result.countedCount).toBe(0);
  });
});

describe('the resume payload', () => {
  it('round trips a draft at the same step and the same item', () => {
    let draft = setCount(draftWithAreas(), 'item-pork', '1.25');
    draft = moveToItem(draft, 'item-pork');
    const restored = deserialise(serialise(draft));
    expect(restored.step).toBe('count');
    expect(restored.cursor).toBe(1);
    expect(currentItem(restored).id).toBe('item-pork');
    expect(restored.entries).toEqual({ 'item-pork': '1.25' });
    expect(restored.selectedAreaIds).toEqual(['area-walk-in', 'area-bar']);
  });

  it('keeps the created count, so a retry reuses it', () => {
    let draft = draftWithAreas();
    draft = recordCount(draft, 'area-walk-in', {
      id: 'count-1',
      attempt: 1,
      snapshotLedgerSequence: 42,
    });
    const restored = deserialise(serialise(draft));
    expect(countFor(restored, 'area-walk-in')).toEqual({
      id: 'count-1',
      attempt: 1,
      snapshotLedgerSequence: 42,
      phase: 'created',
      variances: [],
    });
  });

  it('keeps the phase of an area, so a retry does not submit a count twice', () => {
    let draft = draftWithAreas();
    draft = recordCount(draft, 'area-walk-in', {
      id: 'count-1',
      attempt: 1,
      snapshotLedgerSequence: 42,
      phase: 'submitted',
      variances: [
        { inventoryItemId: 'item-milk', absolute: { value: 3000 } },
        { inventoryItemId: 'item-pork', absolute: { value: 0 } },
      ],
    });
    const restored = deserialise(serialise(draft));
    expect(countFor(restored, 'area-walk-in').phase).toBe('submitted');
    expect(countFor(restored, 'area-walk-in').variances).toEqual([
      { inventoryItemId: 'item-milk', absolute: 3000 },
      { inventoryItemId: 'item-pork', absolute: 0 },
    ]);
  });

  it('refuses a count with no id', () => {
    const draft = draftWithAreas();
    expect(recordCount(draft, 'area-walk-in', null)).toBe(draft);
    expect(recordCount(draft, 'area-walk-in', { attempt: 1 })).toBe(draft);
  });

  it('answers null for a malformed payload instead of throwing', () => {
    expect(deserialise(null)).toBe(null);
    expect(deserialise('')).toBe(null);
    expect(deserialise('not json')).toBe(null);
    expect(deserialise('[]')).toBe(null);
    expect(deserialise('{}')).toBe(null);
    expect(deserialise('{"version":99}')).toBe(null);
    expect(deserialise('{"version":1,"locationId":"loc-1","step":"nope"}')).toBe(null);
    expect(
      deserialise(
        JSON.stringify({
          version: 1,
          locationId: 'loc-1',
          step: 'count',
          areas: [],
          selectedAreaIds: [],
          items: [{}],
          entries: {},
        }),
      ),
    ).toBe(null);
  });

  it('drops a selected area that the draft no longer holds', () => {
    const raw = JSON.stringify({
      version: 1,
      locationId: 'loc-1',
      step: 'areas',
      areas: AREAS,
      selectedAreaIds: ['area-gone'],
      items: ITEMS,
      entries: {},
      cursor: 0,
      counts: {},
    });
    expect(deserialise(raw)).toBe(null);
  });
});

describe('the step', () => {
  it('refuses a step that does not exist', () => {
    const draft = draftWithAreas();
    expect(setStep(draft, 'nope').step).toBe('count');
    expect(setStep(draft, 'summary').step).toBe('summary');
  });
});
