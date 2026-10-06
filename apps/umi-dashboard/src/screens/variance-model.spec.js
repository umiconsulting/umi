import { describe, expect, it } from 'vitest';
import '@/test/i18n.jsx';
import {
  basisLabel,
  decompositionBalances,
  decompositionCheck,
  derivedUnexplained,
  lineScale,
  menuClassTone,
  menuCostText,
  menuMarginText,
  quantityText,
  signedQuantityText,
  sortMenuItems,
  sortVarianceLines,
  unexplainedSeverity,
  varianceCounts,
} from './variance-model.js';

// ── fixtures ────────────────────────────────────────────────────────────────

function quantity(value, scale = 3, unit = 'kilogram') {
  return { value, scale, unit };
}

/**
 * One variance line. The default is a line whose decomposition adds up: actual
 * usage is 12.000 kg more than the recipe says, 1.000 kg is waste, 4.000 kg is a
 * yield loss and 7.000 kg nobody can explain.
 */
function line(overrides = {}) {
  return {
    inventoryItemId: 'item-1',
    publicReference: 'LECHE',
    displayName: 'Leche entera',
    unit: 'liter',
    quantityScale: 3,
    openingQuantity: quantity(20000),
    receivedQuantity: quantity(10000),
    productionProducedQuantity: quantity(0),
    closingQuantity: quantity(18000),
    actualUsageQuantity: quantity(12000),
    theoreticalUsageQuantity: quantity(1),
    varianceQuantity: quantity(11999),
    wasteQuantity: quantity(1000),
    damageQuantity: quantity(0),
    countCorrectionQuantity: quantity(0),
    yieldLossQuantity: quantity(4000),
    unexplainedQuantity: quantity(6999),
    ...overrides,
  };
}

function menuItem(overrides = {}) {
  return {
    productId: 'p1',
    productName: 'Pumpkin Spice Latte',
    soldQuantity: 40,
    priceMinor: 9100,
    plateCostMinor: 748,
    marginMinor: 8352,
    marginBasisPoints: 9178,
    popularityShareBasisPoints: 2500,
    marginShareBasisPoints: 4000,
    classification: 'star',
    ...overrides,
  };
}

// ── the decomposition ───────────────────────────────────────────────────────

describe('la descomposicion cuadra o no cuadra', () => {
  it('cierra cuando la variacion es la suma de las partes y el resto', () => {
    const check = decompositionCheck(line());

    expect(check.balanced).toBe(true);
    expect(check.residual.value).toBe(0n);
    expect(decompositionBalances(line())).toBe(true);
  });

  it('no cierra cuando el resto no es lo que sobra', () => {
    // 1000 + 0 + 0 + 4000 + 6999 = 11999. A remainder of 6000 leaves 999 units
    // that the answer does not account for.
    const broken = line({ unexplainedQuantity: quantity(6000) });

    const check = decompositionCheck(broken);
    expect(check.balanced).toBe(false);
    expect(check.residual.value).toBe(999n);
    expect(decompositionBalances(broken)).toBe(false);
  });

  it('suma una correccion de conteo negativa', () => {
    // A count that FOUND stock lowers the actual usage: 11999 = 1000 + 0 − 500
    // + 4000 + 7499.
    const corrected = line({
      countCorrectionQuantity: quantity(-500),
      unexplainedQuantity: quantity(7499),
    });

    expect(decompositionBalances(corrected)).toBe(true);
  });

  it('compara cantidades de escalas distintas sin perder una unidad', () => {
    const mixed = line({
      quantityScale: 3,
      varianceQuantity: quantity(11999, 3),
      wasteQuantity: quantity(1, 0),
      yieldLossQuantity: quantity(4000, 3),
      unexplainedQuantity: quantity(6999, 3),
    });

    expect(lineScale(mixed)).toBe(3);
    expect(decompositionBalances(mixed)).toBe(true);
  });

  it('no afirma que cuadra cuando falta una parte en la respuesta', () => {
    expect(decompositionBalances(line({ yieldLossQuantity: null }))).toBe(false);
  });

  it('deriva el resto de la variacion menos las partes con nombre', () => {
    const derived = derivedUnexplained(line());

    expect(derived.value).toBe(6999n);
    expect(derived.scale).toBe(3);
  });
});

describe('que tan grave es lo que no se explica', () => {
  it('no marca alarma cuando todo tiene nombre', () => {
    const explained = line({
      varianceQuantity: quantity(5000),
      wasteQuantity: quantity(3000),
      yieldLossQuantity: quantity(2000),
      unexplainedQuantity: quantity(0),
    });

    expect(unexplainedSeverity(explained)).toBe('none');
  });

  it('marca alarma cuando el resto es la mayor parte de la variacion', () => {
    expect(unexplainedSeverity(line())).toBe('high');
  });

  it('no marca alarma cuando el resto es una parte menor', () => {
    const mostlyNamed = line({
      varianceQuantity: quantity(12000),
      wasteQuantity: quantity(11000),
      yieldLossQuantity: quantity(0),
      unexplainedQuantity: quantity(1000),
    });

    expect(unexplainedSeverity(mostlyNamed)).toBe('low');
    expect(varianceCounts([line(), mostlyNamed]).high).toBe(1);
    expect(varianceCounts([line(), mostlyNamed]).all).toBe(2);
  });
});

// ── the order of both tables ────────────────────────────────────────────────

describe('el orden de la tabla de variacion', () => {
  it('pone primero el resto sin explicar mas grande', () => {
    const rows = sortVarianceLines([
      line({ displayName: 'Cebolla', unexplainedQuantity: quantity(100) }),
      line({ displayName: 'Leche', unexplainedQuantity: quantity(9000) }),
      line({ displayName: 'Harina', unexplainedQuantity: quantity(3000) }),
      line({ displayName: 'Salsa', unexplainedQuantity: quantity(0) }),
    ]);

    expect(rows.map((row) => row.displayName)).toEqual(['Leche', 'Harina', 'Cebolla', 'Salsa']);
  });

  it('ordena por tamano, no por signo', () => {
    // A large negative remainder is the same defect seen from the other side.
    const rows = sortVarianceLines([
      line({ displayName: 'Positivo chico', unexplainedQuantity: quantity(200) }),
      line({ displayName: 'Negativo grande', unexplainedQuantity: quantity(-8000) }),
      line({ displayName: 'Positivo grande', unexplainedQuantity: quantity(9000) }),
    ]);

    expect(rows.map((row) => row.displayName)).toEqual([
      'Positivo grande',
      'Negativo grande',
      'Positivo chico',
    ]);
  });

  it('compara escalas distintas y deja el nombre como desempate', () => {
    const rows = sortVarianceLines([
      line({ displayName: 'Zanahoria', unexplainedQuantity: quantity(1500, 3) }),
      line({ displayName: 'Ajonjoli', unexplainedQuantity: quantity(1500, 3) }),
      line({ displayName: 'Queso', unexplainedQuantity: quantity(2, 0) }),
    ]);

    expect(rows.map((row) => row.displayName)).toEqual(['Queso', 'Ajonjoli', 'Zanahoria']);
  });
});

describe('el orden de la tabla de clases', () => {
  it('agrupa en el orden estable de las cuatro clases', () => {
    const rows = sortMenuItems([
      menuItem({ productName: 'Dog', classification: 'dog' }),
      menuItem({ productName: 'Puzzle', classification: 'puzzle' }),
      menuItem({ productName: 'Star', classification: 'star' }),
      menuItem({ productName: 'Plow', classification: 'plow_horse' }),
      menuItem({
        productName: 'Sin costo',
        classification: 'unclassified',
        marginMinor: null,
        plateCostMinor: null,
      }),
    ]);

    expect(rows.map((row) => row.classification)).toEqual([
      'star',
      'plow_horse',
      'puzzle',
      'dog',
      'unclassified',
    ]);
  });

  it('pone el margen mas grande primero dentro de una clase', () => {
    const rows = sortMenuItems([
      menuItem({ productName: 'Chico', classification: 'star', marginMinor: 1000 }),
      menuItem({ productName: 'Grande', classification: 'star', marginMinor: 9000 }),
    ]);

    expect(rows.map((row) => row.productName)).toEqual(['Grande', 'Chico']);
  });

  it('deja al final de su clase al platillo que todavia no se puede costear', () => {
    const rows = sortMenuItems([
      menuItem({ productName: 'Sin costo', classification: 'dog', marginMinor: null }),
      menuItem({ productName: 'Con costo', classification: 'dog', marginMinor: 100 }),
    ]);

    expect(rows.map((row) => row.productName)).toEqual(['Con costo', 'Sin costo']);
  });
});

// ── the class chip ──────────────────────────────────────────────────────────

describe('el chip de clase', () => {
  it('usa los tonos que la aplicacion ya tiene', () => {
    expect(menuClassTone('star')).toBe('active');
    expect(menuClassTone('plow_horse')).toBe('info');
    expect(menuClassTone('puzzle')).toBe('trial');
    expect(menuClassTone('dog')).toBe('susp');
    expect(menuClassTone('unclassified')).toBe('neutral');
  });

  it('trata una clase desconocida como sin clasificar', () => {
    expect(menuClassTone('nueva_clase')).toBe('neutral');
    expect(menuClassTone(undefined)).toBe('neutral');
  });
});

// ── money ───────────────────────────────────────────────────────────────────

describe('el dinero de un costo ausente', () => {
  it('no convierte un costo desconocido en cero', () => {
    expect(menuCostText(null)).toBeNull();
    expect(menuMarginText(null)).toBeNull();
    // Not a number at all: NaN is not a price either.
    expect(menuCostText(Number.NaN)).toBeNull();
  });

  it('formatea un costo real y deja leer un cero real', () => {
    expect(menuCostText(748)).toBe('$7.48');
    expect(menuMarginText(0)).toBe('$0.00');
  });

  it('acepta el formateador del llamador para no depender del idioma', () => {
    expect(menuCostText(1234, (minor) => `#${minor}`)).toBe('#1234');
    expect(menuCostText(null, (minor) => `#${minor}`)).toBeNull();
  });
});

// ── the basis and the quantities the report prints ──────────────────────────

describe('la base y las cantidades que se imprimen', () => {
  it('nombra la base disponible', () => {
    expect(basisLabel('available_stock')).toBeTruthy();
    expect(basisLabel('otra_base')).toBeNull();
  });

  it('imprime una cantidad con su unidad', () => {
    expect(quantityText(quantity(1500, 3, 'liter'), () => 'L')).toBe('1.5 L');
    expect(quantityText(null)).toBeNull();
  });

  it('imprime el signo de una cantidad con signo', () => {
    expect(signedQuantityText(quantity(1500, 3, 'liter'), () => 'L')).toBe('+1.5 L');
    expect(signedQuantityText(quantity(-1500, 3, 'liter'), () => 'L')).toBe('-1.5 L');
    expect(signedQuantityText(quantity(0, 3, 'liter'), () => 'L')).toBe('0 L');
  });
});
