import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:umi_pos/bootstrap/composition_root.dart';
import 'package:umi_pos/core/platform/connectivity_plus_adapter.dart';
import 'package:umi_pos/core/platform/platform_adapters.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';

/// The OS connectivity source on the platform it ships on (§8K step 1).
///
/// A `flutter test` cannot prove this adapter works: it has no platform
/// channels, so a plugin that was never registered and a plugin that answers
/// look identical from the mapping's point of view. This runs on the real Linux
/// desktop, where `connectivity_plus` talks to NetworkManager over D-Bus, and
/// asserts the source *answers* — an unregistered or unreachable plugin comes
/// back `unavailable` from a `MissingPluginException`, which is exactly the
/// failure the unit tests cannot see.
///
/// Run it with the documented harness:
///   flutter test integration_test/native_connectivity_source_test.dart -d linux
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the Linux plugin answers a read and holds a watch', (
    tester,
  ) async {
    const adapter = ConnectivityPlusConnectivity();

    final read = await adapter.isOnline();
    debugPrint('connectivity_plus on this host: ${read.status} ${read.value}');
    expect(
      read.status,
      CapabilityStatus.ready,
      reason:
          'the till must get an answer from the OS source on the platform it '
          'ships on; `unavailable` here means the plugin is not answering',
    );

    // The watch has to be a real subscription, not a stream that throws the
    // moment it is listened to. A transition needs someone to unplug something,
    // so what is asserted is that the source stays quiet and alive.
    final events = <bool>[];
    final watch = adapter.watch();
    expect(watch, isNotNull, reason: 'Linux has an interface watcher');
    final subscription = watch!.listen(events.add);
    await Future<void>.delayed(const Duration(seconds: 2));
    await subscription.cancel();
    debugPrint(
      'connectivity watch: ${events.length} transition(s) during the check',
    );
  });

  testWidgets('the production root builds with the OS source wired in', (
    tester,
  ) async {
    final root = AppCompositionRoot.production();
    addTearDown(root.dispose);

    expect(
      root.platform.connectivity,
      isA<ConnectivityPlusConnectivity>(),
      reason: 'the shipped factory is where the OS source has to appear',
    );

    // The boot read has run by now on the real plugin. Whatever it found, it
    // may never claim online: that stays the API's to prove.
    await tester.pump(const Duration(milliseconds: 500));
    debugPrint('production connectivity state: ${root.connectivity.state}');
    expect(root.connectivity.state, isNot(PosConnectivity.online));
  });
}
