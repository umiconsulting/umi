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
    required this.registerId,
  });

  final String merchantId;
  final String locationId;
  final String operatorSessionId;
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
    _scanSubscriptions.add(_keyboardWedge.scanEvents.listen(_scanEvents.add));
    if (_scannerSimulator != null) {
      _scanSubscriptions.add(_scannerSimulator.events.listen(_scanEvents.add));
    }
    final resolver = _adapterResolver;
    if (resolver is SimulatorHardwareLab) {
      _scanSubscriptions.add(resolver.scanEvents.listen(_scanEvents.add));
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

  Stream<CanonicalScanEvent> get scanEvents => _scanEvents.stream;

  void setSensitiveInputActive(bool active) {
    _keyboardWedge.sensitiveInputActive = active;
  }

  bool acceptKeyboardCodeUnit(int codeUnit, DateTime at) =>
      _keyboardWedge.accept(codeUnit, at);

  Future<void> dispose() async {
    await Future.wait(
      _scanSubscriptions.map((subscription) => subscription.cancel()),
    );
    await _scanEvents.close();
    await _keyboardWedge.dispose();
    final resolver = _adapterResolver;
    if (resolver is SimulatorHardwareLab) await resolver.dispose();
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
        expectedVersion: expectedVersion,
      ),
    );
  }

  Future<HardwareCommandResult> controlledReprint({
    required HardwareScope scope,
    required String jobId,
    required String reason,
  }) async {
    final commandId = _identifiers.next();
    final result = await _repository.controlledReprint(
      scope.merchantId,
      jobId,
      ControlledReprintRequest(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        commandId: commandId,
        idempotencyKey: 'hardware-reprint-$commandId',
        reason: reason,
      ),
    );
    return execute(
      scope.merchantId,
      HardwareCommandRequest.fromJson(result.command),
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
    for (final value in result.devices) {
      final contract = HardwareDevice.fromJson(value);
      final device = RuntimeDevice(
        id: contract.id,
        type: contract.type,
        transport: contract.transport,
        capabilities: contract.capabilities.toSet(),
        enabled: contract.enabled,
      );
      final adapter = _adapterResolver?.resolve(device);
      if (adapter != null) _coordinator.register(device, adapter);
    }
    return result;
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
    final actions = <Future<Object> Function()>[];

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
    if (printer != null && receipt != null) {
      actions.add(
        () => printReceipt(
          scope: scope,
          printerId: printer.id,
          configurationVersion: printer.configurationVersion,
          receipt: receipt,
          commandId: _deterministicId(
            'receipt:${receipt.receiptId}:${printer.id}',
          ),
        ),
      );
    }

    final display = devices
        .where((device) => device.enabled && device.type == 'customer_display')
        .firstOrNull;
    if (display != null && saleId != null) {
      actions.add(
        () => updateCustomerDisplay(
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
        ),
      );
    }

    final drawer = devices
        .where((device) => device.enabled && device.type == 'cash_drawer')
        .firstOrNull;
    if (drawer != null && saleId != null && _hasCashTender(result)) {
      actions.add(
        () => openDrawer(
          scope: scope,
          drawerId: drawer.id,
          configurationVersion: drawer.configurationVersion,
          reason: 'cash_sale',
          cashReference: saleId,
          commandId: _deterministicId('drawer:$saleId:${drawer.id}'),
        ),
      );
    }
    return afterCommittedFinancialAction(actions);
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
    final actions = <Future<Object> Function()>[];
    final printer = devices
        .where(
          (device) =>
              device.enabled &&
              device.type == 'printer' &&
              device.capabilities.contains('printer.receipt'),
        )
        .firstOrNull;
    if (printer != null && receipt != null) {
      actions.add(
        () => printReceipt(
          scope: scope,
          printerId: printer.id,
          configurationVersion: printer.configurationVersion,
          receipt: receipt,
          commandId: _deterministicId(
            'refund:${result.exceptionId}:${printer.id}',
          ),
        ),
      );
    }
    final drawer = devices
        .where((device) => device.enabled && device.type == 'cash_drawer')
        .firstOrNull;
    if (drawer != null && _containsCash(result.allocation)) {
      actions.add(
        () => openDrawer(
          scope: scope,
          drawerId: drawer.id,
          configurationVersion: drawer.configurationVersion,
          reason: 'cash_refund',
          cashReference: result.exceptionId,
          commandId: _deterministicId(
            'refund-drawer:${result.exceptionId}:${drawer.id}',
          ),
        ),
      );
    }
    return afterCommittedFinancialAction(actions);
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
