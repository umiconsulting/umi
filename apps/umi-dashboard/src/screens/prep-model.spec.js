import { describe, expect, it } from 'vitest';
import '@/test/i18n.jsx';
import {
  forecastWindowText,
  labelSheetFilename,
  prepQuantityCell,
  scaledQuantityText,
  sortPrepItems,
} from './prep-model.js';

function item(displayName, prepValue, prepScale = 0, par = true) {
  return {
    inventoryItemId: `item-${displayName}`,
    publicReference: displayName,
    displayName,
    unit: 'kilogram',
    quantityScale: prepScale,
    parQuantity: par ? { value: 1000, scale: prepScale, unit: 'kilogram' } : null,
    onHandQuantity: { value: 0, scale: prepScale, unit: 'kilogram' },
    forecastUsageQuantity: { value: 0, scale: prepScale, unit: 'kilogram' },
    prepQuantity: { value: prepValue, scale: prepScale, unit: 'kilogram' },
    shelfLifeDays: 3,
    expiresOn: null,
  };
}

describe('el orden de la lista', () => {
  it('pone primero la cantidad mas grande', () => {
    const rows = sortPrepItems([item('Cebolla', 2), item('Salsa', 12), item('Leche', 5)]);

    expect(rows.map((row) => row.displayName)).toEqual(['Salsa', 'Leche', 'Cebolla']);
  });

  it('compara cantidades con escalas distintas', () => {
    const rows = sortPrepItems([item('Queso', 2, 0), item('Jarabe', 1500, 3)]);

    expect(rows.map((row) => row.displayName)).toEqual(['Queso', 'Jarabe']);
  });

  it('deja al final los articulos sin par', () => {
    const rows = sortPrepItems([
      item('SinPar', 99, 0, false),
      item('Cebolla', 2),
      item('Salsa', 12),
    ]);

    expect(rows.map((row) => row.displayName)).toEqual(['Salsa', 'Cebolla', 'SinPar']);
  });
});

describe('la cantidad a preparar', () => {
  it('nombra el par ausente en vez de mostrar cero', () => {
    const cell = prepQuantityCell(item('Cebolla', 0, 0, false));

    expect(cell.state).toBe('no_par');
    expect(cell.quantity).toBeNull();
  });

  it('deja leer un cero real, que es un par ya cumplido', () => {
    const cell = prepQuantityCell(item('Cebolla', 0));

    expect(cell.state).toBe('quantity');
    expect(scaledQuantityText(cell.quantity, () => 'kg')).toBe('0 kg');
  });

  it('muestra la cantidad con su unidad', () => {
    expect(scaledQuantityText(item('Leche', 1500, 3).prepQuantity, () => 'kg')).toBe('1.5 kg');
  });
});

describe('la ventana del pronostico', () => {
  it('nombra las dos fechas que respondio el servidor', () => {
    expect(forecastWindowText('2026-09-10', '2026-09-17')).toBe(
      'Uso previsto del 2026-09-10 al 2026-09-17',
    );
  });

  it('no inventa una ventana cuando la respuesta no la trae', () => {
    expect(forecastWindowText(null, null)).toBeNull();
    expect(forecastWindowText('2026-09-10', null)).toBeNull();
  });
});

describe('el nombre del archivo de etiquetas', () => {
  it('nombra la fecha de la hoja', () => {
    expect(labelSheetFilename(new Date(2026, 8, 17))).toBe('etiquetas-preparacion-2026-09-17.png');
  });

  it('rellena el mes y el dia con dos digitos', () => {
    expect(labelSheetFilename(new Date(2026, 0, 5))).toBe('etiquetas-preparacion-2026-01-05.png');
  });
});
