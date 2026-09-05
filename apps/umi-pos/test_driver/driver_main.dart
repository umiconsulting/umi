// Development-only entrypoint. It enables the Flutter Driver extension so an
// external tool (dart mcp-server `flutter_driver_command`, or a flutter_driver
// script) can tap, type, read text, and take screenshots of the running app.
//
// Run it on the Linux desktop with:
//   flutter run -d linux -t test_driver/driver_main.dart --print-dtd \
//     --dart-define=... (same defines as docs/development/RUNNING_UMIPOS.md)
//
// It is never the production target: `lib/main.dart` stays the default.
import 'package:flutter_driver/driver_extension.dart';
import 'package:umi_pos/bootstrap/entrypoint.dart';

Future<void> main() async {
  // Must run before any binding is created: it installs the driver binding.
  enableFlutterDriverExtension();
  await launchUmiPos();
}
