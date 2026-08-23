import 'hardware_socket_client_contract.dart';
import 'thermal_printer_adapter.dart';

HardwareSocketClient createHardwareSocketClient() =>
    const UnsupportedHardwareSocketClient();

final class UnsupportedHardwareSocketClient implements HardwareSocketClient {
  const UnsupportedHardwareSocketClient();

  @override
  Future<HardwareByteTransportResult> send({
    required String host,
    required int port,
    required List<int> bytes,
    required Duration connectTimeout,
    required Duration commandTimeout,
  }) async => const HardwareByteTransportResult.notSent(
    failureCode: 'transport_unavailable',
  );

  @override
  Future<HardwareByteTransportHealth> health({
    required String host,
    required int port,
    required Duration timeout,
  }) async => const HardwareByteTransportHealth.disconnected(
    failureCode: 'transport_unavailable',
  );

  @override
  Future<void> close() async {}
}
