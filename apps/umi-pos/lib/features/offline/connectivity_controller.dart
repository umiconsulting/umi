import 'package:flutter/foundation.dart';

enum PosConnectivity {
  unknown,
  online,
  degraded,
  offline,
  recovering,
  replaying,
  reconciliationRequired,
  blocked,
}

enum PosHubState { unknown, notConfigured, selfHost, reachable, unreachable }

/// Centralized hysteresis: one timeout degrades, three consecutive failures go
/// offline, and two authoritative API successes restore online operation.
final class ConnectivityController extends ChangeNotifier {
  PosConnectivity _state = PosConnectivity.unknown;
  PosHubState _hubState = PosHubState.unknown;
  int _successes = 0;
  int _failures = 0;
  DateTime? _lastSynchronizedAt;

  PosConnectivity get state => _state;
  PosHubState get hubState => _hubState;
  DateTime? get lastSynchronizedAt => _lastSynchronizedAt;

  void apiReachable({required bool authorityValid}) {
    if (!authorityValid) {
      block();
      return;
    }
    // A blocked till stays blocked until an operator resolves the device or
    // credential problem. Reachability is a statement about the network, and a
    // network that answers must not be able to un-block a device whose
    // credentials were rejected: the probe would quietly re-open the till that
    // `block()` exists to close.
    if (_state == PosConnectivity.blocked) return;
    _failures = 0;
    _successes++;
    if (_state == PosConnectivity.offline) _set(PosConnectivity.recovering);
    if (_successes >= 2) {
      _lastSynchronizedAt = DateTime.now().toUtc();
      _set(PosConnectivity.online);
    }
  }

  void apiFailure() {
    if (_state == PosConnectivity.blocked) return;
    _successes = 0;
    _failures++;
    _set(_failures >= 3 ? PosConnectivity.offline : PosConnectivity.degraded);
  }

  /// The operating system says every network interface is gone.
  ///
  /// Earlier and stricter than [apiFailure] on purpose. The OS knows the
  /// interface state outright, where the request path can only infer it from
  /// calls that have already failed — a cashier should not have to lose three
  /// sales to learn what the platform already knows, so this goes straight to
  /// offline in one signal.
  ///
  /// Both request counters are cleared. A transition of the interface is a
  /// discontinuity in the evidence the counters were built from, so the way
  /// back is exactly the documented one — two authoritative API successes —
  /// and going offline on failed calls again takes three *fresh* failures
  /// rather than the tail of a streak from before the interface dropped.
  void networkDown() {
    if (_state == PosConnectivity.blocked) return;
    _successes = 0;
    _failures = 0;
    _set(PosConnectivity.offline);
  }

  /// The operating system says an interface is back.
  ///
  /// This must NOT mean online. An interface being up is not the API answering,
  /// and the whole vocabulary here rests on an answer from the API being the
  /// only proof of online: a state derived from a guess is worth less than the
  /// requests it is derived from. So this moves the till to [recovering] — the
  /// state that says "something improved, we have not confirmed it" — and
  /// leaves the rest to [apiReachable].
  ///
  /// The success streak is cleared for the same reason it is in [networkDown]:
  /// an answer that arrived before the interface changed is not evidence about
  /// the interface we have now, so two fresh successes are required.
  void networkUp() {
    if (_state == PosConnectivity.blocked) return;
    if (_state != PosConnectivity.offline &&
        _state != PosConnectivity.degraded) {
      return;
    }
    _successes = 0;
    _set(PosConnectivity.recovering);
  }

  void replayStarted() => _set(PosConnectivity.replaying);
  void reconciliationNeeded() => _set(PosConnectivity.reconciliationRequired);
  void block() => _set(PosConnectivity.blocked);
  void hubReachable({required bool selfHost}) =>
      _setHub(selfHost ? PosHubState.selfHost : PosHubState.reachable);
  void hubUnreachable() => _setHub(PosHubState.unreachable);
  void hubNotConfigured() => _setHub(PosHubState.notConfigured);

  void _set(PosConnectivity value) {
    if (_state == value) return;
    _state = value;
    notifyListeners();
  }

  void _setHub(PosHubState value) {
    if (_hubState == value) return;
    _hubState = value;
    notifyListeners();
  }
}
