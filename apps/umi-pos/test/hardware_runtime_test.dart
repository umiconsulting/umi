import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/hardware/hardware_fingerprint.dart';
import 'package:umi_pos/features/hardware/hardware_runtime.dart';
import 'package:umi_pos/features/hardware/pilot_hardware_adapters.dart';
import 'package:umi_pos/features/hardware/thermal_printer_adapter.dart';

void main() {
  group('Gate 3G-A hardware runtime', () {
    test('dispatches through the assigned capability adapter', () async {
      final printer = PrinterSimulatorAdapter();
      final runtime = HardwareCoordinator(
        adapters: {'printer-1': printer},
        devices: [simulatedDevice(id: 'printer-1', type: 'printer')],
      );

      final first = await runtime.dispatch(
        const RuntimeCommand(
          id: 'command-1',
          hardwareId: 'printer-1',
          type: 'print_receipt',
          requiredCapability: 'printer.receipt',
          payloadFingerprint: 'payload-1',
        ),
      );
      final duplicate = await runtime.dispatch(
        const RuntimeCommand(
          id: 'command-1',
          hardwareId: 'printer-1',
          type: 'print_receipt',
          requiredCapability: 'printer.receipt',
          payloadFingerprint: 'payload-1',
        ),
      );

      expect(first.status, RuntimeCommandStatus.succeeded);
      expect(duplicate.recovered, isTrue);
      expect(printer.artifacts, hasLength(1));
    });

    test('does not retry an unknown physical outcome', () async {
      final printer = PrinterSimulatorAdapter(
        failures: const {'command-unknown': SimulatorFailure.unknownOutcome},
      );
      final runtime = HardwareCoordinator(
        adapters: {'printer-1': printer},
        devices: [simulatedDevice(id: 'printer-1', type: 'printer')],
      );
      const command = RuntimeCommand(
        id: 'command-unknown',
        hardwareId: 'printer-1',
        type: 'print_receipt',
        requiredCapability: 'printer.receipt',
        payloadFingerprint: 'payload-2',
      );

      expect(
        (await runtime.dispatch(command)).status,
        RuntimeCommandStatus.unknown,
      );
      expect((await runtime.dispatch(command)).recovered, isTrue);
      expect(printer.dispatchCount, 1);
    });

    test('applies deterministic simulator failures', () async {
      final drawer = DrawerSimulatorAdapter(
        failures: const {'drawer-1': SimulatorFailure.timeout},
      );
      final result = await drawer.execute(
        const RuntimeCommand(
          id: 'drawer-1',
          hardwareId: 'drawer',
          type: 'open_drawer',
          requiredCapability: 'drawer.open',
          payloadFingerprint: 'payload-3',
        ),
      );
      expect(result.failureCode, 'command_timeout');
      expect(result.retryable, isFalse);
    });

    test('retries a known busy result', () async {
      final printer = PrinterSimulatorAdapter();
      const commandId = 'retry-print';
      printer.injectFailure(commandId, SimulatorFailure.busy);
      final runtime = HardwareCoordinator(
        adapters: {'printer-1': printer},
        devices: [simulatedDevice(id: 'printer-1', type: 'printer')],
      );
      const command = RuntimeCommand(
        id: commandId,
        hardwareId: 'printer-1',
        type: 'print_receipt',
        requiredCapability: 'printer.receipt',
        payloadFingerprint: 'fingerprint',
      );

      expect(
        (await runtime.dispatch(command)).status,
        RuntimeCommandStatus.retryable,
      );
      printer.clearFailure(commandId);
      expect(
        (await runtime.dispatch(command)).status,
        RuntimeCommandStatus.succeeded,
      );
      expect(printer.artifacts, hasLength(1));
    });

    test('bounds repeated busy retries', () async {
      final printer = PrinterSimulatorAdapter(
        failures: const {'bounded-print': SimulatorFailure.busy},
      );
      final runtime = HardwareCoordinator(
        adapters: {'printer-1': printer},
        devices: [simulatedDevice(id: 'printer-1', type: 'printer')],
      );
      const command = RuntimeCommand(
        id: 'bounded-print',
        hardwareId: 'printer-1',
        type: 'print_receipt',
        requiredCapability: 'printer.receipt',
        payloadFingerprint: 'fingerprint',
      );

      await runtime.dispatch(command);
      await runtime.dispatch(command);
      final result = await runtime.dispatch(command);
      expect(result.status, RuntimeCommandStatus.failed);
      expect(result.failureCode, 'terminal_hardware_failure');
      expect(printer.dispatchCount, HardwareCoordinator.maximumAttempts);
    });

    test('suppresses keyboard-wedge capture during PIN input', () {
      final wedge = KeyboardWedgeInputAdapter(
        terminator: '\n',
        timeout: const Duration(milliseconds: 80),
      );
      wedge.sensitiveInputActive = true;
      for (final unit in '7501234567890\n'.codeUnits) {
        wedge.accept(unit, DateTime.utc(2026, 8, 9));
      }
      expect(wedge.events, isEmpty);

      wedge.sensitiveInputActive = false;
      var now = DateTime.utc(2026, 8, 9);
      for (final unit in '7501234567890\n'.codeUnits) {
        wedge.accept(unit, now);
        now = now.add(const Duration(milliseconds: 5));
      }
      expect(wedge.events.single.value, '7501234567890');
      expect(wedge.events.single.symbology, 'ean');
    });

    test(
      'suppresses one duplicate wedge burst but keeps rapid different scans',
      () {
        final wedge = KeyboardWedgeInputAdapter(
          terminator: '\n',
          timeout: const Duration(milliseconds: 80),
        );
        var now = DateTime.utc(2026, 8, 9);
        for (final value in [
          '7501234567890',
          '7501234567890',
          '012345678905',
        ]) {
          for (final unit in '$value\n'.codeUnits) {
            wedge.accept(unit, now);
            now = now.add(const Duration(milliseconds: 2));
          }
          now = now.add(const Duration(milliseconds: 20));
        }

        expect(wedge.events.map((event) => event.value), [
          '7501234567890',
          '012345678905',
        ]);
        expect(wedge.events.last.symbology, 'upc');
      },
    );

    test('redacts unsafe customer display fields', () {
      final projection = CustomerDisplayProjection.safe({
        'state': 'completed',
        'totalMinorUnits': 2500,
        'currency': 'MXN',
        'customerContact': '+5215555555555',
        'giftCardCode': 'FULL-SECRET',
      });
      expect(projection.state, isNot(contains('customerContact')));
      expect(projection.state, isNot(contains('giftCardCode')));
      expect(projection.state['totalMinorUnits'], 2500);
    });

    test('creates a deterministic payload fingerprint without secrets', () {
      final first = hardwarePayloadFingerprint({
        'z': 2,
        'receipt': {'totalMinorUnits': 100, 'giftCardCode': 'SECRET'},
        'a': 1,
      });
      final second = hardwarePayloadFingerprint({
        'a': 1,
        'receipt': {'giftCardCode': 'DIFFERENT', 'totalMinorUnits': 100},
        'z': 2,
      });
      expect(first, second);
      expect(first, matches(RegExp(r'^[a-f0-9]{64}$')));
    });
  });

  group('Gate 3G-B thermal printer seam', () {
    test(
      'renders an authoritative receipt into deterministic thermal commands',
      () {
        final document = ThermalReceiptRenderer(widthColumns: 32).render(
          const {
            'merchantName': 'Café Umi',
            'locationName': 'Centro',
            'receiptNumber': 'R-42',
            'businessDate': '2026-08-09',
            'currency': 'MXN',
            'items': [
              {
                'name': 'Té frío',
                'quantity': 2,
                'totalMinorUnits': 2500,
                'modifiers': ['Limón'],
              },
            ],
            'subtotalMinorUnits': 2500,
            'discountMinorUnits': 0,
            'taxMinorUnits': 0,
            'tipMinorUnits': 0,
            'totalMinorUnits': 2500,
            'tenders': [
              {
                'type': 'cash',
                'amountMinorUnits': 3000,
                'maskedReference': null,
              },
            ],
            'changeMinorUnits': 500,
            'qrValue': 'https://receipt.test/R-42',
            'footer': 'Gracias',
          },
          capabilities: const {'printer.receipt', 'printer.qr', 'printer.cut'},
          copy: true,
        );

        expect(document.plainText, contains('COPY'));
        expect(document.plainText, contains('Café Umi'));
        expect(document.plainText, contains('Té frío'));
        expect(document.plainText, contains('TOTAL'));
        expect(document.commands.whereType<ThermalQrCommand>(), hasLength(1));
        expect(document.commands.last, isA<ThermalCutCommand>());
      },
    );

    test(
      'encodes Spanish receipt characters with the documented CP850 map',
      () {
        expect(const ThermalTextEncoder.cp850().encode('ñáéíóú'), [
          0xa4,
          0xa0,
          0x82,
          0xa1,
          0xa2,
          0xa3,
        ]);
      },
    );

    test('sends thermal bytes through the generic transport adapter', () async {
      final transport = _MemoryByteTransport();
      final adapter = GenericThermalPrinterAdapter(
        byteTransport: transport,
        capabilities: const {'printer.receipt', 'printer.qr', 'printer.cut'},
        widthColumns: 32,
      );

      final result = await adapter.execute(
        const RuntimeCommand(
          id: 'pilot-print-1',
          hardwareId: 'printer-1',
          type: 'print_receipt',
          requiredCapability: 'printer.receipt',
          payloadFingerprint: 'fingerprint',
          safePayload: {
            'merchantName': 'Umi',
            'locationName': 'Pilot',
            'receiptNumber': 'R-1',
            'businessDate': '2026-08-09',
            'currency': 'MXN',
            'items': [],
            'subtotalMinorUnits': 100,
            'discountMinorUnits': 0,
            'taxMinorUnits': 0,
            'tipMinorUnits': 0,
            'totalMinorUnits': 100,
            'tenders': [],
            'changeMinorUnits': 0,
          },
        ),
      );

      expect(result.status, RuntimeCommandStatus.succeeded);
      expect(transport.payloads, hasLength(1));
      expect(transport.payloads.single.take(2), orderedEquals([0x1b, 0x40]));
      expect(
        transport.payloads.single.skip(transport.payloads.single.length - 3),
        orderedEquals([0x1d, 0x56, 0x00]),
      );
    });

    test('keeps ambiguous printer transport outcome unknown', () async {
      final adapter = GenericThermalPrinterAdapter(
        byteTransport: _MemoryByteTransport(
          result: const HardwareByteTransportResult.unknown(),
        ),
        capabilities: const {'printer.receipt'},
      );
      final result = await adapter.execute(
        const RuntimeCommand(
          id: 'pilot-print-unknown',
          hardwareId: 'printer-1',
          type: 'print_receipt',
          requiredCapability: 'printer.receipt',
          payloadFingerprint: 'fingerprint',
          safePayload: {
            'merchantName': 'Umi',
            'locationName': 'Pilot',
            'receiptNumber': 'R-2',
            'businessDate': '2026-08-09',
            'currency': 'MXN',
            'items': [],
            'subtotalMinorUnits': 100,
            'discountMinorUnits': 0,
            'taxMinorUnits': 0,
            'tipMinorUnits': 0,
            'totalMinorUnits': 100,
            'tenders': [],
            'changeMinorUnits': 0,
          },
        ),
      );

      expect(result.status, RuntimeCommandStatus.unknown);
      expect(result.failureCode, 'unknown_outcome');
      expect(result.retryable, isFalse);
    });

    test('emits one printer-attached drawer pulse', () async {
      final transport = _MemoryByteTransport();
      final adapter = PrinterAttachedDrawerAdapter(byteTransport: transport);
      final result = await adapter.execute(
        const RuntimeCommand(
          id: 'drawer-pulse-1',
          hardwareId: 'drawer-1',
          type: 'open_drawer',
          requiredCapability: 'drawer.open',
          payloadFingerprint: 'fingerprint',
        ),
      );

      expect(result.status, RuntimeCommandStatus.succeeded);
      expect(transport.payloads.single, [0x1b, 0x70, 0, 25, 0xfa]);
    });

    test('reconnects only after a known not-sent network failure', () async {
      final client = _SequenceSocketClient([
        const HardwareByteTransportResult.notSent(),
        const HardwareByteTransportResult.sent(),
      ]);
      final transport = TcpHardwareByteTransport(
        host: '192.0.2.10',
        port: 9100,
        socketClient: client,
        maximumConnectAttempts: 2,
      );

      expect(
        (await transport.send([1, 2, 3])).outcome,
        HardwareByteTransportOutcome.sent,
      );
      expect(client.sendCount, 2);
    });

    test('does not reconnect after an ambiguous network write', () async {
      final client = _SequenceSocketClient([
        const HardwareByteTransportResult.unknown(),
        const HardwareByteTransportResult.sent(),
      ]);
      final transport = TcpHardwareByteTransport(
        host: '192.0.2.10',
        port: 9100,
        socketClient: client,
      );

      expect(
        (await transport.send([1, 2, 3])).outcome,
        HardwareByteTransportOutcome.unknown,
      );
      expect(client.sendCount, 1);
    });

    test(
      'resolves operational pilot adapters from server device configuration',
      () {
        final lab = PilotHardwareLab(
          socketClientFactory: () =>
              _SequenceSocketClient([const HardwareByteTransportResult.sent()]),
        );
        final printer = lab.resolve(
          const RuntimeDevice(
            id: 'network-printer',
            type: 'printer',
            transport: 'network_tcp',
            capabilities: {'printer.receipt', 'printer.cut'},
            enabled: true,
            connectionConfiguration: {
              'networkHost': '192.0.2.10',
              'networkPort': 9100,
              'connectTimeoutMs': 2000,
              'commandTimeoutMs': 5000,
              'characterEncoding': 'cp850',
              'receiptWidthColumns': 42,
            },
          ),
        );
        final scanner = lab.resolve(
          const RuntimeDevice(
            id: 'wedge-scanner',
            type: 'barcode_scanner',
            transport: 'keyboard_wedge',
            capabilities: {'scanner.barcode'},
            enabled: true,
          ),
        );

        expect(printer, isA<GenericThermalPrinterAdapter>());
        expect(scanner, isA<KeyboardWedgeScannerAdapter>());
      },
    );

    test('replaces a cached adapter after its endpoint changes', () async {
      final clients = <_SequenceSocketClient>[];
      final lab = PilotHardwareLab(
        socketClientFactory: () {
          final client = _SequenceSocketClient([
            const HardwareByteTransportResult.sent(),
          ]);
          clients.add(client);
          return client;
        },
      );
      RuntimeDevice device(String host) => RuntimeDevice(
        id: 'network-printer',
        type: 'printer',
        transport: 'network_tcp',
        capabilities: const {'printer.receipt'},
        enabled: true,
        connectionConfiguration: {'networkHost': host, 'networkPort': 9100},
      );
      final first = lab.resolve(device('192.0.2.10'));
      final second = lab.resolve(device('192.0.2.11'));
      await Future<void>.delayed(Duration.zero);
      expect(identical(first, second), isFalse);
      expect(clients.first.closed, isTrue);
      await lab.dispose();
    });

    test('reports a wedge scanner connected only after a scan', () async {
      final lab = PilotHardwareLab();
      lab.resolve(
        const RuntimeDevice(
          id: 'wedge-scanner',
          type: 'barcode_scanner',
          transport: 'keyboard_wedge',
          capabilities: {'scanner.barcode'},
          enabled: true,
        ),
      );

      expect(lab.connectionStateFor('wedge-scanner'), 'unknown');
      lab.recordScan(
        const CanonicalScanEvent(value: '7501', symbology: 'ean', sequence: 1),
      );
      expect(lab.connectionStateFor('wedge-scanner'), 'connected');
      await lab.dispose();
    });

    test('does not attribute one wedge scan to multiple scanners', () async {
      final lab = PilotHardwareLab();
      for (final id in ['wedge-a', 'wedge-b']) {
        lab.resolve(
          RuntimeDevice(
            id: id,
            type: 'barcode_scanner',
            transport: 'keyboard_wedge',
            capabilities: const {'scanner.barcode'},
            enabled: true,
          ),
        );
      }

      lab.recordScan(
        const CanonicalScanEvent(value: '7501', symbology: 'ean', sequence: 1),
      );

      expect(lab.connectionStateFor('wedge-a'), 'unknown');
      expect(lab.connectionStateFor('wedge-b'), 'unknown');
      await lab.dispose();
    });

    test(
      'closes a transport and reports disabled after configuration',
      () async {
        final client = _SequenceSocketClient([
          const HardwareByteTransportResult.sent(),
        ]);
        final lab = PilotHardwareLab(socketClientFactory: () => client);
        RuntimeDevice printer(bool enabled) => RuntimeDevice(
          id: 'network-printer',
          type: 'printer',
          transport: 'network_tcp',
          capabilities: const {'printer.receipt'},
          enabled: enabled,
          connectionConfiguration: const {
            'networkHost': '192.0.2.10',
            'networkPort': 9100,
          },
        );

        expect(lab.resolve(printer(true)), isNotNull);
        expect(lab.resolve(printer(false)), isNull);
        await Future<void>.delayed(Duration.zero);
        expect(client.closed, isTrue);
        expect(lab.connectionStateFor('network-printer'), 'disabled');
        await lab.dispose();
      },
    );

    test('removes an adapter omitted by a registry snapshot', () async {
      final client = _SequenceSocketClient([
        const HardwareByteTransportResult.sent(),
      ]);
      final lab = PilotHardwareLab(socketClientFactory: () => client);
      lab.resolve(
        const RuntimeDevice(
          id: 'removed-printer',
          type: 'printer',
          transport: 'network_tcp',
          capabilities: {'printer.receipt'},
          enabled: true,
          connectionConfiguration: {
            'networkHost': '192.0.2.10',
            'networkPort': 9100,
          },
        ),
      );

      await lab.retainDevices(const {});

      expect(client.closed, isTrue);
      expect(lab.connectionStateFor('removed-printer'), isNull);
      await lab.dispose();
    });

    test('scanner diagnostic succeeds only after a scan', () async {
      final adapter = KeyboardWedgeScannerAdapter();
      final future = adapter.execute(
        const RuntimeCommand(
          id: 'scanner-diagnostic',
          hardwareId: 'scanner-1',
          type: 'begin_scanner_session',
          requiredCapability: 'scanner.barcode',
          payloadFingerprint: 'fingerprint',
        ),
      );
      adapter.recordScan(
        const CanonicalScanEvent(value: '7501', symbology: 'ean', sequence: 1),
      );
      expect((await future).status, RuntimeCommandStatus.succeeded);
    });
  });
}

final class _MemoryByteTransport implements HardwareByteTransport {
  _MemoryByteTransport({
    this.result = const HardwareByteTransportResult.sent(),
  });

  final HardwareByteTransportResult result;
  final List<List<int>> payloads = [];

  @override
  Future<HardwareByteTransportResult> send(List<int> bytes) async {
    payloads.add(List.of(bytes));
    return result;
  }

  @override
  Future<HardwareByteTransportHealth> health() async =>
      const HardwareByteTransportHealth.connected(latencyMs: 1);

  @override
  Future<void> close() async {}
}

final class _SequenceSocketClient implements HardwareSocketClient {
  _SequenceSocketClient(this.results);
  final List<HardwareByteTransportResult> results;
  var sendCount = 0;
  var closed = false;

  @override
  Future<HardwareByteTransportResult> send({
    required String host,
    required int port,
    required List<int> bytes,
    required Duration connectTimeout,
    required Duration commandTimeout,
  }) async => results[sendCount++];

  @override
  Future<HardwareByteTransportHealth> health({
    required String host,
    required int port,
    required Duration timeout,
  }) async => const HardwareByteTransportHealth.connected(latencyMs: 1);

  @override
  Future<void> close() async {
    closed = true;
  }
}
