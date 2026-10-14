import 'package:flutter/services.dart';

import 'hardware_runtime.dart';

/// Where a terminal answered its own drawer port.
///
/// The iMin D3/D1/D2/D4 counter terminals carry the cash drawer on an RJ11
/// socket on the terminal itself, separate from the drawer's DK port on a
/// receipt printer. The pulse is therefore not an ESC/POS byte stream — it is a
/// write to the board's cashbox line, and this is what the terminal reports back
/// about it.
final class TerminalCashboxPort {
  const TerminalCashboxPort({
    required this.path,
    required this.node,
    this.value,
    this.sensorReading,
  });

  /// Which mechanism the terminal took: `service` (the vendor's system service,
  /// on newer iMin builds) or `sysfs` (a write to the board's cashbox node).
  final String path;

  /// The node the pulse was written to, or the service name.
  final String node;

  /// The pulse value the vendor's own setting asked for, when one was written.
  final String? value;

  /// The board's drawer-detect pin, when it could be read.
  ///
  /// The polarity is not documented by the vendor, so this is reported rather
  /// than interpreted: the reading with the drawer attached and the reading
  /// without it are what make it mean something.
  final int? sensorReading;

  Map<String, Object?> toSafeMetadata() => {
    'pulsePath': path,
    'pulseNode': node,
    if (value != null) 'pulseValue': value,
    if (sensorReading != null) 'drawerSensor': sensorReading,
  };
}

enum TerminalCashboxOutcome {
  /// The port answered: a pulse left the terminal, or — for a probe — the port
  /// is present and this app can drive it.
  ready,

  /// This terminal has no drawer port the app can reach. Not a fault: a tablet
  /// and a desktop build land here, and so does an iMin with the cable on the
  /// printer's DK port instead.
  absent,

  /// The port is there and refused the write.
  failed,
}

final class TerminalCashboxAnswer {
  const TerminalCashboxAnswer({
    required this.outcome,
    this.failureCode,
    this.port,
  });

  final TerminalCashboxOutcome outcome;
  final String? failureCode;
  final TerminalCashboxPort? port;
}

/// The terminal's cash-drawer port, as the platform exposes it.
///
/// The interface is injected so a test can drive the adapter without a till, the
/// same shape as `UsbPrinterChannel`.
abstract interface class TerminalCashboxChannel {
  /// Asks whether this terminal has a drawer port, without pulsing it.
  Future<TerminalCashboxAnswer> probe();

  /// Sends exactly one pulse.
  Future<TerminalCashboxAnswer> pulse();
}

/// The Kotlin side of the link (`CashDrawerChannel.kt`).
final class MethodChannelTerminalCashbox implements TerminalCashboxChannel {
  MethodChannelTerminalCashbox([MethodChannel? channel])
    : _channel = channel ?? const MethodChannel(channelName);

  static const channelName = 'co.umiconsulting.umi_pos/cash_drawer';
  final MethodChannel _channel;

  @override
  Future<TerminalCashboxAnswer> probe() => _invoke('available');

  @override
  Future<TerminalCashboxAnswer> pulse() => _invoke('pulse');

  Future<TerminalCashboxAnswer> _invoke(String method) async {
    try {
      final raw = await _channel.invokeMethod<Object?>(method);
      if (raw is! Map) {
        return const TerminalCashboxAnswer(
          outcome: TerminalCashboxOutcome.absent,
          failureCode: 'capability_unsupported',
        );
      }
      return TerminalCashboxAnswer(
        outcome: TerminalCashboxOutcome.ready,
        port: TerminalCashboxPort(
          path: '${raw['path']}',
          node: '${raw['node']}',
          value: raw['value'] as String?,
          sensorReading: (raw['sensorReading'] as num?)?.toInt(),
        ),
      );
    } on MissingPluginException {
      // Desktop, iOS or a test: this build has no terminal port behind it.
      return const TerminalCashboxAnswer(
        outcome: TerminalCashboxOutcome.absent,
        failureCode: 'transport_unavailable',
      );
    } on PlatformException catch (error) {
      if (error.code == 'CASHBOX_ABSENT') {
        return const TerminalCashboxAnswer(
          outcome: TerminalCashboxOutcome.absent,
          failureCode: 'capability_unsupported',
        );
      }
      return const TerminalCashboxAnswer(
        outcome: TerminalCashboxOutcome.failed,
        failureCode: 'terminal_hardware_failure',
      );
    }
  }
}

/// The drawer on the terminal's own port.
///
/// This is the transport an iMin till uses when the drawer's cable runs to the
/// terminal rather than to the receipt printer: the pulse never leaves through a
/// printer, so the printer's link is not part of the command.
final class TerminalCashboxDrawerAdapter
    implements
        DeviceAdapter,
        PlatformChannelFoundationTransport,
        AdapterHealthProbe {
  TerminalCashboxDrawerAdapter({required this.channel});

  final TerminalCashboxChannel channel;
  TerminalCashboxPort? _lastPort;

  @override
  Set<String> get capabilities => const {'drawer.open', 'drawer.status'};

  @override
  String get deviceType => 'cash_drawer';

  @override
  String get transport => 'platform_channel_foundation';

  @override
  Future<RuntimeCommandResult> execute(RuntimeCommand command) async {
    // A status reading must not move money. Only an open or a manager test
    // pulses the line.
    final probeOnly =
        command.type == 'query_drawer_status' ||
        command.type == 'run_diagnostic';
    final answer = probeOnly ? await channel.probe() : await channel.pulse();
    _lastPort = answer.port;
    return _result(answer, acknowledged: !probeOnly);
  }

  @override
  Future<AdapterHealth> probe() async {
    final answer = await channel.probe();
    _lastPort = answer.port;
    return switch (answer.outcome) {
      TerminalCashboxOutcome.ready => AdapterHealth(
        // The board port is reachable. It does not acknowledge a cable or a
        // physical drawer, even when its detect pin returns a value.
        state: 'unknown',
        safeDetail: {...?_lastPort?.toSafeMetadata()},
      ),
      TerminalCashboxOutcome.absent => AdapterHealth(
        state: 'disconnected',
        failureCode: answer.failureCode ?? 'capability_unsupported',
      ),
      TerminalCashboxOutcome.failed => const AdapterHealth(
        state: 'failed',
        failureCode: 'terminal_hardware_failure',
      ),
    };
  }

  RuntimeCommandResult _result(
    TerminalCashboxAnswer answer, {
    required bool acknowledged,
  }) => switch (answer.outcome) {
    TerminalCashboxOutcome.ready => RuntimeCommandResult(
      status: RuntimeCommandStatus.succeeded,
      failureCode: null,
      retryable: false,
      recovered: false,
      safeMetadata: {
        if (acknowledged) 'acknowledged': true,
        ...?_lastPort?.toSafeMetadata(),
      },
    ),
    TerminalCashboxOutcome.absent => RuntimeCommandResult(
      status: RuntimeCommandStatus.failed,
      failureCode: answer.failureCode ?? 'capability_unsupported',
      retryable: false,
      recovered: false,
    ),
    // A write that opened the line and then failed is the ambiguous case the
    // drawer doctrine names: the runtime does not send a second pulse on its
    // own, and a second open is a manager's explicit command. A status reading
    // that failed is not ambiguous, so it is merely retryable.
    TerminalCashboxOutcome.failed => RuntimeCommandResult(
      status: acknowledged
          ? RuntimeCommandStatus.unknown
          : RuntimeCommandStatus.retryable,
      failureCode: acknowledged
          ? 'unknown_outcome'
          : 'terminal_hardware_failure',
      retryable: !acknowledged,
      recovered: false,
    ),
  };
}
