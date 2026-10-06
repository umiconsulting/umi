import 'thermal_printer_adapter.dart';

abstract interface class HardwareSocketClient {
  Future<HardwareByteTransportResult> send({
    required String host,
    required int port,
    required List<int> bytes,
    required Duration connectTimeout,
    required Duration commandTimeout,
  });

  Future<HardwareByteTransportHealth> health({
    required String host,
    required int port,
    required Duration timeout,
  });

  Future<void> close();
}
