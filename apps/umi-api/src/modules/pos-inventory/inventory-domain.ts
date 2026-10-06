export type InventoryEntryType =
  | 'opening_balance'
  | 'reservation_created'
  | 'reservation_released'
  | 'reservation_expired'
  | 'sale_committed'
  | 'refund_restocked'
  | 'refund_not_restocked'
  | 'inspection_queued'
  | 'adjustment_increase'
  | 'adjustment_decrease'
  | 'waste_recorded'
  | 'damage_recorded'
  | 'quarantine_entered'
  | 'quarantine_released'
  | 'count_correction';

export interface InventoryEffect {
  onHand: number;
  reserved: number;
  committed: number;
  damaged: number;
  quarantine: number;
  waste: number;
  inTransit: number;
}

export interface InventoryFact {
  sequence: number;
  type: InventoryEntryType;
  quantity: number;
}

const safe = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError('INVENTORY_QUANTITY_OUT_OF_RANGE');
  return value;
};

const zeros = (): InventoryEffect => ({
  onHand: 0,
  reserved: 0,
  committed: 0,
  damaged: 0,
  quarantine: 0,
  waste: 0,
  inTransit: 0,
});

export const convertInventoryQuantity = (
  quantity: number,
  sourceScale: number,
  numerator: number,
  denominator: number,
  targetScale: number,
): number => {
  safe(quantity);
  safe(numerator);
  safe(denominator);
  if (
    quantity < 0 ||
    numerator <= 0 ||
    denominator <= 0 ||
    sourceScale < 0 ||
    sourceScale > 6 ||
    targetScale < 0 ||
    targetScale > 6
  ) {
    throw new RangeError('INVENTORY_CONVERSION_INVALID');
  }
  const sourceFactor = 10n ** BigInt(sourceScale);
  const targetFactor = 10n ** BigInt(targetScale);
  const divisor = sourceFactor * BigInt(denominator);
  const scaled = BigInt(quantity) * BigInt(numerator) * targetFactor;
  if (scaled % divisor !== 0n) throw new RangeError('INVENTORY_CONVERSION_NOT_EXACT');
  const result = Number(scaled / divisor);
  return safe(result);
};

export const inventoryEntryEffect = (
  type: InventoryEntryType,
  quantity: number,
): InventoryEffect => {
  safe(quantity);
  if (quantity <= 0) throw new RangeError('INVENTORY_QUANTITY_INVALID');
  const effect = zeros();
  switch (type) {
    case 'opening_balance':
    case 'refund_restocked':
    case 'adjustment_increase':
      effect.onHand = quantity;
      break;
    case 'reservation_created':
      effect.reserved = quantity;
      break;
    case 'reservation_released':
    case 'reservation_expired':
      effect.reserved = -quantity;
      break;
    case 'sale_committed':
      effect.onHand = -quantity;
      effect.reserved = -quantity;
      effect.committed = quantity;
      break;
    case 'adjustment_decrease':
      effect.onHand = -quantity;
      break;
    case 'waste_recorded':
      effect.onHand = -quantity;
      effect.waste = quantity;
      break;
    case 'damage_recorded':
      effect.damaged = quantity;
      break;
    case 'quarantine_entered':
      effect.quarantine = quantity;
      break;
    case 'inspection_queued':
      effect.onHand = quantity;
      effect.quarantine = quantity;
      break;
    case 'quarantine_released':
      effect.quarantine = -quantity;
      break;
    case 'count_correction':
      throw new RangeError('COUNT_CORRECTION_REQUIRES_DIRECTION');
    case 'refund_not_restocked':
      break;
  }
  return effect;
};

export const applyInventoryFacts = (facts: InventoryFact[]) => {
  const balance = { ...zeros(), available: 0, ledgerSequence: 0 };
  for (const fact of facts) {
    if (fact.sequence !== balance.ledgerSequence + 1) {
      throw new RangeError('INVENTORY_LEDGER_SEQUENCE_GAP');
    }
    const effect = inventoryEntryEffect(fact.type, fact.quantity);
    for (const key of Object.keys(effect) as Array<keyof InventoryEffect>) {
      balance[key] = safe(balance[key] + effect[key]);
    }
    balance.ledgerSequence = fact.sequence;
  }
  balance.available = safe(
    balance.onHand - balance.reserved - balance.quarantine - balance.damaged,
  );
  return balance;
};

export const calculateCompositeAvailability = (
  components: Array<{ available: number; required: number }>,
): number => {
  if (components.length === 0) return 0;
  return components.reduce((limit, component) => {
    safe(component.available);
    safe(component.required);
    if (component.available < 0 || component.required <= 0) {
      throw new RangeError('INVENTORY_COMPONENT_INVALID');
    }
    return Math.min(limit, Math.floor(component.available / component.required));
  }, Number.MAX_SAFE_INTEGER);
};

export const calculateInventoryVariance = (
  expected: number,
  counted: number,
  tolerance: number,
  ledgerSequence: number,
) => {
  safe(expected);
  safe(counted);
  safe(tolerance);
  safe(ledgerSequence);
  if (counted < 0 || tolerance < 0 || ledgerSequence < 0) {
    throw new RangeError('INVENTORY_COUNT_INVALID');
  }
  const signed = safe(counted - expected);
  const absolute = safe(Math.abs(signed));
  return {
    expected,
    counted,
    signed,
    absolute,
    tolerance,
    withinTolerance: absolute <= tolerance,
    approvalRequired: absolute > tolerance,
    ledgerSequence,
  };
};
