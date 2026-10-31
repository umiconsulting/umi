/**
 * The editor model for a product's sellable forms and add-on choices.
 *
 * The server stores money as integer minor units. The dashboard must keep that
 * exact shape; rounding a price in the browser is how a menu and a receipt stop
 * agreeing. Blank rows are editing state, not products, so the save payload drops
 * them and the server receives only complete choices.
 */

export function blankVariant(id = crypto.randomUUID()) {
  return {
    id,
    name: '',
    priceDelta: 0,
    active: true,
    attributes: {},
  };
}

export function blankModifier(id = crypto.randomUUID(), displayOrder = 0) {
  return {
    id,
    name: '',
    priceDelta: 0,
    active: true,
    displayOrder,
  };
}

export function blankOptionGroup(id = crypto.randomUUID(), displayOrder = 0) {
  return {
    id,
    name: '',
    required: false,
    minSelections: 0,
    maxSelections: null,
    active: true,
    displayOrder,
    modifiers: [blankModifier(undefined, 0)],
  };
}

export function variantFromServer(variant, index) {
  return {
    id: variant.id || crypto.randomUUID(),
    name: variant.name || '',
    priceDelta: Number(variant.priceDelta) || 0,
    active: variant.active !== false,
    attributes:
      variant.attributes && typeof variant.attributes === 'object' ? { ...variant.attributes } : {},
    displayOrder: Number(variant.displayOrder ?? index) || 0,
  };
}

export function optionGroupFromServer(group, index) {
  return {
    id: group.id || crypto.randomUUID(),
    name: group.name || '',
    required: group.required === true || Number(group.minSelections) > 0,
    minSelections: Number(group.minSelections) || 0,
    maxSelections:
      group.maxSelections === null || group.maxSelections === undefined
        ? null
        : Number(group.maxSelections),
    active: group.active !== false,
    displayOrder: Number(group.displayOrder ?? index) || 0,
    modifiers: (group.modifiers || []).map((modifier, modifierIndex) => ({
      id: modifier.id || crypto.randomUUID(),
      name: modifier.name || '',
      priceDelta: Number(modifier.priceDelta) || 0,
      active: modifier.active !== false,
      displayOrder: Number(modifier.displayOrder ?? modifierIndex) || 0,
    })),
  };
}

export function variantPrice(basePriceMinor, priceDeltaMinor) {
  return (Number(basePriceMinor) || 0) + (Number(priceDeltaMinor) || 0);
}

export function catalogChoicesPayload(variants, optionGroups) {
  return {
    variants: (variants || [])
      .map((variant, index) => ({
        ...variant,
        name: String(variant.name || '').trim(),
        displayOrder: index,
      }))
      .filter((variant) => variant.name.length > 0)
      .map((variant) => ({
        id: variant.id,
        name: variant.name,
        priceDelta: Number(variant.priceDelta) || 0,
        active: variant.active !== false,
        attributes: variant.attributes || {},
        displayOrder: variant.displayOrder,
      })),
    optionGroups: (optionGroups || [])
      .map((group, index) => ({
        ...group,
        name: String(group.name || '').trim(),
        displayOrder: index,
        modifiers: (group.modifiers || [])
          .map((modifier, modifierIndex) => ({
            ...modifier,
            name: String(modifier.name || '').trim(),
            displayOrder: modifierIndex,
          }))
          .filter((modifier) => modifier.name.length > 0)
          .map((modifier) => ({
            id: modifier.id,
            name: modifier.name,
            priceDelta: Number(modifier.priceDelta) || 0,
            active: modifier.active !== false,
            displayOrder: modifier.displayOrder,
          })),
      }))
      .filter((group) => group.name.length > 0)
      .map((group) => ({
        id: group.id,
        name: group.name,
        required: group.required === true || Number(group.minSelections) > 0,
        minSelections: Number(group.minSelections) || 0,
        maxSelections:
          group.maxSelections === null || group.maxSelections === undefined
            ? null
            : Number(group.maxSelections),
        active: group.active !== false,
        displayOrder: group.displayOrder,
        modifiers: group.modifiers,
      })),
  };
}

/** Send only deliberate edits to the direct inventory link. */
export function catalogInventoryPatch(value, savedValue) {
  return value === savedValue ? {} : { inventoryItemId: value || null };
}
