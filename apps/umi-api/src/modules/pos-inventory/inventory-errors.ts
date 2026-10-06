import { commandFingerprint } from '../integrity/canonical-json';

const INVENTORY_CONFLICT_CODES = [
  'INVENTORY_UNAVAILABLE',
  'INVENTORY_POLICY_REQUIRED',
  'INVENTORY_MAPPING_REQUIRED',
  'INVENTORY_CONSUMPTION_REQUIRED',
  'INVENTORY_ITEM_ARCHIVED',
  'INVENTORY_UNIT_CONVERSION_REQUIRED',
  'INVENTORY_QUANTITY_NOT_EXACT',
  'INVENTORY_QUANTITY_OUT_OF_RANGE',
  'INVENTORY_SOURCE_STATE_INSUFFICIENT',
  'NEGATIVE_STOCK_BLOCKED',
  'RESERVATION_CONFLICT',
  'RESERVATION_EXPIRED',
  'RESERVATION_VERSION_CHANGED',
  'RECIPE_CHANGED',
  'RESTOCK_INTENT_NOT_ELIGIBLE',
  'RESTOCK_EXCEEDS_ORIGINAL_CONSUMPTION',
  'STALE_INVENTORY_COUNT',
  'INVENTORY_COUNT_NOT_FOUND',
  'INVENTORY_COUNT_SCOPE_MISMATCH',
] as const;

export function inventoryConflictCode(
  error: unknown,
): (typeof INVENTORY_CONFLICT_CODES)[number] | null {
  const message = error instanceof Error ? error.message : String(error);
  return INVENTORY_CONFLICT_CODES.find((code) => message.includes(code)) ?? null;
}

export function inventoryOperationFingerprint(
  type: string,
  dto: { approvalId: string | null; approvalFingerprint: string | null },
): string {
  const { approvalId: _approvalId, approvalFingerprint: _approvalFingerprint, ...command } = dto;
  return commandFingerprint(type, command);
}
