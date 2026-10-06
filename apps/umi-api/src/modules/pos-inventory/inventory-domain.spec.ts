import { describe, expect, it } from 'vitest';
import {
  applyInventoryFacts,
  calculateCompositeAvailability,
  calculateInventoryVariance,
  convertInventoryQuantity,
  inventoryEntryEffect,
  type InventoryFact,
} from './inventory-domain';

describe('inventory domain', () => {
  it('converts scaled quantities without floating-point authority', () => {
    expect(convertInventoryQuantity(2, 0, 1000, 1, 0)).toBe(2000);
    expect(() => convertInventoryQuantity(1, 0, 1, 3, 0)).toThrow('INVENTORY_CONVERSION_NOT_EXACT');
  });

  it('keeps reservation and commitment effects distinct', () => {
    expect(inventoryEntryEffect('reservation_created', 500)).toEqual({
      onHand: 0,
      reserved: 500,
      committed: 0,
      damaged: 0,
      quarantine: 0,
      waste: 0,
      inTransit: 0,
    });
    expect(inventoryEntryEffect('sale_committed', 500)).toEqual({
      onHand: -500,
      reserved: -500,
      committed: 500,
      damaged: 0,
      quarantine: 0,
      waste: 0,
      inTransit: 0,
    });
  });

  it('rebuilds the balance from ordered immutable facts', () => {
    const facts: InventoryFact[] = [
      { sequence: 1, type: 'opening_balance', quantity: 5000 },
      { sequence: 2, type: 'reservation_created', quantity: 1200 },
      { sequence: 3, type: 'sale_committed', quantity: 1200 },
      { sequence: 4, type: 'damage_recorded', quantity: 300 },
    ];
    expect(applyInventoryFacts(facts)).toEqual({
      onHand: 3800,
      reserved: 0,
      available: 3500,
      committed: 1200,
      damaged: 300,
      quarantine: 0,
      waste: 0,
      inTransit: 0,
      ledgerSequence: 4,
    });
  });

  it('keeps damaged and quarantined stock inside physical on-hand quantity', () => {
    expect(inventoryEntryEffect('damage_recorded', 100)).toMatchObject({
      onHand: 0,
      damaged: 100,
    });
    expect(inventoryEntryEffect('quarantine_entered', 100)).toMatchObject({
      onHand: 0,
      quarantine: 100,
    });
    expect(inventoryEntryEffect('inspection_queued', 100)).toMatchObject({
      onHand: 100,
      quarantine: 100,
    });
  });

  it('uses the limiting component for composite availability', () => {
    expect(
      calculateCompositeAvailability([
        { available: 10000, required: 2500 },
        { available: 9000, required: 3000 },
      ]),
    ).toBe(3);
  });

  it('calculates inventory variance at one ledger sequence', () => {
    expect(calculateInventoryVariance(1200, 1000, 100, 17)).toEqual({
      expected: 1200,
      counted: 1000,
      signed: -200,
      absolute: 200,
      tolerance: 100,
      withinTolerance: false,
      approvalRequired: true,
      ledgerSequence: 17,
    });
  });
});
