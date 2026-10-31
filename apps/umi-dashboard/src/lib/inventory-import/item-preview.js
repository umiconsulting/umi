import { ITEM_TYPES, UNITS } from './schema.js';
import { cell, issue, entryFor, collect, decimal } from './preview-values.js';

export function planItems(rows, snapshot) {
  const codes = new Map();
  for (const row of rows) codes.set(cell(row, 'codigo'), (codes.get(cell(row, 'codigo')) || 0) + 1);
  return rows.map((row) => {
    const code = cell(row, 'codigo');
    const name = cell(row, 'nombre');
    const entry = entryFor([row], code, name);
    const add = (error, column) => entry.errors.push(issue(error, column, row.rowNumber));
    const matches = snapshot.items.filter((item) => item.publicReference === code);
    const item = matches[0];
    if (!code) add('REQUIRED', 'codigo');
    else if (!/^[A-Za-z0-9._:-]{1,80}$/.test(code)) add('INVALID_CODE', 'codigo');
    if (!name) add('REQUIRED', 'nombre');
    else if (name.length > 160) add('INVALID_NAME', 'nombre');
    if (!ITEM_TYPES.includes(cell(row, 'tipo'))) add('INVALID_ENUM', 'tipo');
    if (!UNITS.includes(cell(row, 'unidad'))) add('INVALID_ENUM', 'unidad');
    const scaleText = cell(row, 'decimales');
    const scale = Number(scaleText);
    if (!/^[0-6]$/.test(scaleText)) add('INVALID_SCALE', 'decimales');
    if (matches.length > 1) add('DUPLICATE_TARGET', 'codigo');
    if (item?.active === false) add('ARCHIVED_ITEM', 'codigo');
    if (item) {
      for (const [column, field, value] of [
        ['tipo', 'itemType', cell(row, 'tipo')],
        ['unidad', 'baseUnit', cell(row, 'unidad')],
        ['decimales', 'quantityScale', scale],
      ]) {
        if (item[field] !== value) add('IMMUTABLE_FIELD', column);
      }
    }
    const parameters = item
      ? {}
      : {
          publicReference: code,
          displayName: name,
          itemType: cell(row, 'tipo'),
          baseUnit: cell(row, 'unidad'),
          quantityScale: scale,
          trackingPolicy: 'tracked',
          negativeStockPolicy: 'allow_and_flag',
        };
    if (item && name !== item.displayName) parameters.displayName = name;
    for (const [column, field, digits] of [
      ['costo_unitario', 'initialUnitCostMinor', 2],
      ['existencia_minima', 'lowStockThreshold', scale],
      ['cantidad_preparacion', 'parQuantity', scale],
    ]) {
      const text = cell(row, column);
      if (!text || !Number.isInteger(digits) || digits < 0 || digits > 6) continue;
      const parsed = collect(entry, row, column, () => decimal(text, digits, { fixed: true }));
      if (parsed && (!item || parsed.value !== item[field])) parameters[field] = parsed.value;
    }
    const life = cell(row, 'vida_util_dias');
    if (life) {
      if (!/^\d+$/.test(life) || Number(life) > 3650) add('INVALID_SHELF_LIFE', 'vida_util_dias');
      else if (!item || Number(life) !== item.shelfLifeDays)
        parameters.shelfLifeDays = Number(life);
    }
    if (codes.get(code) > 1) {
      add('DUPLICATE_CODE', 'codigo');
      entry.status = 'duplicate';
    } else if (!entry.errors.length) {
      entry.status = item ? (Object.keys(parameters).length ? 'update' : 'unchanged') : 'new';
      if (entry.status !== 'unchanged')
        entry.command = {
          operation: item ? 'inventory.item.update' : 'inventory.item.create',
          targetAggregateId: item?.id ?? null,
          targetVersion: item?.version ?? null,
          parameters,
        };
    }
    return entry;
  });
}
