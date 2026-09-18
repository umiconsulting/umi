// Zod guards for the recipes and inventory authoring surface (recipes module plan
// §5 and §6). Runs against the BUILT dist, so `pnpm --filter @umi/contract build`
// comes first. Each guard is checked for one representative accept and for the
// refusal its own rule states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InventoryAuthoringItemCreateRequest,
  InventoryQuantity,
  InventoryRecipeComponentInput,
  InventoryRecipeCreateRequest,
  SupplierInvoiceUploadRequest,
} from '../dist/index.js';

const uuid = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

const command = { commandId: uuid('1'), idempotencyKey: uuid('2') };

const ingredient = (itemId) => ({
  inventoryItemId: itemId,
  quantity: { value: 250, scale: 0, unit: 'gram' },
});

test('InventoryAuthoringItemCreateRequest accepts a valid ingredient', () => {
  const parsed = InventoryAuthoringItemCreateRequest.safeParse({
    ...command,
    publicReference: 'ING-001',
    displayName: 'Harina',
    itemType: 'ingredient',
    baseUnit: 'kilogram',
    quantityScale: 3,
    trackingPolicy: 'tracked',
    negativeStockPolicy: 'block',
    // The threshold is at the item's OWN scale, so it is a bare integer: the item
    // record already carries quantityScale and baseUnit.
    lowStockThreshold: 5000,
    shelfLifeDays: 90,
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.lowStockThreshold, 5000);
  // Omitted on purpose: the item exists without an opening balance anywhere.
});

test('InventoryAuthoringItemCreateRequest refuses a reference the database would refuse', () => {
  const parsed = InventoryAuthoringItemCreateRequest.safeParse({
    ...command,
    publicReference: 'not a reference',
    displayName: 'Harina',
    itemType: 'ingredient',
    baseUnit: 'kilogram',
    quantityScale: 3,
    trackingPolicy: 'tracked',
    negativeStockPolicy: 'block',
  });
  assert.equal(parsed.success, false);
});

test('a float quantity is refused — money and quantities are integers', () => {
  assert.equal(InventoryQuantity.safeParse({ value: 1.5, scale: 1, unit: 'gram' }).success, false);
  assert.ok(InventoryQuantity.safeParse({ value: 15, scale: 1, unit: 'gram' }).success);

  const parsed = InventoryRecipeComponentInput.safeParse({
    inventoryItemId: uuid('3'),
    quantity: { value: 0.25, scale: 2, unit: 'liter' },
  });
  assert.equal(parsed.success, false);
});

test('a recipe component must be more than zero, which is what the database stores', () => {
  const zero = InventoryRecipeComponentInput.safeParse({
    inventoryItemId: uuid('3'),
    quantity: { value: 0, scale: 0, unit: 'unit' },
  });
  assert.equal(zero.success, false);

  const positive = InventoryRecipeComponentInput.safeParse({
    inventoryItemId: uuid('3'),
    quantity: { value: 1, scale: 0, unit: 'unit' },
  });
  assert.ok(positive.success, JSON.stringify(positive.error?.issues));
  // A line with no conversion named is 1 to 1, and it is required by default.
  assert.equal(positive.data.conversionNumerator, 1);
  assert.equal(positive.data.conversionDenominator, 1);
  assert.equal(positive.data.required, true);

  const negative = InventoryRecipeComponentInput.safeParse({
    inventoryItemId: uuid('3'),
    quantity: { value: -1, scale: 0, unit: 'unit' },
  });
  assert.equal(negative.success, false);
});

test('InventoryRecipeCreateRequest accepts one target and at least one component', () => {
  const parsed = InventoryRecipeCreateRequest.safeParse({
    ...command,
    targetKind: 'product',
    productId: uuid('4'),
    yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
    components: [ingredient(uuid('3'))],
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));

  // A VARIANT RECIPE NAMES THE PRODUCT TOO: `inventory_recipe.product_id` stays NOT
  // NULL for a product target, and the composite foreign key is what scopes the
  // variant to its product. A variant id alone is a row the database refuses.
  const variant = InventoryRecipeCreateRequest.safeParse({
    ...command,
    targetKind: 'product',
    productId: uuid('4'),
    variantId: uuid('6'),
    yieldQuantity: { value: 2, scale: 0, unit: 'portion' },
    components: [ingredient(uuid('3'))],
  });
  assert.ok(variant.success, JSON.stringify(variant.error?.issues));

  const variantWithoutProduct = InventoryRecipeCreateRequest.safeParse({
    ...command,
    targetKind: 'product',
    variantId: uuid('6'),
    yieldQuantity: { value: 2, scale: 0, unit: 'portion' },
    components: [ingredient(uuid('3'))],
  });
  assert.equal(variantWithoutProduct.success, false);
});

test('InventoryRecipeCreateRequest refuses a recipe with no components', () => {
  const parsed = InventoryRecipeCreateRequest.safeParse({
    ...command,
    targetKind: 'product',
    productId: uuid('4'),
    yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
    components: [],
  });
  assert.equal(parsed.success, false);
});

test('InventoryRecipeCreateRequest refuses two targets at once', () => {
  // The database counts product_id, variant_id and target_item_id: the sum is one.
  const parsed = InventoryRecipeCreateRequest.safeParse({
    ...command,
    targetKind: 'product',
    productId: uuid('4'),
    targetItemId: uuid('5'),
    yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
    components: [ingredient(uuid('3'))],
  });
  assert.equal(parsed.success, false);
});

test('InventoryRecipeCreateRequest refuses a target kind that does not match its id', () => {
  const parsed = InventoryRecipeCreateRequest.safeParse({
    ...command,
    targetKind: 'item',
    productId: uuid('4'),
    yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
    components: [ingredient(uuid('3'))],
  });
  assert.equal(parsed.success, false);
});

test('SupplierInvoiceUploadRequest needs a document', () => {
  const empty = SupplierInvoiceUploadRequest.safeParse({
    ...command,
    source: 'cfdi_xml',
  });
  assert.equal(empty.success, false);

  const withXml = SupplierInvoiceUploadRequest.safeParse({
    ...command,
    source: 'cfdi_xml',
    cfdiXml: '<cfdi:Comprobante />',
  });
  assert.ok(withXml.success, JSON.stringify(withXml.error?.issues));
});
