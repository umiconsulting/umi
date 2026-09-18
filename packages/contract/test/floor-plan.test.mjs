import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FloorPlanDocument, PublishedFloorPlan, floorElementBounds } from '../dist/index.js';

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

const area = (id, name, elements = []) => ({
  // Areas live in their own id space (variant nibble 9) so a collision in a test case
  // is the one being asserted, never an accident of the fixture.
  id: `00000000-0000-4000-9000-00000000000${id}`,
  name,
  width: 1000,
  height: 700,
  elements,
});

test('a layout rejects duplicate area names, compared case-insensitively', () => {
  const two = (secondName) => ({
    schemaVersion: 1,
    areas: [area(1, 'Patio'), area(2, secondName)],
  });
  assert.equal(FloorPlanDocument.safeParse(two('Terraza')).success, true);
  // The name is the merchant's handle for the area, so 'Patio' and 'patio' are one area.
  assert.equal(FloorPlanDocument.safeParse(two('Patio')).success, false);
  assert.equal(FloorPlanDocument.safeParse(two('patio')).success, false);
});

test('identities are unique across the document, not just within an area', () => {
  const shared = area(2, 'Terraza', [{ ...element }]);
  const clash = { schemaVersion: 1, areas: [area(3, 'Patio', [{ ...element }]), shared] };
  assert.equal(FloorPlanDocument.safeParse(clash).success, false);
  shared.elements[0].id = '00000000-0000-4000-8000-000000000004';
  shared.elements[0].label = 'T2';
  assert.equal(FloorPlanDocument.safeParse(clash).success, true);
  // Two areas may not carry the same id either, even with different names.
  const areas = { schemaVersion: 1, areas: [area(1, 'Patio'), area(1, 'Terraza')] };
  assert.equal(FloorPlanDocument.safeParse(areas).success, false);
});

test('unknown keys are rejected at every level', () => {
  const extraElement = document();
  extraElement.areas[0].elements[0].colour = 'red';
  assert.equal(FloorPlanDocument.safeParse(extraElement).success, false);

  const extraArea = document();
  extraArea.areas[0].floor = 2;
  assert.equal(FloorPlanDocument.safeParse(extraArea).success, false);

  const extraDocument = { ...document(), publishedAt: null };
  assert.equal(FloorPlanDocument.safeParse(extraDocument).success, false);
});

test('floorElementBounds swaps the half-extents on a quarter turn', () => {
  const close = (actual, expected) =>
    assert.ok(
      Math.abs(actual - expected) < 1e-9,
      `expected ~${expected}, received ${actual} — the rotated bound is not the rotated extent`,
    );
  // Unrotated, the half-extents are half the width and half the height.
  const flat = floorElementBounds({ width: 80, height: 60, rotation: 0 });
  close(flat.halfWidth, 40);
  close(flat.halfHeight, 30);
  // At 90° the box's width is the element's height, so the extents swap.
  const quarter = floorElementBounds({ width: 80, height: 60, rotation: 90 });
  close(quarter.halfWidth, 30);
  close(quarter.halfHeight, 40);
  // A half turn is the identity again.
  const half = floorElementBounds({ width: 80, height: 60, rotation: 180 });
  close(half.halfWidth, 40);
  close(half.halfHeight, 30);
  // A rotated square occupies its own half-diagonal (40 at 45°), so the bounding
  // box grows past the unrotated 40 — it is not clamped back to half the side.
  const diagonal = floorElementBounds({ width: 80, height: 80, rotation: 45 });
  close(diagonal.halfWidth, 40 * Math.SQRT2);
});
