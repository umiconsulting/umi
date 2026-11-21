import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/observability/telemetry.dart';

void main() {
  test(
    'records structured failure events with device, build, connectivity, and journal context',
    () {
      final sinkLines = <String>[];
      var connectivity = 'offline';
      var pending = 7;

      final exporter = BufferedTelemetryExporter(
        maxEvents: 50,
        buildVersionProvider: () => '2.59.0+342',
        diagnosticSink: sinkLines.add,
        clock: () => DateTime.utc(2026, 11, 20, 18, 30, 0),
      );
      exporter.bindRuntimeContext(
        deviceIdProvider: () => 'dev-caja-principal',
        connectivityStateProvider: () => connectivity,
        pendingJournalCountProvider: () => pending,
      );

      final telemetry = SafeTelemetry(
        enabled: true,
        context: const TelemetryContext(
          appVersion: '2.59.0+342',
          environment: 'production',
          platform: 'android',
        ),
        exporter: exporter,
      );

      telemetry.event(
        const ClientEvent(
          name: 'checkout_failed',
          values: {
            'code': 'CART_VERSION_CONFLICT',
            'authorization': 'Bearer must-be-dropped',
            'operatorPin': '1234',
          },
        ),
      );

      connectivity = 'online';
      pending = 0;
      telemetry.event(
        const ClientEvent(
          name: 'replay_auth_blocked',
          values: {'phase': 'blockedByAuth'},
        ),
      );

      expect(exporter.length, 2);
      expect(sinkLines, hasLength(2));

      final first = jsonDecode(sinkLines.first) as Map<String, Object?>;
      expect(first['name'], 'checkout_failed');
      expect(first['occurredAt'], '2026-11-20T18:30:00.000Z');
      final firstValues = first['values']! as Map<String, Object?>;
      expect(firstValues['deviceId'], 'dev-caja-principal');
      expect(firstValues['buildVersion'], '2.59.0+342');
      expect(firstValues['connectivityState'], 'offline');
      expect(firstValues['pendingJournalCount'], 7);
      expect(firstValues['code'], 'CART_VERSION_CONFLICT');
      expect(firstValues.containsKey('authorization'), isFalse);
      expect(firstValues.containsKey('operatorPin'), isFalse);

      final secondValues = exporter.events.last.values;
      expect(secondValues['connectivityState'], 'online');
      expect(secondValues['pendingJournalCount'], 0);
    },
  );

  test(
    'caps at ring buffer limit and remains fail-open when sink or providers throw',
    () {
      final exporter = BufferedTelemetryExporter(
        maxEvents: 5,
        deviceIdProvider: () => throw StateError('vault unavailable'),
        buildVersionProvider: () => '2.59.0+342',
        diagnosticSink: (_) => throw StateError('log sink full'),
      );

      for (var i = 1; i <= 12; i++) {
        expect(
          () => exporter.export(
            ClientEvent(
              name: 'network.failure',
              values: {'seq': i, 'secretToken': 'never-stored'},
            ),
          ),
          returnsNormally,
        );
      }

      expect(exporter.length, 5);
      expect(exporter.droppedCount, 7);
      expect(
        exporter.events.map((e) => e.values['seq']),
        orderedEquals([8, 9, 10, 11, 12]),
      );
      expect(
        exporter.events.every((e) => !e.values.containsKey('secretToken')),
        isTrue,
      );
      expect(exporter.exportJsonLines(), hasLength(5));
    },
  );

  test('flushes batches cleanly, survives transport errors, and clears', () async {
    final deliveredBatches = <List<Map<String, Object?>>>[];
    var failNext = true;

    final exporter = BufferedTelemetryExporter(
      maxEvents: 20,
      batchSize: 2,
      diagnosticSink: (_) {},
      batchTransport: (batch) async {
        if (failNext) {
          failNext = false;
          throw StateError('network unreachable');
        }
        deliveredBatches.add(batch);
      },
    );

    for (var i = 1; i <= 5; i++) {
      exporter.export(
        ClientEvent(
          name: 'offline_checkout_blocked',
          values: {'attempt': i},
        ),
      );
    }

    // First flush fails open and keeps all 5 events intact in the ring buffer.
    expect(await exporter.flush(), 0);
    expect(exporter.length, 5);
    expect(deliveredBatches, isEmpty);

    // Second flush succeeds across 3 batches (2 + 2 + 1) and drains buffer.
    expect(await exporter.flush(), 5);
    expect(exporter.length, 0);
    expect(deliveredBatches.map((b) => b.length), [2, 2, 1]);

    // Adding more events and clearing resets the ring buffer cleanly.
    exporter.export(const ClientEvent(name: 'network.failure'));
    expect(exporter.length, 1);
    exporter.clear();
    expect(exporter.length, 0);
  });
}
