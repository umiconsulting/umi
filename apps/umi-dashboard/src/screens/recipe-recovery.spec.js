import { describe, it, expect } from 'vitest';
import {
  readRecipeRecovery,
  writeRecipeRecovery,
  clearRecipeRecovery,
  prepareRecipeRequest,
} from './recipe-recovery.js';
function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}
const value = {
  merchantId: 'a',
  userId: 'user',
  recipeId: 'recipe',
  recipe: null,
  request: { commandId: 'command', idempotencyKey: 'identity', parameters: { yield: 2 } },
};
describe('recipe recovery', () => {
  it('restores the exact request and identities after a new read', () => {
    const s = storage();
    writeRecipeRecovery(s, value);
    expect(readRecipeRecovery(s, 'a', 'user')).toEqual(value);
  });
  it('isolates businesses and accounts', () => {
    const s = storage();
    writeRecipeRecovery(s, value);
    expect(readRecipeRecovery(s, 'b', 'user')).toBeNull();
    expect(readRecipeRecovery(s, 'a', 'other')).toBeNull();
  });
  it('does not clear a newer command on an old response', () => {
    const s = storage();
    writeRecipeRecovery(s, value);
    clearRecipeRecovery(s, 'a', 'user', 'other');
    expect(readRecipeRecovery(s, 'a', 'user')).toEqual(value);
    clearRecipeRecovery(s, 'a', 'user', 'command');
    expect(readRecipeRecovery(s, 'a', 'user')).toBeNull();
  });
});

it('retries the persisted payload and source branch after a branch switch', () => {
  const first = prepareRecipeRequest({ parameters: { quantity: 3 } }, null, 'branch-a');
  const s = storage();
  writeRecipeRecovery(s, { ...value, request: first });
  const restored = readRecipeRecovery(s, 'a', 'user');
  expect(prepareRecipeRequest(restored.request, null, 'branch-b')).toEqual(first);
});
it('uses a new identity only when confirming a replacement changes the payload', () => {
  const first = prepareRecipeRequest({ parameters: { quantity: 3 } }, null, 'branch-a');
  const confirmed = prepareRecipeRequest(first, 'confirmation-token', 'branch-b');
  expect(confirmed.commandId).not.toBe(first.commandId);
  expect(confirmed.idempotencyKey).not.toBe(first.idempotencyKey);
  expect(confirmed.locationId).toBe('branch-a');
  expect(confirmed.parameters).toEqual({ quantity: 3, replaceSalesMapping: 'confirmation-token' });
  expect(prepareRecipeRequest(confirmed, null, 'branch-b')).toEqual(confirmed);
});
