import { floorElementBounds } from '@umi/contract/floor-plan';

export function createLayout(name) {
  return {
    schemaVersion: 1,
    areas: [{ id: crypto.randomUUID(), name, width: 1200, height: 800, elements: [] }],
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
