import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/bootstrap/composition_root.dart';

void main() {
  test('a role without hardware permissions does not start the relay', () {
    final access = HardwareRelayAccess.fromPermissions({
      'kitchen.read',
      'kitchen.prepare',
    });

    expect(access.isEnabled, isFalse);
    expect(access.canRead, isFalse);
    expect(access.canExecute, isFalse);
  });

  test('hardware read and command execution are independent', () {
    final read = HardwareRelayAccess.fromPermissions({'hardware.read'});
    final execute = HardwareRelayAccess.fromPermissions({
      'hardware.command.execute',
    });

    expect(read.isEnabled, isTrue);
    expect(read.canRead, isTrue);
    expect(read.canExecute, isFalse);
    expect(execute.isEnabled, isTrue);
    expect(execute.canRead, isFalse);
    expect(execute.canExecute, isTrue);
  });
}
