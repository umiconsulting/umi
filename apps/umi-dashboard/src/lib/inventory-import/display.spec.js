import { expect, it } from 'vitest';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { messages as englishMessages } from '@/locales/en/messages.mjs';
import { importErrorText, importStatusText, localizeImportResultRows } from './display.js';
i18n.load('es', {});
i18n.activate('es');
it('maps errors to actionable text without exposing unknown backend data', () => {
  expect(importErrorText(i18n, 'DUPLICATE_CODE')).toMatch(/código/i);
  expect(importErrorText(i18n, 'FORMULA_CELL')).toMatch(/fórmula/i);
  expect(importErrorText(i18n, { stack: 'secret' })).not.toContain('secret');
  expect(importErrorText(i18n, 'UNEXPECTED_ENGLISH_CODE')).not.toContain('UNEXPECTED');
});
it('localizes all exported row statuses and comma separated errors', () => {
  const rows = localizeImportResultRows(i18n, [
    { rowNumber: 3, reference: 'A', status: 'error', message: 'REQUIRED, INVALID_NUMBER' },
    { rowNumber: 4, reference: 'B', status: 'success', message: '' },
  ]);
  expect(rows[0].message).toMatch(/obligatorio/);
  expect(rows[0].message).toMatch(/número/);
  expect(rows[1].status).toBe(importStatusText(i18n, 'success'));
  expect(rows[1].status).toBe('Guardado');
  expect(rows).toHaveLength(2);
});
it('treats inherited property names as unknown error codes', () => {
  expect(importErrorText(i18n, 'constructor')).toBe(
    importErrorText(i18n, 'UNEXPECTED_ENGLISH_CODE'),
  );
  expect(importStatusText(i18n, 'toString')).toBe(importStatusText(i18n, 'unknown'));
});

it('directs stale recipe owners to a fresh import instead of retrying the old command', () => {
  expect(importErrorText(i18n, 'INVENTORY_RECIPE_RETIRED')).toContain('Nueva importación');
  expect(importErrorText(i18n, 'INVENTORY_RECIPE_RETIRED')).toContain('revisa');
  expect(importErrorText(i18n, 'INVENTORY_RECIPE_RETIRED')).not.toMatch(
    /vuelve a intentar|reintenta/i,
  );
});

it('uses Update for imports and preserves Refresh for reload controls in English', () => {
  i18n.load('en', englishMessages);
  i18n.activate('en');
  try {
    expect(importStatusText(i18n, 'update')).toBe('Update');
    expect(i18n._(msg`Actualizar`)).toBe('Refresh');
  } finally {
    i18n.activate('es');
  }
});
