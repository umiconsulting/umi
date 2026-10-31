import { describe, expect, it } from 'vitest';
import { buildImportPreview } from './preview.js';
import {
  clearImportBatch,
  importBatchResultRows,
  prepareImportBatch,
  readImportBatch,
  runImportBatch,
} from './runner.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const merchantId = id(1);
function memory() {
  const data = new Map();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}
function preview(count = 1) {
  return buildImportPreview({
    kind: 'items',
    snapshot: { merchantId, items: [], targets: [], recipes: [] },
    parsed: {
      rows: Array.from({ length: count }, (_, index) => ({
        rowNumber: index + 2,
        errors: [],
        values: {
          codigo: `CODE${index}`,
          nombre: 'Milk',
          tipo: 'ingredient',
          unidad: 'liter',
          decimales: '3',
          costo_unitario: '12.50',
        },
      })),
    },
  });
}
function prepare(storage, count = 1) {
  return prepareImportBatch({ merchantId, preview: preview(count), storage });
}
const options = (batch, storage, execute, more = {}) => ({
  batch,
  storage,
  execute,
  isCurrentMerchant: (id) => id === merchantId,
  delay: async () => {},
  ...more,
});
const ok = {
  result: {
    commandId: id(7),
    item: { id: id(5), version: 1, displayName: 'Milk', projection: { secret: 'discard' } },
    correlationId: 'request',
  },
};

describe('recoverable import batches', () => {
  it('persists all exact identities before the first send and blocks unresolved replacement', () => {
    const storage = memory();
    const batch = prepare(storage, 2);
    expect(readImportBatch(storage, merchantId, 'items')).toEqual(batch);
    const identities = batch.entries.map((entry) => entry.command);
    expect(
      identities.every(
        (command) =>
          /^[0-9a-f-]{36}$/.test(command.commandId) &&
          /^[0-9a-f-]{36}$/.test(command.idempotencyKey) &&
          /^[0-9a-f-]{36}$/.test(command.targetAggregateId),
      ),
    ).toBe(true);
    expect(
      new Set(
        identities.flatMap((command) => [
          command.commandId,
          command.idempotencyKey,
          command.targetAggregateId,
        ]),
      ).size,
    ).toBe(6);
    expect(() => prepare(storage)).toThrow('UNRESOLVED_BATCH');
  });
  it('permits explicit discard of pending rows and completed rows with a pending remainder', async () => {
    const storage = memory();
    prepare(storage);
    clearImportBatch(storage, merchantId, 'items');
    expect(readImportBatch(storage, merchantId, 'items')).toBeNull();
    let current = true;
    await runImportBatch(
      options(
        prepare(storage, 2),
        storage,
        async () => {
          current = false;
          return ok;
        },
        { isCurrentMerchant: () => current },
      ),
    );
    clearImportBatch(storage, merchantId, 'items');
    expect(readImportBatch(storage, merchantId, 'items')).toBeNull();
  });
  it('permits discard after a definite 429 but protects unknown and sending outcomes', async () => {
    const storage = memory();
    await runImportBatch(
      options(prepare(storage), storage, async () => {
        throw { status: 429 };
      }),
    );
    clearImportBatch(storage, merchantId, 'items');
    let clearCode;
    await runImportBatch(
      options(prepare(storage), storage, async () => {
        try {
          clearImportBatch(storage, merchantId, 'items');
        } catch (error) {
          clearCode = error.code;
        }
        throw new Error('lost');
      }),
    );
    expect(clearCode).toBe('UNRESOLVED_BATCH');
    expect(() => clearImportBatch(storage, merchantId, 'items')).toThrow('UNRESOLVED_BATCH');
  });
  it('reuses a lost-response command and creates one receiver record', async () => {
    const storage = memory();
    const batch = prepare(storage);
    const received = [];
    const records = new Map();
    async function receiver(merchant, operation, aggregate, command) {
      const wire = { merchant, operation, aggregate, command: structuredClone(command) };
      received.push(wire);
      if (!records.has(command.idempotencyKey))
        records.set(command.idempotencyKey, { id: aggregate });
      if (received.length === 1) throw new Error('lost response');
      return { result: { item: { id: aggregate, version: 1 } } };
    }
    const first = await runImportBatch(options(batch, storage, receiver));
    expect(first.entries[0].executionStatus).toBe('ambiguous');
    const recovered = readImportBatch(storage, merchantId, 'items');
    const result = await runImportBatch(options(recovered, storage, receiver));
    expect([...records.values()]).toHaveLength(1);
    expect(received[1]).toEqual(received[0]);
    expect(result.entries[0].executionStatus).toBe('success');
    await runImportBatch(options(result, storage, receiver));
    expect(received).toHaveLength(2);
  });
  it('persists sending before execution and recovers sending as ambiguous', async () => {
    const storage = memory();
    const batch = prepare(storage);
    let sending;
    let recovered;
    await runImportBatch(
      options(batch, storage, async () => {
        sending = JSON.parse([...storage.data.values()][0]).entries[0].executionStatus;
        recovered = readImportBatch(storage, merchantId, 'items').entries[0].executionStatus;
        return ok;
      }),
    );
    expect(sending).toBe('sending');
    expect(recovered).toBe('ambiguous');
  });
  it('retains minimal committed results and exports one row per source row', async () => {
    const storage = memory();
    const batch = await runImportBatch(options(prepare(storage), storage, async () => ok));
    expect(batch.entries[0].result).toEqual({ status: 'succeeded', entityId: id(5), version: 1 });
    expect(JSON.stringify(batch)).not.toContain('secret');
    expect(importBatchResultRows(batch)).toEqual([
      { rowNumber: 2, reference: 'CODE0', status: 'success', message: '' },
    ]);
    clearImportBatch(storage, merchantId, 'items');
    expect(readImportBatch(storage, merchantId, 'items')).toBeNull();
  });
  it.each([400, 409, 422])('records definitive %s results and continues', async (status) => {
    const storage = memory();
    let sends = 0;
    const result = await runImportBatch(
      options(prepare(storage, 2), storage, async () => {
        if (++sends === 1)
          throw Object.assign(new Error('token=secret'), {
            status,
            code: 'INVENTORY_RECIPE_MAPPING_CONFLICT',
          });
        return ok;
      }),
    );
    expect(result.entries.map((entry) => entry.executionStatus)).toEqual(['error', 'success']);
    expect(result.entries[0].result).toEqual({ status, code: 'INVENTORY_RECIPE_MAPPING_CONFLICT' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it.each([401, 403, 429, 500, undefined])(
    'stops on %s and retries with original identity',
    async (status) => {
      const storage = memory();
      const batch = prepare(storage, 2);
      const received = [];
      const first = await runImportBatch(
        options(batch, storage, async (...args) => {
          received.push(args);
          throw Object.assign(new Error('private'), { status });
        }),
      );
      expect(received).toHaveLength(1);
      expect(first.entries[0].executionStatus).toBe(
        status && status < 500 ? 'retryable' : 'ambiguous',
      );
      await runImportBatch(
        options(readImportBatch(storage, merchantId, 'items'), storage, async (...args) => {
          received.push(args);
          return ok;
        }),
      );
      expect(received[1]).toEqual(received[0]);
      expect(received).toHaveLength(3);
    },
  );
  it('uses 400 ms between sends and stops after a merchant switch during the delay', async () => {
    const storage = memory();
    let sends = 0;
    let current = true;
    const delays = [];
    const result = await runImportBatch(
      options(
        prepare(storage, 2),
        storage,
        async () => {
          sends++;
          return ok;
        },
        {
          isCurrentMerchant: () => current,
          delay: async (ms) => {
            delays.push(ms);
            current = false;
          },
        },
      ),
    );
    expect(sends).toBe(1);
    expect(delays).toEqual([400]);
    expect(result.entries[1].executionStatus).toBe('pending');
  });
  it('stops on an aborted signal before send and after a delay', async () => {
    const storage = memory();
    const controller = new AbortController();
    let sends = 0;
    const batch = prepare(storage, 2);
    await runImportBatch(
      options(
        batch,
        storage,
        async () => {
          sends++;
          return ok;
        },
        { signal: controller.signal, delay: async () => controller.abort() },
      ),
    );
    expect(sends).toBe(1);
    await runImportBatch(
      options(
        readImportBatch(storage, merchantId, 'items'),
        storage,
        async () => {
          sends++;
          return ok;
        },
        { signal: controller.signal },
      ),
    );
    expect(sends).toBe(1);
  });
  it('saves a response under its original merchant after the merchant changes', async () => {
    const storage = memory();
    let current = true;
    const result = await runImportBatch(
      options(
        prepare(storage, 2),
        storage,
        async () => {
          current = false;
          return ok;
        },
        { isCurrentMerchant: () => current },
      ),
    );
    expect(result.entries.map((entry) => entry.executionStatus)).toEqual(['success', 'pending']);
    expect(readImportBatch(storage, merchantId, 'items').entries[0].executionStatus).toBe(
      'success',
    );
    expect(readImportBatch(storage, id(9), 'items')).toBeNull();
  });
  it('retains an unknown prior outcome when context changes before a replay send', async () => {
    const storage = memory();
    await runImportBatch(
      options(prepare(storage), storage, async () => {
        throw new Error('lost response');
      }),
    );
    const before = readImportBatch(storage, merchantId, 'items');
    const save = storage.setItem;
    let current = true;
    let sends = 0;
    storage.setItem = (key, value) => {
      save(key, value);
      current = false;
    };
    const result = await runImportBatch(
      options(
        before,
        storage,
        async () => {
          sends++;
          return ok;
        },
        { isCurrentMerchant: () => current },
      ),
    );
    expect(sends).toBe(0);
    expect(result.entries[0].executionStatus).toBe('ambiguous');
    expect(result.entries[0].result).toEqual({ status: null, code: 'UNKNOWN_OUTCOME' });
    expect(() => clearImportBatch(storage, merchantId, 'items')).toThrow('UNRESOLVED_BATCH');
  });
  it('never sends when storage fails before the command', async () => {
    const storage = memory();
    const batch = prepare(storage);
    let sends = 0;
    storage.setItem = () => {
      throw new Error('quota');
    };
    await expect(
      runImportBatch(
        options(batch, storage, async () => {
          sends++;
          return ok;
        }),
      ),
    ).rejects.toThrow('STORAGE_WRITE_FAILED');
    expect(sends).toBe(0);
  });
  it('keeps the old identity recoverable when storage fails after a committed response', async () => {
    const storage = memory();
    const batch = prepare(storage);
    const identities = [];
    const save = storage.setItem;
    await expect(
      runImportBatch(
        options(batch, storage, async (_merchant, _op, aggregate, command) => {
          identities.push({ aggregate, command });
          storage.setItem = () => {
            throw new Error('quota');
          };
          return ok;
        }),
      ),
    ).rejects.toThrow('STORAGE_WRITE_FAILED');
    storage.setItem = save;
    const saved = readImportBatch(storage, merchantId, 'items');
    expect(saved.entries[0].executionStatus).toBe('ambiguous');
    await runImportBatch(
      options(saved, storage, async (_merchant, _op, aggregate, command) => {
        identities.push({ aggregate, command });
        return ok;
      }),
    );
    expect(identities[1]).toEqual(identities[0]);
  });
  it('does not let callback failures cause another command', async () => {
    const storage = memory();
    let sends = 0;
    const result = await runImportBatch(
      options(
        prepare(storage),
        storage,
        async () => {
          sends++;
          return ok;
        },
        {
          onProgress: () => {
            throw new Error('callback');
          },
        },
      ),
    );
    await runImportBatch(
      options(result, storage, async () => {
        sends++;
        return ok;
      }),
    );
    expect(sends).toBe(1);
  });
  it('protects a live runner from discard after a saved response', async () => {
    const storage = memory();
    let current = true;
    let clearCode;
    await runImportBatch(
      options(prepare(storage, 2), storage, async () => ok, {
        isCurrentMerchant: () => current,
        onProgress: () => {
          try {
            clearImportBatch(storage, merchantId, 'items');
          } catch (error) {
            clearCode = error.code;
          }
          current = false;
        },
      }),
    );
    expect(clearCode).toBe('BATCH_RUNNING');
    clearImportBatch(storage, merchantId, 'items');
    expect(readImportBatch(storage, merchantId, 'items')).toBeNull();
  });
  it('keeps invalid source rows in reports without blocking valid rows on long invalid labels', async () => {
    const storage = memory();
    const input = preview(2);
    const invalid = buildImportPreview({
      kind: 'items',
      snapshot: { merchantId, items: [], recipes: [], targets: [] },
      parsed: {
        rows: [
          {
            rowNumber: 5,
            values: {
              codigo: 'X'.repeat(600),
              nombre: 'N'.repeat(600),
              tipo: 'ingredient',
              unidad: 'liter',
              decimales: '3',
            },
            errors: [],
          },
        ],
      },
    });
    input.entries.push(invalid.entries[0]);
    const batch = await runImportBatch(
      options(prepareImportBatch({ merchantId, preview: input, storage }), storage, async () => ok),
    );
    expect(batch.entries.map((entry) => entry.executionStatus)).toEqual([
      'success',
      'success',
      'skipped',
    ]);
    expect(importBatchResultRows(batch)[2]).toMatchObject({ rowNumber: 5, status: 'error' });
  });
  it('refuses concurrent runs and stale batch objects', async () => {
    const storage = memory();
    const batch = prepare(storage);
    let release;
    const first = runImportBatch(
      options(batch, storage, async () => {
        await new Promise((resolve) => {
          release = resolve;
        });
        return ok;
      }),
    );
    await expect(runImportBatch(options(batch, storage, async () => ok))).rejects.toThrow(
      'BATCH_RUNNING',
    );
    release();
    await first;
    await expect(runImportBatch(options(batch, storage, async () => ok))).rejects.toThrow(
      'STALE_BATCH',
    );
  });
  it.each([
    (batch) => {
      batch.merchantId = id(8);
    },
    (batch) => {
      batch.entries[0].command.operation = 'inventory.item.archive';
    },
    (batch) => {
      batch.entries[0].command.commandId = 'bad';
    },
    (batch) => {
      batch.entries[0].command.parameters.stock = 100;
    },
    (batch) => {
      batch.entries[0].executionStatus = 'other';
    },
    (batch) => {
      batch.entries[0].command.targetVersion = 1;
    },
    (batch) => {
      batch.entries[0].command.parameters.quantityScale = 8;
    },
    (batch) => {
      batch.entries[0].result = { credentials: 'private' };
    },
  ])('refuses malformed saved commands before replay', async (corrupt) => {
    const storage = memory();
    prepare(storage);
    const [key, value] = [...storage.data][0];
    const batch = JSON.parse(value);
    corrupt(batch);
    storage.setItem(key, JSON.stringify(batch));
    expect(() => readImportBatch(storage, merchantId, 'items')).toThrow('INVALID_BATCH');
    let sends = 0;
    await expect(
      runImportBatch(
        options(batch, storage, async () => {
          sends++;
          return ok;
        }),
      ),
    ).rejects.toThrow('INVALID_BATCH');
    expect(sends).toBe(0);
  });
  it('treats an unusable success response as ambiguous and stops', async () => {
    const storage = memory();
    let sends = 0;
    const batch = await runImportBatch(
      options(prepare(storage, 2), storage, async () => {
        sends++;
        return {};
      }),
    );
    expect(sends).toBe(1);
    expect(batch.entries[0].executionStatus).toBe('ambiguous');
  });
  it('preserves recipe versions and strips response projections', async () => {
    const storage = memory();
    const items = [
      {
        id: id(8),
        publicReference: 'MILK',
        displayName: 'Milk',
        active: true,
        itemType: 'ingredient',
        baseUnit: 'liter',
        quantityScale: 3,
        version: 5,
        conversions: [],
      },
    ];
    const recipe = {
      id: id(9),
      targetKind: 'product',
      productId: id(10),
      variantId: null,
      version: 7,
      active: true,
      yieldQuantity: { value: 1, scale: 0, unit: 'unit' },
      components: [],
    };
    const input = buildImportPreview({
      kind: 'recipes',
      snapshot: {
        merchantId,
        items,
        targets: [
          { productId: id(10), variantId: null, productName: 'Coffee', productActive: true },
        ],
        recipes: [recipe],
      },
      parsed: {
        rows: [
          {
            rowNumber: 2,
            values: {
              producto_id: id(10),
              rendimiento: '1',
              unidad_rendimiento: 'unit',
              ingrediente_codigo: 'MILK',
              cantidad: '0.25',
              unidad: 'liter',
            },
            errors: [],
          },
        ],
      },
    });
    const batch = prepareImportBatch({ merchantId, preview: input, storage });
    expect(batch.entries[0].command).toMatchObject({
      targetAggregateId: id(9),
      targetVersion: 7,
      operation: 'inventory.recipe.update',
    });
    let sent;
    const result = await runImportBatch(
      options(batch, storage, async (...args) => {
        sent = args;
        return {
          result: {
            recipe: {
              id: id(11),
              version: 8,
              components: Array(200).fill({ credential: 'discard' }),
            },
          },
        };
      }),
    );
    expect(sent).toEqual([
      merchantId,
      'inventory.recipe.update',
      id(9),
      {
        commandId: batch.entries[0].command.commandId,
        idempotencyKey: batch.entries[0].command.idempotencyKey,
        targetVersion: 7,
        parameters: batch.entries[0].command.parameters,
      },
    ]);
    expect(result.entries[0].result).toEqual({ status: 'succeeded', entityId: id(11), version: 8 });
    expect(readImportBatch(storage, merchantId, 'recipes')).toEqual(result);
    expect(importBatchResultRows(result)).toEqual([
      { rowNumber: 2, reference: `${id(10)}/`, status: 'success', message: '' },
    ]);
    expect(JSON.stringify(result)).not.toContain('credential');
    const [key, raw] = [...storage.data][0];
    const corrupt = JSON.parse(raw);
    corrupt.entries[0].command.parameters.replaceSalesMapping = {
      mappingId: id(12),
      expectedVersion: 1,
    };
    storage.setItem(key, JSON.stringify(corrupt));
    expect(() => readImportBatch(storage, merchantId, 'recipes')).toThrow('INVALID_BATCH');
  });
  it('does not replace a terminal report without explicit clear', async () => {
    const storage = memory();
    await runImportBatch(options(prepare(storage), storage, async () => ok));
    expect(() => prepare(storage)).toThrow('BATCH_EXISTS');
  });
});
