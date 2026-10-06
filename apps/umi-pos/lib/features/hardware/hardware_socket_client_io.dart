import 'dart:async';
import 'dart:io';

import 'hardware_socket_client_contract.dart';
import 'thermal_printer_adapter.dart';

HardwareSocketClient createHardwareSocketClient() => IoHardwareSocketClient();

final class IoHardwareSocketClient implements HardwareSocketClient {
  Socket? _active;

  @override
  Future<HardwareByteTransportResult> send({
    required String host,
    required int port,
    required List<int> bytes,
    required Duration connectTimeout,
    required Duration commandTimeout,
  }) async {
    Socket socket;
    try {
      socket = await Socket.connect(host, port, timeout: connectTimeout);
      _active = socket;
    } on Object {
      return const HardwareByteTransportResult.notSent(
        failureCode: 'retryable_transport_failure',
      );
    }
    var writeStarted = false;
    try {
      writeStarted = true;
      socket.add(bytes);
      await socket.flush().timeout(commandTimeout);
      return const HardwareByteTransportResult.sent();
    } on Object {
      return writeStarted
          ? const HardwareByteTransportResult.unknown()
          : const HardwareByteTransportResult.notSent(
              failureCode: 'retryable_transport_failure',
            );
    } finally {
      socket.destroy();
      if (identical(_active, socket)) _active = null;
    }
  }

  @override
  Future<HardwareByteTransportHealth> health({
    required String host,
    required int port,
    required Duration timeout,
  }) async {
    final watch = Stopwatch()..start();
    try {
      final socket = await Socket.connect(host, port, timeout: timeout);
      socket.destroy();
      watch.stop();
      return HardwareByteTransportHealth.connected(
        latencyMs: watch.elapsedMilliseconds,
      );
    } on Object {
      return const HardwareByteTransportHealth.disconnected(
        failureCode: 'disconnected',
      );
    }
  }

  @override
  Future<void> close() async {
    _active?.destroy();
    _active = null;
  }
}
