import 'dart:async';

enum RuntimeCommandStatus { succeeded, failed, retryable, cancelled, unknown }

enum SimulatorFailure { offline, busy, paperOut, timeout, unknownOutcome }

final class RuntimeDevice {
  const RuntimeDevice({
    required this.id,
    required this.type,
    required this.transport,
    required this.capabilities,
    required this.enabled,
    this.connectionConfiguration = const {},
  });

  final String id;
  final String type;
  final String transport;
  final Set<String> capabilities;
  final bool enabled;
  final Map<String, Object?> connectionConfiguration;
}

RuntimeDevice simulatedDevice({required String id, required String type}) {
  final capabilities = switch (type) {
    'printer' => {'printer.receipt', 'printer.test_page'},
    'cash_drawer' => {'drawer.open', 'drawer.status'},
    'barcode_scanner' => {'scanner.barcode', 'scanner.qr'},
    'customer_display' => {'customer_display.text', 'customer_display.totals'},
    _ => <String>{},
  };
  return RuntimeDevice(
    id: id,
    type: type,
    transport: 'simulator',
    capabilities: capabilities,
    enabled: true,
  );
}

final class RuntimeCommand {
  const RuntimeCommand({
    required this.id,
    required this.hardwareId,
    required this.type,
    required this.requiredCapability,
    required this.payloadFingerprint,
    this.safePayload = const {},
  });

  final String id;
  final String hardwareId;
  final String type;
  final String requiredCapability;
  final String payloadFingerprint;
  final Map<String, Object?> safePayload;
}

final class RuntimeCommandResult {
  const RuntimeCommandResult({
    required this.status,
    required this.failureCode,
    required this.retryable,
    required this.recovered,
    this.safeMetadata = const {},
  });

  final RuntimeCommandStatus status;
  final String? failureCode;
  final bool retryable;
  final bool recovered;
  final Map<String, Object?> safeMetadata;

  RuntimeCommandResult asRecovered() => RuntimeCommandResult(
    status: status,
    failureCode: failureCode,
    retryable: retryable,
    recovered: true,
    safeMetadata: safeMetadata,
  );
}

abstract interface class HardwareTransportAdapter {
  String get transport;
  Future<RuntimeCommandResult> execute(RuntimeCommand command);
}

abstract interface class UsbFoundationTransport
    implements HardwareTransportAdapter {}

abstract interface class BluetoothFoundationTransport
    implements HardwareTransportAdapter {}

abstract interface class NetworkFoundationTransport
    implements HardwareTransportAdapter {}

abstract interface class SerialFoundationTransport
    implements HardwareTransportAdapter {}

abstract interface class PlatformChannelFoundationTransport
    implements HardwareTransportAdapter {}

abstract interface class DeviceAdapter implements HardwareTransportAdapter {
  String get deviceType;
  Set<String> get capabilities;
}

abstract base class SimulatorDeviceAdapter implements DeviceAdapter {
  SimulatorDeviceAdapter({Map<String, SimulatorFailure> failures = const {}})
    : _failures = Map.of(failures);

  final Map<String, SimulatorFailure> _failures;
  int dispatchCount = 0;

  void injectFailure(String commandId, SimulatorFailure failure) {
    _failures[commandId] = failure;
  }

  void clearFailure(String commandId) {
    _failures.remove(commandId);
  }

  @override
  String get transport => 'simulator';

  @override
  Future<RuntimeCommandResult> execute(RuntimeCommand command) async {
    dispatchCount += 1;
    final failure = _failures[command.id];
    if (failure != null) return _failure(failure);
    return executeSuccess(command);
  }

  Future<RuntimeCommandResult> executeSuccess(RuntimeCommand command);

  RuntimeCommandResult _failure(SimulatorFailure failure) {
    return switch (failure) {
      SimulatorFailure.busy => const RuntimeCommandResult(
        status: RuntimeCommandStatus.retryable,
        failureCode: 'busy',
        retryable: true,
        recovered: false,
      ),
      SimulatorFailure.offline => const RuntimeCommandResult(
        status: RuntimeCommandStatus.retryable,
        failureCode: 'disconnected',
        retryable: true,
        recovered: false,
      ),
      SimulatorFailure.paperOut => const RuntimeCommandResult(
        status: RuntimeCommandStatus.failed,
        failureCode: 'paper_out',
        retryable: false,
        recovered: false,
      ),
      SimulatorFailure.timeout => const RuntimeCommandResult(
        status: RuntimeCommandStatus.unknown,
        failureCode: 'command_timeout',
        retryable: false,
        recovered: false,
      ),
      SimulatorFailure.unknownOutcome => const RuntimeCommandResult(
        status: RuntimeCommandStatus.unknown,
        failureCode: 'unknown_outcome',
        retryable: false,
        recovered: false,
      ),
    };
  }
}

final class PrintArtifact {
  const PrintArtifact(this.commandId, this.payloadFingerprint);
  final String commandId;
  final String payloadFingerprint;
}

final class PrinterSimulatorAdapter extends SimulatorDeviceAdapter {
  PrinterSimulatorAdapter({super.failures});

  final List<PrintArtifact> artifacts = [];

  @override
  String get deviceType => 'printer';
  @override
  Set<String> get capabilities => const {
    'printer.receipt',
    'printer.test_page',
    'printer.qr',
  };

  @override
  Future<RuntimeCommandResult> executeSuccess(RuntimeCommand command) async {
    artifacts.add(PrintArtifact(command.id, command.payloadFingerprint));
    return RuntimeCommandResult(
      status: RuntimeCommandStatus.succeeded,
      failureCode: null,
      retryable: false,
      recovered: false,
      safeMetadata: {
        'artifactReference': 'simulator-print-${artifacts.length}',
      },
    );
  }
}

final class DrawerSimulatorAdapter extends SimulatorDeviceAdapter {
  DrawerSimulatorAdapter({super.failures});
  final List<String> openCommands = [];

  @override
  String get deviceType => 'cash_drawer';
  @override
  Set<String> get capabilities => const {'drawer.open', 'drawer.status'};

  @override
  Future<RuntimeCommandResult> executeSuccess(RuntimeCommand command) async {
    openCommands.add(command.id);
    return const RuntimeCommandResult(
      status: RuntimeCommandStatus.succeeded,
      failureCode: null,
      retryable: false,
      recovered: false,
      safeMetadata: {'acknowledged': true},
    );
  }
}

final class CanonicalScanEvent {
  const CanonicalScanEvent({
    required this.value,
    required this.symbology,
    required this.sequence,
  });
  final String value;
  final String symbology;
  final int sequence;
}

final class ScannerSimulatorAdapter extends SimulatorDeviceAdapter {
  ScannerSimulatorAdapter({super.failures});
  final StreamController<CanonicalScanEvent> _events =
      StreamController.broadcast();
  final Map<String, DateTime> _recent = {};
  var _sequence = 0;

  @override
  String get deviceType => 'barcode_scanner';
  @override
  Set<String> get capabilities => const {
    'scanner.barcode',
    'scanner.qr',
    'scanner.continuous',
    'scanner.single',
  };
  Stream<CanonicalScanEvent> get events => _events.stream;

  void emit(
    String value, {
    String symbology = 'unknown_symbology',
    DateTime? at,
  }) {
    final normalized = value.trim();
    if (normalized.isEmpty || normalized.length > 256) return;
    final now = at ?? DateTime.now().toUtc();
    final previous = _recent[normalized];
    if (previous != null &&
        now.difference(previous) < const Duration(milliseconds: 120)) {
      return;
    }
    _recent[normalized] = now;
    _sequence += 1;
    _events.add(
      CanonicalScanEvent(
        value: normalized,
        symbology: symbology,
        sequence: _sequence,
      ),
    );
  }

  @override
  Future<RuntimeCommandResult> executeSuccess(RuntimeCommand command) async =>
      const RuntimeCommandResult(
        status: RuntimeCommandStatus.succeeded,
        failureCode: null,
        retryable: false,
        recovered: false,
      );

  Future<void> dispose() => _events.close();
}

final class CustomerDisplayProjection {
  const CustomerDisplayProjection._(this.state);
  final Map<String, Object?> state;

  factory CustomerDisplayProjection.safe(Map<String, Object?> source) {
    const allowed = {
      'state',
      'items',
      'subtotalMinorUnits',
      'discountMinorUnits',
      'taxMinorUnits',
      'tipMinorUnits',
      'totalMinorUnits',
      'amountDueMinorUnits',
      'receivedMinorUnits',
      'changeMinorUnits',
      'currency',
      'receiptQr',
      'messageCode',
    };
    return CustomerDisplayProjection._({
      for (final entry in source.entries)
        if (allowed.contains(entry.key)) entry.key: entry.value,
    });
  }
}

final class CustomerDisplaySimulatorAdapter extends SimulatorDeviceAdapter {
  CustomerDisplaySimulatorAdapter({super.failures});
  CustomerDisplayProjection? lastProjection;

  @override
  String get deviceType => 'customer_display';
  @override
  Set<String> get capabilities => const {
    'customer_display.text',
    'customer_display.totals',
    'customer_display.qr',
  };

  @override
  Future<RuntimeCommandResult> executeSuccess(RuntimeCommand command) async {
    lastProjection = CustomerDisplayProjection.safe(command.safePayload);
    return const RuntimeCommandResult(
      status: RuntimeCommandStatus.succeeded,
      failureCode: null,
      retryable: false,
      recovered: false,
    );
  }
}

final class HardwareCoordinator {
  HardwareCoordinator({
    required Map<String, DeviceAdapter> adapters,
    required Iterable<RuntimeDevice> devices,
  }) : _adapters = Map.of(adapters),
       _devices = {for (final device in devices) device.id: device};

  final Map<String, DeviceAdapter> _adapters;
  final Map<String, RuntimeDevice> _devices;
  final Map<String, RuntimeCommandResult> _results = {};
  final Map<String, String> _fingerprints = {};
  final Map<String, int> _attempts = {};
  static const maximumAttempts = 3;

  void register(RuntimeDevice device, DeviceAdapter adapter) {
    if (device.type != adapter.deviceType) {
      throw StateError('HARDWARE_ADAPTER_TYPE_MISMATCH');
    }
    _devices[device.id] = device;
    _adapters[device.id] = adapter;
  }

  void disable(RuntimeDevice device) {
    _devices[device.id] = device;
    _adapters.remove(device.id);
  }

  void retainDevices(Set<String> hardwareIds) {
    _devices.removeWhere((id, _) => !hardwareIds.contains(id));
    _adapters.removeWhere((id, _) => !hardwareIds.contains(id));
  }

  Future<RuntimeCommandResult> dispatch(RuntimeCommand command) async {
    final previous = _results[command.id];
    if (previous != null) {
      if (_fingerprints[command.id] != command.payloadFingerprint) {
        return const RuntimeCommandResult(
          status: RuntimeCommandStatus.failed,
          failureCode: 'configuration_stale',
          retryable: false,
          recovered: true,
        );
      }
      if (previous.status != RuntimeCommandStatus.retryable) {
        return previous.asRecovered();
      }
    }
    final device = _devices[command.hardwareId];
    final adapter = _adapters[command.hardwareId];
    if (device == null || adapter == null) {
      return _remember(
        command,
        const RuntimeCommandResult(
          status: RuntimeCommandStatus.failed,
          failureCode: 'hardware_not_found',
          retryable: false,
          recovered: false,
        ),
      );
    }
    if (!device.enabled) {
      return _remember(
        command,
        const RuntimeCommandResult(
          status: RuntimeCommandStatus.failed,
          failureCode: 'hardware_disabled',
          retryable: false,
          recovered: false,
        ),
      );
    }
    final diagnostic = command.requiredCapability == 'hardware.diagnostics';
    if (device.type != adapter.deviceType ||
        (!diagnostic &&
            (!device.capabilities.contains(command.requiredCapability) ||
                !adapter.capabilities.contains(command.requiredCapability)))) {
      return _remember(
        command,
        const RuntimeCommandResult(
          status: RuntimeCommandStatus.failed,
          failureCode: 'capability_unsupported',
          retryable: false,
          recovered: false,
        ),
      );
    }
    final attempt = (_attempts[command.id] ?? 0) + 1;
    _attempts[command.id] = attempt;
    final result = await adapter.execute(command);
    if (result.status == RuntimeCommandStatus.retryable &&
        attempt >= maximumAttempts) {
      return _remember(
        command,
        const RuntimeCommandResult(
          status: RuntimeCommandStatus.failed,
          failureCode: 'terminal_hardware_failure',
          retryable: false,
          recovered: false,
          safeMetadata: {'attemptLimitReached': true},
        ),
      );
    }
    return _remember(command, result);
  }

  RuntimeCommandResult _remember(
    RuntimeCommand command,
    RuntimeCommandResult result,
  ) {
    _fingerprints[command.id] = command.payloadFingerprint;
    _results[command.id] = result;
    return result;
  }
}

abstract interface class DeviceAdapterResolver {
  DeviceAdapter? resolve(RuntimeDevice device);
}

abstract interface class HardwareScanEventSource {
  Stream<CanonicalScanEvent> get scanEvents;
}

abstract interface class DisposableDeviceAdapterResolver {
  Future<void> dispose();
}

abstract interface class HardwarePolicyAwareResolver {
  Future<void> configurePolicy(Map<String, Object?> policy);
}

abstract interface class HardwareScanObserver {
  void recordScan(CanonicalScanEvent event);
}

abstract interface class HardwareConnectionStateResolver {
  Future<void> refreshHealth();
  String? connectionStateFor(String hardwareId);
}

abstract interface class HardwareRegistryAwareResolver {
  Future<void> retainDevices(Set<String> hardwareIds);
}

final class SimulatorHardwareLab
    implements
        DeviceAdapterResolver,
        HardwareScanEventSource,
        DisposableDeviceAdapterResolver {
  SimulatorHardwareLab({this.failures = const {}});
  final Map<String, Map<String, SimulatorFailure>> failures;
  final Map<String, DeviceAdapter> _adapters = {};
  final StreamController<CanonicalScanEvent> _scanEvents =
      StreamController.broadcast();
  final Set<String> _scannerSubscriptions = {};
  final Set<String> _activeDevices = {};

  @override
  Stream<CanonicalScanEvent> get scanEvents => _scanEvents.stream;

  @override
  DeviceAdapter? resolve(RuntimeDevice device) {
    if (device.transport != 'simulator') return null;
    _activeDevices.add(device.id);
    final adapter = _adapters.putIfAbsent(device.id, () {
      final injected = failures[device.id] ?? const {};
      return switch (device.type) {
        'printer' => PrinterSimulatorAdapter(failures: injected),
        'cash_drawer' => DrawerSimulatorAdapter(failures: injected),
        'barcode_scanner' => ScannerSimulatorAdapter(failures: injected),
        'customer_display' => CustomerDisplaySimulatorAdapter(
          failures: injected,
        ),
        _ => throw StateError('HARDWARE_FOUNDATION_ONLY'),
      };
    });
    if (adapter is ScannerSimulatorAdapter &&
        _scannerSubscriptions.add(device.id)) {
      adapter.events.listen((event) {
        if (_activeDevices.contains(device.id)) _scanEvents.add(event);
      });
    }
    return adapter;
  }

  T? adapter<T extends DeviceAdapter>(String hardwareId) =>
      _adapters[hardwareId] is T ? _adapters[hardwareId] as T : null;

  void retainDevices(Set<String> hardwareIds) {
    _activeDevices.retainAll(hardwareIds);
  }

  @override
  Future<void> dispose() async {
    for (final adapter
        in _adapters.values.whereType<ScannerSimulatorAdapter>()) {
      await adapter.dispose();
    }
    await _scanEvents.close();
  }
}

final class KeyboardWedgeInputAdapter {
  KeyboardWedgeInputAdapter({
    required this.terminator,
    required this.timeout,
    this.maximumLength = 256,
  });

  String terminator;
  Duration timeout;
  final int maximumLength;
  final List<CanonicalScanEvent> events = [];
  final StreamController<CanonicalScanEvent> _eventStream =
      StreamController.broadcast();
  final StringBuffer _buffer = StringBuffer();
  final Map<String, DateTime> _recent = {};
  DateTime? _first;
  DateTime? _last;
  bool sensitiveInputActive = false;

  Stream<CanonicalScanEvent> get scanEvents => _eventStream.stream;

  void configure({required String terminator, required Duration timeout}) {
    this.terminator = terminator;
    this.timeout = timeout;
    _reset();
  }

  bool accept(int codeUnit, DateTime at) {
    if (sensitiveInputActive) {
      _reset();
      return false;
    }
    final character = String.fromCharCode(codeUnit);
    if (_last != null && at.difference(_last!) > timeout) _reset();
    _first ??= at;
    _last = at;
    if (character == terminator) {
      final value = _buffer.toString();
      final burst = _first != null && at.difference(_first!) <= timeout;
      if (burst && value.length >= 3) {
        final previous = _recent[value];
        if (previous != null &&
            at.difference(previous) < const Duration(milliseconds: 120)) {
          _reset();
          return true;
        }
        _recent[value] = at;
        final event = CanonicalScanEvent(
          value: value,
          symbology: _symbology(value),
          sequence: events.length + 1,
        );
        events.add(event);
        _eventStream.add(event);
        _reset();
        return true;
      }
      _reset();
      return false;
    }
    if (_buffer.length >= maximumLength) {
      _reset();
      return false;
    }
    if (codeUnit >= 32 && codeUnit <= 126) _buffer.write(character);
    return false;
  }

  String _symbology(String value) {
    final digits = RegExp(r'^\d+$').hasMatch(value);
    if (digits && (value.length == 8 || value.length == 13)) return 'ean';
    if (digits && value.length == 12) return 'upc';
    if (RegExp(r'^[\x20-\x7e]+$').hasMatch(value)) return 'code128';
    return 'unknown_symbology';
  }

  void _reset() {
    _buffer.clear();
    _first = null;
    _last = null;
  }

  Future<void> dispose() => _eventStream.close();
}
