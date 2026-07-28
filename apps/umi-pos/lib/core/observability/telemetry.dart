import 'package:flutter/foundation.dart';

import '../config/app_config.dart';

final class ClientEvent {
  const ClientEvent({required this.name, this.values = const {}});
  final String name;
  final Map<String, Object?> values;
}

final class TelemetryContext {
  const TelemetryContext({
    required this.appVersion,
    required this.environment,
    required this.platform,
  });

  factory TelemetryContext.current(AppConfig config) => TelemetryContext(
    appVersion: '0.1.0',
    environment: config.environment.name,
    platform: kIsWeb ? 'web' : defaultTargetPlatform.name,
  );

  final String appVersion;
  final String environment;
  final String platform;
}

abstract interface class TelemetryExporter {
  void export(ClientEvent event);
}

final class NoopTelemetryExporter implements TelemetryExporter {
  const NoopTelemetryExporter();
  @override
  void export(ClientEvent event) {}
}

abstract interface class Telemetry {
  void event(ClientEvent event);
}

final class SafeTelemetry implements Telemetry {
  const SafeTelemetry({
    required this.enabled,
    required this.context,
    required this.exporter,
  });

  static const _blockedFragments = [
    'token',
    'secret',
    'password',
    'pin',
    'authorization',
    'receipt',
    'payment',
    'phone',
    'email',
  ];
  static const maxValues = 32;
  static const maxValueLength = 256;

  final bool enabled;
  final TelemetryContext context;
  final TelemetryExporter exporter;

  @override
  void event(ClientEvent event) {
    if (!enabled) return;
    final values = <String, Object?>{
      'appVersion': context.appVersion,
      'environment': context.environment,
      'platform': context.platform,
    };
    for (final entry in event.values.entries.take(maxValues - values.length)) {
      final key = entry.key.toLowerCase();
      if (_blockedFragments.any(key.contains)) continue;
      final value = entry.value;
      values[entry.key] = value is String && value.length > maxValueLength
          ? value.substring(0, maxValueLength)
          : value;
    }
    exporter.export(ClientEvent(name: event.name, values: values));
  }
}
