import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/platform/connectivity_plus_adapter.dart';
import 'package:umi_pos/core/platform/platform_adapters.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';

import 'support/fakes.dart';

void main() {
  group('the OS source in the controller', () {
    test('a gone interface is offline in one signal, not three failures', () {
      final controller = ConnectivityController();
      // Nothing has failed yet: the state a till wears while it is happily
      // working, and the state it wears when it has just booted offline.
      expect(controller.state, PosConnectivity.unknown);

      controller.networkDown();

      expect(
        controller.state,
        PosConnectivity.offline,
        reason:
            'the OS knows the interface is gone; making the cashier lose three '
            'sales to infer it from failed calls is the gap this closes',
      );
    });

    test('a gone interface outruns a request streak that has not landed', () {
      final controller = ConnectivityController();
      controller.apiFailure();
      expect(controller.state, PosConnectivity.degraded);

      controller.networkDown();

      expect(controller.state, PosConnectivity.offline);
    });

    test('a returning interface is recovering, never online', () {
      final controller = ConnectivityController();
      controller.networkDown();

      controller.networkUp();

      expect(
        controller.state,
        PosConnectivity.recovering,
        reason: 'an interface being up is not the API answering',
      );
      controller.apiReachable(authorityValid: true);
      expect(
        controller.state,
        PosConnectivity.recovering,
        reason: 'one answered call is one success, and the rule is two',
      );

      controller.apiReachable(authorityValid: true);
      expect(controller.state, PosConnectivity.online);
      expect(controller.lastSynchronizedAt, isNotNull);
    });

    test('a success from before the interface moved does not count', () {
      final controller = ConnectivityController();
      controller.apiReachable(authorityValid: true);
      controller.apiFailure();
      expect(controller.state, PosConnectivity.degraded);

      controller.networkUp();
      expect(controller.state, PosConnectivity.recovering);
      controller.apiReachable(authorityValid: true);
      expect(
        controller.state,
        PosConnectivity.recovering,
        reason:
            'an answer that arrived before the interface changed is not '
            'evidence about the interface we have now',
      );

      controller.apiReachable(authorityValid: true);
      expect(controller.state, PosConnectivity.online);
    });

    test('going offline by OS does not shorten the next request streak', () {
      final controller = ConnectivityController();
      controller.apiFailure();
      controller.apiFailure();
      controller.networkDown();

      controller.networkUp();
      controller.apiFailure();
      expect(
        controller.state,
        isNot(PosConnectivity.offline),
        reason:
            'three fresh failures are the documented way back to offline; the '
            'tail of a streak from before the drop is not three',
      );

      controller.apiFailure();
      controller.apiFailure();
      expect(controller.state, PosConnectivity.offline);
    });

    test('an interface signal cannot override a revoked device', () {
      final controller = ConnectivityController();
      controller.block();

      controller.networkDown();
      expect(controller.state, PosConnectivity.blocked);
      controller.networkUp();
      expect(
        controller.state,
        PosConnectivity.blocked,
        reason:
            'the OS speaks about the wire, and blocked is not about the wire',
      );
    });

    test('a returning interface does not disturb a replay in progress', () {
      final controller = ConnectivityController();
      controller.replayStarted();

      controller.networkUp();

      expect(controller.state, PosConnectivity.replaying);
    });

    test(
      'an adapter with no watcher leaves the state exactly as it was',
      () async {
        const adapters = PlatformAdapters.unsupported();
        expect(adapters.connectivity.watch(), isNull);

        final root = testRoot();
        await pumpEventQueue();
        expect(
          root.connectivity.state,
          PosConnectivity.unknown,
          reason:
              'no source, no claim: the till learns about the wire from its own '
              'requests, exactly as before this step',
        );

        root.connectivity.apiFailure();
        root.connectivity.apiFailure();
        expect(root.connectivity.state, PosConnectivity.degraded);
        root.connectivity.apiFailure();
        expect(root.connectivity.state, PosConnectivity.offline);
        root.dispose();
      },
    );
  });

  group('the plugin adapter', () {
    test('any interface other than none is up, and none is down', () async {
      final wifi = _adapter(read: () async => [ConnectivityResult.wifi]);
      expect((await wifi.isOnline()).value, isTrue);

      // A till on a dock has two interfaces and needs only one of them.
      final wired = _adapter(
        read: () async => [
          ConnectivityResult.ethernet,
          ConnectivityResult.wifi,
        ],
      );
      expect((await wired.isOnline()).value, isTrue);

      final none = _adapter(read: () async => [ConnectivityResult.none]);
      final down = await none.isOnline();
      expect(down.status, CapabilityStatus.ready);
      expect(down.value, isFalse);
    });

    test(
      'a plugin that throws knows nothing, it is not an offline till',
      () async {
        final adapter = _adapter(
          read: () async => throw StateError('NetworkManager is not answering'),
        );

        final result = await adapter.isOnline();

        expect(result.status, CapabilityStatus.unavailable);
        expect(result.value, isNull);
      },
    );

    test('a plugin that answers nothing usable takes no position', () async {
      final adapter = _adapter(read: () async => const <ConnectivityResult>[]);

      expect((await adapter.isOnline()).status, CapabilityStatus.unavailable);
    });

    test(
      'the watch stream maps transitions and survives a plugin error',
      () async {
        final transitions =
            StreamController<List<ConnectivityResult>>.broadcast();
        final adapter = _adapter(subscribe: () => transitions.stream);
        final seen = <bool>[];
        final subscription = adapter.watch()!.listen(seen.add);

        transitions.add([ConnectivityResult.wifi]);
        await pumpEventQueue();
        // A watcher that breaks mid-shift says nothing about the wire, and must
        // not be read as `false` — that would take the till offline on a guess.
        transitions.addError(StateError('D-Bus went away'));
        transitions.add([ConnectivityResult.none]);
        transitions.add([ConnectivityResult.ethernet]);
        await pumpEventQueue();

        expect(seen, [true, false, true]);
        await subscription.cancel();
        await transitions.close();
      },
    );
  });

  group('the composition root wiring', () {
    test('the OS stream drives the controller', () async {
      final source = _FakeInterface();
      final root = testRoot(
        platform: PlatformAdapters(
          connectivity: source,
          deviceIdentity: const UnsupportedDeviceIdentity(),
          lifecycle: const UnsupportedAppLifecycle(),
        ),
      );
      await pumpEventQueue();
      expect(
        root.connectivity.state,
        PosConnectivity.unknown,
        reason: 'an interface being up at boot claims nothing',
      );

      source.transitions.add(false);
      await pumpEventQueue();
      expect(root.connectivity.state, PosConnectivity.offline);

      source.transitions.add(true);
      await pumpEventQueue();
      expect(root.connectivity.state, PosConnectivity.recovering);

      root.connectivity.apiReachable(authorityValid: true);
      root.connectivity.apiReachable(authorityValid: true);
      expect(root.connectivity.state, PosConnectivity.online);
      root.dispose();
      await source.close();
    });

    test(
      'a boot read that finds no interface starts the till offline',
      () async {
        final source = _FakeInterface(present: false);
        final root = testRoot(
          platform: PlatformAdapters(
            connectivity: source,
            deviceIdentity: const UnsupportedDeviceIdentity(),
            lifecycle: const UnsupportedAppLifecycle(),
          ),
        );

        await pumpEventQueue();

        expect(root.connectivity.state, PosConnectivity.offline);
        root.dispose();
        await source.close();
      },
    );

    test('a boot read that fails is not a reason to go offline', () async {
      final source = _FakeInterface(fails: true);
      final root = testRoot(
        platform: PlatformAdapters(
          connectivity: source,
          deviceIdentity: const UnsupportedDeviceIdentity(),
          lifecycle: const UnsupportedAppLifecycle(),
        ),
      );

      await pumpEventQueue();

      expect(root.connectivity.state, PosConnectivity.unknown);
      root.dispose();
      await source.close();
    });

    test('disposing the root cancels the interface watch', () async {
      final source = _FakeInterface(present: false);
      final root = testRoot(
        platform: PlatformAdapters(
          connectivity: source,
          deviceIdentity: const UnsupportedDeviceIdentity(),
          lifecycle: const UnsupportedAppLifecycle(),
        ),
      );
      await pumpEventQueue();
      expect(root.connectivity.state, PosConnectivity.offline);
      expect(source.transitions.hasListener, isTrue);

      root.dispose();

      expect(
        source.transitions.hasListener,
        isFalse,
        reason:
            'a subscription that outlives the root leaks and notifies a '
            'disposed controller',
      );
      source.transitions.add(true);
      await pumpEventQueue();
      expect(root.connectivity.state, PosConnectivity.offline);
      await source.close();
    });
  });
}

ConnectivityPlusConnectivity _adapter({
  ConnectivityCheck? read,
  ConnectivityWatch? subscribe,
}) => ConnectivityPlusConnectivity(
  check: read ?? () async => [ConnectivityResult.wifi],
  subscribe: subscribe ?? () => const Stream<List<ConnectivityResult>>.empty(),
);

/// An interface watcher a test can drive, standing in for the plugin's D-Bus
/// stream that no `flutter test` process has.
final class _FakeInterface implements ConnectivityAdapter {
  _FakeInterface({this.present = true, this.fails = false});
  final bool present;
  final bool fails;
  final transitions = StreamController<bool>.broadcast();

  @override
  Future<CapabilityResult<bool>> isOnline() async {
    if (fails) throw StateError('no watcher on this platform');
    return CapabilityResult.ready(present);
  }

  @override
  Stream<bool>? watch() => transitions.stream;

  Future<void> close() => transitions.close();
}
