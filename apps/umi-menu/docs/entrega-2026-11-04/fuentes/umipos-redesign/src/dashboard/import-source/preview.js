import { columnsFor, IMPORT_LIMITS, fileError } from './schema.js';
import { UUID } from './preview-values.js';
import { planItems } from './item-preview.js';
import { planRecipes } from './recipe-preview.js';

export function buildImportPreview({ kind, parsed, snapshot }) {
  columnsFor(kind);
  if (
    !UUID.test(snapshot?.merchantId) ||
    !Array.isArray(parsed?.rows) ||
    !['items', 'targets', 'recipes'].every((key) => Array.isArray(snapshot[key]))
  )
    throw fileError('INVALID_PREVIEW_INPUT');
  if (parsed.rows.length > IMPORT_LIMITS.maxRows) throw fileError('TOO_MANY_ROWS');
  const entries =
    kind === 'items' ? planItems(parsed.rows, snapshot) : planRecipes(parsed.rows, snapshot);
  const counts = { new: 0, update: 0, unchanged: 0, duplicate: 0, error: 0 };
  for (const entry of entries) counts[entry.status] += 1;
  return { kind, entries, counts };
}
