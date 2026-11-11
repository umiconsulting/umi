import { it, expect } from 'vitest';
import { validatePurchasePhoto, validatePurchaseEnvelope } from './purchase-entry-photo.js';
it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s within original limit', (type) =>
  expect(() => validatePurchasePhoto({ type, size: 700 * 1024 })).not.toThrow(),
);
it.each([
  { type: 'image/svg+xml', size: 1 },
  { type: 'application/pdf', size: 1 },
  { type: 'image/png', size: 12 * 1024 * 1024 + 1 },
])('refuses unsupported or oversized source', (file) =>
  expect(() => validatePurchasePhoto(file)).toThrow(),
);
it('measures the complete UTF8 envelope', () => {
  expect(() => validatePurchaseEnvelope({ note: 'ñ'.repeat(530000) })).toThrow();
  expect(() => validatePurchaseEnvelope({ note: 'ok' })).not.toThrow();
});
