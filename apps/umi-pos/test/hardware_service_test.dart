import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/app/umi_pos_app.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/hardware/hardware_fingerprint.dart';
import 'package:umi_pos/features/hardware/hardware_recovery_store.dart';
import 'package:umi_pos/features/hardware/hardware_repository.dart';
import 'package:umi_pos/features/hardware/hardware_runtime.dart';
import 'package:umi_pos/features/hardware/hardware_service.dart';
import 'package:umi_pos/features/hardware/pilot_hardware_adapters.dart';
import 'package:umi_pos/features/hardware/terminal_cashbox_transport.dart';
import 'package:umi_pos/features/offline/offline_checkout_service.dart';

const scope = HardwareScope(
  merchantId: '10000000-0000-4000-8000-000000000001',
  locationId: '10000000-0000-4000-8000-000000000002',
  operatorSessionId: '10000000-0000-4000-8000-000000000003',
  deviceId: '10000000-0000-4000-8000-000000000099',
  credentialVersion: 1,
  permissions: {
    'hardware.printer.print',
    'hardware.printer.reprint',
    'hardware.drawer.open',
  },
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
    'a receipt already printed is reprinted as a copy, not printed again',
    () async {
      // `Imprimir recibo` on a sale that had already printed asked for a second
      // official receipt. The first job owns the command's idempotency key and
      // the unique index allows one official receipt per receipt and printer, so
      // the till answered `IDEMPOTENCY_CONFLICT` (measured on the iMin D3-504 on
      // 2026-10-11). A copy is a controlled reprint of the original job.
      final repository = _HardwareRepository()
        ..snapshotResult = HardwareRuntimeSnapshot(
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          registerId: null,
          devices: [_simulatorPrinter.toJson()],
          printJobs: const [
            {
              'jobId': 'job-original',
              'targetPrinterId': '10000000-0000-4000-8000-000000000020',
              'type': 'official_receipt',
              'sourceAggregateType': 'receipt',
              'sourceAggregateId': 'receipt-1',
              'correlationId': 'correlation-1',
              'idempotencyKey': 'hardware-receipt-receipt-1',
              'payloadFingerprint':
                  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              'copies': 1,
              'status': 'printed',
              'attempts': 1,
              'createdAt': '2026-08-09T00:00:00.000Z',
              'startedAt': null,
              'completedAt': null,
              'failure': null,
              'originalJobId': null,
            },
          ],
          recoveryStates: const [],
          pendingJobs: 0,
          retryableJobs: 0,
          unknownCommands: 0,
          capturedAt: '2026-08-09T00:00:00.000Z',
        );
      final printer = PrinterSimulatorAdapter();
      final service = HardwareService(
        repository: repository,
        coordinator: HardwareCoordinator(
          adapters: {_simulatorPrinter.id: printer},
          devices: [simulatedDevice(id: _simulatorPrinter.id, type: 'printer')],
        ),
        recovery: MemoryHardwareRecoveryStore(),
      );

      await service.printAuthoritativeReceipt(
        scope: scope,
        receiptId: 'receipt-1',
        receiptSnapshot: const {
          'merchantName': 'UmiPOS Local',
          'locationName': 'Sucursal Local',
          'receiptRef': 'POS-1',
          'businessDate': '2026-08-09',
          'currency': 'MXN',
          'lines': [
            {
              'description': 'Chai latte',
              'quantity': 1,
              'lineTotal': {'minorUnits': 7200},
            },
          ],
          'subtotal': {'minorUnits': 7200},
          'tax': {'minorUnits': 993},
          'total': {'minorUnits': 7200},
          'change': {'minorUnits': 0},
        },
      );

      expect(repository.reprintCalls, ['job-original']);
      await service.dispose();
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

  test('assigned POS executes one Dashboard remote command', () async {
    final repository = _HardwareRepository();
    final remote = _printCommand('10000000-0000-4000-8000-000000000015');
    repository.lastCommand = remote;
    repository.remoteClaim = repository._result(
      remote.commandId,
      'dispatching',
    );
    final printer = PrinterSimulatorAdapter();
    final service = HardwareService(
      repository: repository,
      coordinator: HardwareCoordinator(
        adapters: {'printer-1': printer},
        devices: [simulatedDevice(id: 'printer-1', type: 'printer')],
      ),
      recovery: MemoryHardwareRecoveryStore(),
    );

    final result = await service.executeNextRemoteCommand(scope);

    expect(result?.command['status'], 'succeeded');
    expect(printer.artifacts, hasLength(1));
    expect(repository.transitions, ['succeeded']);
  });

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
      PosApp(
        home: PosPage(
          body: PosButton(
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

  test(
    'print queue retry recovers and preserves the command identity',
    () async {
      final repository = _HardwareRepository();
      const commandId = '10000000-0000-4000-8000-000000000025';
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
      await service.execute(scope.merchantId, _printCommand(commandId));
      printer.clearFailure(commandId);
      final result = await service.retryKnownSafePrint(
        scope: scope,
        jobId: commandId,
      );
      expect(result.command['commandId'], commandId);
      expect(result.command['status'], 'succeeded');
      expect(printer.artifacts, hasLength(1));
      await service.dispose();
    },
  );

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

  test(
    'terminal drawer test records an unverified physical connection',
    () async {
      final drawer = _pilotDevice(
        'drawer-terminal-diagnostic',
        'cash_drawer',
        const ['drawer.open', 'drawer.status'],
        transport: 'platform_channel_foundation',
        assignedPosDeviceId: scope.deviceId,
      );
      final repository = _HardwareRepository()
        ..snapshotResult = HardwareRuntimeSnapshot(
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          registerId: null,
          devices: [drawer.toJson()],
          printJobs: const [],
          recoveryStates: const [],
          pendingJobs: 0,
          retryableJobs: 0,
          unknownCommands: 0,
          capturedAt: '2026-08-09T00:00:00.000Z',
        );
      final cashbox = _TerminalCashboxChannelFake();
      final service = HardwareService(
        repository: repository,
        coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
        recovery: MemoryHardwareRecoveryStore(),
        adapterResolver: PilotHardwareLab(
          terminalCashboxFactory: () => cashbox,
        ),
        identifiers: _SequenceIdentifierFactory([
          '10000000-0000-4000-8000-000000000018',
          '10000000-0000-4000-8000-000000000019',
        ]),
      );

      final result = await service.runDiagnostic(
        scope: scope,
        hardwareId: drawer.id,
        diagnostic: 'drawer_test',
      );

      expect(result.health, 'unknown');
      expect(result.connectionState, 'unknown');
      expect(cashbox.pulses, 1);
      expect(repository.lastDiagnostic?.connectionState, 'unknown');
      expect(repository.lastDiagnostic?.health, 'unknown');
      await service.dispose();
    },
  );

  test(
    'server pilot policy disables scanner input without disabling manual lookup',
    () async {
      final repository = _HardwareRepository()
        ..snapshotResult = HardwareRuntimeSnapshot(
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          registerId: null,
          policy: const {
            'autoPrintReceipt': true,
            'openDrawerOnCashSale': true,
            'openDrawerOnCashRefund': true,
            'allowNoSale': false,
            'receiptCopiesDefault': 1,
            'hardwareRetryLimit': 2,
            'hardwareHealthIntervalSeconds': 30,
            'scannerEnabled': false,
            'customerDisplayEnabled': false,
          },
          devices: const [],
          printJobs: const [],
          recoveryStates: const [],
          pendingJobs: 0,
          retryableJobs: 0,
          unknownCommands: 0,
          capturedAt: '2026-08-09T00:00:00.000Z',
        );
      final service = HardwareService(
        repository: repository,
        coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
        recovery: MemoryHardwareRecoveryStore(),
      );
      final events = <CanonicalScanEvent>[];
      final subscription = service.scanEvents.listen(events.add);

      await service.snapshot(scope);
      var now = DateTime.utc(2026, 8, 9);
      for (final unit in '7501234567890\n'.codeUnits) {
        service.acceptKeyboardCodeUnit(unit, now);
        now = now.add(const Duration(milliseconds: 4));
      }
      await Future<void>.delayed(Duration.zero);

      expect(events, isEmpty);
      await subscription.cancel();
      await service.dispose();
    },
  );

  test('an offline cash sale never prints a receipt', () async {
    final repository = _HardwareRepository()
      ..snapshotResult = HardwareRuntimeSnapshot(
        merchantId: scope.merchantId,
        locationId: scope.locationId,
        registerId: null,
        policy: const {
          'autoPrintReceipt': true,
          'openDrawerOnCashSale': false,
          'receiptCopiesDefault': 1,
          'hardwareRetryLimit': 2,
          'hardwareHealthIntervalSeconds': 30,
          'scannerEnabled': true,
          'customerDisplayEnabled': false,
        },
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
    );
    await service.snapshot(scope);
    final results = await service.afterOfflineCashSale(
      scope,
      const OfflineCashCommit(
        localCommitId: '10000000-0000-4000-8000-000000000041',
      ),
    );

    expect(results, isEmpty);
    expect(
      lab.adapter<PrinterSimulatorAdapter>(_simulatorPrinter.id)!.artifacts,
      isEmpty,
    );
    await service.dispose();
  });

  test(
    'simulated cashier journey keeps financial and physical facts separate',
    () async {
      final repository = _HardwareRepository()
        ..snapshotResult = HardwareRuntimeSnapshot(
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          registerId: null,
          policy: const {
            'autoPrintReceipt': true,
            'openDrawerOnCashSale': true,
            'openDrawerOnCashRefund': true,
            'allowNoSale': false,
            'receiptCopiesDefault': 2,
            'hardwareRetryLimit': 2,
            'hardwareHealthIntervalSeconds': 30,
            'scannerEnabled': true,
            'customerDisplayEnabled': true,
          },
          devices: [
            _pilotDevice('printer-journey', 'printer', const [
              'printer.receipt',
              'printer.test_page',
            ], primary: true).toJson(),
            _pilotDevice('drawer-journey', 'cash_drawer', const [
              'drawer.open',
              'drawer.status',
            ]).toJson(),
            _pilotDevice('scanner-journey', 'barcode_scanner', const [
              'scanner.barcode',
              'scanner.qr',
            ]).toJson(),
            _pilotDevice('display-journey', 'customer_display', const [
              'customer_display.text',
              'customer_display.totals',
            ]).toJson(),
          ],
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
      );
      const completedSale = CheckoutResult(
        status: 'completed',
        confirmation: {},
        payment: null,
        payments: [
          {
            'type': 'cash',
            'amount': {'minorUnits': 1500, 'currency': 'MXN'},
          },
        ],
        reservation: null,
        sale: {'id': '10000000-0000-4000-8000-000000000030'},
        receipt: {
          'id': '10000000-0000-4000-8000-000000000031',
          'receiptRef': 'PILOT-1',
          'businessDate': '2026-08-09',
          'currency': 'MXN',
          'lines': [
            {
              'description': 'Café',
              'quantity': 1,
              'lineTotal': {'minorUnits': 1200, 'currency': 'MXN'},
            },
          ],
          'subtotal': {'minorUnits': 1200, 'currency': 'MXN'},
          'taxTotal': {'minorUnits': 0, 'currency': 'MXN'},
          'grandTotal': {'minorUnits': 1200, 'currency': 'MXN'},
          'change': {'minorUnits': 300, 'currency': 'MXN'},
        },
        failure: null,
      );
      const completedRefund = SaleExceptionResult(
        exceptionId: '10000000-0000-4000-8000-000000000032',
        saleId: '10000000-0000-4000-8000-000000000030',
        status: 'committed',
        exceptionType: 'full_refund',
        allocation: {
          'tenders': [
            {'type': 'cash', 'minorUnits': 1200},
          ],
        },
        receipt: {
          'id': '10000000-0000-4000-8000-000000000033',
          'publicReference': 'REFUND-1',
          'businessDate': '2026-08-09',
          'currency': 'MXN',
          'lines': [],
          'subtotal': {'minorUnits': -1200, 'currency': 'MXN'},
          'taxTotal': {'minorUnits': 0, 'currency': 'MXN'},
          'grandTotal': {'minorUnits': -1200, 'currency': 'MXN'},
        },
        remainingRefundable: {'minorUnits': 0, 'currency': 'MXN'},
        correlationReference: 'refund-pilot-1',
        committedAt: '2026-08-09T12:00:00.000Z',
        retryAllowed: false,
      );

      await service.snapshot(scope);
      final scans = <CanonicalScanEvent>[];
      final subscription = service.scanEvents.listen(scans.add);
      lab
          .adapter<ScannerSimulatorAdapter>('scanner-journey')!
          .emit('7501234567890', symbology: 'ean');
      await Future<void>.delayed(Duration.zero);
      final saleResults = await service.afterCheckoutCompleted(
        scope,
        completedSale,
      );
      final replayResults = await service.afterCheckoutCompleted(
        scope,
        completedSale,
      );
      final refundResults = await service.afterRefundCompleted(
        scope,
        completedRefund,
      );

      expect(scans.single.value, '7501234567890');
      expect(saleResults.results, hasLength(3));
      expect(saleResults.drawerAnswered, isTrue);
      expect(replayResults.results, hasLength(3));
      expect(replayResults.drawerAnswered, isTrue);
      expect(refundResults, hasLength(2));
      expect(
        lab.adapter<PrinterSimulatorAdapter>('printer-journey')!.artifacts,
        hasLength(4),
      );
      expect(
        lab.adapter<DrawerSimulatorAdapter>('drawer-journey')!.openCommands,
        hasLength(2),
      );
      expect(
        lab
            .adapter<CustomerDisplaySimulatorAdapter>('display-journey')!
            .lastProjection!
            .state['state'],
        'completed',
      );
      expect(repository.statuses, hasLength(7));
      await subscription.cancel();
      await service.dispose();
    },
  );

  test(
    'a drawer that names another terminal is not this till\'s to open',
    () async {
      // The counter's drawer is visible to everyone in the location, and a
      // handheld has no socket to pulse it with. A cash sale there must not
      // answer "el cajón no respondió" about hardware it never had.
      final repository = _HardwareRepository()
        ..snapshotResult = HardwareRuntimeSnapshot(
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          registerId: null,
          policy: const {'openDrawerOnCashSale': true},
          devices: [
            _pilotDevice(
              'drawer-counter',
              'cash_drawer',
              const ['drawer.open', 'drawer.status'],
              assignedPosDeviceId: '10000000-0000-4000-8000-0000000000ff',
            ).toJson(),
          ],
          printJobs: const [],
          recoveryStates: const [],
          pendingJobs: 0,
          retryableJobs: 0,
          unknownCommands: 0,
          capturedAt: '2026-08-09T00:00:00.000Z',
        );
      final cashbox = _TerminalCashboxChannelFake();
      final service = HardwareService(
        repository: repository,
        coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
        recovery: MemoryHardwareRecoveryStore(),
        adapterResolver: PilotHardwareLab(
          terminalCashboxFactory: () => cashbox,
        ),
      );

      await service.snapshot(scope);
      final sale = await service.afterCheckoutCompleted(scope, cashSale);

      expect(sale.results, isEmpty);
      expect(sale.drawerAnswered, isTrue);
      expect(cashbox.pulses, 0);
      await service.dispose();
    },
  );

  test(
    'a cash sale pulses the drawer on the terminal port exactly once',
    () async {
      // The terminal's OWN drawer socket, end to end through the service: the
      // registry says the drawer rides the platform channel, the sale commits,
      // and the adapter pulses the board once. The replay of the same sale must
      // not produce a second pulse — that rule is what keeps a retried response
      // from opening a drawer twice.
      final repository = _HardwareRepository()
        ..snapshotResult = HardwareRuntimeSnapshot(
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          registerId: null,
          policy: const {'openDrawerOnCashSale': true},
          devices: [
            _pilotDevice(
              'drawer-terminal',
              'cash_drawer',
              const ['drawer.open', 'drawer.status'],
              transport: 'platform_channel_foundation',
              assignedPosDeviceId: scope.deviceId,
            ).toJson(),
          ],
          printJobs: const [],
          recoveryStates: const [],
          pendingJobs: 0,
          retryableJobs: 0,
          unknownCommands: 0,
          capturedAt: '2026-08-09T00:00:00.000Z',
        );
      final cashbox = _TerminalCashboxChannelFake();
      final service = HardwareService(
        repository: repository,
        coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
        recovery: MemoryHardwareRecoveryStore(),
        adapterResolver: PilotHardwareLab(
          terminalCashboxFactory: () => cashbox,
        ),
      );

      await service.snapshot(scope);
      final sale = await service.afterCheckoutCompleted(scope, cashSale);
      final replay = await service.afterCheckoutCompleted(scope, cashSale);

      expect(sale.drawerAnswered, isTrue);
      expect(replay.drawerAnswered, isTrue);
      // The replay of the same sale carries the same command identity, so the
      // board is written once; the health poll is what asks the port the rest of
      // the time, and it never pulses.
      expect(cashbox.pulses, 1);
      expect(cashbox.probes, greaterThan(0));
      await service.dispose();
    },
  );

  test('a slow drawer cannot delay an independent receipt printer', () async {
    final printer = PrinterSimulatorAdapter();
    final drawer = _HeldDrawerAdapter();
    final repository = _HardwareRepository()
      ..snapshotResult = HardwareRuntimeSnapshot(
        merchantId: scope.merchantId,
        locationId: scope.locationId,
        registerId: null,
        policy: const {
          'autoPrintReceipt': true,
          'openDrawerOnCashSale': true,
          'receiptCopiesDefault': 1,
        },
        devices: [
          _pilotDevice('printer-independent', 'printer', const [
            'printer.receipt',
          ]).toJson(),
          _pilotDevice('drawer-independent', 'cash_drawer', const [
            'drawer.open',
          ]).toJson(),
        ],
        printJobs: const [],
        recoveryStates: const [],
        pendingJobs: 0,
        retryableJobs: 0,
        unknownCommands: 0,
        capturedAt: '2026-08-09T00:00:00.000Z',
      );
    final service = HardwareService(
      repository: repository,
      coordinator: HardwareCoordinator(
        adapters: {
          'printer-independent': printer,
          'drawer-independent': drawer,
        },
        devices: [
          simulatedDevice(id: 'printer-independent', type: 'printer'),
          simulatedDevice(id: 'drawer-independent', type: 'cash_drawer'),
        ],
      ),
      recovery: MemoryHardwareRecoveryStore(),
    );

    final checkout = service.afterCheckoutCompleted(scope, cashSale);
    await drawer.started.future;
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(printer.artifacts, hasLength(1));
    drawer.release.complete();
    final outcome = await checkout;
    expect(outcome.drawerAnswered, isTrue);
    await service.dispose();
  });

  test(
    'a committed sale prints from the bound runtime without a cloud or USB probe',
    () async {
      final repository = _HardwareRepository()
        ..snapshotResult = HardwareRuntimeSnapshot(
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          registerId: null,
          policy: const {
            'autoPrintReceipt': true,
            'openDrawerOnCashSale': false,
            'receiptCopiesDefault': 1,
          },
          devices: [_simulatorPrinter.toJson()],
          printJobs: const [],
          recoveryStates: const [],
          pendingJobs: 0,
          retryableJobs: 0,
          unknownCommands: 0,
          capturedAt: '2026-08-09T00:00:00.000Z',
        );
      final printer = PrinterSimulatorAdapter();
      final health = _CountingHealthResolver();
      final service = HardwareService(
        repository: repository,
        coordinator: HardwareCoordinator(
          adapters: {_simulatorPrinter.id: printer},
          devices: [simulatedDevice(id: _simulatorPrinter.id, type: 'printer')],
        ),
        recovery: MemoryHardwareRecoveryStore(),
        adapterResolver: health,
      );

      await service.snapshot(scope);
      expect(repository.snapshotCalls, 1);
      expect(health.refreshes, 1);

      final sale = await service.afterCheckoutCompleted(scope, cashSale);

      expect(sale.results, hasLength(1));
      expect(printer.artifacts, hasLength(1));
      expect(
        repository.snapshotCalls,
        1,
        reason:
            'the committed receipt uses the reading already bound to the till',
      );
      expect(
        health.refreshes,
        1,
        reason: 'a DLE EOT probe is not a prerequisite for printing',
      );
      await service.dispose();
    },
  );

  test('a reading the relay takes reaches every screen that follows it', () async {
    // The state a centre shows is the state the till measured last. A screen that
    // keeps the reading it loaded when it opened shows the state of that moment:
    // on the pilot till a printer was found and printed while the centre still
    // read the state of the moment the centre opened.
    final repository = _HardwareRepository()
      ..snapshotResult = HardwareRuntimeSnapshot(
        merchantId: scope.merchantId,
        locationId: scope.locationId,
        registerId: null,
        devices: [_simulatorPrinter.toJson()],
        printJobs: const [],
        pendingJobs: 0,
        retryableJobs: 0,
        unknownCommands: 0,
        capturedAt: '2026-08-09T00:00:00.000Z',
      );
    final service = HardwareService(
      repository: repository,
      coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
      recovery: MemoryHardwareRecoveryStore(),
    );
    final seen = <HardwareRuntimeSnapshot?>[];
    void follow() => seen.add(service.latestRuntime.value);
    service.latestRuntime.addListener(follow);

    expect(service.latestRuntime.value, isNull);
    await service.snapshot(scope);

    expect(seen, hasLength(1));
    expect(seen.single?.devices, hasLength(1));
    expect(seen.single?.capturedAt, '2026-08-09T00:00:00.000Z');

    service.latestRuntime.removeListener(follow);
    await service.dispose();
  });

  test(
    'the background read waits for its minute, and a screen at the hardware does not',
    () async {
      // The reading carries the queue of the whole location, and the till asked for it
      // every ten seconds whether or not a screen showed the hardware: 8,600 reads and
      // 8,000 claims each day for one till (measured 2026-10-12). The first read always
      // happens, so the print path has a runtime before any sale.
      final repository = _HardwareRepository()
        ..snapshotResult = HardwareRuntimeSnapshot(
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          registerId: null,
          devices: const [],
          printJobs: const [],
          pendingJobs: 0,
          retryableJobs: 0,
          unknownCommands: 0,
          capturedAt: '2026-08-09T00:00:00.000Z',
        );
      final service = HardwareService(
        repository: repository,
        coordinator: HardwareCoordinator(adapters: const {}, devices: const []),
        recovery: MemoryHardwareRecoveryStore(),
      );

      expect(service.runtimeReadDue, isTrue);
      await service.snapshot(scope);
      expect(service.runtimeReadDue, isFalse);

      service.watchRuntime();
      expect(service.runtimeReadDue, isTrue);
      service.unwatchRuntime();
      expect(service.runtimeReadDue, isFalse);
      // A screen that closes twice must not leave the counter below zero.
      service.unwatchRuntime();
      expect(service.runtimeReadDue, isFalse);

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

HardwareDevice _pilotDevice(
  String id,
  String type,
  List<String> capabilities, {
  bool primary = false,
  String transport = 'simulator',
  // Assigned to the terminal the scope belongs to, which is what the registry
  // does when the till files its own hardware (`scope.deviceId`, spelled out
  // because a default value cannot read it).
  String? assignedPosDeviceId = '10000000-0000-4000-8000-000000000099',
}) => HardwareDevice(
  id: id,
  merchantId: scope.merchantId,
  locationId: scope.locationId,
  registerId: null,
  assignedPosDeviceId: assignedPosDeviceId,
  primary: primary,
  type: type,
  manufacturer: 'Simulator',
  model: '$type-v1',
  publicReference: id,
  transport: transport,
  capabilities: capabilities,
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
    // The till's fingerprint input carries the copy flag, normalised to a boolean,
    // exactly as the API's `hardwareCommandFingerprint` does — the two are compared
    // byte for byte before a command is accepted.
    'copy': false,
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
  /// Every job this fake was asked to reprint, in order.
  final List<String> reprintCalls = [];

  HardwareCommandResult? remoteClaim;

  @override
  Future<HardwareCommandResult?> claimRemoteCommand(
    String merchantId,
    HardwareRecoveryQuery query,
  ) async {
    final result = remoteClaim;
    remoteClaim = null;
    return result;
  }

  final Map<String, String> statuses = {};
  final Map<String, HardwareCommandRequest> commands = {};
  final List<String> transitions = [];
  HardwareCommandRequest? lastCommand;
  HardwareDiagnosticRequest? lastDiagnostic;
  HardwareRuntimeSnapshot? snapshotResult;
  bool terminalizeRetryable = false;
  int snapshotCalls = 0;

  @override
  Future<HardwareCommandResult> createCommand(
    String merchantId,
    HardwareCommandRequest command,
  ) async {
    lastCommand = command;
    commands[command.commandId] = command;
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

  HardwareCommandResult _result(String commandId, String status) {
    final command = commands[commandId] ?? lastCommand;
    return HardwareCommandResult(
      command: {
        ...?command?.toJson(),
        'commandId': commandId,
        'merchantId': scope.merchantId,
        'originatingPosDeviceId': '10000000-0000-4000-8000-000000000099',
        'operatorId': '10000000-0000-4000-8000-000000000098',
        'correlationId': 'hardware-test',
        'status': status,
      },
      recovered: status != 'pending',
      failure: status == 'unknown'
          ? const {'code': 'unknown_outcome', 'retryable': false}
          : null,
      dispatchPayload: {
        'drawer': command?.drawer,
        'display': command?.display,
        'printPayload': command?.printPayload,
      },
    );
  }

  @override
  Future<HardwareRuntimeSnapshot> snapshot(
    String merchantId,
    HardwareRegistryQuery query,
  ) async {
    snapshotCalls += 1;
    return snapshotResult ?? (throw UnimplementedError());
  }

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
    reprintCalls.add(jobId);
    final original =
        commands.values
            .where((command) => command.commandType == 'print_receipt')
            .lastOrNull ??
        lastCommand ??
        _printCommand(jobId);
    final input = {
      'locationId': original.locationId,
      'registerId': original.registerId,
      'targetHardwareId': original.targetHardwareId,
      'commandType': 'controlled_reprint',
      'sourceAggregateType': original.sourceAggregateType,
      'sourceAggregateId': original.sourceAggregateId,
      'expectedConfigurationVersion': original.expectedConfigurationVersion,
      'requiredCapability': 'printer.receipt',
      'drawer': null,
      'display': null,
      'printPayload': original.printPayload,
      'copy': false,
    };
    final command = HardwareCommandRequest(
      locationId: original.locationId,
      registerId: original.registerId,
      operatorSessionId: original.operatorSessionId,
      commandId: request.commandId,
      idempotencyKey: 'hardware-reprint-${request.commandId}',
      targetHardwareId: original.targetHardwareId,
      commandType: 'controlled_reprint',
      sourceAggregateType: original.sourceAggregateType,
      sourceAggregateId: original.sourceAggregateId,
      expectedConfigurationVersion: original.expectedConfigurationVersion,
      payloadFingerprint: hardwarePayloadFingerprint(input),
      drawer: null,
      display: null,
      printPayload: original.printPayload,
    );
    lastCommand = command;
    commands[command.commandId] = command;
    return ControlledReprintResult(
      job: {'jobId': request.commandId, 'originalJobId': jobId},
      command: command.toJson(),
    );
  }

  @override
  Future<HardwareCommandResult> printJobCommand(
    String merchantId,
    String jobId,
    HardwareRecoveryQuery query,
  ) async => _result(lastCommand!.commandId, statuses[lastCommand!.commandId]!);

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
  @override
  Future<HardwarePilotPolicyResult> updatePolicy(
    String merchantId,
    UpdateHardwarePolicyRequest request,
  ) => throw UnimplementedError();
}

/// A committed sale paid in cash: the one kind of sale that pulses a drawer.
const cashSale = CheckoutResult(
  status: 'completed',
  confirmation: {},
  payment: null,
  payments: [
    {
      'type': 'cash',
      'amount': {'minorUnits': 1500, 'currency': 'MXN'},
    },
  ],
  reservation: null,
  sale: {'id': '10000000-0000-4000-8000-000000000041'},
  receipt: {
    'id': '10000000-0000-4000-8000-000000000042',
    'receiptRef': 'PILOT-DRAWER-1',
    'businessDate': '2026-08-09',
    'currency': 'MXN',
    'lines': [],
    'subtotal': {'minorUnits': 1200, 'currency': 'MXN'},
    'taxTotal': {'minorUnits': 0, 'currency': 'MXN'},
    'grandTotal': {'minorUnits': 1200, 'currency': 'MXN'},
    'change': {'minorUnits': 300, 'currency': 'MXN'},
  },
  failure: null,
);

/// The terminal's cashbox port, faked: a service test cannot hold the board.
final class _TerminalCashboxChannelFake implements TerminalCashboxChannel {
  int probes = 0;
  int pulses = 0;

  static const _port = TerminalCashboxPort(
    path: 'sysfs',
    node: '/sys/class/neostra_gpioctl/dev/gpioctl',
    value: '1',
  );

  @override
  Future<TerminalCashboxAnswer> probe() async {
    probes += 1;
    return const TerminalCashboxAnswer(
      outcome: TerminalCashboxOutcome.ready,
      port: _port,
    );
  }

  @override
  Future<TerminalCashboxAnswer> pulse() async {
    pulses += 1;
    return const TerminalCashboxAnswer(
      outcome: TerminalCashboxOutcome.ready,
      port: _port,
    );
  }
}

final class _HeldDrawerAdapter implements DeviceAdapter {
  final started = Completer<void>();
  final release = Completer<void>();

  @override
  Set<String> get capabilities => const {'drawer.open'};

  @override
  String get deviceType => 'cash_drawer';

  @override
  String get transport => 'simulator';

  @override
  Future<RuntimeCommandResult> execute(RuntimeCommand command) async {
    started.complete();
    await release.future;
    return const RuntimeCommandResult(
      status: RuntimeCommandStatus.succeeded,
      failureCode: null,
      retryable: false,
      recovered: false,
      safeMetadata: {'acknowledged': true},
    );
  }
}

final class _CountingHealthResolver
    implements DeviceAdapterResolver, HardwareConnectionStateResolver {
  int refreshes = 0;

  @override
  DeviceAdapter? resolve(RuntimeDevice device) => null;

  @override
  Future<void> refreshHealth() async {
    refreshes += 1;
  }

  @override
  String? connectionStateFor(String hardwareId) => null;
}
