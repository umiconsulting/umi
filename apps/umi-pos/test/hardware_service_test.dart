import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/app/umi_pos_app.dart';
import 'package:umi_pos/features/hardware/hardware_fingerprint.dart';
import 'package:umi_pos/features/hardware/hardware_recovery_store.dart';
import 'package:umi_pos/features/hardware/hardware_repository.dart';
import 'package:umi_pos/features/hardware/hardware_runtime.dart';
import 'package:umi_pos/features/hardware/hardware_service.dart';

const scope = HardwareScope(
  merchantId: '10000000-0000-4000-8000-000000000001',
  locationId: '10000000-0000-4000-8000-000000000002',
  operatorSessionId: '10000000-0000-4000-8000-000000000003',
  registerId: null,
);

const receipt = ReceiptPrintPayload(
  receiptId: 'receipt-1',
  merchantName: 'Umi',
  locationName: 'Pilot',
  registerName: null,
  receiptNumber: 'R-1',
  businessDate: '2026-08-09',
  currency: 'MXN',
  items: [],
  subtotalMinorUnits: 100,
  discountMinorUnits: 0,
  taxMinorUnits: 0,
  tipMinorUnits: 0,
  totalMinorUnits: 100,
  tenders: [],
  changeMinorUnits: 0,
  loyaltySummary: null,
  customerValueSummary: null,
  exceptionMarker: null,
  qrValue: null,
  footer: null,
);

void main() {
  test(
    'executes one server-owned command and returns the original result',
    () async {
      final repository = _HardwareRepository();
      final printer = PrinterSimulatorAdapter();
      final service = HardwareService(
        repository: repository,
        coordinator: HardwareCoordinator(
          adapters: {'printer-1': printer},
          devices: [simulatedDevice(id: 'printer-1', type: 'printer')],
        ),
        recovery: MemoryHardwareRecoveryStore(),
      );
      const commandId = '10000000-0000-4000-8000-000000000010';

      await service.printReceipt(
        scope: scope,
        printerId: 'printer-1',
        configurationVersion: 1,
        receipt: receipt,
        commandId: commandId,
      );
      final recovered = await service.printReceipt(
        scope: scope,
        printerId: 'printer-1',
        configurationVersion: 1,
        receipt: receipt,
        commandId: commandId,
      );

      expect(printer.artifacts, hasLength(1));
      expect(recovered.command['status'], 'succeeded');
      expect(repository.transitions, ['dispatching', 'succeeded']);
    },
  );

  test(
    'restart during dispatch becomes unknown without a second side effect',
    () async {
      final repository = _HardwareRepository();
      final recovery = MemoryHardwareRecoveryStore();
      const commandId = '10000000-0000-4000-8000-000000000011';
      final command = _printCommand(commandId);
      await recovery.save(
        PendingHardwareDispatch(
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          commandId: commandId,
          payloadFingerprint: command.payloadFingerprint,
          state: HardwareDispatchState.dispatching,
        ),
      );
      final printer = PrinterSimulatorAdapter();
      final service = HardwareService(
        repository: repository,
        coordinator: HardwareCoordinator(
          adapters: {'printer-1': printer},
          devices: [simulatedDevice(id: 'printer-1', type: 'printer')],
        ),
        recovery: recovery,
      );

      final result = await service.execute(scope.merchantId, command);
      expect(result.command['status'], 'unknown');
      expect(printer.artifacts, isEmpty);
    },
  );

  test(
    'hardware failure does not alter the committed financial result',
    () async {
      final service = HardwareService(
        repository: _HardwareRepository(),
        coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
        recovery: MemoryHardwareRecoveryStore(),
      );
      final results = await service.afterCommittedFinancialAction([
        () async => throw StateError('printer offline'),
        () async => 'financial-result-stays-committed',
      ]);
      expect(results, hasLength(2));
      expect(results.last, 'financial-result-stays-committed');
    },
  );

  test('dispatching server state does not emit a second side effect', () async {
    final repository = _HardwareRepository();
    const commandId = '10000000-0000-4000-8000-000000000012';
    repository.statuses[commandId] = 'dispatching';
    final printer = PrinterSimulatorAdapter();
    final service = HardwareService(
      repository: repository,
      coordinator: HardwareCoordinator(
        adapters: {'printer-1': printer},
        devices: [simulatedDevice(id: 'printer-1', type: 'printer')],
      ),
      recovery: MemoryHardwareRecoveryStore(),
    );

    final result = await service.execute(
      scope.merchantId,
      _printCommand(commandId),
    );

    expect(result.command['status'], 'unknown');
    expect(printer.artifacts, isEmpty);
  });

  test(
    'controlled reprint dispatches its server-created command once',
    () async {
      final repository = _HardwareRepository();
      final printer = PrinterSimulatorAdapter();
      final service = HardwareService(
        repository: repository,
        coordinator: HardwareCoordinator(
          adapters: {'printer-1': printer},
          devices: [simulatedDevice(id: 'printer-1', type: 'printer')],
        ),
        recovery: MemoryHardwareRecoveryStore(),
        identifiers: _FixedIdentifierFactory(
          '10000000-0000-4000-8000-000000000013',
        ),
      );

      final result = await service.controlledReprint(
        scope: scope,
        jobId: '10000000-0000-4000-8000-000000000014',
        reason: 'operator_confirmed_copy',
      );

      expect(result.command['status'], 'succeeded');
      expect(printer.artifacts, hasLength(1));
    },
  );

  test('hardware service suppresses keyboard scans during PIN entry', () async {
    final service = HardwareService(
      repository: _HardwareRepository(),
      coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
      recovery: MemoryHardwareRecoveryStore(),
    );
    final events = <CanonicalScanEvent>[];
    final subscription = service.scanEvents.listen(events.add);
    final start = DateTime.utc(2026, 8, 9);

    service.setSensitiveInputActive(true);
    for (final entry in 'PIN\n'.codeUnits.indexed) {
      service.acceptKeyboardCodeUnit(
        entry.$2,
        start.add(Duration(milliseconds: entry.$1 * 10)),
      );
    }
    service.setSensitiveInputActive(false);
    var completed = false;
    for (final entry in 'ABC\n'.codeUnits.indexed) {
      completed = service.acceptKeyboardCodeUnit(
        entry.$2,
        start.add(Duration(milliseconds: 100 + entry.$1 * 10)),
      );
    }
    await Future<void>.delayed(Duration.zero);

    expect(events.map((event) => event.value), ['ABC']);
    expect(completed, isTrue);
    await subscription.cancel();
    await service.dispose();
  });

  test(
    'keyboard wedge remains active when simulator mode is enabled',
    () async {
      final lab = SimulatorHardwareLab();
      final service = HardwareService(
        repository: _HardwareRepository(),
        coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
        recovery: MemoryHardwareRecoveryStore(),
        adapterResolver: lab,
      );
      final events = <CanonicalScanEvent>[];
      final subscription = service.scanEvents.listen(events.add);
      final start = DateTime.utc(2026, 8, 9);

      for (final entry in 'WEDGE\n'.codeUnits.indexed) {
        service.acceptKeyboardCodeUnit(
          entry.$2,
          start.add(Duration(milliseconds: entry.$1 * 10)),
        );
      }
      await Future<void>.delayed(Duration.zero);

      expect(events.map((event) => event.value), ['WEDGE']);
      await subscription.cancel();
      await service.dispose();
    },
  );

  testWidgets('a completed wedge scan consumes Enter before a focused action', (
    tester,
  ) async {
    final start = DateTime.utc(2026, 8, 9);
    var actionCount = 0;
    var acceptedCodeUnit = 0;
    final focusNode = FocusNode();
    final router = HardwareKeyboardWedgeRouter();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ElevatedButton(
            focusNode: focusNode,
            onPressed: () => actionCount += 1,
            child: const Text('Focused action'),
          ),
        ),
      ),
    );
    focusNode.requestFocus();
    await tester.pump();

    final result = router.route(
      acceptCodeUnit: (codeUnit, _) {
        acceptedCodeUnit = codeUnit;
        return true;
      },
      event: KeyDownEvent(
        physicalKey: PhysicalKeyboardKey.enter,
        logicalKey: LogicalKeyboardKey.enter,
        timeStamp: const Duration(milliseconds: 50),
      ),
      textInputFocused: false,
      occurredAt: start.add(const Duration(milliseconds: 50)),
    );
    expect(acceptedCodeUnit, '\n'.codeUnitAt(0));
    expect(result, KeyEventResult.handled);
    expect(actionCount, 0);
    await tester.pumpWidget(const SizedBox.shrink());
    focusNode.dispose();
  });

  test('known Busy result retries with the same command identity', () async {
    final repository = _HardwareRepository();
    const commandId = '10000000-0000-4000-8000-000000000015';
    final printer = PrinterSimulatorAdapter(
      failures: {commandId: SimulatorFailure.busy},
    );
    final service = HardwareService(
      repository: repository,
      coordinator: HardwareCoordinator(
        adapters: {'printer-1': printer},
        devices: [simulatedDevice(id: 'printer-1', type: 'printer')],
      ),
      recovery: MemoryHardwareRecoveryStore(),
    );

    final first = await service.execute(
      scope.merchantId,
      _printCommand(commandId),
    );
    printer.clearFailure(commandId);
    final second = await service.execute(
      scope.merchantId,
      _printCommand(commandId),
    );

    expect(first.command['status'], 'retryable');
    expect(second.command['status'], 'succeeded');
    expect(printer.artifacts, hasLength(1));
    expect(repository.transitions, [
      'dispatching',
      'retryable',
      'dispatching',
      'succeeded',
    ]);
  });

  test('server terminal retry limit clears local recovery state', () async {
    const commandId = '10000000-0000-4000-8000-000000000018';
    final repository = _HardwareRepository()..terminalizeRetryable = true;
    final recovery = MemoryHardwareRecoveryStore();
    final printer = PrinterSimulatorAdapter(
      failures: {commandId: SimulatorFailure.busy},
    );
    final service = HardwareService(
      repository: repository,
      coordinator: HardwareCoordinator(
        adapters: {'printer-1': printer},
        devices: [simulatedDevice(id: 'printer-1', type: 'printer')],
      ),
      recovery: recovery,
    );

    final result = await service.execute(
      scope.merchantId,
      _printCommand(commandId),
    );

    expect(result.command['status'], 'failed');
    expect(await recovery.load(commandId), isNull);
    await service.dispose();
  });

  test(
    'diagnostic executes the simulator and records the safe result',
    () async {
      final repository = _HardwareRepository()
        ..snapshotResult = HardwareRuntimeSnapshot(
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          registerId: null,
          devices: [_simulatorPrinter.toJson()],
          printJobs: const [],
          recoveryStates: const [],
          pendingJobs: 0,
          retryableJobs: 0,
          unknownCommands: 0,
          capturedAt: '2026-08-09T00:00:00.000Z',
        );
      final lab = SimulatorHardwareLab();
      final service = HardwareService(
        repository: repository,
        coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
        recovery: MemoryHardwareRecoveryStore(),
        adapterResolver: lab,
        identifiers: _SequenceIdentifierFactory([
          '10000000-0000-4000-8000-000000000016',
          '10000000-0000-4000-8000-000000000017',
        ]),
      );

      final result = await service.runDiagnostic(
        scope: scope,
        hardwareId: _simulatorPrinter.id,
        diagnostic: 'connection_test',
      );

      expect(result.health, 'healthy');
      expect(result.connectionState, 'connected');
      expect(
        (repository.lastDiagnostic?.safeResult)?['commandStatus'],
        'succeeded',
      );
      await service.dispose();
    },
  );
}

const _simulatorPrinter = HardwareDevice(
  id: '10000000-0000-4000-8000-000000000020',
  merchantId: '10000000-0000-4000-8000-000000000001',
  locationId: '10000000-0000-4000-8000-000000000002',
  registerId: null,
  assignedPosDeviceId: '10000000-0000-4000-8000-000000000021',
  primary: true,
  type: 'printer',
  manufacturer: 'Simulator',
  model: 'receipt-v1',
  publicReference: 'SIM-PRINTER-1',
  transport: 'simulator',
  capabilities: ['printer.receipt', 'printer.test_page'],
  enabled: true,
  configurationVersion: 1,
  connectionState: 'connected',
  firmwareVersion: null,
  lastHeartbeatAt: null,
  lastDiagnosticAt: null,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  archivedAt: null,
  optimisticVersion: 1,
);

final class _FixedIdentifierFactory implements HardwareIdentifierFactory {
  const _FixedIdentifierFactory(this.value);
  final String value;
  @override
  String next() => value;
}

final class _SequenceIdentifierFactory implements HardwareIdentifierFactory {
  _SequenceIdentifierFactory(this.values);
  final List<String> values;
  var _index = 0;
  @override
  String next() => values[_index++];
}

HardwareCommandRequest _printCommand(String commandId) {
  final input = {
    'locationId': scope.locationId,
    'registerId': scope.registerId,
    'targetHardwareId': 'printer-1',
    'commandType': 'print_receipt',
    'sourceAggregateType': 'receipt',
    'sourceAggregateId': receipt.receiptId,
    'expectedConfigurationVersion': 1,
    'requiredCapability': 'printer.receipt',
    'drawer': null,
    'display': null,
    'printPayload': receipt.toJson(),
  };
  return HardwareCommandRequest(
    locationId: scope.locationId,
    registerId: scope.registerId,
    operatorSessionId: scope.operatorSessionId,
    commandId: commandId,
    idempotencyKey: 'hardware-command-$commandId',
    targetHardwareId: 'printer-1',
    commandType: 'print_receipt',
    sourceAggregateType: 'receipt',
    sourceAggregateId: receipt.receiptId,
    expectedConfigurationVersion: 1,
    payloadFingerprint: hardwarePayloadFingerprint(input),
    drawer: null,
    display: null,
    printPayload: receipt.toJson(),
  );
}

final class _HardwareRepository implements HardwareRepository {
  final Map<String, String> statuses = {};
  final List<String> transitions = [];
  HardwareCommandRequest? lastCommand;
  HardwareDiagnosticRequest? lastDiagnostic;
  HardwareRuntimeSnapshot? snapshotResult;
  bool terminalizeRetryable = false;

  @override
  Future<HardwareCommandResult> createCommand(
    String merchantId,
    HardwareCommandRequest command,
  ) async {
    lastCommand = command;
    statuses.putIfAbsent(command.commandId, () => 'pending');
    return _result(command.commandId, statuses[command.commandId]!);
  }

  @override
  Future<HardwareCommandResult> transition(
    String merchantId,
    String commandId,
    HardwareCommandTransitionRequest transition,
  ) async {
    transitions.add(transition.status);
    final status = terminalizeRetryable && transition.status == 'retryable'
        ? 'failed'
        : transition.status;
    statuses[commandId] = status;
    return _result(commandId, status);
  }

  HardwareCommandResult _result(String commandId, String status) =>
      HardwareCommandResult(
        command: {
          'commandId': commandId,
          'commandType': lastCommand?.commandType,
          'payloadFingerprint': lastCommand?.payloadFingerprint,
          'status': status,
        },
        recovered: status != 'pending',
        failure: status == 'unknown'
            ? const {'code': 'unknown_outcome', 'retryable': false}
            : null,
        dispatchPayload: {
          'drawer': lastCommand?.drawer,
          'display': lastCommand?.display,
          'printPayload': lastCommand?.printPayload,
        },
      );

  @override
  Future<HardwareRuntimeSnapshot> snapshot(
    String merchantId,
    HardwareRegistryQuery query,
  ) async => snapshotResult ?? (throw UnimplementedError());
  @override
  Future<HardwareDiagnosticResult> diagnostic(
    String merchantId,
    HardwareDiagnosticRequest request,
  ) async {
    lastDiagnostic = request;
    return HardwareDiagnosticResult(
      diagnosticId: request.commandId,
      hardwareId: request.hardwareId,
      diagnostic: request.diagnostic,
      health: request.health,
      connectionState: request.connectionState,
      capabilities: _simulatorPrinter.capabilities,
      latencyMs: request.latencyMs,
      failure: request.failureCode == null
          ? null
          : {'code': request.failureCode},
      occurredAt: '2026-08-09T00:00:00.000Z',
      correlationId: 'diagnostic-test',
    );
  }

  @override
  Future<ControlledReprintResult> controlledReprint(
    String merchantId,
    String jobId,
    ControlledReprintRequest request,
  ) async {
    final command = _printCommand(request.commandId);
    lastCommand = command;
    return ControlledReprintResult(
      job: {'jobId': request.commandId, 'originalJobId': jobId},
      command: command.toJson(),
    );
  }

  @override
  Future<HardwareDevice> register(
    String merchantId,
    RegisterHardwareRequest request,
  ) => throw UnimplementedError();
  @override
  Future<HardwareDevice> update(
    String merchantId,
    String hardwareId,
    UpdateHardwareRequest request,
  ) => throw UnimplementedError();
  @override
  Future<HardwareDevice> assign(
    String merchantId,
    String hardwareId,
    AssignHardwareRequest request,
  ) => throw UnimplementedError();
}
