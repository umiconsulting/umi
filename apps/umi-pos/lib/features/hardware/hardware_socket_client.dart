import 'hardware_socket_client_contract.dart';
import 'hardware_socket_client_stub.dart'
    if (dart.library.io) 'hardware_socket_client_io.dart'
    as implementation;

HardwareSocketClient createNativeHardwareSocketClient() =>
    implementation.createHardwareSocketClient();
