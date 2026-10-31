/** Parse decimal digits directly so preparation never rounds a quantity. */
export function preparationQuantity(text, item) {
  if (
    !item ||
    !Number.isInteger(item.quantityScale) ||
    item.quantityScale < 0 ||
    item.quantityScale > 6
  )
    return null;
  const raw = String(text ?? '')
    .trim()
    .replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [whole, decimal = ''] = raw.split('.');
  if (decimal.length > item.quantityScale) return null;
  const value = Number(`${whole}${decimal.padEnd(item.quantityScale, '0')}`);
  return Number.isSafeInteger(value) && value > 0
    ? { value, scale: item.quantityScale, unit: item.baseUnit }
    : null;
}

export function preparationSelectionKey({ itemId, locationId, inventoryLocationId, quantity }) {
  return JSON.stringify([
    itemId,
    locationId,
    inventoryLocationId,
    quantity?.value,
    quantity?.scale,
    quantity?.unit,
  ]);
}

export function preparationPreviewMatches(reviewed, selection) {
  return Boolean(
    selection.quantity &&
    reviewed?.result &&
    reviewed.selectionKey === preparationSelectionKey(selection),
  );
}

export function preparationRecipes(recipes, items) {
  const byId = new Map(
    items
      .filter((item) => !item.archived && !item.archivedAt && item.active !== false)
      .map((item) => [item.id, item]),
  );
  return recipes
    .filter(
      (recipe) => recipe.active !== false && recipe.targetItemId && byId.has(recipe.targetItemId),
    )
    .map((recipe) => ({ recipe, item: byId.get(recipe.targetItemId) }));
}

/** Keep a failed or incomplete read as an error, including a broken cursor. */
export async function loadPreparationPages(fetchPage, field) {
  const rows = [];
  const cursors = new Set();
  let cursor = null;
  for (let page = 0; page < 1000; page += 1) {
    const response = await fetchPage(cursor);
    rows.push(...(response?.[field] || []));
    if (!response?.page?.hasMore) return rows;
    cursor = response.page.nextCursor;
    if (!cursor || cursors.has(cursor)) break;
    cursors.add(cursor);
  }
  throw new Error('INVENTORY_PREPARATION_PAGES_INCOMPLETE');
}
