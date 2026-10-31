import 'dart:convert';
import 'dart:io';

import '../../generated/dart/lib/umi_contract.dart';
import '../../generated/dart/test/optional_collection_fixture.dart';

void check(bool value, String message) {
  if (!value) throw StateError(message);
}

void checkMapConstructors() {
  final cases = <String, UpdateHardwareRequest>{
    'empty': UpdateHardwareRequest(
      locationId: 'location',
      operatorSessionId: 'session',
      commandId: 'command',
      idempotencyKey: 'idempotency',
      enabled: true,
      expectedVersion: 1,
      connectionConfiguration: {},
    ),
    'nonempty': UpdateHardwareRequest(
      locationId: 'location',
      operatorSessionId: 'session',
      commandId: 'command',
      idempotencyKey: 'idempotency',
      enabled: true,
      expectedVersion: 1,
      connectionConfiguration: {'host': '127.0.0.1'},
    ),
    'typed': UpdateHardwareRequest(
      locationId: 'location',
      operatorSessionId: 'session',
      commandId: 'command',
      idempotencyKey: 'idempotency',
      enabled: true,
      expectedVersion: 1,
      connectionConfiguration: <String, Object?>{'port': 9100},
    ),
    'null': UpdateHardwareRequest(
      locationId: 'location',
      operatorSessionId: 'session',
      commandId: 'command',
      idempotencyKey: 'idempotency',
      enabled: true,
      expectedVersion: 1,
      connectionConfiguration: null,
    ),
    'omitted': UpdateHardwareRequest(
      locationId: 'location',
      operatorSessionId: 'session',
      commandId: 'command',
      idempotencyKey: 'idempotency',
      enabled: true,
      expectedVersion: 1,
    ),
    'const_empty': const UpdateHardwareRequest(
      locationId: 'location',
      operatorSessionId: 'session',
      commandId: 'command',
      idempotencyKey: 'idempotency',
      enabled: true,
      expectedVersion: 1,
      connectionConfiguration: {},
    ),
    'const_nonempty': const UpdateHardwareRequest(
      locationId: 'location',
      operatorSessionId: 'session',
      commandId: 'command',
      idempotencyKey: 'idempotency',
      enabled: true,
      expectedVersion: 1,
      connectionConfiguration: {'port': 9100},
    ),
    'const_typed': const UpdateHardwareRequest(
      locationId: 'location',
      operatorSessionId: 'session',
      commandId: 'command',
      idempotencyKey: 'idempotency',
      enabled: true,
      expectedVersion: 1,
      connectionConfiguration: <String, Object?>{'enabled': true},
    ),
    'const_null': const UpdateHardwareRequest(
      locationId: 'location',
      operatorSessionId: 'session',
      commandId: 'command',
      idempotencyKey: 'idempotency',
      enabled: true,
      expectedVersion: 1,
      connectionConfiguration: null,
    ),
    'const_omitted': const UpdateHardwareRequest(
      locationId: 'location',
      operatorSessionId: 'session',
      commandId: 'command',
      idempotencyKey: 'idempotency',
      enabled: true,
      expectedVersion: 1,
    ),
  };
  for (final entry in cases.entries) {
    final json = entry.value.toJson();
    check(
      json.containsKey('connectionConfiguration') ==
          (!entry.key.endsWith('omitted')),
      '${entry.key}: map presence changed',
    );
    check(
      jsonEncode(UpdateHardwareRequest.fromJson(json).toJson()) ==
          jsonEncode(json),
      '${entry.key}: map round trip changed',
    );
  }
  check(cases['empty']!.connectionConfiguration!.isEmpty, 'empty map changed');
  check(
    cases['nonempty']!.connectionConfiguration!['host'] == '127.0.0.1',
    'map value changed',
  );
  var refused = false;
  try {
    UpdateHardwareRequest.fromJson({
      ...cases['omitted']!.toJson(),
      'connectionConfiguration': [],
    });
  } on TypeError {
    refused = true;
  }
  check(refused, 'decoder accepted an invalid map shape');
  dynamic invalidMap = <Object?>[];
  var constructorRefused = false;
  try {
    UpdateHardwareRequest(
      locationId: 'location',
      operatorSessionId: 'session',
      commandId: 'command',
      idempotencyKey: 'idempotency',
      enabled: true,
      expectedVersion: 1,
      connectionConfiguration: invalidMap,
    );
  } on TypeError {
    constructorRefused = true;
  }
  check(constructorRefused, 'constructor accepted an invalid map shape');
}

void checkCollectionFixtures() {
  final cases = <String, OptionalCollectionFixture>{
    'omitted': OptionalCollectionFixture(),
    'null': OptionalCollectionFixture(
      configuration: null,
      values: null,
      rows: null,
    ),
    'empty': OptionalCollectionFixture(configuration: {}, values: [], rows: []),
    'nonempty': OptionalCollectionFixture(
      configuration: {'port': 9100},
      values: ['one'],
      rows: [
        {},
        {'host': '127.0.0.1'},
      ],
    ),
    'typed': OptionalCollectionFixture(
      configuration: <String, Object?>{},
      values: <String>[],
      rows: <Map<String, Object?>>[{}],
    ),
    'const_omitted': const OptionalCollectionFixture(),
    'const_null': const OptionalCollectionFixture(
      configuration: null,
      values: null,
      rows: null,
    ),
    'const_empty': const OptionalCollectionFixture(
      configuration: {},
      values: [],
      rows: [],
    ),
    'const_nonempty': const OptionalCollectionFixture(
      configuration: {'port': 9100},
      values: ['one'],
      rows: [
        {},
        {'host': '127.0.0.1'},
      ],
    ),
    'const_typed': const OptionalCollectionFixture(
      configuration: <String, Object?>{},
      values: <String>[],
      rows: <Map<String, Object?>>[{}],
    ),
  };
  for (final entry in cases.entries) {
    final json = entry.value.toJson();
    for (final key in ['configuration', 'values', 'rows']) {
      check(
        json.containsKey(key) == !entry.key.endsWith('omitted'),
        '${entry.key}: $key presence changed',
      );
    }
    check(
      jsonEncode(OptionalCollectionFixture.fromJson(json).toJson()) ==
          jsonEncode(json),
      '${entry.key}: collection round trip changed',
    );
  }
  check(cases['empty']!.values!.isEmpty, 'empty list changed');
  check(cases['nonempty']!.values!.single == 'one', 'list value changed');
  check(
    cases['const_nonempty']!.rows![1]['host'] == '127.0.0.1',
    'nested map changed',
  );
  for (final malformed in [
    <String, Object?>{'values': {}},
    <String, Object?>{'rows': 'invalid'},
    <String, Object?>{
      'values': [1],
    },
  ]) {
    var refused = false;
    try {
      jsonEncode(OptionalCollectionFixture.fromJson(malformed).toJson());
    } on TypeError {
      refused = true;
    }
    check(refused, 'decoder accepted an invalid list shape');
  }
  dynamic invalidList = <String, Object?>{};
  var constructorRefused = false;
  try {
    OptionalCollectionFixture(values: invalidList);
  } on TypeError {
    constructorRefused = true;
  }
  check(constructorRefused, 'constructor accepted an invalid list shape');
}

void main() {
  checkCollectionFixtures();
  checkMapConstructors();
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
