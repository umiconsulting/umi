import 'dart:async';
import 'dart:math';

import 'package:umi_contract/umi_contract.dart';

import 'hardware_fingerprint.dart';
import 'hardware_recovery_store.dart';
import 'hardware_repository.dart';
import 'hardware_runtime.dart';

final class HardwareScope {
  const HardwareScope({
    required this.merchantId,
    required this.locationId,
    required this.operatorSessionId,
    required this.deviceId,
    required this.credentialVersion,
    required this.permissions,
    required this.registerId,
  });

  final String merchantId;
  final String locationId;
  final String operatorSessionId;
  final String deviceId;
  final int credentialVersion;
  final Set<String> permissions;
  final String? registerId;
}

abstract interface class HardwareIdentifierFactory {
  String next();
}

final class SecureHardwareIdentifierFactory
    implements HardwareIdentifierFactory {
  SecureHardwareIdentifierFactory();
  final Random _random = Random.secure();

  @override
  String next() {
    final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-'
        '${hex.substring(20)}';
  }
}

final class HardwareService {
  HardwareService({
    required HardwareRepository repository,
    required HardwareCoordinator coordinator,
    required HardwareRecoveryStore recovery,
    HardwareIdentifierFactory? identifiers,
    ScannerSimulatorAdapter? scannerSimulator,
    DeviceAdapterResolver? adapterResolver,
    KeyboardWedgeInputAdapter? keyboardWedge,
  }) : _repository = repository,
       _coordinator = coordinator,
       _recovery = recovery,
       _identifiers = identifiers ?? SecureHardwareIdentifierFactory(),
       _scannerSimulator = scannerSimulator,
       _adapterResolver = adapterResolver,
       _keyboardWedge =
           keyboardWedge ??
           KeyboardWedgeInputAdapter(
             terminator: '\n',
             timeout: const Duration(milliseconds: 80),
           ) {
    _scanSubscriptions.add(_keyboardWedge.scanEvents.listen(_forwardScan));
    if (_scannerSimulator != null) {
      _scanSubscriptions.add(_scannerSimulator.events.listen(_forwardScan));
    }
    final resolver = _adapterResolver;
    if (resolver is HardwareScanEventSource) {
      _scanSubscriptions.add(
        (resolver as HardwareScanEventSource).scanEvents.listen(_forwardScan),
      );
    }
  }

  final HardwareRepository _repository;
  final HardwareCoordinator _coordinator;
  final HardwareRecoveryStore _recovery;
  final HardwareIdentifierFactory _identifiers;
  final ScannerSimulatorAdapter? _scannerSimulator;
  final DeviceAdapterResolver? _adapterResolver;
  final KeyboardWedgeInputAdapter _keyboardWedge;
  final StreamController<CanonicalScanEvent> _scanEvents =
      StreamController<CanonicalScanEvent>.broadcast();
  final List<StreamSubscription<CanonicalScanEvent>> _scanSubscriptions = [];
  bool _scannerEnabled = true;
  HardwareRuntimeSnapshot? _lastRuntime;
  String? _lastRuntimeAuthority;
  DateTime? _lastRuntimeCachedAt;
  static const _runtimeCacheLifetime = Duration(minutes: 15);

  Stream<CanonicalScanEvent> get scanEvents => _scanEvents.stream;

  void setSensitiveInputActive(bool active) {
    _keyboardWedge.sensitiveInputActive = active;
  }

  bool acceptKeyboardCodeUnit(int codeUnit, DateTime at) =>
      _scannerEnabled && _keyboardWedge.accept(codeUnit, at);

  void _forwardScan(CanonicalScanEvent event) {
    final resolver = _adapterResolver;
    if (resolver is HardwareScanObserver) {
      (resolver as HardwareScanObserver).recordScan(event);
    }
    if (_scannerEnabled) _scanEvents.add(event);
  }

  Future<void> dispose() async {
    await Future.wait(
      _scanSubscriptions.map((subscription) => subscription.cancel()),
    );
    await _scanEvents.close();
    await _keyboardWedge.dispose();
    final resolver = _adapterResolver;
    if (resolver is DisposableDeviceAdapterResolver) {
      await (resolver as DisposableDeviceAdapterResolver).dispose();
    }
    if (_scannerSimulator != null) await _scannerSimulator.dispose();
  }

  Stream<CanonicalScanEvent> scansFor(String hardwareId) {
    final resolver = _adapterResolver;
    if (resolver is SimulatorHardwareLab) {
      return resolver.adapter<ScannerSimulatorAdapter>(hardwareId)?.events ??
          const Stream.empty();
    }
    return const Stream.empty();
  }

  Future<HardwareDevice> updateDevice({
    required HardwareScope scope,
    required String hardwareId,
    required bool enabled,
    required int expectedVersion,
    Map<String, Object?>? connectionConfiguration,
  }) {
    final commandId = _identifiers.next();
    return _repository.update(
      scope.merchantId,
      hardwareId,
      UpdateHardwareRequest(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        commandId: commandId,
        idempotencyKey: 'hardware-update-$commandId',
        enabled: enabled,
        connectionConfiguration: connectionConfiguration,
        expectedVersion: expectedVersion,
      ),
    );
  }

  Future<HardwareDevice> registerDevice({
    required HardwareScope scope,
    required String? assignedPosDeviceId,
    required String type,
    required String manufacturer,
    required String model,
    required String publicReference,
    required String transport,
    required List<String> capabilities,
    Map<String, Object?> connectionConfiguration = const {},
  }) {
    final commandId = _identifiers.next();
    return _repository.register(
      scope.merchantId,
      RegisterHardwareRequest(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        registerId: scope.registerId,
        assignedPosDeviceId: assignedPosDeviceId,
        type: type,
        manufacturer: manufacturer,
        model: model,
        publicReference: publicReference,
        transport: transport,
        connectionConfiguration: connectionConfiguration,
        capabilities: capabilities,
        commandId: commandId,
        idempotencyKey: 'hardware-register-$commandId',
      ),
    );
  }

  Future<HardwareDevice> assignDevice({
    required HardwareScope scope,
    required String hardwareId,
    required String? assignedPosDeviceId,
    required bool primary,
    required int expectedVersion,
  }) {
    final commandId = _identifiers.next();
    return _repository.assign(
      scope.merchantId,
      hardwareId,
      AssignHardwareRequest(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        registerId: scope.registerId,
        assignedPosDeviceId: assignedPosDeviceId,
        primary: primary,
        expectedVersion: expectedVersion,
        commandId: commandId,
        idempotencyKey: 'hardware-assign-$commandId',
      ),
    );
  }

  Future<HardwarePilotPolicyResult> updatePolicy({
    required HardwareScope scope,
    required int expectedVersion,
    required Map<String, Object?> policy,
  }) {
    final commandId = _identifiers.next();
    return _repository.updatePolicy(
      scope.merchantId,
      UpdateHardwarePolicyRequest(
        locationId: scope.locationId,
        registerId: scope.registerId,
        operatorSessionId: scope.operatorSessionId,
        commandId: commandId,
        idempotencyKey: 'hardware-policy-$commandId',
        expectedVersion: expectedVersion,
        policy: policy,
      ),
    );
  }

  Future<HardwareCommandResult> controlledReprint({
    required HardwareScope scope,
    required String jobId,
    required String reason,
    String? commandId,
  }) async {
    final reprintCommandId = commandId ?? _identifiers.next();
    final result = await _repository.controlledReprint(
      scope.merchantId,
      jobId,
      ControlledReprintRequest(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        commandId: reprintCommandId,
        idempotencyKey: 'hardware-reprint-$reprintCommandId',
        reason: reason,
      ),
    );
    return execute(
      scope.merchantId,
      HardwareCommandRequest.fromJson(result.command),
    );
  }

  Future<HardwareCommandResult> retryKnownSafePrint({
    required HardwareScope scope,
    required String jobId,
  }) async {
    final recovered = await _repository.printJobCommand(
      scope.merchantId,
      jobId,
      HardwareRecoveryQuery(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
      ),
    );
    if (recovered.command['status'] != 'retryable') {
      throw StateError('HARDWARE_PRINT_RETRY_NOT_SAFE');
    }
    final command = recovered.command;
    return execute(
      scope.merchantId,
      HardwareCommandRequest(
        locationId: command['locationId']! as String,
        registerId: command['registerId'] as String?,
        operatorSessionId: scope.operatorSessionId,
        commandId: command['commandId']! as String,
        idempotencyKey: command['idempotencyKey']! as String,
        targetHardwareId: command['targetHardwareId']! as String,
        commandType: command['commandType']! as String,
        sourceAggregateType: command['sourceAggregateType']! as String,
        sourceAggregateId: command['sourceAggregateId']! as String,
        expectedConfigurationVersion:
            command['expectedConfigurationVersion']! as int,
        payloadFingerprint: command['payloadFingerprint']! as String,
        drawer: recovered.dispatchPayload['drawer'] as Map<String, Object?>?,
        display: recovered.dispatchPayload['display'] as Map<String, Object?>?,
        printPayload:
            recovered.dispatchPayload['printPayload'] as Map<String, Object?>?,
      ),
    );
  }

  Future<HardwareRuntimeSnapshot> snapshot(
    HardwareScope scope, {
    bool includeDisabled = false,
  }) async {
    final result = await _repository.snapshot(
      scope.merchantId,
      HardwareRegistryQuery(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        registerId: scope.registerId,
        includeDisabled: includeDisabled,
      ),
    );
    await _configureRuntime(result);
    final resolver = _adapterResolver;
    if (resolver is HardwareConnectionStateResolver) {
      final stateResolver = resolver as HardwareConnectionStateResolver;
      await stateResolver.refreshHealth();
      final effective = HardwareRuntimeSnapshot.fromJson({
        ...result.toJson(),
        'devices': result.devices.map((raw) {
          final device = HardwareDevice.fromJson(raw);
          return {
            ...device.toJson(),
            'connectionState':
                stateResolver.connectionStateFor(device.id) ??
                device.connectionState,
          };
        }).toList(),
      });
      _lastRuntime = effective;
      _bindRuntime(scope);
      await _cacheRuntime(scope, effective);
      return effective;
    }
    _lastRuntime = result;
    _bindRuntime(scope);
    await _cacheRuntime(scope, result);
    return result;
  }

  Future<void> _configureRuntime(HardwareRuntimeSnapshot runtime) async {
    final policy = runtime.policy ?? const <String, Object?>{};
    _scannerEnabled = policy['scannerEnabled'] as bool? ?? true;
    final resolver = _adapterResolver;
    final hardwareIds = runtime.devices
        .map(HardwareDevice.fromJson)
        .map((device) => device.id)
        .toSet();
    _coordinator.retainDevices(hardwareIds);
    if (resolver is HardwareRegistryAwareResolver) {
      await (resolver as HardwareRegistryAwareResolver).retainDevices(
        hardwareIds,
      );
    }
    if (resolver is HardwarePolicyAwareResolver) {
      await (resolver as HardwarePolicyAwareResolver).configurePolicy(policy);
    }
    for (final value in runtime.devices) {
      final contract = HardwareDevice.fromJson(value);
      final configuration = contract.connectionConfiguration ?? const {};
      if (contract.type == 'barcode_scanner' &&
          contract.transport == 'keyboard_wedge') {
        _keyboardWedge.configure(
          terminator: configuration['scannerTerminator'] == 'tab' ? '\t' : '\n',
          timeout: Duration(
            milliseconds: configuration['scannerBurstWindowMs'] as int? ?? 80,
          ),
        );
      }
      final device = RuntimeDevice(
        id: contract.id,
        type: contract.type,
        transport: contract.transport,
        capabilities: contract.capabilities.toSet(),
        enabled: contract.enabled,
        connectionConfiguration: configuration,
      );
      final adapter = _adapterResolver?.resolve(device);
      if (adapter != null) {
        _coordinator.register(device, adapter);
      } else if (!device.enabled) {
        _coordinator.disable(device);
      }
    }
  }

  String _runtimeCacheId(HardwareScope scope) => _deterministicId(
    'runtime:${scope.merchantId}:${scope.locationId}:${scope.registerId ?? '-'}:'
    '${scope.deviceId}:${scope.credentialVersion}',
  );

  String _runtimeAuthority(HardwareScope scope) =>
      '${scope.merchantId}:${scope.locationId}:${scope.registerId ?? '-'}:'
      '${scope.deviceId}:${scope.credentialVersion}';

  void _bindRuntime(HardwareScope scope) {
    _lastRuntimeAuthority = _runtimeAuthority(scope);
    _lastRuntimeCachedAt = DateTime.now().toUtc();
  }

  Future<void> _cacheRuntime(
    HardwareScope scope,
    HardwareRuntimeSnapshot runtime,
  ) async {
    final snapshot = runtime.toJson();
    final safeMetadata = <String, Object?>{
      'runtimeSnapshot': snapshot,
      'deviceId': scope.deviceId,
      'credentialVersion': scope.credentialVersion,
      'cachedAt': DateTime.now().toUtc().toIso8601String(),
    };
    await _recovery.save(
      PendingHardwareDispatch(
        merchantId: scope.merchantId,
        locationId: scope.locationId,
        commandId: _runtimeCacheId(scope),
        payloadFingerprint: hardwarePayloadFingerprint(safeMetadata),
        state: HardwareDispatchState.succeeded,
        safeMetadata: safeMetadata,
      ),
    );
  }

  Future<HardwareRuntimeSnapshot?> _restoreRuntime(HardwareScope scope) async {
    final cached = await _recovery.load(_runtimeCacheId(scope));
    if (cached == null ||
        cached.merchantId != scope.merchantId ||
        cached.locationId != scope.locationId ||
        cached.safeMetadata['deviceId'] != scope.deviceId ||
        cached.safeMetadata['credentialVersion'] != scope.credentialVersion ||
        hardwarePayloadFingerprint(cached.safeMetadata) !=
            cached.payloadFingerprint) {
      return null;
    }
    final cachedAt = DateTime.tryParse(
      cached.safeMetadata['cachedAt'] as String? ?? '',
    );
    if (cachedAt == null ||
        DateTime.now().toUtc().difference(cachedAt) > _runtimeCacheLifetime) {
      return null;
    }
    final raw = cached.safeMetadata['runtimeSnapshot'];
    if (raw is! Map) return null;
    final snapshot = Map<String, Object?>.from(raw);
    final runtime = HardwareRuntimeSnapshot.fromJson(snapshot);
    if (runtime.merchantId != scope.merchantId ||
        runtime.locationId != scope.locationId ||
        runtime.registerId != scope.registerId) {
      return null;
    }
    await _configureRuntime(runtime);
    _lastRuntimeAuthority = _runtimeAuthority(scope);
    _lastRuntimeCachedAt = cachedAt;
    return runtime;
  }

  Future<HardwareRuntimeSnapshot?> _runtimeForOffline(
    HardwareScope scope,
  ) async {
    final runtime = _lastRuntime;
    final cachedAt = _lastRuntimeCachedAt;
    final validMemory =
        runtime != null &&
        runtime.merchantId == scope.merchantId &&
        runtime.locationId == scope.locationId &&
        runtime.registerId == scope.registerId &&
        _lastRuntimeAuthority == _runtimeAuthority(scope) &&
        cachedAt != null &&
        DateTime.now().toUtc().difference(cachedAt) <= _runtimeCacheLifetime;
    if (validMemory) return runtime;
    final restored = await _restoreRuntime(scope);
    _lastRuntime = restored;
    return restored;
  }

  Future<HardwareCommandResult> execute(
    String merchantId,
    HardwareCommandRequest command,
  ) async {
    final expectedFingerprint = hardwarePayloadFingerprint(
      _fingerprintInput(command),
    );
    if (expectedFingerprint != command.payloadFingerprint) {
      throw StateError('HARDWARE_PAYLOAD_FINGERPRINT_MISMATCH');
    }
    final server = await _repository.createCommand(merchantId, command);
    final serverStatus = server.command['status'];
    if (_terminalServerStatus(serverStatus)) return server;

    final serverFingerprint = server.command['payloadFingerprint']! as String;
    final prior = await _recovery.load(command.commandId);
    if (prior != null) {
      if (prior.payloadFingerprint != serverFingerprint) {
        throw StateError('HARDWARE_PAYLOAD_FINGERPRINT_MISMATCH');
      }
      if (prior.state == HardwareDispatchState.dispatching) {
        return _transition(
          merchantId,
          command,
          status: 'unknown',
          failureCode: 'unknown_outcome',
          safeMetadata: const {'statusMessage': 'verify_physical_result'},
        );
      }
      if (prior.state != HardwareDispatchState.retryable) {
        return _transition(
          merchantId,
          command,
          status: _serverStatus(prior.state),
          failureCode: prior.failureCode,
          safeMetadata: prior.safeMetadata,
        );
      }
    }

    if (serverStatus == 'dispatching') {
      return _transition(
        merchantId,
        command,
        status: 'unknown',
        failureCode: 'unknown_outcome',
        safeMetadata: const {'statusMessage': 'verify_physical_result'},
      );
    }

    await _recovery.save(
      PendingHardwareDispatch(
        merchantId: merchantId,
        locationId: command.locationId,
        commandId: command.commandId,
        payloadFingerprint: serverFingerprint,
        state: HardwareDispatchState.dispatching,
      ),
    );
    await _transition(merchantId, command, status: 'dispatching');
    final local = await _coordinator.dispatch(
      RuntimeCommand(
        id: command.commandId,
        hardwareId: command.targetHardwareId,
        type: server.command['commandType']! as String,
        requiredCapability: _requiredCapability(
          server.command['commandType']! as String,
        ),
        payloadFingerprint: serverFingerprint,
        safePayload:
            server.dispatchPayload['display'] as Map<String, Object?>? ??
            server.dispatchPayload['printPayload'] as Map<String, Object?>? ??
            server.dispatchPayload['drawer'] as Map<String, Object?>? ??
            const {},
      ),
    );
    final state = switch (local.status) {
      RuntimeCommandStatus.succeeded => HardwareDispatchState.succeeded,
      RuntimeCommandStatus.retryable => HardwareDispatchState.retryable,
      RuntimeCommandStatus.unknown => HardwareDispatchState.unknown,
      _ => HardwareDispatchState.failed,
    };
    await _recovery.save(
      PendingHardwareDispatch(
        merchantId: merchantId,
        locationId: command.locationId,
        commandId: command.commandId,
        payloadFingerprint: serverFingerprint,
        state: state,
        failureCode: local.failureCode,
        safeMetadata: local.safeMetadata,
      ),
    );
    final result = await _transition(
      merchantId,
      command,
      status: _status(local),
      failureCode: local.failureCode,
      safeMetadata: local.safeMetadata,
    );
    final terminalStatus = result.command['status'];
    if (terminalStatus == 'succeeded' ||
        terminalStatus == 'failed' ||
        terminalStatus == 'cancelled') {
      await _recovery.clear(command.commandId);
    }
    return result;
  }

  Future<HardwareCommandResult?> executeNextRemoteCommand(
    HardwareScope scope,
  ) async {
    final claimed = await _repository.claimRemoteCommand(
      scope.merchantId,
      HardwareRecoveryQuery(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
      ),
    );
    if (claimed == null) return null;
    final server = claimed.command;
    final command = HardwareCommandRequest(
      locationId: server['locationId']! as String,
      registerId: server['registerId'] as String?,
      operatorSessionId: scope.operatorSessionId,
      commandId: server['commandId']! as String,
      idempotencyKey: server['idempotencyKey']! as String,
      targetHardwareId: server['targetHardwareId']! as String,
      commandType: server['commandType']! as String,
      sourceAggregateType: server['sourceAggregateType']! as String,
      sourceAggregateId: server['sourceAggregateId']! as String,
      expectedConfigurationVersion:
          server['expectedConfigurationVersion']! as int,
      payloadFingerprint: server['payloadFingerprint']! as String,
      drawer: claimed.dispatchPayload['drawer'] as Map<String, Object?>?,
      display: claimed.dispatchPayload['display'] as Map<String, Object?>?,
      printPayload:
          claimed.dispatchPayload['printPayload'] as Map<String, Object?>?,
    );
    await _recovery.save(
      PendingHardwareDispatch(
        merchantId: scope.merchantId,
        locationId: scope.locationId,
        commandId: command.commandId,
        payloadFingerprint: command.payloadFingerprint,
        state: HardwareDispatchState.dispatching,
      ),
    );
    final local = await _coordinator.dispatch(
      RuntimeCommand(
        id: command.commandId,
        hardwareId: command.targetHardwareId,
        type: command.commandType,
        requiredCapability: _requiredCapability(command.commandType),
        payloadFingerprint: command.payloadFingerprint,
        safePayload:
            claimed.dispatchPayload['display'] as Map<String, Object?>? ??
            claimed.dispatchPayload['printPayload'] as Map<String, Object?>? ??
            claimed.dispatchPayload['drawer'] as Map<String, Object?>? ??
            const {},
      ),
    );
    final state = switch (local.status) {
      RuntimeCommandStatus.succeeded => HardwareDispatchState.succeeded,
      RuntimeCommandStatus.retryable => HardwareDispatchState.retryable,
      RuntimeCommandStatus.unknown => HardwareDispatchState.unknown,
      _ => HardwareDispatchState.failed,
    };
    await _recovery.save(
      PendingHardwareDispatch(
        merchantId: scope.merchantId,
        locationId: scope.locationId,
        commandId: command.commandId,
        payloadFingerprint: command.payloadFingerprint,
        state: state,
        failureCode: local.failureCode,
        safeMetadata: local.safeMetadata,
      ),
    );
    final result = await _transition(
      scope.merchantId,
      command,
      status: _status(local),
      failureCode: local.failureCode,
      safeMetadata: local.safeMetadata,
    );
    if (const {
      'succeeded',
      'failed',
      'cancelled',
    }.contains(result.command['status'])) {
      await _recovery.clear(command.commandId);
    }
    return result;
  }

  Future<HardwareCommandResult> printReceipt({
    required HardwareScope scope,
    required String printerId,
    required int configurationVersion,
    required ReceiptPrintPayload receipt,
    String? commandId,
  }) => execute(
    scope.merchantId,
    _command(
      scope: scope,
      hardwareId: printerId,
      commandType: 'print_receipt',
      capability: 'printer.receipt',
      sourceType: 'receipt',
      sourceId: receipt.receiptId,
      configurationVersion: configurationVersion,
      printPayload: receipt.toJson(),
      commandId: commandId,
    ),
  );

  Future<HardwareCommandResult> printAuthoritativeReceipt({
    required HardwareScope scope,
    required String receiptId,
    required Map<String, Object?> receiptSnapshot,
  }) async {
    final runtime = await snapshot(scope);
    final printers = runtime.devices
        .map(HardwareDevice.fromJson)
        .where(
          (device) =>
              device.enabled &&
              device.type == 'printer' &&
              device.capabilities.contains('printer.receipt'),
        )
        .toList();
    final printer =
        printers.where((device) => device.primary == true).firstOrNull ??
        printers.firstOrNull;
    final receipt = _receiptPayload(receiptSnapshot, receiptId: receiptId);
    if (printer == null || receipt == null) {
      throw StateError('HARDWARE_RECEIPT_PRINTER_UNAVAILABLE');
    }
    final results = await _printReceiptSet(
      scope: scope,
      printerId: printer.id,
      configurationVersion: printer.configurationVersion,
      receipt: receipt,
      commandId: _deterministicId('receipt:${receipt.receiptId}:${printer.id}'),
      copies: (runtime.policy?['receiptCopiesDefault'] as int? ?? 1).clamp(
        1,
        3,
      ),
    );
    return results.first;
  }

  Future<List<HardwareCommandResult>> _printReceiptSet({
    required HardwareScope scope,
    required String printerId,
    required int configurationVersion,
    required ReceiptPrintPayload receipt,
    required String commandId,
    required int copies,
  }) async {
    final original = await printReceipt(
      scope: scope,
      printerId: printerId,
      configurationVersion: configurationVersion,
      receipt: receipt,
      commandId: commandId,
    );
    final results = <HardwareCommandResult>[original];
    if (original.command['status'] != 'succeeded') return results;
    for (var copy = 2; copy <= copies; copy += 1) {
      results.add(
        await controlledReprint(
          scope: scope,
          jobId: commandId,
          reason: 'customer_copy',
          commandId: _deterministicId(
            'receipt-copy:${receipt.receiptId}:$printerId:$copy',
          ),
        ),
      );
    }
    return results;
  }

  Future<HardwareCommandResult> openDrawer({
    required HardwareScope scope,
    required String drawerId,
    required int configurationVersion,
    required String reason,
    required String? cashReference,
    String? approvalId,
    String? commandId,
  }) => execute(
    scope.merchantId,
    _command(
      scope: scope,
      hardwareId: drawerId,
      commandType: reason == 'manager_test' ? 'test_drawer' : 'open_drawer',
      capability: 'drawer.open',
      sourceType: 'cash_action',
      sourceId: cashReference ?? reason,
      configurationVersion: configurationVersion,
      drawer: {
        'reason': reason,
        'cashReference': cashReference,
        'approvalId': approvalId,
      },
      commandId: commandId,
    ),
  );

  Future<HardwareCommandResult> updateCustomerDisplay({
    required HardwareScope scope,
    required String displayId,
    required int configurationVersion,
    required CustomerDisplayState state,
    required String sourceId,
    String? commandId,
  }) => execute(
    scope.merchantId,
    _command(
      scope: scope,
      hardwareId: displayId,
      commandType: 'update_customer_display',
      capability: 'customer_display.totals',
      sourceType: 'sale_display',
      sourceId: sourceId,
      configurationVersion: configurationVersion,
      display: CustomerDisplayProjection.safe(state.toJson()).state,
      commandId: commandId,
    ),
  );

  Future<HardwareDiagnosticResult> runDiagnostic({
    required HardwareScope scope,
    required String hardwareId,
    required String diagnostic,
  }) async {
    final snapshot = await this.snapshot(scope, includeDisabled: true);
    final device = snapshot.devices
        .map(HardwareDevice.fromJson)
        .where((value) => value.id == hardwareId)
        .firstOrNull;
    if (device == null) throw StateError('HARDWARE_NOT_FOUND');
    final actionCommandId = _identifiers.next();
    final stopwatch = Stopwatch()..start();
    final action = await execute(
      scope.merchantId,
      _diagnosticCommand(
        scope: scope,
        device: device,
        diagnostic: diagnostic,
        commandId: actionCommandId,
      ),
    );
    stopwatch.stop();
    final status = action.command['status'] as String? ?? 'unknown';
    final failureCode = action.failure?['code'] as String?;
    final health = switch (status) {
      'succeeded' => 'healthy',
      'retryable' => 'degraded',
      'failed' => 'unavailable',
      _ => 'unknown',
    };
    final connectionState = switch ((status, failureCode)) {
      ('succeeded', _) => 'connected',
      ('retryable', 'busy') => 'busy',
      ('retryable', 'disconnected') => 'disconnected',
      ('failed', 'disconnected') => 'disconnected',
      ('failed', _) => 'error',
      _ => 'unknown',
    };
    final diagnosticId = _identifiers.next();
    return _repository.diagnostic(
      scope.merchantId,
      HardwareDiagnosticRequest(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        commandId: diagnosticId,
        idempotencyKey: 'hardware-diagnostic-$diagnosticId',
        hardwareId: hardwareId,
        diagnostic: diagnostic,
        health: health,
        connectionState: connectionState,
        latencyMs: stopwatch.elapsedMilliseconds,
        failureCode: failureCode,
        safeResult: {
          'commandId': actionCommandId,
          'commandStatus': status,
          'recovered': action.recovered,
        },
      ),
    );
  }

  HardwareCommandRequest _diagnosticCommand({
    required HardwareScope scope,
    required HardwareDevice device,
    required String diagnostic,
    required String commandId,
  }) {
    final commandType = switch (diagnostic) {
      'printer_test_page' => 'print_test_page',
      'drawer_test' => 'test_drawer',
      'scanner_test_session' => 'begin_scanner_session',
      'customer_display_test' => 'update_customer_display',
      _ => 'run_diagnostic',
    };
    return _command(
      scope: scope,
      hardwareId: device.id,
      commandType: commandType,
      capability: _requiredCapability(commandType),
      sourceType: 'hardware_diagnostic',
      sourceId: commandId,
      configurationVersion: device.configurationVersion,
      drawer: diagnostic == 'drawer_test'
          ? {
              'reason': 'manager_test',
              'cashReference': null,
              'approvalId': null,
            }
          : null,
      display: diagnostic == 'customer_display_test'
          ? const CustomerDisplayState(
              state: 'idle',
              items: [],
              subtotalMinorUnits: 0,
              discountMinorUnits: 0,
              taxMinorUnits: 0,
              tipMinorUnits: 0,
              totalMinorUnits: 0,
              amountDueMinorUnits: 0,
              receivedMinorUnits: 0,
              changeMinorUnits: 0,
              currency: 'MXN',
              receiptQr: null,
              messageCode: 'diagnostic_test',
            ).toJson()
          : null,
      commandId: commandId,
    );
  }

  Future<List<Object>> afterCommittedFinancialAction(
    Iterable<Future<Object> Function()> hardwareActions,
  ) async {
    final results = <Object>[];
    for (final action in hardwareActions) {
      try {
        results.add(await action());
      } catch (error) {
        results.add(error);
      }
    }
    return results;
  }

  Future<List<Object>> afterCheckoutCompleted(
    HardwareScope scope,
    CheckoutResult result,
  ) async {
    if (result.status != 'completed') return const [];
    final runtime = await snapshot(scope);
    final devices = runtime.devices.map(HardwareDevice.fromJson).toList();
    final receipt = _receiptPayload(
      result.receipt,
      receiptId: result.sale?['receiptId'] as String?,
    );
    final saleId = result.sale?['id'] as String?;
    final policy = runtime.policy ?? const <String, Object?>{};
    Future<Object> Function()? printAction;
    Future<Object> Function()? displayAction;
    Future<Object> Function()? drawerAction;

    final printers = devices.where(
      (device) =>
          device.enabled &&
          device.type == 'printer' &&
          device.capabilities.contains('printer.receipt'),
    );
    final primary = printers
        .where((device) => device.primary == true)
        .firstOrNull;
    final printer = primary ?? printers.firstOrNull;
    if ((policy['autoPrintReceipt'] as bool? ?? true) &&
        printer != null &&
        receipt != null) {
      printAction = () => _printReceiptSet(
        scope: scope,
        printerId: printer.id,
        configurationVersion: printer.configurationVersion,
        receipt: receipt,
        commandId: _deterministicId(
          'receipt:${receipt.receiptId}:${printer.id}',
        ),
        copies: (policy['receiptCopiesDefault'] as int? ?? 1).clamp(1, 3),
      );
    }

    final display = devices
        .where((device) => device.enabled && device.type == 'customer_display')
        .firstOrNull;
    if ((policy['customerDisplayEnabled'] as bool? ?? false) &&
        display != null &&
        saleId != null) {
      displayAction = () => updateCustomerDisplay(
        scope: scope,
        displayId: display.id,
        configurationVersion: display.configurationVersion,
        sourceId: saleId,
        commandId: _deterministicId('display:$saleId:${display.id}'),
        state: CustomerDisplayState(
          state: 'completed',
          items: receipt?.items ?? const [],
          subtotalMinorUnits: receipt?.subtotalMinorUnits ?? 0,
          discountMinorUnits: receipt?.discountMinorUnits ?? 0,
          taxMinorUnits: receipt?.taxMinorUnits ?? 0,
          tipMinorUnits: receipt?.tipMinorUnits ?? 0,
          totalMinorUnits: receipt?.totalMinorUnits ?? 0,
          amountDueMinorUnits: 0,
          receivedMinorUnits: receipt?.totalMinorUnits ?? 0,
          changeMinorUnits: receipt?.changeMinorUnits ?? 0,
          currency: receipt?.currency ?? 'MXN',
          receiptQr: receipt?.qrValue,
          messageCode: 'sale_completed',
        ),
      );
    }

    final drawer = devices
        .where((device) => device.enabled && device.type == 'cash_drawer')
        .firstOrNull;
    if ((policy['openDrawerOnCashSale'] as bool? ?? true) &&
        drawer != null &&
        saleId != null &&
        _hasCashTender(result)) {
      drawerAction = () => openDrawer(
        scope: scope,
        drawerId: drawer.id,
        configurationVersion: drawer.configurationVersion,
        reason: 'cash_sale',
        cashReference: saleId,
        commandId: _deterministicId('drawer:$saleId:${drawer.id}'),
      );
    }
    return afterCommittedFinancialAction([
      ?drawerAction,
      ?printAction,
      ?displayAction,
    ]);
  }

  Future<List<Object>> afterOfflineCheckoutCompleted(
    HardwareScope scope,
    ProvisionalReceipt receipt, {
    bool retryKnownSafe = false,
  }) async {
    final runtime = await _runtimeForOffline(scope);
    if (runtime == null) return const [];
    final policy = runtime.policy ?? const <String, Object?>{};
    final devices = runtime.devices.map(HardwareDevice.fromJson).toList();
    final snapshot = OfflineCheckoutSnapshot.fromJson(receipt.snapshot);
    final cart = Cart.fromJson(snapshot.cartSnapshot);
    final totals = TotalsConfirmation.fromJson(snapshot.totals);
    int money(Object? raw) {
      if (raw is! Map) return 0;
      return (raw['minorUnits'] as num?)?.toInt() ?? 0;
    }

    final totalFacts = totals.totals;
    final discountFacts = totalFacts['discounts'] as Map<String, Object?>;
    final printPayload = <String, Object?>{
      'receiptId': receipt.provisionalSaleId,
      'merchantName': 'Umi',
      'locationName': receipt.locationName,
      'registerName': null,
      'receiptNumber': 'PROV-${receipt.provisionalSaleId.substring(0, 8)}',
      'businessDate': snapshot.businessDate,
      'currency': snapshot.currency,
      'items': cart.items.take(500).map((raw) {
        final line = CartItem.fromJson(raw);
        final price = line.price;
        return <String, Object?>{
          'name': line.productName,
          'quantity': line.quantity,
          'totalMinorUnits': money(price['lineTotal']),
          'modifiers': line.modifiers
              .map((modifier) => modifier['name']! as String)
              .toList(),
        };
      }).toList(),
      'subtotalMinorUnits': money(totalFacts['subtotal']),
      'discountMinorUnits': money(discountFacts['total']),
      'taxMinorUnits': money(totalFacts['tax']),
      'tipMinorUnits': 0,
      'totalMinorUnits': snapshot.amountDueMinorUnits,
      'tenders': [
        {
          'type': 'cash',
          'amountMinorUnits': snapshot.amountReceivedMinorUnits,
          'maskedReference': null,
        },
      ],
      'changeMinorUnits': snapshot.changeDueMinorUnits,
      'loyaltySummary': null,
      'customerValueSummary': null,
      'exceptionMarker': 'provisional',
      'qrValue': null,
      'footer': 'OFFLINE PROVISIONAL RECEIPT',
    };
    final actions = <Future<Object> Function()>[];
    final printers = devices
        .where(
          (device) =>
              device.enabled &&
              device.type == 'printer' &&
              device.capabilities.contains('printer.receipt'),
        )
        .toList();
    final printer =
        printers.where((device) => device.primary == true).firstOrNull ??
        printers.firstOrNull;
    if (printer != null &&
        scope.permissions.contains('hardware.printer.print') &&
        (policy['autoPrintReceipt'] as bool? ?? true)) {
      final copies = (policy['receiptCopiesDefault'] as int? ?? 1).clamp(1, 3);
      for (var copy = 1; copy <= copies; copy += 1) {
        final payload = {
          ...printPayload,
          'footer': copy == 1
              ? 'OFFLINE PROVISIONAL RECEIPT'
              : 'OFFLINE PROVISIONAL RECEIPT · COPY',
        };
        actions.add(
          () => _dispatchOffline(
            scope: scope,
            device: printer,
            commandType: 'print_receipt',
            capability: 'printer.receipt',
            sourceId: receipt.provisionalSaleId,
            safePayload: payload,
            identity: 'offline-print-$copy',
            retryKnownSafe: retryKnownSafe,
          ),
        );
      }
    }
    final drawer = devices
        .where(
          (device) =>
              device.enabled &&
              device.type == 'cash_drawer' &&
              device.capabilities.contains('drawer.open'),
        )
        .firstOrNull;
    if (drawer != null &&
        scope.permissions.contains('hardware.drawer.open') &&
        (policy['openDrawerOnCashSale'] as bool? ?? true)) {
      actions.add(
        () => _dispatchOffline(
          scope: scope,
          device: drawer,
          commandType: 'open_drawer',
          capability: 'drawer.open',
          sourceId: receipt.provisionalSaleId,
          safePayload: const {'reason': 'cash_sale'},
          identity: 'offline-drawer',
          retryKnownSafe: retryKnownSafe,
        ),
      );
    }
    return afterCommittedFinancialAction(actions);
  }

  Future<List<Object>> retryOfflineCheckoutHardware(
    HardwareScope scope,
    ProvisionalReceipt receipt,
  ) async {
    await _runtimeForOffline(scope);
    return afterOfflineCheckoutCompleted(scope, receipt, retryKnownSafe: true);
  }

  Future<RuntimeCommandResult> _dispatchOffline({
    required HardwareScope scope,
    required HardwareDevice device,
    required String commandType,
    required String capability,
    required String sourceId,
    required Map<String, Object?> safePayload,
    required String identity,
    required bool retryKnownSafe,
  }) async {
    final commandId = _deterministicId('$identity:$sourceId:${device.id}');
    final fingerprint = hardwarePayloadFingerprint({
      'commandId': commandId,
      'hardwareId': device.id,
      'sourceId': sourceId,
      'payload': safePayload,
    });
    final recoveryMetadata = <String, Object?>{
      'commandId': commandId,
      'commandType': commandType,
      'hardwareId': device.id,
      'sourceId': sourceId,
      'safePayload': safePayload,
    };
    final prior = await _recovery.load(commandId);
    if (prior != null &&
        !(retryKnownSafe && prior.state == HardwareDispatchState.retryable)) {
      return RuntimeCommandResult(
        status: switch (prior.state) {
          HardwareDispatchState.succeeded => RuntimeCommandStatus.succeeded,
          HardwareDispatchState.retryable => RuntimeCommandStatus.retryable,
          HardwareDispatchState.unknown => RuntimeCommandStatus.unknown,
          _ => RuntimeCommandStatus.failed,
        },
        failureCode: prior.failureCode,
        retryable: prior.state == HardwareDispatchState.retryable,
        recovered: true,
        safeMetadata: prior.safeMetadata,
      );
    }
    await _recovery.save(
      PendingHardwareDispatch(
        merchantId: scope.merchantId,
        locationId: scope.locationId,
        commandId: commandId,
        payloadFingerprint: fingerprint,
        state: HardwareDispatchState.dispatching,
        safeMetadata: recoveryMetadata,
      ),
    );
    final result = await _coordinator.dispatch(
      RuntimeCommand(
        id: commandId,
        hardwareId: device.id,
        type: commandType,
        requiredCapability: capability,
        payloadFingerprint: fingerprint,
        safePayload: safePayload,
      ),
    );
    final safeResult = RuntimeCommandResult(
      status: result.status,
      failureCode: result.failureCode,
      retryable: result.retryable,
      recovered: result.recovered,
      safeMetadata: {...recoveryMetadata, ...result.safeMetadata},
    );
    await _recovery.save(
      PendingHardwareDispatch(
        merchantId: scope.merchantId,
        locationId: scope.locationId,
        commandId: commandId,
        payloadFingerprint: fingerprint,
        state: switch (safeResult.status) {
          RuntimeCommandStatus.succeeded => HardwareDispatchState.succeeded,
          RuntimeCommandStatus.retryable => HardwareDispatchState.retryable,
          RuntimeCommandStatus.unknown => HardwareDispatchState.unknown,
          RuntimeCommandStatus.cancelled => HardwareDispatchState.failed,
          _ => HardwareDispatchState.failed,
        },
        failureCode: safeResult.failureCode,
        safeMetadata: safeResult.safeMetadata,
      ),
    );
    return safeResult;
  }

  Future<void> verifyOfflinePrint({
    required HardwareScope scope,
    required String commandId,
  }) async {
    if (!scope.permissions.contains('hardware.printer.print')) {
      throw StateError('HARDWARE_PERMISSION_DENIED');
    }
    final prior = await _offlineRecoveryCommand(scope, commandId);
    final type = prior.safeMetadata['commandType'];
    if (prior.state != HardwareDispatchState.unknown ||
        (type != 'print_receipt' && type != 'controlled_reprint')) {
      throw StateError('HARDWARE_VERIFY_PRINT_NOT_ALLOWED');
    }
    await _recovery.save(
      PendingHardwareDispatch(
        merchantId: prior.merchantId,
        locationId: prior.locationId,
        commandId: prior.commandId,
        payloadFingerprint: prior.payloadFingerprint,
        state: HardwareDispatchState.succeeded,
        safeMetadata: {...prior.safeMetadata, 'operatorVerified': true},
      ),
    );
  }

  Future<RuntimeCommandResult> controlledOfflineReprint({
    required HardwareScope scope,
    required String commandId,
  }) async {
    if (!scope.permissions.contains('hardware.printer.reprint')) {
      throw StateError('HARDWARE_PERMISSION_DENIED');
    }
    final prior = await _offlineRecoveryCommand(scope, commandId);
    final type = prior.safeMetadata['commandType'];
    if (prior.state != HardwareDispatchState.unknown ||
        (type != 'print_receipt' && type != 'controlled_reprint')) {
      throw StateError('HARDWARE_CONTROLLED_REPRINT_NOT_ALLOWED');
    }
    final payload = Map<String, Object?>.from(
      prior.safeMetadata['safePayload']! as Map,
    );
    payload['footer'] = '${payload['footer'] ?? 'OFFLINE RECEIPT'} · COPY';
    return _dispatchOfflineRecovery(
      scope: scope,
      prior: prior,
      commandType: 'controlled_reprint',
      capability: 'printer.receipt',
      safePayload: payload,
      identity: 'offline-controlled-reprint-${_identifiers.next()}',
    );
  }

  Future<RuntimeCommandResult> repeatOfflineDrawerOpen({
    required HardwareScope scope,
    required String commandId,
  }) async {
    if (!scope.permissions.contains('hardware.drawer.open')) {
      throw StateError('HARDWARE_PERMISSION_DENIED');
    }
    final prior = await _offlineRecoveryCommand(scope, commandId);
    if (prior.state != HardwareDispatchState.unknown ||
        prior.safeMetadata['commandType'] != 'open_drawer') {
      throw StateError('HARDWARE_DRAWER_REPEAT_NOT_ALLOWED');
    }
    final payload = Map<String, Object?>.from(
      prior.safeMetadata['safePayload']! as Map,
    );
    payload['recoveryOf'] = commandId;
    return _dispatchOfflineRecovery(
      scope: scope,
      prior: prior,
      commandType: 'open_drawer',
      capability: 'drawer.open',
      safePayload: payload,
      identity: 'offline-drawer-repeat-${_identifiers.next()}',
    );
  }

  Future<PendingHardwareDispatch> _offlineRecoveryCommand(
    HardwareScope scope,
    String commandId,
  ) async {
    final prior = await _recovery.load(commandId);
    if (prior == null ||
        prior.merchantId != scope.merchantId ||
        prior.locationId != scope.locationId) {
      throw StateError('HARDWARE_RECOVERY_COMMAND_NOT_FOUND');
    }
    return prior;
  }

  Future<RuntimeCommandResult> _dispatchOfflineRecovery({
    required HardwareScope scope,
    required PendingHardwareDispatch prior,
    required String commandType,
    required String capability,
    required Map<String, Object?> safePayload,
    required String identity,
  }) async {
    final runtime = await _runtimeForOffline(scope);
    if (runtime == null) throw StateError('HARDWARE_CONFIGURATION_STALE');
    final hardwareId = prior.safeMetadata['hardwareId'] as String?;
    final sourceId = prior.safeMetadata['sourceId'] as String?;
    final device = runtime.devices
        .map(HardwareDevice.fromJson)
        .where((value) => value.id == hardwareId && value.enabled)
        .firstOrNull;
    if (device == null || sourceId == null) {
      throw StateError('HARDWARE_RECOVERY_DEVICE_UNAVAILABLE');
    }
    return _dispatchOffline(
      scope: scope,
      device: device,
      commandType: commandType,
      capability: capability,
      sourceId: sourceId,
      safePayload: safePayload,
      identity: identity,
      retryKnownSafe: false,
    );
  }

  Future<List<Object>> afterRefundCompleted(
    HardwareScope scope,
    SaleExceptionResult result,
  ) async {
    if (result.status != 'committed') return const [];
    final runtime = await snapshot(scope);
    final devices = runtime.devices.map(HardwareDevice.fromJson).toList();
    final receipt = _receiptPayload(
      result.receipt,
      receiptId: result.receipt?['id'] as String?,
    );
    final policy = runtime.policy ?? const <String, Object?>{};
    Future<Object> Function()? printAction;
    Future<Object> Function()? drawerAction;
    final printers = devices
        .where(
          (device) =>
              device.enabled &&
              device.type == 'printer' &&
              device.capabilities.contains('printer.receipt'),
        )
        .toList();
    final printer =
        printers.where((device) => device.primary == true).firstOrNull ??
        printers.firstOrNull;
    if ((policy['autoPrintReceipt'] as bool? ?? true) &&
        printer != null &&
        receipt != null) {
      printAction = () => _printReceiptSet(
        scope: scope,
        printerId: printer.id,
        configurationVersion: printer.configurationVersion,
        receipt: receipt,
        commandId: _deterministicId(
          'refund:${result.exceptionId}:${printer.id}',
        ),
        copies: (policy['receiptCopiesDefault'] as int? ?? 1).clamp(1, 3),
      );
    }
    final drawer = devices
        .where((device) => device.enabled && device.type == 'cash_drawer')
        .firstOrNull;
    if ((policy['openDrawerOnCashRefund'] as bool? ?? true) &&
        drawer != null &&
        _containsCash(result.allocation)) {
      drawerAction = () => openDrawer(
        scope: scope,
        drawerId: drawer.id,
        configurationVersion: drawer.configurationVersion,
        reason: 'cash_refund',
        cashReference: result.exceptionId,
        commandId: _deterministicId(
          'refund-drawer:${result.exceptionId}:${drawer.id}',
        ),
      );
    }
    return afterCommittedFinancialAction([?drawerAction, ?printAction]);
  }

  Future<List<Object>> afterCashAction(
    HardwareScope scope, {
    required String reason,
    required String reference,
  }) async {
    final runtime = await snapshot(scope);
    final drawers = runtime.devices
        .map(HardwareDevice.fromJson)
        .where((device) => device.enabled && device.type == 'cash_drawer')
        .where(
          (device) =>
              scope.registerId == null || device.registerId == scope.registerId,
        )
        .toList();
    if (drawers.isEmpty || (scope.registerId == null && drawers.length != 1)) {
      return const [];
    }
    final drawer = drawers.single;
    final commandScope = HardwareScope(
      merchantId: scope.merchantId,
      locationId: scope.locationId,
      operatorSessionId: scope.operatorSessionId,
      deviceId: scope.deviceId,
      credentialVersion: scope.credentialVersion,
      permissions: scope.permissions,
      registerId: scope.registerId ?? drawer.registerId,
    );
    return afterCommittedFinancialAction([
      () => openDrawer(
        scope: commandScope,
        drawerId: drawer.id,
        configurationVersion: drawer.configurationVersion,
        reason: reason,
        cashReference: reference,
        commandId: _deterministicId(
          'cash-drawer:$reason:$reference:${drawer.id}',
        ),
      ),
    ]);
  }

  HardwareCommandRequest _command({
    required HardwareScope scope,
    required String hardwareId,
    required String commandType,
    required String capability,
    required String sourceType,
    required String sourceId,
    required int configurationVersion,
    Map<String, Object?>? drawer,
    Map<String, Object?>? display,
    Map<String, Object?>? printPayload,
    String? commandId,
  }) {
    final resolvedCommandId = commandId ?? _identifiers.next();
    final input = {
      'locationId': scope.locationId,
      'registerId': scope.registerId,
      'targetHardwareId': hardwareId,
      'commandType': commandType,
      'sourceAggregateType': sourceType,
      'sourceAggregateId': sourceId,
      'expectedConfigurationVersion': configurationVersion,
      'requiredCapability': capability,
      'drawer': drawer,
      'display': display,
      'printPayload': printPayload,
    };
    return HardwareCommandRequest(
      locationId: scope.locationId,
      registerId: scope.registerId,
      operatorSessionId: scope.operatorSessionId,
      commandId: resolvedCommandId,
      idempotencyKey: 'hardware-command-$resolvedCommandId',
      targetHardwareId: hardwareId,
      commandType: commandType,
      sourceAggregateType: sourceType,
      sourceAggregateId: sourceId,
      expectedConfigurationVersion: configurationVersion,
      payloadFingerprint: hardwarePayloadFingerprint(input),
      drawer: drawer,
      display: display,
      printPayload: printPayload,
    );
  }

  Map<String, Object?> _fingerprintInput(HardwareCommandRequest command) => {
    'locationId': command.locationId,
    'registerId': command.registerId,
    'targetHardwareId': command.targetHardwareId,
    'commandType': command.commandType,
    'sourceAggregateType': command.sourceAggregateType,
    'sourceAggregateId': command.sourceAggregateId,
    'expectedConfigurationVersion': command.expectedConfigurationVersion,
    'requiredCapability': _requiredCapability(command.commandType),
    'drawer': command.drawer,
    'display': command.display,
    'printPayload': command.printPayload,
  };

  Future<HardwareCommandResult> _transition(
    String merchantId,
    HardwareCommandRequest command, {
    required String status,
    String? failureCode,
    Map<String, Object?> safeMetadata = const {},
  }) => _repository.transition(
    merchantId,
    command.commandId,
    HardwareCommandTransitionRequest(
      locationId: command.locationId,
      operatorSessionId: command.operatorSessionId,
      status: status,
      failureCode: failureCode,
      safeResultMetadata: safeMetadata,
    ),
  );

  bool _terminalServerStatus(Object? status) =>
      const {'succeeded', 'failed', 'cancelled', 'unknown'}.contains(status);

  String _serverStatus(HardwareDispatchState state) => switch (state) {
    HardwareDispatchState.retryable => 'retryable',
    HardwareDispatchState.succeeded => 'succeeded',
    HardwareDispatchState.failed => 'failed',
    HardwareDispatchState.unknown => 'unknown',
    HardwareDispatchState.dispatching => 'unknown',
  };

  String _status(RuntimeCommandResult result) => switch (result.status) {
    RuntimeCommandStatus.succeeded => 'succeeded',
    RuntimeCommandStatus.failed => 'failed',
    RuntimeCommandStatus.retryable => 'retryable',
    RuntimeCommandStatus.cancelled => 'cancelled',
    RuntimeCommandStatus.unknown => 'unknown',
  };

  String _requiredCapability(String commandType) => switch (commandType) {
    'print_receipt' || 'controlled_reprint' => 'printer.receipt',
    'print_test_page' => 'printer.test_page',
    'open_drawer' || 'test_drawer' => 'drawer.open',
    'begin_scanner_session' => 'scanner.barcode',
    'update_customer_display' => 'customer_display.totals',
    _ => 'hardware.diagnostics',
  };

  String _deterministicId(String source) {
    final hex = hardwarePayloadFingerprint({'source': source}).substring(0, 32);
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '5${hex.substring(13, 16)}-8${hex.substring(17, 20)}-'
        '${hex.substring(20)}';
  }

  ReceiptPrintPayload? _receiptPayload(
    Map<String, Object?>? source, {
    String? receiptId,
  }) {
    if (source == null) return null;
    int amount(String key) {
      final value = source[key];
      return value is Map ? (value['minorUnits'] as int? ?? 0) : 0;
    }

    final lines = (source['lines'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map(
          (line) => <String, Object?>{
            'name': line['description'] as String? ?? 'Item',
            'quantity': line['quantity'] as int? ?? 1,
            'totalMinorUnits':
                (line['lineTotal'] as Map?)?['minorUnits'] as int? ?? 0,
            'modifiers': (line['modifiers'] as List<Object?>? ?? const [])
                .whereType<String>()
                .toList(),
          },
        )
        .toList();
    return ReceiptPrintPayload(
      receiptId:
          receiptId ??
          source['id'] as String? ??
          source['receiptId'] as String? ??
          'receipt',
      merchantName: source['merchantName'] as String? ?? 'Umi',
      locationName: source['locationName'] as String? ?? 'UmiPOS',
      registerName: source['registerName'] as String?,
      receiptNumber:
          source['receiptRef'] as String? ??
          source['publicReference'] as String? ??
          'receipt',
      businessDate: source['businessDate'] as String? ?? '1970-01-01',
      currency: source['currency'] as String? ?? 'MXN',
      items: lines,
      subtotalMinorUnits: amount('subtotal'),
      discountMinorUnits: amount('discountTotal'),
      taxMinorUnits: amount('taxTotal'),
      tipMinorUnits: amount('tip'),
      totalMinorUnits: amount('grandTotal'),
      tenders: const [],
      changeMinorUnits: amount('change'),
      loyaltySummary: source['loyaltySummary'] as String?,
      customerValueSummary: source['customerValueSummary'] as String?,
      exceptionMarker: source['exceptionMarker'] as String?,
      qrValue: source['qrValue'] as String?,
      footer: source['footer'] as String?,
    );
  }

  bool _hasCashTender(CheckoutResult result) {
    final payments =
        result.payments ?? [if (result.payment != null) result.payment!];
    return payments.any((payment) {
      if (payment['method'] == 'cash' || payment['type'] == 'cash') return true;
      final attempt = payment['attempt'];
      return attempt is Map && attempt['method'] == 'cash';
    });
  }

  bool _containsCash(Object? value) {
    if (value is Map) {
      if (value['type'] == 'cash' || value['method'] == 'cash') return true;
      return value.values.any(_containsCash);
    }
    if (value is Iterable) return value.any(_containsCash);
    return false;
  }
}
