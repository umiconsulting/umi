import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/hardware/hardware_runtime.dart';
import 'package:umi_pos/features/hardware/pilot_hardware_adapters.dart';
import 'package:umi_pos/features/hardware/terminal_cashbox_transport.dart';

/// The terminal's cashbox port, faked.
///
/// A till's RJ11 socket is not something a unit test can hold, so what is pinned
/// here is the adapter's behaviour around it: one pulse per open, a probe that
/// moves nothing, and the failure each answer turns into.
final class _FakeCashbox implements TerminalCashboxChannel {
  int probes = 0;
  int pulses = 0;
  TerminalCashboxOutcome outcome = TerminalCashboxOutcome.ready;
  TerminalCashboxPort? port = const TerminalCashboxPort(
    path: 'sysfs',
    node: '/sys/class/neostra_gpioctl/dev/gpioctl',
    value: '1',
    sensorReading: 1,
  );

  @override
  Future<TerminalCashboxAnswer> probe() async {
    probes += 1;
    return _answer();
  }

  @override
  Future<TerminalCashboxAnswer> pulse() async {
    pulses += 1;
    return _answer();
  }

  TerminalCashboxAnswer _answer() {
    final ready = outcome == TerminalCashboxOutcome.ready;
    return TerminalCashboxAnswer(
      outcome: outcome,
      port: ready ? port : null,
      failureCode: switch (outcome) {
        TerminalCashboxOutcome.ready => null,
        TerminalCashboxOutcome.absent => 'capability_unsupported',
        TerminalCashboxOutcome.failed => 'terminal_hardware_failure',
      },
    );
  }
}

const _drawer = RuntimeDevice(
  id: 'drawer-terminal-1',
  type: 'cash_drawer',
  transport: 'platform_channel_foundation',
  capabilities: {'drawer.open', 'drawer.status'},
  enabled: true,
);

RuntimeCommand _command(String type) => RuntimeCommand(
  id: 'cmd-1',
  hardwareId: _drawer.id,
  type: type,
  requiredCapability: 'drawer.open',
  payloadFingerprint: 'fingerprint',
);

void main() {
  test('the lab resolves the terminal drawer onto the platform channel', () {
    final cashbox = _FakeCashbox();
    final lab = PilotHardwareLab(terminalCashboxFactory: () => cashbox);

    final adapter = lab.resolve(_drawer);

    expect(adapter, isA<TerminalCashboxDrawerAdapter>());
    expect(adapter!.transport, 'platform_channel_foundation');
    expect(adapter.deviceType, 'cash_drawer');
    expect(adapter.capabilities, contains('drawer.open'));
  });

  test(
    'an open sends exactly one pulse and reports the node it used',
    () async {
      final cashbox = _FakeCashbox();
      final lab = PilotHardwareLab(terminalCashboxFactory: () => cashbox);
      final adapter = lab.resolve(_drawer)!;

      final result = await adapter.execute(_command('open_drawer'));

      expect(result.status, RuntimeCommandStatus.succeeded);
      expect(result.retryable, isFalse);
      expect(cashbox.pulses, 1);
      expect(cashbox.probes, 0);
      expect(result.safeMetadata['acknowledged'], isTrue);
      expect(
        result.safeMetadata['pulseNode'],
        '/sys/class/neostra_gpioctl/dev/gpioctl',
      );
    },
  );

  test('the manager test pulses, and a status reading does not', () async {
    final cashbox = _FakeCashbox();
    final lab = PilotHardwareLab(terminalCashboxFactory: () => cashbox);
    final adapter = lab.resolve(_drawer)!;

    await adapter.execute(_command('test_drawer'));
    expect(cashbox.pulses, 1);

    final status = await adapter.execute(_command('query_drawer_status'));
    expect(cashbox.pulses, 1, reason: 'a status reading must move no money');
    expect(cashbox.probes, 1);
    expect(status.status, RuntimeCommandStatus.succeeded);
    expect(status.safeMetadata['acknowledged'], isNull);
  });

  test(
    'a terminal with no drawer port fails as unsupported, not as broken',
    () async {
      final cashbox = _FakeCashbox()..outcome = TerminalCashboxOutcome.absent;
      final lab = PilotHardwareLab(terminalCashboxFactory: () => cashbox);
      final adapter = lab.resolve(_drawer)!;

      final result = await adapter.execute(_command('open_drawer'));

      expect(result.status, RuntimeCommandStatus.failed);
      expect(result.failureCode, 'capability_unsupported');
      expect(result.retryable, isFalse);
    },
  );

  test(
    'a pulse that opened and then failed is unknown, and is never retried',
    () async {
      final cashbox = _FakeCashbox()..outcome = TerminalCashboxOutcome.failed;
      final lab = PilotHardwareLab(terminalCashboxFactory: () => cashbox);
      final adapter = lab.resolve(_drawer)!;

      final result = await adapter.execute(_command('open_drawer'));

      expect(result.status, RuntimeCommandStatus.unknown);
      expect(result.failureCode, 'unknown_outcome');
      expect(result.retryable, isFalse);
    },
  );

  test('the port does not prove that a physical drawer is connected', () async {
    final cashbox = _FakeCashbox();
    final lab = PilotHardwareLab(terminalCashboxFactory: () => cashbox);
    lab.resolve(_drawer);

    await lab.refreshHealth();
    expect(cashbox.probes, 1);
    expect(lab.connectionStateFor(_drawer.id), 'unknown');

    cashbox.outcome = TerminalCashboxOutcome.absent;
    await lab.refreshHealth();
    expect(lab.connectionStateFor(_drawer.id), 'disconnected');
  });

  test(
    'a platform without the channel answers "no port" rather than throwing',
    () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            const MethodChannel(MethodChannelTerminalCashbox.channelName),
            (call) async => throw PlatformException(code: 'CASHBOX_ABSENT'),
          );
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(
              const MethodChannel(MethodChannelTerminalCashbox.channelName),
              null,
            ),
      );

      final answer = await MethodChannelTerminalCashbox().pulse();

      expect(answer.outcome, TerminalCashboxOutcome.absent);
      expect(answer.failureCode, 'capability_unsupported');
    },
  );
}
