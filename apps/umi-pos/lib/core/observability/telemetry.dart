import 'dart:collection';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

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
    appVersion: config.release.version,
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

/// One structured, already-scrubbed diagnostic telemetry record.
final class TelemetryRecord {
  const TelemetryRecord({
    required this.occurredAt,
    required this.name,
    required this.values,
  });

  final DateTime occurredAt;
  final String name;
  final Map<String, Object?> values;

  Map<String, Object?> toJson() => {
    'occurredAt': occurredAt.toUtc().toIso8601String(),
    'name': name,
    'values': values,
  };

  String toJsonLine() => jsonEncode(toJson());
}

typedef TelemetryBatchTransport =
    Future<void> Function(List<Map<String, Object?>> batch);

void _defaultDiagnosticSink(String line) {
  debugPrint('[umi.telemetry] $line');
}

/// Bounded, fail-open production telemetry exporter.
///
/// Keeps the most recent [maxEvents] structured records in an in-memory ring
/// buffer for support bundles, emits compact JSON lines to [diagnosticSink] so
/// production logs capture operational failures (`checkout_failed`,
/// `offline_checkout_blocked`, `network.failure`, `replay_auth_blocked`, etc.),
/// and optionally flushes batches to a configured [endpoint] or
/// [batchTransport]. Never throws or blocks POS operations.
final class BufferedTelemetryExporter implements TelemetryExporter {
  BufferedTelemetryExporter({
    int maxEvents = 500,
    int batchSize = 50,
    String? Function()? deviceIdProvider,
    String? Function()? buildVersionProvider,
    String? Function()? connectivityStateProvider,
    int? Function()? pendingJournalCountProvider,
    void Function(String jsonLine)? diagnosticSink,
    TelemetryBatchTransport? batchTransport,
    Uri? endpoint,
    http.Client? httpClient,
    Duration flushTimeout = const Duration(seconds: 5),
    DateTime Function()? clock,
  }) : maxEvents = maxEvents < 1 ? 1 : maxEvents,
       batchSize = batchSize < 1 ? 1 : batchSize,
       _deviceIdProvider = deviceIdProvider,
       _buildVersionProvider = buildVersionProvider,
       _connectivityStateProvider = connectivityStateProvider,
       _pendingJournalCountProvider = pendingJournalCountProvider,
       _diagnosticSink = diagnosticSink ?? _defaultDiagnosticSink,
       _batchTransport = batchTransport,
       _endpoint = endpoint,
       _httpClient = httpClient,
       _flushTimeout = flushTimeout,
       _clock = clock ?? _utcNow;

  final int maxEvents;
  final int batchSize;
  String? Function()? _deviceIdProvider;
  String? Function()? _buildVersionProvider;
  String? Function()? _connectivityStateProvider;
  int? Function()? _pendingJournalCountProvider;
  final void Function(String jsonLine) _diagnosticSink;
  final TelemetryBatchTransport? _batchTransport;
  final Uri? _endpoint;
  http.Client? _httpClient;
  bool _ownsHttpClient = false;
  final Duration _flushTimeout;
  final DateTime Function() _clock;
  final ListQueue<TelemetryRecord> _buffer = ListQueue<TelemetryRecord>();
  int _droppedCount = 0;
  bool _flushing = false;

  static DateTime _utcNow() => DateTime.now().toUtc();

  /// Late-binds runtime context providers constructed after [SafeTelemetry]
  /// (such as `EntryController`, `ConnectivityController`, and
  /// `EncryptedOfflineJournal` in `AppCompositionRoot.production()`).
  void bindRuntimeContext({
    String? Function()? deviceIdProvider,
    String? Function()? buildVersionProvider,
    String? Function()? connectivityStateProvider,
    int? Function()? pendingJournalCountProvider,
  }) {
    if (deviceIdProvider != null) _deviceIdProvider = deviceIdProvider;
    if (buildVersionProvider != null) {
      _buildVersionProvider = buildVersionProvider;
    }
    if (connectivityStateProvider != null) {
      _connectivityStateProvider = connectivityStateProvider;
    }
    if (pendingJournalCountProvider != null) {
      _pendingJournalCountProvider = pendingJournalCountProvider;
    }
  }

  List<TelemetryRecord> get events =>
      List<TelemetryRecord>.unmodifiable(_buffer);

  List<String> exportJsonLines() =>
      _buffer.map((record) => record.toJsonLine()).toList(growable: false);

  int get length => _buffer.length;

  int get droppedCount => _droppedCount;

  void clear() {
    _buffer.clear();
  }

  @override
  void export(ClientEvent event) {
    try {
      final enriched = <String, Object?>{};
      for (final entry in event.values.entries) {
        final lower = entry.key.toLowerCase();
        if (SafeTelemetry.isBlockedKey(lower)) continue;
        enriched[entry.key] = _sanitizeValue(entry.value);
      }

      final buildVersion = _safeRead(_buildVersionProvider);
      if (buildVersion != null &&
          buildVersion.isNotEmpty &&
          !enriched.containsKey('buildVersion')) {
        enriched['buildVersion'] = _truncate(buildVersion);
      }
      final deviceId = _safeRead(_deviceIdProvider);
      if (deviceId != null &&
          deviceId.isNotEmpty &&
          !enriched.containsKey('deviceId')) {
        enriched['deviceId'] = _truncate(deviceId);
      }
      final connectivityState = _safeRead(_connectivityStateProvider);
      if (connectivityState != null &&
          connectivityState.isNotEmpty &&
          !enriched.containsKey('connectivityState')) {
        enriched['connectivityState'] = _truncate(connectivityState);
      }
      final pendingJournalCount = _safeRead(_pendingJournalCountProvider);
      if (pendingJournalCount != null &&
          !enriched.containsKey('pendingJournalCount')) {
        enriched['pendingJournalCount'] = pendingJournalCount;
      }

      final record = TelemetryRecord(
        occurredAt: _safeClock(),
        name: _truncate(event.name),
        values: Map<String, Object?>.unmodifiable(enriched),
      );
      if (_buffer.length >= maxEvents) {
        _buffer.removeFirst();
        _droppedCount += 1;
      }
      _buffer.addLast(record);

      try {
        _diagnosticSink(record.toJsonLine());
      } catch (_) {
        // Fail-open: a broken log sink must never crash POS flows.
      }
    } catch (_) {
      // Fail-open: telemetry must never throw into callers.
    }
  }

  /// Flushes buffered events in bounded batches when a [batchTransport] or
  /// [endpoint] is configured. Returns the number of flushed records and
  /// never throws.
  Future<int> flush() async {
    if (_flushing || _buffer.isEmpty) return 0;
    final transport = _resolveTransport();
    if (transport == null) return 0;
    _flushing = true;
    var flushed = 0;
    try {
      while (_buffer.isNotEmpty) {
        final batch = <TelemetryRecord>[];
        for (final record in _buffer) {
          batch.add(record);
          if (batch.length >= batchSize) break;
        }
        await transport(batch.map((record) => record.toJson()).toList());
        for (var i = 0; i < batch.length && _buffer.isNotEmpty; i++) {
          if (identical(_buffer.first, batch[i])) {
            _buffer.removeFirst();
          }
        }
        flushed += batch.length;
      }
      return flushed;
    } catch (_) {
      // Fail-open: keep undelivered records bounded in the ring buffer.
      return flushed;
    } finally {
      _flushing = false;
    }
  }

  void dispose() {
    if (_ownsHttpClient) {
      _httpClient?.close();
      _httpClient = null;
      _ownsHttpClient = false;
    }
  }

  TelemetryBatchTransport? _resolveTransport() {
    if (_batchTransport != null) return _batchTransport;
    final endpoint = _endpoint;
    if (endpoint == null) return null;
    return (batch) async {
      final client = _httpClient ??= _createClient();
      final response = await client
          .post(
            endpoint,
            headers: const {'content-type': 'application/json'},
            body: jsonEncode({'events': batch}),
          )
          .timeout(_flushTimeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError(
          'Telemetry endpoint refused batch (${response.statusCode})',
        );
      }
    };
  }

  http.Client _createClient() {
    _ownsHttpClient = true;
    return http.Client();
  }

  DateTime _safeClock() {
    try {
      return _clock().toUtc();
    } catch (_) {
      return DateTime.now().toUtc();
    }
  }

  static T? _safeRead<T>(T? Function()? provider) {
    if (provider == null) return null;
    try {
      return provider();
    } catch (_) {
      return null;
    }
  }

  static String _truncate(String value) =>
      value.length > SafeTelemetry.maxValueLength
      ? value.substring(0, SafeTelemetry.maxValueLength)
      : value;

  static Object? _sanitizeValue(Object? value) {
    if (value == null || value is num || value is bool) return value;
    if (value is String) return _truncate(value);
    if (value is List) {
      return value.take(16).map(_sanitizeValue).toList(growable: false);
    }
    if (value is Map) {
      final safe = <String, Object?>{};
      for (final entry in value.entries.take(16)) {
        final key = entry.key.toString();
        if (SafeTelemetry.isBlockedKey(key.toLowerCase())) continue;
        safe[key] = _sanitizeValue(entry.value);
      }
      return safe;
    }
    return _truncate(value.toString());
  }
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

  static bool isBlockedKey(String lowerKey) =>
      _blockedFragments.any(lowerKey.contains);

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
      if (isBlockedKey(key)) continue;
      final value = entry.value;
      values[entry.key] = value is String && value.length > maxValueLength
          ? value.substring(0, maxValueLength)
          : value;
    }
    exporter.export(ClientEvent(name: event.name, values: values));
  }
}
