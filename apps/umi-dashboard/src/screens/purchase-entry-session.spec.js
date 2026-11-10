import { describe, it, expect } from 'vitest';
import {
  preparePurchaseAttempt,
  readPurchaseAttempt,
  runPurchaseAttempt,
  clearPurchaseAttempt,
} from './purchase-entry-session.js';
const storage = () => {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) || null,
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
};
const input = (s) => ({
  merchantId: 'm',
  locationId: 'l',
  operation: 'inventory.purchase.record',
  parameters: { locationId: 'l', inventoryLocationId: 'd', lines: [] },
  storage: s,
});
describe('purchase attempt journal', () => {
  it('persists before send and retries identical payload after loss', async () => {
    const s = storage();
    const a = preparePurchaseAttempt(input(s));
    const calls = [];
    const send = async (m, e) => {
      calls.push([m, e]);
      throw new Error('lost');
    };
    await runPurchaseAttempt({ attempt: a, storage: s, send });
    const recovered = readPurchaseAttempt({ merchantId: 'm', storage: s });
    expect(recovered.state).toBe('ambiguous');
    await runPurchaseAttempt({ attempt: recovered, storage: s, send });
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0][0]).toBe('m');
    expect(recovered.envelope.parameters.inventoryLocationId).toBe('d');
    expect(() => preparePurchaseAttempt(input(s))).toThrow();
    expect(() => clearPurchaseAttempt({ merchantId: 'm', storage: s })).toThrow();
  });
  it('sends zero requests if storage fails', async () => {
    const s = {
      ...storage(),
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => preparePurchaseAttempt(input(s))).toThrow();
  });
  it('stores success without photo and cannot replay', async () => {
    const s = storage();
    const a = preparePurchaseAttempt({
      ...input(s),
      parameters: { ...input(s).parameters, artifactBase64: 'abc' },
    });
    let calls = 0;
    const send = async () => {
      calls++;
      return { supplierInvoice: { id: 'done' } };
    };
    await runPurchaseAttempt({ attempt: a, storage: s, send });
    const done = readPurchaseAttempt({ merchantId: 'm', storage: s });
    expect(done.state).toBe('succeeded');
    expect(done.envelope).toBeUndefined();
    await expect(runPurchaseAttempt({ attempt: a, storage: s, send })).rejects.toThrow();
    expect(calls).toBe(1);
    clearPurchaseAttempt({ merchantId: 'm', storage: s });
    expect(readPurchaseAttempt({ merchantId: 'm', storage: s })).toBe(null);
  });
  it.each([500, 503, 409])('retains identities for status %i', async (status) => {
    const s = storage();
    const a = preparePurchaseAttempt(input(s));
    await runPurchaseAttempt({
      attempt: a,
      storage: s,
      send: async () => {
        throw Object.assign(new Error(), { status });
      },
    });
    expect(readPurchaseAttempt({ merchantId: 'm', storage: s }).envelope).toEqual(a.envelope);
  });
  it('permits correction only after a definitive refusal', async () => {
    const s = storage();
    const a = preparePurchaseAttempt(input(s));
    await runPurchaseAttempt({
      attempt: a,
      storage: s,
      send: async () => {
        throw Object.assign(new Error(), { status: 422 });
      },
    });
    expect(readPurchaseAttempt({ merchantId: 'm', storage: s }).state).toBe('rejected');
    clearPurchaseAttempt({ merchantId: 'm', storage: s });
    expect(preparePurchaseAttempt(input(s)).envelope.commandId).not.toBe(a.envelope.commandId);
  });
  it('rejects corrupt storage and oversize UTF8 envelope', () => {
    const s = storage();
    expect(() =>
      preparePurchaseAttempt({ ...input(s), parameters: { note: 'ñ'.repeat(530000) } }),
    ).toThrow();
    s.setItem('umi-purchase-attempt:m', '{}');
    expect(() => readPurchaseAttempt({ merchantId: 'm', storage: s })).toThrow();
  });
});
it('retains an unresolved original after a later permission refusal', async () => {
  const s = storage();
  const a = preparePurchaseAttempt(input(s));
  await runPurchaseAttempt({
    attempt: a,
    storage: s,
    send: async () => {
      throw new Error('lost');
    },
  });
  const unresolved = readPurchaseAttempt({ merchantId: 'm', storage: s });
  await runPurchaseAttempt({
    attempt: unresolved,
    storage: s,
    send: async () => {
      throw Object.assign(new Error(), { status: 403 });
    },
  });
  expect(readPurchaseAttempt({ merchantId: 'm', storage: s }).state).toBe('ambiguous');
});
it('sends zero requests when the pending storage write fails', async () => {
  const s = storage();
  const a = preparePurchaseAttempt(input(s));
  s.setItem = () => {
    throw new Error('quota');
  };
  let sends = 0;
  await expect(
    runPurchaseAttempt({
      attempt: a,
      storage: s,
      send: async () => {
        sends++;
      },
    }),
  ).rejects.toThrow();
  expect(sends).toBe(0);
});
it.each(['INVENTORY_QUANTITY_NOT_EXACT', 'SUPPLIER_ARCHIVED', 'SUPPLIER_INVOICE_UNMATCHED_LINES'])(
  'permits correction for a definitive first business refusal %s',
  async (code) => {
    const s = storage();
    const a = preparePurchaseAttempt(input(s));
    const result = await runPurchaseAttempt({
      attempt: a,
      storage: s,
      send: async () => {
        throw Object.assign(new Error(), { status: 409, code });
      },
    });
    expect(result.state).toBe('rejected');
    clearPurchaseAttempt({ merchantId: 'm', storage: s });
    expect(preparePurchaseAttempt(input(s)).envelope.commandId).not.toBe(a.envelope.commandId);
  },
);
it.each([
  'ADMINISTRATIVE_COMMAND_RECOVERY_REQUIRED',
  'ADMINISTRATIVE_COMMAND_FINGERPRINT_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
])('retains an unresolved identity for %s', async (code) => {
  const s = storage();
  const a = preparePurchaseAttempt(input(s));
  const result = await runPurchaseAttempt({
    attempt: a,
    storage: s,
    send: async () => {
      throw Object.assign(new Error(), { status: 409, code });
    },
  });
  expect(result.state).toBe('ambiguous');
  expect(result.envelope).toEqual(a.envelope);
});
it('retains a prior ambiguous request after a later known business refusal', async () => {
  const s = storage();
  const a = preparePurchaseAttempt(input(s));
  await runPurchaseAttempt({
    attempt: a,
    storage: s,
    send: async () => {
      throw new Error('lost');
    },
  });
  const prior = readPurchaseAttempt({ merchantId: 'm', storage: s });
  const result = await runPurchaseAttempt({
    attempt: prior,
    storage: s,
    send: async () => {
      throw Object.assign(new Error(), { status: 409, code: 'SUPPLIER_ARCHIVED' });
    },
  });
  expect(result.state).toBe('ambiguous');
  expect(result.envelope).toEqual(a.envelope);
});
