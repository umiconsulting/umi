import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/hardware/hardware_fingerprint.dart';
import 'package:umi_pos/features/hardware/hardware_runtime.dart';

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
    });

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
}
