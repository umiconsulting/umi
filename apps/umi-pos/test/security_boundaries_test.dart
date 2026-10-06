import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/platform/platform_adapters.dart';

import 'support/fakes.dart';

void main() {
  test('telemetry removes sensitive fields and bounds values', () {
    final exporter = RecordingExporter();
    final telemetry = SafeTelemetry(
      enabled: true,
      context: TelemetryContext.current(testConfig),
      exporter: exporter,
    );
    telemetry.event(
      ClientEvent(
        name: 'test',
        values: {'accessToken': 'secret-value', 'safe': 'x' * 300},
      ),
    );
    expect(exporter.events.single.values, isNot(contains('accessToken')));
    expect((exporter.events.single.values['safe'] as String).length, 256);
  });

  test('platform adapters contain no direct hardware side effects', () async {
    const adapters = PlatformAdapters.unsupported();
    expect(
      (await adapters.connectivity.isOnline()).status,
      CapabilityStatus.unavailable,
    );
  });
}
