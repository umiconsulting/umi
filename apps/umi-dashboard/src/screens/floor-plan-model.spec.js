import { describe, expect, it } from 'vitest';
import { duplicateElement, fitElement, layoutHistory } from './floor-plan-model';

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
});
