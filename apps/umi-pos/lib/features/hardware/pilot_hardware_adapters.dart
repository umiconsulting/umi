import 'dart:async';

import 'hardware_runtime.dart';
import 'hardware_socket_client.dart';
import 'hardware_socket_client_contract.dart';
import 'terminal_cashbox_transport.dart';
import 'thermal_logo.dart';
import 'thermal_printer_adapter.dart';
import 'usb_printer_transport.dart';

export 'hardware_socket_client_contract.dart';

enum PilotConnectionState {
  disconnected,
  connecting,
  connected,
  busy,
  recovering,
  failed,
  disabled,
}

final class TcpHardwareByteTransport implements HardwareByteTransport {
  TcpHardwareByteTransport({
    required this.host,
    required this.port,
    HardwareSocketClient? socketClient,
    this.connectTimeout = const Duration(seconds: 2),
    this.commandTimeout = const Duration(seconds: 5),
    this.maximumConnectAttempts = 2,
  }) : socketClient = socketClient ?? createNativeHardwareSocketClient() {
    if (!_validHost(host) || port < 1 || port > 65535) {
      throw const FormatException('HARDWARE_NETWORK_ENDPOINT_INVALID');
    }
    if (maximumConnectAttempts < 1 || maximumConnectAttempts > 3) {
      throw const FormatException('HARDWARE_RETRY_LIMIT_INVALID');
    }
  }

  final String host;
  final int port;
  final HardwareSocketClient socketClient;
  final Duration connectTimeout;
  final Duration commandTimeout;
  final int maximumConnectAttempts;
  PilotConnectionState state = PilotConnectionState.disconnected;
  bool _closed = false;

  @override
  Future<HardwareByteTransportResult> send(List<int> bytes) async {
    if (_closed) {
      return const HardwareByteTransportResult.notSent(
        failureCode: 'transport_unavailable',
      );
    }
    if (bytes.isEmpty || bytes.length > 65536) {
      return const HardwareByteTransportResult.notSent(
        failureCode: 'terminal_hardware_failure',
      );
    }
    for (var attempt = 1; attempt <= maximumConnectAttempts; attempt += 1) {
      state = attempt == 1
          ? PilotConnectionState.connecting
          : PilotConnectionState.recovering;
      final result = await socketClient.send(
        host: host,
        port: port,
        bytes: bytes,
        connectTimeout: connectTimeout,
        commandTimeout: commandTimeout,
      );
      switch (result.outcome) {
        case HardwareByteTransportOutcome.sent:
          state = PilotConnectionState.connected;
          return result;
        case HardwareByteTransportOutcome.unknown:
          state = PilotConnectionState.failed;
          return result;
        case HardwareByteTransportOutcome.notSent:
          if (attempt == maximumConnectAttempts) {
            state = PilotConnectionState.failed;
            return result;
          }
      }
    }
    throw StateError('HARDWARE_RETRY_BOUND_BROKEN');
  }

  @override
  Future<HardwareByteTransportHealth> health() async {
    if (_closed) {
      return const HardwareByteTransportHealth.disconnected(
        failureCode: 'transport_unavailable',
      );
    }
    final result = await socketClient.health(
      host: host,
      port: port,
      timeout: connectTimeout,
    );
    state = result.state == 'connected'
        ? PilotConnectionState.connected
        : PilotConnectionState.disconnected;
    return result;
  }

  @override
  Future<void> close() async {
    _closed = true;
    state = PilotConnectionState.disabled;
    await socketClient.close();
  }

  static bool _validHost(String value) {
    final host = value.trim();
    return host.isNotEmpty &&
        host.length <= 253 &&
        !host.contains(RegExp(r'[\s/:\\]')) &&
        RegExp(r'^[A-Za-z0-9.-]+$').hasMatch(host);
  }
}

final class KeyboardWedgeScannerAdapter implements DeviceAdapter {
  Completer<CanonicalScanEvent>? _pendingDiagnostic;

  void recordScan(CanonicalScanEvent event) {
    final pending = _pendingDiagnostic;
    if (pending != null && !pending.isCompleted) pending.complete(event);
  }

  @override
  Set<String> get capabilities => const {
    'scanner.barcode',
    'scanner.qr',
    'scanner.continuous',
    'scanner.single',
  };
  @override
  String get deviceType => 'barcode_scanner';
  @override
  String get transport => 'keyboard_wedge';

  @override
  Future<RuntimeCommandResult> execute(RuntimeCommand command) async {
    if (command.type != 'begin_scanner_session') {
      return const RuntimeCommandResult(
        status: RuntimeCommandStatus.succeeded,
        failureCode: null,
        retryable: false,
        recovered: false,
        safeMetadata: {'acknowledged': true},
      );
    }
    final pending = Completer<CanonicalScanEvent>();
    _pendingDiagnostic = pending;
    try {
      final event = await pending.future.timeout(const Duration(seconds: 5));
      return RuntimeCommandResult(
        status: RuntimeCommandStatus.succeeded,
        failureCode: null,
        retryable: false,
        recovered: false,
        safeMetadata: {
          'acknowledged': true,
          'artifactReference': 'scan-${event.sequence}',
        },
      );
    } on TimeoutException {
      return const RuntimeCommandResult(
        status: RuntimeCommandStatus.retryable,
        failureCode: 'disconnected',
        retryable: true,
        recovered: false,
        safeMetadata: {'statusMessage': 'scan_required_for_diagnostic'},
      );
    } finally {
      if (identical(_pendingDiagnostic, pending)) _pendingDiagnostic = null;
    }
  }
}

final class PilotHardwareLab
    implements
        DeviceAdapterResolver,
        HardwareScanEventSource,
        DisposableDeviceAdapterResolver,
        HardwarePolicyAwareResolver,
        HardwareScanObserver,
        HardwareConnectionStateResolver,
        HardwareRegistryAwareResolver {
  PilotHardwareLab({
    HardwareSocketClient Function()? socketClientFactory,
    UsbPrinterChannel Function()? usbPrinterFactory,
    TerminalCashboxChannel Function()? terminalCashboxFactory,
    ThermalLogoSource? logoSource,
    this.allowSimulator = true,
    Uri? apiBaseUri,
  }) : _socketClientFactory =
           socketClientFactory ?? createNativeHardwareSocketClient,
       _usbPrinterFactory = usbPrinterFactory ?? MethodChannelUsbPrinter.new,
       _terminalCashboxFactory =
           terminalCashboxFactory ?? MethodChannelTerminalCashbox.new,
       _logoSource =
           logoSource ?? HttpThermalLogoSource(apiBaseUri: apiBaseUri),
       _simulators = SimulatorHardwareLab();

  final HardwareSocketClient Function() _socketClientFactory;
  final UsbPrinterChannel Function() _usbPrinterFactory;
  final TerminalCashboxChannel Function() _terminalCashboxFactory;

  /// One fetcher for the till: the mark it caches is the café's own.
  final ThermalLogoSource _logoSource;
  final bool allowSimulator;
  final SimulatorHardwareLab _simulators;
  final Map<String, DeviceAdapter> _adapters = {};
  final Map<String, HardwareByteTransport> _transports = {};
  // One printer per till, so one USB link: the printer and the drawer that hangs
  // off its DK port share it. Two opens of the same interface would fight over
  // the claim.
  UsbPrinterByteTransport? _usbPrinterTransport;
  // The terminal's own drawer port is one board resource for the whole till, so
  // every drawer device that rides it shares one channel.
  TerminalCashboxChannel? _terminalCashboxChannel;
  final Map<String, String> _configurationFingerprints = {};
  var _retryLimit = 2;
  var _healthInterval = const Duration(seconds: 30);
  Timer? _healthTimer;
  bool _healthActive = false;
  final Map<String, String> _connectionStates = {};
  final Set<String> _keyboardWedgeIds = {};
  final Map<String, DateTime> _lastWedgeScanAt = {};

  @override
  Stream<CanonicalScanEvent> get scanEvents => _simulators.scanEvents;

  @override
  DeviceAdapter? resolve(RuntimeDevice device) {
    if (!device.enabled) {
      final prior = _transports.remove(device.id);
      if (prior != null) unawaited(prior.close());
      _adapters.remove(device.id);
      _configurationFingerprints.remove(device.id);
      _connectionStates[device.id] = 'disabled';
      _keyboardWedgeIds.remove(device.id);
      _lastWedgeScanAt.remove(device.id);
      return null;
    }
    if (device.transport == 'simulator') {
      return allowSimulator ? _simulators.resolve(device) : null;
    }
    if (device.type == 'barcode_scanner' &&
        device.transport == 'keyboard_wedge') {
      _keyboardWedgeIds.add(device.id);
    } else {
      _keyboardWedgeIds.remove(device.id);
      _lastWedgeScanAt.remove(device.id);
    }
    final fingerprint = _fingerprint(device);
    if (_configurationFingerprints[device.id] != fingerprint) {
      final prior = _transports.remove(device.id);
      if (prior != null) unawaited(prior.close());
      _adapters.remove(device.id);
      _configurationFingerprints[device.id] = fingerprint;
      // Neither of these two transports has a link that can be opened to prove
      // itself: the wedge proves itself with a scan, the terminal port with a
      // probe. Until one of those happens the state is honestly unknown.
      _connectionStates[device.id] =
          device.transport == 'keyboard_wedge' ||
              device.transport == 'platform_channel_foundation'
          ? 'unknown'
          : 'disconnected';
    }
    return _adapters.putIfAbsent(device.id, () => _create(device));
  }

  DeviceAdapter _create(RuntimeDevice device) {
    switch ((device.type, device.transport)) {
      case ('printer', 'network_tcp'):
        final transport = _networkTransport(
          device.id,
          device.connectionConfiguration,
        );
        return GenericThermalPrinterAdapter(
          byteTransport: transport,
          capabilities: device.capabilities,
          // The café's mark, fetched by URL at print time. The head's own width
          // comes from the till's paper, not from the picture.
          logoSource: _logoSource,
          imageWidthDots: _integer(
            device.connectionConfiguration['logoWidthDots'],
            kThermalLogoWidthDots,
          ),
          widthColumns: _integer(
            device.connectionConfiguration['receiptWidthColumns'],
            42,
          ),
          textEncoder:
              device.connectionConfiguration['characterEncoding'] == 'utf8'
              ? const ThermalTextEncoder.utf8()
              : const ThermalTextEncoder.cp850(),
        );
      // The same printer, on the till's USB host port. The bytes are identical;
      // only the link differs.
      case ('printer', 'usb_foundation'):
        return GenericThermalPrinterAdapter(
          byteTransport: _usbTransport(device.id),
          capabilities: device.capabilities,
          logoSource: _logoSource,
          imageWidthDots: _integer(
            device.connectionConfiguration['logoWidthDots'],
            kThermalLogoWidthDots,
          ),
          widthColumns: _integer(
            device.connectionConfiguration['receiptWidthColumns'],
            42,
          ),
          textEncoder:
              device.connectionConfiguration['characterEncoding'] == 'utf8'
              ? const ThermalTextEncoder.utf8()
              : const ThermalTextEncoder.cp850(),
        );
      case ('cash_drawer', 'printer_attached'):
        final transport = _networkTransport(
          device.id,
          device.connectionConfiguration,
        );
        return PrinterAttachedDrawerAdapter(
          byteTransport: transport,
          pin: _integer(device.connectionConfiguration['drawerPulsePin'], 0),
          pulseOnUnits:
              (_integer(
                        device.connectionConfiguration['drawerPulseOnMs'],
                        50,
                      ) ~/
                      2)
                  .clamp(1, 255),
        );
      // The drawer, on a printer the till reaches over USB. The pulse rides the
      // print link, which is why this transport is the printer's.
      case ('cash_drawer', 'usb_foundation'):
        return PrinterAttachedDrawerAdapter(
          byteTransport: _usbTransport(device.id),
          pin: _integer(device.connectionConfiguration['drawerPulsePin'], 0),
          pulseOnUnits:
              (_integer(
                        device.connectionConfiguration['drawerPulseOnMs'],
                        50,
                      ) ~/
                      2)
                  .clamp(1, 255),
        );
      // The drawer on the TERMINAL's own port. The pulse never leaves through a
      // printer, so there is no byte link to build: the board's cashbox line is
      // written directly by the platform channel.
      case ('cash_drawer', 'platform_channel_foundation'):
        return TerminalCashboxDrawerAdapter(
          channel: _terminalCashboxChannel ??= _terminalCashboxFactory(),
        );
      case ('barcode_scanner', 'keyboard_wedge'):
        return KeyboardWedgeScannerAdapter();
      default:
        throw StateError('HARDWARE_ADAPTER_UNAVAILABLE');
    }
  }

  /// The receipt printer on the till's own USB host port (`usb_foundation`, the
  /// transport the contract reserved for it). One link per till, shared by the
  /// printer and the drawer that pulses through it; the printer is discovered by
  /// its printer-class interface, so no configuration names it.
  ///
  /// The link is filed under every device that rides it, because that map is
  /// what the health poll walks. A link that is never filed is never asked
  /// whether it is there, so the card read "Desconectado" for good.
  UsbPrinterByteTransport _usbTransport(String deviceId) {
    final transport = _usbPrinterTransport ??= UsbPrinterByteTransport(
      channel: _usbPrinterFactory(),
    );
    _transports[deviceId] = transport;
    return transport;
  }

  TcpHardwareByteTransport _networkTransport(
    String deviceId,
    Map<String, Object?> configuration,
  ) {
    final host = configuration['networkHost'];
    final port = configuration['networkPort'];
    if (host is! String || port is! int) {
      throw const FormatException('HARDWARE_NETWORK_ENDPOINT_INVALID');
    }
    final transport = TcpHardwareByteTransport(
      host: host,
      port: port,
      socketClient: _socketClientFactory(),
      connectTimeout: Duration(
        milliseconds: _integer(configuration['connectTimeoutMs'], 2000),
      ),
      commandTimeout: Duration(
        milliseconds: _integer(configuration['commandTimeoutMs'], 5000),
      ),
      maximumConnectAttempts: _retryLimit,
    );
    _transports[deviceId] = transport;
    return transport;
  }

  String _fingerprint(RuntimeDevice device) {
    final entries = device.connectionConfiguration.entries.toList()
      ..sort((left, right) => left.key.compareTo(right.key));
    return '${device.type}|${device.transport}|${device.enabled}|${entries.map((entry) => '${entry.key}=${entry.value}').join('&')}';
  }

  @override
  void recordScan(CanonicalScanEvent event) {
    if (_keyboardWedgeIds.length != 1) return;
    final hardwareId = _keyboardWedgeIds.single;
    final adapter = _adapters[hardwareId];
    if (adapter is! KeyboardWedgeScannerAdapter) return;
    adapter.recordScan(event);
    _lastWedgeScanAt[hardwareId] = DateTime.now().toUtc();
    _connectionStates[hardwareId] = 'connected';
  }

  int _integer(Object? value, int fallback) => value is int ? value : fallback;

  @override
  Future<void> configurePolicy(Map<String, Object?> policy) async {
    final next = _integer(policy['hardwareRetryLimit'], 2).clamp(1, 3);
    final interval = Duration(
      seconds: _integer(
        policy['hardwareHealthIntervalSeconds'],
        30,
      ).clamp(15, 300),
    );
    if (interval != _healthInterval || _healthTimer == null) {
      _healthInterval = interval;
      _healthTimer?.cancel();
      _healthTimer = Timer.periodic(
        _healthInterval,
        (_) => unawaited(_pollHealth(background: true)),
      );
    }
    if (next == _retryLimit) return;
    await Future.wait(_transports.values.map((transport) => transport.close()));
    _transports.clear();
    final usb = _usbPrinterTransport;
    _usbPrinterTransport = null;
    await usb?.close();
    _adapters.clear();
    _configurationFingerprints.clear();
    _retryLimit = next;
  }

  Future<void> _pollHealth({bool background = false}) async {
    if (_healthActive) return;
    _healthActive = true;
    try {
      // One probe per physical link. The printer and the drawer share the USB
      // transport, and two concurrent opens of the same interface fight over
      // the claim, so the link is grouped before it is asked.
      final byTransport = <HardwareByteTransport, List<String>>{};
      for (final entry in _transports.entries) {
        byTransport.putIfAbsent(entry.value, () => <String>[]).add(entry.key);
      }
      await Future.wait(
        byTransport.entries.map((group) async {
          // A routine sweep reads what the last real operation proved. Asking
          // a USB printer for `DLE EOT` here would occupy the same worker as a
          // receipt; the Hardware Center and diagnostics call `health()` and
          // still perform the real probe when somebody asked for one.
          final transport = group.key;
          final cached = transport is BackgroundHardwareHealth
              ? transport as BackgroundHardwareHealth
              : null;
          final result = background && cached != null
              ? await cached.backgroundHealth()
              : await transport.health();
          for (final hardwareId in group.value) {
            _connectionStates[hardwareId] = result.state;
          }
        }),
      );
      // A transport with no bytes to prove itself — the terminal's own drawer
      // port — is asked through its adapter instead.
      await Future.wait(
        _adapters.entries
            .where((entry) => entry.value is AdapterHealthProbe)
            .map((entry) async {
              final health = await (entry.value as AdapterHealthProbe).probe();
              _connectionStates[entry.key] = health.state;
            }),
      );
    } finally {
      _healthActive = false;
    }
  }

  @override
  Future<void> refreshHealth() => _pollHealth();

  @override
  String? connectionStateFor(String hardwareId) {
    if (_keyboardWedgeIds.contains(hardwareId)) {
      final lastScan = _lastWedgeScanAt[hardwareId];
      if (lastScan == null ||
          DateTime.now().toUtc().difference(lastScan) > _healthInterval) {
        return 'unknown';
      }
    }
    return _connectionStates[hardwareId];
  }

  @override
  Future<void> retainDevices(Set<String> hardwareIds) async {
    final stale = _adapters.keys
        .where((hardwareId) => !hardwareIds.contains(hardwareId))
        .toList();
    for (final hardwareId in stale) {
      await _transports.remove(hardwareId)?.close();
      _adapters.remove(hardwareId);
      _configurationFingerprints.remove(hardwareId);
      _connectionStates.remove(hardwareId);
      _keyboardWedgeIds.remove(hardwareId);
      _lastWedgeScanAt.remove(hardwareId);
    }
    _simulators.retainDevices(hardwareIds);
  }

  @override
  Future<void> dispose() async {
    _healthTimer?.cancel();
    await Future.wait(_transports.values.map((transport) => transport.close()));
    final usb = _usbPrinterTransport;
    _usbPrinterTransport = null;
    await usb?.close();
    await _simulators.dispose();
  }
}
