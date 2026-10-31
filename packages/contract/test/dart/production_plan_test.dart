import 'dart:convert';

import '../../generated/dart/lib/umi_contract.dart';

void main() {
  const id = '00000000-0000-4000-8000-000000000001';
  final fingerprint = List.filled(64, 'a').join();
  final quantity = <String, Object?>{'value': 5, 'scale': 0, 'unit': 'unit'};
  final legacy = ProductionRecord(
    locationId: id,
    inventoryLocationId: id,
    operatorSessionId: id,
    commandId: id,
    idempotencyKey: id,
    expectedVersion: 1,
    policyFingerprint: fingerprint,
    businessDate: '2026-10-30',
    outputItemId: id,
    quantity: quantity,
  );
  final planned = ProductionRecord(
    locationId: id,
    inventoryLocationId: id,
    operatorSessionId: id,
    commandId: id,
    idempotencyKey: id,
    expectedVersion: 1,
    policyFingerprint: fingerprint,
    businessDate: '2026-10-30',
    outputItemId: id,
    quantity: quantity,
    plannedQuantity: quantity,
    recipeFingerprint: fingerprint,
  );
  final explicitNull = ProductionRecord(
    locationId: id,
    inventoryLocationId: id,
    operatorSessionId: id,
    commandId: id,
    idempotencyKey: id,
    expectedVersion: 1,
    policyFingerprint: fingerprint,
    businessDate: '2026-10-30',
    outputItemId: id,
    quantity: quantity,
    plannedQuantity: null,
    recipeFingerprint: null,
  );
  print(
    jsonEncode({
      'legacy': legacy.toJson(),
      'legacyRoundTrip': ProductionRecord.fromJson(legacy.toJson()).toJson(),
      'planned': planned.toJson(),
      'plannedRoundTrip': ProductionRecord.fromJson(planned.toJson()).toJson(),
      'null': explicitNull.toJson(),
      'nullRoundTrip': ProductionRecord.fromJson(explicitNull.toJson())
          .toJson(),
    }),
  );
}
