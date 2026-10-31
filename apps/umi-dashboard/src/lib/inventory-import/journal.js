import { z } from 'zod';
import { IMPORT_LIMITS, ITEM_TYPES, UNITS, columnsFor, fileError } from './schema.js';

const uuid = z.string().uuid();
const integer = z.number().int().safe();
const positive = integer.positive();
const amount = integer.nonnegative();
const unit = z.enum(UNITS);
const code = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,95}$/);
const quantity = z.object({ value: positive, scale: integer.min(0).max(6), unit }).strict();
const itemOptional = {
  initialUnitCostMinor: amount.optional(),
  lowStockThreshold: amount.optional(),
  parQuantity: amount.optional(),
  shelfLifeDays: integer.min(0).max(3650).optional(),
};
const name = z.string().trim().min(1).max(160);
const itemCreate = z
  .object({
    publicReference: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
    displayName: name,
    itemType: z.enum(ITEM_TYPES),
    baseUnit: unit,
    quantityScale: integer.min(0).max(6),
    trackingPolicy: z.literal('tracked'),
    negativeStockPolicy: z.literal('allow_and_flag'),
    ...itemOptional,
  })
  .strict();
const itemUpdate = z
  .object({ displayName: name.optional(), ...itemOptional })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const component = z
  .object({
    inventoryItemId: uuid,
    quantity,
    conversionNumerator: positive,
    conversionDenominator: positive,
    roundingPolicy: z.literal('exact'),
    required: z.literal(true),
  })
  .strict();
const components = z
  .array(component)
  .min(1)
  .max(IMPORT_LIMITS.maxComponents)
  .refine((values) => new Set(values.map((value) => value.inventoryItemId)).size === values.length);
const recipeInputs = { yieldQuantity: quantity, components };
const recipeCreate = z
  .object({
    targetKind: z.literal('product'),
    productId: uuid,
    variantId: uuid.optional(),
    ...recipeInputs,
  })
  .strict();
const recipeUpdate = z.object(recipeInputs).strict();
const identity = { commandId: uuid, idempotencyKey: uuid, targetAggregateId: uuid };
const command = z.discriminatedUnion('operation', [
  z
    .object({
      ...identity,
      operation: z.literal('inventory.item.create'),
      targetVersion: z.null(),
      parameters: itemCreate,
    })
    .strict(),
  z
    .object({
      ...identity,
      operation: z.literal('inventory.item.update'),
      targetVersion: positive,
      parameters: itemUpdate,
    })
    .strict(),
  z
    .object({
      ...identity,
      operation: z.literal('inventory.recipe.create'),
      targetVersion: z.null(),
      parameters: recipeCreate,
    })
    .strict(),
  z
    .object({
      ...identity,
      operation: z.literal('inventory.recipe.update'),
      targetVersion: positive,
      parameters: recipeUpdate,
    })
    .strict(),
]);
const result = z.union([
  z.object({ status: z.literal('succeeded'), entityId: uuid, version: positive }).strict(),
  z.object({ status: integer.min(400).max(599).nullable(), code }).strict(),
]);
const rowNumber = positive;
const entry = z
  .object({
    key: z.string().min(1).max(512),
    rowNumbers: z.array(rowNumber).min(1).max(IMPORT_LIMITS.maxRows),
    reference: z.string().max(512),
    label: z.string().max(512),
    status: z.enum(['new', 'update', 'unchanged', 'duplicate', 'error']),
    errors: z
      .array(z.object({ code, column: z.string().max(80).nullable(), rowNumber }).strict())
      .max(5000),
    command: command.nullable(),
    executionStatus: z.enum([
      'pending',
      'sending',
      'ambiguous',
      'success',
      'error',
      'retryable',
      'skipped',
    ]),
    result: result.nullable(),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    merchantId: uuid,
    kind: z.enum(['items', 'recipes']),
    revision: amount,
    entries: z.array(entry).max(IMPORT_LIMITS.maxRows),
  })
  .strict();
const MAX_JOURNAL_CHARS = 4 * 1024 * 1024;

export function journalKey(merchantId, kind) {
  columnsFor(kind);
  if (!uuid.safeParse(merchantId).success) throw fileError('INVALID_BATCH');
  return `umi:inventory-import:v1:${merchantId}:${kind}`;
}

export function validateBatch(input, merchantId, kind) {
  const parsed = schema.safeParse(input);
  if (!parsed.success || parsed.data.merchantId !== merchantId || parsed.data.kind !== kind)
    throw fileError('INVALID_BATCH');
  const batch = parsed.data;
  const rowNumbers = new Set();
  const keys = new Set();
  const identities = new Set();
  const targets = new Set();
  if (kind === 'recipes' && batch.entries.length > IMPORT_LIMITS.maxRecipes)
    throw fileError('INVALID_BATCH');
  for (const entry of batch.entries) {
    if (keys.has(entry.key)) throw fileError('INVALID_BATCH');
    keys.add(entry.key);
    for (const row of entry.rowNumbers) {
      if (rowNumbers.has(row)) throw fileError('INVALID_BATCH');
      rowNumbers.add(row);
    }
    if (
      entry.errors.some(
        (error) =>
          !entry.rowNumbers.includes(error.rowNumber) ||
          (error.column !== null && !columnsFor(kind).includes(error.column)),
      )
    )
      throw fileError('INVALID_BATCH');
    const eligible = entry.status === 'new' || entry.status === 'update';
    if (Boolean(entry.command) !== eligible || eligible === (entry.executionStatus === 'skipped'))
      throw fileError('INVALID_BATCH');
    if (!eligible) {
      if (entry.result !== null) throw fileError('INVALID_BATCH');
      continue;
    }
    const { command } = entry;
    if (
      entry.errors.length ||
      !command.operation.startsWith(kind === 'items' ? 'inventory.item.' : 'inventory.recipe.') ||
      !command.operation.endsWith(entry.status === 'new' ? '.create' : '.update')
    )
      throw fileError('INVALID_BATCH');
    if (targets.has(command.targetAggregateId)) throw fileError('INVALID_BATCH');
    targets.add(command.targetAggregateId);
    for (const id of [command.commandId, command.idempotencyKey]) {
      if (identities.has(id)) throw fileError('INVALID_BATCH');
      identities.add(id);
    }
    if (entry.executionStatus === 'success') {
      if (entry.result?.status !== 'succeeded') throw fileError('INVALID_BATCH');
    } else if (['error', 'retryable', 'ambiguous'].includes(entry.executionStatus)) {
      if (entry.result?.status === 'succeeded') throw fileError('INVALID_BATCH');
      if (
        entry.executionStatus === 'error' &&
        !(
          entry.result?.status >= 400 &&
          entry.result.status < 500 &&
          ![401, 403, 429].includes(entry.result.status)
        )
      )
        throw fileError('INVALID_BATCH');
      if (entry.executionStatus === 'retryable' && ![401, 403, 429].includes(entry.result?.status))
        throw fileError('INVALID_BATCH');
    } else if (entry.result !== null) throw fileError('INVALID_BATCH');
  }
  if (rowNumbers.size > IMPORT_LIMITS.maxRows) throw fileError('INVALID_BATCH');
  return batch;
}

export function readJournal(storage, merchantId, kind) {
  const key = journalKey(merchantId, kind);
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    throw fileError('STORAGE_READ_FAILED');
  }
  if (raw === null) return null;
  if (typeof raw !== 'string' || raw.length > MAX_JOURNAL_CHARS) throw fileError('INVALID_BATCH');
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw fileError('INVALID_BATCH');
  }
  return validateBatch(value, merchantId, kind);
}

export function writeJournal(storage, batch) {
  const value = JSON.stringify(validateBatch(batch, batch.merchantId, batch.kind));
  if (value.length > MAX_JOURNAL_CHARS) throw fileError('BATCH_TOO_LARGE');
  try {
    storage.setItem(journalKey(batch.merchantId, batch.kind), value);
  } catch {
    throw fileError('STORAGE_WRITE_FAILED');
  }
}

export const unresolved = (batch) =>
  batch.entries.some((entry) =>
    ['pending', 'sending', 'ambiguous', 'retryable'].includes(entry.executionStatus),
  );
