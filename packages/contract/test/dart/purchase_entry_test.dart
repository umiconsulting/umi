import 'dart:convert';

import '../../generated/dart/lib/umi_contract.dart';

void main() {
  const id = '00000000-0000-4000-8000-000000000001';
  const fields = <String, Object?>{
    'commandId': id,
    'idempotencyKey': id,
    'locationId': id,
    'inventoryLocationId': id,
    'issuedOn': '2026-11-03',
    'currency': 'MXN',
    'lines': <Map<String, Object?>>[
      <String, Object?>{
        'inventoryItemId': id,
        'quantity': <String, Object?>{'value': 1, 'scale': 0, 'unit': 'unit'},
        'unitCostMinor': 100,
      },
    ],
  };
  final omitted = RecordInventoryPurchaseRequest(
    commandId: id,
    idempotencyKey: id,
    locationId: id,
    inventoryLocationId: id,
    issuedOn: '2026-11-03',
    currency: 'MXN',
    lines: fields['lines'] as List<Map<String, Object?>>,
  );
  final explicitNull = RecordInventoryPurchaseRequest.fromJson({
    ...fields,
    'artifactBase64': null,
  });
  final photo = RecordInventoryPurchaseRequest.fromJson({
    ...fields,
    'artifactBase64': 'iVBORw0KGgo=',
  });
  print(
    jsonEncode({
      'omitted': omitted.toJson(),
      'omittedRoundTrip': RecordInventoryPurchaseRequest.fromJson(
        omitted.toJson(),
      ).toJson(),
      'null': explicitNull.toJson(),
      'nullRoundTrip': RecordInventoryPurchaseRequest.fromJson(
        explicitNull.toJson(),
      ).toJson(),
      'photo': photo.toJson(),
    }),
  );
}
