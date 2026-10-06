import 'package:connectivity_plus/connectivity_plus.dart';

import 'platform_adapters.dart';

/// The operating system's own view of the network interfaces (§8K step 1).
///
/// This is the only source on the till that can say the wire is gone *before* a
/// request has failed, which is what earns it a place next to the
/// request-derived hysteresis in `ConnectivityController`. It is deliberately
/// narrower than that controller: it reports interface presence and nothing
/// else. Whether the API answers is still the API's to say.
///
/// The plugin is reached through [ConnectivityCheck] and [ConnectivityWatch]
/// rather than directly so that a unit test can exercise the mapping without a
/// platform channel. On Linux the plugin talks to NetworkManager over D-Bus,
/// which no `flutter test` process has, so the real channel is only ever
/// touched in a build that has one.
final class ConnectivityPlusConnectivity implements ConnectivityAdapter {
  const ConnectivityPlusConnectivity({
    ConnectivityCheck check = _pluginCheck,
    ConnectivityWatch subscribe = _pluginWatch,
  }) : _check = check,
       _subscribe = subscribe;

  final ConnectivityCheck _check;
  final ConnectivityWatch _subscribe;

  @override
  Future<CapabilityResult<bool>> isOnline() async {
    try {
      return _capability(_presence(await _check()));
    } on Object {
      // The plugin could not answer: no NetworkManager, no bus, a platform
      // where the call is not implemented. That is "this source knows
      // nothing", never "the interface is gone" — a failure of the watcher
      // must not be the thing that takes a till offline.
      return const CapabilityResult.unavailable();
    }
  }

  @override
  Stream<bool>? watch() {
    final Stream<List<ConnectivityResult>> source;
    try {
      source = _subscribe();
    } on Object {
      return null;
    }
    return source
        // An error on the plugin's own stream is the same "knows nothing" as a
        // failed read. Dropping it is the whole point: mapping it to `false`
        // would take the till offline on the strength of a broken watcher, and
        // a guess is worth less than the requests it replaces.
        .handleError((Object error) {})
        .map(_presence)
        .where((presence) => presence != null)
        .map((presence) => presence!);
  }

  /// `null` when the plugin told us nothing usable, which includes the empty
  /// list — a shape the plugin documents but does not promise, since it says
  /// `none` arrives alone and never alongside another result.
  static bool? _presence(List<ConnectivityResult> interfaces) {
    if (interfaces.isEmpty) return null;
    return interfaces.any((result) => result != ConnectivityResult.none);
  }

  static CapabilityResult<bool> _capability(bool? presence) => presence == null
      ? const CapabilityResult.unavailable()
      : CapabilityResult.ready(presence);
}

/// The one-shot read, as a plain callback so a test can replace it.
typedef ConnectivityCheck = Future<List<ConnectivityResult>> Function();

/// The transition stream, as a plain callback so a test can replace it.
typedef ConnectivityWatch = Stream<List<ConnectivityResult>> Function();

Future<List<ConnectivityResult>> _pluginCheck() =>
    Connectivity().checkConnectivity();

Stream<List<ConnectivityResult>> _pluginWatch() =>
    Connectivity().onConnectivityChanged;
