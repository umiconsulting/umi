import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FloorPlanDocument, PublishedFloorPlan } from '../dist/index.js';

const element = {
  id: '00000000-0000-4000-8000-000000000002',
  kind: 'table',
  shape: 'rectangle',
  label: 'T1',
  capacity: 4,
  x: 100,
  y: 100,
  width: 80,
  height: 60,
  rotation: 0,
};
const document = () => ({
  schemaVersion: 1,
  areas: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Patio',
      width: 1000,
      height: 700,
      elements: [{ ...element }],
    },
  ],
});
test('layout validates rotated bounds, table identity, labels, and capacity', () => {
  assert.equal(FloorPlanDocument.safeParse(document()).success, true);
  for (const patch of [{ x: 20 }, { x: 35, rotation: 45 }, { capacity: 0 }, { shape: 'round' }]) {
    const value = document();
    value.areas[0].elements[0] = { ...element, ...patch };
    assert.equal(FloorPlanDocument.safeParse(value).success, false);
  }
  const duplicate = document();
  duplicate.areas[0].elements.push({ ...element });
  assert.equal(FloorPlanDocument.safeParse(duplicate).success, false);
  duplicate.areas[0].elements[1].id = '00000000-0000-4000-8000-000000000003';
  assert.equal(FloorPlanDocument.safeParse(duplicate).success, false);
});
test('published response rejects draft fields', () => {
  const state = { locationId: element.id, publishedVersion: 0, published: null, publishedAt: null };
  assert.equal(PublishedFloorPlan.safeParse(state).success, true);
  assert.equal(PublishedFloorPlan.safeParse({ ...state, draft: document() }).success, false);
});
