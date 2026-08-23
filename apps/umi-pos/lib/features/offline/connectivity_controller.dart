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

/// Centralized hysteresis: one timeout degrades, three consecutive failures go
/// offline, and two authoritative API successes restore online operation.
final class ConnectivityController extends ChangeNotifier {
  PosConnectivity _state = PosConnectivity.unknown;
  int _successes = 0;
  int _failures = 0;
  DateTime? _lastSynchronizedAt;

  PosConnectivity get state => _state;
  DateTime? get lastSynchronizedAt => _lastSynchronizedAt;

  void apiReachable({required bool authorityValid}) {
    if (!authorityValid) {
      block();
      return;
    }
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

  void replayStarted() => _set(PosConnectivity.replaying);
  void reconciliationNeeded() => _set(PosConnectivity.reconciliationRequired);
  void block() => _set(PosConnectivity.blocked);

  void _set(PosConnectivity value) {
    if (_state == value) return;
    _state = value;
    notifyListeners();
  }
}
