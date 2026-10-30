import 'dart:convert';
import 'dart:io';

import '../../generated/dart/lib/umi_contract.dart';

void check(bool value, String message) {
  if (!value) throw StateError(message);
}

void main() {
  final fixtures = jsonDecode(
    File.fromUri(
      Platform.script.resolve('../fixtures/initial-cost-dart-updates.json'),
    ).readAsStringSync(),
  ) as Map<String, dynamic>;
  const requests = {
    'omitted': InventoryAuthoringItemUpdateRequest(
      commandId: '7f000000-0000-4000-8000-000000000001',
      idempotencyKey: '7f000000-0000-4000-8000-000000000002',
      inventoryItemId: '7f000000-0000-4000-8000-000000000003',
      displayName: 'Renamed ingredient',
      trackingPolicy: 'tracked',
      negativeStockPolicy: 'block',
      expectedVersion: 1,
    ),
    'null': InventoryAuthoringItemUpdateRequest(
      commandId: '7f000000-0000-4000-8000-000000000001',
      idempotencyKey: '7f000000-0000-4000-8000-000000000002',
      inventoryItemId: '7f000000-0000-4000-8000-000000000003',
      displayName: 'Renamed ingredient',
      trackingPolicy: 'tracked',
      negativeStockPolicy: 'block',
      expectedVersion: 1,
      initialUnitCostMinor: null,
    ),
    'zero': InventoryAuthoringItemUpdateRequest(
      commandId: '7f000000-0000-4000-8000-000000000001',
      idempotencyKey: '7f000000-0000-4000-8000-000000000002',
      inventoryItemId: '7f000000-0000-4000-8000-000000000003',
      displayName: 'Renamed ingredient',
      trackingPolicy: 'tracked',
      negativeStockPolicy: 'block',
      expectedVersion: 1,
      initialUnitCostMinor: 0,
    ),
    'positive': InventoryAuthoringItemUpdateRequest(
      commandId: '7f000000-0000-4000-8000-000000000001',
      idempotencyKey: '7f000000-0000-4000-8000-000000000002',
      inventoryItemId: '7f000000-0000-4000-8000-000000000003',
      displayName: 'Renamed ingredient',
      trackingPolicy: 'tracked',
      negativeStockPolicy: 'block',
      expectedVersion: 1,
      initialUnitCostMinor: 12000,
    ),
  };
  for (final entry in requests.entries) {
    final expected = fixtures[entry.key] as Map<String, dynamic>;
    final actual = entry.value.toJson();
    check(
      actual.containsKey('initialUnitCostMinor') ==
          expected.containsKey('initialUnitCostMinor'),
      '${entry.key}: initial cost presence changed',
    );
    check(
      actual.length == expected.length &&
          expected.entries.every(
            (entry) =>
                actual.containsKey(entry.key) &&
                actual[entry.key] == entry.value,
          ),
      '${entry.key}: constructor serialization changed: $actual',
    );
    final decoded = InventoryAuthoringItemUpdateRequest.fromJson(expected)
        .toJson();
    check(
      decoded.length == expected.length &&
          expected.entries.every(
            (entry) =>
                decoded.containsKey(entry.key) &&
                decoded[entry.key] == entry.value,
          ),
      '${entry.key}: decoded presence changed: $decoded',
    );
    check(
      entry.value.initialUnitCostMinor == expected['initialUnitCostMinor'],
      '${entry.key}: typed field changed',
    );
  }
  var constructorRefused = false;
  try {
    InventoryAuthoringItemUpdateRequest(
      commandId: '7f000000-0000-4000-8000-000000000001',
      idempotencyKey: '7f000000-0000-4000-8000-000000000002',
      inventoryItemId: '7f000000-0000-4000-8000-000000000003',
      expectedVersion: 1,
      initialUnitCostMinor: 'invalid',
    );
  } on TypeError {
    constructorRefused = true;
  }
  check(constructorRefused, 'constructor accepted a malformed amount');
  var decoderRefused = false;
  try {
    InventoryAuthoringItemUpdateRequest.fromJson({
      ...fixtures['omitted'] as Map<String, dynamic>,
      'initialUnitCostMinor': 'invalid',
    });
  } on TypeError {
    decoderRefused = true;
  }
  check(decoderRefused, 'decoder accepted a malformed amount');
  stdout.writeln(
    jsonEncode(requests.map((key, value) => MapEntry(key, value.toJson()))),
  );
}
